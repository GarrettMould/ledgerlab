import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

const ACTIVE_CLASS_KEY = "ledgerlab.activeClassId";
const STUDENT_SESSION_KEY = "ledgerlab.studentSession";

export const DEFAULT_MARKETS = {
  stocks: true,
  etfs: true,
  bonds: true,
  commodities: true,
  currencies: true,
  realestate: true,
};

export function getActiveClassId() {
  return localStorage.getItem(ACTIVE_CLASS_KEY) || "";
}

export function setActiveClassId(classId) {
  if (classId) localStorage.setItem(ACTIVE_CLASS_KEY, classId);
  else localStorage.removeItem(ACTIVE_CLASS_KEY);
}

export function getStudentSession() {
  try {
    const raw = localStorage.getItem(STUDENT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.apiStudentId || !parsed?.classId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setStudentSession(session) {
  localStorage.setItem(STUDENT_SESSION_KEY, JSON.stringify(session));
}

export function clearStudentSession() {
  localStorage.removeItem(STUDENT_SESSION_KEY);
}

function classesCol() {
  return collection(db, "classes");
}

function studentsCol(classId) {
  return collection(db, "classes", classId, "students");
}

function makeInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function inviteUrlForCode(code) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("join", code);
  return url.toString();
}

export async function listClasses() {
  const snap = await getDocs(query(classesCol(), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getClass(classId) {
  const snap = await getDoc(doc(db, "classes", classId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function getClassByInviteCode(inviteCode) {
  const code = String(inviteCode || "")
    .trim()
    .toUpperCase();
  if (!code) return null;
  const snap = await getDocs(
    query(classesCol(), where("inviteCode", "==", code), limit(1))
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function ensureInviteCode(classId) {
  const cls = await getClass(classId);
  if (!cls) throw new Error("Class not found");
  if (cls.inviteCode) return cls.inviteCode;
  let inviteCode = makeInviteCode();
  for (let i = 0; i < 5; i += 1) {
    const existing = await getClassByInviteCode(inviteCode);
    if (!existing) break;
    inviteCode = makeInviteCode();
  }
  await updateDoc(doc(db, "classes", classId), {
    inviteCode,
    updatedAt: serverTimestamp(),
  });
  return inviteCode;
}

export async function createClass({
  name,
  startingCash = 100000,
  markets = DEFAULT_MARKETS,
}) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Class name is required");
  let inviteCode = makeInviteCode();
  for (let i = 0; i < 5; i += 1) {
    const existing = await getClassByInviteCode(inviteCode);
    if (!existing) break;
    inviteCode = makeInviteCode();
  }
  const ref = await addDoc(classesCol(), {
    name: trimmed,
    startingCash: Number(startingCash) || 0,
    markets: { ...DEFAULT_MARKETS, ...markets },
    inviteCode,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id, inviteCode };
}

export async function updateClassSettings(classId, patch) {
  await updateDoc(doc(db, "classes", classId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteClass(classId) {
  const students = await listClassStudents(classId);
  await Promise.all(students.map((s) => deleteDoc(doc(db, "classes", classId, "students", s.id))));
  await deleteDoc(doc(db, "classes", classId));
  if (getActiveClassId() === classId) setActiveClassId("");
  const session = getStudentSession();
  if (session?.classId === classId) clearStudentSession();
}

export async function listClassStudents(classId) {
  // Avoid orderBy as the primary path — missing createdAt / indexes can stall joins.
  const snap = await getDocs(studentsCol(classId));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => {
    const ta =
      a.createdAt?.toMillis?.() ?? (Date.parse(a.createdAt || "") || 0);
    const tb =
      b.createdAt?.toMillis?.() ?? (Date.parse(b.createdAt || "") || 0);
    return ta - tb;
  });
  return rows;
}

/** True when an id looks like a leftover local SQLite row id (not a Firestore doc id). */
export function isLegacySqliteStudentId(id) {
  return id != null && /^\d+$/.test(String(id));
}

/**
 * Trading id for the Flask ledger.
 * On Firestore ledger the seat document id is the only durable key — never a
 * leftover numeric apiStudentId from an older SQLite deploy.
 */
export function tradingStudentId(seat, ledger = "firestore") {
  if (!seat) return null;
  const seatId = seat.id || seat.firestoreStudentId || null;
  const stored = seat.apiStudentId || null;
  if (ledger === "firestore") return seatId || stored;
  if (isLegacySqliteStudentId(stored) && seatId && !isLegacySqliteStudentId(seatId)) {
    return seatId;
  }
  return stored || seatId;
}

export async function addClassStudent(
  classId,
  {
    name,
    cash,
    apiStudentId = null,
    outfit = null,
    email = null,
    authUid = null,
    investmentGoal = null,
  }
) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Student name is required");
  const ref = await addDoc(studentsCol(classId), {
    name: trimmed,
    email: email ? String(email).trim().toLowerCase() : null,
    authUid: authUid || null,
    investmentGoal: investmentGoal || null,
    cash: Number(cash) || 0,
    apiStudentId: apiStudentId || null,
    holdingsCount: 0,
    outfit: outfit || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  // Trading id is the Firestore seat id (durable ledger key).
  if (!apiStudentId) {
    await updateDoc(ref, { apiStudentId: ref.id, updatedAt: serverTimestamp() });
  }
  if (authUid) {
    await setDoc(
      doc(db, "users", authUid),
      {
        role: "student",
        primaryClassId: classId,
        email: email ? String(email).trim().toLowerCase() : null,
        name: trimmed,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
  return ref.id;
}

export async function findClassStudentByAuthUid(classId, authUid) {
  if (!classId || !authUid) return null;
  try {
    const snap = await getDocs(
      query(studentsCol(classId), where("authUid", "==", authUid), limit(1))
    );
    if (!snap.empty) {
      const d = snap.docs[0];
      return { id: d.id, ...d.data() };
    }
  } catch {
    /* fall through to roster scan */
  }
  return null;
}

/** Resolve a roster seat by auth uid and/or email (scans class — fine for classroom size). */
export async function findClassStudent(classId, { authUid = null, email = null } = {}) {
  if (!classId) return null;
  if (authUid) {
    const byAuth = await findClassStudentByAuthUid(classId, authUid);
    if (byAuth) return byAuth;
  }
  const normalized = email ? String(email).trim().toLowerCase() : "";
  if (normalized) {
    try {
      const snap = await getDocs(
        query(studentsCol(classId), where("email", "==", normalized), limit(1))
      );
      if (!snap.empty) {
        const d = snap.docs[0];
        return { id: d.id, ...d.data() };
      }
    } catch {
      /* fall through to roster scan */
    }
  }
  // Last resort: small classroom roster scan (no orderBy).
  if (!authUid && !normalized) return null;
  const roster = await listClassStudents(classId);
  if (authUid) {
    const match = roster.find((s) => s.authUid === authUid);
    if (match) return match;
  }
  if (normalized) {
    const match = roster.find(
      (s) => String(s.email || "").trim().toLowerCase() === normalized
    );
    if (match) return match;
  }
  return null;
}

export async function linkUserToClass(authUid, classId, { name, email } = {}) {
  if (!authUid || !classId) return;
  await setDoc(
    doc(db, "users", authUid),
    {
      role: "student",
      primaryClassId: classId,
      ...(name ? { name } : {}),
      ...(email ? { email: String(email).trim().toLowerCase() } : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Find a student's roster seat by Firebase auth uid.
 * Prefers users/{uid}.primaryClassId, then collectionGroup scan.
 */
export async function findStudentMembershipByAuthUid(authUid, email = null) {
  if (!authUid) return null;

  const userSnap = await getDoc(doc(db, "users", authUid));
  const profile = userSnap.exists() ? userSnap.data() : {};
  const primaryClassId = profile.primaryClassId || null;
  const profileEmail = email || profile.email || null;

  if (primaryClassId) {
    const seat = await findClassStudent(primaryClassId, {
      authUid,
      email: profileEmail,
    });
    if (seat?.id) {
      return { classId: primaryClassId, ...seat };
    }
  }

  try {
    const snap = await getDocs(
      query(
        collectionGroup(db, "students"),
        where("authUid", "==", authUid),
        limit(5)
      )
    );
    for (const d of snap.docs) {
      const classId = d.ref.parent.parent?.id;
      if (!classId) continue;
      if (primaryClassId && classId !== primaryClassId) {
        continue;
      }
      return { classId, id: d.id, ...d.data() };
    }
    for (const d of snap.docs) {
      const classId = d.ref.parent.parent?.id;
      if (!classId) continue;
      return { classId, id: d.id, ...d.data() };
    }
  } catch {
    /* collection group may need an index — primaryClassId path still works */
  }
  return null;
}

export async function buildStudentSessionFromAuth(authUid, profile = {}) {
  const membership = await findStudentMembershipByAuthUid(
    authUid,
    profile.email || null
  );
  if (!membership?.classId || !membership?.id) return null;
  const cls = await getClass(membership.classId);

  // On Firestore ledger, the trading id MUST be the seat document id.
  // Older seats may still point at a leftover SQLite numeric apiStudentId —
  // that 404s as "Student not found" while the teacher roster still shows them.
  let tradingId = tradingStudentId(membership, "firestore");
  try {
    const { getHealth, createStudent } = await import("./api");
    const health = await getHealth();
    const ledger = health?.ledger === "firestore" ? "firestore" : "sqlite";
    tradingId = tradingStudentId(membership, ledger);
    if (ledger === "firestore") {
      const patch = {};
      if (membership.apiStudentId !== membership.id) {
        patch.apiStudentId = membership.id;
      }
      if (!membership.authUid && authUid) {
        patch.authUid = authUid;
      }
      if (Object.keys(patch).length) {
        try {
          await updateClassStudent(membership.classId, membership.id, patch);
        } catch {
          /* non-fatal */
        }
      }
      try {
        await createStudent(
          membership.name || profile.name || "Student",
          Number(membership.cash) || 0,
          {
            classId: membership.classId,
            studentId: membership.id,
            authUid,
          }
        );
      } catch {
        /* ledger ensure is best-effort */
      }
    }
  } catch {
    /* health/api unavailable — keep tradingId as seat id */
    tradingId = membership.id;
  }

  await linkUserToClass(authUid, membership.classId, {
    name: membership.name || profile.name,
    email: membership.email || profile.email,
  });

  return {
    classId: membership.classId,
    className: cls?.name || "",
    inviteCode: cls?.inviteCode || "",
    firestoreStudentId: membership.id,
    apiStudentId: tradingId,
    name: membership.name || profile.name || "Student",
    authUid,
    email: membership.email || profile.email || null,
    investmentGoal:
      membership.investmentGoal || profile.investmentGoal || null,
  };
}

export async function updateClassStudent(classId, studentId, patch) {
  await updateDoc(doc(db, "classes", classId, "students", studentId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteClassStudent(classId, studentId) {
  await deleteDoc(doc(db, "classes", classId, "students", studentId));
}

function transfersCol(classId, studentId) {
  return collection(db, "classes", classId, "students", studentId, "transfers");
}

/** Teacher queues a cash credit (+) or debit (−). Money moves only after the student accepts. */
export async function createPendingTransfer(
  classId,
  studentId,
  { amount, note = null }
) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt === 0) {
    throw new Error("Enter a non-zero amount");
  }
  const direction = amt > 0 ? "credit" : "debit";
  const absAmount = Math.abs(amt);
  const ref = await addDoc(transfersCol(classId, studentId), {
    amount: amt,
    absAmount,
    direction,
    status: "pending",
    note:
      note ||
      (direction === "credit"
        ? "Your teacher sent you money"
        : "Your teacher requested a payment"),
    createdAt: serverTimestamp(),
    acceptedAt: null,
  });

  const studentRef = doc(db, "classes", classId, "students", studentId);
  const snap = await getDoc(studentRef);
  const prev = Number(snap.data()?.pendingTransferCount || 0);
  await updateDoc(studentRef, {
    pendingTransferCount: prev + 1,
    updatedAt: serverTimestamp(),
  });

  return ref.id;
}

export function subscribePendingTransfers(classId, studentId, onChange) {
  if (!classId || !studentId) {
    onChange([]);
    return () => {};
  }
  return onSnapshot(
    transfersCol(classId, studentId),
    (snap) => {
      const pending = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((t) => t.status === "pending")
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() || 0;
          const tb = b.createdAt?.toMillis?.() || 0;
          return ta - tb;
        });
      onChange(pending);
    },
    () => onChange([])
  );
}

export async function markTransferAccepted(classId, studentId, transferId) {
  await updateDoc(doc(db, "classes", classId, "students", studentId, "transfers", transferId), {
    status: "accepted",
    acceptedAt: serverTimestamp(),
  });
  const studentRef = doc(db, "classes", classId, "students", studentId);
  const snap = await getDoc(studentRef);
  const prev = Number(snap.data()?.pendingTransferCount || 0);
  await updateDoc(studentRef, {
    pendingTransferCount: Math.max(0, prev - 1),
    updatedAt: serverTimestamp(),
  });
}

export function parseJoinCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("join");
  if (fromQuery) return fromQuery.trim().toUpperCase();
  const hash = window.location.hash.replace(/^#\/?/, "");
  const match = hash.match(/^join\/([A-Za-z0-9]+)/i);
  return match ? match[1].toUpperCase() : "";
}

export function clearJoinFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("join") && !url.hash.includes("join/")) return;
  url.searchParams.delete("join");
  if (/^#\/?join\//i.test(url.hash)) url.hash = "";
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
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
  const snap = await getDocs(query(studentsCol(classId), orderBy("createdAt", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
    apiStudentId,
    holdingsCount: 0,
    outfit: outfit || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function findClassStudentByAuthUid(classId, authUid) {
  if (!classId || !authUid) return null;
  const snap = await getDocs(
    query(studentsCol(classId), where("authUid", "==", authUid), limit(1))
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
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

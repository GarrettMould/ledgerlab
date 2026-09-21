import {
  addDoc,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

const ACTIVE_CLASS_KEY = "ledgerlab.activeClassId";
const STUDENT_SESSION_KEY = "ledgerlab.studentSession";
const H2H_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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

/** Live class-doc fields for the popular-stocks ticker (1 listener, no holdings fan-out). */
export function subscribeClassPopularStocks(classId, onData, onError) {
  if (!classId) {
    onData?.({ className: "", stocks: [] });
    return () => {};
  }
  return onSnapshot(
    doc(db, "classes", classId),
    (snap) => {
      if (!snap.exists()) {
        onData?.({ className: "", stocks: [] });
        return;
      }
      const data = snap.data() || {};
      const rows = Array.isArray(data.popularStocks) ? data.popularStocks : [];
      const stocks = rows
        .map((row) => ({
          ticker: String(row?.ticker || "").toUpperCase(),
          name: String(row?.name || row?.ticker || ""),
          holders: Math.max(0, Number(row?.holders) || 0),
          shares: Math.max(0, Number(row?.shares) || 0),
        }))
        .filter((row) => row.ticker && row.holders > 0)
        .sort((a, b) => b.holders - a.holders || b.shares - a.shares || a.ticker.localeCompare(b.ticker))
        .slice(0, 15);
      onData?.({
        className: String(data.name || ""),
        stocks,
        updatedAt: data.popularStocksUpdatedAt || null,
      });
    },
    (err) => onError?.(err)
  );
}

/** Shared teacher-added tickers (all classes). Newest first. */
export function subscribeClassExtraMarketItems(_classId, onData, onError) {
  return onSnapshot(
    doc(db, "config", "classroomMarket"),
    (snap) => {
      if (!snap.exists()) {
        onData?.([]);
        return;
      }
      const rows = Array.isArray(snap.data()?.extraMarketItems)
        ? snap.data().extraMarketItems
        : [];
      const items = rows
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const ticker = String(row.ticker || "").trim().toUpperCase();
          if (!ticker) return null;
          const cat = String(row.category || "stocks").trim().toLowerCase();
          return {
            ticker,
            name: String(row.name || ticker).slice(0, 80),
            category: cat === "etfs" ? "etfs" : "stocks",
            industry: String(row.industry || "Consumer").slice(0, 40),
            addedAtMs: Math.max(0, Number(row.addedAtMs) || 0),
          };
        })
        .filter(Boolean)
        .sort(
          (a, b) =>
            b.addedAtMs - a.addedAtMs || a.ticker.localeCompare(b.ticker)
        );
      onData?.(items);
    },
    (err) => onError?.(err)
  );
}

/** Shared teacher-approved AI closet catalog (every class sees the same Extras). */
export function subscribeClassClosetItems(classId, onData, onError) {
  // Still require a class session — guests shouldn't load the shared shelf.
  if (!classId) {
    onData?.([]);
    return () => {};
  }

  function mapRows(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const id = String(row.id || "").trim();
        const kind = String(row.kind || "").trim();
        const url = String(row.url || "").trim();
        const parts = Array.isArray(row.parts) ? row.parts : [];
        // Need a renderable asset: GLB url and/or blocky parts recipe.
        if (!id || !kind || (!url && parts.length === 0)) return null;
        // Pending quiz / teacher review — keep out of the buyable shelf.
        if (
          row.live === false ||
          row.quizPending === true ||
          row.reviewPending === true
        ) {
          return null;
        }
        const offset = Array.isArray(row.offset) ? row.offset.map(Number) : undefined;
        const rotation = Array.isArray(row.rotation)
          ? row.rotation.map(Number)
          : undefined;
        return {
          id,
          kind,
          label: String(row.label || id).slice(0, 48),
          url: url || undefined,
          thumbnailUrl: row.thumbnailUrl ? String(row.thumbnailUrl) : undefined,
          attach: String(row.attach || "handR"),
          offset,
          rotation,
          scale: Number(row.scale) > 0 ? Number(row.scale) : undefined,
          color: String(row.color || "#888888"),
          accent: row.accent ? String(row.accent) : undefined,
          price: Math.max(0, Math.round(Number(row.price) || 0)),
          category: String(row.category || "").trim() || undefined,
          createdBy: row.createdBy || null,
          createdByName: row.createdByName || null,
          sourcePrompt: row.sourcePrompt || "",
          aiCreated: true,
          aiSprite: row.aiSprite === true,
          keepHair: row.keepHair === true,
          parts: parts.length ? parts : undefined,
          approvedAtMs: Math.max(0, Number(row.approvedAtMs) || 0),
        };
      })
      .filter(Boolean)
      // Newest class creations first so they aren't buried under catalog gear.
      .sort(
        (a, b) =>
          (b.approvedAtMs || 0) - (a.approvedAtMs || 0) ||
          String(a.label || "").localeCompare(String(b.label || ""))
      );
  }

  return onSnapshot(
    doc(db, "config", "classroomCloset"),
    (snap) => {
      if (!snap.exists()) {
        onData?.([]);
        return;
      }
      onData?.(mapRows(snap.data()?.closetItems));
    },
    (err) => {
      onError?.(err);
      onData?.([]);
    }
  );
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

function toJsDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

/** Normalize headToHead field from a class doc for UI use. */
export function normalizeHeadToHead(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  const status = String(raw.status || "").trim() || "open";
  if (!id || status === "ended" || status === "cancelled") return null;
  const createdAt = toJsDate(raw.createdAt);
  const endsAt = toJsDate(raw.endsAt);
  return {
    id,
    status,
    createdAt,
    endsAt,
    createdAtMs: createdAt?.getTime?.() || 0,
    endsAtMs: endsAt?.getTime?.() || 0,
  };
}

/**
 * Teacher starts a class-wide head-to-head challenge.
 * Starts now; ends exactly one week later.
 */
export async function createHeadToHeadChallenge(classId) {
  if (!classId) throw new Error("No class selected");
  const now = new Date();
  const ends = new Date(now.getTime() + H2H_WEEK_MS);
  const id = `h2h_${now.getTime()}`;
  const challenge = {
    id,
    status: "open",
    createdAt: Timestamp.fromDate(now),
    endsAt: Timestamp.fromDate(ends),
  };
  await updateDoc(doc(db, "classes", classId), {
    headToHead: challenge,
    updatedAt: serverTimestamp(),
  });
  return normalizeHeadToHead(challenge);
}

export async function endHeadToHeadChallenge(classId) {
  if (!classId) throw new Error("No class selected");
  const snap = await getDoc(doc(db, "classes", classId));
  const current = snap.exists() ? snap.data()?.headToHead : null;
  if (!current?.id) {
    await updateDoc(doc(db, "classes", classId), {
      headToHead: null,
      updatedAt: serverTimestamp(),
    });
    return;
  }
  await updateDoc(doc(db, "classes", classId), {
    headToHead: {
      ...current,
      status: "ended",
      endedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
}

/** Live listener for the class head-to-head challenge. */
export function subscribeHeadToHead(classId, onChange, onError) {
  if (!classId) {
    onChange?.(null);
    return () => {};
  }
  return onSnapshot(
    doc(db, "classes", classId),
    (snap) => {
      if (!snap.exists()) {
        onChange?.(null);
        return;
      }
      onChange?.(normalizeHeadToHead((snap.data() || {}).headToHead));
    },
    (err) => {
      onError?.(err);
      onChange?.(null);
    }
  );
}

/**
 * Student skips challenging this season — hides them from classmates' opponent lists.
 */
export async function skipHeadToHeadSeason(classId, studentId, seasonId) {
  if (!classId || !studentId || !seasonId) {
    throw new Error("Missing class, student, or season");
  }
  await updateDoc(doc(db, "classes", classId, "students", studentId), {
    h2hOptOutSeasonId: String(seasonId),
    updatedAt: serverTimestamp(),
  });
}

function h2hMatchesCol(classId) {
  return collection(db, "classes", classId, "h2hMatches");
}

function normalizeH2hPick(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    const ticker = raw.trim().toUpperCase();
    return ticker ? { ticker, name: ticker, startPrice: null } : null;
  }
  if (typeof raw !== "object") return null;
  const ticker = String(raw.ticker || "").trim().toUpperCase();
  if (!ticker) return null;
  const start = Number(raw.startPrice);
  return {
    ticker,
    name: String(raw.name || ticker),
    startPrice: Number.isFinite(start) && start > 0 ? start : null,
  };
}

function normalizeH2hPicks(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeH2hPick).filter(Boolean);
}

function normalizeH2hMatch(id, raw = {}) {
  return {
    id,
    seasonId: String(raw.seasonId || ""),
    fromId: String(raw.fromId || ""),
    fromName: String(raw.fromName || "Classmate"),
    toId: String(raw.toId || ""),
    toName: String(raw.toName || "Classmate"),
    status: String(raw.status || "pending"),
    tickersFrom: normalizeH2hPicks(raw.tickersFrom),
    tickersTo: normalizeH2hPicks(raw.tickersTo),
    testMirror: Boolean(raw.testMirror),
    createdAt: toJsDate(raw.createdAt),
    updatedAt: toJsDate(raw.updatedAt),
  };
}

/**
 * Create a head-to-head match request (from → to).
 * For solo testing, pass invertTest:true to store it as if the classmate challenged you.
 * Blocks duplicate pending/accepted pairs for the same contest.
 */
export async function createH2hMatchRequest({
  classId,
  seasonId,
  fromId,
  fromName,
  toId,
  toName,
  invertTest = false,
}) {
  if (!classId || !seasonId) throw new Error("Missing challenge season");
  if (!fromId || !toId) throw new Error("Pick a classmate");
  if (fromId === toId) throw new Error("You can’t challenge yourself");

  const a = invertTest ? toId : fromId;
  const b = invertTest ? fromId : toId;
  const actorId = fromId; // student initiating the action on this device
  const existing = await getDocs(h2hMatchesCol(classId));
  for (const d of existing.docs) {
    const m = normalizeH2hMatch(d.id, d.data() || {});
    if (m.seasonId !== seasonId) continue;
    if (m.status !== "pending" && m.status !== "accepted") continue;
    if (
      !invertTest &&
      (m.fromId === actorId || m.toId === actorId)
    ) {
      throw new Error(
        m.status === "accepted"
          ? "You’re already in a match for this contest"
          : "You already have a pending challenge this contest"
      );
    }
    const pair =
      (m.fromId === a && m.toId === b) || (m.fromId === b && m.toId === a);
    if (pair) {
      throw new Error(
        m.status === "accepted"
          ? "You’re already matched with this classmate"
          : "A challenge with this classmate is already pending"
      );
    }
  }

  // Testing shortcut: store as if `to` challenged `from` so the picker sees an inbox.
  const payload = invertTest
    ? {
        seasonId,
        fromId: toId,
        fromName: toName || "Classmate",
        toId: fromId,
        toName: fromName || "You",
        status: "pending",
        tickersFrom: [],
        tickersTo: [],
        testMirror: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    : {
        seasonId,
        fromId,
        fromName: fromName || "Student",
        toId,
        toName: toName || "Student",
        status: "pending",
        tickersFrom: [],
        tickersTo: [],
        testMirror: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

  const ref = await addDoc(h2hMatchesCol(classId), payload);
  return normalizeH2hMatch(ref.id, {
    ...payload,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function respondH2hMatch(classId, matchId, status) {
  if (!classId || !matchId) throw new Error("Missing match");
  if (status !== "accepted" && status !== "declined") {
    throw new Error("Invalid response");
  }
  await updateDoc(doc(db, "classes", classId, "h2hMatches", matchId), {
    status,
    updatedAt: serverTimestamp(),
    respondedAt: serverTimestamp(),
  });
}

/**
 * Accept one pending match and decline every other pending match this student
 * is in for the contest (incoming + outgoing). One active battle per student.
 */
export async function acceptH2hMatchAndClearOthers({
  classId,
  seasonId,
  matchId,
  studentId,
}) {
  if (!classId || !seasonId || !matchId || !studentId) {
    throw new Error("Missing match details");
  }
  const snap = await getDocs(h2hMatchesCol(classId));
  const updates = [];
  for (const d of snap.docs) {
    const m = normalizeH2hMatch(d.id, d.data() || {});
    if (m.seasonId !== seasonId) continue;
    const involvesMe = m.fromId === studentId || m.toId === studentId;
    if (!involvesMe) continue;
    if (m.status === "accepted" && d.id !== matchId) {
      throw new Error("You’re already locked into a match this contest");
    }
    if (d.id === matchId) {
      if (m.status !== "pending") {
        throw new Error("That challenge is no longer pending");
      }
      updates.push(
        updateDoc(d.ref, {
          status: "accepted",
          updatedAt: serverTimestamp(),
          respondedAt: serverTimestamp(),
        })
      );
      continue;
    }
    if (m.status === "pending") {
      updates.push(
        updateDoc(d.ref, {
          status: "declined",
          updatedAt: serverTimestamp(),
          respondedAt: serverTimestamp(),
        })
      );
    }
  }
  await Promise.all(updates);
}

/** Decline every pending match involving this student for the contest. */
export async function declineAllPendingH2hForStudent({
  classId,
  seasonId,
  studentId,
}) {
  if (!classId || !seasonId || !studentId) {
    throw new Error("Missing class, season, or student");
  }
  const snap = await getDocs(h2hMatchesCol(classId));
  const updates = [];
  for (const d of snap.docs) {
    const m = normalizeH2hMatch(d.id, d.data() || {});
    if (m.seasonId !== seasonId) continue;
    if (m.status !== "pending") continue;
    if (m.fromId !== studentId && m.toId !== studentId) continue;
    updates.push(
      updateDoc(d.ref, {
        status: "declined",
        updatedAt: serverTimestamp(),
        respondedAt: serverTimestamp(),
      })
    );
  }
  await Promise.all(updates);
}

/**
 * Lock one side's 3 stock picks (with start prices for % tracking).
 * side: "from" | "to"
 */
export async function setH2hMatchPicks(classId, matchId, side, picks) {
  if (!classId || !matchId) throw new Error("Missing match");
  if (side !== "from" && side !== "to") throw new Error("Invalid side");
  const cleaned = normalizeH2hPicks(picks);
  if (cleaned.length !== 3) throw new Error("Pick exactly 3 stocks");
  if (cleaned.some((p) => !p.startPrice)) {
    throw new Error("Missing a starting price for one of your picks");
  }
  const field = side === "from" ? "tickersFrom" : "tickersTo";
  await updateDoc(doc(db, "classes", classId, "h2hMatches", matchId), {
    [field]: cleaned.map((p) => ({
      ticker: p.ticker,
      name: p.name,
      startPrice: p.startPrice,
    })),
    updatedAt: serverTimestamp(),
  });
}

/** Equal-weight average % change across picks vs startPrice. */
export function h2hBasketReturnPct(picks, liveByTicker = {}) {
  const rows = normalizeH2hPicks(picks);
  if (!rows.length) return null;
  const pcts = [];
  for (const p of rows) {
    const live = Number(liveByTicker[p.ticker]);
    if (!(p.startPrice > 0) || !(live > 0)) continue;
    pcts.push(((live - p.startPrice) / p.startPrice) * 100);
  }
  if (!pcts.length) return null;
  return pcts.reduce((a, b) => a + b, 0) / pcts.length;
}

/** All class matchups (small classroom — filter client-side). */
export function subscribeH2hMatches(classId, onChange, onError) {
  if (!classId) {
    onChange?.([]);
    return () => {};
  }
  return onSnapshot(
    h2hMatchesCol(classId),
    (snap) => {
      const rows = snap.docs.map((d) => normalizeH2hMatch(d.id, d.data() || {}));
      rows.sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0));
      onChange?.(rows);
    },
    (err) => {
      onError?.(err);
      onChange?.([]);
    }
  );
}

/** One-shot list of head-to-head matches for a class (teacher overview). */
export async function listH2hMatches(classId) {
  if (!classId) return [];
  const snap = await getDocs(h2hMatchesCol(classId));
  const rows = snap.docs.map((d) => normalizeH2hMatch(d.id, d.data() || {}));
  rows.sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0));
  return rows;
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

  const session = {
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
  recordStudentLogin(session.classId, session.firestoreStudentId, {
    name: session.name,
    email: session.email,
    authUid,
  }).catch(() => {});
  return session;
}

export async function updateClassStudent(classId, studentId, patch) {
  await updateDoc(doc(db, "classes", classId, "students", studentId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

/** Record a strategy scenario the student has already answered (Create Item). */
export async function markClosetAiScenarioAnswered(classId, studentId, scenarioId) {
  const id = String(scenarioId || "").trim();
  if (!classId || !studentId || !id) return;
  await updateDoc(doc(db, "classes", classId, "students", studentId), {
    closetAiAnsweredScenarios: arrayUnion(id),
    updatedAt: serverTimestamp(),
  });
}

/** Clear answered-scenario history so a new unique cycle can begin. */
export async function resetClosetAiAnsweredScenarios(classId, studentId) {
  if (!classId || !studentId) return;
  await updateDoc(doc(db, "classes", classId, "students", studentId), {
    closetAiAnsweredScenarios: [],
    updatedAt: serverTimestamp(),
  });
}

/** Debounce window so page refreshes don't spam login events. */
const LOGIN_DEBOUNCE_MS = 30 * 60 * 1000;

/**
 * Record a student login: updates lastLoginAt / loginCount on the seat,
 * and appends classes/{classId}/students/{id}/logins/{autoId}.
 * Safe to call on every auth restore — debounced to ~30 minutes.
 */
export async function recordStudentLogin(classId, studentId, meta = {}) {
  if (!classId || !studentId) return;
  try {
    const ref = doc(db, "classes", classId, "students", studentId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data() || {};
    const lastMs =
      data.lastLoginAt?.toMillis?.() ||
      (typeof data.lastLoginAtMs === "number" ? data.lastLoginAtMs : 0) ||
      0;
    if (lastMs && Date.now() - lastMs < LOGIN_DEBOUNCE_MS) return;

    await updateDoc(ref, {
      lastLoginAt: serverTimestamp(),
      lastLoginAtMs: Date.now(),
      loginCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    await addDoc(collection(db, "classes", classId, "students", studentId, "logins"), {
      at: serverTimestamp(),
      atMs: Date.now(),
      name: meta.name || data.name || null,
      email: meta.email || data.email || null,
      authUid: meta.authUid || data.authUid || null,
    });
  } catch {
    /* analytics must never block sign-in */
  }
}

export async function getClassStudent(classId, studentId) {
  if (!classId || !studentId) return null;
  const snap = await getDoc(doc(db, "classes", classId, "students", studentId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function deleteClassStudent(classId, studentId, { authUid = null } = {}) {
  const ref = doc(db, "classes", classId, "students", studentId);
  let uid = authUid || null;
  if (!uid) {
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) uid = snap.data()?.authUid || null;
    } catch {
      /* still attempt delete */
    }
  }
  await deleteDoc(ref);
  // Drop class membership so they don't keep resolving into this class.
  if (uid) {
    try {
      const userRef = doc(db, "users", uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists() && userSnap.data()?.primaryClassId === classId) {
        await updateDoc(userRef, {
          primaryClassId: null,
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      /* non-fatal — seat is already gone */
    }
  }
}

function messagesCol(classId) {
  return collection(db, "classes", classId, "messages");
}

function threadsCol(classId) {
  return collection(db, "classes", classId, "threads");
}

function threadPostsCol(classId, threadId) {
  return collection(db, "classes", classId, "threads", threadId, "posts");
}

export const STARTER_THREADS = [
  {
    id: "starter-daily-investments",
    title: "Daily Investments (Tell us Your Picks)",
  },
  {
    id: "starter-long-term-strategy",
    title: "Long Term Strategy Talk",
  },
];

function tsToIso(value) {
  if (!value) return null;
  if (value?.toDate) return value.toDate().toISOString();
  if (typeof value === "string") return value;
  return null;
}

/** Ensure the two classroom starter threads exist (idempotent). */
export async function ensureStarterThreads(classId) {
  if (!classId) return;
  await Promise.all(
    STARTER_THREADS.map(async (starter) => {
      const ref = doc(db, "classes", classId, "threads", starter.id);
      const snap = await getDoc(ref);
      if (snap.exists()) return;
      await setDoc(ref, {
        title: starter.title,
        isStarter: true,
        authorName: "Ledger Lab",
        authorId: null,
        authorRole: "teacher",
        replyCount: 0,
        lastPostPreview: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    })
  );
}

/** Live thread list for a class (most recently active first). */
export function subscribeClassThreads(classId, onChange, onError) {
  if (!classId) {
    onChange([]);
    return () => {};
  }
  const q = query(threadsCol(classId), orderBy("updatedAt", "desc"), limit(60));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          title: String(data.title || "Thread"),
          isStarter: Boolean(data.isStarter),
          authorName: String(data.authorName || "Someone"),
          authorRole: data.authorRole === "teacher" ? "teacher" : "student",
          authorId: data.authorId || null,
          createdAt: tsToIso(data.createdAt),
          updatedAt: tsToIso(data.updatedAt) || tsToIso(data.createdAt),
          replyCount: Number(data.replyCount || 0),
          lastPostPreview: String(data.lastPostPreview || ""),
        };
      });
      onChange(rows);
    },
    (err) => {
      onError?.(err);
      onChange([]);
    }
  );
}

export function subscribeThreadPosts(classId, threadId, onChange, onError) {
  if (!classId || !threadId) {
    onChange([]);
    return () => {};
  }
  const q = query(
    threadPostsCol(classId, threadId),
    orderBy("createdAt", "asc"),
    limit(120)
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          body: String(data.body || ""),
          authorName: String(data.authorName || "Someone"),
          authorId: data.authorId || null,
          authorRole: data.authorRole === "teacher" ? "teacher" : "student",
          createdAt: tsToIso(data.createdAt),
        };
      });
      onChange(rows);
    },
    (err) => {
      onError?.(err);
      onChange([]);
    }
  );
}

export async function getClassThread(classId, threadId) {
  if (!classId || !threadId) return null;
  const snap = await getDoc(doc(db, "classes", classId, "threads", threadId));
  if (!snap.exists()) return null;
  const data = snap.data() || {};
  return {
    id: snap.id,
    title: String(data.title || "Thread"),
    isStarter: Boolean(data.isStarter),
    authorName: String(data.authorName || "Someone"),
    authorRole: data.authorRole === "teacher" ? "teacher" : "student",
    authorId: data.authorId || null,
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt) || tsToIso(data.createdAt),
    replyCount: Number(data.replyCount || 0),
    lastPostPreview: String(data.lastPostPreview || ""),
  };
}

export async function createClassThread(
  classId,
  { title, body, authorName, authorId = null, authorRole = "student" }
) {
  if (!classId) throw new Error("Join a class to start a thread.");
  const heading = String(title || "").trim();
  const text = String(body || "").trim();
  if (!heading) throw new Error("Give the thread a title.");
  if (heading.length > 80) throw new Error("Keep titles under 80 characters.");
  if (!text) throw new Error("Write the first message.");
  if (text.length > 400) throw new Error("Keep messages under 400 characters.");
  const name = (String(authorName || "").trim() || "Someone").slice(0, 48);
  const threadRef = await addDoc(threadsCol(classId), {
    title: heading.slice(0, 80),
    isStarter: false,
    authorName: name,
    authorId: authorId || null,
    authorRole: authorRole === "teacher" ? "teacher" : "student",
    replyCount: 1,
    lastPostPreview: text.slice(0, 120),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await addDoc(threadPostsCol(classId, threadRef.id), {
    body: text,
    authorName: name,
    authorId: authorId || null,
    authorRole: authorRole === "teacher" ? "teacher" : "student",
    createdAt: serverTimestamp(),
  });
  return threadRef.id;
}

export async function replyClassThread(
  classId,
  threadId,
  { body, authorName, authorId = null, authorRole = "student" }
) {
  if (!classId || !threadId) throw new Error("Thread not found.");
  const text = String(body || "").trim();
  if (!text) throw new Error("Write a reply first.");
  if (text.length > 400) throw new Error("Keep messages under 400 characters.");
  const name = (String(authorName || "").trim() || "Someone").slice(0, 48);
  const threadRef = doc(db, "classes", classId, "threads", threadId);
  const threadSnap = await getDoc(threadRef);
  if (!threadSnap.exists()) throw new Error("Thread not found.");
  await addDoc(threadPostsCol(classId, threadId), {
    body: text,
    authorName: name,
    authorId: authorId || null,
    authorRole: authorRole === "teacher" ? "teacher" : "student",
    createdAt: serverTimestamp(),
  });
  const prev = threadSnap.data() || {};
  await updateDoc(threadRef, {
    replyCount: Number(prev.replyCount || 0) + 1,
    lastPostPreview: text.slice(0, 120),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteClassThread(classId, threadId) {
  if (!classId || !threadId) return;
  const threadRef = doc(db, "classes", classId, "threads", threadId);
  const threadSnap = await getDoc(threadRef);
  if (!threadSnap.exists()) return;
  if (threadSnap.data()?.isStarter) {
    throw new Error("Starter threads can’t be deleted.");
  }
  const posts = await getDocs(threadPostsCol(classId, threadId));
  await Promise.all(posts.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(threadRef);
}

export async function deleteClassThreadPost(classId, threadId, postId) {
  if (!classId || !threadId || !postId) return;
  await deleteDoc(doc(db, "classes", classId, "threads", threadId, "posts", postId));
  const threadRef = doc(db, "classes", classId, "threads", threadId);
  const threadSnap = await getDoc(threadRef);
  if (!threadSnap.exists()) return;
  const count = Math.max(0, Number(threadSnap.data()?.replyCount || 1) - 1);
  await updateDoc(threadRef, {
    replyCount: count,
    updatedAt: serverTimestamp(),
  });
}

/** @deprecated Flat board — kept briefly for older clients; prefer threads. */
export function subscribeClassMessages(classId, onChange, onError) {
  return subscribeClassThreads(classId, onChange, onError);
}

/** @deprecated */
export async function postClassMessage() {
  throw new Error("Open a thread to post — the main board doesn’t take free-floating messages.");
}

/** @deprecated */
export async function deleteClassMessage(classId, messageId) {
  if (!classId || !messageId) return;
  await deleteDoc(doc(db, "classes", classId, "messages", messageId));
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

function stockRequestsCol() {
  return collection(db, "stockRequests");
}

function bugReportsCol() {
  return collection(db, "bugReports");
}

/** Student asks teachers to add a ticker / company (shared across all classes). */
export async function createStockRequest(
  classId,
  { query: rawQuery, studentId = null, studentName = "", className = "" } = {}
) {
  const text = String(rawQuery || "").trim().slice(0, 80);
  if (text.length < 1) throw new Error("Enter a stock symbol or company name.");
  const name = (String(studentName || "").trim() || "Student").slice(0, 48);
  const ref = await addDoc(stockRequestsCol(), {
    query: text,
    studentId: studentId || null,
    studentName: name,
    classId: classId || null,
    className: String(className || "").trim().slice(0, 80) || null,
    status: "pending",
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  });
  return { id: ref.id, query: text, studentName: name, status: "pending" };
}

export function subscribeStockRequests(onData, onError) {
  const q = query(stockRequestsCol(), orderBy("createdAt", "desc"), limit(60));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          query: String(data.query || "").slice(0, 80),
          studentId: data.studentId || null,
          studentName: String(data.studentName || "Student").slice(0, 48),
          classId: data.classId || null,
          className: String(data.className || "").slice(0, 80),
          status: String(data.status || "pending"),
          createdAt: data.createdAt?.toDate?.() || null,
          createdAtMs: Number(data.createdAtMs) || data.createdAt?.toMillis?.() || 0,
        };
      });
      onData?.(rows);
    },
    (err) => {
      onError?.(err);
      onData?.([]);
    }
  );
}

export async function resolveStockRequest(requestId, status = "done") {
  if (!requestId) return;
  const next = status === "dismissed" ? "dismissed" : "done";
  await updateDoc(doc(db, "stockRequests", requestId), {
    status: next,
    resolvedAt: serverTimestamp(),
  });
}

/** Student reports a product / classroom bug (shared across all classes). */
export async function createBugReport(
  classId,
  { message: rawMessage, studentId = null, studentName = "", className = "" } = {}
) {
  const text = String(rawMessage || "").trim().slice(0, 400);
  if (text.length < 3) throw new Error("Describe the issue in a few words.");
  const name = (String(studentName || "").trim() || "Student").slice(0, 48);
  const ref = await addDoc(bugReportsCol(), {
    message: text,
    studentId: studentId || null,
    studentName: name,
    classId: classId || null,
    className: String(className || "").trim().slice(0, 80) || null,
    status: "pending",
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  });
  return { id: ref.id, message: text, studentName: name, status: "pending" };
}

export function subscribeBugReports(onData, onError) {
  const q = query(bugReportsCol(), orderBy("createdAt", "desc"), limit(60));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          message: String(data.message || "").slice(0, 400),
          studentId: data.studentId || null,
          studentName: String(data.studentName || "Student").slice(0, 48),
          classId: data.classId || null,
          className: String(data.className || "").slice(0, 80),
          status: String(data.status || "pending"),
          createdAt: data.createdAt?.toDate?.() || null,
          createdAtMs: Number(data.createdAtMs) || data.createdAt?.toMillis?.() || 0,
        };
      });
      onData?.(rows);
    },
    (err) => {
      onError?.(err);
      onData?.([]);
    }
  );
}

export async function resolveBugReport(reportId, status = "done") {
  if (!reportId) return;
  const next = status === "dismissed" ? "dismissed" : "done";
  await updateDoc(doc(db, "bugReports", reportId), {
    status: next,
    resolvedAt: serverTimestamp(),
  });
}

/**
 * DEV-ONLY threaded message board.
 * Never touches Firestore / real class docs.
 */

const STORAGE_KEY = "ledgerlab.devMessageBoard.threads.v1";
const listeners = new Set();

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

function canUseDevBoard() {
  return Boolean(import.meta.env.DEV);
}

function stamp(iso) {
  return iso || new Date().toISOString();
}

function emptyBoard() {
  const now = new Date().toISOString();
  return {
    threads: STARTER_THREADS.map((t) => ({
      id: t.id,
      title: t.title,
      isStarter: true,
      authorName: "Ledger Lab",
      authorRole: "teacher",
      authorId: null,
      createdAt: now,
      updatedAt: now,
      posts: [],
    })),
  };
}

function readBoard() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = emptyBoard();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.threads)) {
      const seeded = emptyBoard();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    // Ensure starters always exist (in case of older local stores).
    const byId = new Map(parsed.threads.map((t) => [t.id, t]));
    for (const starter of STARTER_THREADS) {
      if (!byId.has(starter.id)) {
        const now = new Date().toISOString();
        parsed.threads.unshift({
          id: starter.id,
          title: starter.title,
          isStarter: true,
          authorName: "Ledger Lab",
          authorRole: "teacher",
          authorId: null,
          createdAt: now,
          updatedAt: now,
          posts: [],
        });
      }
    }
    return parsed;
  } catch {
    return emptyBoard();
  }
}

function writeBoard(board) {
  const next = {
    threads: (board.threads || []).slice(0, 80).map((t) => ({
      ...t,
      posts: (t.posts || []).slice(0, 120),
    })),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  listeners.forEach((fn) => {
    try {
      fn(summarizeThreads(next.threads));
    } catch {
      /* ignore */
    }
  });
  return next;
}

function summarizeThreads(threads) {
  return [...threads]
    .map((t) => ({
      id: t.id,
      title: t.title,
      isStarter: Boolean(t.isStarter),
      authorName: t.authorName || "Someone",
      authorRole: t.authorRole === "teacher" ? "teacher" : "student",
      createdAt: t.createdAt || null,
      updatedAt: t.updatedAt || t.createdAt || null,
      replyCount: (t.posts || []).length,
      lastPostPreview: t.posts?.[0]?.body || "",
    }))
    .sort((a, b) => {
      const ta = Date.parse(a.updatedAt || a.createdAt || "") || 0;
      const tb = Date.parse(b.updatedAt || b.createdAt || "") || 0;
      return tb - ta;
    });
}

export function shouldUseDevMessageBoard() {
  if (!canUseDevBoard()) return false;
  try {
    if (localStorage.getItem("ledgerlab.devRealMessageBoard") === "1") {
      return false;
    }
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("realBoard") === "1") return false;
  }
  return true;
}

export function listDevThreads() {
  return summarizeThreads(readBoard().threads);
}

export function getDevThread(threadId) {
  const thread = readBoard().threads.find((t) => t.id === threadId);
  if (!thread) return null;
  return {
    id: thread.id,
    title: thread.title,
    isStarter: Boolean(thread.isStarter),
    authorName: thread.authorName || "Someone",
    authorRole: thread.authorRole === "teacher" ? "teacher" : "student",
    createdAt: thread.createdAt || null,
    updatedAt: thread.updatedAt || thread.createdAt || null,
    posts: [...(thread.posts || [])].sort((a, b) => {
      const ta = Date.parse(a.createdAt || "") || 0;
      const tb = Date.parse(b.createdAt || "") || 0;
      return ta - tb;
    }),
  };
}

export function subscribeDevThreads(onChange) {
  const emit = () => onChange(listDevThreads());
  listeners.add(emit);
  emit();
  return () => listeners.delete(emit);
}

export async function createDevThread({
  title,
  body,
  authorName,
  authorId = null,
  authorRole = "student",
}) {
  if (!canUseDevBoard()) {
    throw new Error("Dev message board is only available in local development.");
  }
  const heading = String(title || "").trim();
  const text = String(body || "").trim();
  if (!heading) throw new Error("Give the thread a title.");
  if (heading.length > 80) throw new Error("Keep titles under 80 characters.");
  if (!text) throw new Error("Write the first message.");
  if (text.length > 400) throw new Error("Keep messages under 400 characters.");
  const name = String(authorName || "").trim() || "Someone";
  const now = stamp();
  const thread = {
    id: `dev-thread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: heading.slice(0, 80),
    isStarter: false,
    authorName: name.slice(0, 48),
    authorId: authorId || null,
    authorRole: authorRole === "teacher" ? "teacher" : "student",
    createdAt: now,
    updatedAt: now,
    posts: [
      {
        id: `dev-post-${Date.now()}`,
        body: text,
        authorName: name.slice(0, 48),
        authorId: authorId || null,
        authorRole: authorRole === "teacher" ? "teacher" : "student",
        createdAt: now,
      },
    ],
  };
  const board = readBoard();
  board.threads = [thread, ...board.threads];
  writeBoard(board);
  return thread.id;
}

export async function replyDevThread(
  threadId,
  { body, authorName, authorId = null, authorRole = "student" }
) {
  if (!canUseDevBoard()) {
    throw new Error("Dev message board is only available in local development.");
  }
  const text = String(body || "").trim();
  if (!text) throw new Error("Write a reply first.");
  if (text.length > 400) throw new Error("Keep messages under 400 characters.");
  const name = String(authorName || "").trim() || "Someone";
  const board = readBoard();
  const idx = board.threads.findIndex((t) => t.id === threadId);
  if (idx < 0) throw new Error("Thread not found.");
  const now = stamp();
  const post = {
    id: `dev-post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    body: text,
    authorName: name.slice(0, 48),
    authorId: authorId || null,
    authorRole: authorRole === "teacher" ? "teacher" : "student",
    createdAt: now,
  };
  const thread = board.threads[idx];
  thread.posts = [post, ...(thread.posts || [])];
  thread.updatedAt = now;
  board.threads[idx] = thread;
  writeBoard(board);
  return getDevThread(threadId);
}

export async function deleteDevThread(threadId) {
  if (!canUseDevBoard()) return listDevThreads();
  const board = readBoard();
  board.threads = board.threads.filter(
    (t) => t.id !== threadId || t.isStarter
  );
  writeBoard(board);
  return listDevThreads();
}

export async function deleteDevPost(threadId, postId) {
  if (!canUseDevBoard()) return getDevThread(threadId);
  const board = readBoard();
  const idx = board.threads.findIndex((t) => t.id === threadId);
  if (idx < 0) return null;
  const thread = board.threads[idx];
  thread.posts = (thread.posts || []).filter((p) => p.id !== postId);
  board.threads[idx] = thread;
  writeBoard(board);
  return getDevThread(threadId);
}

export function clearDevClassMessages() {
  if (!canUseDevBoard()) return [];
  writeBoard(emptyBoard());
  return listDevThreads();
}

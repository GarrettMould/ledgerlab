import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createClassThread,
  deleteClassThread,
  deleteClassThreadPost,
  ensureStarterThreads,
  getClassThread,
  replyClassThread,
  subscribeClassThreads,
  subscribeThreadPosts,
} from "./classStore";
import {
  createDevThread,
  deleteDevPost,
  deleteDevThread,
  getDevThread,
  listDevThreads,
  replyDevThread,
  shouldUseDevMessageBoard,
  subscribeDevThreads,
} from "./messageBoardDev";

function formatWhen(iso) {
  if (!iso) return "Just now";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Just now";
  const diff = Date.now() - t;
  if (diff < 45_000) return "Just now";
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m`;
  if (diff < 86_400_000) return `${Math.max(1, Math.round(diff / 3_600_000))}h`;
  try {
    return new Date(t).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function formatChatTime(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  try {
    return new Date(t).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function initialsFromName(name) {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function isOwnMessage(message, authorId, authorName) {
  if (authorId != null && message?.authorId != null) {
    return String(message.authorId) === String(authorId);
  }
  return (
    String(message?.authorName || "").trim().toLowerCase() ===
    String(authorName || "").trim().toLowerCase()
  );
}

/**
 * Threaded class chat — conversation list + message bubbles.
 */
export default function ClassMessageBoard({
  classId,
  authorName,
  authorId = null,
  authorRole = "student",
  onBack = null,
  compact = false,
}) {
  const useDevBoard = shouldUseDevMessageBoard();
  const [view, setView] = useState("list"); // list | thread
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [threads, setThreads] = useState(() =>
    useDevBoard ? listDevThreads() : []
  );
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [activeThread, setActiveThread] = useState(null);
  const [posts, setPosts] = useState([]);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!useDevBoard);
  const messagesEndRef = useRef(null);
  const replyInputRef = useRef(null);

  useEffect(() => {
    setError("");
    if (useDevBoard) {
      setLoading(false);
      setThreads(listDevThreads());
      return subscribeDevThreads(setThreads);
    }
    if (!classId) {
      setThreads([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    ensureStarterThreads(classId).catch(() => {});
    const unsub = subscribeClassThreads(
      classId,
      (rows) => {
        if (!cancelled) {
          setThreads(rows);
          setLoading(false);
        }
      },
      (err) => {
        if (!cancelled) {
          setError(err?.message || "Could not load chats.");
          setLoading(false);
        }
      }
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [classId, useDevBoard]);

  useEffect(() => {
    if (view !== "thread" || !activeThreadId) {
      setPosts([]);
      setActiveThread(null);
      return undefined;
    }
    setError("");
    if (useDevBoard) {
      const thread = getDevThread(activeThreadId);
      setActiveThread(thread);
      setPosts(thread?.posts || []);
      return undefined;
    }
    if (!classId) return undefined;
    let cancelled = false;
    getClassThread(classId, activeThreadId)
      .then((thread) => {
        if (!cancelled) setActiveThread(thread);
      })
      .catch(() => {
        if (!cancelled) setActiveThread(null);
      });
    const unsub = subscribeThreadPosts(
      classId,
      activeThreadId,
      (rows) => {
        if (!cancelled) setPosts(rows);
      },
      (err) => {
        if (!cancelled) setError(err?.message || "Could not load messages.");
      }
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [view, activeThreadId, classId, useDevBoard, threads]);

  useEffect(() => {
    if (view !== "thread") return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [posts, view]);

  useEffect(() => {
    if (view === "thread") {
      replyInputRef.current?.focus();
    }
  }, [view, activeThreadId]);

  function openThread(threadId) {
    setActiveThreadId(threadId);
    setDraft("");
    setError("");
    setView("thread");
  }

  function openCreate() {
    setTitle("");
    setDraft("");
    setError("");
    setShowCreateModal(true);
  }

  function closeCreateModal() {
    setShowCreateModal(false);
    setTitle("");
    setDraft("");
    setError("");
    backToList();
  }

  useEffect(() => {
    if (!showCreateModal) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") closeCreateModal();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [showCreateModal]);

  function backToList() {
    setView("list");
    setActiveThreadId(null);
    setActiveThread(null);
    setPosts([]);
    setDraft("");
    setTitle("");
    setError("");
  }

  async function handleCreateThread(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let id = null;
      if (useDevBoard) {
        id = await createDevThread({
          title,
          body: draft,
          authorName,
          authorId,
          authorRole,
        });
        setThreads(listDevThreads());
      } else {
        id = await createClassThread(classId, {
          title,
          body: draft,
          authorName,
          authorId,
          authorRole,
        });
      }
      setShowCreateModal(false);
      setTitle("");
      setDraft("");
      if (id) openThread(id);
      else backToList();
    } catch (err) {
      setError(err.message || "Could not start chat.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReply(e) {
    e?.preventDefault?.();
    if (busy || !activeThreadId || !draft.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (useDevBoard) {
        const thread = await replyDevThread(activeThreadId, {
          body: draft,
          authorName,
          authorId,
          authorRole,
        });
        setActiveThread(thread);
        setPosts(thread?.posts || []);
        setThreads(listDevThreads());
      } else {
        await replyClassThread(classId, activeThreadId, {
          body: draft,
          authorName,
          authorId,
          authorRole,
        });
      }
      setDraft("");
    } catch (err) {
      setError(err.message || "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  function onReplyKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleReply(e);
    }
  }

  async function handleDeleteThread() {
    if (!activeThreadId || activeThread?.isStarter) return;
    if (authorRole !== "teacher") return;
    setBusy(true);
    setError("");
    try {
      if (useDevBoard) {
        setThreads(await deleteDevThread(activeThreadId));
      } else {
        await deleteClassThread(classId, activeThreadId);
      }
      backToList();
    } catch (err) {
      setError(err.message || "Could not delete chat.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePost(postId) {
    if (!activeThreadId || !postId) return;
    if (authorRole !== "teacher") return;
    setError("");
    try {
      if (useDevBoard) {
        const thread = await deleteDevPost(activeThreadId, postId);
        setActiveThread(thread);
        setPosts(thread?.posts || []);
        setThreads(listDevThreads());
      } else {
        await deleteClassThreadPost(classId, activeThreadId, postId);
      }
    } catch (err) {
      setError(err.message || "Could not delete message.");
    }
  }

  return (
    <section
      className={[
        "chat-room",
        compact ? "chat-room-compact" : "chat-room-panel",
        view === "thread" ? "is-thread" : "is-list",
      ].join(" ")}
      aria-label="Class chat"
    >
      {view === "list" && (
        <>
          <header className="chat-room-top">
            <div className="chat-room-top-copy">
              {onBack && (
                <button
                  type="button"
                  className="chat-icon-btn"
                  data-click="select"
                  onClick={onBack}
                  aria-label="Back"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <path
                      d="M15.5 4.5 7.5 12l8 7.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
              <div>
                <p className="chat-room-kicker">Classroom</p>
                <h3>Chats</h3>
              </div>
            </div>
            <button
              type="button"
              className="chat-new-btn"
              data-click="confirm"
              onClick={openCreate}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  d="M12 5v14M5 12h14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              </svg>
              New chat
            </button>
          </header>

          {error && !showCreateModal && (
            <p className="chat-room-error">{error}</p>
          )}

          <div className="chat-inbox">
            {loading && <p className="chat-empty">Loading chats…</p>}
            {!loading && threads.length === 0 && (
              <div className="chat-empty-state">
                <p>No chats yet</p>
                <span>Start a thread to talk with your class.</span>
                <button
                  type="button"
                  className="primary-btn"
                  data-click="confirm"
                  onClick={openCreate}
                >
                  Start a chat
                </button>
              </div>
            )}
            <ul className="chat-inbox-list">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="chat-inbox-row"
                    data-click="select"
                    onClick={() => openThread(t.id)}
                  >
                    <span
                      className={`chat-avatar${t.isStarter ? " is-starter" : ""}`}
                      aria-hidden="true"
                    >
                      {t.isStarter ? "#" : initialsFromName(t.authorName || t.title)}
                    </span>
                    <span className="chat-inbox-body">
                      <span className="chat-inbox-top">
                        <strong>
                          {t.title}
                          {t.isStarter ? (
                            <span className="chat-pill">Starter</span>
                          ) : null}
                        </strong>
                        <time>{formatWhen(t.updatedAt || t.createdAt)}</time>
                      </span>
                      <span className="chat-inbox-preview">
                        {t.lastPostPreview || "Say something to get started…"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {view === "thread" && (
        <>
          <header className="chat-thread-top">
            <button
              type="button"
              className="chat-icon-btn"
              data-click="select"
              onClick={backToList}
              aria-label="All chats"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  d="M15.5 4.5 7.5 12l8 7.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="chat-thread-heading">
              <h3>{activeThread?.title || "Chat"}</h3>
              <p>
                {activeThread?.authorName
                  ? `Started by ${activeThread.authorName}`
                  : "Class chat"}
                {activeThread?.isStarter ? " · Starter" : ""}
              </p>
            </div>
            {authorRole === "teacher" &&
              activeThread &&
              !activeThread.isStarter && (
                <button
                  type="button"
                  className="chat-thread-delete"
                  data-click="select"
                  onClick={handleDeleteThread}
                >
                  Delete
                </button>
              )}
          </header>

          {error && <p className="chat-room-error chat-room-error-inline">{error}</p>}

          <div className="chat-messages" role="log" aria-live="polite">
            {posts.length === 0 && (
              <div className="chat-empty-state chat-empty-inline">
                <p>No messages yet</p>
                <span>Be the first to say something.</span>
              </div>
            )}
            {posts.map((m, i) => {
              const mine = isOwnMessage(m, authorId, authorName);
              const prev = posts[i - 1];
              const showName =
                !mine &&
                (!prev ||
                  String(prev.authorName) !== String(m.authorName) ||
                  String(prev.authorId || "") !== String(m.authorId || ""));
              return (
                <div
                  key={m.id}
                  className={`chat-bubble-row${mine ? " is-mine" : " is-theirs"}`}
                >
                  {!mine && (
                    <span
                      className={`chat-avatar chat-avatar-sm${
                        m.authorRole === "teacher" ? " is-teacher" : ""
                      }`}
                      aria-hidden="true"
                    >
                      {initialsFromName(m.authorName)}
                    </span>
                  )}
                  <div className="chat-bubble-stack">
                    {showName && (
                      <span className="chat-bubble-author">
                        {m.authorName}
                        {m.authorRole === "teacher" ? (
                          <span className="chat-pill">Teacher</span>
                        ) : null}
                      </span>
                    )}
                    <div className={`chat-bubble${mine ? " is-mine" : ""}`}>
                      <p>{m.body}</p>
                      <div className="chat-bubble-meta">
                        <time>{formatChatTime(m.createdAt)}</time>
                        {authorRole === "teacher" && (
                          <button
                            type="button"
                            className="chat-bubble-delete"
                            data-click="select"
                            onClick={() => handleDeletePost(m.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <form className="chat-composer" onSubmit={handleReply}>
            <label className="sr-only" htmlFor="chat-reply">
              Message
            </label>
            <textarea
              id="chat-reply"
              ref={replyInputRef}
              value={draft}
              maxLength={400}
              rows={1}
              placeholder="Message…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onReplyKeyDown}
            />
            <button
              type="submit"
              className="chat-send-btn"
              data-click="confirm"
              disabled={busy || !draft.trim()}
              aria-label="Send"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  d="M4.5 19.5 20 12 4.5 4.5 4.5 10.5 14 12 4.5 13.5z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </form>
        </>
      )}

      {showCreateModal &&
        createPortal(
          <div
            className="class-board-create-overlay"
            role="presentation"
            onClick={closeCreateModal}
          >
            <div
              className="class-board-create-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="class-board-create-title"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="class-board-create-kicker">Class chat</p>
              <h3 id="class-board-create-title">New chat</h3>
              <p className="class-board-create-lead">
                Name the thread and send the first message.
              </p>
              {error && <p className="class-board-error">{error}</p>}
              <form
                className="class-board-create-form"
                onSubmit={handleCreateThread}
              >
                <label>
                  Title
                  <input
                    value={title}
                    maxLength={80}
                    placeholder="What’s this about?"
                    onChange={(e) => setTitle(e.target.value)}
                    autoFocus
                    required
                  />
                </label>
                <label>
                  First message
                  <textarea
                    value={draft}
                    maxLength={400}
                    rows={4}
                    placeholder="Say hello…"
                    onChange={(e) => setDraft(e.target.value)}
                    required
                  />
                </label>
                <p className="class-board-create-count">
                  {title.length}/80 · {draft.length}/400
                </p>
                <button
                  type="submit"
                  className="primary-btn class-board-create-submit"
                  data-click="confirm"
                  disabled={busy || !title.trim() || !draft.trim()}
                >
                  {busy ? "Starting…" : "Start chat"}
                </button>
                <button
                  type="button"
                  className="class-board-create-cancel"
                  data-click="select"
                  onClick={closeCreateModal}
                >
                  Cancel
                </button>
              </form>
            </div>
          </div>,
          document.body
        )}
    </section>
  );
}

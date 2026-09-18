import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createBugReport, createStockRequest } from "./classStore";

const TAB_KEY = "ledgerlab.stockSuggestTabOpen";

/**
 * Left-edge page tab: Suggest a Stock + Report a Bug.
 * Collapses to a slim caret tab; expands to show both actions.
 */
export default function StockRequestForm({
  classId,
  className = "",
  studentId = "",
  studentName = "",
}) {
  const [tabOpen, setTabOpen] = useState(() => {
    try {
      const raw = sessionStorage.getItem(TAB_KEY);
      if (raw === "0") return false;
      if (raw === "1") return true;
    } catch {
      /* ignore */
    }
    return true;
  });
  const [modalKind, setModalKind] = useState(null); // "stock" | "bug" | null
  const [succeeded, setSucceeded] = useState(false);
  const [sentQuery, setSentQuery] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const titleId = useId();

  const modalOpen = Boolean(modalKind);

  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_KEY, tabOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [tabOpen]);

  useEffect(() => {
    if (!modalOpen) return undefined;
    const t =
      !succeeded
        ? window.setTimeout(() => inputRef.current?.focus?.(), 40)
        : null;
    const onKey = (e) => {
      if (busy) return;
      if (e.key === "Escape" || (succeeded && e.key === "Enter")) closeModal();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const autoClose = succeeded
      ? window.setTimeout(closeModal, 3200)
      : null;
    return () => {
      if (t != null) window.clearTimeout(t);
      if (autoClose != null) window.clearTimeout(autoClose);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [modalOpen, busy, succeeded]);

  if (!classId) return null;

  function closeModal() {
    setModalKind(null);
    setSucceeded(false);
    setSentQuery("");
    setQuery("");
    setError("");
  }

  function openModal(kind) {
    setModalKind(kind);
    setSucceeded(false);
    setSentQuery("");
    setQuery("");
    setError("");
  }

  function toggleTab() {
    setTabOpen((v) => !v);
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    const text = query.trim();
    if (!text || busy || !modalKind) return;
    setBusy(true);
    setError("");
    try {
      if (modalKind === "bug") {
        await createBugReport(classId, {
          message: text,
          studentId: studentId || null,
          studentName,
          className,
        });
      } else {
        await createStockRequest(classId, {
          query: text,
          studentId: studentId || null,
          studentName,
          className,
        });
      }
      setSentQuery(text);
      setQuery("");
      setSucceeded(true);
    } catch (err) {
      setError(err.message || "Could not send");
    } finally {
      setBusy(false);
    }
  }

  const isBug = modalKind === "bug";
  const successDetail = succeeded
    ? isBug
      ? sentQuery
        ? `Reported: “${sentQuery.length > 72 ? `${sentQuery.slice(0, 72)}…` : sentQuery}”`
        : "Bug report sent to your teacher."
      : sentQuery
        ? `Suggested “${sentQuery}” to your teacher.`
        : "Sent to your teacher."
    : "";

  const modal =
    modalOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="stock-suggest-overlay"
            role="presentation"
            onClick={() => {
              if (!busy) closeModal();
            }}
          >
            <div
              className={
                succeeded
                  ? "stock-suggest-modal stock-suggest-modal--success"
                  : "stock-suggest-modal"
              }
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              onClick={(e) => e.stopPropagation()}
            >
              {succeeded ? (
                <>
                  <div className="trade-success-badge" aria-hidden="true">
                    <svg viewBox="0 0 64 64" width="64" height="64">
                      <circle
                        className="trade-success-disc"
                        cx="32"
                        cy="32"
                        r="30"
                      />
                      <path
                        className="trade-success-check"
                        d="M18.5 33.2 27.2 41.5 45.5 22.5"
                        fill="none"
                        stroke="#fff"
                        strokeWidth="4.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <h2 id={titleId} className="stock-suggest-success-title">
                    Success!
                  </h2>
                  <p className="trade-success-detail">{successDetail}</p>
                  <button
                    type="button"
                    className="primary-btn trade-success-btn"
                    data-click="confirm"
                    onClick={closeModal}
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="stock-suggest-close"
                    data-click="select"
                    aria-label="Close"
                    disabled={busy}
                    onClick={closeModal}
                  >
                    ×
                  </button>
                  <p className="stock-suggest-kicker">
                    {isBug ? "Feedback" : "Class market"}
                  </p>
                  <h2 id={titleId} className="stock-suggest-title">
                    {isBug ? "Report a bug" : "Suggest a stock"}
                  </h2>
                  <p className="stock-suggest-sub">
                    {isBug
                      ? "Tell your teacher what went wrong — they’ll see it on the dashboard."
                      : "Tell your teacher a ticker or company you’d like added to the classroom list."}
                  </p>
                  <form
                    className="stock-suggest-modal-form"
                    onSubmit={handleSubmit}
                  >
                    <label
                      className="stock-suggest-field-label"
                      htmlFor="stock-suggest-input"
                    >
                      {isBug ? "What’s the issue?" : "Symbol or company name"}
                    </label>
                    {isBug ? (
                      <textarea
                        id="stock-suggest-input"
                        ref={inputRef}
                        value={query}
                        maxLength={400}
                        rows={4}
                        placeholder="e.g. Industrials prices won’t load when I refresh"
                        autoComplete="off"
                        disabled={busy}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    ) : (
                      <input
                        id="stock-suggest-input"
                        ref={inputRef}
                        type="text"
                        value={query}
                        maxLength={80}
                        placeholder="e.g. NVDA or Nvidia"
                        autoComplete="off"
                        disabled={busy}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    )}
                    {error ? (
                      <p className="stock-suggest-modal-error">{error}</p>
                    ) : null}
                    <button
                      type="submit"
                      className="stock-suggest-submit"
                      data-click="confirm"
                      disabled={
                        busy ||
                        !query.trim() ||
                        (isBug && query.trim().length < 3)
                      }
                    >
                      {busy
                        ? "Sending…"
                        : isBug
                          ? "Send report"
                          : "Send suggestion"}
                    </button>
                    <button
                      type="button"
                      className="stock-suggest-cancel"
                      data-click="select"
                      disabled={busy}
                      onClick={closeModal}
                    >
                      Cancel
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <aside
        className={
          tabOpen
            ? "stock-suggest-tab is-expanded"
            : "stock-suggest-tab is-collapsed"
        }
        aria-label="Student feedback"
      >
        <div className="stock-suggest-tab-sheet">
          <div className="stock-suggest-tab-body">
            <button
              type="button"
              className="stock-suggest-toggle"
              data-click="select"
              onClick={() => openModal("stock")}
            >
              <span className="stock-suggest-orb" aria-hidden="true">
                +
              </span>
              <span className="stock-suggest-caption">Suggest a Stock</span>
            </button>
            <button
              type="button"
              className="stock-suggest-toggle stock-suggest-toggle--bug"
              data-click="select"
              onClick={() => openModal("bug")}
            >
              <span
                className="stock-suggest-orb stock-suggest-orb--bug"
                aria-hidden="true"
              >
                !
              </span>
              <span className="stock-suggest-caption">Report a Bug</span>
            </button>
          </div>
          <button
            type="button"
            className="stock-suggest-carets"
            data-click="select"
            aria-expanded={tabOpen}
            aria-label={
              tabOpen ? "Hide feedback tab" : "Show feedback tab"
            }
            onClick={toggleTab}
          >
            <span aria-hidden="true">{tabOpen ? "‹‹" : "››"}</span>
          </button>
        </div>
      </aside>
      {modal}
    </>
  );
}

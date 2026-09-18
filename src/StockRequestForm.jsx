import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createStockRequest } from "./classStore";

const TAB_KEY = "ledgerlab.stockSuggestTabOpen";

/**
 * Left-edge page tab for “Suggest a Stock” + PayPal-style request modal.
 * Collapses to a slim caret tab; expands to show the + / label.
 * On success, the modal swaps to the same green-check confirmation as trades.
 */
export default function StockRequestForm({
  classId,
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
  const [modalOpen, setModalOpen] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [sentQuery, setSentQuery] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const titleId = useId();

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
    setModalOpen(false);
    setSucceeded(false);
    setSentQuery("");
    setQuery("");
    setError("");
  }

  function openModal() {
    setModalOpen(true);
    setSucceeded(false);
    setSentQuery("");
    setError("");
  }

  function toggleTab() {
    setTabOpen((v) => !v);
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    const text = query.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      await createStockRequest(classId, {
        query: text,
        studentId: studentId || null,
        studentName,
      });
      setSentQuery(text);
      setQuery("");
      setSucceeded(true);
    } catch (err) {
      setError(err.message || "Could not send request");
    } finally {
      setBusy(false);
    }
  }

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
                  <p className="trade-success-detail">
                    {sentQuery
                      ? `Suggested “${sentQuery}” to your teacher.`
                      : "Sent to your teacher."}
                  </p>
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
                  <p className="stock-suggest-kicker">Class market</p>
                  <h2 id={titleId} className="stock-suggest-title">
                    Suggest a stock
                  </h2>
                  <p className="stock-suggest-sub">
                    Tell your teacher a ticker or company you’d like added to the
                    classroom list.
                  </p>
                  <form
                    className="stock-suggest-modal-form"
                    onSubmit={handleSubmit}
                  >
                    <label
                      className="stock-suggest-field-label"
                      htmlFor="stock-suggest-input"
                    >
                      Symbol or company name
                    </label>
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
                    {error ? (
                      <p className="stock-suggest-modal-error">{error}</p>
                    ) : null}
                    <button
                      type="submit"
                      className="stock-suggest-submit"
                      data-click="confirm"
                      disabled={busy || !query.trim()}
                    >
                      {busy ? "Sending…" : "Send suggestion"}
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
        aria-label="Suggest a stock"
      >
        <div className="stock-suggest-tab-sheet">
          <div className="stock-suggest-tab-body">
            <button
              type="button"
              className="stock-suggest-toggle"
              data-click="select"
              onClick={openModal}
            >
              <span className="stock-suggest-orb" aria-hidden="true">
                +
              </span>
              <span className="stock-suggest-caption">Suggest a Stock</span>
            </button>
          </div>
          <button
            type="button"
            className="stock-suggest-carets"
            data-click="select"
            aria-expanded={tabOpen}
            aria-label={tabOpen ? "Hide suggest a stock" : "Show suggest a stock"}
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

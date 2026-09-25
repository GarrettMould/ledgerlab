import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { sellLoan } from "./api";
import { LENDING_SALE_DISCOUNT_PER_MISS_PCT } from "./data/worldLending";

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * PayPal-style confirmation before selling a country loan early: shows the
 * market price, the loss versus what was lent, and the net after interest.
 */
export default function LoanSellModal({ loan, studentId, classId, onClose, onSold }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setBusy(false);
    setError("");
  }, [loan?.id]);

  useEffect(() => {
    if (!loan) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [loan, busy, onClose]);

  if (!loan) return null;

  const principal = Number(loan.principal) || 0;
  const price = Number(loan.salePrice) || 0;
  const loss = Math.max(0, principal - price);
  const earned = Number(loan.interestEarned) || 0;
  const net = earned - loss;
  const missed = Number(loan.missedCount) || 0;
  const blocked = Boolean(loan.pending);

  async function confirm() {
    if (busy || blocked) return;
    setBusy(true);
    setError("");
    try {
      const data = await sellLoan(studentId, loan.id, loan.salePrice, classId);
      onSold?.(data, loan);
    } catch (err) {
      setError(err.message || "Could not sell this loan");
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="transfer-overlay loan-sell-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loan-sell-title"
      onClick={() => !busy && onClose?.()}
    >
      <div
        className={`transfer-modal loan-sell-modal${loss > 0 ? " is-debit" : " is-credit"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="transfer-kicker">Sell loan early</p>
        <h3 id="loan-sell-title">Sell your {loan.countryName} loan?</h3>
        <p className="transfer-amount">{money(price)}</p>
        <p className="transfer-note">
          A buyer will pay {money(price)} for the {money(principal)} you lent{" "}
          {loan.countryName}
          {loss > 0
            ? ` — less than face value because of its ${Number(loan.defaultPct).toFixed(
                1
              )}% monthly default risk${
                missed > 0
                  ? ` and ${missed} missed payment${missed === 1 ? "" : "s"} (−${LENDING_SALE_DISCOUNT_PER_MISS_PCT}% each)`
                  : ""
              }.`
            : "."}
        </p>

        <dl className="loan-sell-breakdown">
          <div>
            <dt>You lent</dt>
            <dd>{money(principal)}</dd>
          </div>
          <div>
            <dt>Sale price</dt>
            <dd>{money(price)}</dd>
          </div>
          <div className="is-loss">
            <dt>Loss on the loan</dt>
            <dd>{loss > 0 ? `−${money(loss)}` : money(0)}</dd>
          </div>
          <div>
            <dt>Interest you already collected</dt>
            <dd className="is-gain">+{money(earned)}</dd>
          </div>
          <div className="is-total">
            <dt>Overall result</dt>
            <dd className={net >= 0 ? "is-gain" : "is-loss"}>
              {net >= 0 ? "+" : "−"}
              {money(Math.abs(net))}
            </dd>
          </div>
        </dl>

        {blocked && (
          <p className="transfer-error">
            A payment is waiting on this loan — spin for it first, then you can sell.
          </p>
        )}
        {error && <p className="transfer-error">{error}</p>}

        <button
          type="button"
          className="primary-btn transfer-accept"
          data-click="confirm"
          disabled={busy || blocked}
          onClick={confirm}
        >
          {busy ? "Selling…" : `Sell for ${money(price)}`}
        </button>
        <button
          type="button"
          className="ghost-btn loan-sell-cancel"
          data-click="select"
          disabled={busy}
          onClick={onClose}
        >
          Keep my loan
        </button>
      </div>
    </div>,
    document.body
  );
}

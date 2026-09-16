import { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

function money(n, digits = 2) {
  return Number(n || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });
}

function describeTrade(trade) {
  if (!trade) return "";
  const name = trade.name || trade.ticker;
  const qty = Number(trade.qty);
  const isBuy = trade.action !== "sell";

  if (trade.assetType === "realestate" || String(trade.ticker || "").startsWith("FL-")) {
    return isBuy ? `Home purchased in ${name}` : `Home sold in ${name}`;
  }
  if (trade.assetType === "bond" && Number.isFinite(trade.faceUsd)) {
    return isBuy
      ? `${money(trade.faceUsd, 0)} face of ${name}`
      : `Sold ${money(trade.faceUsd, 0)} face of ${name}`;
  }
  if (trade.assetType === "currency") {
    const q = Number.isFinite(qty) ? qty.toFixed(qty >= 10 ? 2 : 4) : null;
    return isBuy
      ? q
        ? `Bought ${q} ${trade.ticker}`
        : `Bought ${trade.ticker}`
      : q
        ? `Sold ${q} ${trade.ticker}`
        : `Sold ${trade.ticker}`;
  }
  if (Number.isFinite(qty) && qty > 0) {
    const sharesLabel = qty === 1 ? "1 share" : `${qty} shares`;
    return isBuy
      ? `Bought ${sharesLabel} of ${trade.ticker}`
      : `Sold ${sharesLabel} of ${trade.ticker}`;
  }
  return isBuy ? `Purchased ${name}` : `Sold ${name}`;
}

/**
 * PayPal-style success confirmation after a completed trade.
 * trade: { action, ticker, name?, qty?, assetType?, faceUsd?, total?, fillPrice?, approximateFill?, fillLocked? }
 */
export default function TradeSuccessModal({ trade, onClose }) {
  const close = useCallback(() => onClose?.(), [onClose]);

  useEffect(() => {
    if (!trade) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter") close();
    };
    document.addEventListener("keydown", onKey);
    const linger = trade.fillLocked || trade.approximateFill ? 4800 : 3200;
    const timer = window.setTimeout(close, linger);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [trade, close]);

  if (!trade) return null;

  const isBuy = trade.action !== "sell";
  const detail = describeTrade(trade);
  const total =
    trade.total != null && Number.isFinite(Number(trade.total))
      ? money(trade.total)
      : null;
  const fillPrice =
    trade.fillPrice != null && Number.isFinite(Number(trade.fillPrice))
      ? money(trade.fillPrice)
      : null;

  const modal = (
    <div className="trade-success-overlay" role="presentation" onClick={close}>
      <div
        className="trade-success-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-success-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="trade-success-badge" aria-hidden="true">
          <svg viewBox="0 0 64 64" width="64" height="64">
            <circle className="trade-success-disc" cx="32" cy="32" r="30" />
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

        <h3 id="trade-success-title">{isBuy ? "Success!" : "Sold!"}</h3>
        <p className="trade-success-detail">{detail}</p>
        {total && <p className="trade-success-amount">{total}</p>}
        {isBuy && trade.fillLocked && (
          <p className="trade-success-fill-note">
            {trade.approximateFill
              ? `Filled at approximate classroom price${
                  fillPrice ? ` (${fillPrice})` : ""
                }. This cost basis is locked — it won’t be rewritten if a live futures quote returns later.`
              : `Filled at the classroom price shown${
                  fillPrice ? ` (${fillPrice})` : ""
                }. This cost basis is locked in historically.`}
          </p>
        )}

        <button
          type="button"
          className="primary-btn trade-success-btn"
          data-click="confirm"
          onClick={close}
        >
          Done
        </button>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

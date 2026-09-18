import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { buyShares, getQuote } from "./api";

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/**
 * PayPal-style buy modal for classroom stocks.
 * On a successful buy it closes itself and lets the parent show TradeSuccessModal.
 */
export default function StockBuyModal({
  target,
  classId = "",
  studentId = "",
  cash = 0,
  onClose = null,
  onBought = null,
}) {
  const [qty, setQty] = useState(1);
  const [buyBusy, setBuyBusy] = useState(false);
  const [buyError, setBuyError] = useState("");
  const [livePrice, setLivePrice] = useState(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!target?.ticker) {
      setLivePrice(null);
      setQuoteBusy(false);
      return undefined;
    }
    setQty(1);
    setBuyError("");
    setBuyBusy(false);

    const seeded = Number(target.price);
    if (seeded > 0) {
      setLivePrice(seeded);
      setQuoteBusy(false);
      return undefined;
    }

    let cancelled = false;
    setLivePrice(null);
    setQuoteBusy(true);
    getQuote(target.ticker)
      .then((data) => {
        if (cancelled) return;
        const p = data?.price != null ? Number(data.price) : null;
        setLivePrice(p > 0 ? p : null);
        if (!(p > 0)) {
          setBuyError("Couldn’t load a live price right now. Try again.");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLivePrice(null);
        setBuyError(err.message || "Couldn’t load a live price right now.");
      })
      .finally(() => {
        if (!cancelled) setQuoteBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [target?.ticker, target?.price]);

  useEffect(() => {
    if (!target) return undefined;
    const onKey = (e) => {
      if (buyBusy) return;
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [target, buyBusy]);

  function close() {
    setBuyError("");
    setQty(1);
    setBuyBusy(false);
    setLivePrice(null);
    setQuoteBusy(false);
    onClose?.();
  }

  async function handleBuy(e) {
    e?.preventDefault?.();
    if (!target || !studentId || buyBusy || quoteBusy) return;
    const shares = Math.max(1, Math.round(Number(qty)) || 1);
    const price = Number(livePrice);
    if (!(price > 0)) {
      setBuyError("Wait for a live price before buying.");
      return;
    }
    const cost = price * shares;
    if (cost > Number(cash || 0) + 1e-6) {
      setBuyError("Not enough cash for that many shares.");
      return;
    }
    setBuyBusy(true);
    setBuyError("");
    try {
      const data = await buyShares(studentId, target.ticker, shares, classId);
      const trade = {
        action: "buy",
        ticker: target.ticker,
        name: target.name || target.ticker,
        qty: shares,
        total: cost,
        fillPrice: price,
        assetType: target.asset_type || "equity",
      };
      // Close buy modal first, then hand off to the app’s single success modal.
      onClose?.();
      onBought?.(data, trade);
    } catch (err) {
      setBuyError(err.message || "Could not complete buy");
      setBuyBusy(false);
    }
  }

  if (!target || typeof document === "undefined") return null;

  const price = Number(livePrice);
  const shares = Math.max(1, Math.round(Number(qty)) || 1);
  const estCost = price > 0 ? price * shares : null;
  const canAfford =
    estCost == null || estCost <= Number(cash || 0) + 1e-6;
  const priceLabel = quoteBusy
    ? " · loading price…"
    : price > 0
      ? ` · ${money(price)}`
      : " · price pending";

  return createPortal(
    <div
      className="stock-suggest-overlay"
      role="presentation"
      onClick={() => {
        if (!buyBusy) close();
      }}
    >
      <div
        className="stock-suggest-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="stock-suggest-close"
          data-click="select"
          aria-label="Close"
          disabled={buyBusy}
          onClick={close}
        >
          ×
        </button>
        <p className="stock-suggest-kicker">Buy shares</p>
        <h2 id={titleId} className="stock-suggest-title">
          {target.ticker}
        </h2>
        <p className="stock-suggest-sub">
          {target.name}
          {priceLabel}
        </p>
        <form
          className="stock-suggest-modal-form stock-buy-modal-form"
          onSubmit={handleBuy}
        >
          <label className="stock-suggest-field-label" htmlFor="stock-buy-qty">
            Shares
          </label>
          <div className="stock-buy-qty-row">
            <button
              type="button"
              className="stock-buy-step"
              data-click="select"
              disabled={buyBusy || shares <= 1}
              onClick={() => setQty(Math.max(1, shares - 1))}
              aria-label="Fewer shares"
            >
              −
            </button>
            <input
              id="stock-buy-qty"
              type="number"
              min={1}
              step={1}
              value={shares}
              disabled={buyBusy}
              onChange={(e) =>
                setQty(Math.max(1, Math.round(Number(e.target.value)) || 1))
              }
            />
            <button
              type="button"
              className="stock-buy-step"
              data-click="select"
              disabled={buyBusy}
              onClick={() => setQty(shares + 1)}
              aria-label="More shares"
            >
              +
            </button>
          </div>
          <p className="stock-buy-est">
            Est. cost{" "}
            <strong>
              {quoteBusy ? "…" : estCost != null ? money(estCost) : "—"}
            </strong>
            <span> · Cash {money(cash)}</span>
          </p>
          {buyError ? (
            <p className="stock-suggest-modal-error">{buyError}</p>
          ) : null}
          <button
            type="submit"
            className="stock-suggest-submit"
            data-click="confirm"
            disabled={buyBusy || quoteBusy || !(price > 0) || !canAfford}
          >
            {buyBusy ? "Buying…" : quoteBusy ? "Loading price…" : "Buy now"}
          </button>
          <button
            type="button"
            className="stock-suggest-cancel"
            data-click="select"
            disabled={buyBusy}
            onClick={close}
          >
            Cancel
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}

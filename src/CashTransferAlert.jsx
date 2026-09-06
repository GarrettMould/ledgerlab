import { useEffect, useMemo, useState } from "react";
import { adjustCash, getStudent, sellShares } from "./api";
import {
  markTransferAccepted,
  subscribePendingTransfers,
  updateClassStudent,
} from "./classStore";

function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function holdingLabel(h) {
  if (h.name) return h.name;
  return h.ticker;
}

function liquidCashFromHolding(h) {
  if (h.asset_type === "realestate") {
    const equity = h.equity != null ? Number(h.equity) : null;
    if (equity != null) return Math.max(0, equity);
    const mv = Number(h.market_value) || 0;
    const mort = Number(h.mortgage_balance) || 0;
    return Math.max(0, mv - mort);
  }
  return Number(h.market_value) || 0;
}

/** Shares (or units) to sell to raise at least `need` cash, capped at position size. */
function sharesToCover(h, need) {
  const owned = Number(h.shares) || 0;
  if (owned <= 0) return 0;
  if (h.asset_type === "realestate") return owned;

  const price = Number(h.price) || 0;
  if (price <= 0) return owned;
  if (need <= 0) return 0;

  const raw = need / price;
  const rounded = Math.ceil(raw * 10000) / 10000;
  return Math.min(owned, rounded);
}

/**
 * PayPal-style cash alerts: teacher-queued credits/debits wait in Firestore
 * until the student accepts. Cash in SQLite only moves on accept.
 * Debits with a shortfall require liquidating a holding in this same modal.
 */
export default function CashTransferAlert({
  classId,
  firestoreStudentId,
  apiStudentId,
  onAccepted,
}) {
  const [queue, setQueue] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedTicker, setSelectedTicker] = useState(null);

  useEffect(() => {
    return subscribePendingTransfers(classId, firestoreStudentId, setQueue);
  }, [classId, firestoreStudentId]);

  const current = queue[0] || null;
  const isCredit = current
    ? current.direction === "credit" || current.amount > 0
    : false;
  const abs = current
    ? Number(current.absAmount ?? Math.abs(current.amount)) || 0
    : 0;
  const cash = portfolio ? Number(portfolio.cash) || 0 : null;
  const shortfall =
    current && !isCredit && cash != null && cash < abs ? abs - cash : 0;
  const needsLiquidate = shortfall > 0.005;

  const holdings = useMemo(() => {
    const rows = portfolio?.holdings || [];
    return [...rows]
      .filter((h) => liquidCashFromHolding(h) > 0.01)
      .sort((a, b) => liquidCashFromHolding(b) - liquidCashFromHolding(a));
  }, [portfolio]);

  const selected = holdings.find((h) => h.ticker === selectedTicker) || null;
  const sellQty = selected ? sharesToCover(selected, shortfall) : 0;
  const sellProceedsEstimate = selected
    ? selected.asset_type === "realestate"
      ? liquidCashFromHolding(selected)
      : (Number(selected.price) || 0) * sellQty
    : 0;

  async function loadPortfolio() {
    if (!apiStudentId) return null;
    const s = await getStudent(apiStudentId);
    setPortfolio(s);
    setCashSafeSelection(s);
    return s;
  }

  function setCashSafeSelection(s) {
    const rows = s?.holdings || [];
    const sellable = rows.filter((h) => liquidCashFromHolding(h) > 0.01);
    setSelectedTicker((prev) => {
      if (prev && sellable.some((h) => h.ticker === prev)) return prev;
      return sellable[0]?.ticker || null;
    });
  }

  useEffect(() => {
    if (!apiStudentId || queue.length === 0) {
      setPortfolio(null);
      setSelectedTicker(null);
      setError("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const s = await getStudent(apiStudentId);
        if (cancelled) return;
        setPortfolio(s);
        setCashSafeSelection(s);
        setError("");
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not load account");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiStudentId, queue.length, queue[0]?.id]);

  async function liquidateSelected() {
    if (!apiStudentId || !selected || !current || busy || sellQty <= 0) return;
    setBusy(true);
    setError("");
    try {
      const afterSell = await sellShares(apiStudentId, selected.ticker, sellQty);
      setPortfolio(afterSell);
      setCashSafeSelection(afterSell);
      await updateClassStudent(classId, firestoreStudentId, {
        cash: afterSell.cash,
        holdingsCount: afterSell.holdings_count || 0,
      });

      const liveCash = Number(afterSell.cash) || 0;
      if (liveCash >= abs - 0.005) {
        const updated = await adjustCash(apiStudentId, current.amount);
        await markTransferAccepted(classId, firestoreStudentId, current.id);
        await updateClassStudent(classId, firestoreStudentId, {
          cash: updated.cash,
          holdingsCount: updated.holdings_count || 0,
        });
        setPortfolio((prev) =>
          prev ? { ...prev, ...updated, holdings: updated.holdings || prev.holdings } : updated
        );
        onAccepted?.(updated);
      } else {
        onAccepted?.(afterSell);
      }
    } catch (err) {
      setError(err.message || "Could not sell that holding");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!apiStudentId || !current || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!isCredit) {
        const live = await loadPortfolio();
        const liveCash = Number(live?.cash) || 0;
        if (liveCash < abs - 0.005) {
          setError(
            `Still short. Sell another holding to cover ${money(abs - liveCash)}.`
          );
          setBusy(false);
          return;
        }
      }

      const updated = await adjustCash(apiStudentId, current.amount);
      await markTransferAccepted(classId, firestoreStudentId, current.id);
      await updateClassStudent(classId, firestoreStudentId, {
        cash: updated.cash,
        holdingsCount: updated.holdings_count || 0,
      });
      setPortfolio((prev) =>
        prev ? { ...prev, ...updated, holdings: prev.holdings } : updated
      );
      onAccepted?.(updated);
    } catch (err) {
      setError(err.message || "Could not complete this transfer");
    } finally {
      setBusy(false);
    }
  }

  if (!current) return null;

  return (
    <div
      className="transfer-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-title"
    >
      <div
        className={`transfer-modal ${isCredit ? "is-credit" : "is-debit"}${
          needsLiquidate ? " is-liquidate" : ""
        }`}
      >
        <p className="transfer-kicker">
          {isCredit ? "Money received" : needsLiquidate ? "Payment due — sell to pay" : "Payment due"}
        </p>
        <h3 id="transfer-title">
          {isCredit
            ? "Accept payment"
            : needsLiquidate
              ? "Not enough cash"
              : "Pay your teacher"}
        </h3>
        <p className="transfer-amount">
          {isCredit ? "+" : "−"}
          {money(abs)}
        </p>
        <p className="transfer-note">{current.note}</p>
        {cash != null && (
          <p className="transfer-cash">
            Your cash: {money(cash)}
            {needsLiquidate ? ` · short ${money(shortfall)}` : ""}
          </p>
        )}
        {queue.length > 1 && (
          <p className="transfer-queue">
            {queue.length - 1} more waiting after this
          </p>
        )}

        {needsLiquidate && (
          <div className="transfer-liquidate">
            <p className="transfer-liquidate-lead">
              Choose a holding to sell. We’ll sell only what’s needed to cover
              the shortfall (homes sell in full).
            </p>
            {holdings.length === 0 ? (
              <p className="transfer-error">
                You don’t have holdings to sell. Ask your teacher to cancel or
                lower this charge.
              </p>
            ) : (
              <ul className="transfer-holdings">
                {holdings.map((h) => {
                  const value = liquidCashFromHolding(h);
                  const active = h.ticker === selectedTicker;
                  return (
                    <li key={h.ticker}>
                      <button
                        type="button"
                        className={`transfer-holding${active ? " is-selected" : ""}`}
                        data-click="select"
                        disabled={busy}
                        onClick={() => setSelectedTicker(h.ticker)}
                      >
                        <span className="transfer-holding-main">
                          <strong>{holdingLabel(h)}</strong>
                          <span>{h.ticker}</span>
                        </span>
                        <span className="transfer-holding-val">{money(value)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {selected && sellQty > 0 && (
              <p className="transfer-sell-plan">
                Sell{" "}
                {selected.asset_type === "realestate"
                  ? "home"
                  : `${sellQty} ${sellQty === 1 ? "unit" : "units"}`}{" "}
                of {holdingLabel(selected)} ≈ {money(sellProceedsEstimate)} cash
              </p>
            )}
            {holdings.length > 0 && (
              <button
                type="button"
                className="primary-btn transfer-accept"
                data-click="confirm"
                disabled={busy || !selected || sellQty <= 0}
                onClick={liquidateSelected}
              >
                {busy ? "Selling…" : `Sell enough to pay ${money(abs)}`}
              </button>
            )}
          </div>
        )}

        {error && <p className="transfer-error">{error}</p>}

        {!needsLiquidate && (
          <button
            type="button"
            className="primary-btn transfer-accept"
            data-click="confirm"
            disabled={busy}
            onClick={accept}
          >
            {busy
              ? "Working…"
              : isCredit
                ? `Accept ${money(abs)}`
                : `Pay ${money(abs)}`}
          </button>
        )}
      </div>
    </div>
  );
}

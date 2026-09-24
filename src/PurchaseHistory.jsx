import { useEffect, useMemo, useState } from "react";
import { getStudentTrades } from "./api";

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatShares(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatWhen(iso, ms) {
  const t = ms != null ? Number(ms) : iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function kindLabel(kind) {
  const k = String(kind || "market").toLowerCase();
  if (k === "home") return "Home";
  if (k === "bond") return "Bond";
  return "Market";
}

export default function PurchaseHistory({ studentId, classId, onBack }) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!studentId) {
        setTrades([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const data = await getStudentTrades(studentId, classId, { limit: 150 });
        if (cancelled) return;
        setTrades(Array.isArray(data?.trades) ? data.trades : []);
      } catch (err) {
        if (!cancelled) {
          setTrades([]);
          setError(err.message || "Could not load purchase history");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, classId]);

  const summary = useMemo(() => {
    let buys = 0;
    let sells = 0;
    let spent = 0;
    let received = 0;
    for (const t of trades) {
      const n = Number(t.notional) || 0;
      if (t.side === "sell") {
        sells += 1;
        received += n;
      } else {
        buys += 1;
        spent += n;
      }
    }
    return { buys, sells, spent, received };
  }, [trades]);

  return (
    <div className="purchase-history">
      <div className="market-toolbar">
        <button type="button" className="ghost-btn" data-click="select" onClick={onBack}>
          ← Dashboard
        </button>
        <h3>Purchase history</h3>
      </div>

      <p className="purchase-history-lead">
        Your classroom buy and sell receipts — newest first.
      </p>

      {!loading && !error && trades.length > 0 && (
        <div className="purchase-summary" aria-label="History totals">
          <div>
            <span>Buys</span>
            <strong>{summary.buys}</strong>
          </div>
          <div>
            <span>Sells</span>
            <strong>{summary.sells}</strong>
          </div>
          <div>
            <span>Spent</span>
            <strong>{money(summary.spent)}</strong>
          </div>
          <div>
            <span>Received</span>
            <strong>{money(summary.received)}</strong>
          </div>
        </div>
      )}

      {loading && <p className="empty">Loading receipts…</p>}
      {error && <p className="banner error">{error}</p>}
      {!loading && !error && trades.length === 0 && (
        <p className="empty">
          No purchases yet. Buy stocks, bonds, or a home and your receipts will show up here.
        </p>
      )}

      {!loading && !error && trades.length > 0 && (
        <ul className="purchase-list">
          {trades.map((t, i) => {
            const isSell = t.side === "sell";
            const key = t.id || `${t.ticker}-${t.createdAtMs || i}`;
            return (
              <li key={key} className={isSell ? "purchase-row sell" : "purchase-row buy"}>
                <div className="purchase-row-main">
                  <span className={`purchase-side ${isSell ? "sell" : "buy"}`}>
                    {isSell ? "Sold" : "Bought"}
                  </span>
                  <strong className="purchase-ticker">{t.ticker || "—"}</strong>
                  <span className="purchase-kind">{kindLabel(t.kind)}</span>
                </div>
                <div className="purchase-row-meta">
                  <span>
                    {formatShares(t.shares)}
                    {t.kind === "home" ? " home" : " sh"}
                    {" · "}
                    {money(t.price)}
                  </span>
                  <strong className="purchase-notional">{money(t.notional)}</strong>
                </div>
                <time className="purchase-when" dateTime={t.createdAt || undefined}>
                  {formatWhen(t.createdAt, t.createdAtMs)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

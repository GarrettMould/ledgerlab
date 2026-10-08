import { useEffect, useMemo, useState } from "react";
import { listClassTradeCounts } from "./classStore";

function loginCount(seat) {
  const n = Number(seat?.loginCount);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function storedTradeCount(seat) {
  const n = Number(seat?.tradeCount);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function lastLoginMs(seat) {
  if (typeof seat?.lastLoginAtMs === "number" && seat.lastLoginAtMs > 0) {
    return seat.lastLoginAtMs;
  }
  const ts = seat?.lastLoginAt;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}

function formatLastSeen(ms) {
  if (!ms) return "Never";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "Never";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function tradeCountForSeat(seat, counts) {
  const ids = [seat?.id, seat?.apiStudentId, seat?.firestoreStudentId]
    .filter(Boolean)
    .map(String);
  let n = storedTradeCount(seat);
  for (const id of ids) n = Math.max(n, counts.get(id) || 0);
  return n;
}

export default function ClassUsageStats({ classId, roster = [] }) {
  const [open, setOpen] = useState(false);
  const [tradeCounts, setTradeCounts] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState("logins");

  useEffect(() => {
    if (!open || !classId) return undefined;
    let cancelled = false;
    setLoading(true);
    listClassTradeCounts(classId)
      .then((counts) => {
        if (!cancelled) setTradeCounts(counts);
      })
      .catch(() => {
        if (!cancelled) setTradeCounts(new Map());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, classId]);

  const rows = useMemo(() => {
    const list = (Array.isArray(roster) ? roster : []).map((seat) => ({
      id: seat.id,
      name: seat.name || "Student",
      email: seat.email || "",
      logins: loginCount(seat),
      trades: tradeCountForSeat(seat, tradeCounts),
      lastSeenMs: lastLoginMs(seat),
    }));
    list.sort((a, b) => {
      if (sortBy === "trades") {
        if (b.trades !== a.trades) return b.trades - a.trades;
        if (b.logins !== a.logins) return b.logins - a.logins;
      } else {
        if (b.logins !== a.logins) return b.logins - a.logins;
        if (b.trades !== a.trades) return b.trades - a.trades;
      }
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [roster, tradeCounts, sortBy]);

  const totalLogins = rows.reduce((sum, r) => sum + r.logins, 0);
  const totalTrades = rows.reduce((sum, r) => sum + r.trades, 0);
  const neverLoggedIn = rows.filter((r) => r.logins === 0).length;

  return (
    <section className={`class-usage${open ? " is-open" : ""}`} aria-label="Class usage">
      <button
        type="button"
        className="class-usage-toggle"
        data-click="select"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <p className="closet-kicker">Usage</p>
          <h3>Who’s showing up</h3>
        </div>
        <p className="class-usage-totals">
          {totalLogins} login{totalLogins === 1 ? "" : "s"}
          {open
            ? ` · ${totalTrades} trade${totalTrades === 1 ? "" : "s"}`
            : ""}
          {neverLoggedIn > 0 ? ` · ${neverLoggedIn} never logged in` : ""}
        </p>
        <span className="class-usage-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <>
      <div className="class-usage-filters">
        <div className="class-usage-filter-group" role="group" aria-label="Rank by">
          <span>Rank by</span>
          <button
            type="button"
            className={sortBy === "logins" ? "is-on" : ""}
            data-click="select"
            onClick={() => setSortBy("logins")}
          >
            Logins
          </button>
          <button
            type="button"
            className={sortBy === "trades" ? "is-on" : ""}
            data-click="select"
            onClick={() => setSortBy("trades")}
          >
            Trades
          </button>
        </div>
      </div>

      {roster.length === 0 ? (
        <p className="empty">No one has joined yet.</p>
      ) : loading && tradeCounts.size === 0 ? (
        <p className="empty">Loading trades…</p>
      ) : (
        <ol className="class-usage-list">
          <li className="class-usage-row is-head" aria-hidden="true">
            <span>#</span>
            <span>Student</span>
            <span>Logins</span>
            <span>Trades</span>
            <span>Last login</span>
          </li>
          {rows.map((row, i) => (
            <li key={row.id} className="class-usage-row">
              <span className="class-usage-rank">{i + 1}</span>
              <div className="class-usage-who">
                <strong>{row.name}</strong>
                {row.email ? <span>{row.email}</span> : null}
              </div>
              <span className="class-usage-num">{row.logins}</span>
              <span className="class-usage-num">{row.trades}</span>
              <span className="class-usage-seen">{formatLastSeen(row.lastSeenMs)}</span>
            </li>
          ))}
        </ol>
      )}
        </>
      ) : null}
    </section>
  );
}

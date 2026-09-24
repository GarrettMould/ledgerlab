import { useEffect, useMemo, useState } from "react";

const MAX_CARDS = 5;

function formatPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/**
 * Biggest % gainers and losers for the day across the classroom stock catalog.
 */
export default function BiggestMoversTicker({
  marketItems = [],
  pricesPending = false,
  onPickTicker = null,
}) {
  const [track, setTrack] = useState("up"); // up | down
  const pickable = typeof onPickTicker === "function";

  const { gainers, losers, readyCount } = useMemo(() => {
    const scored = [];
    for (const item of marketItems || []) {
      const ticker = String(item?.ticker || "").trim().toUpperCase();
      if (!ticker) continue;
      const pct = Number(item?.change_pct);
      if (!Number.isFinite(pct)) continue;
      scored.push({
        ticker,
        name: item.name || ticker,
        price: item.price != null ? Number(item.price) : null,
        change_pct: pct,
        asset_type: item.asset_type || "equity",
        info: item.info || null,
      });
    }
    const byPctDesc = [...scored].sort((a, b) => b.change_pct - a.change_pct);
    const gainers = byPctDesc.filter((r) => r.change_pct > 0).slice(0, MAX_CARDS);
    const losers = [...byPctDesc]
      .filter((r) => r.change_pct < 0)
      .sort((a, b) => a.change_pct - b.change_pct)
      .slice(0, MAX_CARDS);
    return { gainers, losers, readyCount: scored.length };
  }, [marketItems]);

  const hasUp = gainers.length > 0;
  const hasDown = losers.length > 0;

  useEffect(() => {
    if (!hasUp && hasDown) setTrack("down");
    else if (hasUp && !hasDown) setTrack("up");
  }, [hasUp, hasDown]);

  if (!hasUp && !hasDown) {
    if (!pricesPending && readyCount === 0 && (marketItems?.length || 0) === 0) {
      return null;
    }
    return (
      <div className="popular-ticker is-movers" aria-label="Biggest movers">
        <div className="popular-ticker-head">
          <p className="popular-ticker-label">Biggest movers</p>
        </div>
        <p className="movers-empty">
          {pricesPending
            ? "Loading today’s percentage moves…"
            : "Day’s % changes aren’t available yet."}
        </p>
      </div>
    );
  }

  const showingDown = track === "down" && hasDown;
  const rows = showingDown ? losers : gainers;
  const label = showingDown ? "Biggest losers today" : "Biggest gainers today";

  return (
    <div
      className={`popular-ticker is-movers${showingDown ? " is-down" : " is-up"}`}
      aria-label={label}
    >
      <div className="popular-ticker-head">
        <p className="popular-ticker-label">Biggest movers</p>
        {hasUp && hasDown ? (
          <div className="popular-ticker-tabs" role="tablist" aria-label="Day movers">
            <button
              type="button"
              role="tab"
              aria-selected={!showingDown}
              className={!showingDown ? "is-active" : undefined}
              data-click="select"
              onClick={() => setTrack("up")}
            >
              Gainers
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={showingDown}
              className={showingDown ? "is-active" : undefined}
              data-click="select"
              onClick={() => setTrack("down")}
            >
              Losers
            </button>
          </div>
        ) : null}
      </div>
      <p className="movers-sub">{label}</p>
      <div className="popular-ticker-grid" key={showingDown ? "down" : "up"}>
        {rows.map((row) => {
          const Tag = pickable ? "button" : "div";
          const priceLabel = money(row.price);
          const up = row.change_pct >= 0;
          return (
            <Tag
              key={row.ticker}
              type={pickable ? "button" : undefined}
              className="popular-ticker-card"
              data-click={pickable ? "select" : undefined}
              onClick={pickable ? () => onPickTicker(row) : undefined}
            >
              <strong>{row.ticker}</strong>
              <span className="popular-ticker-name">{row.name}</span>
              <span className={`movers-pct ${up ? "up" : "down"}`}>
                {formatPct(row.change_pct)}
              </span>
              {priceLabel ? (
                <span className="popular-ticker-price">{priceLabel}</span>
              ) : null}
            </Tag>
          );
        })}
      </div>
    </div>
  );
}

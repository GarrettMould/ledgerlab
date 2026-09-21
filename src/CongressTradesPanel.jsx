import { useEffect, useMemo, useState } from "react";
import { getCongressTrades } from "./api";

function typeLabel(type) {
  const t = String(type || "").toLowerCase();
  if (t === "purchase") return "Bought";
  if (t === "sale") return "Sold";
  if (t === "exchange") return "Exchanged";
  return "Traded";
}

/**
 * Classroom strip of recent STOCK Act disclosures.
 * Tabs let you filter to specific politicians from a curated tracker roster.
 */
export default function CongressTradesPanel({ onPickTicker = null }) {
  const [members, setMembers] = useState([]);
  const [trades, setTrades] = useState([]);
  const [note, setNote] = useState("");
  const [attribution, setAttribution] = useState("");
  const [attributionUrl, setAttributionUrl] = useState("");
  const [memberSlug, setMemberSlug] = useState(""); // "" = all tracked activity
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError("");
    getCongressTrades({
      memberSlug: memberSlug || undefined,
      catalogOnly: true,
      limit: memberSlug ? 12 : 18,
    })
      .then((data) => {
        if (cancelled) return;
        setMembers(Array.isArray(data?.members) ? data.members : []);
        setTrades(Array.isArray(data?.trades) ? data.trades : []);
        setNote(String(data?.note || ""));
        setAttribution(String(data?.attribution || ""));
        setAttributionUrl(String(data?.attributionUrl || ""));
      })
      .catch((err) => {
        if (cancelled) return;
        setTrades([]);
        setError(err.message || "Could not load Congress trades");
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [memberSlug]);

  const pickable = typeof onPickTicker === "function";
  const label = useMemo(() => {
    if (!memberSlug) return "Congress disclosures";
    const hit = members.find((m) => m.slug === memberSlug);
    return hit?.label ? `${hit.label} disclosures` : "Congress disclosures";
  }, [memberSlug, members]);

  if (!ready && !trades.length && !error) {
    return (
      <div className="popular-ticker is-congress" aria-busy="true">
        <div className="popular-ticker-head">
          <p className="popular-ticker-label">Congress disclosures</p>
        </div>
        <p className="congress-trades-empty">Loading filings…</p>
      </div>
    );
  }

  if (error && !trades.length) {
    return null;
  }

  return (
    <div className="popular-ticker is-congress" aria-label={label}>
      <div className="popular-ticker-head">
        <p className="popular-ticker-label">{label}</p>
        {members.length > 0 ? (
          <div className="popular-ticker-tabs" role="tablist" aria-label="Tracked politicians">
            <button
              type="button"
              role="tab"
              aria-selected={!memberSlug}
              className={!memberSlug ? "is-active" : undefined}
              data-click="select"
              onClick={() => setMemberSlug("")}
            >
              Recent
            </button>
            {members.map((m) => (
              <button
                key={m.slug}
                type="button"
                role="tab"
                aria-selected={memberSlug === m.slug}
                className={memberSlug === m.slug ? "is-active" : undefined}
                data-click="select"
                onClick={() => setMemberSlug(m.slug)}
              >
                {(m.label || m.slug).split(" ").slice(-1)[0]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {trades.length === 0 ? (
        <p className="congress-trades-empty">
          No recent filings for this tracker yet.
        </p>
      ) : (
        <div className="popular-ticker-grid congress-trades-grid">
          {trades.slice(0, 8).map((row, i) => {
            const Tag = pickable && row.inCatalog ? "button" : "div";
            const key = `${row.memberSlug || row.member}-${row.ticker}-${row.transactionDate}-${i}`;
            return (
              <Tag
                key={key}
                type={pickable && row.inCatalog ? "button" : undefined}
                className="popular-ticker-card congress-trade-card"
                data-click={pickable && row.inCatalog ? "select" : undefined}
                onClick={
                  pickable && row.inCatalog
                    ? () => onPickTicker({ ticker: row.ticker, name: row.name })
                    : undefined
                }
              >
                <strong>{row.ticker}</strong>
                <span className="popular-ticker-name">
                  {typeLabel(row.type)}
                  {row.amountRange ? ` · ${row.amountRange}` : ""}
                </span>
                <span className="congress-trade-meta">
                  {row.member}
                  {row.transactionDate ? ` · ${row.transactionDate}` : ""}
                </span>
              </Tag>
            );
          })}
        </div>
      )}

      <p className="congress-trades-foot">
        {note || "Filings can lag trades by weeks."}
        {attribution ? (
          <>
            {" "}
            {attributionUrl ? (
              <a href={attributionUrl} target="_blank" rel="noreferrer">
                {attribution}
              </a>
            ) : (
              attribution
            )}
            .
          </>
        ) : null}
      </p>
    </div>
  );
}

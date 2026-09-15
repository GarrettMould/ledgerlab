import { useEffect, useState } from "react";
import { getPopularStocks } from "./api";
import { subscribeClassPopularStocks } from "./classStore";

const MAX_CARDS = 5;

/**
 * Static “most popular in this class” cards for the stocks market.
 * Reads the cached popularStocks field on the class doc (updated on buy/sell).
 */
export default function PopularStocksTicker({
  classId,
  className: classNameProp = "",
  onPickTicker = null,
}) {
  const [stocks, setStocks] = useState([]);
  const [className, setClassName] = useState(classNameProp || "");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (classNameProp) setClassName(classNameProp);
  }, [classNameProp]);

  useEffect(() => {
    if (!classId) {
      setStocks([]);
      setReady(true);
      return undefined;
    }
    let cancelled = false;
    setReady(false);

    // One-time ensure/rebuild if the class cache was never written.
    getPopularStocks(classId)
      .then((payload) => {
        if (cancelled) return;
        if (payload?.className) setClassName(payload.className);
        if (Array.isArray(payload?.stocks) && payload.stocks.length) {
          setStocks(payload.stocks);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    const unsub = subscribeClassPopularStocks(
      classId,
      (data) => {
        if (cancelled) return;
        if (data.className) setClassName(data.className);
        setStocks(data.stocks || []);
        setReady(true);
      },
      () => {
        if (!cancelled) setReady(true);
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [classId]);

  const top = stocks.slice(0, MAX_CARDS);
  if (!classId || !ready || top.length === 0) return null;

  const label = className ? `Most popular in ${className}` : "Most popular in class";
  const pickable = typeof onPickTicker === "function";

  return (
    <div className="popular-ticker" aria-label={label}>
      <p className="popular-ticker-label">{label}</p>
      <div className="popular-ticker-grid">
        {top.map((row) => {
          const Tag = pickable ? "button" : "div";
          return (
            <Tag
              key={row.ticker}
              type={pickable ? "button" : undefined}
              className="popular-ticker-card"
              data-click={pickable ? "select" : undefined}
              onClick={pickable ? () => onPickTicker(row.ticker) : undefined}
            >
              <strong>{row.ticker}</strong>
              <span className="popular-ticker-name">{row.name}</span>
            </Tag>
          );
        })}
      </div>
    </div>
  );
}

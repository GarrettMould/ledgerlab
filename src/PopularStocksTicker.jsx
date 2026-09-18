import { useEffect, useMemo, useState } from "react";
import { getPopularStocks } from "./api";
import {
  subscribeClassExtraMarketItems,
  subscribeClassPopularStocks,
} from "./classStore";

const MAX_CARDS = 5;
const ROTATE_MS = 9000;

/**
 * One highlight row for the stocks market — alternates between
 * “most popular in class” and “new stocks” (teacher-added extras).
 */
export default function PopularStocksTicker({
  classId,
  className: classNameProp = "",
  onPickTicker = null,
}) {
  const [popular, setPopular] = useState([]);
  const [extras, setExtras] = useState([]);
  const [className, setClassName] = useState(classNameProp || "");
  const [ready, setReady] = useState(false);
  const [track, setTrack] = useState("popular"); // popular | new

  useEffect(() => {
    if (classNameProp) setClassName(classNameProp);
  }, [classNameProp]);

  useEffect(() => {
    if (!classId) {
      setPopular([]);
      setExtras([]);
      setReady(true);
      return undefined;
    }
    let cancelled = false;
    setReady(false);

    getPopularStocks(classId)
      .then((payload) => {
        if (cancelled) return;
        if (payload?.className) setClassName(payload.className);
        if (Array.isArray(payload?.stocks) && payload.stocks.length) {
          setPopular(payload.stocks);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    const unsubPopular = subscribeClassPopularStocks(
      classId,
      (data) => {
        if (cancelled) return;
        if (data.className) setClassName(data.className);
        setPopular(data.stocks || []);
        setReady(true);
      },
      () => {
        if (!cancelled) setReady(true);
      }
    );

    const unsubExtras = subscribeClassExtraMarketItems(
      classId,
      (rows) => {
        if (!cancelled) setExtras(rows || []);
      },
      () => {}
    );

    return () => {
      cancelled = true;
      unsubPopular();
      unsubExtras();
    };
  }, [classId]);

  const popularTop = useMemo(() => popular.slice(0, MAX_CARDS), [popular]);
  const newTop = useMemo(() => extras.slice(0, MAX_CARDS), [extras]);
  const hasPopular = popularTop.length > 0;
  const hasNew = newTop.length > 0;

  useEffect(() => {
    if (!hasPopular && hasNew) setTrack("new");
    else if (hasPopular && !hasNew) setTrack("popular");
  }, [hasPopular, hasNew]);

  useEffect(() => {
    if (!hasPopular || !hasNew) return undefined;
    const id = window.setInterval(() => {
      setTrack((prev) => (prev === "popular" ? "new" : "popular"));
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [hasPopular, hasNew]);

  if (!classId || !ready || (!hasPopular && !hasNew)) return null;

  const showingNew = track === "new" && hasNew;
  const rows = showingNew ? newTop : popularTop;
  const label = showingNew
    ? "New stocks"
    : className
      ? `Most popular in ${className}`
      : "Most popular in class";
  const pickable = typeof onPickTicker === "function";

  return (
    <div
      className={`popular-ticker${showingNew ? " is-new" : " is-popular"}`}
      aria-label={label}
    >
      <div className="popular-ticker-head">
        <p className="popular-ticker-label">{label}</p>
        {hasPopular && hasNew ? (
          <div className="popular-ticker-tabs" role="tablist" aria-label="Stock highlights">
            <button
              type="button"
              role="tab"
              aria-selected={!showingNew}
              className={!showingNew ? "is-active" : undefined}
              data-click="select"
              onClick={() => setTrack("popular")}
            >
              Top picks
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={showingNew}
              className={showingNew ? "is-active" : undefined}
              data-click="select"
              onClick={() => setTrack("new")}
            >
              New stocks
            </button>
          </div>
        ) : null}
      </div>
      <div className="popular-ticker-grid" key={showingNew ? "new" : "popular"}>
        {rows.map((row) => {
          const Tag = pickable ? "button" : "div";
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
            </Tag>
          );
        })}
      </div>
    </div>
  );
}

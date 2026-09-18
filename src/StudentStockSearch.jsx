import { useEffect, useRef, useState } from "react";
import { searchMarketTickers } from "./api";
import { createStockRequest } from "./classStore";
import StockBuyModal from "./StockBuyModal";

const INITIAL_VISIBLE = 5;

/**
 * Finnhub lookup for students: available tickers open a PayPal-style buy modal;
 * others get a “Request stock” action that notifies the teacher.
 *
 * Search lists name only (no quote fan-out). Buy modal loads a live price on open.
 */
export default function StudentStockSearch({
  classId,
  className = "",
  studentId = "",
  studentName = "",
  cash = 0,
  marketItems = [],
  buyTarget = null,
  onBuyTargetChange = null,
  onBought = null,
  setError = null,
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [requestBusy, setRequestBusy] = useState("");
  const [internalBuyTarget, setInternalBuyTarget] = useState(null);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const controlled = typeof onBuyTargetChange === "function";
  const activeTarget = controlled ? buyTarget : internalBuyTarget;

  function setActiveTarget(next) {
    if (controlled) onBuyTargetChange(next);
    else setInternalBuyTarget(next);
  }

  const marketByTicker = useRef(new Map());
  useEffect(() => {
    const map = new Map();
    for (const item of marketItems || []) {
      if (item?.ticker) map.set(String(item.ticker).toUpperCase(), item);
    }
    marketByTicker.current = map;
  }, [marketItems]);

  useEffect(() => {
    const q = query.trim();
    setShowAll(false);
    if (!classId || q.length < 1) {
      setResults([]);
      setSearchError("");
      setSearchBusy(false);
      return undefined;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setSearchBusy(true);
      setSearchError("");
      try {
        const data = await searchMarketTickers(classId, q);
        setResults(Array.isArray(data?.results) ? data.results : []);
        if (!(data?.results || []).length) {
          setSearchError("No matches — try another ticker or name.");
        }
      } catch (err) {
        setResults([]);
        setSearchError(err.message || "Search failed");
      } finally {
        setSearchBusy(false);
      }
    }, 320);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, classId]);

  if (!classId) return null;

  function openBuy(row) {
    const live = marketByTicker.current.get(String(row.ticker || "").toUpperCase());
    setActiveTarget({
      ticker: String(row.ticker || "").toUpperCase(),
      name: live?.name || row.name || row.ticker,
      // Prefer live market shelf price if already loaded; otherwise modal fetches.
      price: live?.price != null ? live.price : null,
      change_pct: live?.change_pct ?? null,
      asset_type: live?.asset_type || "equity",
    });
  }

  async function handleRequest(row) {
    if (!row?.ticker || requestBusy) return;
    setRequestBusy(row.ticker);
    setError?.("");
    try {
      await createStockRequest(classId, {
        query: row.ticker,
        studentId: studentId || null,
        studentName,
        className,
      });
      setResults((prev) =>
        prev.map((r) =>
          r.ticker === row.ticker ? { ...r, requested: true } : r
        )
      );
    } catch (err) {
      setError?.(err.message || "Could not send request");
    } finally {
      setRequestBusy("");
    }
  }

  const visible = showAll ? results : results.slice(0, INITIAL_VISIBLE);
  const hiddenCount = Math.max(0, results.length - INITIAL_VISIBLE);

  return (
    <div className="student-stock-search">
      <form
        className="student-stock-search-form"
        onSubmit={(e) => {
          e.preventDefault();
          inputRef.current?.blur?.();
        }}
      >
        <label className="student-stock-search-label" htmlFor="student-stock-search">
          Search stocks
        </label>
        <input
          id="student-stock-search"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ticker or company — e.g. NVDA"
          autoComplete="off"
          aria-label="Search stocks"
        />
        {searchBusy ? (
          <span className="student-stock-search-status">Searching…</span>
        ) : null}
      </form>

      {searchError && query.trim() ? (
        <p className="student-stock-search-error">{searchError}</p>
      ) : null}

      {results.length > 0 ? (
        <>
          <ul className="student-stock-search-results">
            {visible.map((row) => {
              const available = Boolean(row.alreadyOnMarket || row.inCatalog);
              return (
                <li key={row.ticker}>
                  {available ? (
                    <button
                      type="button"
                      className="student-stock-search-hit is-available"
                      data-click="select"
                      onClick={() => openBuy(row)}
                    >
                      <span className="student-stock-search-hit-main">
                        <strong>{row.ticker}</strong>
                        <span>{row.name}</span>
                      </span>
                      <span className="student-stock-search-hit-go">Buy</span>
                    </button>
                  ) : (
                    <div className="student-stock-search-hit is-unavailable">
                      <span className="student-stock-search-hit-main">
                        <strong>{row.ticker}</strong>
                        <span>{row.name}</span>
                      </span>
                      <button
                        type="button"
                        className="student-stock-request-btn"
                        data-click="confirm"
                        disabled={requestBusy === row.ticker || row.requested}
                        onClick={() => handleRequest(row)}
                      >
                        {row.requested
                          ? "Requested"
                          : requestBusy === row.ticker
                            ? "…"
                            : "Request stock"}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {hiddenCount > 0 ? (
            <button
              type="button"
              className="student-stock-show-more"
              data-click="select"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Show less" : `Show more (${hiddenCount})`}
            </button>
          ) : null}
        </>
      ) : null}

      <StockBuyModal
        target={activeTarget}
        classId={classId}
        studentId={studentId}
        cash={cash}
        onClose={() => setActiveTarget(null)}
        onBought={onBought}
      />
    </div>
  );
}

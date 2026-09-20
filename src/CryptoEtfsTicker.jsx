import { useEffect, useMemo, useState } from "react";
import { getQuotes } from "./api";

/** Curated spot crypto ETFs — fixed classroom shelf (Bitcoin, Ethereum, Solana). */
export const CRYPTO_ETF_TICKERS = ["IBIT", "ETHA", "BSOL"];

const CRYPTO_ETFS = [
  { ticker: "IBIT", name: "iShares Bitcoin Trust" },
  { ticker: "ETHA", name: "iShares Ethereum Trust" },
  { ticker: "BSOL", name: "Bitwise Solana Staking ETF" },
];

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/**
 * Highlight row for the ETFs market — spot crypto ETFs, same layout as
 * the “most popular stocks” strip, with live prices.
 */
export default function CryptoEtfsTicker({
  marketItems = [],
  onPickTicker = null,
}) {
  const [quotePrices, setQuotePrices] = useState({});
  const pickable = typeof onPickTicker === "function";
  const label = "Crypto ETFs";

  const fromMarket = useMemo(() => {
    const map = {};
    for (const item of marketItems || []) {
      const t = String(item?.ticker || "").toUpperCase();
      if (!CRYPTO_ETF_TICKERS.includes(t)) continue;
      const price = Number(item.price);
      if (price > 0) map[t] = price;
    }
    return map;
  }, [marketItems]);

  useEffect(() => {
    const missing = CRYPTO_ETF_TICKERS.filter((t) => !(fromMarket[t] > 0));
    if (!missing.length) return undefined;
    let cancelled = false;
    getQuotes(missing)
      .then((data) => {
        if (cancelled) return;
        const next = {};
        const quotes = data?.quotes || {};
        for (const t of missing) {
          const p = Number(quotes[t]?.price);
          if (p > 0) next[t] = p;
        }
        if (Object.keys(next).length) {
          setQuotePrices((prev) => ({ ...prev, ...next }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fromMarket]);

  return (
    <div className="popular-ticker is-crypto" aria-label={label}>
      <div className="popular-ticker-head">
        <p className="popular-ticker-label">{label}</p>
      </div>
      <div className="popular-ticker-grid">
        {CRYPTO_ETFS.map((row) => {
          const Tag = pickable ? "button" : "div";
          const price = fromMarket[row.ticker] || quotePrices[row.ticker];
          const priceLabel = money(price);
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
              <span className="popular-ticker-price">
                {priceLabel || "…"}
              </span>
            </Tag>
          );
        })}
      </div>
    </div>
  );
}

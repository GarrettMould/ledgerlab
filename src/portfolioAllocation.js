export const TICKER_CATEGORY = {
  // Technology
  AAPL: "stocks",
  MSFT: "stocks",
  GOOGL: "stocks",
  NVDA: "stocks",
  META: "stocks",
  AMD: "stocks",
  ORCL: "stocks",
  CRM: "stocks",
  INTC: "stocks",
  AVGO: "stocks",
  // Consumer
  AMZN: "stocks",
  WMT: "stocks",
  COST: "stocks",
  NKE: "stocks",
  MCD: "stocks",
  SBUX: "stocks",
  TGT: "stocks",
  HD: "stocks",
  KO: "stocks",
  PEP: "stocks",
  // Finance
  JPM: "stocks",
  V: "stocks",
  MA: "stocks",
  BAC: "stocks",
  GS: "stocks",
  WFC: "stocks",
  C: "stocks",
  AXP: "stocks",
  BLK: "stocks",
  SCHW: "stocks",
  // Healthcare
  JNJ: "stocks",
  UNH: "stocks",
  LLY: "stocks",
  PFE: "stocks",
  ABBV: "stocks",
  MRK: "stocks",
  AMGN: "stocks",
  TMO: "stocks",
  CVS: "stocks",
  MDT: "stocks",
  // Energy
  XOM: "stocks",
  CVX: "stocks",
  COP: "stocks",
  SLB: "stocks",
  EOG: "stocks",
  MPC: "stocks",
  OXY: "stocks",
  PSX: "stocks",
  VLO: "stocks",
  WMB: "stocks",
  // Entertainment
  DIS: "stocks",
  NFLX: "stocks",
  CMCSA: "stocks",
  SPOT: "stocks",
  WBD: "stocks",
  EA: "stocks",
  TTWO: "stocks",
  LYV: "stocks",
  ROKU: "stocks",
  SONY: "stocks",
  // Autos
  TSLA: "stocks",
  F: "stocks",
  GM: "stocks",
  TM: "stocks",
  HMC: "stocks",
  STLA: "stocks",
  RIVN: "stocks",
  UBER: "stocks",
  APTV: "stocks",
  BWA: "stocks",
  // Industrials
  BA: "stocks",
  CAT: "stocks",
  GE: "stocks",
  HON: "stocks",
  UPS: "stocks",
  UNP: "stocks",
  LMT: "stocks",
  RTX: "stocks",
  DE: "stocks",
  MMM: "stocks",
  SPY: "etfs",
  QQQ: "etfs",
  VOO: "etfs",
  VTI: "etfs",
  IWM: "etfs",
  DIA: "etfs",
  XLK: "etfs",
  XLE: "etfs",
  XLF: "etfs",
  ARKK: "etfs",
  "UST-3M": "bonds",
  "UST-6M": "bonds",
  "UST-1Y": "bonds",
  "UST-2Y": "bonds",
  "UST-5Y": "bonds",
  "UST-10Y": "bonds",
  "UST-30Y": "bonds",
  "AAPL-31": "bonds",
  "MSFT-33": "bonds",
  "JPM-32": "bonds",
  // Legacy ETF proxies (kept so old holdings still classify).
  GLD: "commodities",
  SLV: "commodities",
  PPLT: "commodities",
  USO: "commodities",
  UNG: "commodities",
  CPER: "commodities",
  DBA: "commodities",
  WEAT: "commodities",
  CANE: "commodities",
  // Raw commodity futures tickers
  GOLD: "commodities",
  SILVER: "commodities",
  PLAT: "commodities",
  OIL: "commodities",
  NATGAS: "commodities",
  COPPER: "commodities",
  CORN: "commodities",
  WHEAT: "commodities",
  SOY: "commodities",
  SUGAR: "commodities",
  COFFEE: "commodities",
  EUR: "currencies",
  GBP: "currencies",
  JPY: "currencies",
  CAD: "currencies",
  AUD: "currencies",
  CHF: "currencies",
  MXN: "currencies",
  NZD: "currencies",
};

export const PIE_COLORS = {
  cash: "#2f6b4f",
  stocks: "#3b82f6",
  etfs: "#d97706",
  bonds: "#7c3aed",
  commodities: "#b45309",
  currencies: "#0891b2",
  realestate: "#5a7a4f",
};

function holdingValue(h) {
  const value = Number(h.market_value);
  if (Number.isFinite(value)) return value;
  return (Number(h.price) || Number(h.avg_cost) || 0) * (Number(h.shares) || 0);
}

export function categoryForTicker(ticker) {
  return (
    TICKER_CATEGORY[ticker] ||
    (String(ticker).startsWith("UST-")
      ? "bonds"
      : String(ticker).startsWith("FL-")
        ? "realestate"
        : "stocks")
  );
}

/** Display order + labels for holdings list sections (no cash bucket). */
export const HOLDING_CATEGORY_ORDER = [
  { id: "stocks", label: "Stocks" },
  { id: "etfs", label: "ETFs" },
  { id: "bonds", label: "Bonds" },
  { id: "commodities", label: "Commodities" },
  { id: "currencies", label: "Currencies" },
  { id: "realestate", label: "Real estate" },
];

/** Group holdings into category sections; empty categories omitted. */
export function groupHoldingsByCategory(holdings) {
  const buckets = Object.fromEntries(
    HOLDING_CATEGORY_ORDER.map((c) => [c.id, []])
  );
  for (const h of holdings || []) {
    const cat = categoryForTicker(h.ticker);
    if (!buckets[cat]) buckets[cat] = [];
    buckets[cat].push(h);
  }
  return HOLDING_CATEGORY_ORDER.map((c) => ({
    id: c.id,
    label: c.label,
    holdings: buckets[c.id] || [],
  })).filter((g) => g.holdings.length > 0);
}

/** Build allocation rows from one or more student portfolio payloads. */
export function buildAllocation(portfolios) {
  const list = Array.isArray(portfolios) ? portfolios : portfolios ? [portfolios] : [];
  const buckets = {
    cash: 0,
    stocks: 0,
    etfs: 0,
    bonds: 0,
    commodities: 0,
    currencies: 0,
    realestate: 0,
  };

  for (const portfolio of list) {
    if (!portfolio) continue;
    buckets.cash += Number(portfolio.cash) || 0;
    for (const h of portfolio.holdings || []) {
      const cat = categoryForTicker(h.ticker);
      buckets[cat] = (buckets[cat] || 0) + holdingValue(h);
    }
  }

  const total = Object.values(buckets).reduce((a, b) => a + b, 0) || 1;
  return [
    { key: "cash", name: "Cash", value: buckets.cash, pct: (buckets.cash / total) * 100 },
    { key: "stocks", name: "Stocks", value: buckets.stocks, pct: (buckets.stocks / total) * 100 },
    { key: "etfs", name: "ETFs", value: buckets.etfs, pct: (buckets.etfs / total) * 100 },
    { key: "bonds", name: "Bonds", value: buckets.bonds, pct: (buckets.bonds / total) * 100 },
    {
      key: "commodities",
      name: "Commodities",
      value: buckets.commodities,
      pct: (buckets.commodities / total) * 100,
    },
    {
      key: "currencies",
      name: "Currencies",
      value: buckets.currencies,
      pct: (buckets.currencies / total) * 100,
    },
    {
      key: "realestate",
      name: "Real estate",
      value: buckets.realestate,
      pct: (buckets.realestate / total) * 100,
    },
  ].filter((row) => row.value > 0.005);
}

export function sumPortfolioTotals(portfolios) {
  let cash = 0;
  let invested = 0;
  let total = 0;
  for (const p of portfolios || []) {
    if (!p) continue;
    const pCash = Number(p.cash) || 0;
    cash += pCash;
    const pInvested = Number(p.portfolio_value);
    if (Number.isFinite(pInvested)) {
      invested += pInvested;
    } else {
      invested += (p.holdings || []).reduce((s, h) => s + holdingValue(h), 0);
    }
    const tv = Number(p.total_value);
    if (Number.isFinite(tv)) {
      total += tv;
    } else {
      total += pCash + (Number.isFinite(pInvested) ? pInvested : (p.holdings || []).reduce((s, h) => s + holdingValue(h), 0));
    }
  }
  return { cash, invested, total };
}

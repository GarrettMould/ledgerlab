import { categoryForTicker } from "./portfolioAllocation";

const SECTOR_TICKERS = {
  Technology: "AAPL MSFT GOOGL NVDA META AMD ORCL CRM INTC AVGO GRMN ARM PLTR MRVL QCOM IONQ SPCX",
  Consumer: "AMZN WMT COST NKE MCD SBUX TGT HD KO PEP",
  Finance: "JPM V MA BAC GS WFC C AXP BLK SCHW MSTR COIN",
  Healthcare: "JNJ UNH LLY PFE ABBV MRK AMGN TMO CVS MDT",
  Energy: "XOM CVX COP SLB EOG MPC OXY PSX VLO WMB",
  Entertainment: "DIS NFLX CMCSA SPOT WBD EA TTWO RBLX LYV ROKU SONY MGM LVS WYNN",
  Autos: "TSLA F GM TM HMC STLA RIVN UBER APTV BWA",
  Industrials: "BA CAT GE HON UPS UNP LMT RTX DE MMM",
};

const TICKER_SECTOR = Object.fromEntries(
  Object.entries(SECTOR_TICKERS).flatMap(([sector, list]) =>
    list.split(" ").map((t) => [t, sector])
  )
);

const HIGH_VOL_STOCKS = new Set(
  "TSLA MSTR COIN IONQ RIVN PLTR RBLX ARM NVDA AMD SPCX ROKU MRVL".split(" ")
);
const DEFENSIVE_STOCKS = new Set(
  "KO PEP JNJ WMT COST MCD PFE MRK UNH ABBV MDT CVS HD TGT".split(" ")
);
const CRYPTO_TICKERS = new Set(["IBIT", "ETHA", "BSOL", "MSTR", "COIN"]);
const BROAD_ETFS = new Set(["SPY", "VOO", "VTI", "DIA", "QQQ", "IWM"]);

const ETF_RISK = {
  SPY: 5, VOO: 5, VTI: 5, DIA: 5, QQQ: 6, IWM: 6.5,
  XLK: 6.5, XLE: 6.5, XLF: 6, SOXX: 7.5, ARKK: 8.5,
  IBIT: 9.5, ETHA: 9.5, BSOL: 9.5,
};
const BOND_RISK = {
  "UST-3M": 1.5, "UST-6M": 1.5, "UST-1Y": 1.5, "UST-2Y": 2,
  "UST-5Y": 2.5, "UST-10Y": 3.5, "UST-30Y": 4.5,
};
const COMMODITY_RISK = {
  GOLD: 5, GLD: 5, SILVER: 6.5, SLV: 6.5, OIL: 8.5, USO: 8.5,
  NATGAS: 9, UNG: 9,
};

export const FRIENDLY_NAMES = {
  "UST-3M": "US Treasury 3-month", "UST-6M": "US Treasury 6-month",
  "UST-1Y": "US Treasury 1-year", "UST-2Y": "US Treasury 2-year",
  "UST-5Y": "US Treasury 5-year", "UST-10Y": "US Treasury 10-year",
  "UST-30Y": "US Treasury 30-year", "AAPL-31": "Apple bond (2031)",
  "MSFT-33": "Microsoft bond (2033)", "JPM-32": "JPMorgan bond (2032)",
  GOLD: "Gold", SILVER: "Silver", PLAT: "Platinum", OIL: "Crude oil",
  NATGAS: "Natural gas", COPPER: "Copper", CORN: "Corn", WHEAT: "Wheat",
  SOY: "Soybeans", SUGAR: "Sugar", COFFEE: "Coffee",
  GLD: "Gold", SLV: "Silver", PPLT: "Platinum", USO: "Crude oil", UNG: "Natural gas",
  CPER: "Copper", DBA: "Farm crops", WEAT: "Wheat", CANE: "Sugar",
  EUR: "Euro", GBP: "British pound", JPY: "Japanese yen", CAD: "Canadian dollar",
  AUD: "Australian dollar", CHF: "Swiss franc", MXN: "Mexican peso", NZD: "New Zealand dollar",
};

export const CLASS_LABELS = {
  cash: "Cash",
  stocks: "Stocks",
  etfs: "ETFs",
  bonds: "Bonds",
  commodities: "Commodities",
  currencies: "Currencies",
  realestate: "Real estate",
  lending: "Loans you made",
};

export const CLASS_COLORS = {
  cash: "#43a047",
  stocks: "#e53935",
  etfs: "#fb8c00",
  bonds: "#fdd835",
  commodities: "#1e88e5",
  currencies: "#3949ab",
  realestate: "#8e24aa",
  lending: "#00897b",
};

/** Classic model portfolios, ordered from least to most risky. */
export const MODEL_STYLES = [
  {
    id: "conservative",
    name: "Conservative",
    mix: "20% stocks · 70% bonds · 10% cash",
    parts: { stocks: 20, bonds: 70, cash: 10 },
    drop: 10,
    avg: 4.5,
    risk: 2.8,
    worstYear: "about −10%",
    longRun: "about 4–5% a year",
    who: "Someone who needs their money soon and hates seeing it drop.",
  },
  {
    id: "balanced",
    name: "Balanced",
    mix: "60% stocks · 40% bonds",
    parts: { stocks: 60, bonds: 40 },
    drop: 20,
    avg: 7,
    risk: 4.8,
    worstYear: "about −20%",
    longRun: "about 6–8% a year",
    who: "Someone who wants growth but also a cushion for bad years.",
  },
  {
    id: "growth",
    name: "Growth",
    mix: "80% stocks · 20% bonds",
    parts: { stocks: 80, bonds: 20 },
    drop: 30,
    avg: 8.5,
    risk: 6,
    worstYear: "about −30%",
    longRun: "about 8–9% a year",
    who: "Someone who can wait years and ride out rough patches.",
  },
  {
    id: "aggressive",
    name: "Aggressive",
    mix: "100% stocks",
    parts: { stocks: 100 },
    drop: 37,
    avg: 10,
    risk: 7,
    worstYear: "about −37% (2008)",
    longRun: "about 10% a year",
    who: "Someone chasing the biggest long-term growth who can handle deep drops.",
  },
  {
    id: "speculative",
    name: "Speculative",
    mix: "A few risky stocks and crypto",
    parts: { stocks: 70, crypto: 30 },
    drop: 60,
    avg: null,
    risk: 9,
    worstYear: "−60% or worse",
    longRun: "Unpredictable",
    who: "Someone swinging for huge wins who could lose most of it.",
  },
];

const OUTCOME_POINTS = [
  { risk: 1, drop: 0, avg: 0 },
  ...MODEL_STYLES.map(({ risk, drop, avg }) => ({ risk, drop, avg })),
];

/** Rough bad-year drop and average-year return for any risk score, by interpolation. */
export function estimateOutcomes(score) {
  const pts = OUTCOME_POINTS;
  const s = Math.min(pts[pts.length - 1].risk, Math.max(pts[0].risk, score));
  let i = 0;
  while (i < pts.length - 2 && s > pts[i + 1].risk) i += 1;
  const a = pts[i];
  const b = pts[i + 1];
  const t = (s - a.risk) / (b.risk - a.risk || 1);
  const drop = a.drop + (b.drop - a.drop) * t;
  const avg = a.avg == null || b.avg == null ? (s > 8 ? null : a.avg ?? b.avg) : a.avg + (b.avg - a.avg) * t;
  return { drop, avg };
}

export function riskLabel(score) {
  if (score < 2.5) return "Very low";
  if (score < 4) return "Low";
  if (score < 5.5) return "Medium";
  if (score < 7) return "High";
  return "Very high";
}

function tickerRisk(ticker, cls, holding) {
  switch (cls) {
    case "bonds":
      return BOND_RISK[ticker] ?? 3.5;
    case "etfs":
      return ETF_RISK[ticker] ?? 6;
    case "commodities":
      return COMMODITY_RISK[ticker] ?? 7;
    case "currencies":
      return 4;
    case "realestate":
      return Number(holding?.mortgage_balance) > 0 ? 6.5 : 5.5;
    default:
      if (HIGH_VOL_STOCKS.has(ticker)) return 8.5;
      if (DEFENSIVE_STOCKS.has(ticker)) return 5.5;
      return 6.5;
  }
}

function holdingValue(h) {
  if (categoryForTicker(h.ticker) === "realestate" && h.equity != null) {
    return Number(h.equity) || 0;
  }
  const mv = Number(h.market_value);
  if (Number.isFinite(mv)) return mv;
  return (Number(h.price) || Number(h.avg_cost) || 0) * (Number(h.shares) || 0);
}

function pct(part, whole) {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * Analyze a student's portfolio for the investment report: weights,
 * risk score, and investing style.
 */
export function analyzePortfolio({
  portfolio,
  countryLoans = [],
  peerLent = [],
  peerBorrowed = [],
}) {
  const cash = Math.max(0, Number(portfolio?.cash) || 0);
  const positions = [];

  for (const h of portfolio?.holdings || []) {
    const cls = categoryForTicker(h.ticker);
    const value = Math.max(0, holdingValue(h));
    if (value <= 0.005) continue;
    positions.push({
      ticker: h.ticker,
      name: h.name || FRIENDLY_NAMES[h.ticker] || h.ticker,
      cls,
      value,
      risk: tickerRisk(h.ticker, cls, h),
      sector: cls === "stocks" ? TICKER_SECTOR[h.ticker] || "Other" : null,
      gainPct: Number.isFinite(Number(h.gain_loss_pct)) ? Number(h.gain_loss_pct) : null,
    });
  }

  const lent =
    countryLoans.reduce((s, l) => s + (Number(l.principal) || 0), 0) +
    peerLent.reduce((s, l) => s + (Number(l.principal) || 0), 0);
  if (lent > 0.005) {
    positions.push({
      ticker: "LOANS",
      name: "Loans you made",
      cls: "lending",
      value: lent,
      risk: 4,
      sector: null,
      gainPct: null,
    });
  }

  const borrowed = peerBorrowed.reduce((s, l) => s + (Number(l.principal) || 0), 0);
  const invested = positions.reduce((s, p) => s + p.value, 0);
  const total = invested + cash;

  const byClass = {};
  for (const p of positions) byClass[p.cls] = (byClass[p.cls] || 0) + p.value;
  if (cash > 0.005) byClass.cash = cash;
  const mix = Object.keys(CLASS_LABELS)
    .filter((k) => byClass[k] > 0.005)
    .map((k) => ({ key: k, label: CLASS_LABELS[k], value: byClass[k], pct: pct(byClass[k], total) }))
    .sort((a, b) => b.value - a.value);

  positions.sort((a, b) => b.value - a.value);
  for (const p of positions) {
    p.pctOfTotal = pct(p.value, total);
    p.pctOfInvested = pct(p.value, invested);
  }

  const top = positions[0] || null;
  const top3Pct = positions.slice(0, 3).reduce((s, p) => s + p.pctOfInvested, 0);

  const stockValue = byClass.stocks || 0;
  const sectorTotals = {};
  for (const p of positions) {
    if (p.cls === "stocks") sectorTotals[p.sector] = (sectorTotals[p.sector] || 0) + p.value;
  }
  const sectors = Object.entries(sectorTotals)
    .map(([name, value]) => ({ name, value, pct: pct(value, stockValue) }))
    .sort((a, b) => b.value - a.value);

  const cryptoValue = positions
    .filter((p) => CRYPTO_TICKERS.has(p.ticker))
    .reduce((s, p) => s + p.value, 0);
  const broadEtfValue = positions
    .filter((p) => BROAD_ETFS.has(p.ticker))
    .reduce((s, p) => s + p.value, 0);

  let riskScore = total > 0
    ? (cash * 1 + positions.reduce((s, p) => s + p.value * p.risk, 0)) / total
    : 1;
  if (top && positions.length > 1 && top.pctOfInvested > 60) riskScore += 1.5;
  else if (top && top.pctOfInvested > 40) riskScore += 1;
  if (borrowed > 0 && total > 0) riskScore += Math.min(1.5, (borrowed / total) * 3);
  riskScore = Math.min(10, Math.max(1, riskScore));

  const cashPct = pct(cash, total);
  const stocksPctInv = pct(stockValue, invested);
  const traits = [];
  if (cashPct >= 50) traits.push("Mostly cash");
  if (pct(broadEtfValue, invested) >= 50) traits.push("Index investor");
  if (stocksPctInv >= 50) traits.push("Stock picker");
  if (top && positions.length > 0 && top.pctOfInvested >= 40) traits.push("Concentrated");
  if (sectors[0] && stockValue > 0 && sectors[0].pct >= 50 && sectors.length >= 1 && stocksPctInv >= 30)
    traits.push(`${sectors[0].name} bet`);
  if (pct((byClass.commodities || 0) + (byClass.realestate || 0), invested) >= 40)
    traits.push("Real-asset fan");
  if (pct(cryptoValue, total) >= 10) traits.push("Crypto-curious");
  if (pct((byClass.bonds || 0) + (byClass.lending || 0), invested) >= 50) traits.push("Income seeker");
  if (borrowed > 0) traits.push("Uses leverage");

  const nearest = MODEL_STYLES.reduce((best, s) =>
    Math.abs(s.risk - riskScore) < Math.abs(best.risk - riskScore) ? s : best
  );
  const style = describeStyle({ riskScore, cashPct, invested, traits, nearest });


  return {
    total, invested, cash, borrowed, mix, positions, top, top3Pct,
    sectors, riskScore, riskLabel: riskLabel(riskScore), traits, nearest, style,
  };
}

function describeStyle({ riskScore, cashPct, invested, traits, nearest }) {
  if (invested <= 0.005) {
    return {
      name: "Waiting on the sidelines",
      summary:
        "All of your money is in cash. Nothing can drop, but nothing can grow either. Every investor starts here. The next step is picking a first investment.",
    };
  }
  if (cashPct >= 70) {
    return {
      name: "Cautious saver",
      summary:
        "You’ve dipped a toe in, but most of your money is still in cash. That keeps you safe from crashes. It also means a great market barely helps you.",
    };
  }
  const flavor = traits.includes("Concentrated")
    ? " Much of it rides on one investment, which pushes your risk up."
    : traits.includes("Index investor")
      ? " You lean on index funds, which spread your money across hundreds of companies."
      : traits.includes("Stock picker")
        ? " You pick individual companies, so research matters and surprises hit harder."
        : "";
  const base = {
    conservative: "You protect what you have first and grow it second.",
    balanced: "You mix growth with safety, so bad years hurt less but good years help less too.",
    growth: "You aim for growth and accept bigger drops along the way.",
    aggressive: "You go all-in on growth. Expect big swings in both directions.",
    speculative: "You’re swinging for the fences. Huge wins are possible, and so are huge losses.",
  }[nearest.id];
  return { name: `${nearest.name} investor`, summary: `${base}${flavor}` };
}


/**
 * Classroom history quiz: pick a start year, guess which investing style
 * would have done best over the next ~3 years. Chart points are curated
 * (normalized to $1,000) so demos work without live market APIs.
 */

export const HISTORY_QUIZ_STYLES = [
  { id: "conservative", name: "Conservative", blurb: "Mostly bonds & cash" },
  { id: "balanced", name: "Balanced", blurb: "Mix of stocks & bonds" },
  { id: "growth", name: "Growth", blurb: "Mostly stocks" },
  { id: "aggressive", name: "Aggressive", blurb: "All stocks" },
  { id: "speculative", name: "Speculative", blurb: "Risky stocks / crypto" },
];

function winningStyleId(returns) {
  return Object.entries(returns).sort((a, b) => b[1] - a[1])[0][0];
}

/** Rough 3-year total return (%) for each style in that window. */
const RAW_HISTORY_QUIZ_SCENARIOS = [
  {
    id: "1999-dotcom",
    startYear: 1999,
    eraLabel: "Early 1999",
    windowLabel: "1999 → 2002",
    hook: "Tech stocks have been soaring. Everyone’s talking about the internet boom.",
    question:
      "Over the next 3 years, which investing style would have left you better off?",
    returns: {
      conservative: 18,
      balanced: -8,
      growth: -28,
      aggressive: -38,
      speculative: -65,
    },
    lesson:
      "The dot-com bubble burst in 2000–2002. High-flying tech stocks crashed. A conservative mix with bonds and cash held up while speculative bets got crushed.",
    eventName: "Dot-com bust",
    chart: {
      ticker: "QQQ",
      name: "Nasdaq-100 (tech-heavy)",
      unit: "portfolio",
      points: [
        { date: "1999-01", value: 1000 },
        { date: "1999-06", value: 1180 },
        { date: "1999-12", value: 1550 },
        { date: "2000-03", value: 1720 },
        { date: "2000-06", value: 1280 },
        { date: "2000-12", value: 980 },
        { date: "2001-06", value: 720 },
        { date: "2001-12", value: 650 },
        { date: "2002-06", value: 480 },
        { date: "2002-12", value: 520 },
      ],
    },
  },
  {
    id: "2007-crisis",
    startYear: 2007,
    eraLabel: "January 2007",
    windowLabel: "2007 → 2010",
    hook: "Housing has been booming for years. Stocks look calm. The economy feels fine.",
    question:
      "Over the next 3 years, which investing style would have left you better off?",
    returns: {
      conservative: 12,
      balanced: -10,
      growth: -22,
      aggressive: -32,
      speculative: -55,
    },
    lesson:
      "The 2008 financial crisis was the worst stock crash in generations. Banks failed, housing collapsed, and stock-heavy styles lost far more than bond-heavy ones.",
    eventName: "Global financial crisis",
    chart: {
      ticker: "SPY",
      name: "S&P 500",
      unit: "portfolio",
      points: [
        { date: "2007-01", value: 1000 },
        { date: "2007-07", value: 1080 },
        { date: "2007-12", value: 1030 },
        { date: "2008-06", value: 900 },
        { date: "2008-09", value: 820 },
        { date: "2008-11", value: 560 },
        { date: "2009-03", value: 480 },
        { date: "2009-09", value: 740 },
        { date: "2010-01", value: 800 },
        { date: "2010-06", value: 760 },
      ],
    },
  },
  {
    id: "2009-recovery",
    startYear: 2009,
    eraLabel: "March 2009",
    windowLabel: "2009 → 2012",
    hook: "Stocks just hit a terrifying low. The news is full of bank failures and layoffs. It feels like the world is ending.",
    question:
      "Over the next 3 years, which investing style would have left you better off?",
    returns: {
      conservative: 22,
      balanced: 45,
      growth: 68,
      aggressive: 85,
      speculative: 110,
    },
    lesson:
      "The best times to own risky assets often feel the worst. From the March 2009 bottom, speculative and aggressive styles recovered the most — if you could stomach the fear and stay invested.",
    eventName: "Post-crisis recovery",
    chart: {
      ticker: "SPY",
      name: "S&P 500",
      unit: "portfolio",
      points: [
        { date: "2009-03", value: 1000 },
        { date: "2009-06", value: 1280 },
        { date: "2009-12", value: 1550 },
        { date: "2010-06", value: 1450 },
        { date: "2010-12", value: 1750 },
        { date: "2011-06", value: 1820 },
        { date: "2011-09", value: 1580 },
        { date: "2011-12", value: 1750 },
        { date: "2012-06", value: 1900 },
        { date: "2012-12", value: 2050 },
      ],
    },
  },
  {
    id: "2017-bull",
    startYear: 2017,
    eraLabel: "Early 2017",
    windowLabel: "2017 → 2020",
    hook: "The market has been climbing for years. Unemployment is low. Nobody’s talking about a crash.",
    question:
      "Over the next 3 years, which investing style would have left you better off?",
    returns: {
      conservative: 14,
      balanced: 28,
      growth: 38,
      aggressive: 45,
      speculative: 55,
    },
    lesson:
      "Even with a sharp COVID crash in early 2020, the riskiest styles that stayed invested finished ahead by late 2020. Long bull markets can reward risk — but the ride includes sudden drops.",
    eventName: "Late bull market + COVID crash",
    chart: {
      ticker: "SPY",
      name: "S&P 500",
      unit: "portfolio",
      points: [
        { date: "2017-01", value: 1000 },
        { date: "2017-07", value: 1080 },
        { date: "2018-01", value: 1180 },
        { date: "2018-12", value: 1050 },
        { date: "2019-06", value: 1220 },
        { date: "2019-12", value: 1350 },
        { date: "2020-02", value: 1420 },
        { date: "2020-03", value: 980 },
        { date: "2020-08", value: 1400 },
        { date: "2020-12", value: 1550 },
      ],
    },
  },
  {
    id: "2020-covid",
    startYear: 2020,
    eraLabel: "March 2020",
    windowLabel: "2020 → 2023",
    hook: "The world is shutting down. Markets just plunged. Your classmates are scared to check their balances.",
    question:
      "Over the next 3 years, which investing style would have left you better off?",
    returns: {
      conservative: 8,
      balanced: 32,
      growth: 55,
      aggressive: 70,
      speculative: 95,
    },
    lesson:
      "Buying (or holding) at the COVID panic low rewarded the riskiest styles the most. Fear made speculative look reckless — for anyone who could wait, history made it look smart.",
    eventName: "COVID crash & rebound",
    chart: {
      ticker: "SPY",
      name: "S&P 500",
      unit: "portfolio",
      points: [
        { date: "2020-03", value: 1000 },
        { date: "2020-04", value: 1180 },
        { date: "2020-08", value: 1450 },
        { date: "2020-12", value: 1580 },
        { date: "2021-06", value: 1780 },
        { date: "2021-12", value: 1980 },
        { date: "2022-06", value: 1580 },
        { date: "2022-12", value: 1600 },
        { date: "2023-06", value: 1850 },
        { date: "2023-12", value: 2000 },
      ],
    },
  },
  {
    id: "2021-inflation",
    startYear: 2021,
    eraLabel: "Early 2021",
    windowLabel: "2021 → 2024",
    hook: "Stocks and crypto are hitting new highs. Stimulus checks are out. Everything feels unstoppable.",
    question:
      "Over the next 3 years, which investing style would have left you better off?",
    returns: {
      conservative: 2,
      balanced: 18,
      growth: 12,
      aggressive: 10,
      speculative: -15,
    },
    lesson:
      "2022’s inflation spike hurt almost everyone — especially pure speculative bets. A balanced mix finished ahead of both ultra-safe cash piles and stock-heavy styles that got whipsawed.",
    eventName: "Inflation & rate shock",
    chart: {
      ticker: "BTC",
      name: "Bitcoin (speculative example)",
      unit: "portfolio",
      points: [
        { date: "2021-01", value: 1000 },
        { date: "2021-04", value: 1700 },
        { date: "2021-07", value: 950 },
        { date: "2021-11", value: 1850 },
        { date: "2022-01", value: 1100 },
        { date: "2022-06", value: 550 },
        { date: "2022-12", value: 480 },
        { date: "2023-06", value: 850 },
        { date: "2023-12", value: 1200 },
        { date: "2024-01", value: 1250 },
      ],
    },
  },
];

/** Winner is always the style with the highest return — no hand-set mismatches. */
export const HISTORY_QUIZ_SCENARIOS = RAW_HISTORY_QUIZ_SCENARIOS.map((s) => ({
  ...s,
  answer: winningStyleId(s.returns),
}));

export function pickHistoryQuizScenario(excludeId = "") {
  const pool = excludeId
    ? HISTORY_QUIZ_SCENARIOS.filter((s) => s.id !== excludeId)
    : HISTORY_QUIZ_SCENARIOS;
  const list = pool.length ? pool : HISTORY_QUIZ_SCENARIOS;
  return list[Math.floor(Math.random() * list.length)];
}

export function styleById(id) {
  return HISTORY_QUIZ_STYLES.find((s) => s.id === id) || HISTORY_QUIZ_STYLES[0];
}

export function formatReturnPct(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${Math.round(n)}%`;
}

export function dollarsFromReturn(start, pct) {
  return Math.round(start * (1 + pct / 100));
}

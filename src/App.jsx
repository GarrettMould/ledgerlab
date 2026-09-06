import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { buyHome, buyShares, getMarket, getStudent, listStudents, sellShares } from "./api";
import PriceChart from "./PriceChart";
import PortfolioHistoryChart from "./PortfolioHistoryChart";
import CommodityInfoTip from "./CommodityInfoTip";
import BondGlossaryTip from "./BondGlossaryTip";
import ClassView from "./ClassView";
import NewsFeed from "./NewsFeed";
import TeacherDashboard from "./TeacherDashboard";
import TeacherGate from "./TeacherGate";
import CashTransferAlert from "./CashTransferAlert";
import {
  DEFAULT_MARKETS,
  clearStudentSession,
  getActiveClassId,
  getClass,
  getStudentSession,
  listClassStudents,
  parseJoinCodeFromUrl,
  setActiveClassId,
  setStudentSession,
} from "./classStore";
import { signOutStudentAuth } from "./studentAuth";
import { signOutTeacherAuth, watchTeacherAuth } from "./teacherAuth";
import { setClickMuted } from "./clickSounds";
import FloridaRealEstateMap from "./FloridaRealEstateMap";
import "./App.css";

const StudentCharacter = lazy(() => import("./StudentCharacter"));
const StudentJoin = lazy(() => import("./StudentJoin"));

const CURRENCY_LOTS = {
  EUR: 1,
  GBP: 1,
  JPY: 100,
  CAD: 1,
  AUD: 1,
  CHF: 1,
  MXN: 10,
  NZD: 1,
};

const BOND_TICKERS = new Set([
  "UST-3M",
  "UST-6M",
  "UST-1Y",
  "UST-2Y",
  "UST-5Y",
  "UST-10Y",
  "UST-30Y",
  "AAPL-31",
  "MSFT-33",
  "JPM-32",
]);

function isBondTicker(ticker) {
  return BOND_TICKERS.has(ticker) || String(ticker).startsWith("UST-");
}

function holdingAsTradeItem(h) {
  if (isBondTicker(h.ticker)) {
    return {
      ticker: h.ticker,
      name: h.ticker,
      price: Number(h.price) || 100,
      face_value: 100,
      asset_type: "bond",
    };
  }
  if (h.ticker in CURRENCY_LOTS || h.asset_type === "currency") {
    return {
      ticker: h.ticker,
      name: h.ticker,
      price: Number(h.price) || 0,
      lot: CURRENCY_LOTS[h.ticker],
      asset_type: "currency",
    };
  }
  if (String(h.ticker).startsWith("FL-") || h.asset_type === "realestate") {
    return {
      ticker: h.ticker,
      name: h.name || h.ticker,
      price: Number(h.price) || 0,
      asset_type: "realestate",
      mortgage_balance: Number(h.mortgage_balance) || 0,
    };
  }
  return {
    ticker: h.ticker,
    name: h.ticker,
    price: Number(h.price) || 0,
    asset_type: "equity",
  };
}

const CATEGORIES = [
  {
    id: "stocks",
    title: "Stocks",
    blurb: "Companies you can own a piece of",
    mark: "01",
  },
  {
    id: "etfs",
    title: "ETFs",
    blurb: "One trade, many holdings",
    mark: "02",
  },
  {
    id: "bonds",
    title: "Bonds",
    blurb: "Steadier yield from loans",
    mark: "03",
  },
  {
    id: "commodities",
    title: "Commodities",
    blurb: "Gold, oil, crops, metals",
    mark: "04",
  },
  {
    id: "currencies",
    title: "Currencies",
    blurb: "Trade dollars for other money",
    mark: "05",
  },
  {
    id: "realestate",
    title: "Real estate",
    blurb: "Florida homes with a classroom mortgage",
    mark: "06",
  },
];

/** Home-grid order by signup goal — riskier / more relevant markets float first. */
const CATEGORY_ORDER_BY_GOAL = {
  grow: ["stocks", "commodities", "etfs", "realestate", "currencies", "bonds"],
  balanced: ["etfs", "stocks", "bonds", "realestate", "commodities", "currencies"],
  learn: ["stocks", "etfs", "bonds", "commodities", "currencies", "realestate"],
  preserve: ["bonds", "etfs", "realestate", "currencies", "stocks", "commodities"],
};

function categoriesForGoal(goalId) {
  const order = CATEGORY_ORDER_BY_GOAL[goalId] || CATEGORY_ORDER_BY_GOAL.learn;
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...CATEGORIES].sort(
    (a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99)
  );
}

function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function StudentPortfolio({
  students,
  enabledMarkets,
  lockedStudentId,
  investmentGoal,
  portfolioRefreshToken = 0,
  busy,
  setError,
  setBusy,
}) {
  const [selectedId, setSelectedId] = useState(() =>
    lockedStudentId ? String(lockedStudentId) : ""
  );
  const [portfolio, setPortfolio] = useState(null);
  const [category, setCategory] = useState(null);
  const [stockIndustry, setStockIndustry] = useState("All");
  const [showClass, setShowClass] = useState(false);
  const [showNews, setShowNews] = useState(false);
  const [marketItems, setMarketItems] = useState([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [chartTicker, setChartTicker] = useState(null);
  const [shares, setShares] = useState("1");
  const [refreshing, setRefreshing] = useState(false);
  // Stocks/etc: { ticker, action, qty }. Currencies: { ticker, action, mode:'usd', usd:string }
  const [tradeDraft, setTradeDraft] = useState(null);
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [tradePulse, setTradePulse] = useState(null); // { ticker, action }
  const tradePulseTimer = useRef(null);

  useEffect(() => {
    if (lockedStudentId) setSelectedId(String(lockedStudentId));
  }, [lockedStudentId]);

  useEffect(() => {
    return () => {
      if (tradePulseTimer.current) clearTimeout(tradePulseTimer.current);
    };
  }, []);

  async function loadPortfolio(id) {
    const data = await getStudent(Number(id));
    setPortfolio(data);
    return data;
  }

  useEffect(() => {
    if (!selectedId) {
      setPortfolio(null);
      setCategory(null);
      setSelectedAsset(null);
      setChartTicker(null);
      setShowNews(false);
      setShowClass(false);
      setSelectedHolding(null);
      setTradeDraft(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const data = await getStudent(Number(selectedId));
        if (!cancelled) setPortfolio(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, setBusy, setError]);

  useEffect(() => {
    if (!selectedId || !portfolioRefreshToken) return;
    loadPortfolio(selectedId).catch(() => {});
  }, [portfolioRefreshToken, selectedId]);

  useEffect(() => {
    if (!category) {
      setMarketItems([]);
      return;
    }
    setStockIndustry("All");
    setSelectedAsset(null);
    setChartTicker(null);
    setTradeDraft(null);
    let cancelled = false;
    (async () => {
      setMarketLoading(true);
      setError("");
      try {
        const data = await getMarket(category);
        if (!cancelled) setMarketItems(data.items || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setMarketLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [category, setError]);

  async function refreshAll() {
    if (!selectedId) return;
    setRefreshing(true);
    setError("");
    try {
      await loadPortfolio(selectedId);
      if (category) {
        const data = await getMarket(category, true);
        setMarketItems(data.items || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  async function trade(action) {
    if (!selectedId || !selectedAsset) return;
    const qty = Number(shares);
    if (!qty || qty <= 0) {
      setError("Enter a share quantity.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fn = action === "buy" ? buyShares : sellShares;
      const data = await fn(Number(selectedId), selectedAsset.ticker, qty);
      setPortfolio(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (category && (enabledMarkets || DEFAULT_MARKETS)[category] === false) {
      setCategory(null);
      setSelectedAsset(null);
      setChartTicker(null);
      setTradeDraft(null);
    }
  }, [category, enabledMarkets]);

  const categoryMeta = CATEGORIES.find((c) => c.id === category);
  const availableCategories = categoriesForGoal(investmentGoal).filter(
    (c) => (enabledMarkets || DEFAULT_MARKETS)[c.id] !== false
  );
  const heldTickers = new Set((portfolio?.holdings || []).map((h) => h.ticker));
  const stockIndustries = [
    "All",
    ...Array.from(
      new Set(
        marketItems
          .map((item) => item.industry)
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b)),
  ];
  const visibleMarketItems =
    category === "stocks" && stockIndustry !== "All"
      ? marketItems.filter((item) => item.industry === stockIndustry)
      : marketItems;

  function currencyUnitsFromUsd(item, usd) {
    const price = Number(item?.price);
    const dollars = Number(usd);
    if (!Number.isFinite(price) || price <= 0) return null;
    if (!Number.isFinite(dollars) || dollars <= 0) return null;
    return dollars / price;
  }

  function formatCurrencyPreview(item, units) {
    if (units == null) return null;
    const lot = Number(item.lot) || 1;
    const foreign = units * lot;
    const rounded = foreign >= 100 ? foreign.toFixed(0) : foreign.toFixed(2);
    if (item.ticker === "EUR") return `≈ €${rounded}`;
    if (item.ticker === "GBP") return `≈ £${rounded}`;
    if (item.ticker === "JPY") return `≈ ¥${rounded}`;
    if (item.ticker === "MXN") return `≈ $${rounded} MXN`;
    if (item.unit_label) return `≈ ${rounded} ${item.unit_label}`;
    return `≈ ${rounded} ${item.ticker}`;
  }

  async function quickTrade(item, action, qtyOverride) {
    if (tradeDraft?.source !== "holding") {
      setSelectedAsset(item);
    }
    if (!selectedId) return;

    let qty = Number(qtyOverride);
    if (tradeDraft?.sellAll && action === "sell") {
      qty = Math.round(Number(qtyOverride) * 1e6) / 1e6;
      if (!Number.isFinite(qty) || qty <= 0) {
        setError("Nothing to sell.");
        return;
      }
    } else if (item.asset_type === "currency" && tradeDraft?.mode === "usd") {
      qty = currencyUnitsFromUsd(item, tradeDraft.usd);
      if (qty == null) {
        setError(
          action === "buy"
            ? "Enter how many U.S. dollars you want to spend."
            : "Enter how many U.S. dollars worth you want to sell back."
        );
        return;
      }
      qty = Math.round(qty * 1e6) / 1e6;
    } else if (item.asset_type === "bond" && tradeDraft?.mode === "bond") {
      const face = snapBondFace(tradeDraft.faceUsd);
      const unitFace = Number(item.face_value) || Number(item.price) || 100;
      qty = face / unitFace;
      if (!qty || qty <= 0) {
        setError("Pick at least $100 face value.");
        return;
      }
    } else {
      qty = Math.max(1, Math.round(Number(qtyOverride ?? shares)) || 1);
      if (!qty || qty <= 0) {
        setError("Pick a quantity of at least 1 share.");
        return;
      }
    }

    setBusy(true);
    setError("");
    try {
      const fn = action === "buy" ? buyShares : sellShares;
      const data = await fn(Number(selectedId), item.ticker, qty);
      setPortfolio(data);
      setTradeDraft(null);
      setSelectedAsset(null);
      setSelectedHolding(null);
      setShares(String(qty));
      setTradePulse({ ticker: item.ticker, action });
      if (action === "buy") {
        setChartTicker((prev) => (prev === item.ticker ? null : prev));
      }
      if (tradePulseTimer.current) clearTimeout(tradePulseTimer.current);
      tradePulseTimer.current = setTimeout(() => {
        setTradePulse(null);
      }, 900);
    } catch (err) {
      const msg = err?.message || "";
      // Affordability is already shown by the greyed-out confirm control —
      // never surface the raw cash/shares shortage toast.
      if (/^Not enough/i.test(msg)) {
        setError("");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  function snapBondFace(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 100;
    return Math.max(100, Math.round(n / 100) * 100);
  }

  function formatBondInterestPreview(item, faceUsd) {
    const income = item?.interest_to_horizon;
    if (!income) return null;
    if (income.matured) return "no remaining interest";
    const face = snapBondFace(faceUsd);
    const unitFace = Number(item.face_value) || Number(item.price) || 100;
    const units = face / unitFace;
    const total = (Number(income.interest_per_unit) || 0) * units;
    return `${money(total)} by May 15, 2027`;
  }

  function openTradeDraft(item, action) {
    setSelectedAsset(item);
    if (item.asset_type === "currency") {
      setTradeDraft({
        ticker: item.ticker,
        action,
        mode: "usd",
        source: "market",
        usd:
          tradeDraft?.ticker === item.ticker && tradeDraft.mode === "usd"
            ? tradeDraft.usd
            : "",
      });
      return;
    }
    if (item.asset_type === "bond") {
      const prevFace =
        tradeDraft?.ticker === item.ticker && tradeDraft.mode === "bond"
          ? tradeDraft.faceUsd
          : 100;
      setTradeDraft({
        ticker: item.ticker,
        action,
        mode: "bond",
        source: "market",
        faceUsd: snapBondFace(prevFace),
      });
      return;
    }
    setTradeDraft({
      ticker: item.ticker,
      action,
      source: "market",
      qty: tradeDraft?.ticker === item.ticker && !tradeDraft.mode ? tradeDraft.qty : 1,
      qtyEditing: false,
    });
  }

  function openHoldingSell(h, options = {}) {
    const item = holdingAsTradeItem(h);
    setSelectedHolding(h.ticker);
    if (options.all) {
      setTradeDraft({
        ticker: h.ticker,
        action: "sell",
        source: "holding",
        sellAll: true,
      });
      return;
    }
    if (item.asset_type === "currency") {
      setTradeDraft({
        ticker: h.ticker,
        action: "sell",
        mode: "usd",
        source: "holding",
        usd: "",
      });
      return;
    }
    if (item.asset_type === "bond") {
      setTradeDraft({
        ticker: h.ticker,
        action: "sell",
        mode: "bond",
        source: "holding",
        faceUsd: 100,
      });
      return;
    }
    setTradeDraft({
      ticker: h.ticker,
      action: "sell",
      source: "holding",
      qty: 1,
      qtyEditing: false,
    });
  }

  function bumpDraftQty(delta) {
    setTradeDraft((prev) => {
      if (!prev || prev.mode === "usd" || prev.mode === "bond") return prev;
      const current = Math.max(1, Math.round(Number(prev.qty)) || 1);
      return { ...prev, qty: Math.max(1, current + delta), qtyEditing: false };
    });
  }

  function setDraftQtyInput(value) {
    const cleaned = value.replace(/[^\d]/g, "");
    setTradeDraft((prev) =>
      prev && !prev.mode ? { ...prev, qty: cleaned, qtyEditing: true } : prev
    );
  }

  function commitDraftQty() {
    setTradeDraft((prev) => {
      if (!prev || prev.mode) return prev;
      const n = Math.max(1, Math.round(Number(prev.qty)) || 1);
      return { ...prev, qty: n, qtyEditing: false };
    });
  }

  function startQtyEdit() {
    setTradeDraft((prev) =>
      prev && !prev.mode ? { ...prev, qtyEditing: true } : prev
    );
  }

  function bumpBondFace(delta) {
    setTradeDraft((prev) => {
      if (!prev || prev.mode !== "bond") return prev;
      const current = snapBondFace(prev.faceUsd);
      return { ...prev, faceUsd: Math.max(100, current + delta) };
    });
  }

  function setBondFaceInput(value) {
    const cleaned = value.replace(/[^\d]/g, "");
    setTradeDraft((prev) => (prev ? { ...prev, faceUsd: cleaned } : prev));
  }

  function setDraftUsd(value) {
    // Allow digits and one decimal point while typing.
    const cleaned = value.replace(/[^\d.]/g, "");
    const parts = cleaned.split(".");
    const normalized =
      parts.length <= 1
        ? cleaned
        : `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}`;
    setTradeDraft((prev) => (prev ? { ...prev, usd: normalized } : prev));
  }

  return (
    <section className="panel student-panel">
      <header className="panel-header student-header">
        <div className="student-header-copy">
          <h2>{portfolio ? portfolio.name : "Student portfolio"}</h2>
          <p>Pick a market and put your classroom cash to work.</p>
        </div>
        <div className="student-header-right">
          <Suspense fallback={<div className="character-stage character-stage-fallback" />}>
            <StudentCharacter
              studentId={portfolio?.id}
              name={portfolio?.name || "Student"}
              cash={portfolio?.cash ?? 0}
              onCashChange={() => {
                if (selectedId) loadPortfolio(selectedId).catch(() => {});
              }}
            />
          </Suspense>
        </div>
      </header>

      {!lockedStudentId && (
        <label className="select-label testing-only">
          Who are you? <span>(teacher preview)</span>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">Select a student</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {portfolio && (
        <>
          <div
            className={
              category || showClass || showNews
                ? "student-dash collapsed"
                : "student-dash"
            }
            aria-hidden={Boolean(category || showClass || showNews)}
          >
            <div className="student-dash-inner">
              <div className="balance-strip">
                <div>
                  <span>Cash</span>
                  <strong>{money(portfolio.cash)}</strong>
                </div>
                <div>
                  <span>Portfolio</span>
                  <strong>{money(portfolio.portfolio_value)}</strong>
                </div>
                <div>
                  <span>Total</span>
                  <strong>{money(portfolio.total_value)}</strong>
                </div>
              </div>

              <PortfolioHistoryChart
                studentId={portfolio.id}
                portfolio={portfolio}
                refreshKey={`${portfolio.cash}-${portfolio.portfolio_value}-${portfolio.total_value}`}
                onRefresh={refreshAll}
              />
            </div>
          </div>

          {showClass && (
            <ClassView
              currentStudentId={portfolio.id}
              onBack={() => setShowClass(false)}
            />
          )}

          {showNews && !showClass && (
            <NewsFeed
              onBack={() => setShowNews(false)}
            />
          )}

          {!category && !showClass && !showNews && (
            <div className="home-menu">
              <div className="home-tools" aria-label="Classroom">
                <button
                  type="button"
                  className="home-tool home-tool-standings"
                  data-click="select"
                  onClick={() => {
                    setShowClass(true);
                    setShowNews(false);
                    setSelectedAsset(null);
                    setTradeDraft(null);
                  }}
                >
                  <span className="home-tool-kicker">Classroom</span>
                  <strong>Standings</strong>
                  <span className="home-tool-go" aria-hidden="true">
                    →
                  </span>
                </button>
                <button
                  type="button"
                  className="home-tool home-tool-news"
                  data-click="select"
                  onClick={() => {
                    setShowNews(true);
                    setShowClass(false);
                    setSelectedAsset(null);
                    setTradeDraft(null);
                  }}
                >
                  <span className="home-tool-kicker">Today</span>
                  <strong>News desk</strong>
                  <span className="home-tool-go" aria-hidden="true">
                    →
                  </span>
                </button>
              </div>

              <div className="market-menu">
                <div className="market-menu-head">
                  <p className="market-menu-kicker">Trade</p>
                  <h3>Pick a market</h3>
                  <p className="market-menu-lead">
                    Open a floor, browse prices, and put cash to work.
                  </p>
                </div>
                <div className="market-lanes" role="list">
                  {availableCategories.map((c, i) => (
                    <button
                      key={c.id}
                      type="button"
                      role="listitem"
                      className={`market-lane market-lane-${c.id}`}
                      data-click="select"
                      style={{ animationDelay: `${i * 45}ms` }}
                      onClick={() => {
                        setCategory(c.id);
                        setSelectedAsset(null);
                        setChartTicker(null);
                      }}
                    >
                      <span className="market-lane-mark" aria-hidden="true">
                        {c.mark || String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="market-lane-copy">
                        <strong>{c.title}</strong>
                        <span>{c.blurb}</span>
                      </span>
                      <span className="market-lane-go" aria-hidden="true">
                        →
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {category && !showClass && !showNews && (
            <div className="market-view">
              <div className="market-toolbar">
                <button
                  type="button"
                  className="ghost-btn"
                  data-click="select"
                  onClick={() => {
                    setCategory(null);
                    setSelectedAsset(null);
                    setChartTicker(null);
                    setTradeDraft(null);
                    setStockIndustry("All");
                  }}
                >
                  ← All markets
                </button>
                <h3 className="market-heading">
                  {categoryMeta?.title}
                  {category === "bonds" && <BondGlossaryTip />}
                </h3>
              </div>

              {category === "stocks" && stockIndustries.length > 1 && (
                <div className="industry-tags" role="tablist" aria-label="Filter by industry">
                  {stockIndustries.map((industry) => (
                    <button
                      key={industry}
                      type="button"
                      role="tab"
                      aria-selected={stockIndustry === industry}
                      className={
                        stockIndustry === industry
                          ? "industry-tag active"
                          : "industry-tag"
                      }
                      data-click="select"
                      onClick={() => {
                        setStockIndustry(industry);
                        setSelectedAsset(null);
                        setChartTicker(null);
                        setTradeDraft(null);
                      }}
                    >
                      {industry}
                    </button>
                  ))}
                </div>
              )}

              {category === "currencies" && (
                <p className="bond-note currency-explain">
                  Cash stays in U.S. dollars. Tap Buy and type how many dollars you want to
                  exchange — you’ll get that much foreign currency at today’s rate.
                </p>
              )}

              {category === "realestate" && (
                <p className="bond-note currency-explain">
                  Explore Florida housing markets on the map. Upfront you pay the down
                  payment plus closing costs — the rest is a classroom mortgage.
                </p>
              )}

              {marketLoading && <p className="empty">Loading live prices…</p>}

              {!marketLoading && category === "realestate" && (
                visibleMarketItems.length === 0 ? (
                  <p className="empty">No cities available yet.</p>
                ) : (
                  <FloridaRealEstateMap
                    items={visibleMarketItems}
                    moneyFormat={money}
                    cash={portfolio?.cash || 0}
                    ownedTickers={heldTickers}
                    busy={busy}
                    onBuyHome={async (item) => {
                      if (!selectedId) return;
                      setBusy(true);
                      setError("");
                      try {
                        const data = await buyHome(Number(selectedId), item.ticker);
                        setPortfolio(data);
                        setTradePulse({ ticker: item.ticker, action: "buy" });
                        if (tradePulseTimer.current) clearTimeout(tradePulseTimer.current);
                        tradePulseTimer.current = setTimeout(() => setTradePulse(null), 900);
                      } catch (err) {
                        setError(err.message || "Could not buy that home");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                )
              )}

              {!marketLoading && category !== "realestate" && (
                <div className="market-list">
                  {visibleMarketItems.length === 0 && (
                    <p className="empty">No stocks in this industry yet.</p>
                  )}
                  {visibleMarketItems.map((item) => {
                    const selected = selectedAsset?.ticker === item.ticker;
                    const held = heldTickers.has(item.ticker);
                    const draftOpen =
                      tradeDraft &&
                      tradeDraft.ticker === item.ticker &&
                      tradeDraft.source !== "holding" &&
                      selected;
                    const usdAmount =
                      draftOpen && tradeDraft.mode === "usd"
                        ? Number(tradeDraft.usd)
                        : NaN;
                    const bondFaceRaw =
                      draftOpen && tradeDraft.mode === "bond"
                        ? Number(tradeDraft.faceUsd)
                        : NaN;
                    const bondFaceSnapped =
                      Number.isFinite(bondFaceRaw) && bondFaceRaw > 0
                        ? Math.max(100, Math.round(bondFaceRaw / 100) * 100)
                        : NaN;
                    const cashAvail = Number(portfolio?.cash) || 0;
                    const heldRow = (portfolio?.holdings || []).find(
                      (h) => h.ticker === item.ticker
                    );
                    const heldUsd =
                      Number(heldRow?.market_value) ||
                      (Number(heldRow?.shares) || 0) * (Number(item.price) || 0);
                    const heldBondFace =
                      (Number(heldRow?.shares) || 0) *
                      (Number(item.face_value) || Number(item.price) || 100);
                    const isShareTrade = draftOpen && !tradeDraft.mode;
                    const draftQty = isShareTrade
                      ? Math.round(Number(tradeDraft.qty))
                      : NaN;
                    const shareCost =
                      Number.isFinite(draftQty) && Number(item.price) > 0
                        ? draftQty * Number(item.price)
                        : NaN;
                    const heldShares = Number(heldRow?.shares) || 0;
                    const buyBlocked =
                      draftOpen &&
                      tradeDraft.action === "buy" &&
                      ((item.asset_type === "currency" &&
                        (!Number.isFinite(usdAmount) ||
                          usdAmount <= 0 ||
                          usdAmount > cashAvail + 0.0001)) ||
                        (item.asset_type === "bond" &&
                          (!Number.isFinite(bondFaceSnapped) ||
                            bondFaceSnapped > cashAvail + 0.0001)) ||
                        (isShareTrade &&
                          (!Number.isFinite(draftQty) ||
                            draftQty <= 0 ||
                            !Number.isFinite(shareCost) ||
                            shareCost > cashAvail + 0.0001)));
                    const sellBlocked =
                      draftOpen &&
                      tradeDraft.action === "sell" &&
                      ((item.asset_type === "currency" &&
                        (!Number.isFinite(usdAmount) ||
                          usdAmount <= 0 ||
                          usdAmount > heldUsd + 0.0001)) ||
                        (item.asset_type === "bond" &&
                          (!Number.isFinite(bondFaceSnapped) ||
                            bondFaceSnapped > heldBondFace + 0.0001)) ||
                        (isShareTrade &&
                          (!Number.isFinite(draftQty) ||
                            draftQty <= 0 ||
                            draftQty > heldShares + 0.0001)));
                    const chartOpen = chartTicker === item.ticker;
                    const pulsing =
                      tradePulse && tradePulse.ticker === item.ticker;
                    return (
                      <div key={item.ticker} className="market-item">
                      <div
                        className={[
                          "market-row",
                          selected ? "selected" : "",
                          chartOpen ? "chart-open" : "",
                          pulsing ? `trade-pulse trade-pulse-${tradePulse.action}` : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        role="button"
                        tabIndex={0}
                        data-click="select"
                        onClick={() => {
                          if (pulsing) return;
                          setSelectedAsset(item);
                          if (tradeDraft?.ticker !== item.ticker) setTradeDraft(null);
                          setChartTicker((prev) => (prev && prev !== item.ticker ? null : prev));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedAsset(item);
                            setChartTicker((prev) => (prev && prev !== item.ticker ? null : prev));
                          }
                        }}
                      >
                        <div className="market-identity">
                          <strong>{item.ticker}</strong>
                          <span className="market-name-row">
                            {item.name}
                            {item.info && item.asset_type !== "bond" && (
                              <CommodityInfoTip
                                name={item.name}
                                kind={
                                  item.asset_type === "commodity"
                                    ? item.kind || "Commodity"
                                    : item.asset_type === "currency"
                                      ? item.kind || "Currency"
                                      : category === "etfs"
                                        ? "ETF"
                                        : "Company"
                                }
                                info={item.info}
                              />
                            )}
                            {item.asset_type !== "bond" && (
                              <button
                                type="button"
                                className={
                                  chartOpen
                                    ? "market-chart-btn active"
                                    : "market-chart-btn"
                                }
                                data-click="select"
                                aria-label={
                                  chartOpen
                                    ? `Hide ${item.ticker} chart`
                                    : `Show ${item.ticker} chart`
                                }
                                aria-pressed={chartOpen}
                                title="Price chart"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setChartTicker((prev) =>
                                    prev === item.ticker ? null : item.ticker
                                  );
                                }}
                                onKeyDown={(e) => e.stopPropagation()}
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  width="12"
                                  height="12"
                                  aria-hidden="true"
                                  fill="none"
                                >
                                  <path
                                    d="M4 19V5"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                  />
                                  <path
                                    d="M4 19h16"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                  />
                                  <path
                                    d="M7 15l3.2-3.6 2.6 2.2L17 8"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
                            )}
                          </span>
                          {item.asset_type === "bond" && (
                            <span className="bond-meta">
                              {item.kind}
                              {item.maturity ? ` · matures ${item.maturity}` : ""}
                              {item.as_of ? ` · yield as of ${item.as_of}` : ""}
                            </span>
                          )}
                          {category === "stocks" && item.industry && (
                            <span className="bond-meta stock-industry-meta">
                              {item.industry}
                            </span>
                          )}
                          {item.asset_type === "commodity" && item.kind && (
                            <span className="bond-meta commodity-meta">{item.kind}</span>
                          )}
                          {item.asset_type === "currency" && (
                            <span className="bond-meta currency-meta">
                              {item.kind || "Currency"}
                              {item.price != null
                                ? ` · ${money(item.price)} per ${
                                    item.ticker === "JPY"
                                      ? "¥100"
                                      : item.ticker === "MXN"
                                        ? "₱10"
                                        : item.ticker.toLowerCase()
                                  }`
                                : ""}
                            </span>
                          )}
                        </div>
                        <div className="market-row-actions">
                          {selected && (
                            <div className="row-trade-btns">
                              {(!draftOpen || tradeDraft.action === "buy") && (
                              <div
                                className={
                                  draftOpen && tradeDraft.action === "buy"
                                    ? "buy-flow open"
                                    : "buy-flow"
                                }
                              >
                                <button
                                  type="button"
                                  className={
                                    draftOpen && tradeDraft.action === "buy"
                                      ? buyBlocked
                                        ? "row-buy confirm disabled"
                                        : "row-buy confirm"
                                      : "row-buy"
                                  }
                                  data-click={
                                    draftOpen && tradeDraft.action === "buy"
                                      ? buyBlocked
                                        ? "select"
                                        : "confirm"
                                      : "select"
                                  }
                                  disabled={Boolean(buyBlocked)}
                                  aria-disabled={Boolean(buyBlocked)}
                                  aria-label={
                                    draftOpen && tradeDraft.action === "buy"
                                      ? buyBlocked
                                        ? "Not enough cash"
                                        : "Confirm buy"
                                      : "Buy"
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (draftOpen && tradeDraft.action === "buy") {
                                      if (buyBlocked) return;
                                      quickTrade(item, "buy", tradeDraft.qty);
                                    } else {
                                      openTradeDraft(item, "buy");
                                    }
                                  }}
                                >
                                  {draftOpen && tradeDraft.action === "buy" ? (
                                    <span className="check-mark" aria-hidden="true">
                                      ✓
                                    </span>
                                  ) : (
                                    "Buy"
                                  )}
                                </button>
                                {draftOpen && tradeDraft.action === "buy" && (
                                  item.asset_type === "currency" ? (
                                    <div
                                      className="fx-spend"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <label className="fx-spend-field">
                                        <span className="fx-dollar">$</span>
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          autoFocus
                                          aria-label="U.S. dollars to spend"
                                          value={tradeDraft.usd}
                                          onChange={(e) => setDraftUsd(e.target.value)}
                                          onKeyDown={(e) => {
                                            e.stopPropagation();
                                            if (e.key === "Enter") {
                                              e.preventDefault();
                                              if (buyBlocked) return;
                                              quickTrade(item, "buy");
                                            }
                                          }}
                                        />
                                        <span className="fx-usd-label">USD</span>
                                      </label>
                                      <span
                                        className={
                                          buyBlocked && Number(tradeDraft.usd) > 0
                                            ? "fx-preview over"
                                            : "fx-preview"
                                        }
                                      >
                                        {buyBlocked && Number(tradeDraft.usd) > cashAvail
                                          ? "choose a smaller amount"
                                          : formatCurrencyPreview(
                                              item,
                                              currencyUnitsFromUsd(item, tradeDraft.usd)
                                            ) || "enter amount"}
                                      </span>
                                    </div>
                                  ) : item.asset_type === "bond" ? (
                                    <div
                                      className="bond-stepper"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <div className="bond-stepper-row">
                                        <button
                                          type="button"
                                          className="qty-btn"
                                          data-click="adjust"
                                          aria-label="Decrease by $100"
                                          onClick={() => bumpBondFace(-100)}
                                        >
                                          −
                                        </button>
                                        <label className="bond-face-field">
                                          <span>$</span>
                                          <input
                                            type="text"
                                            inputMode="numeric"
                                            autoFocus
                                            aria-label="Bond face value in dollars"
                                            value={tradeDraft.faceUsd}
                                            onChange={(e) => setBondFaceInput(e.target.value)}
                                            onBlur={() =>
                                              setTradeDraft((prev) =>
                                                prev?.mode === "bond"
                                                  ? { ...prev, faceUsd: snapBondFace(prev.faceUsd) }
                                                  : prev
                                              )
                                            }
                                            onKeyDown={(e) => {
                                              e.stopPropagation();
                                              if (e.key === "Enter") {
                                                e.preventDefault();
                                                setTradeDraft((prev) =>
                                                  prev?.mode === "bond"
                                                    ? {
                                                        ...prev,
                                                        faceUsd: snapBondFace(prev.faceUsd),
                                                      }
                                                    : prev
                                                );
                                                if (buyBlocked) return;
                                                quickTrade(item, "buy");
                                              }
                                              if (e.key === "ArrowUp") {
                                                e.preventDefault();
                                                bumpBondFace(100);
                                              }
                                              if (e.key === "ArrowDown") {
                                                e.preventDefault();
                                                bumpBondFace(-100);
                                              }
                                            }}
                                          />
                                        </label>
                                        <button
                                          type="button"
                                          className="qty-btn"
                                          data-click="adjust"
                                          aria-label="Increase by $100"
                                          onClick={() => bumpBondFace(100)}
                                        >
                                          +
                                        </button>
                                      </div>
                                      <span
                                        className={
                                          buyBlocked &&
                                          Number.isFinite(bondFaceSnapped) &&
                                          bondFaceSnapped > cashAvail
                                            ? "fx-preview over"
                                            : "fx-preview bond-interest-preview"
                                        }
                                      >
                                        {buyBlocked &&
                                        Number.isFinite(bondFaceSnapped) &&
                                        bondFaceSnapped > cashAvail
                                          ? "choose a smaller amount"
                                          : formatBondInterestPreview(
                                              item,
                                              Number.isFinite(bondFaceSnapped)
                                                ? bondFaceSnapped
                                                : tradeDraft.faceUsd
                                            ) || "interest by May 15, 2027"}
                                      </span>
                                    </div>
                                  ) : (
                                    <div
                                      className={
                                        buyBlocked ? "share-stepper over" : "share-stepper"
                                      }
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <div
                                        className={
                                          buyBlocked ? "qty-stepper over" : "qty-stepper"
                                        }
                                      >
                                        <button
                                          type="button"
                                          className="qty-btn"
                                          data-click="adjust"
                                          aria-label="Decrease quantity"
                                          onClick={() => bumpDraftQty(-1)}
                                        >
                                          −
                                        </button>
                                        {tradeDraft.qtyEditing ? (
                                          <input
                                            className="qty-value-input"
                                            type="text"
                                            inputMode="numeric"
                                            autoFocus
                                            aria-label="Quantity"
                                            value={tradeDraft.qty}
                                            onChange={(e) => setDraftQtyInput(e.target.value)}
                                            onFocus={(e) => e.target.select()}
                                            onBlur={commitDraftQty}
                                            onKeyDown={(e) => {
                                              e.stopPropagation();
                                              if (e.key === "Enter") {
                                                e.preventDefault();
                                                commitDraftQty();
                                                if (buyBlocked) return;
                                                quickTrade(item, "buy", Math.max(1, Math.round(Number(tradeDraft.qty)) || 1));
                                              }
                                              if (e.key === "Escape") {
                                                e.preventDefault();
                                                commitDraftQty();
                                              }
                                            }}
                                          />
                                        ) : (
                                          <button
                                            type="button"
                                            className="qty-value"
                                            data-click="select"
                                            aria-label="Edit quantity"
                                            onClick={startQtyEdit}
                                          >
                                            {tradeDraft.qty}
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          className="qty-btn"
                                          data-click="adjust"
                                          aria-label="Increase quantity"
                                          onClick={() => bumpDraftQty(1)}
                                        >
                                          +
                                        </button>
                                      </div>
                                      <span
                                        className={
                                          buyBlocked &&
                                          Number.isFinite(shareCost) &&
                                          shareCost > cashAvail
                                            ? "fx-preview over"
                                            : "fx-preview"
                                        }
                                      >
                                        {buyBlocked &&
                                        Number.isFinite(shareCost) &&
                                        shareCost > cashAvail
                                          ? "choose a smaller amount"
                                          : Number.isFinite(shareCost)
                                            ? money(shareCost)
                                            : "—"}
                                      </span>
                                    </div>
                                  )
                                )}
                              </div>
                              )}
                              {held && (!draftOpen || tradeDraft.action === "sell") && (
                                <div
                                  className={
                                    draftOpen && tradeDraft.action === "sell"
                                      ? "sell-flow open"
                                      : "sell-flow"
                                  }
                                >
                                  <button
                                    type="button"
                                    className={
                                      draftOpen && tradeDraft.action === "sell"
                                        ? sellBlocked
                                          ? "row-sell confirm disabled"
                                          : "row-sell confirm"
                                        : "row-sell"
                                    }
                                    data-click={
                                      draftOpen && tradeDraft.action === "sell"
                                        ? sellBlocked
                                          ? "select"
                                          : "confirm"
                                        : "select"
                                    }
                                    disabled={Boolean(sellBlocked)}
                                    aria-disabled={Boolean(sellBlocked)}
                                    aria-label={
                                      draftOpen && tradeDraft.action === "sell"
                                        ? sellBlocked
                                          ? "Not enough to sell"
                                          : "Confirm sell"
                                        : "Sell"
                                    }
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (draftOpen && tradeDraft.action === "sell") {
                                        if (sellBlocked) return;
                                        quickTrade(item, "sell", tradeDraft.qty);
                                      } else {
                                        openTradeDraft(item, "sell");
                                      }
                                    }}
                                  >
                                    {draftOpen && tradeDraft.action === "sell" ? (
                                      <span className="check-mark" aria-hidden="true">
                                        ✓
                                      </span>
                                    ) : (
                                      "Sell"
                                    )}
                                  </button>
                                  {draftOpen && tradeDraft.action === "sell" && (
                                    item.asset_type === "currency" ? (
                                      <div
                                        className="fx-spend"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <label className="fx-spend-field">
                                          <span className="fx-dollar">$</span>
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            autoFocus
                                            aria-label="U.S. dollars to get back"
                                            value={tradeDraft.usd}
                                            onChange={(e) => setDraftUsd(e.target.value)}
                                            onKeyDown={(e) => {
                                              e.stopPropagation();
                                              if (e.key === "Enter") {
                                                e.preventDefault();
                                                if (sellBlocked) return;
                                                quickTrade(item, "sell");
                                              }
                                            }}
                                          />
                                          <span className="fx-usd-label">USD</span>
                                        </label>
                                        <span
                                          className={
                                            sellBlocked && Number(tradeDraft.usd) > 0
                                              ? "fx-preview over"
                                              : "fx-preview"
                                          }
                                        >
                                          {sellBlocked && Number(tradeDraft.usd) > heldUsd
                                            ? "choose a smaller amount"
                                            : formatCurrencyPreview(
                                                item,
                                                currencyUnitsFromUsd(item, tradeDraft.usd)
                                              ) || "enter amount"}
                                        </span>
                                      </div>
                                    ) : item.asset_type === "bond" ? (
                                      <div
                                        className="bond-stepper"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className="bond-stepper-row">
                                          <button
                                            type="button"
                                            className="qty-btn"
                                            data-click="adjust"
                                            aria-label="Decrease by $100"
                                            onClick={() => bumpBondFace(-100)}
                                          >
                                            −
                                          </button>
                                          <label className="bond-face-field">
                                            <span>$</span>
                                            <input
                                              type="text"
                                              inputMode="numeric"
                                              autoFocus
                                              aria-label="Bond face value to sell"
                                              value={tradeDraft.faceUsd}
                                              onChange={(e) => setBondFaceInput(e.target.value)}
                                              onBlur={() =>
                                                setTradeDraft((prev) =>
                                                  prev?.mode === "bond"
                                                    ? {
                                                        ...prev,
                                                        faceUsd: snapBondFace(prev.faceUsd),
                                                      }
                                                    : prev
                                                )
                                              }
                                              onKeyDown={(e) => {
                                                e.stopPropagation();
                                                if (e.key === "Enter") {
                                                  e.preventDefault();
                                                  setTradeDraft((prev) =>
                                                    prev?.mode === "bond"
                                                      ? {
                                                          ...prev,
                                                          faceUsd: snapBondFace(prev.faceUsd),
                                                        }
                                                      : prev
                                                  );
                                                  if (sellBlocked) return;
                                                  quickTrade(item, "sell");
                                                }
                                                if (e.key === "ArrowUp") {
                                                  e.preventDefault();
                                                  bumpBondFace(100);
                                                }
                                                if (e.key === "ArrowDown") {
                                                  e.preventDefault();
                                                  bumpBondFace(-100);
                                                }
                                              }}
                                            />
                                          </label>
                                          <button
                                            type="button"
                                            className="qty-btn"
                                            data-click="adjust"
                                            aria-label="Increase by $100"
                                            onClick={() => bumpBondFace(100)}
                                          >
                                            +
                                          </button>
                                        </div>
                                        <span
                                          className={
                                            sellBlocked &&
                                            Number.isFinite(bondFaceSnapped) &&
                                            bondFaceSnapped > heldBondFace
                                              ? "fx-preview over"
                                              : "fx-preview bond-interest-preview"
                                          }
                                        >
                                          {sellBlocked &&
                                          Number.isFinite(bondFaceSnapped) &&
                                          bondFaceSnapped > heldBondFace
                                            ? "choose a smaller amount"
                                            : formatBondInterestPreview(
                                                item,
                                                Number.isFinite(bondFaceSnapped)
                                                  ? bondFaceSnapped
                                                  : tradeDraft.faceUsd
                                              ) || "interest by May 15, 2027"}
                                        </span>
                                      </div>
                                    ) : (
                                      <div
                                        className={
                                          sellBlocked ? "share-stepper over" : "share-stepper"
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div
                                          className={
                                            sellBlocked ? "qty-stepper over" : "qty-stepper"
                                          }
                                        >
                                          <button
                                            type="button"
                                            className="qty-btn"
                                            data-click="adjust"
                                            aria-label="Decrease quantity"
                                            onClick={() => bumpDraftQty(-1)}
                                          >
                                            −
                                          </button>
                                          {tradeDraft.qtyEditing ? (
                                            <input
                                              className="qty-value-input"
                                              type="text"
                                              inputMode="numeric"
                                              autoFocus
                                              aria-label="Quantity"
                                              value={tradeDraft.qty}
                                              onChange={(e) => setDraftQtyInput(e.target.value)}
                                              onFocus={(e) => e.target.select()}
                                              onBlur={commitDraftQty}
                                              onKeyDown={(e) => {
                                                e.stopPropagation();
                                                if (e.key === "Enter") {
                                                  e.preventDefault();
                                                  commitDraftQty();
                                                  if (sellBlocked) return;
                                                  quickTrade(
                                                    item,
                                                    "sell",
                                                    Math.max(1, Math.round(Number(tradeDraft.qty)) || 1)
                                                  );
                                                }
                                                if (e.key === "Escape") {
                                                  e.preventDefault();
                                                  commitDraftQty();
                                                }
                                              }}
                                            />
                                          ) : (
                                            <button
                                              type="button"
                                              className="qty-value"
                                              data-click="select"
                                              aria-label="Edit quantity"
                                              onClick={startQtyEdit}
                                            >
                                              {tradeDraft.qty}
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            className="qty-btn"
                                            data-click="adjust"
                                            aria-label="Increase quantity"
                                            onClick={() => bumpDraftQty(1)}
                                          >
                                            +
                                          </button>
                                        </div>
                                        <span
                                          className={
                                            sellBlocked &&
                                            Number.isFinite(draftQty) &&
                                            draftQty > heldShares
                                              ? "fx-preview over"
                                              : "fx-preview"
                                          }
                                        >
                                          {sellBlocked &&
                                          Number.isFinite(draftQty) &&
                                          draftQty > heldShares
                                            ? "choose a smaller amount"
                                            : Number.isFinite(shareCost)
                                              ? money(shareCost)
                                              : "—"}
                                        </span>
                                      </div>
                                    )
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="market-price">
                            {item.asset_type === "bond" ? (
                              <>
                                <strong className="bond-yield">
                                  {item.yield_pct != null ? `${item.yield_pct.toFixed(2)}%` : "—"}
                                </strong>
                                <span>
                                  {money(item.price)} face
                                  {item.coupon_pct != null && item.coupon_pct > 0
                                    ? ` · ${item.coupon_pct.toFixed(2)}% coupon`
                                    : " · discount bill"}
                                </span>
                              </>
                            ) : (
                              <>
                                <strong>{money(item.price)}</strong>
                                <span
                                  className={
                                    item.change_pct == null
                                      ? ""
                                      : item.change_pct >= 0
                                        ? "up"
                                        : "down"
                                  }
                                >
                                  {item.change_pct == null
                                    ? "—"
                                    : `${item.change_pct >= 0 ? "+" : ""}${item.change_pct.toFixed(2)}%`}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {chartOpen && (
                        <div className="market-row-chart">
                          <PriceChart ticker={item.ticker} name={item.name} />
                        </div>
                      )}
                      </div>
                    );
                  })}
                </div>
              )}

              {selectedAsset?.asset_type === "bond" && (
                <div className="bond-detail">
                  <strong>{selectedAsset.name}</strong>
                  <p>
                    {selectedAsset.issuer} · {selectedAsset.kind} · matures{" "}
                    {selectedAsset.maturity}
                  </p>
                  <div className="bond-detail-stats">
                    <div>
                      <span>Yield</span>
                      <strong>{selectedAsset.yield_pct?.toFixed(2)}%</strong>
                    </div>
                    <div>
                      <span>Coupon</span>
                      <strong>
                        {selectedAsset.coupon_pct > 0
                          ? `${selectedAsset.coupon_pct.toFixed(2)}%`
                          : "Discount"}
                      </strong>
                    </div>
                    <div>
                      <span>Face / unit</span>
                      <strong>{money(selectedAsset.price)}</strong>
                    </div>
                    <div>
                      <span>Rate as of</span>
                      <strong>{selectedAsset.as_of}</strong>
                    </div>
                    {selectedAsset.interest_to_horizon && (
                      <div>
                        <span>Interest / $100 by May 15</span>
                        <strong>
                          {selectedAsset.interest_to_horizon.matured
                            ? "Matured"
                            : money(selectedAsset.interest_to_horizon.interest_per_unit)}
                        </strong>
                      </div>
                    )}
                  </div>
                  {selectedAsset.note && <p className="bond-note">{selectedAsset.note}</p>}
                  <p className="bond-note">
                    U.S. Treasury yields update from the official Daily Treasury Par Yield
                    Curve. Corporates keep their fixed coupons. Bonds are sold in{" "}
                    <strong>$100 face</strong> increments. Interest shown is fixed income per
                    $100 unit from today through May 15, 2027 (or maturity if sooner).
                  </p>
                </div>
              )}
            </div>
          )}

          {!showClass && !showNews && (
          <section className="holdings" aria-label="Your holdings">
            <div className="holdings-head">
              <h3>Your holdings</h3>
              <p>Tap a holding, then Sell or Sell all</p>
            </div>
            {(!portfolio.holdings || portfolio.holdings.length === 0) && (
              <p className="empty">No shares yet. Pick a market above to start.</p>
            )}
            {portfolio.holdings?.length > 0 && (
              <div className="holdings-cols" aria-hidden="true">
                <span>Holding</span>
                <span>Cost basis</span>
                <span>Value</span>
                <span>Gain / loss</span>
                <span />
              </div>
            )}
            <div className="holdings-list">
            {portfolio.holdings?.map((h) => {
              const isBond = isBondTicker(h.ticker);
              const isCurrency = h.ticker in CURRENCY_LOTS;
              const item = holdingAsTradeItem(h);
              const holdingOpen =
                tradeDraft?.source === "holding" &&
                tradeDraft.ticker === h.ticker &&
                tradeDraft.action === "sell";
              const pulsing =
                tradePulse &&
                tradePulse.ticker === h.ticker &&
                tradePulse.action === "sell";
              const usdAmount =
                holdingOpen && tradeDraft.mode === "usd"
                  ? Number(tradeDraft.usd)
                  : NaN;
              const bondFaceRaw =
                holdingOpen && tradeDraft.mode === "bond"
                  ? Number(tradeDraft.faceUsd)
                  : NaN;
              const bondFaceSnapped =
                Number.isFinite(bondFaceRaw) && bondFaceRaw > 0
                  ? Math.max(100, Math.round(bondFaceRaw / 100) * 100)
                  : NaN;
              const heldUsd =
                Number(h.market_value) ||
                (Number(h.shares) || 0) * (Number(h.price) || 0);
              const heldBondFace = (Number(h.shares) || 0) * 100;
              const heldShares = Number(h.shares) || 0;
              const isShareTrade = holdingOpen && !tradeDraft.mode;
              const draftQty = isShareTrade
                ? Math.round(Number(tradeDraft.qty))
                : NaN;
              const shareProceeds =
                Number.isFinite(draftQty) && Number(h.price) > 0
                  ? draftQty * Number(h.price)
                  : NaN;
              const sellBlocked =
                holdingOpen &&
                ((item.asset_type === "currency" &&
                  (!Number.isFinite(usdAmount) ||
                    usdAmount <= 0 ||
                    usdAmount > heldUsd + 0.0001)) ||
                  (item.asset_type === "bond" &&
                    (!Number.isFinite(bondFaceSnapped) ||
                      bondFaceSnapped > heldBondFace + 0.0001)) ||
                  (isShareTrade &&
                    (!Number.isFinite(draftQty) ||
                      draftQty <= 0 ||
                      draftQty > heldShares + 0.0001)));

              const costBasis =
                h.cost_basis != null
                  ? Number(h.cost_basis)
                  : (Number(h.avg_cost) || 0) * (Number(h.shares) || 0);
              const gainPct =
                h.gain_loss_pct != null
                  ? Number(h.gain_loss_pct)
                  : costBasis > 0 && h.gain_loss != null
                    ? (Number(h.gain_loss) / costBasis) * 100
                    : null;

              let qtyLabel;
              if (isBond) {
                qtyLabel = `${h.shares} units · avg ${money(h.avg_cost)}`;
              } else if (isCurrency) {
                const foreign = Number(h.shares) * CURRENCY_LOTS[h.ticker];
                const fx =
                  h.ticker === "EUR"
                    ? `€${foreign.toFixed(2)}`
                    : h.ticker === "GBP"
                      ? `£${foreign.toFixed(2)}`
                      : h.ticker === "JPY"
                        ? `¥${foreign.toFixed(0)}`
                        : h.ticker === "MXN"
                          ? `$${foreign.toFixed(2)} MXN`
                          : `${foreign.toFixed(2)} ${h.ticker}`;
                qtyLabel = `${fx} · avg ${money(h.avg_cost)}`;
              } else if (item.asset_type === "realestate") {
                qtyLabel = `${h.name || h.ticker} · loan ${money(h.mortgage_balance)}`;
              } else {
                qtyLabel = `${h.shares} shares · avg ${money(h.avg_cost)}`;
              }
              const holdingSelected = selectedHolding === h.ticker;
              return (
              <div
                key={h.ticker}
                className={[
                  "holding-row",
                  holdingSelected ? "selected" : "",
                  holdingOpen ? "open" : "",
                  pulsing ? "trade-pulse trade-pulse-sell" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="button"
                tabIndex={0}
                data-click="select"
                onClick={() => {
                  if (pulsing) return;
                  if (selectedHolding === h.ticker) {
                    setSelectedHolding(null);
                    if (tradeDraft?.source === "holding") setTradeDraft(null);
                    return;
                  }
                  setSelectedHolding(h.ticker);
                  if (tradeDraft?.source === "holding") setTradeDraft(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (selectedHolding === h.ticker) {
                      setSelectedHolding(null);
                      if (tradeDraft?.source === "holding") setTradeDraft(null);
                    } else {
                      setSelectedHolding(h.ticker);
                      if (tradeDraft?.source === "holding") setTradeDraft(null);
                    }
                  }
                }}
              >
                <div className="holding-identity">
                  <strong>{h.ticker}</strong>
                  <span>{qtyLabel}</span>
                </div>

                <div className="holding-stat">
                  <span className="holding-stat-label">Cost basis</span>
                  <strong>{money(costBasis)}</strong>
                </div>

                <div className="holding-stat">
                  <span className="holding-stat-label">
                    {item.asset_type === "realestate" ? "Equity" : "Value"}
                  </span>
                  <strong>
                    {money(
                      item.asset_type === "realestate" && h.equity != null
                        ? h.equity
                        : h.market_value
                    )}
                  </strong>
                  <span className="holding-stat-sub">
                    {item.asset_type === "realestate"
                      ? `${money(h.price)} home`
                      : `${money(h.price)} now`}
                  </span>
                </div>

                <div className="holding-stat holding-gain">
                  <span className="holding-stat-label">Gain / loss</span>
                  <strong className={h.gain_loss >= 0 ? "up" : "down"}>
                    {h.gain_loss == null
                      ? "—"
                      : `${h.gain_loss >= 0 ? "+" : ""}${money(h.gain_loss)}`}
                  </strong>
                  <span className={gainPct == null ? "" : gainPct >= 0 ? "up" : "down"}>
                    {gainPct == null
                      ? "—"
                      : `${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(2)}%`}
                  </span>
                </div>

                <div className="holding-row-actions">
                  {holdingSelected && (
                    <div className="row-trade-btns">
                      {!holdingOpen && (
                        <>
                          <button
                            type="button"
                            className="row-sell"
                            data-click="select"
                            aria-label="Sell"
                            onClick={(e) => {
                              e.stopPropagation();
                              openHoldingSell(h);
                            }}
                          >
                            Sell
                          </button>
                          <button
                            type="button"
                            className="row-sell-all"
                            data-click="select"
                            aria-label="Sell all"
                            onClick={(e) => {
                              e.stopPropagation();
                              openHoldingSell(h, { all: true });
                            }}
                          >
                            Sell all
                          </button>
                        </>
                      )}

                      {holdingOpen && (
                      <div
                        className="sell-flow open"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className={
                            sellBlocked && !tradeDraft.sellAll
                              ? "row-sell confirm disabled"
                              : "row-sell confirm"
                          }
                          data-click={
                            sellBlocked && !tradeDraft.sellAll
                              ? "select"
                              : "confirm"
                          }
                          disabled={Boolean(sellBlocked && !tradeDraft.sellAll)}
                          aria-label={
                            tradeDraft.sellAll
                              ? "Confirm sell all"
                              : sellBlocked
                                ? "Cannot sell that amount"
                                : "Confirm sell"
                          }
                          onClick={() => {
                            if (tradeDraft.sellAll) {
                              quickTrade(item, "sell", h.shares);
                              return;
                            }
                            if (sellBlocked) return;
                            quickTrade(item, "sell", tradeDraft.qty);
                          }}
                        >
                          <span className="check-mark" aria-hidden="true">
                            ✓
                          </span>
                        </button>

                        {tradeDraft.sellAll ? (
                          <div className="sell-all-preview">
                            <strong>Entire position</strong>
                            <span>
                              {isBond
                                ? `${h.shares} units`
                                : isCurrency
                                  ? money(heldUsd)
                                  : `${h.shares} shares`}
                              {" · "}
                              {money(h.market_value)}
                            </span>
                          </div>
                        ) : item.asset_type === "currency" ? (
                            <div className="fx-spend">
                              <label className="fx-spend-field">
                                <span className="fx-dollar">$</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  autoFocus
                                  aria-label="U.S. dollars to get back"
                                  value={tradeDraft.usd}
                                  onChange={(e) => setDraftUsd(e.target.value)}
                                  onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      if (sellBlocked) return;
                                      quickTrade(item, "sell");
                                    }
                                  }}
                                />
                                <span className="fx-usd-label">USD</span>
                              </label>
                              <span
                                className={
                                  sellBlocked && Number(tradeDraft.usd) > 0
                                    ? "fx-preview over"
                                    : "fx-preview"
                                }
                              >
                                {sellBlocked && Number(tradeDraft.usd) > heldUsd
                                  ? "choose a smaller amount"
                                  : formatCurrencyPreview(
                                      item,
                                      currencyUnitsFromUsd(item, tradeDraft.usd)
                                    ) || "enter amount"}
                              </span>
                            </div>
                          ) : item.asset_type === "bond" ? (
                            <div className="bond-stepper">
                              <div className="bond-stepper-row">
                                <button
                                  type="button"
                                  className="qty-btn"
                                  data-click="adjust"
                                  aria-label="Decrease by $100"
                                  onClick={() => bumpBondFace(-100)}
                                >
                                  −
                                </button>
                                <label className="bond-face-field">
                                  <span>$</span>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    autoFocus
                                    aria-label="Bond face value to sell"
                                    value={tradeDraft.faceUsd}
                                    onChange={(e) => setBondFaceInput(e.target.value)}
                                    onBlur={() =>
                                      setTradeDraft((prev) =>
                                        prev?.mode === "bond"
                                          ? {
                                              ...prev,
                                              faceUsd: snapBondFace(prev.faceUsd),
                                            }
                                          : prev
                                      )
                                    }
                                    onKeyDown={(e) => {
                                      e.stopPropagation();
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        if (sellBlocked) return;
                                        quickTrade(item, "sell");
                                      }
                                      if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        bumpBondFace(100);
                                      }
                                      if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        bumpBondFace(-100);
                                      }
                                    }}
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="qty-btn"
                                  data-click="adjust"
                                  aria-label="Increase by $100"
                                  onClick={() => bumpBondFace(100)}
                                >
                                  +
                                </button>
                              </div>
                              <span
                                className={
                                  sellBlocked
                                    ? "fx-preview over"
                                    : "fx-preview bond-interest-preview"
                                }
                              >
                                {sellBlocked
                                  ? "choose a smaller amount"
                                  : `sell $${
                                      Number.isFinite(bondFaceSnapped)
                                        ? bondFaceSnapped
                                        : 100
                                    } face`}
                              </span>
                            </div>
                          ) : (
                            <div
                              className={
                                sellBlocked ? "share-stepper over" : "share-stepper"
                              }
                            >
                              <div
                                className={
                                  sellBlocked ? "qty-stepper over" : "qty-stepper"
                                }
                              >
                                <button
                                  type="button"
                                  className="qty-btn"
                                  data-click="adjust"
                                  aria-label="Decrease quantity"
                                  onClick={() => bumpDraftQty(-1)}
                                >
                                  −
                                </button>
                                {tradeDraft.qtyEditing ? (
                                  <input
                                    className="qty-value-input"
                                    type="text"
                                    inputMode="numeric"
                                    autoFocus
                                    aria-label="Quantity to sell"
                                    value={tradeDraft.qty}
                                    onChange={(e) => setDraftQtyInput(e.target.value)}
                                    onFocus={(e) => e.target.select()}
                                    onBlur={commitDraftQty}
                                    onKeyDown={(e) => {
                                      e.stopPropagation();
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        commitDraftQty();
                                        if (sellBlocked) return;
                                        quickTrade(
                                          item,
                                          "sell",
                                          Math.max(
                                            1,
                                            Math.round(Number(tradeDraft.qty)) || 1
                                          )
                                        );
                                      }
                                    }}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className="qty-value"
                                    data-click="select"
                                    aria-label="Edit quantity"
                                    onClick={startQtyEdit}
                                  >
                                    {tradeDraft.qty}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="qty-btn"
                                  data-click="adjust"
                                  aria-label="Increase quantity"
                                  onClick={() => bumpDraftQty(1)}
                                >
                                  +
                                </button>
                              </div>
                              <span
                                className={
                                  sellBlocked &&
                                  Number.isFinite(draftQty) &&
                                  draftQty > heldShares
                                    ? "fx-preview over"
                                    : "fx-preview"
                                }
                              >
                                {sellBlocked &&
                                Number.isFinite(draftQty) &&
                                draftQty > heldShares
                                  ? "choose a smaller amount"
                                  : Number.isFinite(shareProceeds)
                                    ? money(shareProceeds)
                                    : "—"}
                              </span>
                            </div>
                          )}
                      </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              );
            })}
            </div>
          </section>
          )}
        </>
      )}
    </section>
  );
}

export default function App() {
  const initialJoin = parseJoinCodeFromUrl();
  const [joinCode, setJoinCode] = useState(initialJoin);
  const [studentSession, setStudentSessionState] = useState(
    initialJoin ? null : getStudentSession()
  );
  const [teacher, setTeacher] = useState(null);
  const [teacherReady, setTeacherReady] = useState(Boolean(initialJoin));
  const [apiStudents, setApiStudents] = useState([]);
  const [roster, setRoster] = useState([]);
  const [activeClassId, setActiveClassIdState] = useState(() => getActiveClassId());
  const [enabledMarkets, setEnabledMarkets] = useState({ ...DEFAULT_MARKETS });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [portfolioRefreshToken, setPortfolioRefreshToken] = useState(0);

  async function refreshApiStudents() {
    try {
      const data = await listStudents(false);
      setApiStudents(data);
      return data;
    } catch (err) {
      setError(err.message);
      return [];
    }
  }

  function handleActiveClassChange(id) {
    setActiveClassId(id);
    setActiveClassIdState(id || "");
  }

  function handleJoinComplete(result) {
    const session = getStudentSession();
    setStudentSessionState(session);
    setJoinCode("");
    if (result?.classId) handleActiveClassChange(result.classId);
    refreshApiStudents();
  }

  async function handleSignOutStudent() {
    await signOutStudentAuth();
    clearStudentSession();
    setStudentSessionState(null);
    setError("");
  }

  async function handleSignOutTeacher() {
    await signOutTeacherAuth();
    setTeacher(null);
    setError("");
  }

  useEffect(() => {
    if (joinCode) {
      setTeacherReady(true);
      return undefined;
    }
    let cancelled = false;
    const unsub = watchTeacherAuth((profile) => {
      if (cancelled) return;
      setTeacher(profile);
      setTeacherReady(true);
      if (profile) {
        clearStudentSession();
        setStudentSessionState(null);
      }
    });
    const failsafe = window.setTimeout(() => {
      if (!cancelled) setTeacherReady(true);
    }, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(failsafe);
      unsub();
    };
  }, [joinCode]);

  useEffect(() => {
    if (studentSession || teacher) refreshApiStudents();
  }, [studentSession, teacher]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activeClassId || (!studentSession && !teacher)) {
        if (!studentSession) {
          setEnabledMarkets({ ...DEFAULT_MARKETS });
          setRoster([]);
        }
        return;
      }
      try {
        const [cls, students] = await Promise.all([
          getClass(activeClassId),
          listClassStudents(activeClassId),
        ]);
        if (cancelled) return;
        if (cls) {
          setEnabledMarkets({ ...DEFAULT_MARKETS, ...(cls.markets || {}) });
        }
        setRoster(students);
      } catch {
        if (!cancelled) {
          setEnabledMarkets({ ...DEFAULT_MARKETS });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeClassId, studentSession, teacher]);

  useEffect(() => {
    setClickMuted(Boolean(joinCode) || Boolean(teacher) || (!studentSession && teacherReady));
  }, [joinCode, teacher, studentSession, teacherReady]);

  const classStudents = (() => {
    const byId = new Map(apiStudents.map((s) => [s.id, s]));
    return roster
      .map((r) => {
        const live = r.apiStudentId != null ? byId.get(r.apiStudentId) : null;
        if (live) return live;
        if (r.apiStudentId != null) {
          return {
            id: r.apiStudentId,
            name: r.name,
            cash: r.cash ?? 0,
            holdings_count: r.holdingsCount ?? 0,
          };
        }
        return null;
      })
      .filter(Boolean);
  })();

  const sessionStudents = studentSession
    ? classStudents.filter((s) => s.id === studentSession.apiStudentId).length
      ? classStudents.filter((s) => s.id === studentSession.apiStudentId)
      : [
          {
            id: studentSession.apiStudentId,
            name: studentSession.name,
            cash: 0,
            holdings_count: 0,
          },
        ]
    : classStudents;

  const rosterGoal = roster.find(
    (r) =>
      r.apiStudentId === studentSession?.apiStudentId ||
      r.id === studentSession?.firestoreStudentId
  )?.investmentGoal;
  const investmentGoal =
    studentSession?.investmentGoal || rosterGoal || null;

  useEffect(() => {
    if (!studentSession?.apiStudentId || !rosterGoal) return;
    if (studentSession.investmentGoal) return;
    const next = { ...studentSession, investmentGoal: rosterGoal };
    setStudentSession(next);
    setStudentSessionState(next);
  }, [studentSession, rosterGoal]);

  const brandSub = joinCode || studentSession
    ? "Classroom investing"
    : "For teachers";

  let mainContent;
  if (joinCode) {
    mainContent = (
      <Suspense
        fallback={
          <section className="panel">
            <p className="empty">Loading invite…</p>
          </section>
        }
      >
        <StudentJoin
          inviteCode={joinCode}
          onComplete={handleJoinComplete}
          setError={setError}
          setBusy={setBusy}
        />
      </Suspense>
    );
  } else if (!teacherReady) {
    mainContent = (
      <section className="panel">
        <p className="empty">Loading…</p>
      </section>
    );
  } else if (teacher) {
    mainContent = (
      <TeacherDashboard
        students={apiStudents}
        activeClassId={activeClassId}
        onActiveClassChange={handleActiveClassChange}
        onRosterChange={(rows) => {
          setRoster(rows);
          refreshApiStudents();
        }}
        setError={setError}
        setBusy={setBusy}
      />
    );
  } else if (studentSession) {
    mainContent = (
      <StudentPortfolio
        students={sessionStudents}
        lockedStudentId={studentSession.apiStudentId || null}
        enabledMarkets={enabledMarkets}
        investmentGoal={investmentGoal}
        portfolioRefreshToken={portfolioRefreshToken}
        busy={busy}
        setError={setError}
        setBusy={setBusy}
      />
    );
  } else {
    mainContent = (
      <TeacherGate
        onAuthenticated={(profile) => {
          clearStudentSession();
          setStudentSessionState(null);
          setTeacher(profile);
          setError("");
        }}
        setError={setError}
        setBusy={setBusy}
      />
    );
  }

  return (
    <div className="app-shell">
      <div className="bg-glow" aria-hidden="true" />
      <header className="topbar">
        <div className="brand">
          <p className="brand-mark">Ledger Lab</p>
          <p className="brand-sub">{brandSub}</p>
        </div>
        {studentSession && !joinCode && !teacher ? (
          <div className="student-session-bar">
            <span>
              {studentSession.name}
              {studentSession.className ? ` · ${studentSession.className}` : ""}
            </span>
            <button
              type="button"
              className="ghost-btn session-signout"
              data-click="select"
              onClick={handleSignOutStudent}
            >
              Sign out
            </button>
          </div>
        ) : teacher && !joinCode ? (
          <div className="student-session-bar">
            <span>{teacher.name}</span>
            <button
              type="button"
              className="ghost-btn session-signout"
              data-click="select"
              onClick={handleSignOutTeacher}
            >
              Sign out
            </button>
          </div>
        ) : null}
      </header>

      {error && <div className="banner error">{error}</div>}
      {busy && (
        <div className="busy-indicator" role="status" aria-live="polite" aria-busy="true">
          <div className="busy-bar" aria-hidden="true">
            <span className="busy-bar-shine" />
          </div>
          <div className="busy-pill">
            <span className="busy-spinner" aria-hidden="true" />
            <span>Updating</span>
          </div>
        </div>
      )}

      {studentSession?.classId &&
        studentSession?.firestoreStudentId &&
        studentSession?.apiStudentId &&
        !joinCode &&
        !teacher && (
          <CashTransferAlert
            classId={studentSession.classId}
            firestoreStudentId={studentSession.firestoreStudentId}
            apiStudentId={studentSession.apiStudentId}
            onAccepted={() => {
              refreshApiStudents();
              setPortfolioRefreshToken((n) => n + 1);
            }}
          />
        )}

      <main>{mainContent}</main>
    </div>
  );
}

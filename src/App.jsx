import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buyHome, buyShares, createStudent, getLoans, getMarket, getQuote, getQuotes, getStudent, listStudents, sellShares } from "./api";
import PriceChart from "./PriceChart";
import PortfolioHistoryChart from "./PortfolioHistoryChart";
import CommodityInfoTip from "./CommodityInfoTip";
import BondGlossaryTip from "./BondGlossaryTip";
import ClassView from "./ClassView";
import ClassMessageBoard from "./ClassMessageBoard";
import NewsFeed from "./NewsFeed";
import JobBoard from "./JobBoard";
import PurchaseHistory from "./PurchaseHistory";
import HomeJobsPanel from "./HomeJobsPanel";
import TeacherDashboard from "./TeacherDashboard";
import TeacherGate from "./TeacherGate";
import CashTransferAlert from "./CashTransferAlert";
import LendingInterestAlert from "./LendingInterestAlert";
import PartnershipInviteAlert from "./PartnershipInviteAlert";
import WhatsNewAlert from "./WhatsNewAlert";
import LoanSellModal from "./LoanSellModal";
import HeadToHeadModal, {
  HeadToHeadBattleModal,
  HeadToHeadLiveMatchups,
} from "./HeadToHeadModal";
import TradeSuccessModal from "./TradeSuccessModal";
import StockBuyModal from "./StockBuyModal";
import { AvatarCanvas, CLASS_FISH_OUTFIT, loadSavedOutfit } from "./StudentCharacter";
import {
  DEFAULT_MARKETS,
  clearStudentSession,
  getActiveClassId,
  getClass,
  getClassStudent,
  getStudentSession,
  listClassStudents,
  parseJoinCodeFromUrl,
  setActiveClassId,
  setStudentSession,
  updateClassStudent,
} from "./classStore";
import { signOutStudentAuth } from "./studentAuth";
import { signOutTeacherAuth, watchAccountAuth } from "./teacherAuth";
import { setClickMuted } from "./clickSounds";
import FloridaRealEstateMap from "./FloridaRealEstateMap";
import WorldLendingMap from "./WorldLendingMap";
import GlobeCharacter from "./GlobeCharacter";
import MarketGlyph from "./MarketGlyph";
import PopularStocksTicker from "./PopularStocksTicker";
import BiggestMoversTicker from "./BiggestMoversTicker";
import CongressTradesPanel from "./CongressTradesPanel";
import CryptoEtfsTicker from "./CryptoEtfsTicker";
import StockRequestForm from "./StockRequestForm";
import StudentStockSearch from "./StudentStockSearch";
import FearGreedMeter from "./FearGreedMeter";
import { groupHoldingsByCategory } from "./portfolioAllocation";
import "./App.css";

const StudentCharacter = lazy(() => import("./StudentCharacter"));

/** Set true to restore class chat on student home + teacher dashboard. */
const SHOW_CLASS_CHAT = false;
/** STOCK Act disclosures strip under Popular Stocks — hide until ready for class. */
const SHOW_CONGRESS_TRADES = false;
/** “Most popular / New stocks” highlight strip on Stocks — hide until ready. */
const SHOW_POPULAR_STOCKS = false;
/** World lending map on Bonds — classroom country rates. */
const SHOW_WORLD_LENDING = true;
/** Test: show a sample Nigeria interest-payment spin on every page load. */
const SHOW_LENDING_INTEREST_DEMO = false;
/** One-time "what's new" cards for each student (add ?whatsnew to the URL to preview). */
const SHOW_WHATS_NEW = true;
/** Testing: show the "what's new" cards on every reload (nothing is marked seen). */
const WHATS_NEW_ALWAYS_SHOW = true;
const STRATEGY_BIO_MAX = 280;
const StudentJoin = lazy(() => import("./StudentJoin"));

// Market price charts (stocks/ETFs/etc.) — hide until the /chart feed is reliable.
// Flip to true to show the chart button + PriceChart row again.
const SHOW_MARKET_PRICE_CHARTS = false;

const SOUND_PREF_KEY = "ledgerlab.sfx";

function readSoundPref() {
  try {
    return localStorage.getItem(SOUND_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeSoundPref(on) {
  try {
    localStorage.setItem(SOUND_PREF_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Fisher–Yates — used so the Stocks “All” list isn’t the same order every visit. */
function shuffleList(items) {
  const arr = Array.isArray(items) ? [...items] : [];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function marketItemsForDisplay(category, items) {
  const rows = Array.isArray(items) ? items : [];
  return category === "stocks" ? shuffleList(rows) : rows;
}

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
    blurb: "Own a slice of real companies",
    mark: "01",
    tag: "Equity",
  },
  {
    id: "etfs",
    title: "ETFs and Crypto",
    blurb: "One trade that spreads your risk",
    mark: "02",
    tag: "Basket",
  },
  {
    id: "bonds",
    title: "Bonds",
    blurb: "Steadier yield from loans",
    mark: "03",
    tag: "Income",
  },
  {
    id: "commodities",
    title: "Commodities",
    blurb: "Raw prices for gold, oil, crops, metals",
    mark: "04",
    tag: "Goods",
  },
  {
    id: "currencies",
    title: "Currencies",
    blurb: "Swap dollars for other money",
    mark: "05",
    tag: "FX",
  },
  {
    id: "realestate",
    title: "Real estate",
    blurb: "Florida homes + a classroom mortgage",
    mark: "06",
    tag: "Property",
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

function StrategyBioEditor({ classId, firestoreStudentId, setError }) {
  const [bio, setBio] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!classId || !firestoreStudentId) {
      setBio("");
      setDraft("");
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    getClassStudent(classId, firestoreStudentId)
      .then((seat) => {
        if (cancelled) return;
        const text = String(seat?.strategyBio || "").trim();
        setBio(text);
        setDraft(text);
        setEditing(!text);
      })
      .catch(() => {
        if (!cancelled) {
          setBio("");
          setDraft("");
          setEditing(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, firestoreStudentId]);

  async function saveBio() {
    if (!classId || !firestoreStudentId) return;
    const next = draft.trim().slice(0, STRATEGY_BIO_MAX);
    setSaving(true);
    setError("");
    try {
      await updateClassStudent(classId, firestoreStudentId, {
        strategyBio: next || null,
      });
      setBio(next);
      setDraft(next);
      setEditing(false);
    } catch (err) {
      setError(err.message || "Could not save your strategy bio.");
    } finally {
      setSaving(false);
    }
  }

  if (!classId || !firestoreStudentId) return null;

  return (
    <div className="strategy-bio">
      <div className="strategy-bio-head">
        <p className="strategy-bio-label">Investing strategy</p>
        {!loading && !editing && (
          <button
            type="button"
            className="strategy-bio-pencil"
            data-click="select"
            aria-label={bio ? "Edit investing strategy" : "Add investing strategy"}
            title={bio ? "Edit" : "Add strategy"}
            onClick={() => {
              setDraft(bio);
              setEditing(true);
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none">
              <path
                d="M4 20h4.5L19 9.5 14.5 5 4 15.5V20z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="M12.5 7l4.5 4.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>
      {loading ? (
        <p className="strategy-bio-note">Loading…</p>
      ) : editing ? (
        <div className="strategy-bio-edit">
          <textarea
            className="strategy-bio-input"
            rows={3}
            maxLength={STRATEGY_BIO_MAX}
            value={draft}
            placeholder="Tell your classmates a bit about your investment philosophy...."
            onChange={(e) => setDraft(e.target.value.slice(0, STRATEGY_BIO_MAX))}
          />
          <div className="strategy-bio-actions">
            <span className="strategy-bio-count">
              {draft.trim().length}/{STRATEGY_BIO_MAX}
            </span>
            <div className="strategy-bio-btns">
              {bio ? (
                <button
                  type="button"
                  className="ghost-btn strategy-bio-cancel"
                  data-click="select"
                  disabled={saving}
                  onClick={() => {
                    setDraft(bio);
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="button"
                className="primary-btn strategy-bio-save"
                data-click="confirm"
                disabled={saving || draft.trim() === bio}
                onClick={saveBio}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="strategy-bio-text">
          {bio || "No strategy written yet."}
        </p>
      )}
    </div>
  );
}

function StudentPortfolio({
  students,
  enabledMarkets,
  lockedStudentId,
  investmentGoal,
  classId = "",
  className = "",
  firestoreStudentId = "",
  studentEmail = "",
  portfolioRefreshToken = 0,
  busy,
  setError,
  setBusy,
}) {
  const [selectedId, setSelectedId] = useState(() => {
    if (firestoreStudentId && (!lockedStudentId || /^\d+$/.test(String(lockedStudentId)))) {
      return String(firestoreStudentId);
    }
    return lockedStudentId ? String(lockedStudentId) : "";
  });
  const [portfolio, setPortfolio] = useState(null);
  const [portfolioLoading, setPortfolioLoading] = useState(() => {
    if (firestoreStudentId && (!lockedStudentId || /^\d+$/.test(String(lockedStudentId)))) {
      return true;
    }
    return Boolean(lockedStudentId);
  });
  const [category, setCategory] = useState(null);
  const [stockIndustry, setStockIndustry] = useState("All");
  const [showWorldLending, setShowWorldLending] = useState(false);
  const [marketPage, setMarketPage] = useState(0);
  const [showClass, setShowClass] = useState(false);
  const [showNews, setShowNews] = useState(false);
  const [showJobs, setShowJobs] = useState(false);
  const [showPurchases, setShowPurchases] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [openCreateRequest, setOpenCreateRequest] = useState(0);
  const [showH2HBattle, setShowH2HBattle] = useState(false);
  const [h2hFocusMatchId, setH2hFocusMatchId] = useState("");
  const [h2hResumeToken, setH2hResumeToken] = useState(0);
  const [marketItems, setMarketItems] = useState([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketPricesPending, setMarketPricesPending] = useState(false);
  const [pricingStatus, setPricingStatus] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [chartTicker, setChartTicker] = useState(null);
  const [shares, setShares] = useState("1");
  const [refreshing, setRefreshing] = useState(false);
  // Stocks/etc: { ticker, action, qty }. Currencies: { ticker, action, mode:'usd', usd:string }
  const [tradeDraft, setTradeDraft] = useState(null);
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [tradePulse, setTradePulse] = useState(null); // { ticker, action }
  const [stockBuyTarget, setStockBuyTarget] = useState(null);
  const [tradeSuccess, setTradeSuccess] = useState(null);
  const tradePulseTimer = useRef(null);
  const closeTradeSuccess = useCallback(() => setTradeSuccess(null), []);
  const holdingsByCategory = useMemo(
    () => groupHoldingsByCategory(portfolio?.holdings),
    [portfolio?.holdings]
  );
  const [studentLoans, setStudentLoans] = useState([]);
  useEffect(() => {
    if (!classId || !portfolio?.id) {
      setStudentLoans([]);
      return undefined;
    }
    let cancelled = false;
    getLoans(portfolio.id, classId)
      .then((data) => {
        if (!cancelled) setStudentLoans(Array.isArray(data?.loans) ? data.loans : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [classId, portfolio?.id, portfolio?.cash, portfolio?.loans_outstanding]);
  const activeLoans = useMemo(
    () => studentLoans.filter((l) => l.status === "active"),
    [studentLoans]
  );
  const [loanToSell, setLoanToSell] = useState(null);

  const holdingsTotals = useMemo(() => {
    const rows = portfolio?.holdings || [];
    let invested = 0;
    let value = 0;
    for (const loan of activeLoans) {
      const principal = Number(loan.principal) || 0;
      invested += principal;
      value += principal;
    }
    for (const h of rows) {
      const cost =
        h.cost_basis != null
          ? Number(h.cost_basis)
          : (Number(h.avg_cost) || 0) * (Number(h.shares) || 0);
      const item = holdingAsTradeItem(h);
      const mv =
        item.asset_type === "realestate" && h.equity != null
          ? Number(h.equity)
          : Number(h.market_value) ||
            (Number(h.shares) || 0) * (Number(h.price) || 0);
      if (Number.isFinite(cost)) invested += cost;
      if (Number.isFinite(mv)) value += mv;
    }
    const gain = value - invested;
    const gainPct = invested > 0 ? (gain / invested) * 100 : null;
    return { invested, value, gain, gainPct };
  }, [portfolio?.holdings, activeLoans]);

  const holdingsAvatarOutfit = useMemo(
    () =>
      loadSavedOutfit(
        firestoreStudentId || portfolio?.id || selectedId,
        portfolio?.name || "Student"
      ),
    [firestoreStudentId, portfolio?.id, portfolio?.name, selectedId]
  );

  // Class fruit-fly benchmark: fixed paper portfolio for comparison.
  const fruitFlyBenchmark = useMemo(() => {
    const invested = 100000;
    const gainPct = 4.32;
    const value = invested * (1 + gainPct / 100);
    const gain = value - invested;
    return { invested, value, gain, gainPct };
  }, []);

  useEffect(() => {
    // Prefer Firestore seat id over leftover numeric SQLite trading ids.
    if (firestoreStudentId && (!lockedStudentId || /^\d+$/.test(String(lockedStudentId)))) {
      setSelectedId(String(firestoreStudentId));
      return;
    }
    if (lockedStudentId) setSelectedId(String(lockedStudentId));
  }, [lockedStudentId, firestoreStudentId]);

  useEffect(() => {
    return () => {
      if (tradePulseTimer.current) clearTimeout(tradePulseTimer.current);
    };
  }, []);

  async function loadPortfolio(id) {
    const data = await getStudent(id, classId || undefined);
    setPortfolio(data);
    return data;
  }

  function portfolioFallback() {
    const seat =
      students.find((s) => String(s.id) === String(firestoreStudentId)) ||
      students.find((s) => String(s.id) === String(selectedId));
    return {
      id: firestoreStudentId || selectedId,
      name: seat?.name || "Student",
      cash: Number(seat?.cash) || 0,
      portfolio_value: 0,
      mortgage_debt: 0,
      total_value: Number(seat?.cash) || 0,
      holdings_count: 0,
      holdings: [],
    };
  }

  useEffect(() => {
    if (!selectedId) {
      setPortfolio(null);
      setPortfolioLoading(false);
      setCategory(null);
      setSelectedAsset(null);
      setChartTicker(null);
      setShowNews(false);
      setShowJobs(false);
      setShowPurchases(false);
      setShowClass(false);
      setSelectedHolding(null);
      setTradeDraft(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setPortfolioLoading(true);
      setPortfolio(null);
      setBusy(true);
      setError("");
      try {
        let data;
        try {
          data = await getStudent(selectedId, classId || undefined);
        } catch (err) {
          const msg = String(err?.message || "");
          if (classId && firestoreStudentId && /not found|404/i.test(msg)) {
            const seatName =
              students.find((s) => String(s.id) === String(selectedId))?.name ||
              students.find((s) => String(s.id) === String(firestoreStudentId))
                ?.name ||
              "Student";
            try {
              await createStudent(seatName, 0, {
                classId,
                studentId: firestoreStudentId,
              });
              data = await getStudent(firestoreStudentId, classId);
              if (String(selectedId) !== String(firestoreStudentId)) {
                setSelectedId(String(firestoreStudentId));
              }
            } catch {
              data = portfolioFallback();
            }
          } else if (/timed out|not running|Cannot reach|500|Request failed/i.test(msg)) {
            // Enter the home UI even if the ledger API is unhealthy.
            data = portfolioFallback();
            if (!cancelled) setError(msg);
          } else {
            throw err;
          }
        }
        if (!cancelled) setPortfolio(data);
      } catch (err) {
        if (!cancelled) {
          setPortfolio(portfolioFallback());
          setError(err.message);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
          setPortfolioLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, classId, firestoreStudentId, setBusy, setError]);

  useEffect(() => {
    if (!selectedId || !portfolioRefreshToken) return;
    loadPortfolio(selectedId).catch(() => {});
  }, [portfolioRefreshToken, selectedId]);

  useEffect(() => {
    if (!category) {
      setMarketItems([]);
      setPricingStatus(null);
      setMarketPricesPending(false);
      return;
    }
    setStockIndustry("All");
    setMarketPage(0);
    setSelectedAsset(null);
    setChartTicker(null);
    setTradeDraft(null);
    setShowWorldLending(false);
    let cancelled = false;
    (async () => {
      setMarketLoading(true);
      setMarketPricesPending(true);
      setError("");
      try {
        // Instant name list, then hydrate live quotes (slow path on cold cache).
        try {
          const catalog = await getMarket(category, false, { catalog: true });
          if (!cancelled) {
            setMarketItems(marketItemsForDisplay(category, catalog.items || []));
            setMarketLoading(false);
            setPricingStatus(catalog.pricing || null);
            // Bonds/real estate often already have usable figures in the catalog.
            if (!catalog.pricing?.pending) {
              setMarketPricesPending(false);
            }
          }
        } catch {
          /* full fetch below still runs */
        }

        const data = await getMarket(category);
        if (!cancelled) {
          setMarketItems(marketItemsForDisplay(category, data.items || []));
          setPricingStatus(data.pricing || null);
          if (data.pricing && data.pricing.ok === false) {
            setError(
              data.pricing.error ||
                "Live prices are unavailable right now. Buying is paused until prices load."
            );
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setPricingStatus(null);
        }
      } finally {
        if (!cancelled) {
          setMarketLoading(false);
          setMarketPricesPending(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [category, setError]);

  // Fill missing equity prices (Industrials used to starve under Finnhub limits).
  useEffect(() => {
    if (category !== "stocks" || marketLoading || marketPricesPending) return undefined;
    const visible =
      stockIndustry !== "All"
        ? marketItems.filter((item) => item.industry === stockIndustry)
        : marketItems;
    const missing = visible
      .filter((item) => !(Number(item.price) > 0))
      .map((item) => String(item.ticker || "").toUpperCase())
      .filter(Boolean);
    if (!missing.length) return undefined;

    let cancelled = false;
    (async () => {
      try {
        const data = await getQuotes(missing);
        if (cancelled) return;
        const quotes = data?.quotes || {};
        if (!Object.keys(quotes).length) return;
        setMarketItems((prev) =>
          prev.map((row) => {
            const q = quotes[String(row.ticker || "").toUpperCase()];
            if (!q || !(Number(q.price) > 0) || Number(row.price) > 0) return row;
            return {
              ...row,
              price: Number(q.price),
              change_pct:
                q.change_pct != null ? Number(q.change_pct) : row.change_pct,
            };
          })
        );
      } catch {
        /* keep catalog rows; buy still blocked until a price arrives */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    category,
    stockIndustry,
    marketLoading,
    marketPricesPending,
    marketItems,
  ]);

  async function refreshAll() {
    if (!selectedId) return;
    setRefreshing(true);
    setError("");
    try {
      await loadPortfolio(selectedId);
      if (category) {
        setMarketPricesPending(true);
        const data = await getMarket(category, true);
        setMarketItems(marketItemsForDisplay(category, data.items || []));
        setPricingStatus(data.pricing || null);
        if (data.pricing && data.pricing.ok === false) {
          setError(
            data.pricing.error ||
              "Live prices are unavailable right now. Buying is paused until prices load."
          );
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setMarketPricesPending(false);
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
      const data = await fn(selectedId, selectedAsset.ticker, qty);
      setPortfolio(data);
      setTradeSuccess({
        action,
        ticker: selectedAsset.ticker,
        name: selectedAsset.name || selectedAsset.ticker,
        qty,
        assetType: selectedAsset.asset_type,
      });
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
          .filter(
            (ind) =>
              ind &&
              String(ind).toLowerCase() !== "custom"
          )
      )
    ).sort((a, b) => a.localeCompare(b)),
  ];
  const visibleMarketItems =
    category === "stocks" && stockIndustry !== "All"
      ? marketItems.filter((item) => item.industry === stockIndustry)
      : marketItems;
  const MARKET_PAGE_SIZE = 10;
  const stockPageCount =
    category === "stocks"
      ? Math.max(1, Math.ceil(visibleMarketItems.length / MARKET_PAGE_SIZE))
      : 1;
  const safeMarketPage = Math.min(marketPage, stockPageCount - 1);
  const pagedMarketItems =
    category === "stocks"
      ? visibleMarketItems.slice(
          safeMarketPage * MARKET_PAGE_SIZE,
          safeMarketPage * MARKET_PAGE_SIZE + MARKET_PAGE_SIZE
        )
      : visibleMarketItems;

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
    if (
      action === "buy" &&
      item.asset_type === "commodity" &&
      item.buy_ok === false
    ) {
      setError(
        "Commodity price unavailable right now. Try again shortly — selling still works."
      );
      return;
    }

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
      const data = await fn(selectedId, item.ticker, qty);
      setPortfolio(data);
      setTradeDraft(null);
      setSelectedAsset(null);
      setSelectedHolding(null);
      setShares(String(qty));
      setTradePulse({ ticker: item.ticker, action });
      setTradeSuccess({
        action,
        ticker: item.ticker,
        name: item.name || item.ticker,
        qty,
        assetType: item.asset_type,
        faceUsd:
          item.asset_type === "bond" && tradeDraft?.mode === "bond"
            ? snapBondFace(tradeDraft.faceUsd)
            : undefined,
        fillPrice:
          Number(item.price) > 0 ? Number(item.price) : undefined,
        approximateFill:
          action === "buy" &&
          item.asset_type === "commodity" &&
          item.price_quality === "approximate",
        fillLocked:
          action === "buy" && item.asset_type === "commodity",
      });
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
    if (action === "buy" && item.asset_type !== "bond" && !(Number(item.price) > 0)) {
      setError("Wait for a live price before buying.");
      return;
    }
    if (
      action === "buy" &&
      item.asset_type === "commodity" &&
      item.buy_ok === false
    ) {
      setError(
        "Commodity price unavailable right now. Try again shortly — selling still works."
      );
      return;
    }
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
          <h2 className="student-dash-name">
            {portfolioLoading
              ? "Loading student data"
              : portfolio
                ? portfolio.name
                : "Student portfolio"}
          </h2>
          {!portfolioLoading && portfolio && (
            <StrategyBioEditor
              classId={classId}
              firestoreStudentId={firestoreStudentId}
              setError={setError}
            />
          )}
          {portfolioLoading && (
            <p>Pulling your cash, holdings, and avatar…</p>
          )}
        </div>
        <div className="student-header-right">
          {portfolioLoading ? (
            <div
              className="character-stage character-stage-loading"
              role="status"
              aria-live="polite"
              aria-label="Loading avatar"
            >
              <span className="busy-spinner character-loading-spinner" aria-hidden="true" />
            </div>
          ) : (
            <Suspense
              fallback={
                <div
                  className="character-stage character-stage-loading"
                  role="status"
                  aria-label="Loading avatar"
                >
                  <span className="busy-spinner character-loading-spinner" aria-hidden="true" />
                </div>
              }
            >
              <StudentCharacter
                studentId={portfolio?.id}
                name={portfolio?.name || "Student"}
                cash={portfolio?.cash ?? 0}
                classId={classId}
                firestoreStudentId={firestoreStudentId}
                openCreateRequest={openCreateRequest}
                onCashChange={() => {
                  if (selectedId) loadPortfolio(selectedId).catch(() => {});
                }}
              />
            </Suspense>
          )}
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

      {portfolioLoading && (
        <div className="student-dash" aria-busy="true">
          <div className="student-dash-inner">
            <p className="empty student-loading-note">Loading student data…</p>
          </div>
        </div>
      )}

      {!portfolioLoading && portfolio && (
        <>
          <div
            className={
              category || showClass || showNews || showJobs || showPurchases || showBoard
                ? "student-dash collapsed"
                : "student-dash"
            }
            aria-hidden={Boolean(
              category || showClass || showNews || showJobs || showPurchases || showBoard
            )}
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
                onOpenPurchases={() => {
                  setShowPurchases(true);
                  setShowNews(false);
                  setShowJobs(false);
                  setShowClass(false);
                  setShowBoard(false);
                  setCategory(null);
                  setShowWorldLending(false);
                  setSelectedAsset(null);
                  setTradeDraft(null);
                }}
              />
            </div>
          </div>

          {showClass && (
            <ClassView
              currentStudentId={portfolio.id}
              classId={classId}
              onBack={() => setShowClass(false)}
            />
          )}

          {showPurchases && !showClass && !showNews && !showJobs && !showBoard && (
            <PurchaseHistory
              studentId={portfolio.id}
              classId={classId}
              onBack={() => setShowPurchases(false)}
            />
          )}

          {showNews && !showClass && !showJobs && !showPurchases && !showBoard && (
            <NewsFeed
              onBack={() => setShowNews(false)}
            />
          )}

          {showJobs && !showClass && !showNews && !showPurchases && !showBoard && (
            <JobBoard
              classId={classId}
              studentId={firestoreStudentId || portfolio?.id || ""}
              onBack={() => setShowJobs(false)}
            />
          )}

          {SHOW_CLASS_CHAT && showBoard && !showClass && !showNews && !showJobs && !showPurchases && (classId || import.meta.env.DEV) && (
            <ClassMessageBoard
              classId={classId}
              authorName={
                students.find((s) => String(s.id) === String(portfolio?.id))
                  ?.name ||
                portfolio?.name ||
                "Student"
              }
              authorId={firestoreStudentId || portfolio?.id || null}
              authorRole="student"
              onBack={() => setShowBoard(false)}
            />
          )}

          {!category && !showClass && !showNews && !showJobs && !showPurchases && !(SHOW_CLASS_CHAT && showBoard) && (
            <div className="home-menu">
              {classId && firestoreStudentId && (
                <HeadToHeadLiveMatchups
                  classId={classId}
                  firestoreStudentId={firestoreStudentId}
                  studentName={portfolio?.name}
                  onOpenMatch={(matchId) => {
                    setH2hFocusMatchId(matchId || "");
                    setShowH2HBattle(true);
                    setShowClass(false);
                    setShowNews(false);
                    setShowJobs(false);
                    setShowPurchases(false);
                    setShowBoard(false);
                    setSelectedAsset(null);
                    setTradeDraft(null);
                  }}
                />
              )}
              {classId ? (
                <HomeJobsPanel
                  classId={classId}
                  studentId={firestoreStudentId || portfolio?.id || ""}
                  onOpenBoard={() => {
                    setShowJobs(true);
                    setShowNews(false);
                    setShowClass(false);
                    setShowPurchases(false);
                    setShowBoard(false);
                    setSelectedAsset(null);
                    setTradeDraft(null);
                  }}
                />
              ) : null}
              <div className="home-tools" aria-label="Classroom">
                <button
                  type="button"
                  className="home-tool home-tool-standings"
                  data-click="select"
                  title="Class standings"
                  onClick={() => {
                    setShowClass(true);
                    setShowNews(false);
                    setShowJobs(false);
                    setShowPurchases(false);
                    setShowBoard(false);
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
                {SHOW_CLASS_CHAT && (
                <button
                  type="button"
                  className="home-tool home-tool-board"
                  data-click="select"
                  title="Class message board"
                  onClick={() => {
                    setShowBoard(true);
                    setShowNews(false);
                    setShowJobs(false);
                    setShowClass(false);
                    setShowPurchases(false);
                    setSelectedAsset(null);
                    setTradeDraft(null);
                  }}
                >
                  <span className="home-tool-kicker">Classroom</span>
                  <strong>Class chat</strong>
                  <span className="home-tool-go" aria-hidden="true">
                    →
                  </span>
                </button>
                )}
                <button
                  type="button"
                  className="home-tool home-tool-news"
                  data-click="select"
                  onClick={() => {
                    setShowNews(true);
                    setShowJobs(false);
                    setShowClass(false);
                    setShowPurchases(false);
                    setShowBoard(false);
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
                <button
                  type="button"
                  className="home-tool home-tool-jobs"
                  data-click="select"
                  title="Job board"
                  onClick={() => {
                    setShowJobs(true);
                    setShowNews(false);
                    setShowClass(false);
                    setShowPurchases(false);
                    setShowBoard(false);
                    setSelectedAsset(null);
                    setTradeDraft(null);
                  }}
                >
                  <span className="home-tool-kicker">Classroom</span>
                  <strong>Job board</strong>
                  <span className="home-tool-go" aria-hidden="true">
                    →
                  </span>
                </button>
              </div>

              <div className="market-menu">
                <div className="market-menu-head">
                  <div className="market-menu-copy">
                    <p className="market-menu-kicker">Trade floor</p>
                    <h3>Pick a market</h3>
                    <p className="market-menu-lead">
                      Each floor has its own feel — browse prices, then put cash to work.
                    </p>
                  </div>
                  <FearGreedMeter />
                </div>
                <div className="market-lanes" role="list">
                  {availableCategories.map((c, i) => (
                    <button
                      key={c.id}
                      type="button"
                      role="listitem"
                      className={`market-lane market-lane-${c.id}`}
                      data-click="select"
                      style={{ animationDelay: `${i * 55}ms` }}
                      onClick={() => {
                        setCategory(c.id);
                        setShowPurchases(false);
                        setSelectedAsset(null);
                        setChartTicker(null);
                        setStockBuyTarget(null);
                      }}
                    >
                      <span className="market-lane-visual" aria-hidden="true">
                        <MarketGlyph id={c.id} />
                      </span>
                      <span className="market-lane-copy">
                        <span className="market-lane-tag">{c.tag || c.mark}</span>
                        <strong>{c.title}</strong>
                        <span className="market-lane-blurb">{c.blurb}</span>
                      </span>
                      <span className="market-lane-go" aria-hidden="true">
                        Open
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {category && !showClass && !showNews && !showJobs && !showPurchases && !showBoard && (
            <div className="market-view">
              <div className="market-toolbar">
                <button
                  type="button"
                  className="ghost-btn"
                  data-click="select"
                  onClick={() => {
                    if (SHOW_WORLD_LENDING && showWorldLending) {
                      setShowWorldLending(false);
                      return;
                    }
                    setCategory(null);
                    setSelectedAsset(null);
                    setChartTicker(null);
                    setTradeDraft(null);
                    setStockBuyTarget(null);
                    setStockIndustry("All");
                    setShowWorldLending(false);
                  }}
                >
                  {SHOW_WORLD_LENDING && showWorldLending ? "← Bonds" : "← All markets"}
                </button>
                <h3 className="market-heading">
                  {SHOW_WORLD_LENDING && showWorldLending
                    ? "World lending"
                    : categoryMeta?.title}
                  {category === "bonds" &&
                    !(SHOW_WORLD_LENDING && showWorldLending) && <BondGlossaryTip />}
                </h3>
              </div>

              {category === "stocks" && (
                <>
                  {SHOW_POPULAR_STOCKS ? (
                  <PopularStocksTicker
                    classId={classId}
                    className={className}
                    onPickTicker={async (row) => {
                      const ticker = String(row?.ticker || row || "").toUpperCase();
                      if (!ticker) return;
                      const item = marketItems.find(
                        (m) => String(m.ticker).toUpperCase() === ticker
                      );
                      let price = item?.price != null ? Number(item.price) : null;
                      let name = item?.name || row?.name || ticker;
                      if (!(price > 0)) {
                        try {
                          const q = await getQuote(ticker);
                          price = q?.price != null ? Number(q.price) : null;
                          if (q?.name) name = q.name;
                        } catch {
                          /* ignore — show error below */
                        }
                      }
                      if (!(price > 0)) {
                        setError?.(
                          `Couldn’t load a live price for ${ticker} yet — try again in a moment.`
                        );
                        return;
                      }
                      setStockBuyTarget({
                        ticker,
                        name,
                        price,
                        change_pct: item?.change_pct ?? row?.change_pct ?? null,
                        asset_type: item?.asset_type || "equity",
                        info: item?.info || null,
                      });
                      setSelectedAsset(null);
                      setChartTicker(null);
                      setTradeDraft(null);
                    }}
                  />
                  ) : null}
                  <BiggestMoversTicker
                    marketItems={marketItems}
                    pricesPending={marketPricesPending || marketLoading}
                    onPickTicker={async (row) => {
                      const ticker = String(row?.ticker || row || "").toUpperCase();
                      if (!ticker) return;
                      const item = marketItems.find(
                        (m) => String(m.ticker).toUpperCase() === ticker
                      );
                      let price =
                        item?.price != null
                          ? Number(item.price)
                          : row?.price != null
                            ? Number(row.price)
                            : null;
                      let name = item?.name || row?.name || ticker;
                      if (!(price > 0)) {
                        try {
                          const q = await getQuote(ticker);
                          price = q?.price != null ? Number(q.price) : null;
                          if (q?.name) name = q.name;
                        } catch {
                          /* ignore */
                        }
                      }
                      if (!(price > 0)) {
                        setError?.(
                          `Couldn’t load a live price for ${ticker} yet — try again in a moment.`
                        );
                        return;
                      }
                      setStockBuyTarget({
                        ticker,
                        name,
                        price,
                        change_pct:
                          item?.change_pct ?? row?.change_pct ?? null,
                        asset_type: item?.asset_type || row?.asset_type || "equity",
                        info: item?.info || row?.info || null,
                      });
                      setSelectedAsset(null);
                      setChartTicker(null);
                      setTradeDraft(null);
                    }}
                  />
                  {SHOW_CONGRESS_TRADES ? (
                    <CongressTradesPanel
                      onPickTicker={async (row) => {
                        const ticker = String(row?.ticker || row || "").toUpperCase();
                        if (!ticker) return;
                        const item = marketItems.find(
                          (m) => String(m.ticker).toUpperCase() === ticker
                        );
                        let price = item?.price != null ? Number(item.price) : null;
                        let name = item?.name || row?.name || ticker;
                        if (!(price > 0)) {
                          try {
                            const q = await getQuote(ticker);
                            price = q?.price != null ? Number(q.price) : null;
                            if (q?.name) name = q.name;
                          } catch {
                            /* ignore */
                          }
                        }
                        if (!(price > 0)) {
                          setError?.(
                            `Couldn’t load a live price for ${ticker} yet — try again in a moment.`
                          );
                          return;
                        }
                        setStockBuyTarget({
                          ticker,
                          name,
                          price,
                          change_pct: item?.change_pct ?? null,
                          asset_type: item?.asset_type || "equity",
                          info: item?.info || null,
                        });
                        setSelectedAsset(null);
                        setChartTicker(null);
                        setTradeDraft(null);
                      }}
                    />
                  ) : null}
                  {selectedId ? (
                    <StudentStockSearch
                      classId={classId}
                      className={className || ""}
                      studentId={selectedId}
                      studentName={portfolio?.name || ""}
                      cash={portfolio?.cash ?? 0}
                      marketItems={marketItems}
                      buyTarget={stockBuyTarget}
                      onBuyTargetChange={setStockBuyTarget}
                      setError={setError}
                      onBought={(data, trade) => {
                        if (data) setPortfolio(data);
                        if (trade) {
                          setTradePulse({ ticker: trade.ticker, action: "buy" });
                          setTradeSuccess(trade);
                        }
                      }}
                    />
                  ) : null}
                </>
              )}

              {category === "etfs" && (
                <>
                  <CryptoEtfsTicker
                    marketItems={marketItems}
                    onPickTicker={async (row) => {
                      const ticker = String(row?.ticker || row || "").toUpperCase();
                      if (!ticker) return;
                      const item = marketItems.find(
                        (m) => String(m.ticker).toUpperCase() === ticker
                      );
                      let price = item?.price != null ? Number(item.price) : null;
                      let name = item?.name || row?.name || ticker;
                      if (!(price > 0)) {
                        try {
                          const q = await getQuote(ticker);
                          price = q?.price != null ? Number(q.price) : null;
                          if (q?.name) name = q.name;
                        } catch {
                          /* ignore */
                        }
                      }
                      if (!(price > 0)) {
                        setError?.(
                          `Couldn’t load a live price for ${ticker} yet — try again in a moment.`
                        );
                        return;
                      }
                      setStockBuyTarget({
                        ticker,
                        name,
                        price,
                        change_pct: item?.change_pct ?? null,
                        asset_type: item?.asset_type || "etf",
                        info: item?.info || null,
                      });
                      setSelectedAsset(null);
                      setChartTicker(null);
                      setTradeDraft(null);
                    }}
                  />
                  {selectedId && stockBuyTarget ? (
                    <StockBuyModal
                      target={stockBuyTarget}
                      classId={classId}
                      studentId={selectedId}
                      cash={portfolio?.cash ?? 0}
                      onClose={() => setStockBuyTarget(null)}
                      onBought={(data, trade) => {
                        if (data) setPortfolio(data);
                        setStockBuyTarget(null);
                        if (trade) {
                          setTradePulse({ ticker: trade.ticker, action: "buy" });
                          setTradeSuccess(trade);
                        }
                      }}
                    />
                  ) : null}
                </>
              )}

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
                        setMarketPage(0);
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

              {category === "commodities" && (
                <p className="bond-note currency-explain">
                  Per-unit classroom prices (e.g. gold per ounce). Your buy locks in at the
                  price shown — we don’t rewrite past fills. Live futures when available;
                  otherwise a labeled approximate ETF proxy.
                </p>
              )}

              {category === "currencies" && (
                <p className="bond-note currency-explain">
                  Cash stays in U.S. dollars. Tap Buy and type how many dollars you want to
                  exchange — you’ll get that much foreign currency at today’s rate.
                </p>
              )}

              {category === "realestate" && (
                <p className="bond-note currency-explain">
                  Pay down payment and closing costs up front. Each month you collect rent,
                  make the mortgage payment, and home values update with the market.
                </p>
              )}

              {SHOW_WORLD_LENDING && category === "bonds" && !showWorldLending && (
                <button
                  type="button"
                  className="world-lending-entry"
                  data-click="select"
                  onClick={() => {
                    setShowWorldLending(true);
                    setSelectedAsset(null);
                    setTradeDraft(null);
                    setChartTicker(null);
                  }}
                >
                  <span className="world-lending-entry-globe" aria-hidden="true">
                    <Suspense
                      fallback={
                        <div className="globe-character-stage globe-character-fallback" />
                      }
                    >
                      <GlobeCharacter />
                    </Suspense>
                  </span>
                  <span className="world-lending-entry-copy">
                    <strong>Lend around the world</strong>
                    <span>
                      Lend money to governments around the world and earn interest.
                      Careful though, higher rates come with higher risk!
                    </span>
                  </span>
                  <span className="world-lending-entry-go" aria-hidden="true">
                    Open
                  </span>
                </button>
              )}

              {SHOW_WORLD_LENDING && showWorldLending && category === "bonds" ? (
                <WorldLendingMap
                  studentId={selectedId}
                  classId={classId}
                  cash={portfolio?.cash}
                  onPortfolio={(next) => {
                    if (next) setPortfolio(next);
                  }}
                />
              ) : (
                <>
              {(marketPricesPending || (marketLoading && marketItems.length === 0)) && (
                <div className="market-pricing-banner" role="status" aria-live="polite">
                  <span className="market-pricing-spinner" aria-hidden="true" />
                  <span>
                    {marketItems.length === 0
                      ? "Loading market…"
                      : "Fetching live prices…"}
                  </span>
                </div>
              )}

              {!marketPricesPending && pricingStatus && pricingStatus.ok === false && (
                <p className="bond-note currency-explain">
                  Prices aren’t loading ({pricingStatus.priced}/{pricingStatus.total} priced).
                  Buying is paused — try Refresh. {pricingStatus.error || ""}
                </p>
              )}

              {marketLoading && marketItems.length === 0 && (
                <p className="empty">Loading market…</p>
              )}

              {category === "realestate" && marketItems.length > 0 && (
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
                        const data = await buyHome(selectedId, item.ticker);
                        setPortfolio(data);
                        setTradePulse({ ticker: item.ticker, action: "buy" });
                        setTradeSuccess({
                          action: "buy",
                          ticker: item.ticker,
                          name: item.name || item.ticker,
                          assetType: "realestate",
                        });
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

              {category !== "realestate" && marketItems.length > 0 && (
                <div className="market-list">
                  {visibleMarketItems.length === 0 && (
                    <p className="empty">No stocks in this industry yet.</p>
                  )}
                  {pagedMarketItems.map((item) => {
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
                    const noPrice =
                      item.asset_type !== "bond" &&
                      !(Number(item.price) > 0);
                    const futuresOffline =
                      item.asset_type === "commodity" && item.buy_ok === false;
                    const approxCommodity =
                      item.asset_type === "commodity" &&
                      item.price_quality === "approximate" &&
                      !futuresOffline;
                    const buyBlocked =
                      draftOpen &&
                      tradeDraft.action === "buy" &&
                      (noPrice ||
                        futuresOffline ||
                        (item.asset_type === "currency" &&
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
                    const chartOpen =
                      SHOW_MARKET_PRICE_CHARTS && chartTicker === item.ticker;
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
                            {SHOW_MARKET_PRICE_CHARTS && item.asset_type !== "bond" && (
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
                          {item.asset_type === "commodity" && (
                            <span
                              className={
                                approxCommodity
                                  ? "bond-meta commodity-meta commodity-meta-approx"
                                  : "bond-meta commodity-meta"
                              }
                            >
                              {[
                                item.kind,
                                item.unit_label ? `per ${item.unit_label}` : null,
                                approxCommodity
                                  ? "approx. price · fill locks at buy"
                                  : item.price_quality === "futures"
                                    ? "live futures"
                                    : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
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
                                      : futuresOffline
                                        ? "row-buy disabled"
                                        : "row-buy"
                                  }
                                  data-click={
                                    draftOpen && tradeDraft.action === "buy"
                                      ? buyBlocked
                                        ? "select"
                                        : "confirm"
                                      : "select"
                                  }
                                  disabled={
                                    Boolean(buyBlocked) || noPrice || futuresOffline
                                  }
                                  aria-disabled={
                                    Boolean(buyBlocked) || noPrice || futuresOffline
                                  }
                                  aria-label={
                                    noPrice
                                      ? "Price unavailable"
                                      : futuresOffline
                                        ? "Commodity price unavailable — buying paused"
                                      : draftOpen && tradeDraft.action === "buy"
                                      ? buyBlocked
                                        ? "Not enough cash"
                                        : "Confirm buy"
                                      : "Buy"
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (noPrice) {
                                      setError("Wait for a live price before buying.");
                                      return;
                                    }
                                    if (futuresOffline) {
                                      setError(
                                        "Commodity price unavailable right now. Try again shortly — selling still works."
                                      );
                                      return;
                                    }
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
                                  ) : noPrice ? (
                                    "No price"
                                  ) : futuresOffline ? (
                                    "Paused"
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
                                      {approxCommodity && (
                                        <span className="commodity-fill-lock-note">
                                          Fill locks at {money(item.price)} — not rewritten later
                                        </span>
                                      )}
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
                              marketPricesPending && item.yield_pct == null ? (
                                <>
                                  <strong className="price-skeleton" aria-hidden="true" />
                                  <span className="price-pending">loading</span>
                                </>
                              ) : (
                              <>
                                <strong className="bond-yield">
                                  {item.yield_pct != null ? `${item.yield_pct.toFixed(2)}%` : "—"}
                                </strong>
                                <span>
                                  {item.price != null ? `${money(item.price)} face` : "— face"}
                                  {item.coupon_pct != null && item.coupon_pct > 0
                                    ? ` · ${item.coupon_pct.toFixed(2)}% coupon`
                                    : " · discount bill"}
                                </span>
                              </>
                              )
                            ) : marketPricesPending && item.price == null ? (
                              <>
                                <strong className="price-skeleton" aria-hidden="true" />
                                <span className="price-pending">loading</span>
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
                      {SHOW_MARKET_PRICE_CHARTS && chartOpen && (
                        <div className="market-row-chart">
                          <PriceChart ticker={item.ticker} name={item.name} />
                        </div>
                      )}
                      </div>
                    );
                  })}
                  {category === "stocks" && visibleMarketItems.length > MARKET_PAGE_SIZE && (
                    <div className="market-pager" role="navigation" aria-label="Stock pages">
                      <button
                        type="button"
                        className="ghost-btn market-pager-btn"
                        data-click="select"
                        disabled={safeMarketPage <= 0}
                        onClick={() => {
                          setMarketPage((p) => Math.max(0, p - 1));
                          setSelectedAsset(null);
                          setTradeDraft(null);
                        }}
                      >
                        Previous
                      </button>
                      <span className="market-pager-status">
                        {safeMarketPage * MARKET_PAGE_SIZE + 1}–
                        {Math.min(
                          (safeMarketPage + 1) * MARKET_PAGE_SIZE,
                          visibleMarketItems.length
                        )}{" "}
                        of {visibleMarketItems.length}
                      </span>
                      <button
                        type="button"
                        className="ghost-btn market-pager-btn"
                        data-click="select"
                        disabled={safeMarketPage >= stockPageCount - 1}
                        onClick={() => {
                          setMarketPage((p) => Math.min(stockPageCount - 1, p + 1));
                          setSelectedAsset(null);
                          setTradeDraft(null);
                        }}
                      >
                        Next
                      </button>
                    </div>
                  )}
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
                </>
              )}
            </div>
          )}

          {!showClass && !showNews && !showJobs && !showPurchases && !showBoard && (
          <section className="holdings" aria-label="Your holdings">
            <div className="holdings-head">
              <h3>Your holdings</h3>
              <p>Tap a holding, then Sell or Sell all</p>
            </div>
            {!portfolio.holdings?.length && !activeLoans.length && (
              <p className="empty">No shares yet. Pick a market above to start.</p>
            )}
            {(portfolio.holdings?.length > 0 || activeLoans.length > 0) && (
              <>
                <div
                  className="holdings-summary-row"
                  aria-label="Your holdings totals"
                >
                  <div className="holdings-summary-avatar" aria-hidden="true">
                    <Suspense
                      fallback={
                        <div className="standings-profile-avatar-fallback">
                          <span className="busy-spinner" />
                        </div>
                      }
                    >
                      <AvatarCanvas
                        outfit={holdingsAvatarOutfit}
                        mode="bust"
                        className="holdings-summary-stage"
                      />
                    </Suspense>
                  </div>
                  <div className="holdings-totals holdings-totals-inline">
                    <div className="holdings-total">
                      <span>Invested</span>
                      <strong>{money(holdingsTotals.invested)}</strong>
                    </div>
                    <div className="holdings-total">
                      <span>Value now</span>
                      <strong>{money(holdingsTotals.value)}</strong>
                    </div>
                    <div className="holdings-total">
                      <span>Return</span>
                      <strong
                        className={
                          holdingsTotals.gainPct == null
                            ? ""
                            : holdingsTotals.gainPct >= 0
                              ? "up"
                              : "down"
                        }
                      >
                        {holdingsTotals.gainPct == null
                          ? "—"
                          : `${holdingsTotals.gainPct >= 0 ? "+" : ""}${holdingsTotals.gainPct.toFixed(2)}%`}
                      </strong>
                      <em
                        className={
                          holdingsTotals.gain >= 0 ? "up" : "down"
                        }
                      >
                        {`${holdingsTotals.gain >= 0 ? "+" : ""}${money(holdingsTotals.gain)}`}
                      </em>
                    </div>
                  </div>
                </div>
              </>
            )}
            <div className="holdings-summary-row holdings-fly-row" aria-label="Fruit fly benchmark">
              <div className="holdings-summary-avatar" aria-hidden="true">
                <Suspense
                  fallback={
                    <div className="standings-profile-avatar-fallback">
                      <span className="busy-spinner" />
                    </div>
                  }
                >
                  <AvatarCanvas
                    outfit={CLASS_FISH_OUTFIT}
                    mode="bust"
                    className="holdings-summary-stage"
                  />
                </Suspense>
              </div>
              <div className="holdings-totals holdings-totals-inline">
                <div className="holdings-total">
                  <span>Invested</span>
                  <strong>{money(fruitFlyBenchmark.invested)}</strong>
                </div>
                <div className="holdings-total">
                  <span>Value now</span>
                  <strong>{money(fruitFlyBenchmark.value)}</strong>
                </div>
                <div className="holdings-total">
                  <span>Return</span>
                  <strong className="up">
                    +{fruitFlyBenchmark.gainPct.toFixed(2)}%
                  </strong>
                  <em className="up">
                    +{money(fruitFlyBenchmark.gain)}
                  </em>
                </div>
              </div>
            </div>
            {(portfolio.holdings?.length > 0 || activeLoans.length > 0) && (
              <div className="holdings-cols" aria-hidden="true">
                <span>Holding</span>
                <span className="holding-col-tip">
                  Cost basis
                  <span className="holding-col-tip-bubble">
                    What you paid when you bought this.
                  </span>
                </span>
                <span className="holding-col-tip">
                  Value
                  <span className="holding-col-tip-bubble">
                    What it’s worth now — what you’d get if you sold today.
                  </span>
                </span>
                <span>Gain / loss</span>
                <span />
              </div>
            )}
            <div className="holdings-list">
            {holdingsByCategory.map((group) => (
              <div key={group.id} className={`holdings-group holdings-group-${group.id}`}>
                <div className="holdings-category">
                  <h4>{group.label}</h4>
                  <span>
                    {group.holdings.length}{" "}
                    {group.holdings.length === 1 ? "position" : "positions"}
                  </span>
                </div>
            {group.holdings.map((h) => {
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
                const net = h.monthly_net;
                const netLabel =
                  net == null
                    ? ""
                    : ` · ${net >= 0 ? "+" : "−"}${money(Math.abs(net))}/mo`;
                qtyLabel = `${h.name || h.ticker} · loan ${money(h.mortgage_balance)}${netLabel}`;
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
                  <span className="holding-stat-label holding-col-tip">
                    Cost basis
                    <span className="holding-col-tip-bubble">
                      What you paid when you bought this.
                    </span>
                  </span>
                  <strong>{money(costBasis)}</strong>
                </div>

                <div className="holding-stat">
                  <span className="holding-stat-label holding-col-tip">
                    {item.asset_type === "realestate" ? "Equity" : "Value"}
                    <span className="holding-col-tip-bubble">
                      {item.asset_type === "realestate"
                        ? "Home value minus what you still owe on the loan."
                        : "What it’s worth now — what you’d get if you sold today."}
                    </span>
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
                      : item.asset_type === "bond"
                        ? `${money(h.price)} per unit`
                        : item.asset_type === "currency"
                          ? `${money(h.price)} now`
                          : `${money(h.price)} per share`}
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
            ))}
            {activeLoans.length > 0 && (
              <div className="holdings-group holdings-group-loans">
                <div className="holdings-category">
                  <h4>Country loans</h4>
                  <span>
                    {activeLoans.length}{" "}
                    {activeLoans.length === 1 ? "position" : "positions"}
                  </span>
                </div>
                {activeLoans.map((loan) => {
                  const principal = Number(loan.principal) || 0;
                  const earned = Number(loan.interestEarned) || 0;
                  const nextLabel = loan.pending
                    ? "payment waiting now"
                    : loan.nextDueAt
                      ? `next ${new Date(loan.nextDueAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}`
                      : "";
                  const rowKey = `loan:${loan.id}`;
                  const loanSelected = selectedHolding === rowKey;
                  const toggleLoan = () => {
                    if (tradeDraft?.source === "holding") setTradeDraft(null);
                    setSelectedHolding(loanSelected ? null : rowKey);
                  };
                  return (
                    <div
                      key={loan.id}
                      className={`holding-row holding-row-loan${loanSelected ? " selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      data-click="select"
                      onClick={toggleLoan}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleLoan();
                        }
                      }}
                    >
                      <div className="holding-identity">
                        <strong>{loan.countryName}</strong>
                        <span>
                          {Number(loan.ratePct).toFixed(1)}% · payment{" "}
                          {loan.paymentsHandled}/{loan.totalPayments}
                          {nextLabel ? ` · ${nextLabel}` : ""}
                        </span>
                      </div>

                      <div className="holding-stat">
                        <span className="holding-stat-label">Cost basis</span>
                        <strong>{money(principal)}</strong>
                      </div>

                      <div className="holding-stat">
                        <span className="holding-stat-label holding-col-tip">
                          Value
                          <span className="holding-col-tip-bubble">
                            What you lent — it comes back with the final payment.
                          </span>
                        </span>
                        <strong>{money(principal)}</strong>
                        {loan.salePrice != null && (
                          <span className="holding-stat-sub">
                            Sell now: {money(loan.salePrice)}
                          </span>
                        )}
                      </div>

                      <div className="holding-stat holding-gain">
                        <span className="holding-stat-label">Interest earned</span>
                        <strong className={earned > 0 ? "up" : ""}>
                          {earned > 0 ? "+" : ""}
                          {money(earned)}
                        </strong>
                        <span className={loan.missedCount > 0 ? "down" : ""}>
                          {loan.paidCount} paid · {loan.missedCount} missed
                        </span>
                      </div>

                      <div className="holding-row-actions">
                        {loanSelected && (
                          <div className="row-trade-btns">
                            <button
                              type="button"
                              className="row-sell"
                              data-click="select"
                              aria-label={`Sell your ${loan.countryName} loan`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setLoanToSell(loan);
                              }}
                            >
                              Sell
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            </div>
          </section>
          )}
        </>
      )}
      <TradeSuccessModal trade={tradeSuccess} onClose={closeTradeSuccess} />
      <LoanSellModal
        loan={loanToSell}
        studentId={portfolio?.id}
        classId={classId}
        onClose={() => setLoanToSell(null)}
        onSold={(data, sold) => {
          setLoanToSell(null);
          setSelectedHolding(null);
          if (Array.isArray(data?.loans)) setStudentLoans(data.loans);
          if (selectedId) loadPortfolio(selectedId).catch(() => {});
          const loss = Math.max(0, Number(sold.principal) - Number(sold.salePrice));
          setTradeSuccess({
            action: "sell",
            assetType: "loan",
            ticker: sold.countryId,
            name: sold.countryName,
            total: sold.salePrice,
            note:
              loss > 0
                ? `You took a ${money(loss)} loss on the loan. The ${money(
                    sold.interestEarned
                  )} interest you collected is still yours.`
                : `You got your full ${money(sold.principal)} back.`,
          });
        }}
      />
      {classId && firestoreStudentId && (
        <>
          <HeadToHeadModal
            classId={classId}
            firestoreStudentId={firestoreStudentId}
            studentName={portfolio?.name}
            apiStudentId={portfolio?.id || selectedId}
            portfolioHoldings={portfolio?.holdings || []}
            resumeToken={h2hResumeToken}
            onPortfolioRefresh={() => {
              if (selectedId) loadPortfolio(selectedId).catch(() => {});
            }}
            onPicksLocked={(matchId) => {
              setH2hFocusMatchId(matchId || "");
              setShowH2HBattle(true);
            }}
          />
          <HeadToHeadBattleModal
            open={showH2HBattle}
            onClose={() => {
              setShowH2HBattle(false);
              setH2hFocusMatchId("");
            }}
            onResumePicks={() => setH2hResumeToken((n) => n + 1)}
            classId={classId}
            firestoreStudentId={firestoreStudentId}
            studentName={portfolio?.name}
            focusMatchId={h2hFocusMatchId}
          />
        </>
      )}
      {SHOW_WHATS_NEW && lockedStudentId && portfolio ? (
        <WhatsNewAlert
          classId={firestoreStudentId ? classId : ""}
          studentId={firestoreStudentId || String(lockedStudentId)}
          alwaysShow={WHATS_NEW_ALWAYS_SHOW}
          hideFeatures={[
            ...(SHOW_WORLD_LENDING &&
            (enabledMarkets || DEFAULT_MARKETS).bonds !== false
              ? []
              : ["lend"]),
            ...(classId ? [] : ["jobs"]),
          ]}
          onOpenFeature={(feature) => {
            setShowClass(false);
            setShowNews(false);
            setShowPurchases(false);
            setShowBoard(false);
            setSelectedAsset(null);
            setTradeDraft(null);
            setChartTicker(null);
            if (feature === "lend") {
              setShowJobs(false);
              setCategory("bonds");
              setShowWorldLending(true);
            } else if (feature === "jobs") {
              setCategory(null);
              setShowWorldLending(false);
              setShowJobs(true);
            } else if (feature === "create") {
              setShowJobs(false);
              setOpenCreateRequest((n) => n + 1);
            }
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      ) : null}
    </section>
  );
}

export default function App() {
  const initialJoin = parseJoinCodeFromUrl();
  const [joinCode, setJoinCode] = useState(initialJoin);
  const [studentSession, setStudentSessionState] = useState(
    initialJoin ? null : getStudentSession()
  );
  const [soundOn, setSoundOn] = useState(readSoundPref);
  const [teacher, setTeacher] = useState(null);
  const [teacherReady, setTeacherReady] = useState(Boolean(initialJoin));
  const [apiStudents, setApiStudents] = useState([]);
  const [roster, setRoster] = useState([]);
  const [activeClassId, setActiveClassIdState] = useState(() => getActiveClassId());
  const [enabledMarkets, setEnabledMarkets] = useState({ ...DEFAULT_MARKETS });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [portfolioRefreshToken, setPortfolioRefreshToken] = useState(0);

  async function refreshApiStudents(classIdOverride) {
    const classId =
      classIdOverride ||
      activeClassId ||
      getStudentSession()?.classId ||
      getActiveClassId() ||
      undefined;
    try {
      const data = await listStudents(false, classId);
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
    const classId = result?.classId || session?.classId || "";
    if (classId) handleActiveClassChange(classId);
    refreshApiStudents(classId);
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
    const unsub = watchAccountAuth((account) => {
      if (cancelled) return;
      setTeacherReady(true);
      if (!account) {
        setTeacher(null);
        return;
      }
      if (account.type === "teacher") {
        clearStudentSession();
        setStudentSessionState(null);
        setTeacher(account.profile);
        return;
      }
      if (account.type === "student" && account.session) {
        setTeacher(null);
        setStudentSession(account.session);
        setStudentSessionState(account.session);
        if (account.session.classId) {
          setActiveClassId(account.session.classId);
          setActiveClassIdState(account.session.classId);
        }
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
    const forceMute =
      Boolean(joinCode) ||
      Boolean(teacher) ||
      (!studentSession && teacherReady);
    setClickMuted(forceMute || !soundOn);
  }, [joinCode, teacher, studentSession, teacherReady, soundOn]);

  function toggleStudentSound() {
    setSoundOn((prev) => {
      const next = !prev;
      writeSoundPref(next);
      return next;
    });
  }

  const classStudents = (() => {
    const byId = new Map(apiStudents.map((s) => [String(s.id), s]));
    return roster
      .map((r) => {
        const tradingId = r.apiStudentId || r.id;
        const live = tradingId != null ? byId.get(String(tradingId)) : null;
        if (live) return live;
        if (tradingId != null) {
          return {
            id: tradingId,
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

  // Heal sessions that still store a numeric SQLite trading id.
  useEffect(() => {
    if (!studentSession?.firestoreStudentId) return;
    const seatId = studentSession.firestoreStudentId;
    const trading = studentSession.apiStudentId;
    if (!trading || String(trading) === String(seatId)) return;
    if (!/^\d+$/.test(String(trading))) return;
    const next = {
      ...studentSession,
      apiStudentId: seatId,
    };
    setStudentSession(next);
    setStudentSessionState(next);
  }, [studentSession]);

  const brandSub =
    teacher && !studentSession && !joinCode
      ? "For teachers"
      : "Classroom investing";

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
        teacher={teacher}
        students={apiStudents}
        activeClassId={activeClassId}
        onActiveClassChange={handleActiveClassChange}
        onRosterChange={(rows) => {
          setRoster(rows);
          refreshApiStudents();
        }}
        setError={setError}
        setBusy={setBusy}
        busy={busy}
      />
    );
  } else if (studentSession) {
    mainContent = (
      <StudentPortfolio
        students={sessionStudents}
        lockedStudentId={studentSession.apiStudentId || null}
        enabledMarkets={enabledMarkets}
        investmentGoal={investmentGoal}
        classId={studentSession.classId || ""}
        className={studentSession.className || ""}
        firestoreStudentId={studentSession.firestoreStudentId || ""}
        studentEmail={studentSession.email || ""}
        portfolioRefreshToken={portfolioRefreshToken}
        busy={busy}
        setError={setError}
        setBusy={setBusy}
      />
    );
  } else {
    mainContent = (
      <TeacherGate
        onAuthenticated={(result) => {
          setError("");
          if (result?.role === "teacher" && result.profile) {
            clearStudentSession();
            setStudentSessionState(null);
            setTeacher(result.profile);
            return;
          }
          if (result?.role === "student" && result.session) {
            setTeacher(null);
            setStudentSession(result.session);
            setStudentSessionState(result.session);
            if (result.session.classId) {
              handleActiveClassChange(result.session.classId);
            }
            refreshApiStudents();
          }
        }}
        setError={setError}
        setBusy={setBusy}
      />
    );
  }

  return (
    <div className="app-shell">
      <div className="bg-glow" aria-hidden="true" />
      {studentSession && !joinCode && !teacher && studentSession.classId ? (
        <StockRequestForm
          classId={studentSession.classId}
          className={studentSession.className || ""}
          studentId={
            studentSession.firestoreStudentId ||
            studentSession.apiStudentId ||
            ""
          }
          studentName={studentSession.name || ""}
        />
      ) : null}
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
            <button
              type="button"
              className={`sound-toggle${soundOn ? "" : " is-off"}`}
              aria-pressed={soundOn}
              aria-label={soundOn ? "Turn sound effects off" : "Turn sound effects on"}
              title={soundOn ? "Sound on" : "Sound off"}
              onClick={toggleStudentSound}
            >
              {soundOn ? (
                <svg
                  className="sound-toggle-icon"
                  viewBox="0 0 24 24"
                  width="28"
                  height="28"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                  />
                </svg>
              ) : (
                <svg
                  className="sound-toggle-icon"
                  viewBox="0 0 24 24"
                  width="28"
                  height="28"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"
                  />
                </svg>
              )}
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
          <>
            <CashTransferAlert
              classId={studentSession.classId}
              firestoreStudentId={studentSession.firestoreStudentId}
              apiStudentId={studentSession.apiStudentId}
              onAccepted={() => {
                refreshApiStudents();
                setPortfolioRefreshToken((n) => n + 1);
              }}
            />
            <PartnershipInviteAlert
              classId={studentSession.classId}
              studentId={
                studentSession.firestoreStudentId ||
                studentSession.apiStudentId ||
                ""
              }
            />
            <LendingInterestAlert
              classId={studentSession.classId}
              studentId={studentSession.apiStudentId}
              refreshKey={portfolioRefreshToken}
              onCollected={() => {
                refreshApiStudents();
                setPortfolioRefreshToken((n) => n + 1);
              }}
            />
          </>
        )}

      {SHOW_LENDING_INTEREST_DEMO && !joinCode && <LendingInterestAlert demo />}

      <main>{mainContent}</main>
    </div>
  );
}

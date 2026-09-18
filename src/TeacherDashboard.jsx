import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  addMarketExtra,
  deleteStudent,
  getStudent,
  listClosetAiReviews,
  reviewClosetAiJob,
  searchMarketTickers,
} from "./api";
import ClassAggregatePanel from "./ClassAggregatePanel";
import ClassInviteCard from "./ClassInviteCard";
import ClassMessageBoard from "./ClassMessageBoard";
import ClassView from "./ClassView";
import ClosetReviewPreview from "./ClosetReviewPreview";
import SpinWheelModal, { SpinWheelFab } from "./SpinWheel";
import {
  DEFAULT_MARKETS,
  createClass,
  createHeadToHeadChallenge,
  createPendingTransfer,
  deleteClass,
  deleteClassStudent,
  endHeadToHeadChallenge,
  ensureInviteCode,
  getActiveClassId,
  inviteUrlForCode,
  listClassStudents,
  listClasses,
  setActiveClassId,
  subscribeHeadToHead,
  subscribeStockRequests,
  resolveStockRequest,
  updateClassSettings,
} from "./classStore";
import TeacherHeadToHeadModal from "./TeacherHeadToHeadModal";

/** Set true to restore class chat on the teacher dashboard. */
const SHOW_CLASS_CHAT = false;

const MARKET_OPTIONS = [
  { id: "stocks", label: "Stocks" },
  { id: "etfs", label: "ETFs" },
  { id: "bonds", label: "Bonds" },
  { id: "commodities", label: "Commodities" },
  { id: "currencies", label: "Currencies" },
  { id: "realestate", label: "Real estate" },
];

function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function formatStartingCash(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) return "$";
  return `$${Number(digits).toLocaleString("en-US")}`;
}

function parseStartingCash(raw) {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  return digits.replace(/^0+(?=\d)/, "") || "0";
}

export default function TeacherDashboard({
  teacher = null,
  students: apiStudents,
  activeClassId,
  onActiveClassChange,
  onRosterChange,
  setError,
  setBusy,
  busy = false,
}) {
  const [classes, setClasses] = useState([]);
  const [view, setView] = useState("list"); // list | create | class | roster | settings
  const [className, setClassName] = useState("");
  const [startingCash, setStartingCash] = useState("100000");
  const [markets, setMarkets] = useState({ ...DEFAULT_MARKETS });
  const [roster, setRoster] = useState([]);
  const [customAmounts, setCustomAmounts] = useState({});
  const [classPortfolios, setClassPortfolios] = useState([]);
  const [aggLoading, setAggLoading] = useState(false);
  const [aggRefreshing, setAggRefreshing] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [showStandings, setShowStandings] = useState(false);
  const [showSpinWheel, setShowSpinWheel] = useState(false);
  const [headToHead, setHeadToHead] = useState(null);
  const [confirmH2H, setConfirmH2H] = useState(false);
  const [showH2HMatchups, setShowH2HMatchups] = useState(false);
  const [closetReviews, setClosetReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewBusyId, setReviewBusyId] = useState(null);
  const [stockRequests, setStockRequests] = useState([]);
  const [stockRequestBusyId, setStockRequestBusyId] = useState(null);
  const [marketSearch, setMarketSearch] = useState("");
  const [marketSearchResults, setMarketSearchResults] = useState([]);
  const [marketSearchBusy, setMarketSearchBusy] = useState(false);
  const [marketAddBusy, setMarketAddBusy] = useState("");
  const [marketSearchError, setMarketSearchError] = useState("");

  const activeClass = useMemo(
    () => classes.find((c) => c.id === activeClassId) || null,
    [classes, activeClassId]
  );

  async function refreshClasses() {
    const rows = await listClasses();
    setClasses(rows);
    return rows;
  }

  async function refreshClosetReviews(classId = activeClassId) {
    if (!classId || !teacher?.uid) {
      setClosetReviews([]);
      return [];
    }
    setReviewsLoading(true);
    try {
      const data = await listClosetAiReviews(classId, teacher.uid);
      const rows = Array.isArray(data?.reviews) ? data.reviews : [];
      setClosetReviews(rows);
      return rows;
    } catch (err) {
      setClosetReviews([]);
      setError?.(err.message || "Could not load closet reviews");
      return [];
    } finally {
      setReviewsLoading(false);
    }
  }

  async function handleClosetReview(jobId, action) {
    if (!activeClassId || !teacher?.uid || !jobId || reviewBusyId) return;
    setReviewBusyId(jobId);
    setError?.("");
    try {
      await reviewClosetAiJob(activeClassId, teacher.uid, jobId, action);
      setClosetReviews((prev) => prev.filter((r) => r.jobId !== jobId));
    } catch (err) {
      setError?.(err.message || `Could not ${action} submission`);
    } finally {
      setReviewBusyId(null);
    }
  }

  async function refreshRoster(classId = activeClassId) {
    if (!classId) {
      setRoster([]);
      onRosterChange?.([]);
      return [];
    }
    const rows = await listClassStudents(classId);
    setRoster(rows);
    onRosterChange?.(rows);
    return rows;
  }

  async function loadClassAggregates(classId, rosterRows) {
    const rows = rosterRows || (classId ? await listClassStudents(classId) : []);
    const ids = rows
      .map((s) => s.apiStudentId || s.id)
      .filter((id) => id != null && id !== "");
    if (!ids.length) {
      setClassPortfolios([]);
      return [];
    }
    const portfolios = await Promise.all(
      ids.map(async (id) => {
        try {
          return await getStudent(id, classId);
        } catch {
          return null;
        }
      })
    );
    const filtered = portfolios.filter(Boolean);
    setClassPortfolios(filtered);
    return filtered;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const rows = await listClasses();
        if (cancelled) return;
        setClasses(rows);
        const saved = activeClassId || getActiveClassId();
        if (saved && rows.some((c) => c.id === saved)) {
          onActiveClassChange(saved);
          const rosterRows = await listClassStudents(saved);
          if (!cancelled) {
            setRoster(rosterRows);
            onRosterChange?.(rosterRows);
          }
        }
        setView(rows.length ? "list" : "create");
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not load classes from Firebase");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // intentionally once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view !== "class" || !activeClassId) return;
    let cancelled = false;
    (async () => {
      setAggLoading(true);
      try {
        const rosterRows = await refreshRoster(activeClassId);
        if (cancelled) return;
        await loadClassAggregates(activeClassId, rosterRows);
        if (!cancelled) await refreshClosetReviews(activeClassId);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setAggLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeClassId, teacher?.uid]);

  useEffect(() => {
    if (!activeClassId) {
      setHeadToHead(null);
      return;
    }
    return subscribeHeadToHead(activeClassId, setHeadToHead);
  }, [activeClassId]);

  useEffect(() => {
    if (view !== "class" || !activeClassId) {
      setStockRequests([]);
      return undefined;
    }
    return subscribeStockRequests(
      activeClassId,
      (rows) => setStockRequests(rows.filter((r) => r.status === "pending")),
      (err) => setError?.(err.message || "Could not load stock requests")
    );
  }, [view, activeClassId, setError]);

  async function handleResolveStockRequest(requestId, status = "done") {
    if (!activeClassId || !requestId || stockRequestBusyId) return;
    setStockRequestBusyId(requestId);
    try {
      await resolveStockRequest(activeClassId, requestId, status);
    } catch (err) {
      setError?.(err.message || "Could not update request");
    } finally {
      setStockRequestBusyId(null);
    }
  }

  async function handleMarketSearch(e) {
    e?.preventDefault?.();
    const q = marketSearch.trim();
    if (!activeClassId || !q || marketSearchBusy) return;
    setMarketSearchBusy(true);
    setMarketSearchError("");
    setError?.("");
    try {
      const data = await searchMarketTickers(activeClassId, q);
      setMarketSearchResults(Array.isArray(data?.results) ? data.results : []);
      if (!(data?.results || []).length) {
        setMarketSearchError("No matches — try a ticker or company name.");
      }
    } catch (err) {
      setMarketSearchResults([]);
      setMarketSearchError(err.message || "Search failed");
    } finally {
      setMarketSearchBusy(false);
    }
  }

  async function handleAddMarketTicker(row) {
    if (!activeClassId || !teacher?.uid || !row?.ticker || marketAddBusy) return;
    setMarketAddBusy(row.ticker);
    setError?.("");
    setMarketSearchError("");
    try {
      await addMarketExtra(activeClassId, teacher.uid, {
        ticker: row.ticker,
        name: row.name || row.ticker,
        category: row.category === "etfs" ? "etfs" : "stocks",
        industry: "Custom",
      });
      setMarketSearchResults((prev) =>
        prev.map((r) =>
          r.ticker === row.ticker ? { ...r, alreadyOnMarket: true } : r
        )
      );
    } catch (err) {
      setMarketSearchError(err.message || `Could not add ${row.ticker}`);
    } finally {
      setMarketAddBusy("");
    }
  }

  async function startHeadToHead() {
    if (!activeClass) return;
    setBusy(true);
    setError("");
    try {
      const challenge = await createHeadToHeadChallenge(activeClass.id);
      setHeadToHead(challenge);
      setConfirmH2H(false);
    } catch (err) {
      setError(err.message || "Could not start head-to-head");
    } finally {
      setBusy(false);
    }
  }

  async function stopHeadToHead() {
    if (!activeClass) return;
    setBusy(true);
    setError("");
    try {
      await endHeadToHeadChallenge(activeClass.id);
      setHeadToHead(null);
      setShowH2HMatchups(false);
    } catch (err) {
      setError(err.message || "Could not end head-to-head");
    } finally {
      setBusy(false);
    }
  }

  function toggleMarket(id) {
    setMarkets((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleCreateClass(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const created = await createClass({
        name: className,
        startingCash: Number(startingCash) || 0,
        markets,
      });
      const id = created.id;
      setActiveClassId(id);
      onActiveClassChange(id);
      setClassName("");
      setStartingCash("100000");
      setMarkets({ ...DEFAULT_MARKETS });
      await refreshClasses();
      await refreshRoster(id);
      setView("list");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openClass(id) {
    setBusy(true);
    setError("");
    try {
      setActiveClassId(id);
      onActiveClassChange(id);
      await refreshRoster(id);
      setShowStandings(false);
      setView("class");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveClassSettings(e) {
    e.preventDefault();
    if (!activeClass) return;
    setBusy(true);
    setError("");
    try {
      await updateClassSettings(activeClass.id, {
        name: className.trim() || activeClass.name,
        startingCash: Number(startingCash) || 0,
        markets,
      });
      await refreshClasses();
      setView("class");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!activeClass || (view !== "settings" && view !== "create")) return;
    if (view === "settings") {
      setClassName(activeClass.name || "");
      setStartingCash(String(activeClass.startingCash ?? 100000));
      setMarkets({ ...DEFAULT_MARKETS, ...(activeClass.markets || {}) });
    }
  }, [activeClass, view]);

  useEffect(() => {
    if (view !== "class" || !activeClassId) return;
    let cancelled = false;
    (async () => {
      try {
        const code = await ensureInviteCode(activeClassId);
        if (!cancelled) {
          setInviteCode(code);
          await refreshClasses();
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeClassId]);

  async function copyInviteLink() {
    const code = inviteCode || (await ensureInviteCode(activeClassId));
    setInviteCode(code);
    const link = inviteUrlForCode(code);
    try {
      await navigator.clipboard.writeText(link);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      window.prompt("Copy this invite link:", link);
    }
  }

  async function bump(student, amount) {
    if (!activeClass || !student.apiStudentId) return;
    setBusy(true);
    setError("");
    try {
      await createPendingTransfer(activeClass.id, student.id, { amount });
      await refreshRoster(activeClass.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function requestRemoveStudent(student) {
    if (!activeClass || !student) return;
    setPendingRemove(student);
  }

  async function confirmRemoveStudent() {
    if (!activeClass || !pendingRemove) return;
    const student = pendingRemove;
    setPendingRemove(null);
    setBusy(true);
    setError("");
    try {
      const seatId = student.id;
      const tradeId = student.apiStudentId || student.id;
      // Cascade holdings/snapshots via API (Admin SDK). Prefer the seat doc id.
      for (const id of [...new Set([seatId, tradeId].filter(Boolean))]) {
        try {
          await deleteStudent(id, activeClass.id);
        } catch {
          // Local/API student may already be gone.
        }
      }
      await deleteClassStudent(activeClass.id, seatId, {
        authUid: student.authUid || null,
      });
      await refreshRoster(activeClass.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeClass() {
    if (!activeClass) return;
    if (
      !window.confirm(
        `Delete class “${activeClass.name}” and its Firebase roster? Trading accounts on this computer are also removed for those students.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      for (const s of roster) {
        if (s.apiStudentId || s.id) {
          try {
            await deleteStudent(s.apiStudentId || s.id, activeClass.id);
          } catch {
            /* ignore */
          }
        }
      }
      await deleteClass(activeClass.id);
      onActiveClassChange("");
      setRoster([]);
      onRosterChange?.([]);
      setClassPortfolios([]);
      await refreshClasses();
      setView("list");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAggRefresh() {
    if (!activeClassId) return;
    setAggRefreshing(true);
    setError("");
    try {
      const rosterRows = await refreshRoster(activeClassId);
      await loadClassAggregates(activeClassId, rosterRows);
    } catch (err) {
      setError(err.message);
    } finally {
      setAggRefreshing(false);
    }
  }

  const apiById = useMemo(() => {
    const map = new Map();
    for (const s of apiStudents || []) map.set(s.id, s);
    return map;
  }, [apiStudents]);

  const showNewClass = view === "list";

  function goBackFromClassView() {
    if (showStandings) {
      setShowStandings(false);
      return;
    }
    if (view === "roster" || view === "settings") {
      setView("class");
      return;
    }
    if (view === "class") {
      setView("list");
    }
  }

  const showClassBack = view === "class" || view === "roster" || view === "settings";

  return (
    <section className="panel teacher-panel">
      <header className="panel-header">
        <div className="panel-header-lead">
          {showClassBack && (
            <button
              type="button"
              className="panel-back-btn"
              data-click="select"
              aria-label={
                view === "class" ? "Back to all classes" : "Back to class"
              }
              onClick={goBackFromClassView}
            >
              <svg
                className="panel-back-icon"
                viewBox="0 0 24 24"
                width="22"
                height="22"
                aria-hidden="true"
              >
                <path
                  d="M15.5 4.5 7.5 12l8 7.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          <div>
            <h2>
              {view === "class" && activeClass
                ? activeClass.name
                : view === "roster" && activeClass
                  ? `${activeClass.name} roster`
                  : view === "settings" && activeClass
                    ? `${activeClass.name} settings`
                    : "Teacher dashboard"}
            </h2>
            <p>
              {view === "class"
                ? "Class-wide portfolio value and how the group is invested."
                : view === "roster"
                  ? "Students who joined with your invite link. Adjust cash or remove accounts here."
                  : view === "settings"
                    ? "Starting cash and markets available to this class."
                    : "Create a class, then share its invite link with students."}
            </p>
          </div>
        </div>
        <div className="teacher-header-actions">
          {showNewClass && (
            <button
              type="button"
              className="ghost-btn"
              data-click="select"
              onClick={() => {
                setClassName("");
                setStartingCash("100000");
                setMarkets({ ...DEFAULT_MARKETS });
                setView("create");
              }}
            >
              New class
            </button>
          )}
        </div>
      </header>

      {view === "list" && (
        <div className="class-list">
          {classes.length === 0 && (
            <p className="empty">No classes yet. Create one to start a roster.</p>
          )}
          {classes.map((c) => (
            <button
              key={c.id}
              type="button"
              className={c.id === activeClassId ? "class-card active" : "class-card"}
              data-click="select"
              onClick={() => openClass(c.id)}
            >
              <strong>{c.name}</strong>
              <span>
                Starts at {money(c.startingCash)} ·{" "}
                {Object.entries(c.markets || DEFAULT_MARKETS)
                  .filter(([, on]) => on)
                  .map(([id]) => MARKET_OPTIONS.find((m) => m.id === id)?.label || id)
                  .join(", ") || "No markets"}
              </span>
            </button>
          ))}
        </div>
      )}

      {view === "create" && (
        <form className="class-settings-form" onSubmit={handleCreateClass}>
          <h3>Create a class</h3>
          <label>
            Class name
            <input
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              placeholder="Period 3 Finance"
              autoComplete="off"
              required
            />
          </label>
          <label>
            Starting cash (each student)
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={formatStartingCash(startingCash)}
              onChange={(e) => setStartingCash(parseStartingCash(e.target.value))}
            />
          </label>
          <fieldset className="market-toggles">
            <legend>Markets available to students</legend>
            {MARKET_OPTIONS.map((m) => (
              <label key={m.id} className="market-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(markets[m.id])}
                  onChange={() => toggleMarket(m.id)}
                />
                {m.label}
              </label>
            ))}
          </fieldset>
          <div className="form-actions">
            {classes.length > 0 && (
              <button
                type="button"
                className="ghost-btn"
                data-click="select"
                onClick={() => setView("list")}
              >
                Cancel
              </button>
            )}
            <button type="submit" className="primary-btn" data-click="confirm">
              Create class
            </button>
          </div>
        </form>
      )}

      {view === "class" && activeClass && (
        <div className="class-dashboard">
          <ClassInviteCard
            inviteCode={inviteCode}
            onCopy={copyInviteLink}
            copied={inviteCopied}
          />

          <ClassAggregatePanel
            className={activeClass.name}
            portfolios={classPortfolios}
            loading={aggLoading}
            refreshing={aggRefreshing}
            onRefresh={handleAggRefresh}
          />

          <div className="closet-review-panel market-search-panel">
            <div className="closet-review-head">
              <div>
                <p className="closet-kicker">Market</p>
                <strong>Add stocks with Finnhub</strong>
              </div>
            </div>
            <p className="market-search-lead">
              Search by ticker or company name, then add it for every class.
            </p>
            <form className="market-search-form" onSubmit={handleMarketSearch}>
              <input
                type="search"
                value={marketSearch}
                onChange={(e) => setMarketSearch(e.target.value)}
                placeholder="e.g. NVDA or NVIDIA"
                aria-label="Search stocks"
                autoComplete="off"
              />
              <button
                type="submit"
                className="primary-btn"
                data-click="confirm"
                disabled={marketSearchBusy || !marketSearch.trim()}
              >
                {marketSearchBusy ? "Searching…" : "Search"}
              </button>
            </form>
            {marketSearchError ? (
              <p className="market-search-error">{marketSearchError}</p>
            ) : null}
            {marketSearchResults.length > 0 ? (
              <div className="market-search-results">
                {marketSearchResults.map((row) => (
                  <article key={row.ticker} className="market-search-row">
                    <div className="market-search-row-main">
                      <strong>{row.ticker}</strong>
                      <span>
                        {row.name}
                        {row.type ? ` · ${row.type}` : ""}
                        {row.category === "etfs" ? " · ETF" : ""}
                      </span>
                    </div>
                    {row.alreadyOnMarket || row.inCatalog ? (
                      <span className="market-search-badge">On market</span>
                    ) : (
                      <button
                        type="button"
                        className="primary-btn"
                        data-click="confirm"
                        disabled={marketAddBusy === row.ticker || !teacher?.uid}
                        onClick={() => handleAddMarketTicker(row)}
                      >
                        {marketAddBusy === row.ticker ? "…" : "Add"}
                      </button>
                    )}
                  </article>
                ))}
              </div>
            ) : null}
          </div>

          <div className="closet-review-panel">
            <div className="closet-review-head">
              <div>
                <p className="closet-kicker">Market</p>
                <strong>Stock requests</strong>
              </div>
            </div>
            {stockRequests.length === 0 ? (
              <p className="empty">No pending stock requests from students.</p>
            ) : (
              <div className="closet-review-list">
                {stockRequests.map((row) => (
                  <article key={row.id} className="closet-review-card">
                    <div className="closet-review-card-main">
                      <strong>{row.query}</strong>
                      <span>
                        requested by {row.studentName || "Student"}
                        {row.createdAt
                          ? ` · ${row.createdAt.toLocaleString?.(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            }) || ""}`
                          : ""}
                      </span>
                    </div>
                    <div className="closet-review-actions">
                      <button
                        type="button"
                        className="primary-btn"
                        data-click="confirm"
                        disabled={stockRequestBusyId === row.id}
                        onClick={() => handleResolveStockRequest(row.id, "done")}
                      >
                        {stockRequestBusyId === row.id ? "…" : "Done"}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        data-click="select"
                        disabled={stockRequestBusyId === row.id}
                        onClick={() =>
                          handleResolveStockRequest(row.id, "dismissed")
                        }
                      >
                        Dismiss
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="closet-review-panel">
            <div className="closet-review-head">
              <div>
                <p className="closet-kicker">Closet creations</p>
                <strong>Teacher review</strong>
              </div>
              <button
                type="button"
                className="ghost-btn"
                data-click="select"
                disabled={reviewsLoading || !teacher?.uid}
                onClick={() => refreshClosetReviews(activeClass.id)}
              >
                {reviewsLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
            {!teacher?.uid ? (
              <p className="empty">Sign in again to review student creations.</p>
            ) : closetReviews.length === 0 ? (
              <p className="empty">
                {reviewsLoading
                  ? "Checking for submissions…"
                  : "No closet items waiting for review."}
              </p>
            ) : (
              <div className="closet-review-list">
                {closetReviews.map((row) => (
                  <article key={row.jobId} className="closet-review-card">
                    <ClosetReviewPreview
                      thumbnailUrl={row.thumbnailUrl}
                      glbUrl={row.glbUrl}
                      parts={row.parts || row.item?.parts}
                      label={row.label || "Untitled item"}
                    />
                    <div className="closet-review-card-main">
                      <strong>{row.label || "Untitled item"}</strong>
                      <span>
                        by {row.creatorName || "Student"}
                        {row.kind ? ` · ${row.kind}` : ""}
                        {row.sellPrice != null
                          ? ` · sells for ${money(row.sellPrice)}`
                          : ""}
                      </span>
                      {row.sourcePrompt ? (
                        <p className="closet-review-prompt">
                          Prompt: {row.sourcePrompt}
                        </p>
                      ) : null}
                      {Array.isArray(row.quizAnswers) &&
                      row.quizAnswers.length > 0 ? (
                        <div className="closet-review-answers">
                          {row.quizAnswers.map((qa, i) => (
                            <div key={qa.id || i}>
                              <em>
                                {row.quizAnswers.length === 1
                                  ? "Strategy response"
                                  : `Q${i + 1}.`}{" "}
                                {qa.prompt || "Scenario"}
                              </em>
                              <p>{qa.answer || "—"}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <p className="closet-review-fee">
                        {row.crew?.payMode === "profit_share"
                          ? `Partnership — approve goes live; partner shares ${row.crew.profitSharePct || 50}% of sales.`
                          : row.crew?.slots > 0
                            ? `Approve pays ${money(row.publishFee || 0)} crew wages (${row.crew.members?.length || 0}/${row.crew.slots} hired).`
                            : "Approve goes live with no payroll."}{" "}
                        Deny deletes the item with no charge.
                      </p>
                      {Array.isArray(row.crew?.members) &&
                      row.crew.members.length > 0 ? (
                        <p className="closet-review-prompt">
                          Crew:{" "}
                          {row.crew.members
                            .map((m) => m.studentName || "Student")
                            .join(", ")}
                        </p>
                      ) : null}
                    </div>
                    <div className="closet-review-actions">
                      <button
                        type="button"
                        className="primary-btn"
                        data-click="confirm"
                        disabled={reviewBusyId === row.jobId}
                        onClick={() => handleClosetReview(row.jobId, "approve")}
                      >
                        {reviewBusyId === row.jobId ? "…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn danger"
                        data-click="select"
                        disabled={reviewBusyId === row.jobId}
                        onClick={() => handleClosetReview(row.jobId, "reject")}
                      >
                        Deny
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="class-dashboard-actions">
            <button
              type="button"
              className="primary-btn"
              data-click="select"
              onClick={() => setShowStandings(true)}
            >
              Class standings
            </button>
            {headToHead ? (
              <button
                type="button"
                className="ghost-btn"
                data-click="select"
                onClick={() => setShowH2HMatchups(true)}
              >
                View matchups
              </button>
            ) : (
              <button
                type="button"
                className="ghost-btn"
                data-click="select"
                onClick={() => setConfirmH2H(true)}
              >
                Head to head
              </button>
            )}
            <button
              type="button"
              className="ghost-btn"
              data-click="select"
              onClick={() => setView("roster")}
            >
              Manage students
            </button>
            <button
              type="button"
              className="ghost-btn"
              data-click="select"
              onClick={() => setView("settings")}
            >
              Class settings
            </button>
          </div>

          {headToHead && (
            <button
              type="button"
              className="h2h-teacher-status"
              data-click="select"
              onClick={() => setShowH2HMatchups(true)}
            >
              Head to head is live
              {headToHead.endsAt &&
              typeof headToHead.endsAt.toLocaleString === "function"
                ? ` · ends ${headToHead.endsAt.toLocaleString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}`
                : ""}
              . Students see the challenge modal now.
              <span className="h2h-teacher-status-go" aria-hidden="true">
                View matchups →
              </span>
            </button>
          )}

          {SHOW_CLASS_CHAT && (
            <ClassMessageBoard
              classId={activeClass.id}
              authorName="Teacher"
              authorId={null}
              authorRole="teacher"
              compact
            />
          )}

          <div className="class-standings-preview">
            <div className="class-standings-preview-head">
              <h3>Students</h3>
              {roster.length > 0 && (
                <button
                  type="button"
                  className="ghost-btn class-standings-open"
                  data-click="select"
                  onClick={() => setShowStandings(true)}
                >
                  View standings
                </button>
              )}
            </div>
            {roster.length === 0 ? (
              <p className="empty">No one has joined yet. Share the invite link above.</p>
            ) : (
              <ul className="class-student-summary">
                {roster.map((s) => {
                  const live =
                    classPortfolios.find((p) => p.id === s.apiStudentId) ||
                    (s.apiStudentId ? apiById.get(s.apiStudentId) : null);
                  const total =
                    live?.total_value ??
                    (Number(live?.cash) || Number(s.cash) || 0);
                  return (
                    <li key={s.id}>
                      <div className="class-student-who">
                        <strong>{s.name}</strong>
                        {s.email && <span className="roster-email">{s.email}</span>}
                      </div>
                      <span>{money(total)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {view === "settings" && activeClass && (
        <form className="class-settings-form" onSubmit={saveClassSettings}>
          <h3>Class settings</h3>
          <label>
            Class name
            <input
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            Starting cash (for new students)
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={formatStartingCash(startingCash)}
              onChange={(e) => setStartingCash(parseStartingCash(e.target.value))}
            />
          </label>
          <fieldset className="market-toggles">
            <legend>Markets available to students</legend>
            {MARKET_OPTIONS.map((m) => (
              <label key={m.id} className="market-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(markets[m.id])}
                  onChange={() => toggleMarket(m.id)}
                />
                {m.label}
              </label>
            ))}
          </fieldset>
          <div className="form-actions">
            <button
              type="button"
              className="ghost-btn danger-text"
              data-click="select"
              onClick={removeClass}
            >
              Delete class
            </button>
            <button type="submit" className="primary-btn" data-click="confirm">
              Save settings
            </button>
          </div>
        </form>
      )}

      {view === "roster" && activeClass && (
        <div className="roster-page">
          <ClassInviteCard
            inviteCode={inviteCode}
            onCopy={copyInviteLink}
            copied={inviteCopied}
            compact
          />

          <div className="roster" role="list">
            {roster.length === 0 && (
              <p className="empty">Waiting for students to join with the invite link.</p>
            )}
            {roster.map((s, i) => {
              const live = s.apiStudentId ? apiById.get(s.apiStudentId) : null;
              const cash = live?.cash ?? s.cash ?? 0;
              const holdingsCount = live?.holdings_count ?? s.holdingsCount ?? 0;
              return (
                <article
                  key={s.id}
                  className="roster-row"
                  role="listitem"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <div className="roster-identity">
                    <button
                      type="button"
                      className="roster-remove-btn"
                      data-click="select"
                      aria-label={`Remove ${s.name}`}
                      title="Remove from class"
                      onClick={() => requestRemoveStudent(s)}
                    >
                      <svg
                        className="roster-remove-icon"
                        viewBox="0 0 24 24"
                        width="15"
                        height="15"
                        aria-hidden="true"
                      >
                        <path
                          d="M7.5 7.5l9 9M16.5 7.5l-9 9"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.1"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                    <div className="roster-who">
                      <h3>{s.name}</h3>
                      <p className="roster-email">{s.email || "No email on file"}</p>
                    </div>
                    <p className="cash">{money(cash)} cash</p>
                    {Number(s.pendingTransferCount) > 0 && (
                      <span className="chip chip-pending">
                        {s.pendingTransferCount} pending
                      </span>
                    )}
                    {holdingsCount > 0 && (
                      <span className="chip">
                        {holdingsCount} holding{holdingsCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <div className="adjust-grid">
                    {[-1000, -500, -100, 100, 500, 1000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        className={amt < 0 ? "adj minus" : "adj plus"}
                        data-click="adjust"
                        disabled={!s.apiStudentId}
                        onClick={() => bump(s, amt)}
                      >
                        {amt > 0 ? "+" : ""}
                        {money(amt)}
                      </button>
                    ))}
                  </div>
                  <div className="custom-adjust">
                    <input
                      type="number"
                      step="1"
                      placeholder="Custom $"
                      value={customAmounts[s.id] || ""}
                      onChange={(e) =>
                        setCustomAmounts((prev) => ({
                          ...prev,
                          [s.id]: e.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="adj plus"
                      data-click="adjust"
                      disabled={!s.apiStudentId}
                      onClick={() => {
                        const amt = Number(customAmounts[s.id]);
                        if (!amt) return;
                        bump(s, amt);
                        setCustomAmounts((prev) => ({ ...prev, [s.id]: "" }));
                      }}
                    >
                      Apply
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
      {showStandings && activeClass && (
        <ClassView
          classId={activeClass.id}
          currentStudentId={null}
          onBack={() => setShowStandings(false)}
        />
      )}

      {pendingRemove && activeClass
        ? createPortal(
            <div
              className="confirm-overlay"
              role="presentation"
              onClick={() => setPendingRemove(null)}
            >
              <div
                className="confirm-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="remove-student-title"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="confirm-kicker">Remove student</p>
                <h3 id="remove-student-title">
                  Remove {pendingRemove.name}?
                </h3>
                <p className="confirm-body">
                  They’ll be taken off <strong>{activeClass.name}</strong>
                  {pendingRemove.email ? (
                    <>
                      {" "}
                      (
                      <span className="confirm-email">
                        {pendingRemove.email}
                      </span>
                      )
                    </>
                  ) : null}
                  . Their portfolio on this computer will be deleted. This can’t
                  be undone.
                </p>
                <div className="confirm-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    data-click="select"
                    onClick={() => setPendingRemove(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-btn confirm-danger-btn"
                    data-click="confirm"
                    onClick={confirmRemoveStudent}
                  >
                    Remove student
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {confirmH2H && activeClass
        ? createPortal(
            <div
              className="confirm-overlay"
              role="presentation"
              onClick={() => setConfirmH2H(false)}
            >
              <div
                className="confirm-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="h2h-start-title"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="confirm-kicker">Head to head</p>
                <h3 id="h2h-start-title">Start a class challenge?</h3>
                <p className="confirm-body">
                  Every student in <strong>{activeClass.name}</strong> will get
                  a challenge modal right away. The battle runs for{" "}
                  <strong>one week</strong> from now.
                </p>
                <div className="confirm-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    data-click="select"
                    onClick={() => setConfirmH2H(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    data-click="confirm"
                    onClick={startHeadToHead}
                  >
                    Start challenge
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {showH2HMatchups && activeClass && headToHead ? (
        <TeacherHeadToHeadModal
          open
          onClose={() => setShowH2HMatchups(false)}
          classId={activeClass.id}
          challenge={headToHead}
          onEndContest={stopHeadToHead}
          ending={busy}
        />
      ) : null}

      <SpinWheelFab onClick={() => setShowSpinWheel(true)} />
      <SpinWheelModal
        open={showSpinWheel}
        onClose={() => setShowSpinWheel(false)}
        students={roster}
        onAward={
          activeClass
            ? async (student, amount) => {
                if (!student?.apiStudentId) {
                  throw new Error("That student hasn’t finished joining yet.");
                }
                setBusy(true);
                setError("");
                try {
                  await createPendingTransfer(activeClass.id, student.id, {
                    amount,
                  });
                  await refreshRoster(activeClass.id);
                } finally {
                  setBusy(false);
                }
              }
            : undefined
        }
      />
    </section>
  );
}

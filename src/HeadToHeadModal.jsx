import { Suspense, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { buyShares, getMarket, getQuote, getStudent } from "./api";
import {
  AvatarCanvas,
  loadSavedOutfit,
  outfitForStudent,
  setClassClosetAccessories,
  stripPlayerFishForm,
} from "./StudentCharacter";
import {
  acceptH2hMatchAndClearOthers,
  createH2hMatchRequest,
  declineAllPendingH2hForStudent,
  h2hBasketReturnPct,
  listClassStudents,
  respondH2hMatch,
  setH2hMatchPicks,
  skipHeadToHeadSeason,
  subscribeClassClosetItems,
  subscribeH2hMatches,
  subscribeHeadToHead,
} from "./classStore";
import { TICKER_CATEGORY } from "./portfolioAllocation";

const STOCK_SLOTS = 3;
/** Solo-test: picking a classmate creates an *incoming* challenge from them. */
const H2H_INVERT_TEST = true;

function outfitForSeat(seat, tradingId, name) {
  const base = outfitForStudent(tradingId, name);
  if (seat?.outfit && typeof seat.outfit === "object") {
    return stripPlayerFishForm({ ...base, ...seat.outfit, npcFish: false }, base);
  }
  return loadSavedOutfit(tradingId, name);
}

function tradingIdForSeat(seat) {
  return String(seat?.apiStudentId || seat?.id || "");
}

function formatEndDate(endsAt) {
  if (!endsAt) return null;
  try {
    return endsAt.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

function dismissKey(challengeId) {
  return `ledgerlab.h2h.dismissed.${challengeId}`;
}

function pickDismissKey(matchId) {
  return `ledgerlab.h2h.pickDismissed.${matchId}`;
}

function formatPct(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/** Stocks & ETFs only — classroom catalog categories. */
export function eligibleH2hHoldings(holdings = []) {
  return [...(holdings || [])]
    .filter((h) => {
      const ticker = String(h?.ticker || "").toUpperCase();
      if (!ticker) return false;
      const shares = Number(h.shares) || 0;
      if (shares <= 0) return false;
      const kind = String(h.asset_type || "").toLowerCase();
      if (["bond", "commodity", "currency", "realestate", "home"].includes(kind)) {
        return false;
      }
      const cat = TICKER_CATEGORY[ticker];
      return cat === "stocks" || cat === "etfs";
    })
    .map((h) => {
      const price =
        Number(h.price) > 0
          ? Number(h.price)
          : Number(h.avg_cost) > 0
            ? Number(h.avg_cost)
            : null;
      const value =
        h.market_value != null
          ? Number(h.market_value)
          : price != null
            ? price * (Number(h.shares) || 0)
            : 0;
      return {
        ticker: String(h.ticker).toUpperCase(),
        name: h.name || h.ticker,
        shares: Number(h.shares) || 0,
        price,
        value: Number.isFinite(value) ? value : 0,
        category: TICKER_CATEGORY[String(h.ticker).toUpperCase()] || "stocks",
      };
    })
    .sort((a, b) => b.value - a.value);
}

function AvatarBlock({ outfit, className = "standings-profile-stage" }) {
  return (
    <Suspense
      fallback={
        <div className="standings-profile-avatar-fallback">
          <span className="busy-spinner" />
        </div>
      }
    >
      {outfit ? (
        <AvatarCanvas outfit={outfit} mode="headshot" className={className} />
      ) : null}
    </Suspense>
  );
}

function mySide(match, studentId) {
  if (!match || !studentId) return null;
  if (match.fromId === studentId) return "from";
  if (match.toId === studentId) return "to";
  return null;
}

function picksForSide(match, side) {
  if (!match) return [];
  return side === "from" ? match.tickersFrom || [] : match.tickersTo || [];
}

/**
 * Class-wide head-to-head: challenge, accept, and lock 3 holdings.
 */
export default function HeadToHeadModal({
  classId,
  firestoreStudentId,
  studentName,
  apiStudentId,
  portfolioHoldings = [],
  resumeToken = 0,
  onPortfolioRefresh,
  onPicksLocked,
}) {
  const [challenge, setChallenge] = useState(null);
  const [matches, setMatches] = useState([]);
  const [roster, setRoster] = useState([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [selectedOpponentId, setSelectedOpponentId] = useState("");
  const [dismissedId, setDismissedId] = useState("");
  const [pickDismissedId, setPickDismissedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedTickers, setSelectedTickers] = useState([]);
  const [holdingsRaw, setHoldingsRaw] = useState(portfolioHoldings);
  const [pickPane, setPickPane] = useState("picks"); // picks | shop
  const [shopKind, setShopKind] = useState("stocks"); // stocks | etfs
  const [shopIndustry, setShopIndustry] = useState("All");
  const [shopItems, setShopItems] = useState([]);
  const [shopLoading, setShopLoading] = useState(false);
  const [buyingTicker, setBuyingTicker] = useState("");
  const [confirmExit, setConfirmExit] = useState(false);

  useEffect(() => {
    setHoldingsRaw(portfolioHoldings);
  }, [portfolioHoldings]);

  useEffect(() => {
    return subscribeHeadToHead(classId, (next) => {
      setChallenge(next);
      if (next?.id) {
        try {
          const raw = sessionStorage.getItem(dismissKey(next.id));
          setDismissedId(raw === "1" ? next.id : "");
        } catch {
          setDismissedId("");
        }
      } else {
        setDismissedId("");
      }
    });
  }, [classId]);

  useEffect(() => {
    if (!classId) {
      setClassClosetAccessories([]);
      return undefined;
    }
    return subscribeClassClosetItems(classId, setClassClosetAccessories);
  }, [classId]);

  useEffect(() => {
    if (!classId || !challenge?.id) {
      setMatches([]);
      return;
    }
    return subscribeH2hMatches(classId, (rows) => {
      setMatches(rows.filter((m) => m.seasonId === challenge.id));
    });
  }, [classId, challenge?.id]);

  useEffect(() => {
    if (!classId || !challenge?.id) {
      setRoster([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingRoster(true);
      try {
        const rows = await listClassStudents(classId);
        if (!cancelled) setRoster(rows);
      } catch {
        if (!cancelled) setRoster([]);
      } finally {
        if (!cancelled) setLoadingRoster(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classId, challenge?.id, matches.length]);

  const me = useMemo(
    () => roster.find((s) => s.id === firestoreStudentId) || null,
    [roster, firestoreStudentId]
  );

  const myName = me?.name || studentName || "You";
  const myTradingId = me ? tradingIdForSeat(me) : apiStudentId || firestoreStudentId;
  const myOutfit = useMemo(
    () =>
      me
        ? outfitForSeat(me, myTradingId, myName)
        : outfitForStudent(myTradingId, myName),
    [me, myTradingId, myName]
  );

  const opponents = useMemo(() => {
    const seasonId = challenge?.id;
    const busyIds = new Set();
    for (const m of matches) {
      if (!seasonId || m.seasonId !== seasonId) continue;
      if (m.status !== "pending" && m.status !== "accepted") continue;
      if (m.fromId) busyIds.add(m.fromId);
      if (m.toId) busyIds.add(m.toId);
    }
    return [...roster]
      .filter((s) => {
        if (s.id === firestoreStudentId) return false;
        if (seasonId && s.h2hOptOutSeasonId === seasonId) return false;
        if (busyIds.has(s.id)) return false;
        return true;
      })
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""))
      );
  }, [roster, firestoreStudentId, matches, challenge?.id]);

  const selectedOpponent = useMemo(
    () => opponents.find((s) => s.id === selectedOpponentId) || null,
    [opponents, selectedOpponentId]
  );

  const incomingList = useMemo(
    () =>
      matches.filter(
        (m) => m.status === "pending" && m.toId === firestoreStudentId
      ),
    [matches, firestoreStudentId]
  );

  const outgoingPending = useMemo(
    () =>
      matches.find(
        (m) => m.status === "pending" && m.fromId === firestoreStudentId
      ) || null,
    [matches, firestoreStudentId]
  );

  const pickMatch = useMemo(() => {
    return (
      matches.find((m) => {
        if (m.status !== "accepted") return false;
        const side = mySide(m, firestoreStudentId);
        if (!side) return false;
        return picksForSide(m, side).length < STOCK_SLOTS;
      }) || null
    );
  }, [matches, firestoreStudentId]);

  const acceptedMatch = useMemo(() => {
    if (!challenge?.id || !firestoreStudentId) return null;
    return (
      matches.find((m) => {
        if (m.seasonId !== challenge.id) return false;
        if (m.status !== "accepted") return false;
        return (
          m.fromId === firestoreStudentId || m.toId === firestoreStudentId
        );
      }) || null
    );
  }, [matches, challenge?.id, firestoreStudentId]);

  useEffect(() => {
    if (!pickMatch?.id) {
      setPickDismissedId("");
      return;
    }
    try {
      const raw = sessionStorage.getItem(pickDismissKey(pickMatch.id));
      setPickDismissedId(raw === "1" ? pickMatch.id : "");
    } catch {
      setPickDismissedId("");
    }
  }, [pickMatch?.id]);

  // Dashboard "Head to head" bumps resumeToken so picks reopen after buying.
  useEffect(() => {
    if (!resumeToken || !pickMatch?.id) return;
    try {
      sessionStorage.removeItem(pickDismissKey(pickMatch.id));
    } catch {
      /* ignore */
    }
    setPickDismissedId("");
  }, [resumeToken, pickMatch?.id]);

  const pickOpponentSeat = useMemo(() => {
    if (!pickMatch) return null;
    const oppId =
      pickMatch.fromId === firestoreStudentId
        ? pickMatch.toId
        : pickMatch.fromId;
    return roster.find((s) => s.id === oppId) || null;
  }, [pickMatch, firestoreStudentId, roster]);

  const pickOpponentOutfit = useMemo(() => {
    if (!pickMatch) return null;
    const name =
      pickMatch.fromId === firestoreStudentId
        ? pickMatch.toName
        : pickMatch.fromName;
    if (pickOpponentSeat) {
      return outfitForSeat(
        pickOpponentSeat,
        tradingIdForSeat(pickOpponentSeat),
        pickOpponentSeat.name || name
      );
    }
    const id =
      pickMatch.fromId === firestoreStudentId
        ? pickMatch.toId
        : pickMatch.fromId;
    return outfitForStudent(id, name);
  }, [pickMatch, pickOpponentSeat, firestoreStudentId]);

  const outgoingOppOutfit = useMemo(() => {
    if (!outgoingPending) return null;
    const seat = roster.find((s) => s.id === outgoingPending.toId);
    if (seat) {
      return outfitForSeat(
        seat,
        tradingIdForSeat(seat),
        seat.name || outgoingPending.toName
      );
    }
    return outfitForStudent(outgoingPending.toId, outgoingPending.toName);
  }, [outgoingPending, roster]);

  const holdings = useMemo(
    () => eligibleH2hHoldings(holdingsRaw),
    [holdingsRaw]
  );

  const shopIndustries = useMemo(() => {
    if (shopKind !== "stocks") return ["All"];
    return [
      "All",
      ...Array.from(
        new Set(shopItems.map((item) => item.industry).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    ];
  }, [shopItems, shopKind]);

  const visibleShopItems = useMemo(() => {
    if (shopKind === "stocks" && shopIndustry !== "All") {
      return shopItems.filter((item) => item.industry === shopIndustry);
    }
    return shopItems;
  }, [shopItems, shopKind, shopIndustry]);

  const seasonOpen = Boolean(challenge?.id) && challenge.status === "open";

  const optedOut =
    Boolean(challenge?.id) &&
    (dismissedId === challenge.id ||
      me?.h2hOptOutSeasonId === challenge.id);

  // Priority: finish picks → respond to inbox → wait on outgoing → choose opponent
  const showPick =
    seasonOpen &&
    Boolean(pickMatch) &&
    pickDismissedId !== pickMatch?.id;
  const showIncoming =
    seasonOpen && !showPick && incomingList.length > 0;
  const showWaiting =
    seasonOpen &&
    !showPick &&
    !showIncoming &&
    Boolean(outgoingPending);
  const showPicker =
    seasonOpen &&
    !showPick &&
    !showIncoming &&
    !showWaiting &&
    !optedOut &&
    !acceptedMatch;

  useEffect(() => {
    if (showPick) {
      setSelectedTickers([]);
      setPickPane("picks");
      setShopKind("stocks");
      setShopIndustry("All");
      setError("");
    }
  }, [showPick, pickMatch?.id]);

  useEffect(() => {
    if (!showPick || pickPane !== "shop") return;
    let cancelled = false;
    (async () => {
      setShopLoading(true);
      setError("");
      try {
        const data = await getMarket(shopKind);
        if (!cancelled) {
          setShopItems(Array.isArray(data?.items) ? data.items : []);
          setShopIndustry("All");
        }
      } catch (err) {
        if (!cancelled) {
          setShopItems([]);
          setError(err.message || "Could not load market");
        }
      } finally {
        if (!cancelled) setShopLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showPick, pickPane, shopKind]);

  async function exitContestBeforeFinalize() {
    if (!challenge?.id || !firestoreStudentId || busy) return;
    setBusy(true);
    setError("");
    setConfirmExit(false);
    try {
      if (pickMatch?.id) {
        await respondH2hMatch(classId, pickMatch.id, "declined");
      }
      await declineAllPendingH2hForStudent({
        classId,
        seasonId: challenge.id,
        studentId: firestoreStudentId,
      });
      try {
        sessionStorage.setItem(dismissKey(challenge.id), "1");
      } catch {
        /* ignore */
      }
      setDismissedId(challenge.id);
      await skipHeadToHeadSeason(classId, firestoreStudentId, challenge.id);
      setRoster((prev) =>
        prev.map((s) =>
          s.id === firestoreStudentId
            ? { ...s, h2hOptOutSeasonId: challenge.id }
            : s
        )
      );
    } catch (err) {
      setError(err.message || "Could not exit contest");
      setConfirmExit(false);
    } finally {
      setBusy(false);
    }
  }

  function requestExitContest() {
    setConfirmExit(true);
  }

  const exitBtn = (
    <button
      type="button"
      className="h2h-modal-exit"
      data-click="select"
      aria-label="Exit contest signup"
      disabled={busy}
      onClick={requestExitContest}
    >
      ×
    </button>
  );

  function moneyPrice(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
  }

  async function buyOneShare(item) {
    if (!apiStudentId || busy || buyingTicker) return;
    const ticker = String(item?.ticker || "").toUpperCase();
    if (!ticker) return;
    if (!(Number(item.price) > 0)) {
      setError(`No live price for ${ticker} yet.`);
      return;
    }
    setBuyingTicker(ticker);
    setError("");
    try {
      const updated = await buyShares(apiStudentId, ticker, 1, classId);
      if (Array.isArray(updated?.holdings)) {
        setHoldingsRaw(updated.holdings);
      } else {
        const fresh = await getStudent(apiStudentId, classId);
        setHoldingsRaw(fresh?.holdings || []);
      }
      setSelectedTickers((prev) => {
        if (prev.includes(ticker) || prev.length >= STOCK_SLOTS) return prev;
        return [...prev, ticker];
      });
      onPortfolioRefresh?.();
    } catch (err) {
      setError(err.message || `Could not buy ${ticker}`);
    } finally {
      setBuyingTicker("");
    }
  }

  function toggleTicker(ticker) {
    setSelectedTickers((prev) => {
      if (prev.includes(ticker)) return prev.filter((t) => t !== ticker);
      if (prev.length >= STOCK_SLOTS) return prev;
      return [...prev, ticker];
    });
  }

  function clearSlot(ticker) {
    if (!ticker) return;
    setSelectedTickers((prev) => prev.filter((t) => t !== ticker));
  }

  async function resolveStartPrice(holding) {
    if (holding.price > 0) return holding.price;
    try {
      const q = await getQuote(holding.ticker);
      const p = Number(q?.price ?? q?.c ?? q);
      if (p > 0) return p;
    } catch {
      /* fall through */
    }
    return null;
  }

  async function sendTestIncoming() {
    if (!challenge?.id || !selectedOpponent || !firestoreStudentId || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createH2hMatchRequest({
        classId,
        seasonId: challenge.id,
        fromId: firestoreStudentId,
        fromName: myName,
        toId: selectedOpponent.id,
        toName: selectedOpponent.name || "Classmate",
        invertTest: H2H_INVERT_TEST,
      });
      setSelectedOpponentId("");
    } catch (err) {
      setError(err.message || "Could not create challenge");
    } finally {
      setBusy(false);
    }
  }

  async function onRespond(matchId, status) {
    if (!matchId || busy || !challenge?.id) return;
    setBusy(true);
    setError("");
    try {
      if (status === "accepted") {
        await acceptH2hMatchAndClearOthers({
          classId,
          seasonId: challenge.id,
          matchId,
          studentId: firestoreStudentId,
        });
      } else {
        await respondH2hMatch(classId, matchId, "declined");
      }
    } catch (err) {
      setError(err.message || "Could not respond");
    } finally {
      setBusy(false);
    }
  }

  function outfitForIncoming(match) {
    const seat = roster.find((s) => s.id === match.fromId);
    if (seat) {
      return outfitForSeat(
        seat,
        tradingIdForSeat(seat),
        seat.name || match.fromName
      );
    }
    return outfitForStudent(match.fromId, match.fromName);
  }

  async function lockPicks() {
    if (!pickMatch || busy) return;
    const side = mySide(pickMatch, firestoreStudentId);
    if (!side) return;
    if (selectedTickers.length !== STOCK_SLOTS) {
      setError(`Pick exactly ${STOCK_SLOTS} stocks from your holdings.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const picks = [];
      for (const ticker of selectedTickers) {
        const h = holdings.find((row) => row.ticker === ticker);
        if (!h) throw new Error(`You’re not holding ${ticker} anymore.`);
        const startPrice = await resolveStartPrice(h);
        if (!(startPrice > 0)) {
          throw new Error(`No live price for ${ticker}. Try again.`);
        }
        picks.push({ ticker: h.ticker, name: h.name, startPrice });
      }
      const lockedMatchId = pickMatch.id;
      await setH2hMatchPicks(classId, lockedMatchId, side, picks);

      // Solo test: seed the classmate’s basket from their top holdings so
      // the scoreboard has both sides without a second login.
      if (pickMatch.testMirror) {
        const otherSide = side === "from" ? "to" : "from";
        const otherPicks = picksForSide(pickMatch, otherSide);
        if (otherPicks.length < STOCK_SLOTS) {
          const oppSeat =
            otherSide === "from"
              ? roster.find((s) => s.id === pickMatch.fromId)
              : roster.find((s) => s.id === pickMatch.toId);
          const oppTradingId = oppSeat
            ? tradingIdForSeat(oppSeat)
            : otherSide === "from"
              ? pickMatch.fromId
              : pickMatch.toId;
          try {
            const oppPort = await getStudent(oppTradingId, classId);
            const oppHold = eligibleH2hHoldings(oppPort?.holdings).slice(
              0,
              STOCK_SLOTS
            );
            if (oppHold.length === STOCK_SLOTS) {
              const seeded = [];
              for (const h of oppHold) {
                const startPrice = await resolveStartPrice(h);
                if (!(startPrice > 0)) break;
                seeded.push({
                  ticker: h.ticker,
                  name: h.name,
                  startPrice,
                });
              }
              if (seeded.length === STOCK_SLOTS) {
                await setH2hMatchPicks(
                  classId,
                  lockedMatchId,
                  otherSide,
                  seeded
                );
              }
            }
          } catch {
            /* opponent seed is best-effort for testing */
          }
        }
      }
      setSelectedTickers([]);
      onPicksLocked?.(lockedMatchId);
    } catch (err) {
      setError(err.message || "Could not save picks");
    } finally {
      setBusy(false);
    }
  }

  if (!showPicker && !showIncoming && !showPick && !showWaiting) return null;

  const endsLabel = formatEndDate(challenge.endsAt);
  let body = null;

  if (showIncoming) {
    body = (
      <div
        className="standings-profile-modal h2h-modal h2h-modal-incoming h2h-modal-exitable"
        role="dialog"
        aria-modal="true"
        aria-labelledby="h2h-incoming-title"
        onClick={(e) => e.stopPropagation()}
      >
        {exitBtn}
        <p className="standings-profile-kicker">Challenge requests</p>
        <h3 id="h2h-incoming-title">
          {incomingList.length === 1
            ? "You’ve been challenged"
            : `${incomingList.length} classmates challenged you`}
        </h3>
        <p className="standings-profile-note h2h-inbox-note">
          Accept one battle for this contest. Accepting auto-declines the rest
          {outgoingPending
            ? ` and cancels your pending challenge to ${outgoingPending.toName}`
            : ""}
          .
        </p>

        <ul className="h2h-inbox-list" aria-label="Incoming challenges">
          {incomingList.map((m) => {
            const outfit = outfitForIncoming(m);
            return (
              <li key={m.id} className="h2h-inbox-card">
                <div className="h2h-inbox-who">
                  <span className="h2h-opponent-avatar h2h-battle-avatar">
                    <AvatarBlock
                      outfit={outfit}
                      className="h2h-opponent-stage"
                    />
                  </span>
                  <div>
                    <strong>{m.fromName}</strong>
                    {m.testMirror ? (
                      <p className="h2h-inbox-meta">Testing challenge</p>
                    ) : (
                      <p className="h2h-inbox-meta">Wants a head-to-head</p>
                    )}
                  </div>
                </div>
                <div className="h2h-inbox-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    data-click="select"
                    disabled={busy}
                    onClick={() => onRespond(m.id, "declined")}
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    data-click="confirm"
                    disabled={busy}
                    onClick={() => onRespond(m.id, "accepted")}
                  >
                    {busy ? "Saving…" : "Accept"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        {error && <p className="h2h-error">{error}</p>}
      </div>
    );
  } else if (showWaiting) {
    body = (
      <div
        className="standings-profile-modal h2h-modal h2h-modal-exitable"
        role="dialog"
        aria-modal="true"
        aria-labelledby="h2h-waiting-title"
        onClick={(e) => e.stopPropagation()}
      >
        {exitBtn}
        <p className="standings-profile-kicker">Challenge sent</p>
        <h3 id="h2h-waiting-title">Waiting on a reply</h3>
        <div className="standings-profile-hero h2h-incoming-hero">
          <div className="standings-profile-avatar" aria-hidden="true">
            <AvatarBlock outfit={outgoingOppOutfit} />
          </div>
          <div className="standings-profile-identity">
            <p className="standings-profile-kicker">To</p>
            <h3 className="h2h-you-name">{outgoingPending.toName}</h3>
            <p className="h2h-you-sub">
              You’ll pick 3 stocks after they accept
              {endsLabel ? ` · contest ends ${endsLabel}` : ""}
            </p>
          </div>
        </div>
        <p className="standings-profile-note">
          If someone else challenges you in the meantime, you’ll see their
          request here and can accept them instead.
        </p>
        {error && <p className="h2h-error">{error}</p>}
        <div className="h2h-actions">
          <button
            type="button"
            className="ghost-btn"
            data-click="select"
            disabled={busy}
            onClick={async () => {
              if (!outgoingPending || busy) return;
              setBusy(true);
              setError("");
              try {
                await respondH2hMatch(classId, outgoingPending.id, "declined");
              } catch (err) {
                setError(err.message || "Could not cancel");
              } finally {
                setBusy(false);
              }
            }}
          >
            Cancel request
          </button>
        </div>
      </div>
    );
  } else if (showPick) {
    const oppName =
      pickMatch.fromId === firestoreStudentId
        ? pickMatch.toName
        : pickMatch.fromName;
    const canFinalize = selectedTickers.length === STOCK_SLOTS;

    if (pickPane === "shop") {
      body = (
        <div
          className="standings-profile-modal h2h-modal h2h-shop-modal h2h-modal-exitable"
          role="dialog"
          aria-modal="true"
          aria-labelledby="h2h-shop-title"
          onClick={(e) => e.stopPropagation()}
        >
          {exitBtn}
          <div className="h2h-top">
            <p className="standings-profile-kicker">Head to head</p>
            <h3 id="h2h-shop-title">
              {shopKind === "etfs" ? "Buy ETFs" : "Buy stocks"}
            </h3>
            <p className="h2h-deadline">
              vs {oppName} · you hold {holdings.length} eligible
              {endsLabel ? ` · ends ${endsLabel}` : ""}
            </p>
          </div>

          <div className="h2h-shop-slots-bar" aria-label="Pick progress">
            {Array.from({ length: STOCK_SLOTS }).map((_, i) => {
              const ticker = selectedTickers[i];
              return (
                <span
                  key={`shop-slot-${i}`}
                  className={`h2h-shop-slot-chip${ticker ? " is-filled" : ""}`}
                >
                  {ticker || `Slot ${i + 1}`}
                  {ticker ? (
                    <button
                      type="button"
                      className="h2h-slot-clear"
                      data-click="select"
                      aria-label={`Remove ${ticker} from picks`}
                      disabled={busy}
                      onClick={() => clearSlot(ticker)}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              );
            })}
          </div>

          <div className="h2h-shop-body">
            {shopLoading ? (
              <p className="standings-profile-note">Loading prices…</p>
            ) : visibleShopItems.length === 0 ? (
              <p className="standings-profile-note">
                No {shopKind === "etfs" ? "ETFs" : "stocks"} in this filter.
              </p>
            ) : (
              <ul className="h2h-shop-list">
                {visibleShopItems.map((item) => {
                  const ticker = String(item.ticker || "").toUpperCase();
                  const held = holdings.some((h) => h.ticker === ticker);
                  const price = Number(item.price);
                  const buying = buyingTicker === ticker;
                  return (
                    <li key={ticker}>
                      <div className="h2h-shop-row">
                        <div className="h2h-holding-main">
                          <strong>{ticker}</strong>
                          <span>
                            {item.name || ticker}
                            {held ? " · owned" : ""}
                            {item.industry ? ` · ${item.industry}` : ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="primary-btn h2h-shop-buy"
                          data-click="confirm"
                          disabled={busy || Boolean(buyingTicker) || !(price > 0)}
                          onClick={() => buyOneShare(item)}
                        >
                          {buying
                            ? "Buying…"
                            : price > 0
                              ? `Buy 1 · ${moneyPrice(price)}`
                              : "No price"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {error && <p className="h2h-error">{error}</p>}

          <div className="h2h-shop-footer">
            {shopKind === "stocks" && (
              <div
                className="industry-tags h2h-shop-industries"
                role="tablist"
                aria-label="Filter by industry"
              >
                {shopIndustries.map((industry) => (
                  <button
                    key={industry}
                    type="button"
                    role="tab"
                    aria-selected={shopIndustry === industry}
                    className={
                      shopIndustry === industry
                        ? "industry-tag active"
                        : "industry-tag"
                    }
                    data-click="select"
                    onClick={() => setShopIndustry(industry)}
                  >
                    {industry}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              className="primary-btn h2h-shop-switch"
              data-click="select"
              disabled={shopLoading || Boolean(buyingTicker)}
              onClick={() =>
                setShopKind((k) => (k === "stocks" ? "etfs" : "stocks"))
              }
            >
              {shopKind === "stocks" ? "Switch to ETFs" : "Switch to stocks"}
            </button>

            <div className="h2h-actions">
              <button
                type="button"
                className="ghost-btn"
                data-click="select"
                disabled={Boolean(buyingTicker)}
                onClick={() => {
                  setPickPane("picks");
                  setError("");
                }}
              >
                Back to picks
              </button>
              <button
                type="button"
                className="primary-btn standings-profile-done"
                data-click="confirm"
                disabled={busy || !canFinalize || Boolean(buyingTicker)}
                aria-disabled={busy || !canFinalize || Boolean(buyingTicker)}
                title={
                  canFinalize
                    ? "Lock in your 3 picks"
                    : `Pick ${STOCK_SLOTS} stocks before finalizing`
                }
                onClick={lockPicks}
              >
                Finalize picks
              </button>
            </div>
          </div>
        </div>
      );
    } else {
      body = (
        <div
          className="standings-profile-modal h2h-modal h2h-modal-exitable"
          role="dialog"
          aria-modal="true"
          aria-labelledby="h2h-pick-title"
          onClick={(e) => e.stopPropagation()}
        >
          {exitBtn}
          <div className="h2h-top">
            <p className="standings-profile-kicker">Head to head</p>
            <h3 id="h2h-pick-title">Pick your 3 stocks</h3>
            <p className="h2h-deadline">
              vs {oppName}
              {endsLabel ? ` · ends ${endsLabel}` : ""}
            </p>
          </div>

          <div className="standings-profile-hero h2h-you-hero">
            <div className="standings-profile-avatar" aria-hidden="true">
              <AvatarBlock outfit={pickOpponentOutfit || myOutfit} />
            </div>
            <div className="standings-profile-identity">
              <p className="standings-profile-kicker">Your basket</p>
              <h3 className="h2h-you-name">
                {selectedTickers.length}/{STOCK_SLOTS} selected
              </h3>
              <p className="h2h-you-sub">
                Stocks &amp; ETFs only — tap holdings below, or buy more.
              </p>
            </div>
          </div>

          <div className="standings-profile-section h2h-slots-section">
            <h4>Selected</h4>
            <ul className="h2h-slots">
              {Array.from({ length: STOCK_SLOTS }).map((_, i) => {
                const ticker = selectedTickers[i];
                const h = holdings.find((row) => row.ticker === ticker);
                return (
                  <li
                    key={`pick-slot-${i}`}
                    className={`h2h-slot${ticker ? "" : " is-empty"}`}
                  >
                    <span className="h2h-slot-index">{i + 1}</span>
                    <span className="h2h-slot-label">
                      {ticker
                        ? `${ticker}${h?.name ? ` · ${h.name}` : ""}`
                        : "Empty slot"}
                    </span>
                    {ticker ? (
                      <button
                        type="button"
                        className="h2h-slot-clear"
                        data-click="select"
                        aria-label={`Remove ${ticker} from picks`}
                        disabled={busy}
                        onClick={() => clearSlot(ticker)}
                      >
                        ×
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>

          <section className="h2h-holdings-pick" aria-label="Your holdings">
            <h4 className="h2h-roster-title">
              Your stocks &amp; ETFs ({holdings.length})
            </h4>
            {holdings.length === 0 ? (
              <p className="standings-profile-note">
                None yet — tap <strong>Buy stocks</strong> to add some without
                leaving this challenge.
              </p>
            ) : (
              <ul className="h2h-holding-list">
                {holdings.map((h) => {
                  const active = selectedTickers.includes(h.ticker);
                  const full =
                    !active && selectedTickers.length >= STOCK_SLOTS;
                  return (
                    <li key={h.ticker}>
                      <button
                        type="button"
                        className={`h2h-holding-btn${active ? " is-active" : ""}`}
                        data-click="select"
                        disabled={busy || full}
                        onClick={() => toggleTicker(h.ticker)}
                      >
                        <span className="h2h-holding-main">
                          <strong>{h.ticker}</strong>
                          <span>
                            {h.name}
                            {h.category === "etfs" ? " · ETF" : ""}
                          </span>
                        </span>
                        <span className="h2h-holding-meta">
                          {moneyPrice(h.price)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {error && <p className="h2h-error">{error}</p>}

          <div className="h2h-actions">
            <button
              type="button"
              className="ghost-btn"
              data-click="select"
              disabled={busy}
              onClick={() => {
                setPickPane("shop");
                setShopKind("stocks");
                setError("");
              }}
            >
              Buy stocks
            </button>
            <button
              type="button"
              className="primary-btn standings-profile-done"
              data-click="confirm"
              disabled={busy || !canFinalize}
              aria-disabled={busy || !canFinalize}
              title={
                canFinalize
                  ? "Lock in your 3 picks"
                  : `Pick ${STOCK_SLOTS} stocks before finalizing`
              }
              onClick={lockPicks}
            >
              Finalize picks
            </button>
          </div>
        </div>
      );
    }
  } else if (showPicker) {
    body = (
      <div
        className="standings-profile-modal h2h-modal h2h-modal-picker h2h-modal-exitable"
        role="dialog"
        aria-modal="true"
        aria-labelledby="h2h-title"
        onClick={(e) => e.stopPropagation()}
      >
        {exitBtn}
        <div className="h2h-top">
          <p className="standings-profile-kicker">Head to head</p>
          <h3 id="h2h-title">Pick your battle</h3>
          {endsLabel && <p className="h2h-deadline">Ends {endsLabel}</p>}
          {H2H_INVERT_TEST && (
            <p className="h2h-test-banner">
              Testing: choosing a classmate sends <strong>you</strong> their
              challenge request so you can try Accept / Decline.
            </p>
          )}
        </div>

        <div className="h2h-split">
          <section className="h2h-you" aria-label="Your challenge card">
            <div className="standings-profile-hero h2h-you-hero">
              <div className="standings-profile-avatar" aria-hidden="true">
                <AvatarBlock outfit={myOutfit} />
              </div>
              <div className="standings-profile-identity">
                <p className="standings-profile-kicker">You</p>
                <h3 className="h2h-you-name">{myName}</h3>
                <p className="h2h-you-sub">
                  {selectedOpponent
                    ? `vs ${selectedOpponent.name}`
                    : "Choose an opponent"}
                </p>
              </div>
            </div>

            <div className="standings-profile-section h2h-slots-section">
              <h4>Your 3 stocks</h4>
              <ul className="h2h-slots">
                {Array.from({ length: STOCK_SLOTS }).map((_, i) => (
                  <li key={`slot-${i}`} className="h2h-slot is-empty">
                    <span className="h2h-slot-index">{i + 1}</span>
                    <span className="h2h-slot-label">Empty slot</span>
                  </li>
                ))}
              </ul>
              <p className="standings-profile-note h2h-slots-hint">
                After you match up, you’ll fill these from your holdings.
              </p>
            </div>
          </section>

          <section className="h2h-roster" aria-label="Classmates">
            <h4 className="h2h-roster-title">Challenge someone</h4>
            {loadingRoster ? (
              <p className="standings-profile-note">Loading classmates…</p>
            ) : opponents.length === 0 ? (
              <p className="standings-profile-note">
                No other students in this class yet.
              </p>
            ) : (
              <ul className="h2h-opponent-list">
                {opponents.map((s) => {
                  const tid = tradingIdForSeat(s);
                  const outfit = outfitForSeat(s, tid, s.name);
                  const active = s.id === selectedOpponentId;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        className={`h2h-opponent-btn${active ? " is-active" : ""}`}
                        data-click="select"
                        disabled={busy}
                        onClick={() => setSelectedOpponentId(s.id)}
                      >
                        <span className="h2h-opponent-avatar" aria-hidden="true">
                          <AvatarBlock
                            outfit={outfit}
                            className="h2h-opponent-stage"
                          />
                        </span>
                        <span className="h2h-opponent-name">
                          {s.name || "Student"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {error && <p className="h2h-error">{error}</p>}

        <div className="h2h-actions">
          <button
            type="button"
            className="primary-btn standings-profile-done"
            data-click="confirm"
            disabled={!selectedOpponentId || busy}
            onClick={sendTestIncoming}
          >
            {busy
              ? "Sending…"
              : selectedOpponentId
                ? H2H_INVERT_TEST
                  ? "Simulate their challenge"
                  : "Send challenge"
                : "Pick an opponent"}
          </button>
        </div>
      </div>
    );
  }

  const canExitContest =
    showPicker || showIncoming || showPick || showWaiting;

  const exitConfirm =
    confirmExit && canExitContest ? (
      <div
        className="standings-profile-overlay h2h-exit-confirm-overlay"
        role="presentation"
        onClick={(e) => {
          e.stopPropagation();
          if (!busy) setConfirmExit(false);
        }}
      >
        <div
          className="standings-profile-modal h2h-exit-confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="h2h-exit-title"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="standings-profile-kicker">Weekly contest</p>
          <h3 id="h2h-exit-title">Exit without submitting?</h3>
          <p className="standings-profile-note">
            If you exit before submitting, you will not be registered for the
            weekly contest.
          </p>
          <div className="h2h-actions">
            <button
              type="button"
              className="ghost-btn"
              data-click="select"
              disabled={busy}
              onClick={() => setConfirmExit(false)}
            >
              Stay
            </button>
            <button
              type="button"
              className="primary-btn standings-profile-done"
              data-click="confirm"
              disabled={busy}
              onClick={exitContestBeforeFinalize}
            >
              {busy ? "Exiting…" : "Exit contest"}
            </button>
          </div>
        </div>
      </div>
    ) : null;

  return createPortal(
    <div
      className="standings-profile-overlay h2h-overlay"
      role="presentation"
      onClick={
        canExitContest && !confirmExit
          ? () => requestExitContest()
          : undefined
      }
    >
      {body}
      {exitConfirm}
    </div>,
    document.body
  );
}

/**
 * Compact live matchup cards on the student home dashboard.
 * Click a card to open the detailed returns modal.
 */
export function HeadToHeadLiveMatchups({
  classId,
  firestoreStudentId,
  studentName,
  onOpenMatch,
}) {
  const [challenge, setChallenge] = useState(null);
  const [matches, setMatches] = useState([]);
  const [roster, setRoster] = useState([]);
  const [liveByTicker, setLiveByTicker] = useState({});

  useEffect(() => {
    if (!classId) return;
    return subscribeHeadToHead(classId, setChallenge);
  }, [classId]);

  useEffect(() => {
    if (!classId) return;
    return subscribeH2hMatches(classId, setMatches);
  }, [classId]);

  useEffect(() => {
    if (!classId) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listClassStudents(classId);
        if (!cancelled) setRoster(rows);
      } catch {
        if (!cancelled) setRoster([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classId]);

  const myMatches = useMemo(() => {
    // Only the active contest season — hide leftovers after a contest ends.
    const seasonId = challenge?.id;
    if (!seasonId) return [];
    return matches.filter((m) => {
      if (m.status !== "accepted") return false;
      if (m.seasonId !== seasonId) return false;
      return (
        m.fromId === firestoreStudentId || m.toId === firestoreStudentId
      );
    });
  }, [matches, challenge?.id, firestoreStudentId]);

  const allTickers = useMemo(() => {
    const set = new Set();
    for (const m of myMatches) {
      for (const p of [...(m.tickersFrom || []), ...(m.tickersTo || [])]) {
        if (p.ticker) set.add(p.ticker);
      }
    }
    return [...set];
  }, [myMatches]);

  useEffect(() => {
    if (allTickers.length === 0) {
      setLiveByTicker({});
      return;
    }
    let cancelled = false;
    async function refresh() {
      const next = {};
      await Promise.all(
        allTickers.map(async (ticker) => {
          try {
            const q = await getQuote(ticker);
            const price = Number(q?.price ?? q?.c);
            if (price > 0) next[ticker] = price;
          } catch {
            /* skip */
          }
        })
      );
      if (!cancelled) setLiveByTicker(next);
    }
    refresh();
    const timer = setInterval(refresh, 45000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [allTickers.join("|")]);

  if (!classId || !firestoreStudentId || myMatches.length === 0) return null;

  const me = roster.find((s) => s.id === firestoreStudentId) || null;
  const myName = me?.name || studentName || "You";
  const myTradingId = me ? tradingIdForSeat(me) : firestoreStudentId;
  const myOutfit = me
    ? outfitForSeat(me, myTradingId, myName)
    : outfitForStudent(myTradingId, myName);

  return (
    <section className="h2h-live-strip" aria-label="Live head to head matchups">
      <div className="h2h-live-strip-head">
        <p className="h2h-live-strip-kicker">Live matchups</p>
        <h3>Head to head</h3>
      </div>
      <ul className="h2h-live-strip-list">
        {myMatches.map((m) => {
          const iAmFrom = m.fromId === firestoreStudentId;
          const myPicks = iAmFrom ? m.tickersFrom : m.tickersTo;
          const theirPicks = iAmFrom ? m.tickersTo : m.tickersFrom;
          const theirName = iAmFrom ? m.toName : m.fromName;
          const theirId = iAmFrom ? m.toId : m.fromId;
          const theirSeat = roster.find((s) => s.id === theirId);
          const theirOutfit = theirSeat
            ? outfitForSeat(
                theirSeat,
                tradingIdForSeat(theirSeat),
                theirSeat.name || theirName
              )
            : outfitForStudent(theirId, theirName);
          const myPct = h2hBasketReturnPct(myPicks, liveByTicker);
          const theirPct = h2hBasketReturnPct(theirPicks, liveByTicker);
          const myReady = (myPicks || []).length === STOCK_SLOTS;
          const theirReady = (theirPicks || []).length === STOCK_SLOTS;
          const bothReady = myReady && theirReady;
          let verdict = "Picks pending";
          if (bothReady && myPct != null && theirPct != null) {
            if (Math.abs(myPct - theirPct) < 0.01) verdict = "Tied";
            else if (myPct > theirPct) verdict = "You’re ahead";
            else verdict = "They’re ahead";
          } else if (!myReady) {
            verdict = "Finish your picks";
          } else if (!theirReady) {
            verdict = "Waiting on opponent";
          }

          return (
            <li key={m.id}>
              <button
                type="button"
                className="h2h-live-card"
                data-click="select"
                onClick={() => onOpenMatch?.(m.id)}
              >
                <div className="h2h-live-card-faceoff">
                  <div className="h2h-live-card-side">
                    <span className="h2h-opponent-avatar h2h-live-card-avatar">
                      <AvatarBlock
                        outfit={myOutfit}
                        className="h2h-opponent-stage"
                      />
                    </span>
                    <span className="h2h-live-card-name">{myName}</span>
                    <span
                      className={`h2h-battle-pct h2h-live-card-side-pct${
                        myPct == null ? "" : myPct >= 0 ? " is-up" : " is-down"
                      }`}
                    >
                      {myReady ? formatPct(myPct) : "—"}
                    </span>
                  </div>
                  <span className="h2h-live-card-vs-badge" aria-hidden="true">
                    vs
                  </span>
                  <div className="h2h-live-card-side is-right">
                    <span className="h2h-opponent-avatar h2h-live-card-avatar">
                      <AvatarBlock
                        outfit={theirOutfit}
                        className="h2h-opponent-stage"
                      />
                    </span>
                    <span className="h2h-live-card-name">{theirName}</span>
                    <span
                      className={`h2h-battle-pct h2h-live-card-side-pct${
                        theirPct == null
                          ? ""
                          : theirPct >= 0
                            ? " is-up"
                            : " is-down"
                      }`}
                    >
                      {theirReady ? formatPct(theirPct) : "—"}
                    </span>
                  </div>
                </div>
                <p className="h2h-live-card-verdict">{verdict}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function pickLegPct(pick, liveByTicker) {
  const live = Number(liveByTicker[pick?.ticker]);
  const start = Number(pick?.startPrice);
  if (!(start > 0) || !(live > 0)) return null;
  return ((live - start) / start) * 100;
}

/**
 * Dashboard scoreboard for active accepted matches.
 * List of live matchups → click for per-stock returns + aggregate win/lose total.
 */
export function HeadToHeadBattleModal({
  open,
  onClose,
  onResumePicks,
  classId,
  firestoreStudentId,
  studentName,
  focusMatchId = "",
}) {
  const [challenge, setChallenge] = useState(null);
  const [matches, setMatches] = useState([]);
  const [roster, setRoster] = useState([]);
  const [liveByTicker, setLiveByTicker] = useState({});
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [error, setError] = useState("");
  const [detailMatchId, setDetailMatchId] = useState("");

  useEffect(() => {
    if (!open) {
      setDetailMatchId("");
      return;
    }
    setDetailMatchId(focusMatchId || "");
  }, [open, focusMatchId]);

  useEffect(() => {
    if (!open) return;
    return subscribeHeadToHead(classId, setChallenge);
  }, [open, classId]);

  useEffect(() => {
    if (!open || !classId) return;
    return subscribeH2hMatches(classId, setMatches);
  }, [open, classId]);

  useEffect(() => {
    if (!open || !classId) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listClassStudents(classId);
        if (!cancelled) setRoster(rows);
      } catch {
        if (!cancelled) setRoster([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, classId]);

  const myMatches = useMemo(() => {
    // Only the active contest season — hide leftovers after a contest ends.
    const seasonId = challenge?.id;
    if (!seasonId) return [];
    return matches.filter((m) => {
      if (m.status !== "accepted") return false;
      if (m.seasonId !== seasonId) return false;
      return (
        m.fromId === firestoreStudentId || m.toId === firestoreStudentId
      );
    });
  }, [matches, challenge?.id, firestoreStudentId]);

  const detailMatch = useMemo(
    () => myMatches.find((m) => m.id === detailMatchId) || null,
    [myMatches, detailMatchId]
  );

  const quoteTickers = useMemo(() => {
    const set = new Set();
    const source = detailMatch ? [detailMatch] : myMatches;
    for (const m of source) {
      for (const p of [...(m.tickersFrom || []), ...(m.tickersTo || [])]) {
        if (p.ticker) set.add(p.ticker);
      }
    }
    return [...set];
  }, [detailMatch, myMatches]);

  useEffect(() => {
    if (!open || quoteTickers.length === 0) {
      setLiveByTicker({});
      return;
    }
    let cancelled = false;
    async function refresh() {
      setLoadingQuotes(true);
      setError("");
      const next = {};
      await Promise.all(
        quoteTickers.map(async (ticker) => {
          try {
            const q = await getQuote(ticker);
            const price = Number(q?.price ?? q?.c);
            if (price > 0) next[ticker] = price;
          } catch {
            /* skip */
          }
        })
      );
      if (!cancelled) {
        setLiveByTicker(next);
        setLoadingQuotes(false);
      }
    }
    refresh();
    const timer = setInterval(refresh, 45000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, quoteTickers.join("|")]);

  if (!open) return null;

  const endsLabel = formatEndDate(challenge?.endsAt);

  function matchSides(m) {
    const iAmFrom = m.fromId === firestoreStudentId;
    const myPicks = iAmFrom ? m.tickersFrom : m.tickersTo;
    const theirPicks = iAmFrom ? m.tickersTo : m.tickersFrom;
    const theirName = iAmFrom ? m.toName : m.fromName;
    const theirId = iAmFrom ? m.toId : m.fromId;
    const mySeat = roster.find((s) => s.id === firestoreStudentId) || null;
    const theirSeat = roster.find((s) => s.id === theirId);
    const myName = mySeat?.name || studentName || "You";
    const myTradingId = mySeat
      ? tradingIdForSeat(mySeat)
      : firestoreStudentId;
    const myOutfit = mySeat
      ? outfitForSeat(mySeat, myTradingId, myName)
      : outfitForStudent(myTradingId, myName);
    const theirOutfit = theirSeat
      ? outfitForSeat(
          theirSeat,
          tradingIdForSeat(theirSeat),
          theirSeat.name || theirName
        )
      : outfitForStudent(theirId, theirName);
    const myPct = h2hBasketReturnPct(myPicks, liveByTicker);
    const theirPct = h2hBasketReturnPct(theirPicks, liveByTicker);
    const myReady = (myPicks || []).length === STOCK_SLOTS;
    const theirReady = (theirPicks || []).length === STOCK_SLOTS;
    let verdict = "Waiting on picks";
    if (myReady && theirReady && myPct != null && theirPct != null) {
      if (Math.abs(myPct - theirPct) < 0.01) verdict = "Tied";
      else if (myPct > theirPct) verdict = "You’re ahead";
      else verdict = "They’re ahead";
    } else if (myReady && !theirReady) {
      verdict = "Waiting on opponent";
    } else if (!myReady) {
      verdict = "You still need picks";
    }
    return {
      myPicks,
      theirPicks,
      myName,
      myOutfit,
      theirName,
      theirOutfit,
      myPct,
      theirPct,
      myReady,
      theirReady,
      verdict,
    };
  }

  function renderPickList(picks, prefix) {
    if (!(picks || []).length) {
      return (
        <li className="standings-profile-note">No picks yet</li>
      );
    }
    return (picks || []).map((p) => {
      const leg = pickLegPct(p, liveByTicker);
      return (
        <li key={`${prefix}-${p.ticker}`}>
          <span className="h2h-battle-pick-main">
            <strong>{p.ticker}</strong>
            {p.name && p.name !== p.ticker ? (
              <em>{p.name}</em>
            ) : null}
          </span>
          <span
            className={
              leg == null ? "" : leg >= 0 ? "is-up" : "is-down"
            }
          >
            {formatPct(leg)}
          </span>
        </li>
      );
    });
  }

  let body;
  if (detailMatch) {
    const s = matchSides(detailMatch);
    body = (
      <>
        <div className="h2h-top">
          <button
            type="button"
            className="ghost-btn h2h-back-btn"
            data-click="select"
            onClick={() => setDetailMatchId("")}
          >
            ← All matchups
          </button>
          <p className="standings-profile-kicker">Live matchup</p>
          <h3 id="h2h-battle-title" className="sr-only">
            {s.myName} vs {s.theirName}
          </h3>
          <div className="h2h-live-card-faceoff h2h-battle-faceoff">
            <div className="h2h-live-card-side">
              <span className="h2h-opponent-avatar h2h-live-card-avatar h2h-battle-face-avatar">
                <AvatarBlock
                  outfit={s.myOutfit}
                  className="h2h-opponent-stage"
                />
              </span>
              <span className="h2h-live-card-name">{s.myName}</span>
            </div>
            <span className="h2h-live-card-vs-badge" aria-hidden="true">
              vs
            </span>
            <div className="h2h-live-card-side is-right">
              <span className="h2h-opponent-avatar h2h-live-card-avatar h2h-battle-face-avatar">
                <AvatarBlock
                  outfit={s.theirOutfit}
                  className="h2h-opponent-stage"
                />
              </span>
              <span className="h2h-live-card-name">{s.theirName}</span>
            </div>
          </div>
          {endsLabel && (
            <p className="h2h-deadline">Contest ends {endsLabel}</p>
          )}
          {loadingQuotes && (
            <p className="h2h-deadline">Refreshing live prices…</p>
          )}
          <p className="h2h-battle-verdict">{s.verdict}</p>
        </div>

        {!s.myReady && (
          <button
            type="button"
            className="primary-btn h2h-finish-picks-btn"
            data-click="confirm"
            onClick={() => {
              onClose?.();
              onResumePicks?.();
            }}
          >
            Finish your 3 picks
          </button>
        )}

        <div className="h2h-battle-cols">
          <div>
            <p className="h2h-battle-side-label">Your stocks</p>
            <ul className="h2h-battle-picks">
              {renderPickList(s.myPicks, `me-${detailMatch.id}`)}
            </ul>
          </div>
          <div>
            <p className="h2h-battle-side-label">Their stocks</p>
            <ul className="h2h-battle-picks">
              {renderPickList(s.theirPicks, `them-${detailMatch.id}`)}
            </ul>
          </div>
        </div>

        <div className="h2h-battle-aggregate" aria-label="Match total">
          <p className="h2h-battle-aggregate-label">
            Basket return · decides the match
          </p>
          <div className="h2h-battle-aggregate-row">
            <div>
              <p className="h2h-battle-side-label">You</p>
              <p
                className={`h2h-battle-pct h2h-battle-aggregate-pct${
                  s.myPct == null
                    ? ""
                    : s.myPct >= 0
                      ? " is-up"
                      : " is-down"
                }`}
              >
                {s.myReady ? formatPct(s.myPct) : "—"}
              </p>
            </div>
            <div className="h2h-battle-aggregate-vs" aria-hidden="true">
              vs
            </div>
            <div>
              <p className="h2h-battle-side-label">{s.theirName}</p>
              <p
                className={`h2h-battle-pct h2h-battle-aggregate-pct${
                  s.theirPct == null
                    ? ""
                    : s.theirPct >= 0
                      ? " is-up"
                      : " is-down"
                }`}
              >
                {s.theirReady ? formatPct(s.theirPct) : "—"}
              </p>
            </div>
          </div>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div className="h2h-top">
          <p className="standings-profile-kicker">Head to head</p>
          <h3 id="h2h-battle-title">Your battles</h3>
          {endsLabel && (
            <p className="h2h-deadline">Contest ends {endsLabel}</p>
          )}
          {loadingQuotes && (
            <p className="h2h-deadline">Refreshing live prices…</p>
          )}
        </div>

        {myMatches.length === 0 ? (
          <p className="standings-profile-note">
            No active matches yet. Accept a challenge and lock 3 stock picks
            to start tracking.
          </p>
        ) : (
          <ul className="h2h-battle-list">
            {myMatches.map((m) => {
              const s = matchSides(m);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className="h2h-battle-card h2h-battle-card-btn"
                    data-click="select"
                    onClick={() => setDetailMatchId(m.id)}
                  >
                    <div className="h2h-live-card-faceoff">
                      <div className="h2h-live-card-side">
                        <span className="h2h-opponent-avatar h2h-live-card-avatar">
                          <AvatarBlock
                            outfit={s.myOutfit}
                            className="h2h-opponent-stage"
                          />
                        </span>
                        <span className="h2h-live-card-name">{s.myName}</span>
                      </div>
                      <span className="h2h-live-card-vs-badge" aria-hidden="true">
                        vs
                      </span>
                      <div className="h2h-live-card-side is-right">
                        <span className="h2h-opponent-avatar h2h-live-card-avatar">
                          <AvatarBlock
                            outfit={s.theirOutfit}
                            className="h2h-opponent-stage"
                          />
                        </span>
                        <span className="h2h-live-card-name">{s.theirName}</span>
                      </div>
                    </div>
                    <div className="h2h-live-card-score">
                      <span
                        className={`h2h-battle-pct${
                          s.myPct == null
                            ? ""
                            : s.myPct >= 0
                              ? " is-up"
                              : " is-down"
                        }`}
                      >
                        {s.myReady ? formatPct(s.myPct) : "—"}
                      </span>
                      <span className="h2h-live-card-divider">/</span>
                      <span
                        className={`h2h-battle-pct${
                          s.theirPct == null
                            ? ""
                            : s.theirPct >= 0
                              ? " is-up"
                              : " is-down"
                        }`}
                      >
                        {s.theirReady ? formatPct(s.theirPct) : "—"}
                      </span>
                    </div>
                    <p className="h2h-battle-verdict">{s.verdict}</p>
                    <p className="h2h-battle-open-hint">
                      View stock-by-stock returns →
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  }

  const modal = (
    <div
      className="standings-profile-overlay h2h-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="standings-profile-modal h2h-modal h2h-battle-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="h2h-battle-title"
        onClick={(e) => e.stopPropagation()}
      >
        {body}

        {error && <p className="h2h-error">{error}</p>}

        <button
          type="button"
          className="primary-btn standings-profile-done"
          data-click="select"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

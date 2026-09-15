import { Suspense, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getStandings, getStudent } from "./api";
import { listClassStudents } from "./classStore";
import {
  AvatarCanvas,
  ClassWalkingStage,
  classFishWalker,
  loadSavedOutfit,
  outfitForStudent,
  stripPlayerFishForm,
} from "./StudentCharacter";

const STRATEGY_PLACEHOLDER =
  "This student hasn’t written an investing strategy yet.";

function money(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });
}

function outfitForSeat(seat, tradingId, name) {
  const base = outfitForStudent(tradingId, name);
  if (seat?.outfit && typeof seat.outfit === "object") {
    return stripPlayerFishForm({ ...base, ...seat.outfit, npcFish: false }, base);
  }
  return loadSavedOutfit(tradingId, name);
}

function tradingIdForSeat(seat) {
  return String(seat.apiStudentId || seat.id);
}

function topHoldingsFromPortfolio(portfolio) {
  const rows = Array.isArray(portfolio?.holdings) ? portfolio.holdings : [];
  return [...rows]
    .map((h) => {
      const value =
        h.market_value != null
          ? Number(h.market_value)
          : h.equity != null
            ? Number(h.equity)
            : Number(h.avg_cost || 0) * Number(h.shares || 0);
      return {
        ticker: h.ticker,
        name: h.name || h.ticker,
        value: Number.isFinite(value) ? value : 0,
        shares: Number(h.shares) || 0,
      };
    })
    .filter((h) => h.ticker && h.value > 0.005)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
}

export default function ClassView({ currentStudentId, classId, onBack }) {
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [profileHoldings, setProfileHoldings] = useState([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        if (!classId) {
          throw new Error("Join a class to see standings for that roster.");
        }
        // Seats (names/outfits) from Firestore client; totals from one light API call.
        const [seats, standingsPayload] = await Promise.all([
          listClassStudents(classId),
          getStandings(classId),
        ]);
        const byId = new Map();
        for (const row of standingsPayload?.students || []) {
          byId.set(String(row.id), row);
        }
        const rows = (seats || []).map((seat) => {
          const tradeId = tradingIdForSeat(seat);
          const live =
            byId.get(String(seat.id)) ||
            byId.get(String(tradeId)) ||
            null;
          const cash = Number(live?.cash ?? seat.cash) || 0;
          const total =
            live?.total_value != null ? Number(live.total_value) : cash;
          return {
            id: tradeId,
            seatId: seat.id,
            name: seat.name || live?.name || "Student",
            cash,
            portfolio_value: Number(live?.portfolio_value) || 0,
            total_value: total,
            netWorth: total,
            outfit: seat.outfit || null,
            investmentGoal: seat.investmentGoal || null,
            strategyBio: String(seat.strategyBio || "").trim() || null,
          };
        });
        // Roster (Firestore seats) is the source of truth — do not re-add orphaned
        // ledger docs that are no longer on the class roster.
        if (!cancelled) setRoster(rows);
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not load class standings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classId]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (selected) {
        setSelected(null);
        return;
      }
      onBack();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onBack, selected]);

  useEffect(() => {
    if (!selected || !classId) {
      setProfileHoldings([]);
      setProfileError("");
      setProfileLoading(false);
      return undefined;
    }
    let cancelled = false;
    setProfileLoading(true);
    setProfileError("");
    setProfileHoldings([]);
    getStudent(selected.id, classId)
      .then((portfolio) => {
        if (cancelled) return;
        setProfileHoldings(topHoldingsFromPortfolio(portfolio));
      })
      .catch((err) => {
        if (cancelled) return;
        setProfileError(err.message || "Could not load holdings.");
        setProfileHoldings([]);
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, classId]);

  const ranked = useMemo(() => {
    const rows = [...roster];
    rows.sort((a, b) => b.netWorth - a.netWorth || a.name.localeCompare(b.name));
    return rows.map((s, i) => ({ ...s, rank: i + 1 }));
  }, [roster]);

  const walkers = useMemo(() => {
    const students = ranked.map((s) => ({
      id: s.id,
      name: s.name,
      isYou: s.id === currentStudentId || s.seatId === currentStudentId,
      outfit: outfitForSeat(
        { id: s.seatId, outfit: s.outfit },
        s.id,
        s.name
      ),
    }));
    // Always include the class fruit-fly NPC on the standings walk stage.
    return [...students, classFishWalker()];
  }, [ranked, currentStudentId]);

  const classTotal = useMemo(
    () => ranked.reduce((s, r) => s + Math.max(0, r.netWorth), 0),
    [ranked]
  );

  const youRank = useMemo(() => {
    const row = ranked.find(
      (s) => s.id === currentStudentId || s.seatId === currentStudentId
    );
    return row?.rank ?? null;
  }, [ranked, currentStudentId]);

  const selectedOutfit = selected
    ? outfitForSeat(
        { id: selected.seatId, outfit: selected.outfit },
        selected.id,
        selected.name
      )
    : null;

  function closeProfile() {
    setSelected(null);
  }

  const overlay = (
    <div className="standings-overlay" role="dialog" aria-modal="true" aria-label="Class standings">
      <div className="standings-topbar">
        <button
          type="button"
          className="standings-back"
          data-click="select"
          onClick={onBack}
          aria-label="Back"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M15.5 4.5 7.5 12l8 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="standings-title">
          <p className="standings-kicker">Class standings</p>
          <h2>
            Ranked by portfolio value
            {youRank != null ? ` · You’re #${youRank}` : ""}
          </h2>
        </div>
        <p className="standings-total">
          {classTotal > 0 ? money(classTotal) : "—"}
          <span> class total</span>
        </p>
      </div>

      {loading && <p className="standings-empty">Loading the class…</p>}
      {error && <p className="standings-empty standings-error">{error}</p>}
      {!loading && !error && (
        <div className="standings-body">
          <div className="standings-walk-wrap" aria-label="Class walking stage">
            <Suspense fallback={<div className="standings-walk-stage standings-walk-fallback" />}>
              <ClassWalkingStage walkers={walkers} className="standings-walk-stage" />
            </Suspense>
          </div>

          {ranked.length === 0 ? (
            <p className="standings-empty">No students in this class yet.</p>
          ) : (
            <div className="standings-table-panel">
              <div className="standings-table-scroll">
                <table className="standings-table">
                  <caption className="sr-only">
                    Class standings ranked by total portfolio value
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Student</th>
                      <th scope="col" className="standings-col-value">
                        Portfolio value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((s) => {
                      const isYou =
                        s.id === currentStudentId || s.seatId === currentStudentId;
                      const share =
                        classTotal > 0
                          ? ((Math.max(0, s.netWorth) / classTotal) * 100).toFixed(1)
                          : null;
                      return (
                        <tr
                          key={s.seatId || s.id}
                          className={[
                            "standings-row",
                            isYou ? "is-you" : "",
                            s.rank <= 3 ? `is-top-${s.rank}` : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <td className="standings-player">
                            <span className="standings-rank">#{s.rank}</span>
                            <button
                              type="button"
                              className="standings-name-btn"
                              data-click="select"
                              onClick={() => setSelected(s)}
                            >
                              <strong className="standings-name">{s.name}</strong>
                            </button>
                            {isYou ? <span className="standings-you-pill">You</span> : null}
                          </td>
                          <td className="standings-value">
                            <strong>{money(s.netWorth)}</strong>
                            {share != null && (
                              <span className="standings-share">{share}% of class</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {selected && (
        <div
          className="standings-profile-overlay"
          role="presentation"
          onClick={closeProfile}
        >
          <div
            className="standings-profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="standings-profile-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="standings-profile-hero">
              <div className="standings-profile-avatar" aria-hidden="true">
                <Suspense
                  fallback={
                    <div className="standings-profile-avatar-fallback">
                      <span className="busy-spinner" />
                    </div>
                  }
                >
                  {selectedOutfit ? (
                    <AvatarCanvas
                      outfit={selectedOutfit}
                      mode="headshot"
                      className="standings-profile-stage"
                    />
                  ) : null}
                </Suspense>
              </div>

              <div className="standings-profile-identity">
                <p className="standings-profile-kicker">
                  #{selected.rank}
                  {(selected.id === currentStudentId ||
                    selected.seatId === currentStudentId) &&
                    " · You"}
                </p>
                <h3 id="standings-profile-title">{selected.name}</h3>
                <p className="standings-profile-value">
                  {money(selected.netWorth)}
                  <span> portfolio</span>
                </p>
              </div>
            </div>

            <section className="standings-profile-section">
              <h4>Top holdings</h4>
              {profileLoading && (
                <p className="standings-profile-note">Loading holdings…</p>
              )}
              {!profileLoading && profileError && (
                <p className="standings-profile-note">{profileError}</p>
              )}
              {!profileLoading && !profileError && profileHoldings.length === 0 && (
                <p className="standings-profile-note">
                  No investments yet — mostly cash.
                </p>
              )}
              {!profileLoading && profileHoldings.length > 0 && (
                <ol className="standings-profile-holdings">
                  {profileHoldings.map((h) => (
                    <li key={h.ticker}>
                      <span className="standings-profile-holding-main">
                        <strong>{h.ticker}</strong>
                        <span>{h.name}</span>
                      </span>
                      <span className="standings-profile-holding-val">
                        {money(h.value, 2)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="standings-profile-section">
              <h4>Investment strategy</h4>
              <p className="standings-profile-strategy">
                {selected.strategyBio || STRATEGY_PLACEHOLDER}
              </p>
            </section>

            <button
              type="button"
              className="primary-btn standings-profile-done"
              data-click="confirm"
              onClick={closeProfile}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}

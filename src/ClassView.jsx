import { Suspense, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getStudent } from "./api";
import { listClassStudents } from "./classStore";
import {
  ClassWalkingStage,
  loadSavedOutfit,
  outfitForStudent,
} from "./StudentCharacter";

function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function outfitForSeat(seat, tradingId, name) {
  if (seat?.outfit && typeof seat.outfit === "object") {
    return { ...outfitForStudent(tradingId, name), ...seat.outfit };
  }
  return loadSavedOutfit(tradingId, name);
}

function tradingIdForSeat(seat) {
  return String(seat.apiStudentId || seat.id);
}

/** Build one standings row from a Firestore class seat + optional API portfolio. */
function rowFromSeat(seat, portfolio) {
  const id = tradingIdForSeat(seat);
  const name = seat.name || portfolio?.name || "Student";
  const cash = Number(portfolio?.cash ?? seat.cash) || 0;
  const total =
    portfolio?.total_value != null
      ? Number(portfolio.total_value)
      : cash;
  return {
    id,
    seatId: seat.id,
    name,
    cash,
    portfolio_value: Number(portfolio?.portfolio_value) || 0,
    total_value: total,
    netWorth: total,
    outfit: seat.outfit || null,
  };
}

export default function ClassView({ currentStudentId, classId, onBack }) {
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        if (!classId) {
          throw new Error("Join a class to see standings for that roster.");
        }
        // Source of truth: Firestore seats for THIS class — not the global SQLite list.
        const seats = await listClassStudents(classId);
        const rows = await Promise.all(
          (seats || []).map(async (seat) => {
            const tradeId = tradingIdForSeat(seat);
            let portfolio = null;
            try {
              portfolio = await getStudent(tradeId, classId);
            } catch {
              try {
                if (String(seat.id) !== tradeId) {
                  portfolio = await getStudent(seat.id, classId);
                }
              } catch {
                portfolio = null;
              }
            }
            return rowFromSeat(seat, portfolio);
          })
        );
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
      if (e.key === "Escape") onBack();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onBack]);

  const ranked = useMemo(() => {
    const rows = [...roster];
    rows.sort((a, b) => b.netWorth - a.netWorth || a.name.localeCompare(b.name));
    return rows.map((s, i) => ({ ...s, rank: i + 1 }));
  }, [roster]);

  const walkers = useMemo(
    () =>
      ranked.map((s) => ({
        id: s.id,
        name: s.name,
        isYou: s.id === currentStudentId || s.seatId === currentStudentId,
        outfit: outfitForSeat(
          { id: s.seatId, outfit: s.outfit },
          s.id,
          s.name
        ),
      })),
    [ranked, currentStudentId]
  );

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

  const overlay = (
    <div className="standings-overlay" role="dialog" aria-modal="true" aria-label="Class standings">
      <div className="standings-topbar">
        <button
          type="button"
          className="standings-back"
          data-click="select"
          onClick={onBack}
          aria-label="Back to markets"
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
      {!loading && !error && ranked.length === 0 && (
        <p className="standings-empty">No students in this class yet.</p>
      )}

      {!loading && !error && ranked.length > 0 && (
        <div className="standings-body">
          {walkers.length > 0 && (
            <div className="standings-walk-wrap" aria-label="Class walking stage">
              <Suspense fallback={<div className="standings-walk-stage standings-walk-fallback" />}>
                <ClassWalkingStage walkers={walkers} className="standings-walk-stage" />
              </Suspense>
            </div>
          )}

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
                          <strong className="standings-name">{s.name}</strong>
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
        </div>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}

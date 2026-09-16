import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { listH2hMatches } from "./classStore";

function formatEndDate(endsAt) {
  if (!endsAt || typeof endsAt?.toLocaleString !== "function") return null;
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

/**
 * Teacher class-wide matchup board.
 * Portaled to document.body so the overlay covers the full viewport
 * (teacher .panel keeps a transform from its entrance animation).
 */
export default function TeacherHeadToHeadModal({
  open,
  onClose,
  classId,
  challenge,
  onEndContest,
  ending = false,
}) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => {
    if (!open || !classId) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setConfirmEnd(false);
    listH2hMatches(classId)
      .then((rows) => {
        if (!cancelled) setMatches(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err?.message || "Could not load matchups");
          setMatches([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, classId]);

  const seasonId = challenge?.id || "";

  const { liveMatches, pendingMatches } = useMemo(() => {
    const seasonRows = seasonId
      ? matches.filter((m) => m?.seasonId === seasonId)
      : [];
    return {
      liveMatches: seasonRows.filter((m) => m.status === "accepted"),
      pendingMatches: seasonRows.filter((m) => m.status === "pending"),
    };
  }, [matches, seasonId]);

  if (!open) return null;

  const endsLabel = formatEndDate(challenge?.endsAt);

  function renderMatch(m) {
    const fromName = m.fromName || "Student";
    const toName = m.toName || "Student";
    const fromReady = (m.tickersFrom || []).length === 3;
    const toReady = (m.tickersTo || []).length === 3;
    const fromTickers = (m.tickersFrom || []).map((p) => p.ticker).filter(Boolean);
    const toTickers = (m.tickersTo || []).map((p) => p.ticker).filter(Boolean);

    let verdict = "Picks pending";
    if (m.status === "pending") verdict = "Waiting on accept";
    else if (fromReady && toReady) verdict = "Both locked in";
    else if (!fromReady && !toReady) verdict = "Both still picking";
    else if (!fromReady) verdict = `Waiting on ${fromName}`;
    else verdict = `Waiting on ${toName}`;

    return (
      <li key={m.id} className="h2h-battle-card">
        <div className="h2h-live-card-faceoff">
          <div className="h2h-live-card-side">
            <span className="h2h-live-card-name">{fromName}</span>
            <span className="h2h-teacher-pick-line">
              {fromTickers.length ? fromTickers.join(" · ") : "—"}
            </span>
          </div>
          <span className="h2h-live-card-vs-badge" aria-hidden="true">
            vs
          </span>
          <div className="h2h-live-card-side is-right">
            <span className="h2h-live-card-name">{toName}</span>
            <span className="h2h-teacher-pick-line">
              {toTickers.length ? toTickers.join(" · ") : "—"}
            </span>
          </div>
        </div>
        <p className="h2h-live-card-verdict">{verdict}</p>
      </li>
    );
  }

  return createPortal(
    <div className="confirm-overlay" role="presentation" onClick={onClose}>
      <div
        className="confirm-modal h2h-teacher-matchups-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="h2h-teacher-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="confirm-kicker">Head to head</p>
        <h3 id="h2h-teacher-title">Class matchups</h3>
        {endsLabel ? (
          <p className="confirm-body" style={{ marginTop: "0.35rem" }}>
            Contest ends {endsLabel}
          </p>
        ) : null}

        {loading ? (
          <p className="confirm-body">Loading matchups…</p>
        ) : null}
        {loadError ? <p className="h2h-error">{loadError}</p> : null}

        {!loading && !loadError && liveMatches.length === 0 && pendingMatches.length === 0 ? (
          <p className="confirm-body">
            No challenges yet. Students show up here once they send or accept a
            request.
          </p>
        ) : null}

        {!loading && liveMatches.length > 0 ? (
          <section className="h2h-teacher-section">
            <h4 className="h2h-roster-title">
              Active battles ({liveMatches.length})
            </h4>
            <ul className="h2h-battle-list">{liveMatches.map(renderMatch)}</ul>
          </section>
        ) : null}

        {!loading && pendingMatches.length > 0 ? (
          <section className="h2h-teacher-section">
            <h4 className="h2h-roster-title">
              Pending requests ({pendingMatches.length})
            </h4>
            <ul className="h2h-battle-list">
              {pendingMatches.map(renderMatch)}
            </ul>
          </section>
        ) : null}

        {confirmEnd ? (
          <div className="h2h-teacher-end-confirm">
            <p className="confirm-body">
              End the contest for everyone? Students will leave the challenge
              flow.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="ghost-btn"
                disabled={ending}
                onClick={() => setConfirmEnd(false)}
              >
                Keep live
              </button>
              <button
                type="button"
                className="primary-btn confirm-danger-btn"
                disabled={ending}
                onClick={() => {
                  Promise.resolve(onEndContest?.()).finally(() => {
                    setConfirmEnd(false);
                  });
                }}
              >
                {ending ? "Ending…" : "End contest"}
              </button>
            </div>
          </div>
        ) : (
          <div className="confirm-actions">
            <button
              type="button"
              className="ghost-btn danger-text"
              disabled={ending}
              onClick={() => setConfirmEnd(true)}
            >
              End head to head
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

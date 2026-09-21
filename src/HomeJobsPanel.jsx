import { useCallback, useEffect, useMemo, useState } from "react";
import { joinCrewJob, listCrewJobs } from "./api";
import ClosetReviewPreview from "./ClosetReviewPreview";

function money(n) {
  return Number(n || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Compact hiring strip for the student home dashboard.
 * Shows 2–3 open Job board roles with join + link to the full board.
 */
export default function HomeJobsPanel({
  classId,
  studentId = "",
  onOpenBoard,
}) {
  const [jobs, setJobs] = useState([]);
  const [joinedCount, setJoinedCount] = useState(0);
  const [maxJoins, setMaxJoins] = useState(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    if (!classId) {
      setJobs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await listCrewJobs(classId, studentId);
      setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
      setJoinedCount(Number(data?.joinedCount) || 0);
      setMaxJoins(Number(data?.maxJoins) || 2);
    } catch (err) {
      setError(err.message || "Could not load jobs");
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [classId, studentId]);

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 12000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const openJobs = useMemo(() => {
    return jobs
      .filter((job) => {
        if (!job || job.status !== "open") return false;
        if (Number(job.openSlots) <= 0) return false;
        if (String(job.id || "").startsWith("closet-")) return false;
        if (job.id === "demo-parrot-filled") return false;
        if (studentId && job.creatorId === studentId) return false;
        const alreadyOn = (job.members || []).some(
          (m) => m.studentId === studentId
        );
        if (alreadyOn) return false;
        return true;
      })
      .slice(0, 3);
  }, [jobs, studentId]);

  async function handleJoin(jobId) {
    if (!studentId || !jobId || busyId) return;
    if (joinedCount >= maxJoins) {
      setError(
        `You’re already on ${maxJoins} jobs — leave one on the Job board first.`
      );
      return;
    }
    setBusyId(jobId);
    setError("");
    setNote("");
    try {
      const data = await joinCrewJob(classId, studentId, jobId);
      if (data?.joinedCount != null) setJoinedCount(Number(data.joinedCount) || 0);
      setNote("You’re on the crew. Open the Job board anytime to see your slot.");
      await refresh();
    } catch (err) {
      setError(err.message || "Could not join");
    } finally {
      setBusyId(null);
    }
  }

  if (!classId) return null;

  return (
    <section className="home-jobs-panel" aria-label="Open jobs">
      <div className="home-jobs-panel-head">
        <div>
          <p className="home-jobs-panel-kicker">Hiring now</p>
          <h3>Open jobs</h3>
        </div>
        <button
          type="button"
          className="ghost-btn home-jobs-panel-link"
          data-click="select"
          onClick={onOpenBoard}
        >
          Full job board →
        </button>
      </div>

      {loading && openJobs.length === 0 ? (
        <p className="home-jobs-panel-empty">Checking the board…</p>
      ) : openJobs.length === 0 ? (
        <p className="home-jobs-panel-empty">
          No open Team / Crew roles right now. Check the full board for
          partnerships and filled crews.
        </p>
      ) : (
        <ul className="home-jobs-list">
          {openJobs.map((job) => {
            const wage =
              job.payMode === "profit_share"
                ? `${job.profitSharePct || 50}% profit share`
                : `${money(job.wageEach)} wage`;
            const open = Math.max(0, Number(job.openSlots) || 0);
            const slots = Math.max(1, Number(job.slots) || 1);
            const atCap = joinedCount >= maxJoins;
            return (
              <li key={job.id} className="home-jobs-row">
                <ClosetReviewPreview
                  thumbnailUrl={job.thumbnailUrl}
                  glbUrl={job.glbUrl}
                  parts={job.parts}
                  label={job.itemLabel || job.jobTitle || "Item"}
                  className="home-jobs-thumb closet-review-preview"
                />
                <div className="home-jobs-copy">
                  <strong>{job.itemLabel || job.jobTitle || "Class item"}</strong>
                  <span>
                    by {job.creatorName || "Student"}
                    {` · ${open}/${slots} open · ${wage}`}
                  </span>
                </div>
                <button
                  type="button"
                  className="primary-btn home-jobs-join"
                  data-click="confirm"
                  disabled={!studentId || busyId === job.id || atCap}
                  title={
                    atCap
                      ? `Already on ${maxJoins} jobs`
                      : "Join this crew"
                  }
                  onClick={() => handleJoin(job.id)}
                >
                  {busyId === job.id ? "…" : atCap ? "Full" : "Join"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error ? <p className="closet-note closet-note-error">{error}</p> : null}
      {note && !error ? <p className="closet-note">{note}</p> : null}
    </section>
  );
}

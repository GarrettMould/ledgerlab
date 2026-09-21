import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  declineCrewInvite,
  joinCrewJob,
  leaveCrewJob,
  listCrewJobs,
} from "./api";
import ClosetReviewPreview from "./ClosetReviewPreview";
import {
  AvatarCanvas,
  loadSavedOutfit,
  outfitForStudent,
  stripPlayerFishForm,
} from "./StudentCharacter";
import { listClassStudents } from "./classStore";

function money(n) {
  return Number(n || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function seatId(seat) {
  return String(seat?.id || seat?.apiStudentId || "");
}

function outfitForMember(member, rosterById) {
  const id = String(member?.studentId || "");
  const seat = rosterById.get(id);
  const name = member?.studentName || seat?.name || "Student";
  const base = outfitForStudent(id, name);
  if (seat?.outfit && typeof seat.outfit === "object") {
    return stripPlayerFishForm({ ...base, ...seat.outfit, npcFish: false }, base);
  }
  return loadSavedOutfit(id, name);
}

function MemberAvatar({ outfit, name }) {
  return (
    <span className="job-slot-avatar" aria-hidden="true">
      <Suspense
        fallback={
          <div className="standings-profile-avatar-fallback">
            <span className="busy-spinner" />
          </div>
        }
      >
        {outfit ? (
          <AvatarCanvas
            outfit={outfit}
            mode="headshot"
            className="h2h-opponent-stage job-slot-stage"
          />
        ) : (
          <span className="job-slot-initial">
            {(name || "?").slice(0, 1).toUpperCase()}
          </span>
        )}
      </Suspense>
    </span>
  );
}

function JobProductPreview({ job }) {
  const label = job?.itemLabel || job?.jobTitle || "Item";
  const thumb = String(job?.thumbnailUrl || "").trim();
  const glb = String(job?.glbUrl || "").trim();
  const parts = Array.isArray(job?.parts) ? job.parts : [];
  if (!thumb && !glb && !parts.length) {
    return (
      <div className="job-board-product-preview is-empty" aria-hidden="true">
        <span>?</span>
      </div>
    );
  }
  return (
    <ClosetReviewPreview
      thumbnailUrl={thumb}
      glbUrl={glb}
      parts={parts}
      label={label}
      className="job-board-product-preview"
      lowerInFrame
    />
  );
}

/**
 * Crew row: creator profile first, then hireable join slots.
 */
function CrewSlotRow({
  job,
  studentId,
  rosterById,
  busy,
  canJoin,
  onJoin,
  onLeave,
  lockReason = "",
}) {
  const slots = Math.max(1, Number(job.slots) || 1);
  const members = Array.isArray(job.members) ? job.members : [];
  const creatorId = String(job.creatorId || "");
  const hireMembers = members.filter(
    (m) => String(m?.studentId || "") !== creatorId
  );
  const joined = hireMembers.some((m) => m.studentId === studentId);
  const isOwner = creatorId === String(studentId || "");
  const hiring = job.status === "open" && Number(job.openSlots) > 0;
  const openJoin = hiring && canJoin && !joined && !isOwner;

  const creatorSeat = rosterById.get(creatorId);
  const creatorName =
    job.creatorName || creatorSeat?.name || "Creator";
  const creatorOutfit = creatorId
    ? outfitForMember(
        { studentId: creatorId, studentName: creatorName },
        rosterById
      )
    : null;

  return (
    <ul className="job-crew-slots" aria-label="Crew slots">
      <li key={`${job.id}-creator`}>
        <div className="job-crew-slot is-filled is-creator">
          <MemberAvatar outfit={creatorOutfit} name={creatorName} />
          <span className="job-crew-slot-name">{creatorName}</span>
          <span className="job-crew-slot-role">Creator</span>
        </div>
      </li>
      {Array.from({ length: slots }, (_, i) => {
        const member = hireMembers[i];
        if (member) {
          const mine = member.studentId === studentId;
          const outfit = outfitForMember(member, rosterById);
          const name = member.studentName || "Student";
          return (
            <li key={`${job.id}-m-${i}-${member.studentId || i}`}>
              <div
                className={`job-crew-slot is-filled${mine ? " is-mine" : ""}`}
              >
                <MemberAvatar outfit={outfit} name={name} />
                <span className="job-crew-slot-name">{name}</span>
                {mine && hiring ? (
                  <button
                    type="button"
                    className="job-crew-slot-leave"
                    data-click="select"
                    disabled={busy}
                    onClick={onLeave}
                  >
                    Leave
                  </button>
                ) : null}
              </div>
            </li>
          );
        }
        return (
          <li key={`${job.id}-open-${i}`}>
            <button
              type="button"
              className={`job-crew-slot is-open${openJoin ? "" : " is-locked"}`}
              data-click={openJoin ? "confirm" : "select"}
              disabled={!openJoin || busy}
              onClick={openJoin ? onJoin : undefined}
              title={
                openJoin
                  ? "Join this crew"
                  : isOwner
                    ? "You can’t join your own business"
                    : lockReason || "Open crew slot"
              }
              aria-label={
                openJoin
                  ? `Join open slot ${i + 1}`
                  : isOwner
                    ? "Your project — can’t join"
                    : lockReason || "Open crew slot"
              }
            >
              <span className="job-crew-slot-plus" aria-hidden="true">
                +
              </span>
              <span className="job-crew-slot-name">
                {openJoin ? "Join" : isOwner ? "Open" : "Open"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Class job board: open crew slots (+ to join) + who already signed up.
 */
export default function JobBoard({
  classId,
  studentId = "",
  onBack,
}) {
  const [jobs, setJobs] = useState([]);
  const [invites, setInvites] = useState([]);
  const [joinedCount, setJoinedCount] = useState(0);
  const [maxJoins, setMaxJoins] = useState(2);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const rosterById = useMemo(() => {
    const map = new Map();
    for (const s of roster) {
      const id = seatId(s);
      if (id) map.set(id, s);
    }
    return map;
  }, [roster]);

  const refresh = useCallback(async () => {
    if (!classId) {
      setJobs([]);
      setInvites([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await listCrewJobs(classId, studentId);
      setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
      setInvites(Array.isArray(data?.invites) ? data.invites : []);
      setJoinedCount(Number(data?.joinedCount) || 0);
      setMaxJoins(Number(data?.maxJoins) || 2);
    } catch (err) {
      setError(err.message || "Could not load job board");
      setJobs([]);
      setInvites([]);
      setJoinedCount(0);
    } finally {
      setLoading(false);
    }
  }, [classId, studentId]);

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 8000);
    return () => window.clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!classId) {
      setRoster([]);
      return undefined;
    }
    let cancelled = false;
    listClassStudents(classId)
      .then((rows) => {
        if (!cancelled) setRoster(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setRoster([]);
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  async function handleJoin(jobId) {
    if (!studentId || !jobId || busyId) return;
    if (String(jobId).startsWith("closet-") || jobId === "demo-parrot-filled") {
      setError("This posting isn’t open for joining.");
      return;
    }
    const target = jobs.find((j) => j.id === jobId);
    if (target?.creatorId === studentId) {
      setError("You can’t join your own business as an employee.");
      return;
    }
    if (joinedCount >= maxJoins) {
      setError(
        `You can only join ${maxJoins} jobs at a time. Leave one before joining another.`
      );
      return;
    }
    setBusyId(jobId);
    setError("");
    try {
      const data = await joinCrewJob(classId, studentId, jobId);
      if (data?.joinedCount != null) setJoinedCount(Number(data.joinedCount) || 0);
      await refresh();
    } catch (err) {
      setError(err.message || "Could not join");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDecline(jobId) {
    if (!studentId || !jobId || busyId) return;
    setBusyId(jobId);
    setError("");
    try {
      await declineCrewInvite(classId, studentId, jobId);
      await refresh();
    } catch (err) {
      setError(err.message || "Could not decline");
    } finally {
      setBusyId(null);
    }
  }

  async function handleLeave(jobId) {
    if (!studentId || !jobId || busyId) return;
    if (jobId === "demo-parrot-filled") {
      setError("This demo crew can’t be left.");
      return;
    }
    setBusyId(jobId);
    setError("");
    try {
      await leaveCrewJob(classId, studentId, jobId);
      await refresh();
    } catch (err) {
      setError(err.message || "Could not leave");
    } finally {
      setBusyId(null);
    }
  }

  // Real hireable crews only (Team of 3 / Crew of 3+).
  const openJobs = jobs.filter(
    (j) =>
      j.status === "open" &&
      Number(j.slots) >= 3 &&
      Number(j.openSlots) > 0
  );
  const displayOpenJobs = openJobs;
  // Filled crews (waiting on review or already live) — show who joined.
  const filledJobs = jobs.filter(
    (j) =>
      Number(j.slots) >= 3 &&
      (j.status === "filled" ||
        j.status === "paid" ||
        (Number(j.openSlots) <= 0 && Number(j.slots) > 0))
  );

  function jobMeta(job) {
    const wage =
      job.payMode === "profit_share"
        ? `Profit share ${job.profitSharePct || 50}%`
        : `${money(job.wageEach)} wage each`;
    return `${wage} · sells for ${money(job.sellPrice)}`;
  }

  return (
    <div className="job-board">
      <div className="market-toolbar">
        <button type="button" className="ghost-btn" data-click="select" onClick={onBack}>
          ← Markets
        </button>
        <h3>Job board</h3>
        <button
          type="button"
          className={loading ? "job-board-refresh is-spinning" : "job-board-refresh"}
          data-click="select"
          disabled={loading}
          onClick={refresh}
          aria-label="Refresh job board"
          title="Refresh"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.1A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"
            />
          </svg>
        </button>
      </div>

      <p className="job-board-lead">
        Tap a <strong>+</strong> slot to join a Team of 3 or Crew of 3+. You can
        work on up to {maxJoins} jobs at once ({joinedCount}/{maxJoins} joined).
        You can’t join your own business.
      </p>

      {error ? <p className="closet-note closet-note-error">{error}</p> : null}

      {invites.length > 0 ? (
        <section className="job-board-section">
          <h4>Partnership invites</h4>
          <div className="job-board-list">
            {invites.map((job) => (
              <article key={job.id} className="job-board-card is-invite">
                <JobProductPreview job={job} />
                <div className="job-board-card-main">
                  <strong>{job.jobTitle || job.itemLabel}</strong>
                  <span>
                    from {job.creatorName}
                    {` · ${money(job.sellPrice)}`}
                  </span>
                  <p>
                    Profit share {job.profitSharePct || 50}% — accept to partner.
                  </p>
                </div>
                <div className="job-board-actions">
                  <button
                    type="button"
                    className="primary-btn"
                    data-click="confirm"
                    disabled={busyId === job.id || !studentId}
                    onClick={() => handleJoin(job.id)}
                  >
                    {busyId === job.id ? "…" : "Accept"}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    data-click="select"
                    disabled={busyId === job.id || !studentId}
                    onClick={() => handleDecline(job.id)}
                  >
                    Decline
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="job-board-section">
        <h4>Hiring now</h4>
        {loading && jobs.length === 0 && invites.length === 0 && displayOpenJobs.length === 0 ? (
          <p className="empty">Loading…</p>
        ) : displayOpenJobs.length === 0 ? (
          <p className="empty">No open Team of 3 / Crew of 3+ roles right now.</p>
        ) : (
          <div className="job-board-list">
            {displayOpenJobs.map((job) => {
              const isOwner = job.creatorId === studentId;
              const atCap = joinedCount >= maxJoins;
              const alreadyOn = (job.members || []).some(
                (m) => m.studentId === studentId
              );
              const canJoin =
                Boolean(studentId) &&
                !isOwner &&
                (alreadyOn || !atCap);
              const lockReason = isOwner
                ? "You can’t join your own business"
                : atCap && !alreadyOn
                  ? `Already on ${maxJoins} jobs — leave one first`
                  : "";
              return (
                <article key={job.id} className="job-board-card job-board-card-crew">
                  <div className="job-board-card-top">
                    <JobProductPreview job={job} />
                    <div className="job-board-card-main">
                      <strong>{job.itemLabel || job.jobTitle}</strong>
                      <span>
                        by {job.creatorName}
                        {` · ${job.slots} seats · ${jobMeta(job)}`}
                        {isOwner ? " · your project" : ""}
                      </span>
                    </div>
                  </div>
                  <CrewSlotRow
                    job={job}
                    studentId={studentId}
                    rosterById={rosterById}
                    busy={busyId === job.id}
                    canJoin={canJoin}
                    lockReason={lockReason}
                    onJoin={() => handleJoin(job.id)}
                    onLeave={() => handleLeave(job.id)}
                  />
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="job-board-section">
        <h4>Crews filled</h4>
        {filledJobs.length === 0 ? (
          <p className="empty">No filled crews yet.</p>
        ) : (
          <div className="job-board-list">
            {filledJobs.map((job) => {
              const isLive = job.status === "paid";
              return (
                <article
                  key={job.id}
                  className={
                    isLive
                      ? "job-board-card job-board-card-crew is-filled is-live"
                      : "job-board-card job-board-card-crew is-filled"
                  }
                >
                  <div className="job-board-card-top">
                    <JobProductPreview job={job} />
                    <div className="job-board-card-main">
                      <strong>{job.itemLabel || job.jobTitle}</strong>
                      <span>
                        by {job.creatorName}
                        {` · ${isLive ? "Approved · live" : "Filled · pending review"} · ${money(job.sellPrice)}`}
                      </span>
                    </div>
                  </div>
                  <CrewSlotRow
                    job={{ ...job, status: "filled", openSlots: 0 }}
                    studentId={studentId}
                    rosterById={rosterById}
                    busy={false}
                    canJoin={false}
                    onJoin={() => {}}
                    onLeave={() => {}}
                  />
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

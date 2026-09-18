import { useCallback, useEffect, useState } from "react";
import {
  declineCrewInvite,
  joinCrewJob,
  listCrewJobs,
} from "./api";

/**
 * PayPal-style overlay: partnership invites show when the student opens
 * the app (same pattern as cash transfer alerts).
 */
export default function PartnershipInviteAlert({
  classId,
  studentId = "",
  onResolved,
}) {
  const [invites, setInvites] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!classId || !studentId) {
      setInvites([]);
      return;
    }
    try {
      const data = await listCrewJobs(classId, studentId);
      setInvites(Array.isArray(data?.invites) ? data.invites : []);
    } catch {
      /* keep last known */
    }
  }, [classId, studentId]);

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 6000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const current = invites[0] || null;

  async function handleAccept() {
    if (!current?.id || !studentId || busy) return;
    setBusy(true);
    setError("");
    try {
      await joinCrewJob(classId, studentId, current.id);
      setInvites((prev) => prev.filter((i) => i.id !== current.id));
      onResolved?.({ action: "accept", invite: current });
      await refresh();
    } catch (err) {
      setError(err.message || "Could not accept");
    } finally {
      setBusy(false);
    }
  }

  async function handleDecline() {
    if (!current?.id || !studentId || busy) return;
    setBusy(true);
    setError("");
    try {
      await declineCrewInvite(classId, studentId, current.id);
      setInvites((prev) => prev.filter((i) => i.id !== current.id));
      onResolved?.({ action: "decline", invite: current });
      await refresh();
    } catch (err) {
      setError(err.message || "Could not decline");
    } finally {
      setBusy(false);
    }
  }

  if (!current) return null;

  const share = Number(current.profitSharePct) || 50;

  return (
    <div
      className="transfer-overlay partnership-invite-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="partnership-invite-title"
    >
      <div className="transfer-modal is-credit partnership-invite-modal">
        <p className="transfer-kicker">Partnership request</p>
        <h3 id="partnership-invite-title">Join as partner?</h3>
        <p className="transfer-amount partnership-invite-share">
          {share}/{100 - share}
        </p>
        <p className="transfer-note">
          <strong>{current.creatorName || "A classmate"}</strong> invited you to
          partner on
          {current.itemLabel && current.itemLabel !== "Partnership (item coming soon)"
            ? ` “${current.jobTitle || current.itemLabel}”`
            : " a new closet item"}
          . You’ll split profits {share}/{100 - share} if the teacher approves
          it.
        </p>
        {error ? <p className="transfer-error">{error}</p> : null}
        {invites.length > 1 ? (
          <p className="transfer-queue">
            {invites.length} partnership requests waiting
          </p>
        ) : null}
        <button
          type="button"
          className="primary-btn transfer-accept"
          data-click="confirm"
          disabled={busy}
          onClick={handleAccept}
        >
          {busy ? "Working…" : "Accept partnership"}
        </button>
        <button
          type="button"
          className="ghost-btn"
          data-click="select"
          disabled={busy}
          onClick={handleDecline}
          style={{ marginTop: "0.55rem", width: "100%" }}
        >
          Decline
        </button>
      </div>
    </div>
  );
}

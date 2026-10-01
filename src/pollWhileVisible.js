/**
 * Call `fn` on an interval only while the tab is visible.
 * Pauses in background tabs (saves API / Vercel Active CPU) and
 * runs once immediately when the user returns.
 */
export function pollWhileVisible(fn, ms) {
  let id = null;

  const clear = () => {
    if (id != null) {
      window.clearInterval(id);
      id = null;
    }
  };

  const start = () => {
    if (id != null || typeof document === "undefined") return;
    id = window.setInterval(() => {
      if (!document.hidden) fn();
    }, ms);
  };

  const onVisibility = () => {
    if (document.hidden) {
      clear();
      return;
    }
    fn();
    start();
  };

  if (typeof document === "undefined") {
    return () => {};
  }

  if (!document.hidden) start();
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    clear();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Shared intervals for background API refresh (ms). */
export const POLL = {
  homeJobs: 45_000,
  jobBoard: 30_000,
  peerLendOffers: 45_000,
  partnershipInvites: 30_000,
  lendingInterest: 120_000,
  headToHead: 60_000,
  closetAiJob: 4_000,
};

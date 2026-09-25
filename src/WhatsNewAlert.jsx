import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getClassStudent, markAnnouncementSeen } from "./classStore";

/**
 * One-time "what's new" announcements. Each feature has its own id so it shows
 * once per student; add a new entry here to announce the next feature.
 */
export const WHATS_NEW_FEATURES = [
  {
    id: "feature-lend-world-2026-09",
    kicker: "New · Lend to the World",
    title: "Lend money to countries",
    body: "Pick a government on the world map, lend at least $100, and collect interest every month.",
    detail: "Higher rates pay more — but riskier countries can miss a payment.",
    cta: "Open the world map",
    tone: "lend",
  },
  {
    id: "feature-create-item-2026-09",
    kicker: "New · Create an Item",
    title: "Design your own closet item",
    body: "Invent a closet item with the help of AI and a few employees from your class.",
    detail: "Team up with classmates, get teacher approval, and earn when others buy it.",
    cta: "Start creating",
    tone: "create",
  },
  {
    id: "feature-job-board-2026-09",
    kicker: "New · Job Board",
    title: "Join a crew on the Job Board",
    body: "See open roles your classmates posted and tap + to join a crew.",
    detail: "Partners split profits, employees get paid a wage.",
    cta: "View the Job Board",
    tone: "jobs",
  },
];

const LOCAL_KEY_PREFIX = "ledgerlab.seenAnnouncements";

function localKey(classId, studentId) {
  return `${LOCAL_KEY_PREFIX}:${classId || "noclass"}:${studentId}`;
}

function readLocalSeen(classId, studentId) {
  try {
    const raw = localStorage.getItem(localKey(classId, studentId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLocalSeen(classId, studentId, ids) {
  try {
    localStorage.setItem(localKey(classId, studentId), JSON.stringify(ids));
  } catch {
    /* private mode — Firestore still remembers */
  }
}

function forcePreview() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("whatsnew");
}

function FeatureIcon({ tone }) {
  if (tone === "lend") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="17" fill="#38bdf8" />
        <path
          d="M14 17c4 1 6-2 9 0s1 6 5 6 4 5 1 8-7 1-8 4M30 12c-1 3 2 4 4 5"
          fill="none"
          stroke="#16a34a"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <circle cx="24" cy="24" r="17" fill="none" stroke="#0f766e" strokeWidth="2.5" />
      </svg>
    );
  }
  if (tone === "create") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M16 10h16l6 8-5 3v17H15V21l-5-3z" fill="#f472b6" stroke="#be185d" strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx="35" cy="35" r="8" fill="#fff" stroke="#be185d" strokeWidth="2.5" />
        <path d="M35 31v8M31 35h8" stroke="#be185d" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <rect x="9" y="16" width="30" height="22" rx="4" fill="#fbbf24" stroke="#b45309" strokeWidth="2.5" />
      <path d="M19 16v-3a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3" fill="none" stroke="#b45309" strokeWidth="2.5" />
      <path d="M9 25h30" stroke="#b45309" strokeWidth="2.5" />
      <rect x="21" y="23" width="6" height="5" rx="1.5" fill="#fff" stroke="#b45309" strokeWidth="2" />
    </svg>
  );
}

export default function WhatsNewAlert({
  classId = "",
  studentId = "",
  hideFeatures = [],
  alwaysShow = false,
  onOpenFeature,
}) {
  const hideKey = hideFeatures.join(",");
  const preview = useMemo(() => alwaysShow || forcePreview(), [alwaysShow]);
  const [seen, setSeen] = useState(null);
  const [index, setIndex] = useState(0);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!studentId) {
      setSeen(null);
      return undefined;
    }
    if (preview) {
      setSeen([]);
      return undefined;
    }
    let cancelled = false;
    const local = readLocalSeen(classId, studentId);
    if (!classId) {
      setSeen(local);
      return undefined;
    }
    getClassStudent(classId, studentId)
      .then((seat) => {
        if (cancelled) return;
        const remote = Array.isArray(seat?.seenAnnouncements) ? seat.seenAnnouncements : [];
        setSeen([...new Set([...local, ...remote])]);
      })
      .catch(() => {
        if (!cancelled) setSeen(local);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, studentId, preview]);

  const queue = useMemo(
    () =>
      seen
        ? WHATS_NEW_FEATURES.filter(
            (f) => !seen.includes(f.id) && !hideKey.split(",").includes(f.tone)
          )
        : [],
    [seen, hideKey]
  );

  if (hidden || !studentId || !seen || queue.length === 0 || index >= queue.length) {
    return null;
  }

  const current = queue[index];
  const isLast = index === queue.length - 1;

  function markSeen(features) {
    const ids = [...new Set([...(seen || []), ...features.map((f) => f.id)])];
    if (!preview) {
      writeLocalSeen(classId, studentId, ids);
      if (classId) {
        features.forEach((f) => {
          markAnnouncementSeen(classId, studentId, f.id).catch(() => {});
        });
      }
    }
    return ids;
  }

  function handleNext() {
    if (isLast) {
      setSeen(markSeen(queue));
    } else {
      setIndex((i) => i + 1);
    }
  }

  function handleTry() {
    // Cards after this one stay unseen so they show on the next visit.
    markSeen(queue.slice(0, index + 1));
    setHidden(true);
    onOpenFeature?.(current.tone);
  }

  // Portal so a transformed ancestor panel can't trap the fixed overlay.
  return createPortal(
    <div
      className="transfer-overlay whats-new-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whats-new-title"
    >
      <div className={`transfer-modal whats-new-modal is-${current.tone}`} key={current.id}>
        <div className="whats-new-icon">
          <FeatureIcon tone={current.tone} />
        </div>
        <p className="transfer-kicker">{current.kicker}</p>
        <h3 id="whats-new-title">{current.title}</h3>
        <p className="transfer-note whats-new-body">{current.body}</p>
        <p className="whats-new-detail">{current.detail}</p>

        {queue.length > 1 ? (
          <div className="whats-new-dots" aria-label={`${index + 1} of ${queue.length}`}>
            {queue.map((f, i) => (
              <span key={f.id} className={i === index ? "is-active" : ""} />
            ))}
          </div>
        ) : null}

        <button
          type="button"
          className="primary-btn transfer-accept"
          data-click="confirm"
          onClick={handleTry}
        >
          {current.cta}
        </button>
        <button
          type="button"
          className="ghost-btn whats-new-next"
          data-click="select"
          onClick={handleNext}
        >
          {isLast ? "Got it" : `Next (${index + 1}/${queue.length})`}
        </button>
      </div>
    </div>,
    document.body
  );
}

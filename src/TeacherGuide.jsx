import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const STORAGE_KEY = "ledgerlab.teacherGuide.v1";

export const TEACHER_GUIDE_STEPS = [
  {
    id: "game",
    kicker: "The game",
    title: "Students grow play money until the contest ends",
    body: "Each student starts with classroom cash you choose. They buy and sell from the class market. Rankings use total value — cash plus everything they own. This is not a real brokerage.",
    detail: "You pick the end date when you create the class — it defaults to May 15. That’s the time horizon for almost every choice. Classmate loans are always due five days before.",
  },
  {
    id: "class",
    kicker: "Your first move",
    title: "Create a class",
    body: "Name the class, set starting cash, pick the contest end date (May 15 unless you change it), and turn markets on or off: stocks, ETFs, bonds, commodities, currencies, Florida homes, and lending.",
    detail: "You only see classes you created. Students join yours with a code — they never pick from a global list.",
    action: "create",
    cta: "Create a class",
  },
  {
    id: "invite",
    kicker: "Get them in",
    title: "Invite with a code or QR",
    body: "Open a class and tap Invite students. Share the join code or the QR poster. Students make an account, dress a blocky avatar, and land on their own dashboard.",
    detail: "Anyone with the code can join that class. Keep the code in the room or in your LMS.",
    action: "invite",
    cta: "Show invite tools",
  },
  {
    id: "students",
    kicker: "What they do",
    title: "Invest, lend, build, ask Ledger",
    body: "Tap a piece of the game to see how it works for students.",
    chips: [
      {
        id: "markets",
        label: "Markets",
        text: "Buy stocks, ETFs, bonds, commodities, and currencies at the listed classroom price.",
      },
      {
        id: "homes",
        label: "Homes",
        text: "Florida metros (like Miami) are typical home prices. About 20% down + closing is due in cash today; the rest is a classroom mortgage.",
      },
      {
        id: "lend",
        label: "Lending",
        text: "Lend to countries on a world map (monthly interest, some can miss a payment) or to classmates. Classmate loans are always due five days before the contest ends.",
      },
      {
        id: "create",
        label: "Create & jobs",
        text: "Students design closet items with AI and hire a crew. You approve before it goes live. Founder’s crown is earn-only after approval.",
      },
      {
        id: "ledger",
        label: "Ask Ledger",
        text: "A classroom advisor that can see their portfolio and the live market list. Practice advice only — it doesn’t place trades.",
      },
    ],
  },
  {
    id: "run",
    kicker: "Running class",
    title: "You watch the book",
    body: "Open a class to see how the group is invested, who has been logging in and trading, the live standings, and the roster. From there you can add or take cash, change markets, start a one-week head-to-head, or spin the prize wheel.",
    detail: "Usage ranks students by logins or trades. Standings rank total value. The student page is where they trade; this dashboard is where you coach.",
  },
  {
    id: "inbox",
    kicker: "You decide",
    title: "Approvals land in your inbox",
    body: "Students can request a ticker, submit a closet creation, or report a bug. You add stocks (they show for every class), approve items before they sell, and keep the simulation moving.",
    detail: "Nothing they invent goes live until you tap approve.",
  },
];

function storageKey(uid) {
  return `${STORAGE_KEY}:${uid || "teacher"}`;
}

export function hasSeenTeacherGuide(uid) {
  try {
    return localStorage.getItem(storageKey(uid)) === "1";
  } catch {
    return false;
  }
}

export function markTeacherGuideSeen(uid) {
  try {
    localStorage.setItem(storageKey(uid), "1");
  } catch {
    /* private mode */
  }
}

export function forceTeacherGuidePreview() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("teacherguide");
}

function StepArt({ id }) {
  if (id === "game") {
    return (
      <svg viewBox="0 0 88 64" aria-hidden="true">
        <rect x="6" y="18" width="34" height="36" rx="8" fill="#e8f6ee" stroke="#2f6b4f" strokeWidth="2.4" />
        <path d="M16 42h14M16 34h10" stroke="#2f6b4f" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="62" cy="28" r="16" fill="#fff" stroke="#2f6b4f" strokeWidth="2.4" />
        <path d="M54 28h16M62 20v16" stroke="#2f6b4f" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M48 52h28" stroke="#9fd4a8" strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === "class") {
    return (
      <svg viewBox="0 0 88 64" aria-hidden="true">
        <rect x="10" y="10" width="68" height="44" rx="10" fill="#fff" stroke="#2f6b4f" strokeWidth="2.4" />
        <path d="M22 24h28M22 34h44M22 44h18" stroke="#2f6b4f" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="66" cy="24" r="5" fill="#9fd4a8" stroke="#2f6b4f" strokeWidth="2" />
      </svg>
    );
  }
  if (id === "invite") {
    return (
      <svg viewBox="0 0 88 64" aria-hidden="true">
        <rect x="12" y="8" width="36" height="48" rx="6" fill="#fff" stroke="#2f6b4f" strokeWidth="2.4" />
        <rect x="18" y="14" width="8" height="8" fill="#2f6b4f" />
        <rect x="34" y="14" width="8" height="8" fill="#2f6b4f" />
        <rect x="18" y="30" width="8" height="8" fill="#2f6b4f" />
        <rect x="26" y="22" width="8" height="8" fill="#9fd4a8" />
        <rect x="34" y="30" width="8" height="8" fill="#2f6b4f" />
        <rect x="18" y="42" width="24" height="6" rx="2" fill="#e8f6ee" stroke="#2f6b4f" strokeWidth="1.6" />
        <rect x="56" y="20" width="22" height="14" rx="4" fill="#e8f6ee" stroke="#2f6b4f" strokeWidth="2.2" />
        <path d="M67 34v8M61 42h12" stroke="#2f6b4f" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === "students") {
    return (
      <svg viewBox="0 0 88 64" aria-hidden="true">
        <rect x="16" y="28" width="16" height="22" rx="4" fill="#c4b5a5" stroke="#5c4033" strokeWidth="2" />
        <rect x="18" y="14" width="12" height="12" rx="3" fill="#f2c9a0" stroke="#5c4033" strokeWidth="2" />
        <rect x="38" y="24" width="16" height="26" rx="4" fill="#7eb3d9" stroke="#24553e" strokeWidth="2" />
        <rect x="40" y="12" width="12" height="12" rx="3" fill="#f2c9a0" stroke="#5c4033" strokeWidth="2" />
        <rect x="60" y="30" width="16" height="20" rx="4" fill="#9fd4a8" stroke="#24553e" strokeWidth="2" />
        <rect x="62" y="18" width="12" height="12" rx="3" fill="#f2c9a0" stroke="#5c4033" strokeWidth="2" />
      </svg>
    );
  }
  if (id === "run") {
    return (
      <svg viewBox="0 0 88 64" aria-hidden="true">
        <path d="M12 48 L28 30 L44 38 L64 16 L76 24" fill="none" stroke="#2f6b4f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="28" cy="30" r="4" fill="#fff" stroke="#2f6b4f" strokeWidth="2" />
        <circle cx="64" cy="16" r="4" fill="#9fd4a8" stroke="#2f6b4f" strokeWidth="2" />
        <path d="M12 52h64" stroke="#d7ecdf" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 88 64" aria-hidden="true">
      <rect x="14" y="12" width="60" height="40" rx="10" fill="#fff7ed" stroke="#c0453a" strokeWidth="2.4" />
      <path d="M28 32h32M36 22v20M52 22v20" stroke="#c0453a" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="44" cy="32" r="6" fill="#9fd4a8" stroke="#2f6b4f" strokeWidth="2" />
    </svg>
  );
}

export function TeacherGuideTeaser({ onOpen }) {
  return (
    <button
      type="button"
      className="teacher-guide-teaser"
      data-click="select"
      onClick={() => onOpen?.(0)}
    >
      <div className="teacher-guide-teaser-art" aria-hidden="true">
        <StepArt id="game" />
      </div>
      <div className="teacher-guide-teaser-copy">
        <p className="teacher-guide-kicker">How it works</p>
        <strong>A 60-second tour of Ledger Lab</strong>
        <span>The game, how students join, and what you do from this dashboard.</span>
      </div>
      <span className="teacher-guide-teaser-go" aria-hidden="true">
        Open →
      </span>
    </button>
  );
}

export default function TeacherGuide({
  open,
  teacherUid = "",
  hasClass = false,
  startAt = 0,
  onClose,
  onAction,
}) {
  const [index, setIndex] = useState(0);
  const [peek, setPeek] = useState(null);
  const steps = TEACHER_GUIDE_STEPS;
  const step = steps[index] || steps[0];
  const isLast = index === steps.length - 1;
  const chips = step.chips || [];
  const activeChip = chips.find((c) => c.id === peek) || chips[0] || null;

  useEffect(() => {
    if (!open) return undefined;
    setIndex(Math.max(0, Math.min(startAt, steps.length - 1)));
    setPeek(null);
    return undefined;
  }, [open, startAt, steps.length]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // finish/goNext/goPrev are stable enough for this overlay
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  function finish() {
    if (!forceTeacherGuidePreview()) markTeacherGuideSeen(teacherUid);
    onClose?.();
  }

  function goNext() {
    if (isLast) finish();
    else {
      setPeek(null);
      setIndex((i) => i + 1);
    }
  }

  function goPrev() {
    if (index === 0) return;
    setPeek(null);
    setIndex((i) => i - 1);
  }

  function handleAction() {
    if (!forceTeacherGuidePreview()) markTeacherGuideSeen(teacherUid);
    onAction?.(step.action);
  }

  if (!open) return null;

  const actionLabel =
    step.action === "invite" && !hasClass ? "Create a class first" : step.cta;

  return createPortal(
    <div
      className="transfer-overlay teacher-guide-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="teacher-guide-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) finish();
      }}
    >
      <div className="teacher-guide-modal">
        <nav className="teacher-guide-rail" aria-label="Guide steps">
          {steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={
                i === index
                  ? "teacher-guide-rail-btn is-active"
                  : i < index
                    ? "teacher-guide-rail-btn is-done"
                    : "teacher-guide-rail-btn"
              }
              data-click="select"
              onClick={() => {
                setPeek(null);
                setIndex(i);
              }}
            >
              <span className="teacher-guide-num">{i + 1}</span>
              <span>{s.kicker}</span>
            </button>
          ))}
        </nav>

        <div className="teacher-guide-main" key={step.id}>
          <div className="teacher-guide-art">
            <StepArt id={step.id} />
          </div>
          <p className="teacher-guide-kicker">{step.kicker}</p>
          <h3 id="teacher-guide-title">{step.title}</h3>
          <p className="teacher-guide-body">{step.body}</p>

          {chips.length > 0 ? (
            <>
              <div className="teacher-guide-chips" role="tablist" aria-label="Parts of the game">
                {chips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    role="tab"
                    aria-selected={activeChip?.id === chip.id}
                    className={
                      activeChip?.id === chip.id
                        ? "teacher-guide-chip is-active"
                        : "teacher-guide-chip"
                    }
                    data-click="select"
                    onClick={() => setPeek(chip.id)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              {activeChip ? (
                <p className="teacher-guide-detail">{activeChip.text}</p>
              ) : null}
            </>
          ) : step.detail ? (
            <p className="teacher-guide-detail">{step.detail}</p>
          ) : null}

          <div className="teacher-guide-dots" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.id} className={i === index ? "is-active" : ""} />
            ))}
          </div>

          <div className="teacher-guide-actions">
            <button
              type="button"
              className="ghost-btn"
              data-click="select"
              onClick={index === 0 ? finish : goPrev}
            >
              {index === 0 ? "Skip" : "Back"}
            </button>
            {step.action ? (
              <button
                type="button"
                className="ghost-btn"
                data-click="select"
                onClick={handleAction}
              >
                {actionLabel}
              </button>
            ) : null}
            <button
              type="button"
              className="primary-btn"
              data-click="confirm"
              onClick={goNext}
            >
              {isLast ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

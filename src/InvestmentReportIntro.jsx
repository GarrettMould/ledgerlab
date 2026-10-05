import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getClassStudent, markAnnouncementSeen } from "./classStore";
import { analyzePortfolio } from "./portfolioReport";
import { ResultSlide } from "./InvestmentReport";
import { outfitForStudent } from "./StudentCharacter";
import { WHATS_NEW_FEATURES } from "./WhatsNewAlert";

/** One-time intro for the investment report — every existing and new student sees it once. */
export const REPORT_INTRO_ID = "feature-investment-report-2026-10";

const LOCAL_KEY_PREFIX = "ledgerlab.seenAnnouncements";

/** Sample portfolio shaped like a real cautious-saver report (not the signed-in student). */
const DEMO_STUDENT = {
  name: "Jordan Lee",
  cash: 65655.12,
  holdings: [
    {
      ticker: "JPM",
      shares: 45,
      avg_cost: 165,
      price: 198.5,
      market_value: 8932.5,
      cost_basis: 7425,
      gain_loss: 1507.5,
      gain_loss_pct: 20.3,
    },
    {
      ticker: "V",
      shares: 18,
      avg_cost: 240,
      price: 285,
      market_value: 5130,
      cost_basis: 4320,
      gain_loss: 810,
      gain_loss_pct: 18.8,
    },
    {
      ticker: "KO",
      shares: 20,
      avg_cost: 60,
      price: 67.51,
      market_value: 1350.28,
      cost_basis: 1200,
      gain_loss: 150.28,
      gain_loss_pct: 12.5,
    },
  ],
};

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
  return new URLSearchParams(window.location.search).has("reportintro");
}

/**
 * Two-slide intro: where to find the report, then a sample style card.
 * "See My Investment Report" only shows when the student already has investments.
 */
export default function InvestmentReportIntro({
  classId = "",
  studentId = "",
  hasInvestments = false,
  hideWhatsNew = [],
  waitForWhatsNew = true,
  onOpenReport,
}) {
  const preview = forcePreview();
  const [seen, setSeen] = useState(null);
  const [slide, setSlide] = useState(0);
  const [hidden, setHidden] = useState(false);
  const hideKey = hideWhatsNew.join(",");

  const demoOutfit = useMemo(
    () => outfitForStudent("report-intro-demo", DEMO_STUDENT.name),
    []
  );
  const demoReport = useMemo(
    () => analyzePortfolio({ portfolio: DEMO_STUDENT }),
    []
  );
  const demoFirstName = DEMO_STUDENT.name.split(" ")[0];

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
        const remote = Array.isArray(seat?.seenAnnouncements)
          ? seat.seenAnnouncements
          : [];
        setSeen([...new Set([...local, ...remote])]);
      })
      .catch(() => {
        if (!cancelled) setSeen(local);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, studentId, preview]);

  const whatsNewPending = useMemo(() => {
    if (!seen || preview || !waitForWhatsNew) return false;
    const hiddenTones = new Set(hideKey ? hideKey.split(",") : []);
    return WHATS_NEW_FEATURES.some(
      (f) => !seen.includes(f.id) && !hiddenTones.has(f.tone)
    );
  }, [seen, preview, waitForWhatsNew, hideKey]);

  const shouldShow =
    !hidden &&
    studentId &&
    seen &&
    !seen.includes(REPORT_INTRO_ID) &&
    !whatsNewPending;

  function markSeen() {
    const ids = [...new Set([...(seen || []), REPORT_INTRO_ID])];
    if (!preview) {
      writeLocalSeen(classId, studentId, ids);
      if (classId) {
        markAnnouncementSeen(classId, studentId, REPORT_INTRO_ID).catch(() => {});
      }
    }
    setSeen(ids);
    setHidden(true);
  }

  function handleOpenReport() {
    markSeen();
    onOpenReport?.();
  }

  if (!shouldShow) return null;

  return createPortal(
    <div
      className="transfer-overlay report-intro-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-intro-title"
    >
      <div
        className={`transfer-modal report-intro-modal${slide === 1 ? " is-result" : ""}`}
      >
        <p className="transfer-kicker">New · Investment report</p>
        <h3 id="report-intro-title">
          {slide === 0 ? "See your investment report" : "See your investing style"}
        </h3>

        {slide === 0 ? (
          <div className="report-intro-slide">
            <p className="transfer-note">
              On your dashboard, open{" "}
              <strong>My investment report</strong> next to Your holdings.
            </p>
            <div className="report-intro-spot" aria-hidden="true">
              <div className="report-intro-spot-copy">
                <strong>Your holdings</strong>
                <span>Tap a holding, then Sell or Sell all</span>
              </div>
              <span className="report-intro-spot-btn">
                <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
                  <path
                    d="M3 17h14M5.5 14V9M10 14V5M14.5 14v-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                My investment report
              </span>
              <span className="report-intro-spot-tag">Here</span>
            </div>
          </div>
        ) : (
          <div className="report-intro-slide">
            <p className="transfer-note">
              Your report shows how you’re weighted, your risk level, and which
              investing style you’re closest to — like this sample.
            </p>
            <div className="report-intro-result-wrap" aria-hidden="true">
              <span className="report-intro-sample-badge">Sample</span>
              <ResultSlide
                report={demoReport}
                outfit={demoOutfit}
                firstName={demoFirstName}
                className="report-intro-result"
              />
            </div>
          </div>
        )}

        <div className="report-intro-dots" aria-label={`Step ${slide + 1} of 2`}>
          <span className={slide === 0 ? "is-active" : ""} />
          <span className={slide === 1 ? "is-active" : ""} />
        </div>

        {slide === 0 ? (
          <button
            type="button"
            className="primary-btn transfer-accept"
            data-click="confirm"
            onClick={() => setSlide(1)}
          >
            Next
          </button>
        ) : (
          <>
            {hasInvestments ? (
              <button
                type="button"
                className="primary-btn transfer-accept report-intro-cta"
                data-click="confirm"
                onClick={handleOpenReport}
              >
                See My Investment Report
              </button>
            ) : null}
            <button
              type="button"
              className={hasInvestments ? "ghost-btn whats-new-next" : "primary-btn transfer-accept"}
              data-click="select"
              onClick={markSeen}
            >
              {hasInvestments ? "Got it" : "Got it — I’ll check after I invest"}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

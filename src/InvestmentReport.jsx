import { Suspense, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  analyzePortfolio,
  CLASS_COLORS,
  CLASS_LABELS,
  estimateOutcomes,
  MODEL_STYLES,
  riskLabel,
} from "./portfolioReport";
import { AvatarCanvas } from "./StudentCharacter";

const SLIDES = ["Your result", "Your mix", "How you compare"];

const COMPARE_PARTS = [
  { key: "stocks", label: "Stocks & ETFs", color: CLASS_COLORS.stocks },
  { key: "bonds", label: "Bonds & loans", color: CLASS_COLORS.bonds },
  { key: "cash", label: "Cash", color: CLASS_COLORS.cash },
  { key: "other", label: "Other", color: CLASS_COLORS.commodities },
  { key: "crypto", label: "Crypto", color: CLASS_COLORS.realestate },
];

function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function riskTone(score) {
  if (score < 4) return "low";
  if (score < 5.5) return "mid";
  if (score < 7) return "high";
  return "very-high";
}

function RiskChip({ score }) {
  return (
    <span
      className={`report-risk-chip is-${riskTone(score)}`}
      title="How much this investment’s price usually swings up and down"
    >
      {riskLabel(score)} risk
    </span>
  );
}

function RiskMeter({ score }) {
  return (
    <span className="report-risk-meter" aria-label={`Risk ${score.toFixed(1)} of 10`}>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < Math.round(score) ? `is-on is-${riskTone(score)}` : ""} />
      ))}
    </span>
  );
}

function MixBar({ parts }) {
  return (
    <span className="report-compare-mix" aria-hidden="true">
      {COMPARE_PARTS.filter((p) => parts[p.key] > 0).map((p) => (
        <i key={p.key} style={{ width: `${parts[p.key]}%`, background: p.color }} />
      ))}
    </span>
  );
}

function studentCompareParts(mix) {
  const byKey = Object.fromEntries(mix.map((m) => [m.key, m.pct]));
  return {
    stocks: (byKey.stocks || 0) + (byKey.etfs || 0),
    bonds: (byKey.bonds || 0) + (byKey.lending || 0),
    cash: byKey.cash || 0,
    other: (byKey.commodities || 0) + (byKey.currencies || 0) + (byKey.realestate || 0),
  };
}

export function ResultSlide({ report, outfit, firstName, className = "" }) {
  return (
    <div className={`report-slide report-result ${className}`.trim()}>
      <div className="report-result-avatar" aria-hidden="true">
        <Suspense fallback={<span className="busy-spinner" />}>
          <AvatarCanvas outfit={outfit} mode="report" className="report-result-stage" />
        </Suspense>
      </div>
      <div className="report-result-copy">
        <span className="report-label">
          {firstName ? `${firstName}, you’re a` : "You’re a"}
        </span>
        <strong className="report-result-style">{report.style.name}</strong>
        <p>{report.style.summary}</p>
        {report.traits.length > 0 ? (
          <div className="report-traits">
            {report.traits.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        ) : null}
        <div className={`report-score is-${riskTone(report.riskScore)}`}>
          <div>
            <span className="report-label">Risk level</span>
            <strong>{report.riskScore.toFixed(1)}</strong>
            <em>out of 10 · {report.riskLabel}</em>
          </div>
          <RiskMeter score={report.riskScore} />
        </div>
        <dl className="report-result-stats">
          <div>
            <dt>Total</dt>
            <dd>{money(report.total)}</dd>
          </div>
          <div>
            <dt>Invested</dt>
            <dd>{money(report.invested)}</dd>
          </div>
          <div>
            <dt>Cash</dt>
            <dd>{money(report.cash)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function Donut({ mix, total }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="report-donut">
      <svg viewBox="0 0 140 140" aria-hidden="true">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#edf2ef" strokeWidth="22" />
        {mix.map((m) => {
          const len = (m.pct / 100) * c;
          const seg = (
            <circle
              key={m.key}
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={CLASS_COLORS[m.key]}
              strokeWidth="22"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            />
          );
          offset += len;
          return seg;
        })}
      </svg>
      <div className="report-donut-center">
        <span>Total</span>
        <strong>{money(total).replace(/\.\d\d$/, "")}</strong>
      </div>
    </div>
  );
}

function spreadVerdict(top3Pct, count) {
  if (count <= 2 || top3Pct >= 85) return { label: "Very concentrated", tone: "very-high" };
  if (top3Pct >= 65) return { label: "Concentrated", tone: "high" };
  if (top3Pct >= 45) return { label: "Somewhat spread out", tone: "mid" };
  return { label: "Well spread out", tone: "low" };
}

function MixSlide({ report }) {
  const topPositions = report.positions.slice(0, 5);
  const biggestClass = report.mix[0];
  const top = report.positions[0];
  const verdict = spreadVerdict(report.top3Pct, report.positions.length);
  return (
    <div className="report-slide report-mix-slide">
      <section className="report-card">
        <header className="report-card-head">
          <span className="report-card-num">1</span>
          <div>
            <h3>Where your money is</h3>
            <p>Every dollar you have, sorted by type.</p>
          </div>
        </header>
        <div className="report-where">
          <Donut mix={report.mix} total={report.total} />
          <ul className="report-where-list">
            {report.mix.map((m) => (
              <li key={m.key}>
                <i style={{ background: CLASS_COLORS[m.key] }} aria-hidden="true" />
                <span>{m.label}</span>
                <strong>{Math.round(m.pct)}%</strong>
              </li>
            ))}
          </ul>
        </div>
        {biggestClass ? (
          <p className="report-plain">
            Out of every <b>$100</b> you have, <b>${Math.round(biggestClass.pct)}</b> is in{" "}
            {biggestClass.label.toLowerCase()}.
          </p>
        ) : null}
      </section>

      <section className="report-card">
        <header className="report-card-head">
          <span className="report-card-num">2</span>
          <div>
            <h3>Your biggest bets</h3>
            <p>The investments holding most of your money.</p>
          </div>
        </header>
        {topPositions.length > 0 ? (
          <>
            <ol className="report-bets">
              {topPositions.map((p, i) => (
                <li key={p.ticker}>
                  <span className="report-bet-rank">{i + 1}</span>
                  <div className="report-bet-main">
                    <div className="report-bet-top">
                      <strong>{p.name}</strong>
                      <span className="report-bet-pct">{Math.round(p.pctOfInvested)}%</span>
                    </div>
                    <div className="report-bet-bar" aria-hidden="true">
                      <span
                        style={{
                          width: `${Math.max(3, p.pctOfInvested)}%`,
                          background: CLASS_COLORS[p.cls],
                        }}
                      />
                    </div>
                    <div className="report-bet-meta">
                      <span>
                        {CLASS_LABELS[p.cls]}
                        {p.sector ? ` · ${p.sector}` : ""} · {money(p.value)}
                      </span>
                      <RiskChip score={p.risk} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <p className="report-risk-key">
              <b>Risk</b> tells you how much an investment’s price usually swings. Low risk
              moves slowly. Very high risk can jump or crash a lot in a single week.
            </p>
            <div className={`report-spread is-${verdict.tone}`}>
              <strong>{verdict.label}</strong>
              <p>
                {top ? (
                  <>
                    <b>{top.name}</b> alone is {Math.round(top.pctOfInvested)}% of what you’ve
                    invested. Your top 3 add up to {Math.round(report.top3Pct)}%.
                  </>
                ) : null}
              </p>
            </div>
          </>
        ) : (
          <p className="report-plain">
            You haven’t bought anything yet, so all of your money is still cash.
          </p>
        )}
      </section>
    </div>
  );
}

function mixText(parts) {
  const names = { stocks: "stocks", bonds: "bonds", cash: "cash", other: "other", crypto: "crypto" };
  return COMPARE_PARTS.filter((p) => parts[p.key] >= 1)
    .map((p) => `${Math.round(parts[p.key])}% ${names[p.key]}`)
    .join(" · ");
}

function dollars(n) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function OutcomeBoxes({ drop, avg }) {
  const bad = 1000 * (1 - drop / 100);
  const good = avg == null ? null : 1000 * (1 + avg / 100);
  return (
    <div className="report-outcomes">
      <div className="report-outcome is-bad">
        <span>In a really bad year</span>
        <strong>
          $1,000 → {dollars(bad)}
        </strong>
        <em>{drop < 0.5 ? "No drop" : `Lose about ${dollars(1000 - bad)}`}</em>
      </div>
      <div className="report-outcome is-good">
        <span>In a normal year</span>
        <strong>{good == null ? "Anyone’s guess" : `$1,000 → ${dollars(good)}`}</strong>
        <em>
          {good == null
            ? "Could soar or crash"
            : good - 1000 < 0.5
              ? "No growth"
              : `Gain about ${dollars(good - 1000)}`}
        </em>
      </div>
    </div>
  );
}

function CompareSlide({ report }) {
  const hasInvested = report.invested > 0;
  const youParts = studentCompareParts(report.mix);
  const youOutcome = estimateOutcomes(report.riskScore);
  const nearestId = report.nearest?.id || MODEL_STYLES[0].id;

  return (
    <div className="report-slide report-compare-slide">
      <div className="report-compare-intro">
        <strong>Investing styles sit on a risk spectrum.</strong>
        <p>
          Safer styles protect more in a crash. Riskier styles usually grow more in a
          normal year — and can lose a lot more in a really bad one.
        </p>
      </div>

      <article className="report-style-tile is-student">
        <header>
          <div>
            <span className="report-label">Your portfolio</span>
            <strong>{report.style.name}</strong>
          </div>
          <div className="report-style-risk">
            <span>Risk</span>
            <RiskMeter score={report.riskScore} />
          </div>
        </header>
        <div className="report-style-inside">
          <span>What’s inside</span>
          <MixBar parts={hasInvested ? youParts : { cash: 100 }} />
          <em>{hasInvested ? mixText(youParts) : "100% cash"}</em>
        </div>
        <OutcomeBoxes drop={youOutcome.drop} avg={youOutcome.avg} />
      </article>

      <div className="report-spectrum-legend" aria-hidden="true">
        <span>Safer</span>
        <span className="report-spectrum-legend-line" />
        <span>Riskier</span>
      </div>

      <ol className="report-spectrum-timeline">
        {MODEL_STYLES.map((s, i) => {
          const isYou = hasInvested && s.id === nearestId;
          return (
            <li
              key={s.id}
              className={[
                "report-spectrum-step",
                `is-tone-${i}`,
                isYou ? "is-you" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="report-spectrum-axis" aria-hidden="true">
                <span className="report-spectrum-node" />
              </div>
              <article className={isYou ? "report-style-tile is-you" : "report-style-tile"}>
                <header>
                  <div>
                    <strong>
                      {s.name}
                      {isYou ? <span className="report-you-tag">Most like you</span> : null}
                    </strong>
                    <p>
                      <b>Good for:</b> {s.who.charAt(0).toLowerCase() + s.who.slice(1)}
                    </p>
                  </div>
                  <div className="report-style-risk">
                    <span>Risk</span>
                    <RiskMeter score={s.risk} />
                  </div>
                </header>
                <div className="report-style-inside">
                  <span>What’s inside</span>
                  <MixBar parts={s.parts} />
                  <em>{s.mix}</em>
                </div>
                <OutcomeBoxes drop={s.drop} avg={s.avg} />
              </article>
            </li>
          );
        })}
      </ol>

      <p className="report-footnote">
        “Really bad year” is roughly the worst single year in US market history for that mix
        (like 2008). “Normal year” is the long-run average. Real results will be different.
      </p>
    </div>
  );
}

export default function InvestmentReport({
  open,
  onClose,
  studentName,
  outfit,
  portfolio,
  countryLoans,
  peerLent,
  peerBorrowed,
}) {
  const [slide, setSlide] = useState(0);
  const report = useMemo(
    () =>
      open
        ? analyzePortfolio({ portfolio, countryLoans, peerLent, peerBorrowed })
        : null,
    [open, portfolio, countryLoans, peerLent, peerBorrowed]
  );

  useEffect(() => {
    if (open) setSlide(0);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setSlide((s) => Math.min(SLIDES.length - 1, s + 1));
      if (e.key === "ArrowLeft") setSlide((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !report) return null;

  const firstName = String(studentName || "").trim().split(" ")[0];
  const last = slide === SLIDES.length - 1;

  return createPortal(
    <div className="confirm-overlay" role="presentation" onClick={onClose}>
      <div
        className="report-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="report-head">
          <div>
            <p className="report-kicker">
              Investment report · {slide + 1} of {SLIDES.length}
            </p>
            <h2 id="report-title">{SLIDES[slide]}</h2>
          </div>
          <button
            type="button"
            className="teacher-inbox-close"
            data-click="select"
            aria-label="Close report"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="report-body" key={slide}>
          {slide === 0 ? (
            <ResultSlide report={report} outfit={outfit} firstName={firstName} />
          ) : slide === 1 ? (
            <MixSlide report={report} />
          ) : (
            <CompareSlide report={report} />
          )}
        </div>

        <footer className="report-foot">
          <button
            type="button"
            className="ghost-btn"
            data-click="select"
            disabled={slide === 0}
            onClick={() => setSlide((s) => s - 1)}
          >
            ← Back
          </button>
          <div className="report-dots" role="tablist" aria-label="Report slides">
            {SLIDES.map((title, i) => (
              <button
                key={title}
                type="button"
                role="tab"
                aria-selected={i === slide}
                aria-label={title}
                className={i === slide ? "is-active" : ""}
                onClick={() => setSlide(i)}
              />
            ))}
          </div>
          <button
            type="button"
            className="primary-btn"
            data-click={last ? "confirm" : "select"}
            onClick={() => (last ? onClose() : setSlide((s) => s + 1))}
          >
            {last ? "Done" : "Next →"}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

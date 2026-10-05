import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  HISTORY_QUIZ_STYLES,
  dollarsFromReturn,
  formatReturnPct,
  pickHistoryQuizScenario,
  styleById,
} from "./historyQuizScenarios";

const START_DOLLARS = 1000;

export function HistoryQuizFab({ onClick }) {
  return (
    <button
      type="button"
      className="hist-quiz-fab"
      data-click="select"
      aria-label="Open market history quiz"
      title="History quiz"
      onClick={onClick}
    >
      <svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true">
        <circle cx="24" cy="24" r="20" fill="currentColor" opacity="0.16" />
        <path
          d="M14 30c4-8 7-12 10-12s6 4 10 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <path
          d="M16 18h4M28 14h6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle cx="18" cy="18" r="2.2" fill="currentColor" />
        <circle cx="31" cy="14" r="2.2" fill="currentColor" />
        <path
          d="M12 34h24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.7"
        />
      </svg>
    </button>
  );
}

function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatTick(dateStr) {
  if (!dateStr) return "";
  const [y, m] = String(dateStr).split("-");
  if (!y) return dateStr;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = Math.max(0, Math.min(11, Number(m) - 1));
  return `${months[mi]} ${String(y).slice(2)}`;
}

function QuizChart({ scenario }) {
  const points = scenario.chart?.points || [];
  const up = (points.at(-1)?.value ?? 0) >= (points[0]?.value ?? 0);
  const stroke = up ? "#2f6b4f" : "#c0453a";
  const gradId = `hist-quiz-${scenario.id}`;

  if (!points.length) return null;

  return (
    <div className="hist-quiz-chart">
      <div className="hist-quiz-chart-head">
        <div>
          <strong>
            {scenario.chart.name}
            {scenario.chart.ticker ? ` · ${scenario.chart.ticker}` : ""}
          </strong>
          <p>
            $1,000 invested at the start → {money(points.at(-1)?.value)} by the end
          </p>
        </div>
        <span className="hist-quiz-chart-tag">{scenario.eventName}</span>
      </div>
      <div className="hist-quiz-chart-frame">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={points} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tickFormatter={formatTick}
              minTickGap={28}
              tick={{ fill: "#5a6b78", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={["auto", "auto"]}
              width={52}
              tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
              tick={{ fill: "#5a6b78", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value) => [money(value), "If you’d held"]}
              labelFormatter={(label) => formatTick(label)}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid rgba(20,33,43,0.12)",
                background: "rgba(255,255,255,0.96)",
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={stroke}
              strokeWidth={2.5}
              fill={`url(#${gradId})`}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="hist-quiz-chart-note">
        Hover the line to explore prices across {scenario.windowLabel}. Simplified for class —
        not a live market feed.
      </p>
    </div>
  );
}

export default function HistoryQuizModal({ open, onClose }) {
  const [scenario, setScenario] = useState(() => pickHistoryQuizScenario());
  const [choice, setChoice] = useState("");
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setScenario(pickHistoryQuizScenario());
    setChoice("");
    setRevealed(false);
  }, [open]);

  const ranked = useMemo(() => {
    if (!scenario) return [];
    return HISTORY_QUIZ_STYLES.map((s) => ({
      ...s,
      pct: scenario.returns[s.id],
      end: dollarsFromReturn(START_DOLLARS, scenario.returns[s.id]),
    })).sort((a, b) => b.pct - a.pct);
  }, [scenario]);

  if (!open || !scenario) return null;

  const correct = styleById(scenario.answer);
  const picked = choice ? styleById(choice) : null;
  const isCorrect = choice === scenario.answer;

  function resetWith(next) {
    setScenario(next);
    setChoice("");
    setRevealed(false);
  }

  function handleGuess(id) {
    if (revealed) return;
    setChoice(id);
    setRevealed(true);
  }

  function handleAnother() {
    resetWith(pickHistoryQuizScenario(scenario.id));
  }

  return createPortal(
    <div className="confirm-overlay hist-quiz-overlay" role="presentation" onClick={onClose}>
      <div
        className="hist-quiz-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hist-quiz-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="hist-quiz-head">
          <div>
            <p className="hist-quiz-kicker">History quiz · Time machine</p>
            <h2 id="hist-quiz-title">
              {revealed ? scenario.eventName : `You’re in ${scenario.eraLabel}`}
            </h2>
          </div>
          <button
            type="button"
            className="teacher-inbox-close"
            data-click="select"
            aria-label="Close quiz"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="hist-quiz-body">
          {!revealed ? (
            <>
              <p className="hist-quiz-hook">{scenario.hook}</p>
              <p className="hist-quiz-question">
                <strong>{scenario.windowLabel}:</strong> {scenario.question}
              </p>
              <p className="hist-quiz-prompt">
                Imagine you invest $1,000 using one classic style. Which style wins?
              </p>
              <div className="hist-quiz-choices" role="group" aria-label="Investing styles">
                {HISTORY_QUIZ_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="hist-quiz-choice"
                    data-click="select"
                    onClick={() => handleGuess(s.id)}
                  >
                    <strong>{s.name}</strong>
                    <span>{s.blurb}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div
                className={`hist-quiz-verdict ${isCorrect ? "is-correct" : "is-wrong"}`}
                role="status"
              >
                <strong>
                  {isCorrect
                    ? `Nice — ${correct.name} was the winner.`
                    : `Not quite — you picked ${picked?.name}.`}
                </strong>
                <p>
                  Best style for {scenario.windowLabel}: <b>{correct.name}</b>. A $1,000{" "}
                  {correct.name.toLowerCase()} portfolio finished around{" "}
                  <b>{money(dollarsFromReturn(START_DOLLARS, scenario.returns[scenario.answer]))}</b>{" "}
                  ({formatReturnPct(scenario.returns[scenario.answer])}).
                </p>
              </div>

              <QuizChart scenario={scenario} />

              <div className="hist-quiz-returns">
                <h3>If you’d put $1,000 into each style</h3>
                <ol>
                  {ranked.map((s, i) => (
                    <li
                      key={s.id}
                      className={[
                        s.id === scenario.answer ? "is-answer" : "",
                        s.id === choice ? "is-picked" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <span className="hist-quiz-rank">{i + 1}</span>
                      <div>
                        <strong>
                          {s.name}
                          {s.id === scenario.answer ? (
                            <em className="hist-quiz-pill">Winner</em>
                          ) : null}
                          {s.id === choice && s.id !== scenario.answer ? (
                            <em className="hist-quiz-pill is-muted">Your pick</em>
                          ) : null}
                        </strong>
                        <span>
                          {money(START_DOLLARS)} → {money(s.end)}
                        </span>
                      </div>
                      <b className={s.pct >= 0 ? "is-up" : "is-down"}>
                        {formatReturnPct(s.pct)}
                      </b>
                    </li>
                  ))}
                </ol>
              </div>

              <p className="hist-quiz-lesson">{scenario.lesson}</p>
            </>
          )}
        </div>

        <footer className="hist-quiz-foot">
          {revealed ? (
            <>
              <button
                type="button"
                className="ghost-btn"
                data-click="select"
                onClick={onClose}
              >
                Done
              </button>
              <button
                type="button"
                className="primary-btn"
                data-click="confirm"
                onClick={handleAnother}
              >
                Try another year
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ghost-btn"
              data-click="select"
              onClick={onClose}
            >
              Maybe later
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body
  );
}

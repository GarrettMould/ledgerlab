import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SEGMENTS = [
  { amount: 5000, label: "$5,000", color: "#24553e" },
  { amount: 2000, label: "$2,000", color: "#3f8f68" },
  { amount: 1000, label: "$1,000", color: "#c4a035" },
  { amount: 500, label: "$500", color: "#4a90a4" },
  { amount: 100, label: "$100", color: "#a0455c" },
];

const SLICE = 360 / SEGMENTS.length;

function money(n) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function prizeAtRotation(deg) {
  const normalized = ((deg % 360) + 360) % 360;
  // Pointer is fixed at top; map wheel rotation back to a slice index.
  const local = (360 - normalized) % 360;
  return SEGMENTS[Math.floor(local / SLICE) % SEGMENTS.length];
}

function wheelBackground() {
  const stops = SEGMENTS.map((seg, i) => {
    const start = i * SLICE;
    const end = (i + 1) * SLICE;
    return `${seg.color} ${start}deg ${end}deg`;
  });
  return `conic-gradient(from -90deg, ${stops.join(", ")})`;
}

export function SpinWheelFab({ onClick }) {
  return (
    <button
      type="button"
      className="spin-wheel-fab"
      data-click="select"
      aria-label="Open cash spin wheel"
      title="Spin wheel"
      onClick={onClick}
    >
      <svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true">
        <circle cx="24" cy="24" r="20" fill="currentColor" opacity="0.18" />
        <circle
          cx="24"
          cy="24"
          r="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <path
          d="M24 6 L24 24 L38.5 16.5 Z"
          fill="currentColor"
          opacity="0.95"
        />
        <path
          d="M24 24 L38.5 31.5 L24 42 Z"
          fill="currentColor"
          opacity="0.7"
        />
        <path
          d="M24 24 L9.5 31.5 L9.5 16.5 Z"
          fill="currentColor"
          opacity="0.55"
        />
        <circle cx="24" cy="24" r="4.5" fill="#fff" />
        <circle cx="24" cy="24" r="2.2" fill="currentColor" />
      </svg>
    </button>
  );
}

export default function SpinWheelModal({
  open,
  onClose,
  students = [],
  onAward,
}) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [awardNote, setAwardNote] = useState("");
  const [awardingId, setAwardingId] = useState("");
  const spinTimeout = useRef(null);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setAwardNote("");
      setAwardingId("");
      setSpinning(false);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (spinTimeout.current) clearTimeout(spinTimeout.current);
    };
  }, []);

  const roster = useMemo(
    () =>
      [...students].sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""))
      ),
    [students]
  );

  function handleSpin() {
    if (spinning) return;
    setResult(null);
    setAwardNote("");
    setAwardingId("");
    setSpinning(true);

    const extraTurns = 5 + Math.floor(Math.random() * 4);
    const landing = Math.random() * 360;
    const next = rotation + extraTurns * 360 + landing;
    setRotation(next);

    spinTimeout.current = setTimeout(() => {
      const prize = prizeAtRotation(next);
      setResult(prize);
      setSpinning(false);
    }, 4200);
  }

  async function handleAward(student) {
    if (!result || !student || !onAward || awardingId) return;
    setAwardingId(student.id);
    setAwardNote("");
    try {
      await onAward(student, result.amount);
      setAwardNote(`Queued ${money(result.amount)} for ${student.name}.`);
    } catch (err) {
      setAwardNote(err.message || "Could not send cash.");
    } finally {
      setAwardingId("");
    }
  }

  if (!open) return null;

  const modal = (
    <div
      className="spin-wheel-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="spin-wheel-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spin-wheel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="spin-wheel-head">
          <div>
            <p className="spin-wheel-kicker">Classroom prize</p>
            <h3 id="spin-wheel-title">Cash spin wheel</h3>
          </div>
          <button
            type="button"
            className="closet-close"
            data-click="select"
            aria-label="Close spin wheel"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="spin-wheel-stage">
          <div className="spin-wheel-pointer" aria-hidden="true" />
          <div
            className={`spin-wheel-disc${spinning ? " is-spinning" : ""}`}
            style={{
              background: wheelBackground(),
              transform: `rotate(${rotation}deg)`,
            }}
          >
            {SEGMENTS.map((seg, i) => {
              const mid = -90 + i * SLICE + SLICE / 2;
              return (
                <span
                  key={seg.amount}
                  className="spin-wheel-label"
                  style={{ transform: `rotate(${mid}deg) translateY(-6.35rem)` }}
                >
                  {seg.label}
                </span>
              );
            })}
            <span className="spin-wheel-hub" aria-hidden="true" />
          </div>
        </div>

        <div className="spin-wheel-actions">
          <button
            type="button"
            className="primary-btn"
            data-click="confirm"
            disabled={spinning}
            onClick={handleSpin}
          >
            {spinning ? "Spinning…" : "Spin"}
          </button>
        </div>

        {result && (
          <div className="spin-wheel-result" role="status">
            <p className="spin-wheel-result-label">Landed on</p>
            <strong>{money(result.amount)}</strong>
          </div>
        )}

        {result && onAward && (
          <div className="spin-wheel-roster">
            <p className="spin-wheel-roster-label">Send to a student</p>
            {roster.length === 0 ? (
              <p className="spin-wheel-roster-empty">
                Open a class with students to award this spin.
              </p>
            ) : (
              <ul className="spin-wheel-student-list">
                {roster.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="spin-wheel-student-btn"
                      data-click="confirm"
                      disabled={Boolean(awardingId)}
                      onClick={() => handleAward(s)}
                    >
                      <span className="spin-wheel-student-name">
                        {s.name || "Student"}
                      </span>
                      <span className="spin-wheel-student-action">
                        {awardingId === s.id
                          ? "Sending…"
                          : `Send ${money(result.amount)}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {awardNote && <p className="spin-wheel-note">{awardNote}</p>}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

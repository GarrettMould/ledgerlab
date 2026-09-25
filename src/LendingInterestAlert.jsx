import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collectLoanPayment, getLoans } from "./api";
import {
  LENDING_COUNTRIES,
  LENDING_RECOVERY_PCT,
  LENDING_SALE_DISCOUNT_PER_MISS_PCT,
} from "./data/worldLending";

const SPIN_MS = 4200;
const POLL_MS = 60000;

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** Two slices sized by probability; slice 0 starts at the top and runs clockwise. */
function buildSlices(defaultPct) {
  const risk = Math.min(95, Math.max(1, Number(defaultPct) || 0));
  const defaultDeg = (risk / 100) * 360;
  return [
    { id: "paid", label: "Paid", color: "#2f7d57", start: 0, end: 360 - defaultDeg },
    { id: "default", label: "Default", color: "#b4432f", start: 360 - defaultDeg, end: 360 },
  ];
}

function rotationForSlice(slice, fromRotation) {
  const width = slice.end - slice.start;
  const center = slice.start + width / 2 + (Math.random() - 0.5) * width * 0.6;
  const extraTurns = 5 + Math.floor(Math.random() * 3);
  const targetMod = (360 - center + 360) % 360;
  const currentMod = ((fromRotation % 360) + 360) % 360;
  let delta = targetMod - currentMod;
  if (delta <= 0) delta += 360;
  return fromRotation + extraTurns * 360 + delta;
}

/** Sample Nigeria payment for previewing the modal without a real loan. */
function demoPending() {
  const c = LENDING_COUNTRIES.find((row) => row.id === "NG") || LENDING_COUNTRIES[0];
  const lentAt = new Date();
  lentAt.setMonth(lentAt.getMonth() - 1);
  const defaulted = Math.random() < c.defaultPct / 100;
  return {
    n: 1,
    outcome: defaulted ? "default" : "paid",
    interest: defaulted ? 0 : Math.round(1000 * (c.ratePct / 100 / 12) * 100) / 100,
    principalReturned: 0,
    final: false,
    loan: {
      id: "demo",
      countryName: c.name,
      principal: 1000,
      ratePct: c.ratePct,
      defaultPct: c.defaultPct,
      monthlyInterest: Math.round(1000 * (c.ratePct / 100 / 12) * 100) / 100,
      lentAt: lentAt.toISOString(),
      totalPayments: 7,
    },
  };
}

/**
 * PayPal-style monthly interest notice for country loans. The server already
 * decided paid vs default when the payment came due; the wheel reveals it.
 * Payments queue one at a time (e.g. 2nd then 3rd if a student was away).
 */
export default function LendingInterestAlert({
  classId,
  studentId,
  refreshKey = 0,
  onCollected,
  demo = false,
}) {
  const [queue, setQueue] = useState(() => (demo ? [demoPending()] : []));
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef(null);

  const load = useCallback(async () => {
    if (demo || !studentId) return;
    try {
      const data = await getLoans(studentId, classId);
      setQueue(Array.isArray(data?.pending) ? data.pending : []);
    } catch {
      /* keep the current queue; next poll retries */
    }
  }, [demo, studentId, classId]);

  useEffect(() => {
    load();
    if (demo) return undefined;
    const id = window.setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, refreshKey, demo]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const current = queue[0] || null;
  const currentKey = current ? `${current.loan?.id}-${current.n}` : "";

  useEffect(() => {
    setSpinning(false);
    setRevealed(false);
    setError("");
  }, [currentKey]);

  const slices = useMemo(
    () => buildSlices(current?.loan?.defaultPct),
    [current?.loan?.defaultPct]
  );

  if (!current) return null;

  const loan = current.loan || {};
  const paid = current.outcome === "paid";
  const interest = Number(current.interest) || 0;
  const principalBack = Number(current.principalReturned) || 0;
  const expected = Number(loan.monthlyInterest) || interest;
  const collectTotal = interest + principalBack;

  function spin() {
    if (spinning || revealed) return;
    const slice = slices[paid ? 0 : 1];
    setRotation((r) => rotationForSlice(slice, r));
    setSpinning(true);
    timer.current = setTimeout(() => {
      setSpinning(false);
      setRevealed(true);
    }, SPIN_MS);
  }

  async function finish() {
    if (busy) return;
    if (demo) {
      setQueue([]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await collectLoanPayment(studentId, loan.id, current.n, classId);
      setQueue(Array.isArray(data?.pending) ? data.pending : []);
      onCollected?.(data?.portfolio || null);
    } catch (err) {
      setError(err.message || "Could not record this payment");
      load();
    } finally {
      setBusy(false);
    }
  }

  const background = `conic-gradient(${slices
    .map((s) => `${s.color} ${s.start}deg ${s.end}deg`)
    .join(", ")})`;

  const buttonLabel = busy
    ? "Working…"
    : collectTotal > 0
      ? `Collect ${money(collectTotal)}`
      : "Got it";

  return (
    <div
      className="transfer-overlay lending-interest-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lending-interest-title"
    >
      <div
        className={`transfer-modal lending-interest-modal${
          revealed && !paid ? " is-debit" : " is-credit"
        }`}
      >
        <p className="transfer-kicker">Interest payment due</p>
        <h3 id="lending-interest-title">
          {loan.countryName} · {current.final ? "final" : ordinal(current.n)} interest payment
        </h3>
        <p className="transfer-amount">+{money(expected)}</p>
        <p className="transfer-note">
          You lent {money(loan.principal)} to {loan.countryName}
          {loan.lentAt ? ` on ${shortDate(loan.lentAt)}` : ""} at{" "}
          {Number(loan.ratePct).toFixed(1)}%. Spin to see if they pay you this month.
        </p>
        {current.final && (
          <p className="transfer-cash">
            Last payment — if {loan.countryName} pays, your {money(loan.principal)}{" "}
            comes back in full. If they default, you only get {LENDING_RECOVERY_PCT}% back.
          </p>
        )}
        <p className="lending-interest-lesson">
          Anytime you lend money, there’s a risk the borrower won’t pay you back.
          Higher interest rates usually mean higher risk.
        </p>
        <p className="transfer-cash">
          Default risk: {Number(loan.defaultPct).toFixed(1)}% each month
        </p>

        <div className="spin-wheel-stage lending-interest-stage">
          <div className="spin-wheel-pointer" aria-hidden="true" />
          <div
            className={`spin-wheel-disc${spinning ? " is-spinning" : ""}`}
            style={{ background, transform: `rotate(${rotation}deg)` }}
          >
            {slices.map((s) => {
              const mid = s.start + (s.end - s.start) / 2;
              return (
                <span
                  key={s.id}
                  className="spin-wheel-label"
                  style={{ transform: `rotate(${mid}deg) translateY(-4.4rem)` }}
                >
                  {s.label}
                </span>
              );
            })}
            <span className="spin-wheel-hub" aria-hidden="true" />
          </div>
        </div>

        {revealed && paid && (
          <div className="lending-interest-result is-paid" role="status">
            <strong>{loan.countryName} paid!</strong>
            <span>{money(interest)} interest is yours this month.</span>
          </div>
        )}
        {revealed && !paid && (
          <div className="lending-interest-result is-default" role="status">
            <strong>{loan.countryName} defaulted this month</strong>
            <span>
              {current.final
                ? `No final interest, and they could only repay ${money(principalBack)} of your ${money(
                    loan.principal
                  )} — you lost ${money(Number(current.principalLost) || 0)}.`
                : `No interest this time. Your ${money(
                    loan.principal
                  )} is still lent — next month you spin again. Buyers will now pay ${LENDING_SALE_DISCOUNT_PER_MISS_PCT}% less if you try to sell it.`}
            </span>
          </div>
        )}

        {error && <p className="transfer-error">{error}</p>}

        {!revealed ? (
          <button
            type="button"
            className="primary-btn transfer-accept"
            data-click="confirm"
            disabled={spinning}
            onClick={spin}
          >
            {spinning ? "Spinning…" : "Spin the wheel"}
          </button>
        ) : (
          <button
            type="button"
            className="primary-btn transfer-accept"
            data-click="confirm"
            disabled={busy}
            onClick={finish}
          >
            {buttonLabel}
          </button>
        )}

        {queue.length > 1 && (
          <p className="transfer-queue">{queue.length - 1} more payment waiting after this</p>
        )}
        {demo && (
          <p className="transfer-queue">Test mode — no cash moves. Reload to see it again.</p>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { createLoan, getLoans, sellLoan } from "./api";
import TradeSuccessModal from "./TradeSuccessModal";
import { LAND_PATH } from "./data/worldLandPath";
import {
  LENDING_COUNTRIES_WITH_POINTS,
  LENDING_FACE_VALUE,
  LENDING_HORIZON_LABEL,
  LENDING_RECOVERY_PCT,
  LENDING_SALE_DISCOUNT_PER_MISS_PCT,
  OCEAN_LABELS,
  WORLD_MAP_VIEW,
} from "./data/worldLending";

const FACE_LABEL = LENDING_FACE_VALUE.toLocaleString("en-US");

function rateLabel(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function riskTone(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return "";
  if (n >= 10) return "high";
  if (n >= 4) return "mid";
  return "low";
}

function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function longDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function WorldLendingMap({ studentId, classId, cash, onPortfolio }) {
  const [activeId, setActiveId] = useState(
    LENDING_COUNTRIES_WITH_POINTS[0]?.id || null
  );
  const [amount, setAmount] = useState("1000");
  const [loans, setLoans] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lendSuccess, setLendSuccess] = useState(null);
  const [confirmSellId, setConfirmSellId] = useState(null);
  const [sellingId, setSellingId] = useState(null);
  const [loanError, setLoanError] = useState("");

  const loadLoans = useCallback(async () => {
    if (!studentId) return;
    try {
      const data = await getLoans(studentId, classId);
      setLoans(Array.isArray(data?.loans) ? data.loans : []);
    } catch {
      /* loans list is optional context */
    }
  }, [studentId, classId]);

  useEffect(() => {
    loadLoans();
  }, [loadLoans]);

  const amountNum = Number(amount);
  const cashNum = Number(cash);
  const canLend =
    Boolean(studentId) &&
    Number.isFinite(amountNum) &&
    amountNum >= 100 &&
    (!Number.isFinite(cashNum) || amountNum <= cashNum + 1e-9);

  async function lend(country) {
    if (!canLend || busy || !country) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await createLoan(studentId, country.id, amountNum, classId);
      setLoans(Array.isArray(data?.loans) ? data.loans : []);
      onPortfolio?.(data?.portfolio || null);
      const newest = [...(data?.loans || [])]
        .filter((l) => l.countryId === country.id)
        .sort((a, b) => String(b.lentAt).localeCompare(String(a.lentAt)))[0];
      setLendSuccess({
        action: "buy",
        assetType: "loan",
        ticker: country.id,
        name: country.name,
        total: amountNum,
        note: `Your first interest payment notification will appear on ${
          newest?.nextDueAt ? longDate(newest.nextDueAt) : "this day next month"
        }. Spin the wheel then to see if ${country.name} pays you.`,
      });
    } catch (err) {
      setError(err.message || "Could not make this loan");
    } finally {
      setBusy(false);
    }
  }

  async function sell(loan) {
    if (!loan || sellingId) return;
    if (confirmSellId !== loan.id) {
      setConfirmSellId(loan.id);
      setLoanError("");
      return;
    }
    setSellingId(loan.id);
    setLoanError("");
    try {
      const data = await sellLoan(studentId, loan.id, loan.salePrice, classId);
      setLoans(Array.isArray(data?.loans) ? data.loans : []);
      onPortfolio?.(data?.portfolio || null);
      const diff = Number(loan.salePrice) - Number(loan.principal);
      setLendSuccess({
        action: "sell",
        assetType: "loan",
        ticker: loan.countryId,
        name: loan.countryName,
        total: loan.salePrice,
        note:
          diff < 0
            ? `You lent ${money(loan.principal)} and sold for ${money(loan.salePrice)} — a ${money(
                -diff
              )} discount for the buyer taking on ${loan.countryName}’s risk. The ${money(
                loan.interestEarned
              )} interest you collected is still yours.`
            : `You got your full ${money(loan.principal)} back, plus the ${money(
                loan.interestEarned
              )} interest you already collected.`,
      });
      setConfirmSellId(null);
    } catch (err) {
      setLoanError(err.message || "Could not sell this loan");
      loadLoans();
    } finally {
      setSellingId(null);
    }
  }

  const activeLoans = loans.filter((l) => l.status === "active");
  const doneLoans = loans.filter((l) => l.status !== "active");

  const markers = LENDING_COUNTRIES_WITH_POINTS;
  const active = useMemo(
    () => markers.find((m) => m.id === activeId) || null,
    [markers, activeId]
  );

  const sorted = useMemo(
    () => [...markers].sort((a, b) => Number(b.ratePct) - Number(a.ratePct)),
    [markers]
  );

  const { width, height } = WORLD_MAP_VIEW;

  return (
    <div className="world-lending">
      <p className="world-lending-hint">
        Tap a country on the map or in the list. Earnings assume you lend $
        {FACE_LABEL} today and every payment comes through by{" "}
        {LENDING_HORIZON_LABEL}. Loans are in U.S. dollars. Each month you spin
        against that country’s default risk — a miss skips that month’s interest,
        and missing the final payment returns only {LENDING_RECOVERY_PCT}% of your
        money. You can sell a loan early, but buyers pay less for riskier countries
        and {LENDING_SALE_DISCOUNT_PER_MISS_PCT}% less for every missed payment.
      </p>

      <div className="world-lending-layout">
        <div className="world-lending-stage">
          <svg
            className="world-lending-svg"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="World map of classroom lending countries"
          >
            <defs>
              <linearGradient id="wlOcean" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#c9e4ef" />
                <stop offset="55%" stopColor="#b3d7e6" />
                <stop offset="100%" stopColor="#9cc9db" />
              </linearGradient>
              <linearGradient id="wlLand" x1="20%" y1="0%" x2="80%" y2="100%">
                <stop offset="0%" stopColor="#d8e6c4" />
                <stop offset="50%" stopColor="#c2d6a6" />
                <stop offset="100%" stopColor="#a9c68a" />
              </linearGradient>
              <pattern
                id="wlRipple"
                width="24"
                height="24"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M0 12 Q6 8 12 12 T24 12"
                  fill="none"
                  stroke="rgba(255,255,255,0.22)"
                  strokeWidth="1"
                />
              </pattern>
              <filter id="wlSoft" x="-5%" y="-5%" width="110%" height="110%">
                <feDropShadow
                  dx="0"
                  dy="6"
                  stdDeviation="8"
                  floodColor="#0f2f3a"
                  floodOpacity="0.14"
                />
              </filter>
              <clipPath id="wlFrame">
                <rect x="0" y="0" width={width} height={height} />
              </clipPath>
            </defs>

            <rect
              x="0"
              y="0"
              width={width}
              height={height}
             
              fill="url(#wlOcean)"
            />
            <rect
              x="0"
              y="0"
              width={width}
              height={height}
             
              fill="url(#wlRipple)"
            />

            <g clipPath="url(#wlFrame)" filter="url(#wlSoft)">
              <path
                className="world-lending-land"
                d={LAND_PATH}
                fill="url(#wlLand)"
                stroke="#4a6f45"
                strokeWidth="0.7"
                strokeLinejoin="round"
                fillRule="evenodd"
              />
            </g>

            {OCEAN_LABELS.map((label) => (
              <text
                key={label.id}
                className="world-lending-ocean-label"
                x={label.x}
                y={label.y}
                transform={`rotate(${label.rotate} ${label.x} ${label.y})`}
              >
                {label.text}
              </text>
            ))}

            {markers.map((country) => {
              const { x, y } = country.point;
              const activeMark = country.id === activeId;
              const labelDx =
                country.labelSide === "left"
                  ? -14
                  : country.labelSide === "right"
                    ? 14
                    : 0;
              const labelAnchor =
                country.labelSide === "left"
                  ? "end"
                  : country.labelSide === "right"
                    ? "start"
                    : "middle";
              return (
                <g
                  key={country.id}
                  className={
                    activeMark
                      ? "world-lending-marker active"
                      : "world-lending-marker"
                  }
                  transform={`translate(${x} ${y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${country.name}, ${rateLabel(country.ratePct)}, ${rateLabel(country.defaultPct)} default risk`}
                  aria-pressed={activeMark}
                  onClick={() => setActiveId(country.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveId(country.id);
                    }
                  }}
                >
                  <circle className="world-lending-halo" r="18" />
                  <circle className="world-lending-dot" r="7" />
                  <text
                    className="world-lending-marker-label"
                    x={labelDx}
                    y={country.labelSide === "bottom" ? 24 : -16}
                    textAnchor={
                      country.labelSide === "bottom" ? "middle" : labelAnchor
                    }
                  >
                    {country.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="world-lending-panel" aria-live="polite">
          {active ? (
            <>
              <div className="world-lending-hero">
                <p className="world-lending-kicker">Country lending</p>
                <h3>{active.name}</h3>
                <p className="world-lending-rate">{rateLabel(active.ratePct)}</p>
                <p className="world-lending-tenor">{active.tenor}</p>
              </div>

              <p className="world-lending-blurb">{active.blurb}</p>

              <dl className="world-lending-stats">
                <div>
                  <dt>Classroom rate</dt>
                  <dd>{rateLabel(active.ratePct)}</dd>
                </div>
                <div>
                  <dt>Earned on ${FACE_LABEL} by {LENDING_HORIZON_LABEL}</dt>
                  <dd>{money(active.interestByHorizon)}</dd>
                </div>
                <div>
                  <dt>Default risk / month</dt>
                  <dd className={`world-lending-risk ${riskTone(active.defaultPct)}`}>
                    {rateLabel(active.defaultPct)}
                  </dd>
                </div>
              </dl>

              <div className="world-lending-form">
                <label htmlFor="world-lending-amount">Amount to lend</label>
                <div className="world-lending-amount-row">
                  <span aria-hidden="true">$</span>
                  <input
                    id="world-lending-amount"
                    type="number"
                    min="100"
                    step="100"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                {Number.isFinite(amountNum) && amountNum >= 100 && (
                  <p className="world-lending-estimate">
                    {money((amountNum * active.ratePct) / 100 / 12)} a month if{" "}
                    {active.name} pays · cash: {money(cash)}
                  </p>
                )}
              </div>

              <button
                type="button"
                className="primary-btn world-lending-lend-btn"
                data-click="confirm"
                disabled={!canLend || busy}
                onClick={() => lend(active)}
              >
                {busy
                  ? "Lending…"
                  : `Lend ${Number.isFinite(amountNum) ? money(amountNum) : ""} to ${active.name}`}
              </button>
              {!studentId && (
                <p className="world-lending-note">Sign in as a student to lend.</p>
              )}
              {studentId && Number.isFinite(amountNum) && amountNum < 100 && (
                <p className="world-lending-note">The smallest loan is $100.</p>
              )}
              {studentId &&
                Number.isFinite(cashNum) &&
                Number.isFinite(amountNum) &&
                amountNum > cashNum && (
                  <p className="world-lending-note">Not enough cash for that amount.</p>
                )}
              {error && <p className="transfer-error">{error}</p>}
              {notice && <p className="world-lending-notice">{notice}</p>}
              <p className="world-lending-note">
                Each month you spin once for that month’s interest. Your money comes
                back with the last payment before {LENDING_HORIZON_LABEL} — but if that
                final spin defaults, you only get {LENDING_RECOVERY_PCT}% of it back.
              </p>
            </>
          ) : (
            <div className="world-lending-empty">
              <strong>Pick a country</strong>
              <p>Select a pin on the map to compare rates and default risk.</p>
            </div>
          )}
        </aside>
      </div>

      {loans.length > 0 && (
        <div className="world-lending-table-wrap">
          <div className="world-lending-table-head">
            <h4>Your loans</h4>
            <p>
              {activeLoans.length} active
              {doneLoans.length ? ` · ${doneLoans.length} closed` : ""}
            </p>
          </div>
          {loanError && <p className="transfer-error">{loanError}</p>}
          <ul className="world-lending-loans">
            {[...activeLoans, ...doneLoans].map((loan) => (
              <li key={loan.id} className={loan.status === "active" ? "" : "is-done"}>
                <div className="world-lending-loan-main">
                  <strong>{loan.countryName}</strong>
                  <span>
                    {money(loan.principal)} at {rateLabel(loan.ratePct)} · lent{" "}
                    {shortDate(loan.lentAt)}
                  </span>
                </div>
                <div className="world-lending-loan-stats">
                  <span>
                    Payment {loan.paymentsHandled}/{loan.totalPayments}
                  </span>
                  <span className="is-paid">{loan.paidCount} paid</span>
                  <span className="is-missed">{loan.missedCount} missed</span>
                  <span>Earned {money(loan.interestEarned)}</span>
                  <span>
                    {loan.status === "active"
                      ? loan.pending
                        ? "Payment waiting now"
                        : `Next: ${shortDate(loan.nextDueAt)}`
                      : loan.status === "sold"
                        ? `Sold for ${money(loan.soldFor)}`
                        : Number(loan.principalLost) > 0
                          ? `Got back ${money(loan.principalReturned)} of ${money(loan.principal)}`
                          : "Paid back"}
                  </span>
                </div>
                {loan.status === "active" && loan.salePrice != null && (
                  <div className="world-lending-loan-sell">
                    {loan.pending ? (
                      <span className="world-lending-loan-sell-note">
                        Spin for your waiting payment before selling.
                      </span>
                    ) : (
                      <>
                        <span className="world-lending-loan-sell-note">
                          Market price {money(loan.salePrice)}
                          {Number(loan.salePrice) < Number(loan.principal)
                            ? ` (${money(Number(loan.principal) - Number(loan.salePrice))} below what you lent)`
                            : ""}
                        </span>
                        {confirmSellId === loan.id && (
                          <button
                            type="button"
                            className="ghost-btn world-lending-loan-sell-cancel"
                            data-click="select"
                            disabled={sellingId === loan.id}
                            onClick={() => setConfirmSellId(null)}
                          >
                            Keep it
                          </button>
                        )}
                        <button
                          type="button"
                          className={
                            confirmSellId === loan.id
                              ? "primary-btn world-lending-loan-sell-btn is-confirm"
                              : "ghost-btn world-lending-loan-sell-btn"
                          }
                          data-click={confirmSellId === loan.id ? "confirm" : "select"}
                          disabled={Boolean(sellingId)}
                          onClick={() => sell(loan)}
                        >
                          {sellingId === loan.id
                            ? "Selling…"
                            : confirmSellId === loan.id
                              ? `Confirm sell for ${money(loan.salePrice)}`
                              : `Sell for ${money(loan.salePrice)}`}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="world-lending-table-wrap">
        <div className="world-lending-table-head">
          <h4>All countries</h4>
          <p>
            Sorted by rate · earnings on ${FACE_LABEL} lent today, if every payment
            comes through by {LENDING_HORIZON_LABEL}
          </p>
        </div>
        <div className="world-lending-table" role="list">
          <div className="world-lending-table-row is-head" aria-hidden="true">
            <span>Country</span>
            <span>Rate</span>
            <span>
              ${FACE_LABEL} earns by {LENDING_HORIZON_LABEL.replace(", 2027", "")}
            </span>
            <span>Default risk</span>
          </div>
          {sorted.map((country) => {
            const selected = country.id === activeId;
            return (
              <button
                key={country.id}
                type="button"
                role="listitem"
                className={
                  selected
                    ? "world-lending-table-row is-active"
                    : "world-lending-table-row"
                }
                data-click="select"
                onClick={() => setActiveId(country.id)}
              >
                <span className="world-lending-table-name">
                  <strong>{country.name}</strong>
                  <em>{country.id}</em>
                </span>
                <span className="world-lending-table-rate">
                  {rateLabel(country.ratePct)}
                </span>
                <span className="world-lending-table-earn">
                  {money(country.interestByHorizon)}
                </span>
                <span
                  className={`world-lending-table-risk ${riskTone(country.defaultPct)}`}
                >
                  {rateLabel(country.defaultPct)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <TradeSuccessModal trade={lendSuccess} onClose={() => setLendSuccess(null)} />
    </div>
  );
}

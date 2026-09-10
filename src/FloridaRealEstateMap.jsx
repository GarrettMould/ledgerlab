import { Suspense, useMemo, useState } from "react";
import HouseCharacter, { houseStyleForCity } from "./HouseCharacter";
import {
  CITY_POINTS,
  EVERGLADES_PATH,
  HIGHLIGHT_STATE,
  LAKE_OKEECHOBEE,
  MAP_VIEW,
  NEIGHBOR_STATES,
  STATE_LABELS,
  STATE_PATHS,
  WATER_LABELS,
} from "./data/southeastMap";

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default function FloridaRealEstateMap({
  items = [],
  moneyFormat = money,
  cash = 0,
  ownedTickers,
  onBuyHome,
  busy = false,
}) {
  const [activeTicker, setActiveTicker] = useState(null);
  const [confirmBuy, setConfirmBuy] = useState(false);
  const owned = useMemo(() => {
    if (ownedTickers instanceof Set) return ownedTickers;
    return new Set(ownedTickers || []);
  }, [ownedTickers]);

  const byTicker = useMemo(() => {
    const map = new Map();
    for (const item of items) map.set(item.ticker, item);
    return map;
  }, [items]);

  const markers = useMemo(
    () =>
      Object.entries(CITY_POINTS)
        .map(([ticker, point]) => {
          const item = byTicker.get(ticker);
          if (!item) return null;
          return { ticker, point, item };
        })
        .filter(Boolean),
    [byTicker]
  );

  const active = activeTicker
    ? markers.find((m) => m.ticker === activeTicker)
    : null;
  const activeStyle = active ? houseStyleForCity(active.ticker) : null;
  const dueToday = active ? Number(active.item.due_today) : NaN;
  const canAfford =
    Number.isFinite(dueToday) && Number(cash) + 0.0001 >= dueToday;
  const alreadyOwned = active ? owned.has(active.ticker) : false;

  function selectCity(ticker) {
    setActiveTicker(ticker);
    setConfirmBuy(false);
  }

  async function handleBuy() {
    if (!active || !onBuyHome || alreadyOwned || !canAfford || busy) return;
    if (!confirmBuy) {
      setConfirmBuy(true);
      return;
    }
    await onBuyHome(active.item);
    setConfirmBuy(false);
  }

  const minY = MAP_VIEW.minY ?? 0;
  const viewH = MAP_VIEW.height - minY;

  return (
    <div className="florida-market">
      <p className="florida-map-hint">
        Tap a city to see rent and mortgage. Buying locks in those terms; each month
        rent nets against the payment and the loan pays down.
      </p>

      <div className="florida-market-layout">
        <div className="florida-map-stage">
          <svg
            className="florida-map-svg"
            viewBox={`0 ${minY} ${MAP_VIEW.width} ${viewH}`}
            role="img"
            aria-label="Interactive map of Florida and the Southeast"
          >
            <defs>
              <linearGradient id="flOcean" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#d7eef3" />
                <stop offset="45%" stopColor="#c5e4ec" />
                <stop offset="100%" stopColor="#b7dbe6" />
              </linearGradient>
              <linearGradient id="flLand" x1="18%" y1="5%" x2="82%" y2="95%">
                <stop offset="0%" stopColor="#e4f0d4" />
                <stop offset="40%" stopColor="#d3e6bc" />
                <stop offset="100%" stopColor="#bfd9a4" />
              </linearGradient>
              <linearGradient id="flMainland" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#d9e4cc" />
                <stop offset="55%" stopColor="#cdddb8" />
                <stop offset="100%" stopColor="#c0d4a8" />
              </linearGradient>
              <linearGradient id="flWetland" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#9fc48a" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#7aa86a" stopOpacity="0.45" />
              </linearGradient>
              <pattern
                id="flRipple"
                width="18"
                height="18"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M0 9 Q4.5 5 9 9 T18 9"
                  fill="none"
                  stroke="rgba(255,255,255,0.35)"
                  strokeWidth="1"
                />
              </pattern>
              <filter id="flSoft" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow
                  dx="0"
                  dy="10"
                  stdDeviation="12"
                  floodColor="#0f2f3a"
                  floodOpacity="0.18"
                />
              </filter>
              <clipPath id="flFrame">
                <rect
                  x="0"
                  y={minY}
                  width={MAP_VIEW.width}
                  height={viewH}
                  rx="28"
                />
              </clipPath>
            </defs>

            <rect
              x="0"
              y={minY}
              width={MAP_VIEW.width}
              height={viewH}
              rx="28"
              fill="url(#flOcean)"
            />
            <rect
              x="0"
              y={minY}
              width={MAP_VIEW.width}
              height={viewH}
              rx="28"
              fill="url(#flRipple)"
            />

            <g clipPath="url(#flFrame)" filter="url(#flSoft)">
              {NEIGHBOR_STATES.map((name) => {
                const d = STATE_PATHS[name];
                if (!d) return null;
                return (
                  <path
                    key={name}
                    className="florida-neighbor-state"
                    d={d}
                    fill="url(#flMainland)"
                    stroke="#4f7348"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                );
              })}

              <path
                className="florida-state"
                d={STATE_PATHS[HIGHLIGHT_STATE]}
                fill="url(#flLand)"
                stroke="#3f6a3c"
                strokeWidth="2.4"
                strokeLinejoin="round"
              />

              <path d={EVERGLADES_PATH} fill="url(#flWetland)" />

              <ellipse
                cx={LAKE_OKEECHOBEE.cx}
                cy={LAKE_OKEECHOBEE.cy}
                rx={LAKE_OKEECHOBEE.rx}
                ry={LAKE_OKEECHOBEE.ry}
                fill="#9ec9d6"
                stroke="#6f9eab"
                strokeWidth="1.2"
                opacity="0.92"
              />
              <text
                className="florida-lake-label"
                x={LAKE_OKEECHOBEE.cx}
                y={LAKE_OKEECHOBEE.cy + 3}
                textAnchor="middle"
              >
                Okeechobee
              </text>
            </g>

            {Object.entries(WATER_LABELS).map(([key, label]) => (
              <text
                key={key}
                className="florida-water-label"
                x={label.x}
                y={label.y}
                transform={`rotate(${label.rotate} ${label.x} ${label.y})`}
              >
                {label.text}
              </text>
            ))}

            {Object.entries(STATE_LABELS).map(([name, pt]) => {
              if (pt.x < 8 || pt.x > MAP_VIEW.width - 8) return null;
              if (pt.y < minY + 10 || pt.y > MAP_VIEW.height - 10) return null;
              return (
                <text
                  key={name}
                  className={
                    name === HIGHLIGHT_STATE
                      ? "florida-state-label florida-state-label-main"
                      : "florida-state-label"
                  }
                  x={pt.x}
                  y={pt.y}
                  textAnchor="middle"
                >
                  {name === "South Carolina" ? "S. Carolina" : name}
                </text>
              );
            })}

            {markers.map(({ ticker, point, item }) => {
              const isActive = activeTicker === ticker;
              const isOwned = owned.has(ticker);
              const style = houseStyleForCity(ticker);
              const labelX =
                point.labelSide === "left"
                  ? -12
                  : point.labelSide === "right"
                    ? 12
                    : 0;
              const labelY = point.labelSide === "bottom" ? 22 : -14;
              const anchor =
                point.labelSide === "left"
                  ? "end"
                  : point.labelSide === "right"
                    ? "start"
                    : "middle";

              return (
                <g
                  key={ticker}
                  className={[
                    "florida-marker",
                    isActive ? "active" : "",
                    isOwned ? "owned" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  transform={`translate(${point.x} ${point.y})`}
                  onMouseEnter={() => selectCity(ticker)}
                  onFocus={() => selectCity(ticker)}
                  onClick={() => selectCity(ticker)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${item.name} real estate market`}
                  aria-pressed={isActive}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectCity(ticker);
                    }
                  }}
                >
                  <circle className="florida-marker-halo" r={isActive ? 18 : 13} />
                  <path
                    className="florida-pin"
                    d="M0 -12 L7 0 L0 4 L-7 0 Z"
                    style={{ fill: style.roof }}
                  />
                  <circle
                    className="florida-marker-dot"
                    cy={1}
                    r={isActive ? 4.5 : 3.5}
                    style={{ fill: style.door }}
                  />
                  {isOwned && (
                    <circle className="florida-owned-badge" cx="10" cy="-10" r="5" />
                  )}
                  <text
                    className="florida-marker-label"
                    x={labelX}
                    y={labelY}
                    textAnchor={anchor}
                  >
                    {item.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="florida-city-panel" aria-live="polite">
          {!active ? (
            <div className="florida-city-empty">
              <strong>Pick a Florida market</strong>
              <p>
                Each city has its own house character. You’ll see the full purchase cost
                before you buy.
              </p>
            </div>
          ) : (
            <>
              <div className="florida-city-hero">
                <Suspense
                  fallback={
                    <div className="house-character-stage house-character-fallback" />
                  }
                >
                  <HouseCharacter
                    key={active.ticker}
                    ticker={active.ticker}
                    style={activeStyle}
                    className="house-character-stage house-character-stage-lg"
                  />
                </Suspense>
                <div>
                  <p className="florida-city-kicker">{active.item.region || "Florida"}</p>
                  <h3>{active.item.name}</h3>
                  <p className="florida-city-price">{moneyFormat(active.item.price)}</p>
                  <p className="florida-city-sub">
                    Avg. single-family home
                    {active.item.as_of ? ` · ${active.item.as_of}` : ""}
                  </p>
                  <div className="florida-tip-swatches" aria-hidden="true">
                    <span style={{ background: activeStyle.roof }} title="Roof" />
                    <span style={{ background: activeStyle.door }} title="Door" />
                  </div>
                </div>
              </div>

              <div className="florida-cost-card">
                <p className="florida-cost-kicker">What you pay today</p>
                <strong className="florida-due-today">
                  {moneyFormat(active.item.due_today)}
                </strong>
                <ul className="florida-cost-breakdown">
                  <li>
                    <span>
                      Down payment ({Number(active.item.down_payment_pct || 20)}%)
                    </span>
                    <strong>{moneyFormat(active.item.down_payment)}</strong>
                  </li>
                  <li>
                    <span>
                      Closing costs ({Number(active.item.closing_cost_pct || 1)}%)
                    </span>
                    <strong>{moneyFormat(active.item.closing_costs)}</strong>
                  </li>
                </ul>
                <p className="florida-cash-line">
                  Your cash: {moneyFormat(cash)}
                  {!canAfford && !alreadyOwned ? " · not enough yet" : ""}
                </p>
              </div>

              <dl className="florida-city-stats">
                <div>
                  <dt>Mortgage</dt>
                  <dd>
                    {moneyFormat(active.item.loan_amount)} @{" "}
                    {Number(active.item.mortgage_rate_pct).toFixed(2)}%
                  </dd>
                </div>
                <div>
                  <dt>Monthly payment</dt>
                  <dd>{moneyFormat(active.item.est_monthly_payment)}</dd>
                </div>
                <div>
                  <dt>Est. rent</dt>
                  <dd>
                    {active.item.monthly_rent != null
                      ? `${moneyFormat(active.item.monthly_rent)}/mo`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Monthly net</dt>
                  <dd
                    className={
                      active.item.monthly_rent != null &&
                      active.item.est_monthly_payment != null &&
                      Number(active.item.monthly_rent) -
                        Number(active.item.est_monthly_payment) >=
                        0
                        ? "up"
                        : "down"
                    }
                  >
                    {active.item.monthly_rent != null &&
                    active.item.est_monthly_payment != null
                      ? `${moneyFormat(
                          Number(active.item.monthly_rent) -
                            Number(active.item.est_monthly_payment)
                        )}/mo`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Price change</dt>
                  <dd
                    className={
                      Number(active.item.yoy_change_pct ?? active.item.change_pct) >=
                      0
                        ? "up"
                        : "down"
                    }
                  >
                    {active.item.yoy_change_pct == null &&
                    active.item.change_pct == null
                      ? "—"
                      : `${
                          Number(active.item.yoy_change_pct ?? active.item.change_pct) >=
                          0
                            ? "+"
                            : ""
                        }${Number(
                          active.item.yoy_change_pct ?? active.item.change_pct
                        ).toFixed(1)}%`}
                  </dd>
                </div>
              </dl>

              <div className="florida-buy-actions">
                {alreadyOwned ? (
                  <p className="florida-owned-note">
                    You already own this city’s home. Rent and mortgage settle each month
                    when you open your portfolio.
                  </p>
                ) : (
                  <button
                    type="button"
                    className={
                      confirmBuy
                        ? "primary-btn florida-buy-btn confirm"
                        : "primary-btn florida-buy-btn"
                    }
                    data-click={confirmBuy ? "confirm" : "select"}
                    disabled={busy || !canAfford}
                    onClick={handleBuy}
                  >
                    {confirmBuy
                      ? `Confirm (${moneyFormat(active.item.due_today)})`
                      : "Buy home"}
                  </button>
                )}
                {confirmBuy && !alreadyOwned && (
                  <button
                    type="button"
                    className="ghost-btn"
                    data-click="select"
                    onClick={() => setConfirmBuy(false)}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

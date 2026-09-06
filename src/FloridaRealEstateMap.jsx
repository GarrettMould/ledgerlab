import { Suspense, useMemo, useState } from "react";
import HouseCharacter, { houseStyleForCity } from "./HouseCharacter";

/** Marker positions calibrated to the detailed Florida outline. */
const CITY_POINTS = {
  "FL-PNS": { x: 42, y: 72, labelSide: "bottom" },
  "FL-TLH": { x: 128, y: 68, labelSide: "bottom" },
  "FL-JAX": { x: 248, y: 78, labelSide: "left" },
  "FL-ORL": { x: 222, y: 188, labelSide: "right" },
  "FL-TPA": { x: 158, y: 218, labelSide: "left" },
  "FL-NAP": { x: 178, y: 302, labelSide: "left" },
  "FL-FLL": { x: 262, y: 318, labelSide: "left" },
  "FL-MIA": { x: 248, y: 358, labelSide: "left" },
};

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

  return (
    <div className="florida-market">
      <p className="florida-map-hint">
        Tap a city to inspect that market’s house, see what you pay today, and buy with a
        classroom mortgage.
      </p>

      <div className="florida-market-layout">
        <div className="florida-map-stage">
          <svg
            className="florida-map-svg"
            viewBox="0 -52 320 492"
            role="img"
            aria-label="Interactive map of Florida real estate markets"
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
                <stop offset="0%" stopColor="#dfe9cf" />
                <stop offset="55%" stopColor="#d3e6bc" />
                <stop offset="100%" stopColor="#c8dcad" />
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
            </defs>

            <rect x="0" y="-52" width="320" height="492" rx="28" fill="url(#flOcean)" />
            <rect x="0" y="-52" width="320" height="492" rx="28" fill="url(#flRipple)" />

            {/* Gulf & Atlantic labels */}
            <text className="florida-water-label" x="28" y="250" transform="rotate(-78 28 250)">
              Gulf of Mexico
            </text>
            <text className="florida-water-label" x="292" y="210" transform="rotate(78 292 210)">
              Atlantic
            </text>

            {/* Southern Georgia / Alabama — Florida is not an island */}
            <path
              fill="url(#flMainland)"
              stroke="#4f7348"
              strokeWidth="2"
              strokeLinejoin="round"
              d="
                M -8 -56
                L 328 -56
                L 328 8
                C 318 18, 308 28, 300 38
                C 288 52, 276 58, 262 56
                C 248 54, 236 48, 220 50
                C 200 52, 178 58, 156 56
                C 132 54, 110 50, 88 48
                C 64 46, 42 50, 28 62
                C 18 70, 10 78, 4 86
                L -8 92
                Z
              "
            />
            <text className="florida-state-label" x="96" y="-8" textAnchor="middle">
              Georgia
            </text>
            <text className="florida-state-label" x="36" y="28" textAnchor="middle">
              Ala.
            </text>

            {/* Detailed Florida silhouette (joins mainland along the northern border) */}
            <path
              fill="url(#flLand)"
              stroke="#4f7348"
              strokeWidth="2.4"
              strokeLinejoin="round"
              d="
                M 14 78
                C 22 54, 48 46, 72 50
                L 108 54
                C 138 56, 168 48, 198 52
                C 222 55, 242 50, 258 58
                C 272 64, 278 78, 274 94
                C 268 122, 264 146, 260 168
                C 256 196, 258 222, 264 248
                C 270 274, 278 298, 282 322
                C 286 344, 284 364, 272 384
                C 258 408, 236 424, 210 430
                C 190 434, 172 426, 162 408
                C 154 392, 156 372, 160 354
                C 164 330, 160 308, 150 290
                C 138 268, 118 252, 98 238
                C 78 224, 62 204, 52 182
                C 42 160, 34 138, 26 118
                C 18 98, 12 86, 14 78
                Z
              "
            />

            {/* Soft join so the state line doesn’t read as a coastline */}
            <path
              fill="url(#flLand)"
              stroke="none"
              d="
                M 16 76
                C 24 54, 48 48, 72 51
                L 108 54
                C 138 56, 168 49, 198 52
                C 222 55, 242 51, 256 57
                L 256 64
                C 240 56, 220 58, 198 56
                C 168 52, 138 60, 108 58
                L 72 54
                C 48 52, 28 60, 18 78
                Z
              "
            />
            {/* Lake Okeechobee */}
            <ellipse
              cx="228"
              cy="268"
              rx="18"
              ry="14"
              fill="#9ec9d6"
              stroke="#6f9eab"
              strokeWidth="1.2"
              opacity="0.9"
            />
            <text className="florida-lake-label" x="228" y="272" textAnchor="middle">
              Okeechobee
            </text>

            {/* Everglades wash */}
            <path
              d="M 170 300 C 190 292, 220 300, 250 330 C 240 360, 210 390, 180 392 C 168 360, 160 328, 170 300 Z"
              fill="url(#flWetland)"
            />

            {/* Highway cues */}
            <path
              className="florida-hwy"
              d="M 48 76 L 250 82"
            />
            <path
              className="florida-hwy"
              d="M 250 82 L 250 350"
            />
            <path
              className="florida-hwy"
              d="M 140 70 L 168 220 L 190 300 L 220 360"
            />

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
                      Closing costs ({Number(active.item.closing_cost_pct || 2)}%)
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
                  <dt>YoY price</dt>
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
                          Number(
                            active.item.yoy_change_pct ?? active.item.change_pct
                          ) >= 0
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
                  <p className="florida-owned-note">You already own this city’s home.</p>
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

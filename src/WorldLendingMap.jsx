import { useMemo, useState } from "react";
import { LAND_PATH } from "./data/worldLandPath";
import {
  LENDING_COUNTRIES_WITH_POINTS,
  OCEAN_LABELS,
  WORLD_MAP_VIEW,
} from "./data/worldLending";

function rateLabel(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

export default function WorldLendingMap() {
  const [activeId, setActiveId] = useState(
    LENDING_COUNTRIES_WITH_POINTS[0]?.id || null
  );

  const markers = LENDING_COUNTRIES_WITH_POINTS;
  const active = useMemo(
    () => markers.find((m) => m.id === activeId) || null,
    [markers, activeId]
  );

  const { width, height } = WORLD_MAP_VIEW;

  return (
    <div className="world-lending">
      <p className="world-lending-hint">
        Tap a country to see the classroom lending rate. The map uses real world
        proportions (equirectangular). Rates are practice numbers for class —
        live lending comes later.
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
                <rect x="0" y="0" width={width} height={height} rx="24" />
              </clipPath>
            </defs>

            <rect
              x="0"
              y="0"
              width={width}
              height={height}
              rx="24"
              fill="url(#wlOcean)"
            />
            <rect
              x="0"
              y="0"
              width={width}
              height={height}
              rx="24"
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
                  aria-label={`${country.name}, ${rateLabel(country.ratePct)}`}
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
                  <dt>Term</dt>
                  <dd>{active.tenor}</dd>
                </div>
                <div>
                  <dt>Code</dt>
                  <dd>{active.id}</dd>
                </div>
              </dl>

              <button
                type="button"
                className="primary-btn world-lending-lend-btn"
                disabled
                title="Lending flow coming soon"
              >
                Lend cash — coming soon
              </button>
              <p className="world-lending-note">
                Map geography is real-world (Natural Earth). Rates are classroom
                placeholders until lending is wired up.
              </p>
            </>
          ) : (
            <div className="world-lending-empty">
              <strong>Pick a country</strong>
              <p>Select a pin on the map to compare classroom interest rates.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

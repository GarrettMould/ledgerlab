import { useEffect, useMemo, useState } from "react";
import {
  Area,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getPortfolioHistory } from "./api";
import { PIE_COLORS, buildAllocation } from "./portfolioAllocation";

function moneyExact(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function RefreshGlyph({ spinning }) {
  return (
    <svg
      className={spinning ? "refresh-icon spinning" : "refresh-icon"}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7c2.76 0 5 2.24 5 5a5 5 0 0 1-8.9 3.1L6.7 16.5A7.97 7.97 0 0 0 20 12c0-2.21-.9-4.21-2.35-5.65zM6 12c0-1.66.81-3.13 2.05-4.05L9.5 6.5A7.97 7.97 0 0 0 4 12c0 3.73 2.55 6.86 6 7.74V17.7A5.99 5.99 0 0 1 6 12z"
      />
    </svg>
  );
}

function PieGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none">
      <path
        d="M12 3a9 9 0 1 1-9 9h9V3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M13.2 3.15A9 9 0 0 1 20.85 10.8H13.2V3.15z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LineGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none">
      <path
        d="M4 19V5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M4 19h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7 15l3.2-3.6 2.6 2.2L17 8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function PortfolioHistoryChart({ studentId, refreshKey, portfolio, onRefresh }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("line"); // line | pie

  async function loadHistory() {
    if (!studentId) return;
    setLoading(true);
    setError("");
    try {
      const history = await getPortfolioHistory(studentId);
      setData(history);
    } catch (err) {
      setData(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, refreshKey]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      if (onRefresh) await onRefresh();
      await loadHistory();
    } finally {
      setRefreshing(false);
    }
  }

  const chartData = useMemo(() => {
    if (!data?.points) return [];
    // Keep one point per calendar day (last snapshot that day) so the path
    // doesn't sprout a vertex/notch for every trade/refresh.
    const byDay = new Map();
    const extras = [];
    for (const p of data.points) {
      if (p.future || p.value == null) {
        extras.push({ ...p, baseline: data.baseline });
        continue;
      }
      byDay.set(p.date || String(p.t), { ...p, baseline: data.baseline });
    }
    const daily = [...byDay.values()].sort((a, b) => a.t - b.t);
    // Drop intermediate flat vertices (same value).
    const simplified = [];
    for (let i = 0; i < daily.length; i += 1) {
      const p = daily[i];
      const prev = simplified[simplified.length - 1];
      const next = daily[i + 1];
      if (prev && next && prev.value === p.value && next.value === p.value) {
        continue;
      }
      simplified.push(p);
    }
    return [...simplified, ...extras].sort((a, b) => a.t - b.t);
  }, [data]);

  const allocation = useMemo(() => buildAllocation(portfolio), [portfolio]);

  const delta = data ? data.current - data.baseline : 0;
  const up = delta >= 0;

  return (
    <div className="stripe-chart">
      <div className="stripe-chart-head">
        <div>
          <p className="stripe-kicker">{mode === "pie" ? "Allocation" : "Account value"}</p>
          <h3 className="stripe-value">{moneyExact(data?.current ?? portfolio?.total_value)}</h3>
          {mode === "line" ? (
            <p className={up ? "stripe-delta up" : "stripe-delta down"}>
              {up ? "+" : ""}
              {moneyExact(delta)} vs ${data?.baseline?.toLocaleString() ?? "100,000"} start
            </p>
          ) : (
            <p className="stripe-delta">Share of cash, stocks, ETFs, bonds, commodities, and currencies</p>
          )}
        </div>
        <div className="stripe-icons">
          <button
            type="button"
            className="icon-btn stripe-icon-btn"
            data-click="select"
            onClick={handleRefresh}
            disabled={refreshing || loading}
            aria-label="Refresh portfolio chart"
            title="Refresh"
          >
            <RefreshGlyph spinning={refreshing} />
          </button>
          <button
            type="button"
            className={mode === "pie" ? "icon-btn stripe-icon-btn active" : "icon-btn stripe-icon-btn"}
            data-click="select"
            onClick={() => setMode((m) => (m === "pie" ? "line" : "pie"))}
            aria-label={mode === "pie" ? "Show line graph" : "Show pie chart"}
            title={mode === "pie" ? "Line graph" : "Pie chart"}
          >
            {mode === "pie" ? <LineGlyph /> : <PieGlyph />}
          </button>
        </div>
      </div>

      {loading && <p className="empty">Loading history…</p>}
      {error && <p className="banner error chart-error">{error}</p>}

      {!loading && mode === "line" && chartData.length > 0 && (
        <div className="stripe-chart-frame">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id="stripeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2f6b4f" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#2f6b4f" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                type="number"
                domain={[data.domain_start, data.domain_end]}
                tick={false}
                tickLine={false}
                axisLine={false}
                height={8}
              />
              <YAxis
                domain={[
                  (min) => Math.min(min ?? data.baseline, data.baseline) * 0.92,
                  (max) => Math.max(max ?? data.baseline, data.baseline) * 1.08,
                ]}
                width={52}
                tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
                tick={{ fill: "#8898aa", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={false}
                formatter={(value, name) => {
                  if (name === "baseline") return [moneyExact(value), "Starting balance"];
                  if (value == null) return ["—", "Future"];
                  return [moneyExact(value), "Account value"];
                }}
                labelFormatter={(t) =>
                  new Date(t * 1000).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                }
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid #e6ebf1",
                  boxShadow: "0 8px 24px rgba(50,50,93,0.12)",
                  background: "#fff",
                }}
              />
              <ReferenceLine
                y={data.baseline}
                stroke="#c1c9d2"
                strokeDasharray="4 4"
                label={{
                  value: "$100,000 start",
                  position: "insideTopLeft",
                  fill: "#8898aa",
                  fontSize: 11,
                }}
              />
              <ReferenceLine
                x={data.present_t}
                stroke="#a3acb9"
                strokeDasharray="3 3"
                label={{
                  value: "Today",
                  position: "insideTopRight",
                  fill: "#697386",
                  fontSize: 11,
                }}
              />
              {/* Fill only — stroking Area paths draws vertical edge notches. */}
              <Area
                type="linear"
                dataKey="value"
                stroke="none"
                fill="url(#stripeFill)"
                connectNulls={false}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="value"
                stroke="#2f6b4f"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                connectNulls={false}
                dot={false}
                activeDot={false}
                legendType="none"
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {!loading && mode === "pie" && (
        <div className="allocation-wrap">
          {allocation.length === 0 ? (
            <p className="empty">No balances to chart yet.</p>
          ) : (
            <>
              <div className="stripe-chart-frame pie-frame">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={allocation}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={58}
                      outerRadius={88}
                      paddingAngle={2}
                      stroke="#fff"
                      strokeWidth={2}
                    >
                      {allocation.map((row) => (
                        <Cell key={row.key} fill={PIE_COLORS[row.key]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name, item) => [
                        `${moneyExact(value)} (${item?.payload?.pct?.toFixed(1)}%)`,
                        name,
                      ]}
                      contentStyle={{
                        borderRadius: 10,
                        border: "1px solid #e6ebf1",
                        boxShadow: "0 8px 24px rgba(50,50,93,0.12)",
                        background: "#fff",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="allocation-legend">
                {allocation.map((row) => (
                  <li key={row.key}>
                    <span className="swatch" style={{ background: PIE_COLORS[row.key] }} />
                    <strong>{row.name}</strong>
                    <span>{row.pct.toFixed(1)}%</span>
                    <span>{moneyExact(row.value)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

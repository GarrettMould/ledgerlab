import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getChart } from "./api";

const CHART_RANGE = "1y";

function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatTick(dateStr) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

export default function PriceChart({ ticker, name }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const chart = await getChart(ticker, CHART_RANGE);
        if (!cancelled) setData(chart);
      } catch (err) {
        if (!cancelled) {
          setData(null);
          setError(err.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const up = (data?.change_pct ?? 0) >= 0;
  const stroke = up ? "#2f6b4f" : "#c0453a";

  return (
    <div className="price-chart">
      <div className="price-chart-head">
        <div>
          <strong>
            {ticker} · 1Y
            {name ? ` · ${name}` : ""}
          </strong>
          {data && (
            <p className={up ? "up" : "down"}>
              {money(data.start)} → {money(data.end)}{" "}
              ({data.change_pct >= 0 ? "+" : ""}
              {data.change_pct?.toFixed(2)}%)
            </p>
          )}
        </div>
      </div>

      {loading && <p className="empty">Loading chart…</p>}
      {error && (
        <p className="banner error chart-error">
          {error.includes("403") || error.toLowerCase().includes("access")
            ? "Chart history isn’t available on the free market-data plan right now."
            : error}
        </p>
      )}

      {!loading && data?.points?.length > 0 && (
        <div className="chart-frame">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`fill-${ticker}`} x1="0" y1="0" x2="0" y2="1">
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
                width={56}
                tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                tick={{ fill: "#5a6b78", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value) => [money(value), "Close"]}
                labelFormatter={(label) => label}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid rgba(20,33,43,0.12)",
                  background: "rgba(255,255,255,0.95)",
                }}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={stroke}
                fill={`url(#fill-${ticker})`}
                strokeWidth={2}
                dot={false}
                isAnimationActive
                animationDuration={500}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

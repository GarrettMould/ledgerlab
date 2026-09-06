import { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { PIE_COLORS, buildAllocation, sumPortfolioTotals } from "./portfolioAllocation";

function moneyExact(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function ClassAggregatePanel({
  className,
  portfolios,
  loading,
  onRefresh,
  refreshing,
}) {
  const allocation = useMemo(() => buildAllocation(portfolios), [portfolios]);
  const totals = useMemo(() => sumPortfolioTotals(portfolios), [portfolios]);
  const studentCount = portfolios?.length || 0;

  return (
    <div className="stripe-chart class-aggregate">
      <div className="stripe-chart-head">
        <div>
          <p className="stripe-kicker">Class portfolio</p>
          <h3 className="stripe-value">{moneyExact(totals.total)}</h3>
          <p className="stripe-delta">
            {studentCount} student{studentCount === 1 ? "" : "s"}
            {className ? ` · ${className}` : ""}
            {" · "}
            {moneyExact(totals.cash)} cash · {moneyExact(totals.invested)} invested
          </p>
        </div>
        <div className="stripe-icons">
          <button
            type="button"
            className="icon-btn stripe-icon-btn"
            data-click="select"
            onClick={onRefresh}
            disabled={refreshing || loading}
            aria-label="Refresh class totals"
            title="Refresh"
          >
            <svg
              className={refreshing ? "refresh-icon spinning" : "refresh-icon"}
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
          </button>
        </div>
      </div>

      {loading && <p className="empty">Loading class totals…</p>}

      {!loading && (
        <div className="allocation-wrap">
          {allocation.length === 0 ? (
            <p className="empty">No balances to chart yet. Add students and fund accounts.</p>
          ) : (
            <>
              <p className="class-alloc-label">How the class is invested</p>
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

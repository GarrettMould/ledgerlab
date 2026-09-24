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
              fill="none"
            >
              <path
                d="M4.5 12a7.5 7.5 0 0 1 12.6-5.5"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
              <path
                d="M19.5 12a7.5 7.5 0 0 1-12.6 5.5"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
              <path
                d="M16.2 3.8v3.4h-3.4"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M7.8 20.2v-3.4h3.4"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
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

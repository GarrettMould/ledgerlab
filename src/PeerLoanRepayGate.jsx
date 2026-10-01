import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getPeerLoans, settlePeerLoans } from "./api";

function money(n) {
  return Number(n || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/**
 * Auto-settles due peer loans when the borrower has cash.
 * If cash is short, blocks play until they sell assets and raise enough.
 */
export default function PeerLoanRepayGate({
  classId,
  studentId,
  cash = 0,
  refreshKey = "",
  onPortfolio,
  onGoSell,
}) {
  const [blocked, setBlocked] = useState([]);
  const [sellingMode, setSellingMode] = useState(false);
  const [checking, setChecking] = useState(false);
  const onPortfolioRef = useRef(onPortfolio);
  onPortfolioRef.current = onPortfolio;
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!classId || !studentId || inFlight.current) {
      if (!classId || !studentId) setBlocked([]);
      return;
    }
    inFlight.current = true;
    setChecking(true);
    try {
      const data = await settlePeerLoans(studentId, classId);
      if (data?.portfolio) onPortfolioRef.current?.(data.portfolio);
      const rows = Array.isArray(data?.blocked) ? data.blocked : [];
      setBlocked(rows);
      if (rows.length === 0) setSellingMode(false);
    } catch {
      try {
        const data = await getPeerLoans(studentId, classId);
        if (data?.portfolio) onPortfolioRef.current?.(data.portfolio);
        setBlocked(Array.isArray(data?.blocked) ? data.blocked : []);
      } catch {
        /* ignore */
      }
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, [classId, studentId]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const totalDue = useMemo(
    () =>
      blocked.reduce(
        (sum, row) => sum + (Number(row?.loan?.totalDue) || 0),
        0
      ),
    [blocked]
  );
  const shortfall = useMemo(
    () =>
      blocked.reduce((sum, row) => sum + (Number(row?.shortfall) || 0), 0),
    [blocked]
  );
  const cashNow = Number.isFinite(Number(cash))
    ? Number(cash)
    : Number(blocked[0]?.cash) || 0;

  if (!blocked.length) return null;

  const need = Math.max(0, shortfall || totalDue - cashNow);
  const sticky = (
    <div className="peer-loan-gate-sticky" role="status">
      <div className="peer-loan-gate-sticky-copy">
        <p className="peer-loan-gate-sticky-kicker">Loan overdue</p>
        <p className="peer-loan-gate-sticky-title">
          Still owe <strong>{money(totalDue)}</strong>
        </p>
        <p className="peer-loan-gate-sticky-blurb">
          Sell holdings until you have {money(need)} more. Repayment runs
          automatically when your cash covers it.
        </p>
      </div>
      <button
        type="button"
        className="primary-btn peer-loan-gate-sticky-btn"
        data-click="confirm"
        disabled={checking}
        onClick={refresh}
      >
        {checking ? "Checking…" : "I sold — check cash"}
      </button>
    </div>
  );

  if (sellingMode) {
    return createPortal(sticky, document.body);
  }

  const modal = (
    <div className="peer-loan-gate-overlay" role="presentation">
      <div
        className="peer-loan-gate-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="peer-loan-gate-title"
      >
        <p className="peer-loan-gate-kicker">Payment due</p>
        <h3 id="peer-loan-gate-title">You must repay your classmate loan</h3>
        <p className="peer-loan-gate-lead">
          Payback day is here. We repay automatically when you have enough cash —
          you don’t have enough yet, so sell assets first.
        </p>

        <ul className="peer-loan-gate-list">
          {blocked.map((row) => {
            const loan = row.loan || {};
            return (
              <li key={loan.id || loan.lenderName}>
                <strong>{money(loan.totalDue)}</strong>
                <span>
                  owed to {loan.lenderName || "classmate"}
                  {loan.dueLabel ? ` · due ${loan.dueLabel}` : ""}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="peer-loan-gate-math">
          <div>
            <span>Cash now</span>
            <strong>{money(cashNow)}</strong>
          </div>
          <div>
            <span>Still need</span>
            <strong className="is-short">{money(shortfall || totalDue - cashNow)}</strong>
          </div>
        </div>

        <button
          type="button"
          className="primary-btn"
          data-click="confirm"
          onClick={() => {
            setSellingMode(true);
            onGoSell?.();
          }}
        >
          Sell assets to raise cash
        </button>
        <button
          type="button"
          className="ghost-btn peer-loan-gate-recheck"
          data-click="select"
          disabled={checking}
          onClick={refresh}
        >
          {checking ? "Checking…" : "I sold — check my cash"}
        </button>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

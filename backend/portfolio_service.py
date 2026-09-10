"""Storage-agnostic student portfolio helpers used by Flask routes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable

import firestore_ledger as fs_ledger

QuoteBatch = Callable[[list[str]], dict[str, tuple[float | None, float | None]]]


def using_firestore() -> bool:
    return fs_ledger.is_configured()


def serialize_portfolio(
    student: dict,
    holdings: list[dict],
    *,
    with_portfolio: bool,
    realestate_by_ticker: dict,
    fetch_quotes_batch: QuoteBatch,
) -> dict:
    quotes: dict = {}
    if with_portfolio and holdings:
        quotes = fetch_quotes_batch([h["ticker"] for h in holdings])

    portfolio_value = 0.0
    mortgage_debt = 0.0
    holding_payload = []
    for h in holdings:
        ticker = h["ticker"]
        is_home = ticker in realestate_by_ticker
        price = quotes.get(ticker, (None, None))[0] if with_portfolio else None
        if with_portfolio and price is None:
            price = float(h["avg_cost"])
        shares = float(h["shares"])
        market_value = (price * shares) if price is not None and with_portfolio else None
        mortgage_balance = float(h.get("mortgage_balance") or 0)
        mortgage_debt += mortgage_balance
        if market_value is not None:
            portfolio_value += market_value
        cost_basis = float(h["avg_cost"]) * shares
        if is_home:
            purchase_price = float(h["avg_cost"])
            cash_in = (purchase_price - mortgage_balance) + float(h.get("closing_paid") or 0)
            equity = (market_value - mortgage_balance) if market_value is not None else None
            gain_loss = (equity - cash_in) if equity is not None else None
            gain_loss_pct = (
                (gain_loss / cash_in) * 100 if gain_loss is not None and cash_in > 0 else None
            )
            cost_basis = cash_in
        else:
            gain_loss = (market_value - cost_basis) if market_value is not None else None
            gain_loss_pct = (
                ((market_value - cost_basis) / cost_basis) * 100
                if market_value is not None and cost_basis > 0
                else None
            )
            equity = market_value

        payload = {
            "ticker": ticker,
            "shares": round(shares, 4),
            "avg_cost": round(float(h["avg_cost"]), 2),
            "cost_basis": round(cost_basis, 2),
            "price": round(price, 2) if price is not None and with_portfolio else None,
            "market_value": round(market_value, 2) if market_value is not None else None,
            "gain_loss": round(gain_loss, 2) if gain_loss is not None else None,
            "gain_loss_pct": round(gain_loss_pct, 2) if gain_loss_pct is not None else None,
            "asset_type": "realestate" if is_home else None,
        }
        if is_home:
            home = realestate_by_ticker.get(ticker) or {}
            payload.update(
                {
                    "name": home.get("name") or ticker,
                    "mortgage_balance": round(mortgage_balance, 2),
                    "mortgage_rate_pct": h.get("mortgage_rate_pct"),
                    "loan_years": h.get("loan_years"),
                    "closing_paid": round(float(h.get("closing_paid") or 0), 2),
                    "equity": round(equity, 2) if equity is not None else None,
                }
            )
        holding_payload.append(payload)

    cash = float(student["cash"])
    total = cash + portfolio_value - mortgage_debt if with_portfolio else cash
    return {
        "id": student["id"],
        "name": student["name"],
        "cash": round(cash, 2),
        "portfolio_value": round(portfolio_value, 2) if with_portfolio else None,
        "mortgage_debt": round(mortgage_debt, 2) if with_portfolio else None,
        "total_value": round(total, 2) if with_portfolio else round(cash, 2),
        "holdings_count": len(holdings),
        "holdings": holding_payload if with_portfolio else None,
        "created_at": student.get("created_at"),
        "class_id": student.get("class_id"),
        "ledger": "firestore" if using_firestore() else "sqlite",
    }


def compute_totals(
    student: dict,
    holdings: list[dict],
    fetch_quotes_batch: QuoteBatch,
) -> tuple[float, float, float]:
    cash = float(student["cash"])
    portfolio_value = 0.0
    mortgage_debt = 0.0
    if holdings:
        quotes = fetch_quotes_batch([h["ticker"] for h in holdings])
        for h in holdings:
            price = quotes.get(h["ticker"], (None, None))[0]
            if price is not None:
                portfolio_value += price * float(h["shares"])
            else:
                portfolio_value += float(h["avg_cost"]) * float(h["shares"])
            mortgage_debt += float(h.get("mortgage_balance") or 0)
    return cash, portfolio_value, cash + portfolio_value - mortgage_debt


def record_fs_snapshot(
    class_id: str,
    student_id: str,
    student: dict,
    holdings: list[dict],
    fetch_quotes_batch: QuoteBatch,
    *,
    cash: float | None = None,
    portfolio_value: float | None = None,
    total_value: float | None = None,
    recorded_at: str | None = None,
) -> None:
    if cash is None or portfolio_value is None or total_value is None:
        cash, portfolio_value, total_value = compute_totals(
            student, holdings, fetch_quotes_batch
        )
    fs_ledger.add_snapshot(
        class_id,
        student_id,
        cash=cash,
        portfolio_value=portfolio_value,
        total_value=total_value,
        recorded_at=recorded_at,
    )


def ensure_fs_starting_snapshot(class_id: str, student: dict) -> None:
    existing = fs_ledger.list_snapshots(class_id, student["id"])
    if existing:
        return
    cash = float(student["cash"])
    fs_ledger.add_snapshot(
        class_id,
        student["id"],
        cash=cash,
        portfolio_value=0.0,
        total_value=cash,
        recorded_at=student.get("created_at"),
    )


def build_history_payload(
    student_id,
    snaps: list[dict],
    *,
    baseline: float,
    utc_now_fn,
) -> dict:
    def parse_ts(value: str) -> datetime:
        try:
            return datetime.fromisoformat(value)
        except Exception:
            return datetime.now(timezone.utc)

    points = []
    for s in snaps:
        ts = parse_ts(s["recorded_at"])
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        points.append(
            {
                "t": int(ts.timestamp()),
                "date": ts.strftime("%Y-%m-%d"),
                "label": ts.strftime("%b %d"),
                "value": round(float(s["total_value"]), 2),
                "cash": round(float(s["cash"]), 2),
                "portfolio_value": round(float(s["portfolio_value"]), 2),
                "future": False,
            }
        )

    if not points:
        now = datetime.now(timezone.utc)
        points = [
            {
                "t": int(now.timestamp()),
                "date": now.strftime("%Y-%m-%d"),
                "label": now.strftime("%b %d"),
                "value": baseline,
                "cash": baseline,
                "portfolio_value": 0,
                "future": False,
            }
        ]

    start_ts = points[0]["t"]
    present_ts = points[-1]["t"]
    min_half = 7 * 24 * 3600
    half = max(present_ts - start_ts, min_half)
    domain_start = present_ts - half
    domain_end = present_ts + half

    if points[0]["t"] > domain_start:
        points.insert(
            0,
            {
                "t": domain_start,
                "date": datetime.fromtimestamp(domain_start, timezone.utc).strftime("%Y-%m-%d"),
                "label": "Start",
                "value": baseline,
                "cash": baseline,
                "portfolio_value": 0,
                "future": False,
            },
        )

    points.append(
        {
            "t": domain_end,
            "date": datetime.fromtimestamp(domain_end, timezone.utc).strftime("%Y-%m-%d"),
            "label": "Future",
            "value": None,
            "cash": None,
            "portfolio_value": None,
            "future": True,
        }
    )

    current = next((p["value"] for p in reversed(points) if p["value"] is not None), baseline)
    return {
        "student_id": student_id,
        "baseline": baseline,
        "current": current,
        "present_t": present_ts,
        "domain_start": domain_start,
        "domain_end": domain_end,
        "points": points,
    }

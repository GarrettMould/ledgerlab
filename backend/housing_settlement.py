"""Monthly rent vs mortgage settlement for classroom homes."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Callable


def month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def add_one_month(d: date) -> date:
    if d.month == 12:
        return date(d.year + 1, 1, 1)
    return date(d.year, d.month + 1, 1)


def parse_month_start(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return month_start(value.date())
    if isinstance(value, date):
        return month_start(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        if "T" in text:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
            return month_start(dt.date())
        parts = text[:10].split("-")
        if len(parts) >= 2:
            return date(int(parts[0]), int(parts[1]), 1)
    except Exception:
        return None
    return None


def iso_month(d: date) -> str:
    return month_start(d).isoformat()


def fixed_monthly_payment(price: float, rate_pct: float, down_pct: float, years: int) -> float:
    principal = float(price) * (1.0 - float(down_pct) / 100.0)
    if principal <= 0:
        return 0.0
    months = max(1, int(years) * 12)
    monthly_rate = float(rate_pct) / 100.0 / 12.0
    if monthly_rate <= 0:
        return principal / months
    factor = (1.0 + monthly_rate) ** months
    return principal * (monthly_rate * factor) / (factor - 1.0)


def settle_one_month(
    *,
    balance: float,
    rate_pct: float,
    monthly_payment: float,
    monthly_rent: float,
    cash: float,
) -> tuple[float, float]:
    """
    Apply one month: cash += rent - payment (floor 0), amortize mortgage.
    Returns (new_cash, new_balance).
    """
    bal = max(0.0, float(balance))
    payment = max(0.0, float(monthly_payment))
    rent = max(0.0, float(monthly_rent))
    rate = float(rate_pct or 0) / 100.0 / 12.0

    if bal <= 0:
        actual_payment = 0.0
        principal_paid = 0.0
    else:
        interest = bal * rate
        if payment >= bal + interest:
            principal_paid = bal
            actual_payment = bal + interest
        else:
            principal_paid = min(max(payment - interest, 0.0), bal)
            actual_payment = payment
        bal = max(0.0, bal - principal_paid)

    new_cash = max(0.0, float(cash) + (rent - actual_payment))
    return new_cash, bal


def months_due(last_settled: date, *, today: date | None = None) -> list[date]:
    """Full calendar months after last_settled through the previous month."""
    today = today or datetime.now(timezone.utc).date()
    through = month_start(today)
    if through.month == 1:
        through = date(through.year - 1, 12, 1)
    else:
        through = date(through.year, through.month - 1, 1)

    cursor = add_one_month(month_start(last_settled))
    due: list[date] = []
    for _ in range(36):
        if cursor > through:
            break
        due.append(cursor)
        cursor = add_one_month(cursor)
    return due


def apply_housing_settlement_to_holdings(
    holdings: list[dict],
    cash: float,
    *,
    is_home: Callable[[str], bool],
    catalog_home: Callable[[str], dict | None],
    today: date | None = None,
) -> tuple[float, list[dict], bool]:
    """
    Mutate holdings in place; return (new_cash, holdings, changed).
    """
    today = today or datetime.now(timezone.utc).date()
    changed = False
    new_cash = float(cash)

    for h in holdings:
        ticker = str(h.get("ticker") or "")
        if not is_home(ticker):
            continue
        home = catalog_home(ticker) or {}

        rate = float(
            h["mortgage_rate_pct"]
            if h.get("mortgage_rate_pct") is not None
            else home.get("mortgage_rate_pct")
            or 0
        )
        years = int(
            h["loan_years"]
            if h.get("loan_years") is not None
            else home.get("loan_years")
            or 30
        )
        down_pct = float(home.get("down_payment_pct") or 20)
        purchase_price = float(h.get("avg_cost") or home.get("price") or 0)

        rent = h.get("monthly_rent")
        if rent is None:
            rent = float(home.get("monthly_rent") or 0)
            h["monthly_rent"] = round(float(rent), 2)
            changed = True
        else:
            rent = float(rent)

        payment = h.get("monthly_payment")
        if payment is None or float(payment or 0) <= 0:
            payment = fixed_monthly_payment(purchase_price, rate, down_pct, years)
            h["monthly_payment"] = round(float(payment), 2)
            changed = True
        else:
            payment = float(payment)

        last = parse_month_start(h.get("last_rent_settled"))
        if last is None:
            h["last_rent_settled"] = iso_month(today)
            changed = True
            continue

        due = months_due(last, today=today)
        if not due:
            continue

        balance = float(h.get("mortgage_balance") or 0)
        for settled_month in due:
            new_cash, balance = settle_one_month(
                balance=balance,
                rate_pct=rate,
                monthly_payment=payment,
                monthly_rent=rent,
                cash=new_cash,
            )
            last = settled_month
            changed = True

        h["mortgage_balance"] = round(balance, 2)
        h["last_rent_settled"] = iso_month(last)

    return new_cash, holdings, changed

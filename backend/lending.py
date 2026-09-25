"""Classroom country lending: loans pay monthly interest until the class horizon.

Loans are in U.S. dollars, so rates track each country's dollar-bond yield
(no currency risk; default is the risk). Each monthly payment is decided
server-side when it comes due (paid vs default) so students can't reload the
page to re-spin. A default skips that month's interest; a default on the final
payment also returns only RECOVERY_PCT of the principal.

Loans can be sold early at a market price that falls with the country's risk
and with every missed payment.
"""

from __future__ import annotations

import calendar
import os
import random
from datetime import datetime, timedelta, timezone

# Keep in sync with src/data/worldLending.js (server is the source of truth).
COUNTRIES: dict[str, dict] = {
    "US": {"name": "United States", "rate_pct": 4.3, "default_pct": 1.0},
    "BR": {"name": "Brazil", "rate_pct": 7.0, "default_pct": 6.0},
    "GB": {"name": "United Kingdom", "rate_pct": 4.0, "default_pct": 2.0},
    "DE": {"name": "Germany", "rate_pct": 2.8, "default_pct": 1.5},
    "NG": {"name": "Nigeria", "rate_pct": 9.5, "default_pct": 8.0},
    "IN": {"name": "India", "rate_pct": 6.0, "default_pct": 4.0},
    "IL": {"name": "Israel", "rate_pct": 5.5, "default_pct": 3.0},
    "JP": {"name": "Japan", "rate_pct": 0.5, "default_pct": 1.2},
    "AU": {"name": "Australia", "rate_pct": 4.1, "default_pct": 2.2},
    "TR": {"name": "Turkey", "rate_pct": 8.0, "default_pct": 7.0},
    "AR": {"name": "Argentina", "rate_pct": 11.0, "default_pct": 10.0},
}

HORIZON = datetime(2027, 5, 15, 23, 59, 59, tzinfo=timezone.utc)
MIN_LOAN = 100.0
# Share of principal returned when the final payment defaults.
RECOVERY_PCT = 75.0
# Market price: principal × (1 − default risk − this per missed payment), floored.
SALE_DISCOUNT_PER_MISS_PCT = 5.0
SALE_FLOOR_PCT = 50.0


def _test_minutes_per_month() -> float | None:
    """LENDING_TEST_MINUTES_PER_MONTH=2 makes each 'month' 2 minutes (local testing)."""
    raw = (os.environ.get("LENDING_TEST_MINUTES_PER_MONTH") or "").strip()
    try:
        val = float(raw)
    except ValueError:
        return None
    return val if val > 0 else None


def add_months(dt: datetime, months: int) -> datetime:
    total = dt.month - 1 + months
    year = dt.year + total // 12
    month = total % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def total_payments(lent_at: datetime) -> int:
    """Monthly payments that fall on or before the class horizon."""
    n = 0
    while add_months(lent_at, n + 1) <= HORIZON:
        n += 1
    return n


def due_at(lent_at: datetime, payment_number: int) -> datetime:
    minutes = _test_minutes_per_month()
    if minutes:
        return lent_at + timedelta(minutes=minutes * payment_number)
    return add_months(lent_at, payment_number)


def monthly_interest(principal: float, rate_pct: float) -> float:
    return round(float(principal) * float(rate_pct) / 100.0 / 12.0, 2)


def parse_iso(value) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def roll_default(default_pct: float, rng: random.Random | None = None) -> bool:
    r = (rng or random).random()
    return r < float(default_pct) / 100.0


def next_pending(loan: dict, now: datetime) -> dict | None:
    """If the next unpaid month is due, decide it and return the pending record."""
    if loan.get("status") != "active" or loan.get("pending"):
        return None
    handled = int(loan.get("paymentsHandled") or 0)
    total = int(loan.get("totalPayments") or 0)
    if handled >= total:
        return None
    n = handled + 1
    lent_at = parse_iso(loan["lentAt"])
    due = due_at(lent_at, n)
    if due > now:
        return None
    defaulted = roll_default(loan["defaultPct"])
    final = n >= total
    principal = float(loan["principal"])
    if not final:
        principal_back = 0.0
    elif defaulted:
        principal_back = round(principal * RECOVERY_PCT / 100.0, 2)
    else:
        principal_back = principal
    return {
        "n": n,
        "outcome": "default" if defaulted else "paid",
        "interest": 0.0 if defaulted else monthly_interest(principal, loan["ratePct"]),
        "principalReturned": principal_back,
        "principalLost": round(principal - principal_back, 2) if final else 0.0,
        "final": final,
        "dueAt": due.isoformat(),
        "decidedAt": now.isoformat(),
    }


def next_due_at(loan: dict) -> str | None:
    if loan.get("status") != "active":
        return None
    handled = int(loan.get("paymentsHandled") or 0)
    total = int(loan.get("totalPayments") or 0)
    if handled >= total:
        return None
    return due_at(parse_iso(loan["lentAt"]), handled + 1).isoformat()


def missed_count(loan: dict) -> int:
    return sum(1 for p in (loan.get("payments") or []) if p.get("outcome") == "default")


def sale_price(loan: dict) -> float:
    """What another investor would pay for this loan right now."""
    discount = float(loan["defaultPct"]) + SALE_DISCOUNT_PER_MISS_PCT * missed_count(loan)
    pct = max(SALE_FLOOR_PCT, 100.0 - discount)
    return round(float(loan["principal"]) * pct / 100.0, 2)


def serialize_loan(loan: dict) -> dict:
    payments = list(loan.get("payments") or [])
    active = (loan.get("status") or "active") == "active"
    return {
        "id": loan["id"],
        "countryId": loan["countryId"],
        "countryName": loan["countryName"],
        "principal": round(float(loan["principal"]), 2),
        "ratePct": float(loan["ratePct"]),
        "defaultPct": float(loan["defaultPct"]),
        "monthlyInterest": monthly_interest(loan["principal"], loan["ratePct"]),
        "lentAt": loan["lentAt"],
        "status": loan.get("status") or "active",
        "totalPayments": int(loan.get("totalPayments") or 0),
        "paymentsHandled": int(loan.get("paymentsHandled") or 0),
        "paidCount": sum(1 for p in payments if p.get("outcome") == "paid"),
        "missedCount": sum(1 for p in payments if p.get("outcome") == "default"),
        "interestEarned": round(sum(float(p.get("interest") or 0) for p in payments), 2),
        "nextDueAt": next_due_at(loan),
        "pending": loan.get("pending") or None,
        "payments": payments,
        "salePrice": sale_price(loan) if active else None,
        "soldFor": loan.get("soldFor"),
        "principalReturned": loan.get("principalReturned"),
        "principalLost": loan.get("principalLost"),
    }

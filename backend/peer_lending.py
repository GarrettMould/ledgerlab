"""Classroom peer lending: classmates lend cash at a term rate.

Payback is always five days before the class contest end (default May 15, 2027
→ due May 10). Rate is total interest for the loan term (not annual).
Example: lend $100 at 7% → borrower repays $107 on the payback date.

Local walkthrough (backend/.env):
  PEER_LEND_TEST=1
  PEER_LEND_TEST_MINUTES=2   # optional: new loans due N minutes after borrow
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone

MIN_OFFER = 50.0
MIN_BORROW = 1.0
MAX_RATE_PCT = 50.0
TREASURY_ID = "peer-lend-lab"
TREASURY_NAME = "Lending Lab"

DEFAULT_CONTEST_END = date(2027, 5, 15)
PEER_LOAN_DAYS_BEFORE_END = 5


def parse_contest_end(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        d = value.date() if value.tzinfo else value.replace(tzinfo=timezone.utc).date()
        return d
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    raw = str(value).strip()
    if not raw:
        return None
    try:
        if "T" in raw or raw.endswith("Z"):
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return dt.date()
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def contest_end_date(value=None) -> date:
    return parse_contest_end(value) or DEFAULT_CONTEST_END


def format_contest_label(value=None) -> str:
    d = contest_end_date(value)
    return f"{d.strftime('%B')} {d.day}, {d.year}"


def due_date_from_contest_end(contest_end=None) -> date:
    return contest_end_date(contest_end) - timedelta(days=PEER_LOAN_DAYS_BEFORE_END)


def due_at_from_contest_end(contest_end=None) -> datetime:
    d = due_date_from_contest_end(contest_end)
    return datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=timezone.utc)


def format_month_day(value) -> str:
    if isinstance(value, datetime):
        d = value.date()
    elif isinstance(value, date):
        d = value
    else:
        d = parse_contest_end(value) or due_date_from_contest_end()
    return f"{d.strftime('%b')} {d.day}"


# Default class (May 15, 2027) → classmate loans due May 10.
DUE_AT = due_at_from_contest_end()


def test_mode_enabled() -> bool:
    return (os.environ.get("PEER_LEND_TEST") or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def test_minutes() -> float | None:
    raw = (os.environ.get("PEER_LEND_TEST_MINUTES") or "").strip()
    try:
        val = float(raw)
    except ValueError:
        return None
    return val if val >= 0 else None


def due_at(contest_end=None) -> datetime:
    """Class payback datetime (contest end minus 5 days), with env overrides for testing."""
    raw = (os.environ.get("PEER_LEND_DUE_AT") or "").strip()
    if raw:
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            pass
    if (os.environ.get("PEER_LEND_FORCE_DUE") or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    ):
        return datetime.now(timezone.utc)
    return due_at_from_contest_end(contest_end)


def due_at_for_new_loan(*, lent_at: datetime | None = None, contest_end=None) -> datetime:
    """Due date for a newly created loan (supports short test timers)."""
    start = lent_at or datetime.now(timezone.utc)
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    minutes = test_minutes()
    if test_mode_enabled() and minutes is not None:
        return start + timedelta(minutes=minutes)
    return due_at(contest_end)


def due_label(contest_end=None) -> str:
    minutes = test_minutes()
    if test_mode_enabled() and minutes is not None:
        if minutes <= 0:
            return "now (test)"
        if minutes < 1:
            secs = max(1, int(round(minutes * 60)))
            return f"in {secs}s (test)"
        if minutes == 1:
            return "in 1 min (test)"
        return f"in {minutes:g} min (test)"
    return format_month_day(due_date_from_contest_end(contest_end))


def interest_due(principal: float, rate_pct: float) -> float:
    return round(max(0.0, float(principal)) * max(0.0, float(rate_pct)) / 100.0, 2)


def total_due(principal: float, rate_pct: float) -> float:
    p = round(max(0.0, float(principal)), 2)
    return round(p + interest_due(p, rate_pct), 2)


def parse_due(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def is_due(loan: dict, *, now: datetime | None = None, contest_end=None) -> bool:
    when = now or datetime.now(timezone.utc)
    minutes = test_minutes()
    if test_mode_enabled() and minutes is not None:
        due = parse_due(loan.get("dueAt"))
    else:
        due = due_at(contest_end)
    if not due:
        due = parse_due(loan.get("dueAt"))
    if not due:
        return False
    return when >= due


def serialize_offer(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "lenderStudentId": row.get("lenderStudentId"),
        "lenderName": row.get("lenderName") or "Student",
        "amountListed": float(row.get("amountListed") or 0),
        "amountRemaining": float(row.get("amountRemaining") or 0),
        "ratePct": float(row.get("ratePct") or 0),
        "status": row.get("status") or "open",
        "createdAt": row.get("createdAt"),
        "updatedAt": row.get("updatedAt"),
        "testOffer": bool(row.get("testOffer")),
    }


def loan_due_label(row: dict, *, contest_end=None) -> str:
    """Label for this loan's dueAt (not the global test timer)."""
    due = parse_due(row.get("dueAt"))
    if not due:
        return due_label(contest_end)
    now = datetime.now(timezone.utc)
    class_due = due_at(contest_end)
    # Class payback / multi-day loans: show calendar-style label.
    if due.date() >= class_due.date() or (due - now).total_seconds() > 24 * 3600:
        return format_month_day(due_date_from_contest_end(contest_end))
    if is_due(row, now=now, contest_end=contest_end):
        return "now (test)" if test_mode_enabled() else "due now"
    mins = max(0.0, (due - now).total_seconds() / 60.0)
    if mins < 1:
        return f"in {max(1, int(round(mins * 60)))}s (test)"
    if mins < 90:
        return f"in {mins:g} min (test)" if mins != 1 else "in 1 min (test)"
    return due_label(contest_end)


def serialize_loan(row: dict, *, contest_end=None) -> dict:
    principal = float(row.get("principal") or 0)
    rate = float(row.get("ratePct") or 0)
    interest = float(row.get("interestDue") or interest_due(principal, rate))
    total = float(row.get("totalDue") or round(principal + interest, 2))
    return {
        "id": row.get("id"),
        "offerId": row.get("offerId"),
        "borrowerStudentId": row.get("borrowerStudentId"),
        "borrowerName": row.get("borrowerName") or "Student",
        "lenderStudentId": row.get("lenderStudentId"),
        "lenderName": row.get("lenderName") or "Student",
        "principal": principal,
        "ratePct": rate,
        "interestDue": interest,
        "totalDue": total,
        "lentAt": row.get("lentAt"),
        "dueAt": row.get("dueAt"),
        "dueLabel": loan_due_label(row, contest_end=contest_end),
        "status": row.get("status") or "active",
        "repaidAt": row.get("repaidAt"),
        "role": row.get("role"),
    }


def test_status() -> dict:
    minutes = test_minutes()
    return {
        "enabled": test_mode_enabled(),
        "testMinutes": minutes,
        "forceDue": (os.environ.get("PEER_LEND_FORCE_DUE") or "").strip().lower()
        in ("1", "true", "yes", "on"),
        "dueLabel": due_label(),
        "treasuryId": TREASURY_ID,
        "treasuryName": TREASURY_NAME,
    }

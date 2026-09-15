"""Firestore-backed classroom ledger (cash, holdings, snapshots).

Uses the Firebase Admin SDK. Configure with one of:
  - FIREBASE_SERVICE_ACCOUNT_JSON  (full JSON string — good for Vercel)
  - GOOGLE_APPLICATION_CREDENTIALS (path to service-account JSON file)
  - FIREBASE_SERVICE_ACCOUNT_PATH  (alias for the file path)

Project id from FIREBASE_PROJECT_ID or VITE_FIREBASE_PROJECT_ID.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

_db = None
_init_error: str | None = None


def _project_id() -> str | None:
    return (
        os.environ.get("FIREBASE_PROJECT_ID")
        or os.environ.get("VITE_FIREBASE_PROJECT_ID")
        or None
    )


def _init_app():
    global _db, _init_error
    if _db is not None:
        return _db
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError as exc:
        _init_error = f"firebase-admin not installed: {exc}"
        return None

    # If a previous request already initialized the default app (common under
    # concurrent Vercel workers), just attach to it — don't treat it as fatal.
    if firebase_admin._apps:
        try:
            _db = firestore.client()
            _init_error = None
            return _db
        except Exception as exc:
            _init_error = str(exc)
            _db = None
            return None

    try:
        cred = None
        raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
        path = (
            os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH")
            or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
            or ""
        ).strip()
        if raw:
            info = json.loads(raw)
            cred = credentials.Certificate(info)
        elif path and os.path.isfile(path):
            cred = credentials.Certificate(path)
        if cred is None:
            _init_error = (
                "Firestore ledger needs FIREBASE_SERVICE_ACCOUNT_JSON "
                "or GOOGLE_APPLICATION_CREDENTIALS"
            )
            return None
        opts = {}
        pid = _project_id()
        if pid:
            opts["projectId"] = pid
        firebase_admin.initialize_app(cred, opts or None)
        _db = firestore.client()
        _init_error = None
        return _db
    except Exception as exc:
        msg = str(exc)
        # Race: another worker initialized between our _apps check and initialize_app.
        if firebase_admin._apps and "already exists" in msg.lower():
            try:
                _db = firestore.client()
                _init_error = None
                return _db
            except Exception as inner:
                _init_error = str(inner)
                _db = None
                return None
        _init_error = msg
        _db = None
        return None


def is_configured() -> bool:
    return _init_app() is not None


def config_error() -> str | None:
    _init_app()
    return _init_error


def db():
    client = _init_app()
    if client is None:
        raise RuntimeError(config_error() or "Firestore not configured")
    return client


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def student_ref(class_id: str, student_id: str):
    return db().collection("classes").document(class_id).collection("students").document(student_id)


def holdings_col(class_id: str, student_id: str):
    return student_ref(class_id, student_id).collection("holdings")


def snapshots_col(class_id: str, student_id: str):
    return student_ref(class_id, student_id).collection("snapshots")


def get_student(class_id: str, student_id: str) -> dict | None:
    snap = student_ref(class_id, student_id).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    created = data.get("createdAt")
    if hasattr(created, "isoformat"):
        created_at = created.isoformat()
    elif isinstance(created, str):
        created_at = created
    else:
        created_at = data.get("created_at") or utc_now_iso()
    return {
        "id": snap.id,
        "name": data.get("name") or "Student",
        "cash": float(data.get("cash") or 0),
        "created_at": created_at,
        "auth_uid": data.get("authUid"),
        "class_id": class_id,
        "last_total_value": (
            float(data["lastTotalValue"])
            if data.get("lastTotalValue") is not None
            else None
        ),
        "last_portfolio_value": (
            float(data["lastPortfolioValue"])
            if data.get("lastPortfolioValue") is not None
            else None
        ),
    }


def list_students(class_id: str) -> list[dict]:
    snaps = (
        db()
        .collection("classes")
        .document(class_id)
        .collection("students")
        .stream()
    )
    out = []
    for snap in snaps:
        data = snap.to_dict() or {}
        created = data.get("createdAt")
        if hasattr(created, "isoformat"):
            created_at = created.isoformat()
        elif isinstance(created, str):
            created_at = created
        else:
            created_at = utc_now_iso()
        out.append(
            {
                "id": snap.id,
                "name": data.get("name") or "Student",
                "cash": float(data.get("cash") or 0),
                "created_at": created_at,
                "auth_uid": data.get("authUid"),
                "class_id": class_id,
                "holdings_count": int(data.get("holdingsCount") or 0),
                "last_total_value": (
                    float(data["lastTotalValue"])
                    if data.get("lastTotalValue") is not None
                    else None
                ),
                "last_portfolio_value": (
                    float(data["lastPortfolioValue"])
                    if data.get("lastPortfolioValue") is not None
                    else None
                ),
            }
        )
    out.sort(key=lambda s: (s["name"] or "").lower())
    return out


def ensure_student(
    class_id: str,
    student_id: str,
    *,
    name: str,
    cash: float,
    auth_uid: str | None = None,
) -> dict:
    ref = student_ref(class_id, student_id)
    snap = ref.get()
    from firebase_admin import firestore as fs

    if snap.exists:
        patch: dict[str, Any] = {
            "apiStudentId": student_id,
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
        data = snap.to_dict() or {}
        if data.get("cash") is None:
            patch["cash"] = float(cash)
        if name and not data.get("name"):
            patch["name"] = name
        if auth_uid and not data.get("authUid"):
            patch["authUid"] = auth_uid
        if patch:
            ref.update(patch)
        return get_student(class_id, student_id)  # type: ignore[return-value]

    payload = {
        "name": name,
        "cash": float(cash),
        "apiStudentId": student_id,
        "holdingsCount": 0,
        "authUid": auth_uid,
        "createdAt": fs.SERVER_TIMESTAMP,
        "updatedAt": fs.SERVER_TIMESTAMP,
    }
    ref.set(payload, merge=True)
    return get_student(class_id, student_id)  # type: ignore[return-value]


def set_cash(class_id: str, student_id: str, cash: float, *, holdings_count: int | None = None) -> None:
    from firebase_admin import firestore as fs

    patch: dict[str, Any] = {
        "cash": float(cash),
        "apiStudentId": student_id,
        "updatedAt": fs.SERVER_TIMESTAMP,
    }
    if holdings_count is not None:
        patch["holdingsCount"] = int(holdings_count)
    student_ref(class_id, student_id).update(patch)


def set_last_totals(
    class_id: str,
    student_id: str,
    *,
    cash: float,
    portfolio_value: float,
    total_value: float,
    holdings_count: int | None = None,
) -> None:
    """Cache standings-friendly totals on the student doc (no live quotes needed later)."""
    from firebase_admin import firestore as fs

    patch: dict[str, Any] = {
        "cash": float(cash),
        "lastTotalValue": float(total_value),
        "lastPortfolioValue": float(portfolio_value),
        "apiStudentId": student_id,
        "updatedAt": fs.SERVER_TIMESTAMP,
    }
    if holdings_count is not None:
        patch["holdingsCount"] = int(holdings_count)
    student_ref(class_id, student_id).update(patch)


def list_holdings(class_id: str, student_id: str) -> list[dict]:
    snaps = holdings_col(class_id, student_id).stream()
    rows = []
    for snap in snaps:
        data = snap.to_dict() or {}
        rows.append(
            {
                "ticker": snap.id,
                "shares": float(data.get("shares") or 0),
                "avg_cost": float(data.get("avgCost") or data.get("avg_cost") or 0),
                "mortgage_balance": float(
                    data.get("mortgageBalance") or data.get("mortgage_balance") or 0
                ),
                "mortgage_rate_pct": data.get("mortgageRatePct", data.get("mortgage_rate_pct")),
                "loan_years": data.get("loanYears", data.get("loan_years")),
                "closing_paid": float(data.get("closingPaid") or data.get("closing_paid") or 0),
                "monthly_rent": data.get("monthlyRent", data.get("monthly_rent")),
                "monthly_payment": data.get("monthlyPayment", data.get("monthly_payment")),
                "last_rent_settled": data.get("lastRentSettled", data.get("last_rent_settled")),
            }
        )
    rows.sort(key=lambda h: h["ticker"])
    return rows


def get_holding(class_id: str, student_id: str, ticker: str) -> dict | None:
    snap = holdings_col(class_id, student_id).document(ticker).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    return {
        "ticker": ticker,
        "shares": float(data.get("shares") or 0),
        "avg_cost": float(data.get("avgCost") or 0),
        "mortgage_balance": float(data.get("mortgageBalance") or 0),
        "mortgage_rate_pct": data.get("mortgageRatePct"),
        "loan_years": data.get("loanYears"),
        "closing_paid": float(data.get("closingPaid") or 0),
        "monthly_rent": data.get("monthlyRent", data.get("monthly_rent")),
        "monthly_payment": data.get("monthlyPayment", data.get("monthly_payment")),
        "last_rent_settled": data.get("lastRentSettled", data.get("last_rent_settled")),
    }


def upsert_holding(class_id: str, student_id: str, holding: dict) -> None:
    ticker = holding["ticker"]
    payload = {
        "shares": float(holding["shares"]),
        "avgCost": float(holding["avg_cost"]),
        "mortgageBalance": float(holding.get("mortgage_balance") or 0),
        "mortgageRatePct": holding.get("mortgage_rate_pct"),
        "loanYears": holding.get("loan_years"),
        "closingPaid": float(holding.get("closing_paid") or 0),
    }
    if holding.get("monthly_rent") is not None:
        payload["monthlyRent"] = float(holding["monthly_rent"])
    if holding.get("monthly_payment") is not None:
        payload["monthlyPayment"] = float(holding["monthly_payment"])
    if holding.get("last_rent_settled") is not None:
        payload["lastRentSettled"] = holding["last_rent_settled"]
    holdings_col(class_id, student_id).document(ticker).set(payload, merge=True)


def delete_holding(class_id: str, student_id: str, ticker: str) -> None:
    holdings_col(class_id, student_id).document(ticker).delete()


def list_snapshots(class_id: str, student_id: str) -> list[dict]:
    snaps = snapshots_col(class_id, student_id).stream()
    out = []
    for snap in snaps:
        data = snap.to_dict() or {}
        recorded = data.get("recordedAt") or data.get("recorded_at")
        if hasattr(recorded, "isoformat"):
            recorded_at = recorded.isoformat()
        else:
            recorded_at = str(recorded or "")
        out.append(
            {
                "recorded_at": recorded_at,
                "total_value": float(data.get("totalValue") or data.get("total_value") or 0),
                "cash": float(data.get("cash") or 0),
                "portfolio_value": float(
                    data.get("portfolioValue") or data.get("portfolio_value") or 0
                ),
            }
        )
    out.sort(key=lambda s: s["recorded_at"] or "")
    return out


def has_any_snapshot(class_id: str, student_id: str) -> bool:
    """Cheap existence check — avoids streaming the full history on every page load."""
    return next(snapshots_col(class_id, student_id).limit(1).stream(), None) is not None


def add_snapshot(
    class_id: str,
    student_id: str,
    *,
    cash: float,
    portfolio_value: float,
    total_value: float,
    recorded_at: str | None = None,
) -> None:
    ts = recorded_at or utc_now_iso()
    # Dedupe using cached totals on the student doc (no full snapshot scan).
    existing = get_student(class_id, student_id)
    if existing and existing.get("last_total_value") is not None:
        if abs(float(existing["last_total_value"]) - float(total_value)) < 0.005:
            try:
                snap = student_ref(class_id, student_id).get()
                data = snap.to_dict() or {}
                updated = data.get("updatedAt")
                if hasattr(updated, "timestamp"):
                    age = datetime.now(timezone.utc).timestamp() - float(updated.timestamp())
                    if age < 60:
                        return
            except Exception:
                pass

    snapshots_col(class_id, student_id).add(
        {
            "recordedAt": ts,
            "totalValue": float(total_value),
            "cash": float(cash),
            "portfolioValue": float(portfolio_value),
        }
    )
    set_last_totals(
        class_id,
        student_id,
        cash=cash,
        portfolio_value=portfolio_value,
        total_value=total_value,
    )


def delete_student(class_id: str, student_id: str) -> bool:
    ref = student_ref(class_id, student_id)
    if not ref.get().exists:
        return False
    for col in (holdings_col(class_id, student_id), snapshots_col(class_id, student_id)):
        for snap in col.stream():
            snap.reference.delete()
    for snap in ref.collection("transfers").stream():
        snap.reference.delete()
    ref.delete()
    return True


def class_ref(class_id: str):
    return db().collection("classes").document(class_id)


def get_class(class_id: str) -> dict | None:
    snap = class_ref(class_id).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    data["id"] = snap.id
    return data


def _rank_popular_stocks(rows: list[dict]) -> list[dict]:
    cleaned = []
    for row in rows:
        ticker = str(row.get("ticker") or "").strip().upper()
        if not ticker:
            continue
        holders = max(0, int(row.get("holders") or 0))
        shares = max(0.0, float(row.get("shares") or 0))
        if holders <= 0 or shares <= 1e-9:
            continue
        cleaned.append(
            {
                "ticker": ticker,
                "name": str(row.get("name") or ticker),
                "holders": holders,
                "shares": round(shares, 4),
            }
        )
    cleaned.sort(key=lambda r: (-r["holders"], -r["shares"], r["ticker"]))
    return cleaned


def get_popular_stocks(class_id: str) -> list[dict] | None:
    """Return cached popular stocks, or None if the cache has never been built."""
    snap = class_ref(class_id).get()
    if not snap.exists:
        return []
    data = snap.to_dict() or {}
    if "popularStocks" not in data:
        return None
    rows = data.get("popularStocks") or []
    if not isinstance(rows, list):
        return []
    return _rank_popular_stocks(rows)


def write_popular_stocks(class_id: str, rows: list[dict]) -> list[dict]:
    ranked = _rank_popular_stocks(rows)
    class_ref(class_id).set(
        {
            "popularStocks": ranked,
            "popularStocksUpdatedAt": utc_now_iso(),
        },
        merge=True,
    )
    return ranked


def rebuild_popular_stocks(class_id: str, stock_names: dict[str, str]) -> list[dict]:
    """Scan roster holdings once and cache stock popularity on the class doc."""
    allowed = {str(t).upper(): (n or t) for t, n in (stock_names or {}).items()}
    agg: dict[str, dict] = {}
    for student in list_students(class_id):
        for holding in list_holdings(class_id, student["id"]):
            ticker = str(holding.get("ticker") or "").upper()
            if ticker not in allowed:
                continue
            shares = float(holding.get("shares") or 0)
            if shares <= 1e-9:
                continue
            row = agg.setdefault(
                ticker,
                {
                    "ticker": ticker,
                    "name": allowed[ticker],
                    "holders": 0,
                    "shares": 0.0,
                },
            )
            row["holders"] += 1
            row["shares"] += shares
    return write_popular_stocks(class_id, list(agg.values()))


def ensure_popular_stocks(class_id: str, stock_names: dict[str, str]) -> list[dict]:
    cached = get_popular_stocks(class_id)
    if cached is not None:
        return cached
    return rebuild_popular_stocks(class_id, stock_names)


def adjust_popular_stock(
    class_id: str,
    ticker: str,
    *,
    name: str,
    holders_delta: int = 0,
    shares_delta: float = 0.0,
) -> list[dict]:
    """Cheap incremental update after a stock buy/sell (1 class-doc read + write)."""
    ticker = str(ticker or "").strip().upper()
    if not ticker:
        return get_popular_stocks(class_id) or []

    cached = get_popular_stocks(class_id)
    if cached is None:
        # Cache not built yet — leave rebuild for ensure/API rather than scanning here.
        return []

    by_ticker = {row["ticker"]: dict(row) for row in cached}
    row = by_ticker.get(ticker) or {
        "ticker": ticker,
        "name": name or ticker,
        "holders": 0,
        "shares": 0.0,
    }
    row["name"] = name or row.get("name") or ticker
    row["holders"] = max(0, int(row.get("holders") or 0) + int(holders_delta))
    row["shares"] = max(0.0, float(row.get("shares") or 0) + float(shares_delta))
    if row["holders"] <= 0 or row["shares"] <= 1e-9:
        by_ticker.pop(ticker, None)
    else:
        by_ticker[ticker] = row
    return write_popular_stocks(class_id, list(by_ticker.values()))

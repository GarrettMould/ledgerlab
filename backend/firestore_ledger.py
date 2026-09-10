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
    if _init_error:
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError as exc:
        _init_error = f"firebase-admin not installed: {exc}"
        return None

    try:
        if not firebase_admin._apps:
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
        return _db
    except Exception as exc:
        _init_error = str(exc)
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
    # Avoid order_by queries (index / mixed-type pitfalls). Dedupe in memory.
    existing = list_snapshots(class_id, student_id)
    if existing:
        latest = existing[-1]
        if abs(float(latest.get("total_value") or 0) - float(total_value)) < 0.005:
            try:
                prev = datetime.fromisoformat(str(latest.get("recorded_at") or ""))
                now = datetime.fromisoformat(ts)
                if prev.tzinfo is None:
                    prev = prev.replace(tzinfo=timezone.utc)
                if now.tzinfo is None:
                    now = now.replace(tzinfo=timezone.utc)
                if abs((now - prev).total_seconds()) < 15:
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

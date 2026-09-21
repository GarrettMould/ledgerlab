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
import time as _time
from datetime import datetime, timezone
from pathlib import Path
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
        bucket = (
            os.environ.get("FIREBASE_STORAGE_BUCKET")
            or os.environ.get("VITE_FIREBASE_STORAGE_BUCKET")
            or ""
        ).strip()
        if not bucket:
            try:
                from dotenv import dotenv_values

                for env_path in (
                    Path(__file__).resolve().parent / ".env",
                    Path(__file__).resolve().parent.parent / ".env.local",
                ):
                    if env_path.is_file():
                        vals = dotenv_values(env_path)
                        bucket = (
                            vals.get("FIREBASE_STORAGE_BUCKET")
                            or vals.get("VITE_FIREBASE_STORAGE_BUCKET")
                            or bucket
                            or ""
                        ).strip()
                        if bucket:
                            break
            except Exception:
                pass
        if not bucket and pid:
            bucket = f"{pid}-closet"
        if bucket:
            opts["storageBucket"] = bucket
            os.environ["FIREBASE_STORAGE_BUCKET"] = bucket
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


def storage_bucket_name() -> str | None:
    """Resolved Cloud Storage bucket for closet GLB uploads.

    Re-reads backend/.env on each call so Flask reloads pick up bucket changes
    even when the parent process still has a stale os.environ value.
    """
    try:
        from dotenv import dotenv_values

        env_file = Path(__file__).resolve().parent / ".env"
        local_file = Path(__file__).resolve().parent.parent / ".env.local"
        file_vals = {}
        if env_file.is_file():
            file_vals.update({k: v for k, v in dotenv_values(env_file).items() if v})
        if local_file.is_file():
            file_vals.update({k: v for k, v in dotenv_values(local_file).items() if v})
        explicit = (
            file_vals.get("FIREBASE_STORAGE_BUCKET")
            or file_vals.get("VITE_FIREBASE_STORAGE_BUCKET")
            or os.environ.get("FIREBASE_STORAGE_BUCKET")
            or os.environ.get("VITE_FIREBASE_STORAGE_BUCKET")
            or ""
        ).strip()
    except Exception:
        explicit = (
            os.environ.get("FIREBASE_STORAGE_BUCKET")
            or os.environ.get("VITE_FIREBASE_STORAGE_BUCKET")
            or ""
        ).strip()
    if explicit:
        return explicit
    _init_app()
    pid = _project_id()
    # Prefer a project-owned GCS bucket name over reserved Firebase defaults
    # (*.firebasestorage.app / *.appspot.com) which only exist after Console setup.
    return f"{pid}-closet" if pid else None


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
        "email": (data.get("email") or "").strip().lower() or None,
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


def _global_market_ref():
    """Shared teacher-added tickers — one catalog for every class."""
    return db().collection("config").document("classroomMarket")


def _normalize_extra_market_row(row: dict) -> dict | None:
    if not isinstance(row, dict):
        return None
    ticker = str(row.get("ticker") or "").strip().upper()
    if not ticker:
        return None
    cat = str(row.get("category") or "stocks").strip().lower()
    if cat not in ("stocks", "etfs"):
        cat = "stocks"
    name = str(row.get("name") or ticker).strip()[:80] or ticker
    return {
        "ticker": ticker,
        "name": name,
        "industry": str(row.get("industry") or "Consumer").strip()[:40] or "Consumer",
        "category": cat,
        "addedBy": row.get("addedBy"),
        "addedAtMs": int(row.get("addedAtMs") or 0),
        "custom": True,
        "info": row.get("info")
        or {
            "summary": f"{name} was added to the shared classroom market by a teacher."
        },
    }


def _merge_extra_market_rows(*lists: list) -> list[dict]:
    by_ticker: dict[str, dict] = {}
    for rows in lists:
        for row in rows or []:
            item = _normalize_extra_market_row(row if isinstance(row, dict) else {})
            if not item:
                continue
            prev = by_ticker.get(item["ticker"])
            if not prev or item["addedAtMs"] >= prev["addedAtMs"]:
                by_ticker[item["ticker"]] = item
    out = list(by_ticker.values())
    out.sort(key=lambda r: r["ticker"])
    return out


def migrate_extra_market_items_to_global(*, clear_class_fields: bool = True) -> dict:
    """Union every class's extraMarketItems into the shared catalog (retroactive)."""
    from firebase_admin import firestore as fs

    ref = _global_market_ref()
    snap = ref.get()
    existing = list((snap.to_dict() or {}).get("extraMarketItems") or []) if snap.exists else []

    class_lists: list[list] = []
    cleared = 0
    for csnap in db().collection("classes").stream():
        data = csnap.to_dict() or {}
        rows = list(data.get("extraMarketItems") or [])
        if not rows:
            continue
        class_lists.append(rows)
        if clear_class_fields:
            csnap.reference.set(
                {"extraMarketItems": [], "updatedAt": fs.SERVER_TIMESTAMP},
                merge=True,
            )
            cleared += 1

    merged = _merge_extra_market_rows(existing, *class_lists)
    ref.set(
        {
            "extraMarketItems": merged,
            "updatedAt": fs.SERVER_TIMESTAMP,
            "migratedFromClassesAt": fs.SERVER_TIMESTAMP,
            "scope": "global",
        },
        merge=True,
    )
    return {"count": len(merged), "classesCleared": cleared}


def _ensure_global_extra_market() -> list[dict]:
    """Return shared extras, migrating per-class leftovers once if needed."""
    ref = _global_market_ref()
    snap = ref.get()
    data = snap.to_dict() or {} if snap.exists else {}
    if not data.get("migratedFromClassesAt"):
        try:
            migrate_extra_market_items_to_global(clear_class_fields=True)
            snap = ref.get()
            data = snap.to_dict() or {} if snap.exists else {}
        except Exception:
            pass
    return list(data.get("extraMarketItems") or [])


def get_extra_market_items(class_id: str | None = None, category: str | None = None) -> list[dict]:
    """Teacher-added tickers shared by every class (stocks / etfs).

    class_id is accepted for call-site compatibility but ignored — catalog is global.
    """
    _ = class_id
    rows = _ensure_global_extra_market()
    out = []
    for row in rows:
        item = _normalize_extra_market_row(row if isinstance(row, dict) else {})
        if not item:
            continue
        if category and item["category"] != category:
            continue
        out.append(item)
    out.sort(key=lambda r: (-int(r.get("addedAtMs") or 0), r["ticker"]))
    return out


def add_extra_market_item(
    class_id: str | None = None,
    *,
    ticker: str,
    name: str,
    category: str = "stocks",
    industry: str = "Consumer",
    added_by: str | None = None,
    summary: str | None = None,
) -> dict:
    from firebase_admin import firestore as fs

    _ = class_id
    ticker_u = str(ticker or "").strip().upper()
    if not ticker_u or len(ticker_u) > 12:
        raise ValueError("Enter a valid ticker")
    cat = str(category or "stocks").strip().lower()
    if cat not in ("stocks", "etfs"):
        cat = "stocks"
    display_name = str(name or ticker_u).strip()[:80] or ticker_u
    industry_s = str(industry or "Consumer").strip()[:40] or "Consumer"
    blurb = str(summary or "").strip()[:420]
    if not blurb:
        blurb = (
            f"{display_name} was added to the shared classroom market by a teacher."
        )
    item = {
        "ticker": ticker_u,
        "name": display_name,
        "industry": industry_s,
        "category": cat,
        "addedBy": (added_by or "").strip() or None,
        "addedAtMs": int(_time.time() * 1000),
        "custom": True,
        "info": {"summary": blurb},
    }
    _ensure_global_extra_market()
    ref = _global_market_ref()
    snap = ref.get()
    rows = list((snap.to_dict() or {}).get("extraMarketItems") or []) if snap.exists else []
    next_rows = []
    replaced = False
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("ticker") or "").strip().upper() == ticker_u:
            next_rows.append({**row, **item})
            replaced = True
        else:
            next_rows.append(row)
    if not replaced:
        next_rows.append(item)
    if len(next_rows) > 80 and not replaced:
        raise ValueError("Shared classroom market already has 80 custom tickers")
    prior = (snap.to_dict() or {}) if snap.exists else {}
    payload = {
        "extraMarketItems": next_rows,
        "updatedAt": fs.SERVER_TIMESTAMP,
        "scope": "global",
    }
    if prior.get("migratedFromClassesAt"):
        payload["migratedFromClassesAt"] = prior["migratedFromClassesAt"]
    else:
        payload["migratedFromClassesAt"] = fs.SERVER_TIMESTAMP
    ref.set(payload, merge=True)
    return item


def remove_extra_market_item(class_id: str | None, ticker: str) -> bool:
    from firebase_admin import firestore as fs

    _ = class_id
    ticker_u = str(ticker or "").strip().upper()
    if not ticker_u:
        return False
    _ensure_global_extra_market()
    ref = _global_market_ref()
    snap = ref.get()
    if not snap.exists:
        return False
    rows = list((snap.to_dict() or {}).get("extraMarketItems") or [])
    next_rows = [
        row
        for row in rows
        if isinstance(row, dict)
        and str(row.get("ticker") or "").strip().upper() != ticker_u
    ]
    if len(next_rows) == len(rows):
        return False
    ref.set(
        {"extraMarketItems": next_rows, "updatedAt": fs.SERVER_TIMESTAMP},
        merge=True,
    )
    return True


def update_extra_market_industries(updates: dict[str, str]) -> int:
    """Patch industry labels on global extras (e.g. remap legacy Custom)."""
    from firebase_admin import firestore as fs

    if not updates:
        return 0
    normalized = {
        str(ticker or "").strip().upper(): str(industry or "").strip()[:40]
        for ticker, industry in updates.items()
        if str(ticker or "").strip() and str(industry or "").strip()
    }
    if not normalized:
        return 0
    _ensure_global_extra_market()
    ref = _global_market_ref()
    snap = ref.get()
    if not snap.exists:
        return 0
    rows = list((snap.to_dict() or {}).get("extraMarketItems") or [])
    changed = 0
    next_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        ticker = str(row.get("ticker") or "").strip().upper()
        if ticker in normalized and row.get("industry") != normalized[ticker]:
            next_rows.append({**row, "industry": normalized[ticker]})
            changed += 1
        else:
            next_rows.append(row)
    if not changed:
        return 0
    ref.set(
        {"extraMarketItems": next_rows, "updatedAt": fs.SERVER_TIMESTAMP},
        merge=True,
    )
    return changed


def update_extra_market_summaries(updates: dict[str, str]) -> int:
    """Patch info.summary on global extras (replace teacher-added placeholders)."""
    from firebase_admin import firestore as fs

    if not updates:
        return 0
    normalized = {
        str(ticker or "").strip().upper(): str(summary or "").strip()[:420]
        for ticker, summary in updates.items()
        if str(ticker or "").strip() and str(summary or "").strip()
    }
    if not normalized:
        return 0
    _ensure_global_extra_market()
    ref = _global_market_ref()
    snap = ref.get()
    if not snap.exists:
        return 0
    rows = list((snap.to_dict() or {}).get("extraMarketItems") or [])
    changed = 0
    next_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        ticker = str(row.get("ticker") or "").strip().upper()
        if ticker in normalized:
            prev_info = row.get("info") if isinstance(row.get("info"), dict) else {}
            next_rows.append(
                {
                    **row,
                    "info": {**prev_info, "summary": normalized[ticker]},
                }
            )
            changed += 1
        else:
            next_rows.append(row)
    if not changed:
        return 0
    ref.set(
        {"extraMarketItems": next_rows, "updatedAt": fs.SERVER_TIMESTAMP},
        merge=True,
    )
    return changed


def _global_closet_ref():
    """Shared teacher-approved AI closet items — one catalog for every class."""
    return db().collection("config").document("classroomCloset")


def _closet_item_is_shelf_ready(row: dict) -> bool:
    if not isinstance(row, dict):
        return False
    item_id = str(row.get("id") or "").strip()
    kind = str(row.get("kind") or "").strip()
    url = str(row.get("url") or "").strip()
    parts = row.get("parts") if isinstance(row.get("parts"), list) else []
    if not item_id or not kind:
        return False
    # Dev seed fakes — never share across classes.
    if item_id.startswith("test-") or str(row.get("label") or "").startswith(
        "Test item"
    ):
        return False
    if not url and not parts:
        return False
    if row.get("live") is False:
        return False
    if row.get("quizPending") is True or row.get("reviewPending") is True:
        return False
    return True


def upsert_global_closet_item(item: dict, *, source_class_id: str | None = None) -> dict | None:
    """Publish (or refresh) a live closet item for every class's Extras shelf."""
    from firebase_admin import firestore as fs

    if not isinstance(item, dict):
        return None
    row = dict(item)
    row["live"] = True
    row["quizPending"] = False
    row["reviewPending"] = False
    row["awaitingCrew"] = False
    row["aiCreated"] = True
    if source_class_id:
        row["sourceClassId"] = source_class_id
    if not row.get("approvedAtMs"):
        row["approvedAtMs"] = int(_time.time() * 1000)
    if not _closet_item_is_shelf_ready(row):
        return None

    item_id = str(row.get("id") or "").strip()
    ref = _global_closet_ref()
    snap = ref.get()
    rows = list((snap.to_dict() or {}).get("closetItems") or []) if snap.exists else []
    next_rows = []
    found = False
    for existing in rows:
        if not isinstance(existing, dict):
            continue
        if existing.get("id") == item_id:
            next_rows.append({**existing, **row})
            found = True
        else:
            next_rows.append(existing)
    if not found:
        next_rows.append(row)
    ref.set(
        {
            "closetItems": next_rows,
            "updatedAt": fs.SERVER_TIMESTAMP,
            "scope": "global",
        },
        merge=True,
    )
    return row


def remove_global_closet_item(item_id: str) -> bool:
    from firebase_admin import firestore as fs

    item_id = str(item_id or "").strip()
    if not item_id:
        return False
    ref = _global_closet_ref()
    snap = ref.get()
    if not snap.exists:
        return False
    rows = list((snap.to_dict() or {}).get("closetItems") or [])
    next_rows = [
        r for r in rows if not (isinstance(r, dict) and r.get("id") == item_id)
    ]
    if len(next_rows) == len(rows):
        return False
    ref.set(
        {"closetItems": next_rows, "updatedAt": fs.SERVER_TIMESTAMP},
        merge=True,
    )
    return True


def migrate_live_closet_items_to_global() -> dict:
    """One-shot: pull already-live per-class closet items into the shared catalog."""
    from firebase_admin import firestore as fs

    ref = _global_closet_ref()
    snap = ref.get()
    existing = list((snap.to_dict() or {}).get("closetItems") or []) if snap.exists else []
    by_id: dict[str, dict] = {}
    for row in existing:
        if isinstance(row, dict) and _closet_item_is_shelf_ready(row) and row.get("id"):
            by_id[str(row["id"])] = row

    classes_scanned = 0
    added = 0
    for class_snap in db().collection("classes").stream():
        classes_scanned += 1
        data = class_snap.to_dict() or {}
        for row in list(data.get("closetItems") or []):
            if not isinstance(row, dict) or not _closet_item_is_shelf_ready(row):
                continue
            item_id = str(row.get("id") or "").strip()
            if not item_id:
                continue
            enriched = {
                **row,
                "live": True,
                "quizPending": False,
                "reviewPending": False,
                "aiCreated": True,
                "sourceClassId": class_snap.id,
            }
            prev = by_id.get(item_id)
            if not prev or int(enriched.get("approvedAtMs") or 0) >= int(
                prev.get("approvedAtMs") or 0
            ):
                if item_id not in by_id:
                    added += 1
                by_id[item_id] = enriched

    merged = list(by_id.values())
    merged.sort(
        key=lambda r: (-int(r.get("approvedAtMs") or 0), str(r.get("label") or ""))
    )
    ref.set(
        {
            "closetItems": merged,
            "updatedAt": fs.SERVER_TIMESTAMP,
            "migratedFromClassesAt": fs.SERVER_TIMESTAMP,
            "scope": "global",
        },
        merge=True,
    )
    return {
        "count": len(merged),
        "added": added,
        "classesScanned": classes_scanned,
    }


def ensure_global_closet_items() -> list[dict]:
    """Return shared live closet items, migrating per-class leftovers once if needed."""
    ref = _global_closet_ref()
    snap = ref.get()
    data = snap.to_dict() or {} if snap.exists else {}
    if not data.get("migratedFromClassesAt"):
        try:
            migrate_live_closet_items_to_global()
            snap = ref.get()
            data = snap.to_dict() or {} if snap.exists else {}
        except Exception:
            pass
    return [
        row
        for row in list(data.get("closetItems") or [])
        if isinstance(row, dict) and _closet_item_is_shelf_ready(row)
    ]


def get_global_closet_item(item_id: str) -> dict | None:
    item_id = str(item_id or "").strip()
    if not item_id:
        return None
    for row in ensure_global_closet_items():
        if str(row.get("id") or "") == item_id:
            return row
    return None


def queue_student_transfer(
    class_id: str,
    student_id: str,
    *,
    amount: float,
    note: str,
    kind: str = "transfer",
    pre_applied: bool = False,
    meta: dict | None = None,
) -> str | None:
    """Queue a PayPal-style transfer alert on the student (Admin SDK)."""
    from firebase_admin import firestore as fs

    amt = float(amount)
    if not class_id or not student_id or amt == 0:
        return None
    direction = "credit" if amt > 0 else "debit"
    abs_amount = abs(amt)
    payload = {
        "amount": amt,
        "absAmount": abs_amount,
        "direction": direction,
        "status": "pending",
        "note": str(note or "")[:400],
        "kind": str(kind or "transfer")[:40],
        "preApplied": bool(pre_applied),
        "createdAt": fs.SERVER_TIMESTAMP,
        "acceptedAt": None,
    }
    if isinstance(meta, dict):
        payload["meta"] = meta
    ref = (
        student_ref(class_id, student_id)
        .collection("transfers")
        .document()
    )
    ref.set(payload)
    stu = student_ref(class_id, student_id)
    snap = stu.get()
    prev = 0
    if snap.exists:
        prev = int((snap.to_dict() or {}).get("pendingTransferCount") or 0)
    stu.set(
        {
            "pendingTransferCount": prev + 1,
            "updatedAt": fs.SERVER_TIMESTAMP,
        },
        merge=True,
    )
    return ref.id


def credit_student_cash(class_id: str, student_id: str, amount: float) -> float | None:
    """Add cash to a student ledger. Returns new cash or None if missing."""
    student = get_student(class_id, student_id)
    if not student:
        return None
    amt = float(amount)
    if amt == 0:
        return float(student.get("cash") or 0)
    new_cash = float(student.get("cash") or 0) + amt
    if new_cash < -0.0001:
        raise RuntimeError("Balance cannot go below $0")
    holdings = list_holdings(class_id, student_id)
    set_cash(class_id, student_id, new_cash, holdings_count=len(holdings))
    return new_cash


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


def record_trade(
    class_id: str,
    student_id: str,
    *,
    side: str,
    ticker: str,
    shares: float,
    price: float,
    notional: float | None = None,
    kind: str = "market",
    student_name: str | None = None,
    extra: dict | None = None,
) -> None:
    """Append a trade to class + student trade logs (best-effort analytics)."""
    if not class_id or not student_id or not ticker:
        return
    from firebase_admin import firestore as fs
    import time as _time

    side_norm = str(side or "").strip().lower()
    if side_norm not in ("buy", "sell"):
        side_norm = "buy"
    qty = float(shares)
    px = float(price)
    total = float(notional) if notional is not None else qty * px
    payload: dict[str, Any] = {
        "studentId": student_id,
        "studentName": student_name or None,
        "side": side_norm,
        "ticker": str(ticker).strip().upper(),
        "shares": qty,
        "price": px,
        "notional": total,
        "kind": str(kind or "market"),
        "createdAt": fs.SERVER_TIMESTAMP,
        "createdAtMs": int(_time.time() * 1000),
    }
    if extra and isinstance(extra, dict):
        for key, val in extra.items():
            if key not in payload and val is not None:
                payload[key] = val
    try:
        class_ref(class_id).collection("trades").document().set(payload)
    except Exception:
        pass
    try:
        student_ref(class_id, student_id).collection("trades").document().set(payload)
    except Exception:
        pass

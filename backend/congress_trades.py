"""Congressional STOCK Act trade disclosures via Bargo's free Congress Trades API.

Capitol API also supports filtering by politician (`person=Pelosi`) but must be
self-hosted. Bargo is hosted, covers House + Senate, and supports:
  GET /trades?member=Pelosi
  GET /members/{member_slug}
  GET /members

Attribution: https://www.bargo.ai/free-apis/congress (required by Bargo terms).
Disclosures can lag trades by ~45 days — not a real-time tip feed.
"""

from __future__ import annotations

import os
import time
from typing import Any

import requests

BARGO_BASE = "https://www.bargo.ai/free-apis/congress/v1"
HTTP_HEADERS = {
    "User-Agent": "LedgerLab-Classroom/1.0 (educational)",
    "Accept": "application/json",
}

# Classroom tracker roster — edit to choose which politicians appear as tabs.
# Slugs come from Bargo (`member_slug`). Members with no recent disclosures
# simply show an empty list until they file again.
CONGRESS_TRACKED_MEMBERS: list[dict[str, str]] = [
    {"slug": "nancy-pelosi", "label": "Nancy Pelosi"},
    {"slug": "gilbert-cisneros", "label": "Gilbert Cisneros"},
    {"slug": "april-mcclain-delaney", "label": "April McClain Delaney"},
    {"slug": "rohit-khanna", "label": "Rohit Khanna"},
    {"slug": "kevin-hern", "label": "Kevin Hern"},
    {"slug": "john-boozman", "label": "John Boozman"},
]

_CACHE_TTL = 60 * 30  # 30 minutes — disclosures change slowly
_cache: dict[str, Any] = {"at": 0.0, "payload": None}


def _api_key() -> str | None:
    key = (os.environ.get("BARGO_API_KEY") or "").strip()
    return key or None


def _request(path: str, params: dict | None = None) -> dict | list | None:
    headers = dict(HTTP_HEADERS)
    key = _api_key()
    if key:
        headers["X-Api-Key"] = key
    url = f"{BARGO_BASE}{path}"
    try:
        res = requests.get(url, headers=headers, params=params or {}, timeout=18)
        if res.status_code >= 400:
            return None
        return res.json()
    except Exception:
        return None


def _normalize_trade(row: dict, catalog_names: dict[str, str] | None = None) -> dict | None:
    if not isinstance(row, dict):
        return None
    ticker = str(row.get("ticker") or "").strip().upper()
    if not ticker:
        return None
    member = str(row.get("member") or "").strip() or "Member of Congress"
    trade_type = str(row.get("type") or "").strip().lower()
    if trade_type not in {"purchase", "sale", "exchange"}:
        trade_type = "purchase" if "buy" in trade_type else trade_type or "trade"
    return {
        "member": member,
        "memberSlug": row.get("member_slug") or None,
        "chamber": row.get("chamber") or None,
        "state": row.get("state") or None,
        "ticker": ticker,
        "name": (catalog_names or {}).get(ticker) or str(row.get("asset") or ticker)[:60],
        "type": trade_type,
        "amountRange": row.get("amount_range") or None,
        "transactionDate": row.get("transaction_date") or None,
        "disclosureDate": row.get("disclosure_date") or None,
        "inCatalog": ticker in (catalog_names or {}),
        "filingPortal": row.get("filing_portal") or None,
    }


def fetch_congress_trades(
    *,
    member: str | None = None,
    member_slug: str | None = None,
    catalog_tickers: set[str] | None = None,
    catalog_names: dict[str, str] | None = None,
    limit: int = 24,
    force_refresh: bool = False,
) -> dict:
    """Recent disclosed trades, optionally scoped to one politician / classroom tickers."""
    global _cache
    now = time.time()
    member_q = (member or "").strip()
    slug_q = (member_slug or "").strip().lower()
    cache_key = f"{slug_q}|{member_q.lower()}|{sorted(catalog_tickers or [])[:40]}|{limit}"

    cached = _cache.get("payload")
    if (
        not force_refresh
        and cached
        and cached.get("cacheKey") == cache_key
        and now - float(_cache.get("at") or 0) < _CACHE_TTL
    ):
        return {**cached["data"], "cached": True}

    rows: list[dict] = []
    if slug_q:
        detail = _request(f"/members/{slug_q}", {"limit": min(100, max(limit, 20))})
        if isinstance(detail, dict):
            rows = list(detail.get("trades") or [])
            if not member_q:
                member_q = str(detail.get("member") or "")
    else:
        # One /trades call for Recent (free tier is ~30 req/day without a key).
        params: dict[str, Any] = {"limit": min(100, max(limit * 2, 40)), "page": 0}
        if member_q:
            params["member"] = member_q
        page = _request("/trades", params)
        if isinstance(page, dict):
            rows = list(page.get("trades") or [])

    catalog = {t.upper() for t in (catalog_tickers or set()) if t}
    names = {k.upper(): v for k, v in (catalog_names or {}).items()}

    def _collect(prefer_catalog: bool) -> list[dict]:
        out: list[dict] = []
        for raw in rows:
            item = _normalize_trade(raw, names)
            if not item:
                continue
            if prefer_catalog and catalog and item["ticker"] not in catalog:
                continue
            out.append(item)
            if len(out) >= limit:
                break
        return out

    trades = _collect(prefer_catalog=True)
    if catalog and not trades:
        trades = _collect(prefer_catalog=False)

    tracked = []
    for row in CONGRESS_TRACKED_MEMBERS:
        slug = str(row.get("slug") or "").strip()
        label = str(row.get("label") or slug).strip()
        if slug:
            tracked.append({"slug": slug, "label": label})

    payload = {
        "trades": trades,
        "members": tracked,
        "selectedMember": slug_q or None,
        "selectedMemberName": member_q or None,
        "note": (
            "Disclosures can lag trades by up to ~45 days (STOCK Act). "
            "For classroom discussion — not investment advice."
        ),
        "attribution": "Data via Bargo Congress Trades API",
        "attributionUrl": "https://www.bargo.ai/free-apis/congress",
        "source": "bargo",
    }
    _cache = {"at": now, "payload": {"cacheKey": cache_key, "data": payload}}
    return {**payload, "cached": False}

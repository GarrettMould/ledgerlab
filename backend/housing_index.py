"""Zillow City ZHVI fetch/cache for Florida classroom home markets."""

from __future__ import annotations

import csv
import io
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

ZHVI_CITY_URL = (
    "https://files.zillowstatic.com/research/public_csvs/zhvi/"
    "City_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
)

# Ledger Lab ticker → (Zillow RegionName, StateName)
TICKER_CITY_MAP: dict[str, tuple[str, str]] = {
    "FL-MIA": ("Miami", "FL"),
    "FL-FLL": ("Fort Lauderdale", "FL"),
    "FL-TPA": ("Tampa", "FL"),
    "FL-ORL": ("Orlando", "FL"),
    "FL-JAX": ("Jacksonville", "FL"),
    "FL-NAP": ("Naples", "FL"),
    "FL-TLH": ("Tallahassee", "FL"),
    "FL-PNS": ("Pensacola", "FL"),
}

CACHE_TTL_SECONDS = 60 * 60 * 24

_DATA_DIR = (
    Path("/tmp/ledgerlab") if os.environ.get("VERCEL") else Path(__file__).resolve().parent
)
_CACHE_PATH = _DATA_DIR / "housing_zhvi_cache.json"

_memory: dict[str, Any] | None = None
_memory_loaded_at: float = 0.0


def _utc_now_ts() -> float:
    return datetime.now(timezone.utc).timestamp()


def _load_disk() -> dict[str, Any] | None:
    try:
        if not _CACHE_PATH.is_file():
            return None
        data = json.loads(_CACHE_PATH.read_text())
        if not isinstance(data, dict) or "cities" not in data:
            return None
        return data
    except Exception:
        return None


def _save_disk(payload: dict[str, Any]) -> None:
    try:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(json.dumps(payload))
    except Exception:
        pass


def _parse_zhvi_csv(text: str) -> dict[str, dict[str, Any]]:
    """Return map 'City|ST' → {price, prev_price, as_of, change_pct}."""
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return {}
    date_cols = [
        c
        for c in reader.fieldnames
        if c and len(c) >= 7 and c[0:4].isdigit() and "-" in c
    ]
    date_cols.sort()
    if len(date_cols) < 1:
        return {}
    latest = date_cols[-1]
    prev = date_cols[-2] if len(date_cols) >= 2 else None
    out: dict[str, dict[str, Any]] = {}
    for row in reader:
        name = (row.get("RegionName") or "").strip()
        state = (row.get("StateName") or row.get("State") or "").strip()
        if not name or not state:
            continue
        raw = row.get(latest)
        if raw in (None, ""):
            continue
        try:
            price = float(raw)
        except (TypeError, ValueError):
            continue
        prev_price = None
        change_pct = None
        if prev:
            try:
                prev_price = float(row.get(prev) or 0) or None
            except (TypeError, ValueError):
                prev_price = None
            if prev_price and prev_price > 0:
                change_pct = ((price - prev_price) / prev_price) * 100.0
        key = f"{name}|{state}"
        out[key] = {
            "price": round(price, 2),
            "prev_price": round(prev_price, 2) if prev_price is not None else None,
            "change_pct": round(change_pct, 2) if change_pct is not None else None,
            "as_of": latest[:7] if len(latest) >= 7 else latest,
            "source": "zillow_zhvi_city",
        }
    return out


def _fetch_remote() -> dict[str, Any] | None:
    try:
        res = requests.get(
            ZHVI_CITY_URL,
            timeout=45,
            headers={"User-Agent": "LedgerLabClassroom/1.0"},
        )
        res.raise_for_status()
        cities = _parse_zhvi_csv(res.text)
        if not cities:
            return None
        payload = {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "cities": cities,
        }
        _save_disk(payload)
        return payload
    except Exception:
        return None


def get_zhvi_bundle(*, force_refresh: bool = False) -> dict[str, Any] | None:
    global _memory, _memory_loaded_at
    now = _utc_now_ts()
    if (
        not force_refresh
        and _memory
        and now - _memory_loaded_at < CACHE_TTL_SECONDS
    ):
        return _memory

    disk = _load_disk()
    disk_age_ok = False
    if disk and disk.get("fetched_at"):
        try:
            fetched = datetime.fromisoformat(str(disk["fetched_at"]))
            if fetched.tzinfo is None:
                fetched = fetched.replace(tzinfo=timezone.utc)
            disk_age_ok = (now - fetched.timestamp()) < CACHE_TTL_SECONDS
        except Exception:
            disk_age_ok = False

    if not force_refresh and disk and disk_age_ok:
        _memory = disk
        _memory_loaded_at = now
        return disk

    remote = _fetch_remote()
    if remote:
        _memory = remote
        _memory_loaded_at = now
        return remote

    if disk:
        _memory = disk
        _memory_loaded_at = now
        return disk
    return _memory


def price_for_ticker(ticker: str, bundle: dict[str, Any] | None = None) -> dict[str, Any] | None:
    mapping = TICKER_CITY_MAP.get(ticker)
    if not mapping:
        return None
    city, state = mapping
    data = bundle if bundle is not None else get_zhvi_bundle()
    if not data:
        return None
    return (data.get("cities") or {}).get(f"{city}|{state}")


def refresh_realestate_catalog_prices(catalog_rows: list[dict]) -> dict[str, Any]:
    """
    Mutate catalog home dicts in place with latest ZHVI where available.
    Returns {updated: int, source: str|None, as_of: str|None}.
    """
    bundle = get_zhvi_bundle()
    updated = 0
    as_of = None
    source = None
    for row in catalog_rows:
        ticker = row.get("ticker")
        hit = price_for_ticker(ticker, bundle) if ticker else None
        if not hit:
            continue
        row["price"] = float(hit["price"])
        if hit.get("change_pct") is not None:
            row["yoy_change_pct"] = hit["change_pct"]  # MoM % used as display change
        if hit.get("as_of"):
            row["as_of"] = hit["as_of"]
            as_of = hit["as_of"]
        source = hit.get("source") or source
        updated += 1
    return {"updated": updated, "source": source, "as_of": as_of}

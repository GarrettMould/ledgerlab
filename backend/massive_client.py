"""Massive Stocks Starter — US equity quotes and charts for the classroom catalog.

Auth: MASSIVE_API_KEY (https://massive.com/dashboard/keys)
Docs: https://massive.com/docs/rest/stocks/overview
Recency on Starter: 15-minute delayed (fine for a 10-minute classroom cache).
"""

from __future__ import annotations

import os
import time
from datetime import date, datetime, timedelta, timezone

import requests

MASSIVE_BASE = "https://api.massive.com"
# Unified snapshot allows up to 250 tickers; keep URL length modest.
SNAPSHOT_CHUNK = 80
COOLDOWN_SECONDS = 65

_cooldown_until = 0.0
_last_error: str | None = None


def last_error() -> str | None:
    return _last_error


def massive_api_key() -> str:
    return (
        os.environ.get("MASSIVE_API_KEY")
        or os.environ.get("MASSIVE_KEY")
        or os.environ.get("POLYGON_API_KEY")
        or ""
    ).strip()


def configured() -> bool:
    return bool(massive_api_key())


def on_cooldown() -> bool:
    return time.time() < _cooldown_until


def _trip_cooldown() -> None:
    global _cooldown_until
    _cooldown_until = time.time() + COOLDOWN_SECONDS


def _get(path: str, params: dict | None = None, *, timeout: int = 20) -> tuple[dict | None, str | None]:
    key = massive_api_key()
    global _last_error
    if not key:
        _last_error = "MASSIVE_API_KEY is not set"
        return None, _last_error
    if on_cooldown():
        _last_error = "rate limited"
        return None, _last_error
    query = dict(params or {})
    try:
        res = requests.get(
            f"{MASSIVE_BASE}{path}",
            params=query,
            headers={"Authorization": f"Bearer {key}"},
            timeout=timeout,
        )
        if res.status_code == 429:
            _trip_cooldown()
            _last_error = "rate limited"
            return None, _last_error
        if res.status_code >= 400:
            detail = ""
            try:
                detail = (res.json() or {}).get("error") or (res.json() or {}).get("message") or ""
            except Exception:
                detail = (res.text or "")[:160]
            msg = f"Massive error {res.status_code}"
            if detail:
                msg = f"{msg}: {detail}"
            _last_error = msg
            return None, msg
        payload = res.json()
        if not isinstance(payload, dict):
            _last_error = "Massive returned a non-object"
            return None, _last_error
        _last_error = None
        return payload, None
    except Exception as exc:
        msg = str(exc)
        if key:
            msg = msg.replace(key, "***")
        _last_error = msg
        return None, msg


def _num(raw) -> float | None:
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    if val == 0.0:
        return None
    return val


def _price_from_snapshot(row: dict) -> tuple[float | None, float | None]:
    last_trade = row.get("lastTrade") if isinstance(row.get("lastTrade"), dict) else {}
    day = row.get("day") if isinstance(row.get("day"), dict) else {}
    minute = row.get("min") if isinstance(row.get("min"), dict) else {}
    prev = row.get("prevDay") if isinstance(row.get("prevDay"), dict) else {}
    price = (
        _num(last_trade.get("p"))
        or _num(minute.get("c"))
        or _num(day.get("c"))
        or _num(prev.get("c"))
    )
    change = None
    raw_chg = row.get("todaysChangePerc")
    try:
        if raw_chg is not None:
            change = float(raw_chg)
    except (TypeError, ValueError):
        change = None
    if change is None and price is not None:
        prev_c = _num(prev.get("c"))
        if prev_c:
            change = ((price - prev_c) / prev_c) * 100
    return price, change


def _price_from_unified(row: dict) -> tuple[float | None, float | None]:
    last_trade = row.get("last_trade") if isinstance(row.get("last_trade"), dict) else {}
    last_minute = row.get("last_minute") if isinstance(row.get("last_minute"), dict) else {}
    session = row.get("session") if isinstance(row.get("session"), dict) else {}
    price = (
        _num(last_trade.get("price"))
        or _num(last_minute.get("close"))
        or _num(session.get("close"))
        or _num(session.get("previous_close"))
    )
    change = None
    raw_chg = session.get("change_percent")
    try:
        if raw_chg is not None:
            change = float(raw_chg)
    except (TypeError, ValueError):
        change = None
    if change is None and price is not None:
        prev_c = _num(session.get("previous_close"))
        if prev_c:
            change = ((price - prev_c) / prev_c) * 100
    return price, change


def _ingest_rows(out: dict, rows) -> None:
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list):
        return
    for row in rows:
        if not isinstance(row, dict):
            continue
        ticker = str(row.get("ticker") or "").strip().upper()
        if not ticker:
            continue
        price, change = _price_from_unified(row)
        if price is None:
            price, change = _price_from_snapshot(row)
        if price is not None:
            out[ticker] = (price, change)


def _prev_bar_quote(ticker: str) -> tuple[float | None, float | None]:
    payload, err = _get(f"/v2/aggs/ticker/{ticker}/prev", {"adjusted": "true"})
    if err or not payload:
        return None, None
    results = payload.get("results") or []
    row = results[0] if isinstance(results, list) and results else None
    if not isinstance(row, dict):
        row = payload.get("ticker") if isinstance(payload.get("ticker"), dict) else None
    if not isinstance(row, dict):
        return None, None
    return _num(row.get("c")), None


def snapshot_quotes(tickers: list[str]) -> dict[str, tuple[float | None, float | None]]:
    """Price every requested US stock/ETF, including names late in the class list (e.g. EA).

    Primary: GET /v3/snapshot?ticker.any_of=AAPL,EA,...&limit=250
    Misses: single-ticker snapshot, then previous-day bar.
    """
    out: dict[str, tuple[float | None, float | None]] = {}
    symbols = []
    seen: set[str] = set()
    for raw in tickers:
        symbol = str(raw or "").strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        symbols.append(symbol)
    if not symbols or not configured() or on_cooldown():
        return out

    for i in range(0, len(symbols), SNAPSHOT_CHUNK):
        chunk = symbols[i : i + SNAPSHOT_CHUNK]
        payload, err = _get(
            "/v3/snapshot",
            {
                "ticker.any_of": ",".join(chunk),
                "type": "stocks",
                "limit": min(250, max(len(chunk), 1)),
            },
        )
        if err or not payload:
            payload, err = _get(
                "/v2/snapshot/locale/us/markets/stocks/tickers",
                {"tickers": ",".join(chunk)},
            )
        if err or not payload:
            continue
        _ingest_rows(out, payload.get("results") or payload.get("tickers"))
        if isinstance(payload.get("ticker"), dict):
            _ingest_rows(out, payload.get("ticker"))

    missing = [s for s in symbols if s not in out]
    for ticker in missing:
        if on_cooldown():
            break
        payload, err = _get(f"/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}")
        if not err and payload:
            _ingest_rows(out, payload.get("ticker") or payload.get("tickers") or payload.get("results"))
        if ticker in out:
            continue
        price, change = _prev_bar_quote(ticker)
        if price is not None:
            out[ticker] = (price, change)
    return out


_CHART_SPANS = {
    "1mo": {"days": 40, "multiplier": 1, "timespan": "day", "interval": "1d"},
    "3mo": {"days": 100, "multiplier": 1, "timespan": "day", "interval": "1d"},
    "6mo": {"days": 200, "multiplier": 1, "timespan": "day", "interval": "1d"},
    "1y": {"days": 400, "multiplier": 1, "timespan": "day", "interval": "1d"},
    "5y": {"days": 365 * 5 + 21, "multiplier": 1, "timespan": "week", "interval": "1wk"},
}


def chart_body(symbol: str, span: str) -> tuple[dict | None, str | None]:
    """Daily/weekly OHLC for the classroom price chart (Starter: 15-min delayed, 5y history)."""
    cfg = _CHART_SPANS.get(span)
    if not cfg:
        return None, f"Unknown chart range {span}"
    ticker = str(symbol or "").strip().upper()
    if not ticker:
        return None, "ticker required"
    today = date.today()
    start = today - timedelta(days=int(cfg["days"]))
    path = (
        f"/v2/aggs/ticker/{ticker}/range/{cfg['multiplier']}/{cfg['timespan']}"
        f"/{start.isoformat()}/{today.isoformat()}"
    )
    payload, err = _get(path, {"adjusted": "true", "sort": "asc", "limit": 50000})
    if err:
        return None, err
    results = (payload or {}).get("results") or []
    if not isinstance(results, list) or not results:
        return None, f"No chart data for {ticker}"

    points = []
    for bar in results:
        if not isinstance(bar, dict):
            continue
        close = _num(bar.get("c"))
        ts_ms = bar.get("t")
        if close is None or ts_ms is None:
            continue
        try:
            ts = int(ts_ms) // 1000
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            continue
        points.append({"t": ts, "date": dt.strftime("%Y-%m-%d"), "close": round(close, 2)})

    if not points:
        return None, f"No price points for {ticker}"
    first = points[0]["close"]
    last = points[-1]["close"]
    change_pct = ((last - first) / first) * 100 if first else None
    return (
        {
            "ticker": ticker,
            "range": span,
            "interval": cfg["interval"],
            "points": points,
            "start": first,
            "end": last,
            "change_pct": round(change_pct, 2) if change_pct is not None else None,
            "source": "massive",
        },
        None,
    )

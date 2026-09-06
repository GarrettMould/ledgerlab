"""Rewrite live market headlines into classroom-safe Ledger Lab briefs (no outbound links)."""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import requests

OPENAI_API_KEY = (os.environ.get("OPENAI_API_KEY") or "").strip()
OPENAI_MODEL = (os.environ.get("OPENAI_MODEL") or "gpt-4o-mini").strip()

THEME_KEYWORDS = [
    ("rates", ["federal reserve", "fed ", "interest rate", "treasury yield", "bond yield", "rate cut", "rate hike", "fomc"]),
    ("inflation", ["inflation", "cpi", "consumer price", "pce"]),
    ("jobs", ["jobs report", "payrolls", "unemployment", "hiring"]),
    ("oil", ["crude", "oil price", "opec", "brent", "wti"]),
    ("gold", ["gold price", "gold rises", "gold falls", "bullion"]),
    ("housing", ["home price", "housing market", "mortgage rate", "existing home", "new home sales", "florida housing"]),
    ("dollar", ["u.s. dollar", "us dollar", "greenback", "dollar index", "forex"]),
    ("stocks", ["wall street", "s&p", "dow jones", "nasdaq", "stock market", "equities"]),
]

MARKET_LABELS = {
    "stocks": "Stocks",
    "etfs": "ETFs",
    "bonds": "Bonds",
    "commodities": "Commodities",
    "currencies": "Currencies",
    "realestate": "Real estate",
    "rates": "Bonds / rates",
    "inflation": "Bonds & stocks",
    "jobs": "Stocks & economy",
    "oil": "Commodities (oil)",
    "gold": "Commodities (gold)",
    "housing": "Real estate",
    "dollar": "Currencies",
}


def build_catalog_keywords(market_catalog: dict) -> list[tuple[str, str, list[str]]]:
    """Return (market_id, label, keywords[]) from the classroom catalog."""
    rows: list[tuple[str, str, list[str]]] = []
    for market_id, items in (market_catalog or {}).items():
        label = MARKET_LABELS.get(market_id, market_id.title())
        for item in items:
            ticker = str(item.get("ticker") or "").upper()
            name = str(item.get("name") or "")
            keys = []
            if ticker:
                keys.append(ticker.lower())
                # Avoid matching tiny tickers like "V" alone in prose.
                if len(ticker) >= 2:
                    keys.append(f" {ticker.lower()} ")
            if name:
                keys.append(name.lower())
                # First significant word of company names.
                first = re.split(r"[\s,/]+", name)[0].lower()
                if len(first) >= 4:
                    keys.append(first)
            industry = item.get("industry")
            if industry:
                keys.append(str(industry).lower())
            kind = item.get("kind")
            if kind:
                keys.append(str(kind).lower())
            rows.append((market_id, label, keys))
    return rows


def _norm(text: str) -> str:
    return f" {(text or '').lower()} "


def match_markets(title: str, summary: str, catalog_keywords: list[tuple[str, str, list[str]]]) -> list[dict]:
    blob = _norm(f"{title} {summary}")
    found: dict[str, dict] = {}

    for market_id, label, keys in catalog_keywords:
        for key in keys:
            token = key.strip().lower()
            if len(token) < 2:
                continue
            # Prefer word-ish matches for short tickers.
            if len(token) <= 3:
                if re.search(rf"(?<![a-z0-9]){re.escape(token)}(?![a-z0-9])", blob):
                    found[market_id] = {"id": market_id, "label": label}
                    break
            elif token in blob:
                found[market_id] = {"id": market_id, "label": label}
                break

    for theme_id, keys in THEME_KEYWORDS:
        for key in keys:
            if key in blob:
                label = MARKET_LABELS.get(theme_id, theme_id.title())
                # Map themes onto classroom markets where possible.
                mapped = {
                    "rates": "bonds",
                    "inflation": "bonds",
                    "jobs": "stocks",
                    "oil": "commodities",
                    "gold": "commodities",
                    "housing": "realestate",
                    "dollar": "currencies",
                    "stocks": "stocks",
                }.get(theme_id, theme_id)
                found[mapped] = {
                    "id": mapped,
                    "label": MARKET_LABELS.get(mapped, label),
                }
                break

    return list(found.values())


def filter_relevant_headlines(
    items: list[dict],
    catalog_keywords: list[tuple[str, str, list[str]]],
    *,
    limit: int = 10,
) -> list[dict]:
    scored: list[tuple[int, dict, list[dict]]] = []
    skip_pat = re.compile(
        r"\b(celebrity|gossip|horoscope|recipe|crossword|quiz|meme|onlyfans)\b",
        re.I,
    )
    for item in items:
        title = item.get("title") or ""
        summary = item.get("summary") or ""
        if skip_pat.search(title):
            continue
        markets = match_markets(title, summary, catalog_keywords)
        if not markets:
            continue
        # Prefer items that hit specific catalog names/tickers over broad themes only.
        score = len(markets)
        if any(m["id"] in {"stocks", "etfs", "bonds", "commodities", "currencies", "realestate"} for m in markets):
            score += 1
        scored.append((score, item, markets))

    scored.sort(key=lambda row: (row[0], row[1].get("published_at") or ""), reverse=True)
    out = []
    for score, item, markets in scored[:limit]:
        enriched = dict(item)
        enriched["matched_markets"] = markets
        enriched["relevance"] = score
        out.append(enriched)
    return out


def _story_id(title: str) -> str:
    digest = hashlib.sha1((title or "").encode("utf-8")).hexdigest()[:12]
    return f"class:{digest}"


def template_rewrite(item: dict) -> dict:
    """Deterministic classroom rewrite when no LLM key is configured."""
    title = (item.get("title") or "").strip()
    summary = (item.get("summary") or "").strip()
    markets = item.get("matched_markets") or []
    labels = [m["label"] for m in markets][:3]

    # Strip outlet-ish prefixes and sensational punctuation for a calmer class tone.
    clean = re.sub(r"^(breaking|exclusive|just in)[:\s-]+", "", title, flags=re.I)
    clean = re.sub(r"[!?]+$", "", clean).strip()
    if clean and clean[0].islower():
        clean = clean[0].upper() + clean[1:]

    class_title = clean if len(clean) <= 90 else clean[:87].rstrip() + "…"
    if not class_title.lower().startswith(("class", "market", "why", "what", "how")):
        class_title = f"Market update: {class_title}"

    focus = ", ".join(labels) if labels else "your portfolio"
    body_parts = [
        f"Investors are watching news related to {focus}.",
    ]
    if summary and summary.lower() not in clean.lower():
        snippet = summary
        if len(snippet) > 160:
            snippet = snippet[:157].rstrip() + "…"
        body_parts.append(snippet)
    body_parts.append(
        "In Ledger Lab, ask: does this make stocks, bonds, commodities, currencies, or housing look stronger or weaker for your goal?"
    )
    takeaway = (
        f"Check your {labels[0]} exposure and decide if this changes your plan."
        if labels
        else "Connect this headline to your investment goal before you trade."
    )

    return {
        "id": _story_id(title),
        "title": class_title,
        "body": " ".join(body_parts),
        "takeaway": takeaway,
        "markets": labels,
        "published_at": item.get("published_at"),
        "generated": "template",
    }


def _openai_rewrite_batch(items: list[dict]) -> list[dict] | None:
    if not OPENAI_API_KEY or not items:
        return None

    catalog_hint = []
    for item in items:
        catalog_hint.append(
            {
                "id": item.get("id"),
                "headline": item.get("title"),
                "blurb": item.get("summary"),
                "markets": [m.get("label") for m in (item.get("matched_markets") or [])],
            }
        )

    system = (
        "You write short market briefs for Ledger Lab, a high-school classroom investing game. "
        "Rewrite public headlines into original classroom stories. "
        "Do not copy headlines verbatim. Do not include URLs, outlet names, tickers alone without context, "
        "politics as entertainment, or anything inappropriate for school. "
        "Keep grade 9–11 reading level. "
        "Return ONLY valid JSON: an array of objects with keys "
        "id, title, body, takeaway, markets (array of strings from the input markets when relevant)."
    )
    user = (
        "Create one classroom story per input item. "
        "body: 2–4 sentences. takeaway: one sentence about what a student investor might consider. "
        "Ignore celebrity/gossip. If an item is irrelevant, skip it.\n\n"
        f"INPUT:\n{json.dumps(catalog_hint, indent=2)}"
    )

    try:
        res = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENAI_MODEL,
                "temperature": 0.4,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system},
                    {
                        "role": "user",
                        "content": user
                        + '\n\nRespond as {"stories":[...]}',
                    },
                ],
            },
            timeout=45,
        )
        if res.status_code != 200:
            return None
        payload = res.json()
        content = payload["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        stories = parsed.get("stories") if isinstance(parsed, dict) else parsed
        if not isinstance(stories, list):
            return None

        by_id = {item.get("id"): item for item in items}
        out = []
        for story in stories:
            if not isinstance(story, dict):
                continue
            src = by_id.get(story.get("id"))
            title = (story.get("title") or "").strip()
            body = (story.get("body") or "").strip()
            if not title or not body:
                continue
            markets = story.get("markets") or []
            if isinstance(markets, str):
                markets = [markets]
            out.append(
                {
                    "id": _story_id(src["title"] if src else title),
                    "title": title[:120],
                    "body": body[:700],
                    "takeaway": (story.get("takeaway") or "").strip()[:220] or None,
                    "markets": [str(m) for m in markets][:4],
                    "published_at": src.get("published_at") if src else None,
                    "generated": "ai",
                }
            )
        return out or None
    except Exception:
        return None


def load_story_cache(path: Path) -> dict:
    try:
        if path.exists():
            return json.loads(path.read_text())
    except Exception:
        pass
    return {"fetched_at": 0, "stories": []}


def save_story_cache(path: Path, stories: list[dict]) -> None:
    try:
        path.write_text(
            json.dumps(
                {
                    "fetched_at": datetime.now(timezone.utc).timestamp(),
                    "stories": stories,
                },
                indent=2,
            )
        )
    except Exception:
        pass


def build_classroom_news(
    raw_items: list[dict],
    market_catalog: dict,
    *,
    cache_path: Path,
    limit: int = 8,
    force_refresh: bool = False,
    cache_ttl: int = 60 * 45,
) -> list[dict]:
    now = datetime.now(timezone.utc).timestamp()
    disk = load_story_cache(cache_path)
    if (
        not force_refresh
        and disk.get("stories")
        and now - float(disk.get("fetched_at") or 0) < cache_ttl
    ):
        return disk["stories"][:limit]

    keywords = build_catalog_keywords(market_catalog)
    relevant = filter_relevant_headlines(raw_items, keywords, limit=max(limit, 10))
    if not relevant:
        # Fall back to top raw items with generic stock theme so the feed isn't empty.
        relevant = []
        for item in raw_items[:limit]:
            row = dict(item)
            row["matched_markets"] = [{"id": "stocks", "label": "Stocks"}]
            relevant.append(row)

    ai_stories = _openai_rewrite_batch(relevant[:limit])
    if ai_stories:
        stories = ai_stories[:limit]
    else:
        stories = [template_rewrite(item) for item in relevant[:limit]]

    save_story_cache(cache_path, stories)
    return stories[:limit]

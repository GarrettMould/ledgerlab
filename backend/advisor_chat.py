"""Classroom investment advisor chat — OpenAI GPT, explain-only (no buy/sell orders)."""

from __future__ import annotations

import os
from typing import Any

import requests

import firestore_ledger as fs_ledger
from openai_env import openai_api_key as _openai_api_key

MAX_MESSAGE_CHARS = 800
MAX_HISTORY = 12
MAX_REPLY_CHARS = 1200


def _openai_model() -> str:
    return (os.environ.get("OPENAI_MODEL") or "gpt-4o-mini").strip()


SYSTEM_PROMPT = """You are Ledger, a calm classroom teacher and financial advisor inside Ledger Lab (a practice market for middle/high-school students).

Teach the way a good teacher talks: clear, curious, and human. Help them think — don't lecture, and don't sprinkle vocab or app-tour talk for its own sake.

You know these ideas and may use them when they truly fit (most replies should NOT name a term):
- Value, scarcity, opportunity cost, tradeoffs, incentives
- Liquidity, inflation, risk vs. return, diversification
- Time horizon, compounding, interest/yield, fees

How to answer:
- Teacher tone: warm, direct, a little Socratic. Talk like you're sitting next to them, not reading a textbook.
- Keep replies short: ~40–80 words. Two or three sentences, then one question. No walls of text.
- Do not force labels like “that's opportunity cost” or “that's liquidity.” Explain in plain English first. Name a concept only when it helps, and at most once every few turns — never in back-to-back messages unless they asked for the word.
- End with one concrete question they can answer in the chat. Wait for their reply.
- Use the classroom portfolio snapshot (cash, holdings, cost, market value, $ and % gain/loss, mix). Refer to their real tickers and numbers when it helps. Don't invent holdings.
- Know Ledger Lab (see the app briefing). Use a feature or the class deadline only when it changes the advice — never list the app or quiz them on menus.
- If they mention anything on the class market (a stock, ETF, bond, commodity, currency, or Florida city/home), use the live class-market list. Don't ask what it costs or how much they'd spend — the listed price is already there. Homes: list price and cash due today (down + closing). Everything else: price is per share or unit.
- Use the class contest end date from the portfolio snapshot as the time horizon. Don't ask “how long do you plan to hold?” as if they have decades; they don't. Mention that date when timing actually matters.
- Frame choices as practice options with tradeoffs. Never “buy this” / “sell that” as an order.
- No real-world brokerage steps, no personal financial data requests, no guaranteed returns, no tipster slang.
- If unsure, say so briefly.
"""

APP_BRIEFING = """Ledger Lab — app briefing (facts, not a script):

What it is: A classroom investing game. Students get play cash, buy/sell from the class market, and try to grow total value (cash + portfolio) by the contest end. This is not a real brokerage.

Contest: Ends on the date the teacher set (see the portfolio snapshot; default is May 15). Rankings/standings compare classmates. Time horizon for almost every choice is “from now until contest end,” not retirement.

Home: Cash, portfolio value, total, avatar/closet, investing-strategy bio, Ask Ledger (you).

Markets (teacher can turn some off): stocks, ETFs, bonds, commodities, currencies, Florida homes, country lending. Students can suggest a ticker for the teacher to add. A live class-market list (ticker, name, price) is attached every turn — that is the source of truth. Don't ask them to look up a price or guess a budget for something already listed.

Bonds: Quoted with yield; sold in $100-face units; interest is estimated through the contest end (or maturity if sooner).

Homes (Florida map): Typical metro home prices (not a specific condo unit). Tickers like FL-MIA (Miami). Buy with a classroom mortgage: ~20% down + closing costs due in cash today; the rest is a loan. “Miami apartment/house” means the Miami listing.

Lend to the World: Map of countries; lend at least $100; monthly interest; riskier countries can miss a payment. Collect on the dashboard.

Peer lending: Students can lend to / borrow from classmates (Lending Lab is not a real classmate). Those loans are always due five days before the contest ends.

Jobs & Create a Business: Design a closet item with AI, hire a crew or partner, post to the Job Board, teacher must approve before it goes live. Founder's crown is earn-only after approval. Crew wages vs 50/50 partnership.

Closet: Outfit the blocky avatar; buy class items; some are earn-only.

Other: Job Board, class standings, news desk, purchase history, investment report, Head-to-Head stock picks, optional class chat. History quiz exists but is currently hidden.

You (Ledger): Explain assets and help them think about their classroom book. Practice advice only.
"""


def _money(n) -> str:
    try:
        return f"${float(n):,.0f}"
    except (TypeError, ValueError):
        return "—"


def _px(n) -> str:
    try:
        v = float(n)
    except (TypeError, ValueError):
        return "—"
    if abs(v) >= 100:
        return f"${v:,.0f}"
    if abs(v) >= 1:
        return f"${v:,.2f}"
    return f"${v:,.4f}"


def _pct(n) -> str:
    try:
        v = float(n)
    except (TypeError, ValueError):
        return "—"
    sign = "+" if v > 0 else ""
    return f"{sign}{v:.1f}%"


def _num(row: dict, *keys):
    for key in keys:
        if row.get(key) is None:
            continue
        try:
            return float(row.get(key))
        except (TypeError, ValueError):
            continue
    return None


def _compact_portfolio(portfolio: dict | None) -> str:
    if not isinstance(portfolio, dict):
        return "No portfolio snapshot provided."
    cash = _num(portfolio, "cash") or 0.0
    port_val = _num(portfolio, "portfolio_value", "portfolioValue") or 0.0
    total = _num(portfolio, "total_value", "totalValue") or (cash + port_val)
    cash_pct = _num(portfolio, "cash_pct")
    if cash_pct is None and total > 0:
        cash_pct = (cash / total) * 100
    invested = _num(portfolio, "invested")
    u_gain = _num(portfolio, "unrealized_gain")
    u_gain_pct = _num(portfolio, "unrealized_gain_pct")
    goal = str(portfolio.get("investmentGoal") or portfolio.get("classGoal") or "").strip()
    class_name = str(portfolio.get("className") or "").strip()
    contest_end = str(portfolio.get("contestEnd") or "May 15, 2027").strip()

    lines = [
        f"Class contest ends: {contest_end} (this is the time horizon)",
    ]
    if class_name:
        lines.append(f"Class: {class_name}")
    if goal:
        lines.append(f"Class investment goal: {goal}")
    lines.extend([
        f"Cash: {_money(cash)}"
        + (f" ({cash_pct:.0f}% of total)" if cash_pct is not None else ""),
        f"Invested holdings: {_money(port_val)}",
        f"Total value: {_money(total)}",
    ])
    if invested is not None:
        lines.append(f"Amount paid in (cost basis): {_money(invested)}")
    if u_gain is not None:
        lines.append(
            "Unrealized gain/loss: "
            f"{_money(u_gain)}"
            + (f" ({_pct(u_gain_pct)})" if u_gain_pct is not None else "")
        )

    holdings = portfolio.get("holdings") or []
    if isinstance(holdings, list) and holdings:
        lines.append("Holdings (newest snapshot):")
        for row in holdings[:16]:
            if not isinstance(row, dict):
                continue
            ticker = str(row.get("ticker") or row.get("symbol") or "?").upper()
            name = str(row.get("name") or "").strip()
            kind = str(row.get("asset_type") or row.get("kind") or "").strip()
            shares = _num(row, "shares", "qty", "quantity")
            avg = _num(row, "avg_cost", "avgCost")
            cost = _num(row, "cost_basis", "costBasis")
            price = _num(row, "price")
            mv = _num(row, "market_value", "marketValue")
            gain = _num(row, "gain_loss", "gainLoss")
            gain_pct = _num(row, "gain_loss_pct", "gainLossPct")
            weight = _num(row, "weight_pct", "weightPct")
            if mv is None and shares is not None and price is not None:
                mv = shares * price
            if cost is None and shares is not None and avg is not None:
                cost = shares * avg
            if gain is None and mv is not None and cost is not None:
                gain = mv - cost
            if gain_pct is None and gain is not None and cost and cost > 0:
                gain_pct = (gain / cost) * 100
            if weight is None and mv is not None and total > 0:
                weight = (mv / total) * 100
            label = ticker + (f" ({name})" if name else "")
            if kind:
                label += f" [{kind}]"
            bits = []
            if shares is not None:
                bits.append(f"{shares:g} sh")
            if price is not None:
                bits.append(f"px {_money(price)}")
            if mv is not None:
                bits.append(f"value {_money(mv)}")
            if cost is not None:
                bits.append(f"cost {_money(cost)}")
            if gain is not None:
                bits.append(f"P/L {_money(gain)}" + (f" {_pct(gain_pct)}" if gain_pct is not None else ""))
            if weight is not None:
                bits.append(f"{weight:.0f}% of total")
            lines.append(f"- {label}: " + (", ".join(bits) if bits else "held"))
    else:
        lines.append("Holdings: none yet")

    lending = portfolio.get("lending") if isinstance(portfolio.get("lending"), dict) else {}
    country = lending.get("countryLoans") or []
    lent = lending.get("peerLent") or []
    borrowed = lending.get("peerBorrowed") or []
    if country or lent or borrowed:
        lines.append("Lending:")
        for loan in country[:8]:
            if not isinstance(loan, dict):
                continue
            label = str(loan.get("countryName") or loan.get("country") or "Country loan")
            lines.append(
                f"- Lent to {label}: {_money(loan.get('principal'))}"
                + (
                    f" @ {float(loan.get('ratePct') or loan.get('rate_pct') or 0):.1f}%"
                    if loan.get("ratePct") is not None or loan.get("rate_pct") is not None
                    else ""
                )
            )
        for loan in lent[:6]:
            if not isinstance(loan, dict):
                continue
            lines.append(
                f"- Peer loan out: {_money(loan.get('principal'))} to {loan.get('borrowerName') or 'classmate'}"
            )
        for loan in borrowed[:6]:
            if not isinstance(loan, dict):
                continue
            lines.append(
                f"- Peer loan owed: {_money(loan.get('principal'))} to {loan.get('lenderName') or 'classmate'}"
            )
    return "\n".join(lines)


def _warm_quote_cache(classroom_app) -> None:
    """Use quotes already in memory, or load the on-disk cache. No live API calls."""
    try:
        if not classroom_app._quote_cache:
            classroom_app._load_disk_quotes()
        classroom_app._seed_commodity_quotes_from_feeds()
    except Exception:
        pass


def _lookup_price(classroom_app, ticker: str):
    t = str(ticker or "").strip().upper()
    if not t:
        return None, None
    try:
        for cached in (classroom_app._category_cache or {}).values():
            rows = cached[1] if isinstance(cached, tuple) and len(cached) > 1 else []
            for row in rows:
                if str(row.get("ticker") or "").upper() == t and row.get("price") is not None:
                    return row.get("price"), row.get("change_pct")
    except Exception:
        pass
    try:
        return classroom_app._cache_get(t, allow_stale=True)
    except Exception:
        return None, None


def _extra_market_items(category: str) -> list[dict]:
    try:
        return list(fs_ledger.get_extra_market_items(None, category=category) or [])
    except Exception:
        return []


def _catalog_items(classroom_app, category: str) -> list[dict]:
    rows = [
        item
        for item in list(classroom_app.MARKET_CATALOG.get(category) or [])
        if isinstance(item, dict)
    ]
    if category not in ("stocks", "etfs"):
        return rows
    have = {str(item.get("ticker") or "").strip().upper() for item in rows}
    for extra in _extra_market_items(category):
        if not isinstance(extra, dict):
            continue
        ticker = str(extra.get("ticker") or "").strip().upper()
        if ticker and ticker not in have:
            rows.append(extra)
            have.add(ticker)
    return rows


def _unit_price_line(item: dict, price, *, unit: str = "") -> str:
    ticker = str(item.get("ticker") or "")
    name = str(item.get("name") or ticker)
    label = f"- {ticker} {name}: "
    if price is None:
        return label + "listed (price not loaded)"
    text = label + _px(price)
    if unit:
        text += f"/{unit}"
    return text


def _homes_section(classroom_app) -> list[str]:
    rows = _catalog_items(classroom_app, "realestate")
    if not rows:
        return []
    lines = [
        "Florida homes (typical metro price, not a specific unit; ~20% down + closing due today):"
    ]
    for item in rows[:12]:
        try:
            costs = classroom_app.home_purchase_costs(item)
        except Exception:
            costs = {}
        ticker = str(item.get("ticker") or "")
        name = str(item.get("name") or ticker)
        bits = [
            f"{ticker} {name}: list {_money(costs.get('price') or item.get('price'))}",
            f"cash due today {_money(costs.get('due_today'))}",
            f"est payment {_money(costs.get('est_monthly_payment'))}/mo",
        ]
        rent = item.get("monthly_rent")
        if rent is not None:
            bits.append(f"rent ~{_money(rent)}/mo")
        lines.append("- " + "; ".join(bits))
    return lines


def _class_market_briefing() -> str:
    """Compact live board: stocks, ETFs, bonds, commodities, currencies, homes."""
    try:
        import app as classroom_app
    except Exception:
        return ""
    _warm_quote_cache(classroom_app)

    sections: list[str] = [
        "Live class market (same board they see). If they name anything on this list, use these prices — don't ask what it costs or how much they'd spend.",
        "Nicknames map to tickers (Miami apartment → FL-MIA, gold → GOLD, oil/crude → OIL, euro → EUR).",
    ]

    stocks = _catalog_items(classroom_app, "stocks")[:120]
    if stocks:
        sections.append("Stocks (price per share):")
        for item in stocks:
            price, _ = _lookup_price(classroom_app, item.get("ticker"))
            sections.append(_unit_price_line(item, price))

    etfs = _catalog_items(classroom_app, "etfs")[:40]
    if etfs:
        sections.append("ETFs (price per share):")
        for item in etfs:
            price, _ = _lookup_price(classroom_app, item.get("ticker"))
            sections.append(_unit_price_line(item, price))

    bonds = _catalog_items(classroom_app, "bonds")[:24]
    if bonds:
        sections.append("Bonds ($100 face units):")
        for item in bonds:
            ticker = str(item.get("ticker") or "")
            name = str(item.get("name") or ticker)
            yld = item.get("yield_pct")
            px = item.get("price")
            line = f"- {ticker} {name}: {_px(px) if px is not None else '$100'}"
            if yld is not None:
                line += f"; yield {float(yld):.2f}%"
            mat = str(item.get("maturity") or "").strip()
            if mat:
                line += f"; mat {mat}"
            sections.append(line)

    commodities = _catalog_items(classroom_app, "commodities")[:20]
    if commodities:
        sections.append("Commodities (classroom unit price):")
        for item in commodities:
            price, _ = _lookup_price(classroom_app, item.get("ticker"))
            unit = str(item.get("unit_label") or "").strip()
            sections.append(_unit_price_line(item, price, unit=unit))

    currencies = _catalog_items(classroom_app, "currencies")[:16]
    if currencies:
        sections.append("Currencies (USD per classroom unit):")
        for item in currencies:
            price, _ = _lookup_price(classroom_app, item.get("ticker"))
            unit = str(item.get("unit_label") or "").strip()
            sections.append(_unit_price_line(item, price, unit=unit))

    sections.extend(_homes_section(classroom_app))
    return "\n".join(sections)


def _normalize_history(raw: Any) -> list[dict]:
    out = []
    if not isinstance(raw, list):
        return out
    for item in raw[-MAX_HISTORY:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        if role not in ("user", "assistant"):
            continue
        content = str(item.get("content") or item.get("text") or "").strip()
        if not content:
            continue
        out.append({"role": role, "content": content[:MAX_MESSAGE_CHARS]})
    return out


def chat(
    class_id: str,
    student_id: str,
    *,
    message: str,
    history: list | None = None,
    portfolio: dict | None = None,
) -> dict:
    if not class_id or not student_id:
        raise ValueError("classId and studentId are required")
    student = fs_ledger.get_student(class_id, student_id)
    if not student:
        raise PermissionError("Student not found in this class")

    key = _openai_api_key()
    if not key:
        raise RuntimeError(
            "OPENAI_API_KEY is missing on the backend. In Vercel: Settings → "
            "Environment Variables, add OPENAI_API_KEY for Production, apply it to "
            "the backend service (not only frontend), then Redeploy."
        )

    text = str(message or "").strip()
    if not text:
        raise ValueError("Message is required")
    if len(text) > MAX_MESSAGE_CHARS:
        raise ValueError(f"Keep messages under {MAX_MESSAGE_CHARS} characters")

    prior = _normalize_history(history)
    context = _compact_portfolio(portfolio)
    market = _class_market_briefing()
    name = str(student.get("name") or "Student")[:40]

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "system",
            "content": (
                f"{APP_BRIEFING}\n\n"
                f"Student name: {name}\n"
                f"Classroom portfolio snapshot:\n{context}"
                + (f"\n\n{market}" if market else "")
            ),
        },
        *prior,
        {"role": "user", "content": text},
    ]

    res = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        json={
            "model": _openai_model(),
            "temperature": 0.55,
            "max_tokens": 220,
            "messages": messages,
        },
        timeout=45,
    )
    if res.status_code >= 400:
        detail = ""
        try:
            detail = str(res.json().get("error", {}).get("message") or "")
        except Exception:
            detail = (res.text or "")[:200]
        raise RuntimeError(detail or f"OpenAI error ({res.status_code})")

    data = res.json()
    reply = (
        ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    ).strip()
    if not reply:
        raise RuntimeError("Advisor returned an empty reply")
    reply = reply[:MAX_REPLY_CHARS]

    return {
        "reply": reply,
        "model": _openai_model(),
        "studentName": name,
    }

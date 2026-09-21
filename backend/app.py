"""Classroom financial tracker API — roster, balances, and live stock portfolios."""

from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

import firestore_ledger as fs_ledger
import housing_index
import housing_settlement
from portfolio_service import (
    build_history_payload,
    compute_totals as portfolio_compute_totals,
    ensure_fs_starting_snapshot,
    record_fs_snapshot,
    serialize_portfolio,
    using_firestore,
)

try:
    from dotenv import load_dotenv

    # override=True so .env edits (e.g. FIREBASE_STORAGE_BUCKET) apply on Flask reload
    load_dotenv(Path(__file__).resolve().parent / ".env", override=True)
    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)
    load_dotenv(Path(__file__).resolve().parent.parent / ".env.local", override=True)
except ImportError:
    pass

BASE_DIR = Path(__file__).resolve().parent
# Vercel Functions only allow writes under /tmp (local keeps files next to the app).
_DATA_DIR = (
    Path("/tmp/ledgerlab") if os.environ.get("VERCEL") else BASE_DIR
)
_DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = _DATA_DIR / "classroom.db"
QUOTE_CACHE_PATH = _DATA_DIR / "quote_cache.json"
COMMODITY_SCALE_CACHE_PATH = _DATA_DIR / "commodity_scales.json"
CHART_CACHE_PATH = _DATA_DIR / "chart_cache.json"
NEWS_CACHE_PATH = _DATA_DIR / "news_cache.json"
CLASSROOM_NEWS_CACHE_PATH = _DATA_DIR / "classroom_news_cache.json"
TREASURY_CACHE_PATH = _DATA_DIR / "treasury_yields_cache.json"

app = Flask(__name__)
CORS(app)


@app.errorhandler(Exception)
def api_unhandled_error(exc):
    """Return JSON for API crashes so the UI doesn’t show a generic ‘unreachable’ message."""
    from werkzeug.exceptions import HTTPException

    if isinstance(exc, HTTPException):
        payload = {"error": exc.description or exc.name}
        if (request.path or "").startswith("/api"):
            return jsonify(payload), exc.code
        return exc
    msg = str(exc).strip() or exc.__class__.__name__
    low = msg.lower()
    if "resource_exhausted" in low or "quota exceeded" in low or "429" in low:
        return jsonify({
            "error": (
                "Firestore quota is exhausted for today (too many classroom reads/writes). "
                "Trading pauses until quota resets, or upgrade the Firebase billing plan. "
                "Teachers: avoid mass-refreshing the roster; students: wait a minute and retry."
            ),
            "type": "QuotaExceeded",
        }), 503
    if "permission" in low or "403" in low or "unauthenticated" in low:
        msg = (
            "Firestore rejected the API credentials. "
            "Check FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_PROJECT_ID on Vercel "
            f"({msg})"
        )
    return jsonify({"error": msg, "type": exc.__class__.__name__}), 500


# In-memory quote cache: ticker -> (price, fetched_at, change_pct)
_quote_cache: dict[str, tuple[float, float, float | None]] = {}
# Where the cached classroom price came from (yahoo futures vs ETF proxy, etc.).
_quote_source_by_ticker: dict[str, str] = {}
_category_cache: dict[str, tuple[float, list[dict]]] = {}
CACHE_TTL_SECONDS = 60 * 10  # 10 minutes — classroom quotes don't need second-by-second freshness
# Keep showing last-known prices for a week if live providers fail (classroom continuity).
STALE_OK_SECONDS = 60 * 60 * 24 * 7

# Preferred commodity marks: Yahoo futures. Proxies (Finnhub ETF × scale) are
# also buyable — otherwise a classroom Yahoo 429 storm pauses buys permanently.
COMMODITY_BUY_SOURCES = frozenset({"yahoo", "yfinance"})
COMMODITY_PROXY_BUY_SOURCES = frozenset(
    {"proxy", "finnhub", "derived", "yahoo-etf", "cache", "stale"}
)


def _remember_quote(
    ticker: str,
    price: float,
    fetched_at: float,
    change_pct: float | None,
    source: str | None,
) -> None:
    _quote_cache[ticker] = (price, fetched_at, change_pct)
    if source:
        _quote_source_by_ticker[ticker] = source


def _forget_quote(ticker: str) -> None:
    _quote_cache.pop(ticker, None)
    _quote_source_by_ticker.pop(ticker, None)


def quote_source_for(ticker: str) -> str | None:
    return _quote_source_by_ticker.get(ticker)


def commodity_price_quality(ticker: str) -> str | None:
    """How classroom commodity marks should be labeled for students."""
    symbol = (ticker or "").upper()
    if symbol not in COMMODITY_BY_TICKER:
        return None
    src = (quote_source_for(symbol) or "").strip().lower()
    if src in COMMODITY_BUY_SOURCES:
        return "futures"
    if commodity_buy_allowed(symbol):
        return "approximate"
    return None


def commodity_buy_allowed(ticker: str) -> bool:
    """Allow commodity buys on Yahoo futures or a catalog ETF proxy with a price."""
    symbol = (ticker or "").strip().upper()
    if symbol not in COMMODITY_BY_TICKER:
        return True
    if _cache_get(symbol, allow_stale=True)[0] is None:
        # No usable mark yet — buy endpoint will 404 on missing price anyway.
        return False
    src = (quote_source_for(symbol) or "").strip().lower()
    if src in COMMODITY_BUY_SOURCES:
        return True
    # Trusted scaled/unit/approx ETF→unit conversions (see commodity_etf_proxy_ok).
    if src in COMMODITY_PROXY_BUY_SOURCES or not src:
        return commodity_etf_proxy_ok(symbol)
    return False

FINNHUB_API_KEY = (os.environ.get("FINNHUB_API_KEY") or "").strip()
FINNHUB_BASE = "https://finnhub.io/api/v1"
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}
# Free tier is ~60 calls/min — pause briefly if we get throttled.
_finnhub_cooldown_until = 0.0
FINNHUB_COOLDOWN_SECONDS = 65
# Cap live Finnhub fetches per enrich so one classroom load can't burn the minute
# on Technology→Autos and leave Industrials (last in catalog) with no price.
FINNHUB_MAX_QUOTES_PER_BATCH = 48
# Classroom stock filter tags — teacher-added tickers map into these (no "Custom" tab).
CLASSROOM_INDUSTRIES = (
    "Technology",
    "Consumer",
    "Finance",
    "Healthcare",
    "Energy",
    "Entertainment",
    "Autos",
    "Industrials",
)
# Free Finnhub keys often 403 on forex (OANDA:*) — skip Finnhub FX after first denial.
_finnhub_fx_blocked_until = 0.0
FINNHUB_FX_BLOCK_SECONDS = 6 * 60 * 60
# Yahoo chart/futures 429s — skip Yahoo for a bit so Finnhub can answer fast.
_yahoo_cooldown_until = 0.0
YAHOO_COOLDOWN_SECONDS = 90
# Live ETF→unit scales, calibrated whenever Yahoo futures succeed.
_commodity_live_scales: dict[str, float] = {}
_commodity_scale_at: dict[str, float] = {}
COMMODITY_SCALE_TTL_SECONDS = 60 * 60  # recalibrate at most hourly per commodity
MAX_YAHOO_CALIBRATIONS_PER_BATCH = 2
_last_quote_provider_error: str | None = None
_last_quote_source: str | None = None

# CNN Fear & Greed (stock-market sentiment) — cache for an hour; changes slowly.
_fear_greed_cache: dict | None = None
_fear_greed_fetched_at = 0.0
FEAR_GREED_TTL_SECONDS = 60 * 60


def _normalize_fear_greed_rating(raw: str | None, score: float) -> str:
    text = str(raw or "").strip().lower().replace("_", " ")
    if text in {
        "extreme fear",
        "fear",
        "neutral",
        "greed",
        "extreme greed",
    }:
        return text
    if score <= 24:
        return "extreme fear"
    if score <= 44:
        return "fear"
    if score <= 55:
        return "neutral"
    if score <= 75:
        return "greed"
    return "extreme greed"


def fetch_fear_greed(*, force_refresh: bool = False) -> dict | None:
    """Live CNN Fear & Greed Index via CNN's public dataviz JSON endpoint."""
    global _fear_greed_cache, _fear_greed_fetched_at
    now = time.time()
    if (
        not force_refresh
        and _fear_greed_cache is not None
        and now - _fear_greed_fetched_at < FEAR_GREED_TTL_SECONDS
    ):
        return _fear_greed_cache

    start = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
    url = f"https://production.dataviz.cnn.io/index/fearandgreed/graphdata/{start}"
    headers = {
        **HTTP_HEADERS,
        "Accept": "application/json",
        "Referer": "https://www.cnn.com/markets/fear-and-greed",
    }
    try:
        res = requests.get(url, headers=headers, timeout=12)
        res.raise_for_status()
        payload = res.json() or {}
        fg = payload.get("fear_and_greed") or {}
        score = float(fg.get("score"))
        rating = _normalize_fear_greed_rating(fg.get("rating"), score)
        previous_close = fg.get("previous_close")
        snapshot = {
            "score": round(score, 1),
            "rating": rating,
            "previousClose": (
                round(float(previous_close), 1)
                if previous_close is not None
                else None
            ),
            "updatedAt": fg.get("timestamp") or datetime.now(timezone.utc).isoformat(),
            "source": "cnn",
        }
        _fear_greed_cache = snapshot
        _fear_greed_fetched_at = now
        return snapshot
    except Exception:
        if _fear_greed_cache is not None:
            return {**_fear_greed_cache, "stale": True}
        return None


def _finnhub_on_cooldown() -> bool:
    return time.time() < _finnhub_cooldown_until


def _trip_finnhub_cooldown() -> None:
    global _finnhub_cooldown_until
    _finnhub_cooldown_until = time.time() + FINNHUB_COOLDOWN_SECONDS


def _finnhub_fx_blocked() -> bool:
    return time.time() < _finnhub_fx_blocked_until


def _trip_finnhub_fx_block() -> None:
    """Free Finnhub plans reject forex — stop retrying OANDA symbols for a while."""
    global _finnhub_fx_blocked_until
    _finnhub_fx_blocked_until = time.time() + FINNHUB_FX_BLOCK_SECONDS


def _yahoo_on_cooldown() -> bool:
    return time.time() < _yahoo_cooldown_until


def _trip_yahoo_cooldown() -> None:
    global _yahoo_cooldown_until
    _yahoo_cooldown_until = time.time() + YAHOO_COOLDOWN_SECONDS


def finnhub_configured() -> bool:
    return bool(FINNHUB_API_KEY)


# Curated classroom menus. Stocks/ETFs/commodities use Finnhub when available;
# currencies prefer Yahoo FX (free Finnhub keys usually deny OANDA forex).
# bonds use fixed offerings (+ live Treasury yields); realestate uses city indexes.
MARKET_CATALOG = {
    "stocks": [
        # Technology
        {
            "ticker": "AAPL",
            "name": "Apple",
            "industry": "Technology",
            "info": {
                "summary": "Apple designs consumer electronics and software, including the iPhone, Mac, iPad, and Apple Watch. It also runs services like the App Store, iCloud, and Apple Music.",
            },
        },
        {
            "ticker": "MSFT",
            "name": "Microsoft",
            "industry": "Technology",
            "info": {
                "summary": "Microsoft makes Windows, Office, and cloud computing through Azure. It also builds Xbox gaming hardware and software like LinkedIn and GitHub.",
            },
        },
        {
            "ticker": "GOOGL",
            "name": "Alphabet",
            "industry": "Technology",
            "info": {
                "summary": "Alphabet is Google’s parent company. It earns most of its money from online search and ads, and also runs YouTube, Android, and cloud services.",
            },
        },
        {
            "ticker": "NVDA",
            "name": "NVIDIA",
            "industry": "Technology",
            "info": {
                "summary": "NVIDIA designs graphics chips (GPUs) used in gaming PCs and data centers. Its processors are especially important for artificial intelligence and high-performance computing.",
            },
        },
        {
            "ticker": "META",
            "name": "Meta",
            "industry": "Technology",
            "info": {
                "summary": "Meta owns social apps including Facebook, Instagram, and WhatsApp. It makes money mainly from digital advertising on those platforms.",
            },
        },
        {
            "ticker": "AMD",
            "name": "AMD",
            "industry": "Technology",
            "info": {
                "summary": "AMD designs computer processors and graphics chips that compete with Intel and NVIDIA. Its chips power PCs, servers, and gaming systems.",
            },
        },
        {
            "ticker": "ORCL",
            "name": "Oracle",
            "industry": "Technology",
            "info": {
                "summary": "Oracle sells database software and cloud computing services that companies use to store and manage business data.",
            },
        },
        {
            "ticker": "CRM",
            "name": "Salesforce",
            "industry": "Technology",
            "info": {
                "summary": "Salesforce makes cloud software that helps sales teams track customers and deals. Many companies use it as their main customer relationship system.",
            },
        },
        {
            "ticker": "INTC",
            "name": "Intel",
            "industry": "Technology",
            "info": {
                "summary": "Intel designs and manufactures computer chips used in many PCs and servers. It is one of the best-known semiconductor companies in the world.",
            },
        },
        {
            "ticker": "AVGO",
            "name": "Broadcom",
            "industry": "Technology",
            "info": {
                "summary": "Broadcom makes chips and software that power networking, phones, data centers, and other electronics. Its products help devices connect and process data.",
            },
        },
        # Consumer
        {
            "ticker": "AMZN",
            "name": "Amazon",
            "industry": "Consumer",
            "info": {
                "summary": "Amazon runs a huge online marketplace and fast shipping network. It also leads in cloud computing with Amazon Web Services (AWS) and sells devices like Kindle and Echo.",
            },
        },
        {
            "ticker": "WMT",
            "name": "Walmart",
            "industry": "Consumer",
            "info": {
                "summary": "Walmart is a major retailer selling groceries, household goods, and general merchandise. It operates huge stores and a growing e-commerce business.",
            },
        },
        {
            "ticker": "COST",
            "name": "Costco",
            "industry": "Consumer",
            "info": {
                "summary": "Costco runs membership warehouse clubs that sell bulk groceries and household goods at low prices.",
            },
        },
        {
            "ticker": "NKE",
            "name": "Nike",
            "industry": "Consumer",
            "info": {
                "summary": "Nike designs and sells athletic shoes, apparel, and sports equipment around the world.",
            },
        },
        {
            "ticker": "MCD",
            "name": "McDonald’s",
            "industry": "Consumer",
            "info": {
                "summary": "McDonald’s is a global fast-food restaurant chain known for burgers, fries, and drive-through service.",
            },
        },
        {
            "ticker": "SBUX",
            "name": "Starbucks",
            "industry": "Consumer",
            "info": {
                "summary": "Starbucks operates coffee shops worldwide and sells drinks, food, and packaged coffee products.",
            },
        },
        {
            "ticker": "TGT",
            "name": "Target",
            "industry": "Consumer",
            "info": {
                "summary": "Target is a U.S. retail chain selling clothing, groceries, home goods, and electronics in stores and online.",
            },
        },
        {
            "ticker": "HD",
            "name": "Home Depot",
            "industry": "Consumer",
            "info": {
                "summary": "Home Depot sells tools, lumber, appliances, and home-improvement supplies to do-it-yourself shoppers and professional contractors.",
            },
        },
        {
            "ticker": "KO",
            "name": "Coca-Cola",
            "industry": "Consumer",
            "info": {
                "summary": "Coca-Cola makes soft drinks and other beverages sold in stores and restaurants almost everywhere in the world.",
            },
        },
        {
            "ticker": "PEP",
            "name": "PepsiCo",
            "industry": "Consumer",
            "info": {
                "summary": "PepsiCo sells drinks like Pepsi and snacks like Lay’s and Doritos. It earns money from both beverages and packaged foods.",
            },
        },
        # Finance
        {
            "ticker": "JPM",
            "name": "JPMorgan Chase",
            "industry": "Finance",
            "info": {
                "summary": "JPMorgan Chase is one of the largest U.S. banks. It provides consumer banking, credit cards, investment banking, and wealth management.",
            },
        },
        {
            "ticker": "V",
            "name": "Visa",
            "industry": "Finance",
            "info": {
                "summary": "Visa runs a global payments network that connects banks, merchants, and cardholders. It earns fees when people use Visa cards to pay for goods and services.",
            },
        },
        {
            "ticker": "MA",
            "name": "Mastercard",
            "industry": "Finance",
            "info": {
                "summary": "Mastercard operates a worldwide card payments network. Like Visa, it earns fees when people use Mastercard to pay.",
            },
        },
        {
            "ticker": "BAC",
            "name": "Bank of America",
            "industry": "Finance",
            "info": {
                "summary": "Bank of America is a large U.S. bank offering checking accounts, loans, credit cards, and investment services.",
            },
        },
        {
            "ticker": "GS",
            "name": "Goldman Sachs",
            "industry": "Finance",
            "info": {
                "summary": "Goldman Sachs is an investment bank that helps companies raise money, advises on mergers, and manages investments for institutions and wealthy clients.",
            },
        },
        {
            "ticker": "WFC",
            "name": "Wells Fargo",
            "industry": "Finance",
            "info": {
                "summary": "Wells Fargo is a major U.S. bank that provides checking accounts, mortgages, credit cards, and business lending.",
            },
        },
        {
            "ticker": "C",
            "name": "Citigroup",
            "industry": "Finance",
            "info": {
                "summary": "Citigroup is a global bank that serves consumers and companies with banking, credit cards, and investment services in many countries.",
            },
        },
        {
            "ticker": "AXP",
            "name": "American Express",
            "industry": "Finance",
            "info": {
                "summary": "American Express issues credit and charge cards and provides payment and travel services to consumers and businesses.",
            },
        },
        {
            "ticker": "BLK",
            "name": "BlackRock",
            "industry": "Finance",
            "info": {
                "summary": "BlackRock is one of the world’s largest asset managers. It invests money for clients through mutual funds, ETFs, and other products.",
            },
        },
        {
            "ticker": "SCHW",
            "name": "Charles Schwab",
            "industry": "Finance",
            "info": {
                "summary": "Charles Schwab helps people invest and trade stocks, ETFs, and other assets through brokerage accounts and banking services.",
            },
        },
        {
            "ticker": "MSTR",
            "name": "Strategy (MicroStrategy)",
            "industry": "Finance",
            "info": {
                "summary": "Strategy (formerly MicroStrategy) sells business software and is widely known for holding a large amount of bitcoin on its balance sheet.",
            },
        },
        {
            "ticker": "COIN",
            "name": "Coinbase",
            "industry": "Finance",
            "info": {
                "summary": "Coinbase is a cryptocurrency exchange where people buy, sell, and store digital assets like bitcoin and ethereum.",
            },
        },
        # Healthcare
        {
            "ticker": "JNJ",
            "name": "Johnson & Johnson",
            "industry": "Healthcare",
            "info": {
                "summary": "Johnson & Johnson makes medicines, medical devices, and consumer health products used in hospitals and homes.",
            },
        },
        {
            "ticker": "UNH",
            "name": "UnitedHealth",
            "industry": "Healthcare",
            "info": {
                "summary": "UnitedHealth provides health insurance and health-care services to millions of people in the United States.",
            },
        },
        {
            "ticker": "LLY",
            "name": "Eli Lilly",
            "industry": "Healthcare",
            "info": {
                "summary": "Eli Lilly is a pharmaceutical company that develops prescription medicines, including treatments for diabetes and other major conditions.",
            },
        },
        {
            "ticker": "PFE",
            "name": "Pfizer",
            "industry": "Healthcare",
            "info": {
                "summary": "Pfizer discovers and sells prescription drugs and vaccines used to treat and prevent disease.",
            },
        },
        {
            "ticker": "ABBV",
            "name": "AbbVie",
            "industry": "Healthcare",
            "info": {
                "summary": "AbbVie is a biopharmaceutical company known for specialty medicines that treat immune disorders, cancer, and other diseases.",
            },
        },
        {
            "ticker": "MRK",
            "name": "Merck",
            "industry": "Healthcare",
            "info": {
                "summary": "Merck develops prescription medicines and vaccines for people and animals, including treatments for cancer and infectious disease.",
            },
        },
        {
            "ticker": "AMGN",
            "name": "Amgen",
            "industry": "Healthcare",
            "info": {
                "summary": "Amgen is a biotechnology company that creates biologic medicines used to treat cancer, immune diseases, and other serious conditions.",
            },
        },
        {
            "ticker": "TMO",
            "name": "Thermo Fisher",
            "industry": "Healthcare",
            "info": {
                "summary": "Thermo Fisher Scientific sells lab equipment, chemicals, and services that scientists and drug makers use for research and manufacturing.",
            },
        },
        {
            "ticker": "CVS",
            "name": "CVS Health",
            "industry": "Healthcare",
            "info": {
                "summary": "CVS Health runs pharmacies, clinics, and a large pharmacy-benefit business that helps people get and pay for medicines.",
            },
        },
        {
            "ticker": "MDT",
            "name": "Medtronic",
            "industry": "Healthcare",
            "info": {
                "summary": "Medtronic makes medical devices such as pacemakers, insulin pumps, and surgical tools used by doctors and hospitals.",
            },
        },
        # Energy
        {
            "ticker": "XOM",
            "name": "ExxonMobil",
            "industry": "Energy",
            "info": {
                "summary": "ExxonMobil explores for and produces oil and natural gas, and also refines fuel for cars, planes, and industry.",
            },
        },
        {
            "ticker": "CVX",
            "name": "Chevron",
            "industry": "Energy",
            "info": {
                "summary": "Chevron is a major energy company that produces oil and gas and sells fuels and lubricants worldwide.",
            },
        },
        {
            "ticker": "COP",
            "name": "ConocoPhillips",
            "industry": "Energy",
            "info": {
                "summary": "ConocoPhillips focuses on exploring for and producing oil and natural gas around the world.",
            },
        },
        {
            "ticker": "SLB",
            "name": "Schlumberger",
            "industry": "Energy",
            "info": {
                "summary": "Schlumberger (SLB) provides technology and services that help oil and gas companies find and produce energy underground.",
            },
        },
        {
            "ticker": "EOG",
            "name": "EOG Resources",
            "industry": "Energy",
            "info": {
                "summary": "EOG Resources explores for and produces oil and natural gas, especially from shale formations in the United States.",
            },
        },
        {
            "ticker": "MPC",
            "name": "Marathon Petroleum",
            "industry": "Energy",
            "info": {
                "summary": "Marathon Petroleum refines crude oil into gasoline, diesel, and other fuels and sells them through retail and wholesale channels.",
            },
        },
        {
            "ticker": "OXY",
            "name": "Occidental",
            "industry": "Energy",
            "info": {
                "summary": "Occidental Petroleum produces oil and gas and also works on carbon-management projects related to climate goals.",
            },
        },
        {
            "ticker": "PSX",
            "name": "Phillips 66",
            "industry": "Energy",
            "info": {
                "summary": "Phillips 66 refines oil, markets fuels, and operates pipelines and chemical businesses connected to energy products.",
            },
        },
        {
            "ticker": "VLO",
            "name": "Valero",
            "industry": "Energy",
            "info": {
                "summary": "Valero Energy is one of the largest independent oil refiners in the world, turning crude oil into transportation fuels.",
            },
        },
        {
            "ticker": "WMB",
            "name": "Williams",
            "industry": "Energy",
            "info": {
                "summary": "Williams Companies operates natural-gas pipelines and processing systems that move energy from production areas to customers.",
            },
        },
        # Entertainment
        {
            "ticker": "DIS",
            "name": "Disney",
            "industry": "Entertainment",
            "info": {
                "summary": "Disney creates movies, TV shows, and streaming content, including brands like Marvel, Pixar, and Star Wars. It also runs theme parks and cruise lines.",
            },
        },
        {
            "ticker": "NFLX",
            "name": "Netflix",
            "industry": "Entertainment",
            "info": {
                "summary": "Netflix is a streaming service that delivers TV shows and movies over the internet. It produces original series and films and earns money mainly from subscriptions.",
            },
        },
        {
            "ticker": "CMCSA",
            "name": "Comcast",
            "industry": "Entertainment",
            "info": {
                "summary": "Comcast provides cable TV and internet service and also owns media businesses including NBCUniversal.",
            },
        },
        {
            "ticker": "SPOT",
            "name": "Spotify",
            "industry": "Entertainment",
            "info": {
                "summary": "Spotify is a music and podcast streaming app. Listeners pay with subscriptions or hear ads in the free version.",
            },
        },
        {
            "ticker": "WBD",
            "name": "Warner Bros. Discovery",
            "industry": "Entertainment",
            "info": {
                "summary": "Warner Bros. Discovery owns movie studios, TV networks, and streaming services with brands like HBO, CNN, and DC.",
            },
        },
        {
            "ticker": "EA",
            "name": "Electronic Arts",
            "industry": "Entertainment",
            "info": {
                "summary": "Electronic Arts makes popular video games such as sports titles and other franchises sold on consoles, PCs, and phones.",
            },
        },
        {
            "ticker": "TTWO",
            "name": "Take-Two",
            "industry": "Entertainment",
            "info": {
                "summary": "Take-Two Interactive publishes video games including Grand Theft Auto and other major entertainment franchises.",
            },
        },
        {
            "ticker": "RBLX",
            "name": "Roblox",
            "industry": "Entertainment",
            "info": {
                "summary": "Roblox is an online platform where people play and create games. It earns money from in-game purchases and premium subscriptions.",
            },
        },
        {
            "ticker": "LYV",
            "name": "Live Nation",
            "industry": "Entertainment",
            "info": {
                "summary": "Live Nation promotes concerts and live events and also owns Ticketmaster, a major ticketing platform.",
            },
        },
        {
            "ticker": "ROKU",
            "name": "Roku",
            "industry": "Entertainment",
            "info": {
                "summary": "Roku makes streaming devices and a TV platform that lets people watch apps like Netflix and YouTube on their screens.",
            },
        },
        {
            "ticker": "SONY",
            "name": "Sony",
            "industry": "Entertainment",
            "info": {
                "summary": "Sony makes PlayStation consoles, entertainment content, cameras, and electronics used for games, music, and movies.",
            },
        },
        # Autos
        {
            "ticker": "TSLA",
            "name": "Tesla",
            "industry": "Autos",
            "info": {
                "summary": "Tesla builds electric cars such as the Model 3 and Model Y. It also makes energy products like solar panels and battery storage systems.",
            },
        },
        {
            "ticker": "F",
            "name": "Ford",
            "industry": "Autos",
            "info": {
                "summary": "Ford designs and builds cars and trucks, including popular models like the F-150, and is expanding into electric vehicles.",
            },
        },
        {
            "ticker": "GM",
            "name": "General Motors",
            "industry": "Autos",
            "info": {
                "summary": "General Motors makes vehicles under brands like Chevrolet, GMC, Cadillac, and Buick, and is investing in electric and autonomous cars.",
            },
        },
        {
            "ticker": "TM",
            "name": "Toyota",
            "industry": "Autos",
            "info": {
                "summary": "Toyota is one of the world’s largest automakers, known for reliable cars and hybrids like the Prius, Corolla, and Camry.",
            },
        },
        {
            "ticker": "HMC",
            "name": "Honda",
            "industry": "Autos",
            "info": {
                "summary": "Honda builds cars, motorcycles, and power equipment. Its vehicles are popular for everyday commuting and reliability.",
            },
        },
        {
            "ticker": "STLA",
            "name": "Stellantis",
            "industry": "Autos",
            "info": {
                "summary": "Stellantis owns many car brands including Jeep, Ram, Dodge, Chrysler, Peugeot, and Fiat.",
            },
        },
        {
            "ticker": "RIVN",
            "name": "Rivian",
            "industry": "Autos",
            "info": {
                "summary": "Rivian builds electric trucks and SUVs and also makes delivery vans for companies that want electric fleets.",
            },
        },
        {
            "ticker": "UBER",
            "name": "Uber",
            "industry": "Autos",
            "info": {
                "summary": "Uber runs a ride-hailing and delivery platform that connects drivers with riders and food-delivery customers through an app.",
            },
        },
        {
            "ticker": "APTV",
            "name": "Aptiv",
            "industry": "Autos",
            "info": {
                "summary": "Aptiv makes electrical systems and technology that help cars become safer, smarter, and more connected.",
            },
        },
        {
            "ticker": "BWA",
            "name": "BorgWarner",
            "industry": "Autos",
            "info": {
                "summary": "BorgWarner supplies auto parts and systems for traditional and electric vehicles, including powertrain components.",
            },
        },
        # Industrials
        {
            "ticker": "BA",
            "name": "Boeing",
            "industry": "Industrials",
            "info": {
                "summary": "Boeing builds commercial airplanes and defense aircraft used by airlines and governments around the world.",
            },
        },
        {
            "ticker": "CAT",
            "name": "Caterpillar",
            "industry": "Industrials",
            "info": {
                "summary": "Caterpillar makes heavy construction and mining equipment such as bulldozers, excavators, and engines.",
            },
        },
        {
            "ticker": "GE",
            "name": "GE Aerospace",
            "industry": "Industrials",
            "info": {
                "summary": "GE Aerospace designs jet engines and related systems for commercial and military aircraft.",
            },
        },
        {
            "ticker": "HON",
            "name": "Honeywell",
            "industry": "Industrials",
            "info": {
                "summary": "Honeywell makes aerospace systems, building controls, and industrial technology used in planes, factories, and homes.",
            },
        },
        {
            "ticker": "UPS",
            "name": "UPS",
            "industry": "Industrials",
            "info": {
                "summary": "UPS delivers packages for people and businesses around the world using trucks, planes, and logistics software.",
            },
        },
        {
            "ticker": "UNP",
            "name": "Union Pacific",
            "industry": "Industrials",
            "info": {
                "summary": "Union Pacific operates freight railroads that move goods like cars, grain, and chemicals across the western United States.",
            },
        },
        {
            "ticker": "LMT",
            "name": "Lockheed Martin",
            "industry": "Industrials",
            "info": {
                "summary": "Lockheed Martin builds advanced defense and aerospace systems, including fighter jets and space technology.",
            },
        },
        {
            "ticker": "RTX",
            "name": "RTX",
            "industry": "Industrials",
            "info": {
                "summary": "RTX (Raytheon Technologies) makes jet engines, avionics, and defense systems for commercial and military customers.",
            },
        },
        {
            "ticker": "DE",
            "name": "Deere",
            "industry": "Industrials",
            "info": {
                "summary": "Deere & Company builds farm and construction equipment such as tractors and combines used in agriculture worldwide.",
            },
        },
        {
            "ticker": "MMM",
            "name": "3M",
            "industry": "Industrials",
            "info": {
                "summary": "3M invents and sells thousands of products, from adhesives and safety gear to industrial and consumer materials.",
            },
        },
    ],
    "etfs": [
        {
            "ticker": "SPY",
            "name": "S&P 500 ETF",
            "info": {
                "holdings": ["NVIDIA", "Apple", "Microsoft", "Amazon", "Alphabet"],
            },
        },
        {
            "ticker": "QQQ",
            "name": "Nasdaq-100 ETF",
            "info": {
                "holdings": ["NVIDIA", "Apple", "Microsoft", "Amazon", "Broadcom"],
            },
        },
        {
            "ticker": "VOO",
            "name": "Vanguard S&P 500",
            "info": {
                "holdings": ["NVIDIA", "Apple", "Microsoft", "Amazon", "Alphabet"],
            },
        },
        {
            "ticker": "VTI",
            "name": "Total Stock Market",
            "info": {
                "holdings": ["NVIDIA", "Apple", "Microsoft", "Amazon", "Alphabet"],
            },
        },
        {
            "ticker": "IWM",
            "name": "Russell 2000",
            "info": {
                "holdings": [
                    "Thousands of small-cap U.S. stocks",
                    "No mega-cap (Apple/Microsoft) at the top",
                ],
            },
        },
        {
            "ticker": "DIA",
            "name": "Dow Jones ETF",
            "info": {
                "holdings": ["UnitedHealth", "Goldman Sachs", "Microsoft", "Home Depot", "Caterpillar"],
            },
        },
        {
            "ticker": "XLK",
            "name": "Technology Sector",
            "info": {
                "holdings": ["NVIDIA", "Apple", "Microsoft", "Broadcom", "Meta"],
            },
        },
        {
            "ticker": "XLE",
            "name": "Energy Sector",
            "info": {
                "holdings": ["ExxonMobil", "Chevron", "ConocoPhillips", "EOG Resources", "SLB"],
            },
        },
        {
            "ticker": "XLF",
            "name": "Financial Sector",
            "info": {
                "holdings": ["Berkshire Hathaway", "JPMorgan Chase", "Visa", "Mastercard", "Bank of America"],
            },
        },
        {
            "ticker": "ARKK",
            "name": "ARK Innovation",
            "info": {
                "holdings": ["Tesla", "Coinbase", "Roku", "CRISPR Therapeutics", "Robinhood"],
            },
        },
        {
            "ticker": "IBIT",
            "name": "iShares Bitcoin Trust",
            "info": {
                "summary": "A spot Bitcoin ETF that holds bitcoin and aims to track its U.S. dollar price. Shares trade on a stock exchange like other ETFs.",
                "holdings": ["Bitcoin (spot)", "Cash for fund operations"],
            },
        },
        {
            "ticker": "ETHA",
            "name": "iShares Ethereum Trust",
            "info": {
                "summary": "A spot Ethereum ETF that holds ether and aims to track its U.S. dollar price. Shares trade on a stock exchange like other ETFs.",
                "holdings": ["Ethereum / ether (spot)", "Cash for fund operations"],
            },
        },
        {
            "ticker": "BSOL",
            "name": "Bitwise Solana Staking ETF",
            "info": {
                "summary": "A spot Solana ETF that holds SOL and aims to track its U.S. dollar price, with staking as a secondary goal. Shares trade on a stock exchange like other ETFs.",
                "holdings": ["Solana / SOL (spot)", "Staking-related SOL exposure", "Cash for fund operations"],
            },
        },
    ],
    # Bond shelf for class: purchasable $100-face units.
    # U.S. Treasuries pull the latest Daily Treasury Par Yield Curve each day.
    # Corporates use real issuance coupons (sold at par in class for simplicity).
    "bonds": [
        {
            "ticker": "UST-3M",
            "name": "US Treasury 3-Month Bill",
            "issuer": "U.S. Treasury",
            "kind": "T-Bill",
            "curve_key": "3 Mo",
            "tenor_months": 3,
            "yield_pct": 4.07,
            "coupon_pct": 0.0,
            "maturity": "Dec 2025",
            "as_of": "2025-09-05",
            "face_value": 100,
            "price": 100.0,
            "note": "Treasury CMT par yield (3-month)",
        },
        {
            "ticker": "UST-6M",
            "name": "US Treasury 6-Month Bill",
            "issuer": "U.S. Treasury",
            "kind": "T-Bill",
            "curve_key": "6 Mo",
            "tenor_months": 6,
            "yield_pct": 3.85,
            "coupon_pct": 0.0,
            "maturity": "Mar 2026",
            "as_of": "2025-09-05",
            "face_value": 100,
            "price": 100.0,
            "note": "Treasury CMT par yield (6-month)",
        },
        {
            "ticker": "UST-1Y",
            "name": "US Treasury 1-Year Bill",
            "issuer": "U.S. Treasury",
            "kind": "T-Bill",
            "curve_key": "1 Yr",
            "tenor_months": 12,
            "yield_pct": 3.65,
            "coupon_pct": 0.0,
            "maturity": "Sep 2026",
            "as_of": "2025-09-05",
            "face_value": 100,
            "price": 100.0,
            "note": "Treasury CMT par yield (1-year)",
        },
        {
            "ticker": "UST-2Y",
            "name": "US Treasury 2-Year Note",
            "issuer": "U.S. Treasury",
            "kind": "T-Note",
            "curve_key": "2 Yr",
            "tenor_months": 24,
            "yield_pct": 3.51,
            "coupon_pct": 3.51,
            "maturity": "Sep 2027",
            "as_of": "2025-09-05",
            "face_value": 100,
            "price": 100.0,
            "note": "Treasury CMT par yield (2-year)",
        },
        {
            "ticker": "UST-5Y",
            "name": "US Treasury 5-Year Note",
            "issuer": "U.S. Treasury",
            "kind": "T-Note",
            "curve_key": "5 Yr",
            "tenor_months": 60,
            "yield_pct": 3.59,
            "coupon_pct": 3.59,
            "maturity": "Sep 2030",
            "as_of": "2025-09-05",
            "face_value": 100,
            "price": 100.0,
            "note": "Treasury CMT par yield (5-year)",
        },
        {
            "ticker": "UST-10Y",
            "name": "US Treasury 10-Year Note",
            "issuer": "U.S. Treasury",
            "kind": "T-Note",
            "curve_key": "10 Yr",
            "tenor_months": 120,
            "yield_pct": 4.10,
            "coupon_pct": 4.10,
            "maturity": "Sep 2035",
            "as_of": "2025-09-05",
            "face_value": 100,
            "price": 100.0,
            "note": "Treasury CMT par yield (10-year)",
        },
        {
            "ticker": "UST-30Y",
            "name": "US Treasury 30-Year Bond",
            "issuer": "U.S. Treasury",
            "kind": "T-Bond",
            "curve_key": "30 Yr",
            "tenor_months": 360,
            "yield_pct": 4.78,
            "coupon_pct": 4.78,
            "maturity": "Sep 2055",
            "as_of": "2025-09-05",
            "face_value": 100,
            "price": 100.0,
            "note": "Treasury CMT par yield (30-year)",
        },
        {
            "ticker": "AAPL-31",
            "name": "Apple 2.400% Notes due 2031",
            "issuer": "Apple Inc.",
            "kind": "Corporate",
            "yield_pct": 2.40,
            "coupon_pct": 2.40,
            "maturity": "Aug 2031",
            "as_of": "2021-08-05",
            "face_value": 100,
            "price": 100.0,
            "note": "Coupon from Apple senior notes issued Aug 2021; sold at $100 face in class",
        },
        {
            "ticker": "MSFT-33",
            "name": "Microsoft 3.300% Notes due 2033",
            "issuer": "Microsoft Corp.",
            "kind": "Corporate",
            "yield_pct": 3.30,
            "coupon_pct": 3.30,
            "maturity": "Feb 2033",
            "as_of": "2023-02-06",
            "face_value": 100,
            "price": 100.0,
            "note": "Coupon from Microsoft senior notes issued 2023; sold at $100 face in class",
        },
        {
            "ticker": "JPM-32",
            "name": "JPMorgan 5.350% Notes due 2032",
            "issuer": "JPMorgan Chase",
            "kind": "Corporate",
            "yield_pct": 5.35,
            "coupon_pct": 5.35,
            "maturity": "Jun 2032",
            "as_of": "2023-06-15",
            "face_value": 100,
            "price": 100.0,
            "note": "Coupon from JPMorgan senior notes issued 2023; sold at $100 face in class",
        },
    ],
    # Commodity markets by raw good. Prefer Yahoo futures (GC=F, CL=F, …).
    # Finnhub free tier lacks those futures, so each item also maps to a
    # Finnhub-traded feed (usually a commodity ETF) + optional scale so the
    # classroom price still approximates per-unit commodity quotes.
    "commodities": [
        {
            "ticker": "GOLD",
            "name": "Gold",
            "kind": "Precious metal",
            "yahoo": "GC=F",
            "finnhub": "GLD",
            # GLD ≈ 1/10 oz historically; ~×11 matches current GC=F better than ×10.
            "scale": 11,
            "proxy": "scaled",
            "unit_label": "troy oz",
            "info": {
                "summary": "Gold is a rare yellow precious metal used in jewelry, electronics, and as a store of value. The classroom price is dollars per troy ounce.",
            },
        },
        {
            "ticker": "SILVER",
            "name": "Silver",
            "kind": "Precious metal",
            "yahoo": "SI=F",
            "finnhub": "SLV",
            "scale": 1,
            "proxy": "unit",
            "unit_label": "troy oz",
            "info": {
                "summary": "Silver is used in jewelry, electronics, and solar panels. Price here is dollars per troy ounce.",
            },
        },
        {
            "ticker": "PLAT",
            "name": "Platinum",
            "kind": "Precious metal",
            "yahoo": "PL=F",
            "finnhub": "PPLT",
            # PPLT share ≈ 1/111 oz (not 1/10 like GLD). Live used ×10 → ~$160 vs ~$1,780/oz.
            "scale": 111,
            "proxy": "scaled",
            "unit_label": "troy oz",
            "info": {
                "summary": "Platinum is used in catalytic converters, jewelry, and industry. Price here is dollars per troy ounce.",
            },
        },
        {
            "ticker": "OIL",
            "name": "Crude Oil",
            "kind": "Energy",
            "yahoo": "CL=F",
            # USO is not $/barrel; scale approximates WTI when Yahoo futures are blocked.
            "finnhub": "USO",
            "scale": 0.65,
            "proxy": "approx",
            "unit_label": "barrel",
            "info": {
                "summary": "Crude oil is refined into fuels and plastics. Price here tracks WTI crude futures in dollars per barrel.",
            },
        },
        {
            "ticker": "NATGAS",
            "name": "Natural Gas",
            "kind": "Energy",
            "yahoo": "NG=F",
            "finnhub": "UNG",
            "scale": 0.28,
            "proxy": "approx",
            "unit_label": "MMBtu",
            "info": {
                "summary": "Natural gas powers electricity and heat. Price here tracks the natural gas market in dollars per MMBtu.",
            },
        },
        {
            "ticker": "COPPER",
            "name": "Copper",
            "kind": "Industrial metal",
            "yahoo": "HG=F",
            "finnhub": "CPER",
            "scale": 0.17,
            "proxy": "approx",
            "unit_label": "lb",
            "info": {
                "summary": "Copper is used in wiring, construction, and EVs. Price here tracks the copper market in dollars per pound.",
            },
        },
        {
            "ticker": "CORN",
            "name": "Corn",
            "kind": "Agriculture",
            "yahoo": "ZC=F",
            "finnhub": "CORN",
            "scale": 0.27,
            "proxy": "approx",
            "divisor": 100,
            "unit_label": "bushel",
            "info": {
                "summary": "Corn is used for food, feed, and ethanol. Price here tracks the corn market in dollars per bushel.",
            },
        },
        {
            "ticker": "WHEAT",
            "name": "Wheat",
            "kind": "Agriculture",
            "yahoo": "ZW=F",
            "finnhub": "WEAT",
            "scale": 0.28,
            "proxy": "approx",
            "divisor": 100,
            "unit_label": "bushel",
            "info": {
                "summary": "Wheat is used for bread, pasta, and flour. Price here tracks the wheat market in dollars per bushel.",
            },
        },
        {
            "ticker": "SOY",
            "name": "Soybeans",
            "kind": "Agriculture",
            "yahoo": "ZS=F",
            "finnhub": "SOYB",
            "scale": 0.47,
            "proxy": "approx",
            "divisor": 100,
            "unit_label": "bushel",
            "info": {
                "summary": "Soybeans are used for oil and animal feed. Price here tracks the soybean market in dollars per bushel.",
            },
        },
        {
            "ticker": "SUGAR",
            "name": "Sugar",
            "kind": "Agriculture",
            "yahoo": "SB=F",
            "finnhub": "CANE",
            "scale": 0.017,
            "proxy": "approx",
            "divisor": 100,
            "unit_label": "lb",
            "info": {
                "summary": "Sugar comes from cane and beets. Price here tracks the sugar market in dollars per pound.",
            },
        },
        {
            "ticker": "COFFEE",
            "name": "Coffee",
            "kind": "Agriculture",
            "yahoo": "KC=F",
            "finnhub": "JO",
            "scale": 0.052,
            "proxy": "approx",
            "divisor": 100,
            "unit_label": "lb",
            "info": {
                "summary": "Coffee is grown in tropical regions worldwide. Price here tracks the coffee market in dollars per pound.",
            },
        },
    ],
    # Foreign currency units priced in USD. Cash stays USD; buying EUR spends
    # dollars and holds euros as an investment (like any other market asset).
    "currencies": [
        {
            "ticker": "EUR",
            "name": "Euro",
            "kind": "Europe",
            "finnhub": "OANDA:EUR_USD",
            "unit_label": "euros",
            "info": {
                "summary": "The euro is the currency of the eurozone (Germany, France, Italy, and many other EU countries). Its price here is how many U.S. dollars one euro costs.",
            },
        },
        {
            "ticker": "GBP",
            "name": "British Pound",
            "kind": "United Kingdom",
            "finnhub": "OANDA:GBP_USD",
            "unit_label": "pounds",
            "info": {
                "summary": "The pound sterling is the United Kingdom’s currency. Its price here is how many U.S. dollars one pound costs.",
            },
        },
        {
            "ticker": "JPY",
            "name": "Japanese Yen",
            "kind": "Japan",
            "finnhub": "OANDA:USD_JPY",
            "invert": True,
            "lot": 100,
            "unit_label": "¥100 packs",
            "info": {
                "summary": "The yen is Japan’s currency. Because one yen is a small amount in dollars, you buy packs of ¥100. The price is the USD cost of ¥100.",
            },
        },
        {
            "ticker": "CAD",
            "name": "Canadian Dollar",
            "kind": "Canada",
            "finnhub": "OANDA:USD_CAD",
            "invert": True,
            "unit_label": "loonies",
            "info": {
                "summary": "The Canadian dollar is Canada’s currency. Its price here is how many U.S. dollars one Canadian dollar costs.",
            },
        },
        {
            "ticker": "AUD",
            "name": "Australian Dollar",
            "kind": "Australia",
            "finnhub": "OANDA:AUD_USD",
            "unit_label": "Aussie dollars",
            "info": {
                "summary": "The Australian dollar is Australia’s currency. Its price here is how many U.S. dollars one Australian dollar costs.",
            },
        },
        {
            "ticker": "CHF",
            "name": "Swiss Franc",
            "kind": "Switzerland",
            "finnhub": "OANDA:USD_CHF",
            "invert": True,
            "unit_label": "francs",
            "info": {
                "summary": "The Swiss franc is Switzerland’s currency, often seen as a “safe” currency. Its price here is how many U.S. dollars one franc costs.",
            },
        },
        {
            "ticker": "MXN",
            "name": "Mexican Peso",
            "kind": "Mexico",
            "finnhub": "OANDA:USD_MXN",
            "invert": True,
            "lot": 10,
            "unit_label": "₱10 packs",
            "info": {
                "summary": "The peso is Mexico’s currency. You buy packs of 10 pesos; the price is the USD cost of that pack.",
            },
        },
        {
            "ticker": "NZD",
            "name": "New Zealand Dollar",
            "kind": "New Zealand",
            "finnhub": "OANDA:NZD_USD",
            "unit_label": "Kiwi dollars",
            "info": {
                "summary": "The New Zealand dollar (the “Kiwi”) is New Zealand’s currency. Its price here is how many U.S. dollars one NZ dollar costs.",
            },
        },
    ],
    "realestate": [
        {
            "ticker": "FL-MIA",
            "name": "Miami",
            "region": "South Florida",
            "price": 625000,
            "mortgage_rate_pct": 6.55,
            "yoy_change_pct": 3.2,
            "down_payment_pct": 20,
            "loan_years": 30,
            "monthly_rent": 3400,
            "as_of": "Sep 2025",
            "info": {
                "summary": "Typical single-family home price for the Miami area. Students can later take a classroom mortgage and watch values drift over the school year.",
            },
        },
        {
            "ticker": "FL-FLL",
            "name": "Fort Lauderdale",
            "region": "South Florida",
            "price": 545000,
            "mortgage_rate_pct": 6.55,
            "yoy_change_pct": 2.4,
            "down_payment_pct": 20,
            "loan_years": 30,
            "monthly_rent": 3000,
            "as_of": "Sep 2025",
            "info": {
                "summary": "Typical single-family home price for Fort Lauderdale and nearby Broward County suburbs.",
            },
        },
        {
            "ticker": "FL-TPA",
            "name": "Tampa",
            "region": "Gulf Coast",
            "price": 415000,
            "mortgage_rate_pct": 6.45,
            "yoy_change_pct": 1.8,
            "down_payment_pct": 20,
            "loan_years": 30,
            "monthly_rent": 2400,
            "as_of": "Sep 2025",
            "info": {
                "summary": "Typical single-family home price for the Tampa Bay area.",
            },
        },
        {
            "ticker": "FL-ORL",
            "name": "Orlando",
            "region": "Central Florida",
            "price": 395000,
            "mortgage_rate_pct": 6.50,
            "yoy_change_pct": 2.1,
            "down_payment_pct": 20,
            "loan_years": 30,
            "monthly_rent": 2300,
            "as_of": "Sep 2025",
            "info": {
                "summary": "Typical single-family home price for the Orlando metro area.",
            },
        },
        {
            "ticker": "FL-JAX",
            "name": "Jacksonville",
            "region": "North Florida",
            "price": 335000,
            "mortgage_rate_pct": 6.40,
            "yoy_change_pct": 1.5,
            "down_payment_pct": 20,
            "loan_years": 30,
            "monthly_rent": 2000,
            "as_of": "Sep 2025",
            "info": {
                "summary": "Typical single-family home price for Jacksonville and nearby Duval County.",
            },
        },
        {
            "ticker": "FL-NAP",
            "name": "Naples",
            "region": "Southwest Florida",
            "price": 710000,
            "mortgage_rate_pct": 6.60,
            "yoy_change_pct": 0.8,
            "down_payment_pct": 20,
            "loan_years": 30,
            "monthly_rent": 3800,
            "as_of": "Sep 2025",
            "info": {
                "summary": "Typical single-family home price for Naples — one of Florida’s higher-priced coastal markets.",
            },
        },
        {
            "ticker": "FL-TLH",
            "name": "Tallahassee",
            "region": "Panhandle",
            "price": 285000,
            "mortgage_rate_pct": 6.35,
            "yoy_change_pct": 1.1,
            "down_payment_pct": 20,
            "loan_years": 30,
            "monthly_rent": 1700,
            "as_of": "Sep 2025",
            "info": {
                "summary": "Typical single-family home price for Tallahassee, Florida’s capital city.",
            },
        },
        {
            "ticker": "FL-PNS",
            "name": "Pensacola",
            "region": "Panhandle",
            "price": 310000,
            "mortgage_rate_pct": 6.35,
            "yoy_change_pct": 1.3,
            "down_payment_pct": 20,
            "loan_years": 30,
            "monthly_rent": 1800,
            "as_of": "Sep 2025",
            "info": {
                "summary": "Typical single-family home price for Pensacola and the western Panhandle.",
            },
        },
    ],
}

BOND_BY_TICKER = {b["ticker"]: b for b in MARKET_CATALOG["bonds"]}
CURRENCY_BY_TICKER = {c["ticker"]: c for c in MARKET_CATALOG["currencies"]}
COMMODITY_BY_TICKER = {c["ticker"]: c for c in MARKET_CATALOG["commodities"]}
REALESTATE_BY_TICKER = {h["ticker"]: h for h in MARKET_CATALOG["realestate"]}

_CURRENCY_YAHOO = {
    "EUR": "EURUSD=X",
    "GBP": "GBPUSD=X",
    "JPY": "USDJPY=X",
    "CAD": "USDCAD=X",
    "AUD": "AUDUSD=X",
    "CHF": "USDCHF=X",
    "MXN": "USDMXN=X",
    "NZD": "NZDUSD=X",
}


def yahoo_quote_symbol(local_ticker: str) -> str:
    if local_ticker in _CURRENCY_YAHOO:
        return _CURRENCY_YAHOO[local_ticker]
    commodity = COMMODITY_BY_TICKER.get(local_ticker)
    if commodity and commodity.get("yahoo"):
        return commodity["yahoo"]
    return local_ticker


def commodity_price_scale(local_ticker: str) -> float:
    """ETF→unit multiplier. Prefers live calibration over the catalog default."""
    live = _commodity_live_scales.get(local_ticker)
    if live is not None and live > 0:
        return float(live)
    meta = COMMODITY_BY_TICKER.get(local_ticker) or {}
    try:
        scale = float(meta.get("scale") or 1)
    except (TypeError, ValueError):
        return 1.0
    return scale if scale > 0 else 1.0


def _catalog_commodity_scale(local_ticker: str) -> float:
    meta = COMMODITY_BY_TICKER.get(local_ticker) or {}
    try:
        scale = float(meta.get("scale") or 1)
    except (TypeError, ValueError):
        return 1.0
    return scale if scale > 0 else 1.0


def _load_commodity_scales() -> None:
    if not COMMODITY_SCALE_CACHE_PATH.exists():
        return
    try:
        data = json.loads(COMMODITY_SCALE_CACHE_PATH.read_text())
        for ticker, row in (data or {}).items():
            scale = float(row.get("scale") or 0)
            at = float(row.get("calibrated_at") or 0)
            if scale > 0 and ticker in COMMODITY_BY_TICKER:
                _commodity_live_scales[ticker] = scale
                _commodity_scale_at[ticker] = at
    except Exception:
        pass


def _save_commodity_scales() -> None:
    payload = {
        ticker: {
            "scale": scale,
            "calibrated_at": _commodity_scale_at.get(ticker, 0),
            "catalog_scale": _catalog_commodity_scale(ticker),
        }
        for ticker, scale in _commodity_live_scales.items()
    }
    try:
        COMMODITY_SCALE_CACHE_PATH.write_text(json.dumps(payload, indent=2))
    except Exception:
        pass


def _ensure_etf_feed_price(feed: str) -> float | None:
    """Return a cached or freshly fetched ETF/share price for calibration."""
    symbol = (feed or "").strip().upper()
    if not symbol:
        return None
    hit, _ = _cache_get(symbol, allow_stale=True)
    if hit is not None and float(hit) > 0:
        return float(hit)
    now = time.time()
    if finnhub_configured() and not _finnhub_on_cooldown():
        payload, _err = _finnhub_get("/quote", {"symbol": symbol})
        if isinstance(payload, dict):
            current = payload.get("c")
            prev = payload.get("pc")
            try:
                price = float(current) if current not in (None, 0, 0.0) else None
                if price is None and prev not in (None, 0, 0.0):
                    price = float(prev)
            except (TypeError, ValueError):
                price = None
            if price is not None and price > 0:
                pct = payload.get("dp")
                try:
                    change_pct = float(pct) if pct is not None else None
                except (TypeError, ValueError):
                    change_pct = None
                _remember_quote(symbol, price, now, change_pct, "finnhub")
                return price
    if not _yahoo_on_cooldown():
        price, _prev = _yahoo_chart_quote(symbol)
        if price is not None and float(price) > 0:
            _remember_quote(symbol, float(price), now, None, "yahoo")
            return float(price)
    return None


def _calibrate_commodity_scale(local: str, futures_price: float) -> bool:
    """
    When Yahoo futures and the ETF are both known:
      live_scale = futures_unit_price / etf_share_price
    Later Finnhub proxy fills use ETF × live_scale ≈ real futures.
    """
    meta = COMMODITY_BY_TICKER.get(local) or {}
    feed = (meta.get("finnhub") or "").strip()
    if not feed or futures_price is None or float(futures_price) <= 0:
        return False
    etf_price = _ensure_etf_feed_price(feed)
    if etf_price is None or float(etf_price) <= 0:
        return False
    raw = float(futures_price) / float(etf_price)
    catalog = _catalog_commodity_scale(local)
    # Reject poison ticks; keep near the catalog relationship.
    if catalog == 1.0:
        lo, hi = 0.25, 4.0
    else:
        lo, hi = catalog * 0.5, catalog * 2.0
    if raw < lo or raw > hi:
        return False
    _commodity_live_scales[local] = raw
    _commodity_scale_at[local] = time.time()
    _save_commodity_scales()
    return True


def _commodity_scale_due(local: str) -> bool:
    if local not in COMMODITY_BY_TICKER:
        return False
    if not commodity_etf_proxy_ok(local):
        return False
    if not (COMMODITY_BY_TICKER[local].get("yahoo") and COMMODITY_BY_TICKER[local].get("finnhub")):
        return False
    at = _commodity_scale_at.get(local, 0.0)
    return (time.time() - at) >= COMMODITY_SCALE_TTL_SECONDS


def _maybe_calibrate_commodity_scales(
    symbols: list[str],
    out: dict[str, tuple[float | None, float | None]] | None = None,
) -> None:
    """Sparse Yahoo futures samples so live ETF scales track the real market."""
    if _yahoo_on_cooldown():
        return
    due = [s for s in symbols if _commodity_scale_due(s)]
    if not due:
        return
    now = datetime.now(timezone.utc).timestamp()
    for symbol in due[:MAX_YAHOO_CALIBRATIONS_PER_BATCH]:
        if _yahoo_on_cooldown():
            break
        try:
            local, price, change_pct = _yfinance_quote_one(symbol)
        except Exception:
            continue
        if price is None:
            continue
        _remember_quote(local, float(price), now, change_pct, "yahoo")
        _calibrate_commodity_scale(local, float(price))
        if out is not None:
            out[local] = (float(price), change_pct)


def commodity_etf_proxy_ok(local_ticker: str) -> bool:
    """
    Finnhub free tier has no futures — we sometimes map to an ETF (GLD, SLV, …).

    Catalog `proxy` modes:
      - scaled: ETF × scale ≈ unit price (GOLD←GLD×11, PLAT←PPLT×111)
      - unit:   ETF share ≈ one unit already (SILVER←SLV)
      - approx: rough classroom stand-in when futures are blocked
      - none:   never use the ETF as $/bbl, $/bushel, etc.

    Legacy fallback: scale != 1 with a different feed ticker.
    """
    meta = COMMODITY_BY_TICKER.get(local_ticker) or {}
    feed = meta.get("finnhub")
    if not feed:
        return False
    mode = str(meta.get("proxy") or "").strip().lower()
    if mode in {"scaled", "unit", "approx"}:
        return True
    if mode in {"none", "off", "false", "0"}:
        return False
    # Legacy: different feed ticker + non-1 scale (e.g. GOLD←GLD×10).
    if str(feed).upper() == str(local_ticker).upper():
        return False
    return commodity_price_scale(local_ticker) != 1.0


def commodity_yahoo_divisor(local_ticker: str) -> float:
    """Yahoo ag/softs futures are often quoted in cents — divide to dollars."""
    meta = COMMODITY_BY_TICKER.get(local_ticker) or {}
    try:
        div = float(meta.get("divisor") or 1)
    except (TypeError, ValueError):
        return 1.0
    return div if div > 0 else 1.0


def finnhub_symbol_for(local_ticker: str) -> tuple[str, bool]:
    """Return (provider_symbol, is_forex)."""
    cur = CURRENCY_BY_TICKER.get(local_ticker)
    if cur:
        return cur["finnhub"], True
    commodity = COMMODITY_BY_TICKER.get(local_ticker)
    if commodity and commodity.get("finnhub"):
        return commodity["finnhub"], False
    return local_ticker, False


def _apply_commodity_scale(
    local_symbol: str, price: float | None, prev: float | None
) -> tuple[float | None, float | None]:
    scale = commodity_price_scale(local_symbol)
    if scale == 1 or price is None:
        return price, prev
    return price * scale, (prev * scale if prev is not None else None)


def estimate_mortgage_payment(
    price: float,
    rate_pct: float,
    *,
    down_payment_pct: float = 20.0,
    loan_years: int = 30,
) -> float:
    """Monthly principal & interest on a fixed-rate classroom mortgage."""
    principal = float(price) * (1.0 - float(down_payment_pct) / 100.0)
    if principal <= 0:
        return 0.0
    months = max(1, int(loan_years) * 12)
    monthly_rate = float(rate_pct) / 100.0 / 12.0
    if monthly_rate <= 0:
        return principal / months
    factor = (1.0 + monthly_rate) ** months
    return principal * (monthly_rate * factor) / (factor - 1.0)

# Classroom fixed-income horizon: interest earned holding a bond until this date
# (or until maturity if the bond matures sooner).
BOND_INTEREST_HORIZON = datetime(2027, 5, 15, tzinfo=timezone.utc).date()
_MONTHS = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}


def parse_bond_maturity(label: str):
    """Parse labels like 'Sep 2027' into a date (15th of that month)."""
    parts = (label or "").strip().split()
    if len(parts) != 2:
        return None
    month = _MONTHS.get(parts[0][:3].lower())
    try:
        year = int(parts[1])
    except ValueError:
        return None
    if not month:
        return None
    return datetime(year, month, 15, tzinfo=timezone.utc).date()


def add_months(d, months: int):
    """Add calendar months, clamping day to 15 for classroom maturity labels."""
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    return datetime(year, month, 15, tzinfo=timezone.utc).date()


def maturity_label_from_tenor(as_of_iso: str, tenor_months: int | None) -> str | None:
    if not tenor_months:
        return None
    try:
        as_of = datetime.strptime(as_of_iso, "%Y-%m-%d").date()
    except ValueError:
        return None
    end = add_months(as_of, int(tenor_months))
    return end.strftime("%b %Y")


_treasury_cache: tuple[float, dict] | None = None
TREASURY_CACHE_TTL = 60 * 60 * 6  # refresh a few times a day


def fetch_treasury_par_yields(*, force_refresh: bool = False) -> dict | None:
    """
    Latest Daily Treasury Par Yield Curve from home.treasury.gov (free, no key).
    Returns {"as_of": "YYYY-MM-DD", "rates": {"3 Mo": 3.91, ...}}.
    """
    global _treasury_cache
    import csv
    import io

    now = datetime.now(timezone.utc).timestamp()
    if (
        not force_refresh
        and _treasury_cache
        and now - _treasury_cache[0] < TREASURY_CACHE_TTL
        and _treasury_cache[1].get("rates")
    ):
        return _treasury_cache[1]

    if not force_refresh and TREASURY_CACHE_PATH.exists():
        try:
            disk = json.loads(TREASURY_CACHE_PATH.read_text())
            fetched_at = float(disk.get("fetched_at") or 0)
            payload = {
                "as_of": disk.get("as_of"),
                "rates": disk.get("rates") or {},
            }
            if payload["rates"] and now - fetched_at < TREASURY_CACHE_TTL:
                _treasury_cache = (fetched_at, payload)
                return payload
            stale = payload if payload["rates"] else None
        except Exception:
            stale = None
    else:
        stale = None

    year = datetime.now(timezone.utc).year
    payload = None
    last_error = None
    for y in (year, year - 1):
        url = (
            "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
            f"daily-treasury-rates.csv/{y}/all"
            f"?type=daily_treasury_yield_curve&field_tdr_date_value={y}&page&_format=csv"
        )
        try:
            res = requests.get(url, headers=HTTP_HEADERS, timeout=20)
            if res.status_code != 200 or not res.text.strip():
                last_error = f"HTTP {res.status_code}"
                continue
            reader = csv.DictReader(io.StringIO(res.text))
            rows = list(reader)
            if not rows:
                last_error = "empty csv"
                continue
            # Treasury returns newest first.
            latest = rows[0]
            date_raw = (latest.get("Date") or "").strip()
            as_of = datetime.strptime(date_raw, "%m/%d/%Y").date().isoformat()
            rates: dict[str, float] = {}
            for key, raw in latest.items():
                if key == "Date" or raw is None:
                    continue
                cleaned = str(raw).strip().strip('"')
                if not cleaned or cleaned.upper() == "N/A":
                    continue
                try:
                    rates[key.strip()] = float(cleaned)
                except ValueError:
                    continue
            if rates:
                payload = {"as_of": as_of, "rates": rates}
                break
        except Exception as exc:
            last_error = str(exc)
            continue

    if not payload:
        if stale:
            return stale
        print("treasury yields unavailable:", last_error)
        return None

    _treasury_cache = (now, payload)
    try:
        TREASURY_CACHE_PATH.write_text(
            json.dumps({"fetched_at": now, **payload}, indent=2)
        )
    except Exception:
        pass
    return payload


def apply_live_treasury_yields(items: list[dict], *, force_refresh: bool = False) -> list[dict]:
    """Overlay official daily CMT yields onto U.S. Treasury catalog rows."""
    curve = fetch_treasury_par_yields(force_refresh=force_refresh)
    if not curve:
        return [dict(item) for item in items]

    as_of = curve["as_of"]
    rates = curve["rates"]
    out = []
    for item in items:
        row = dict(item)
        key = row.get("curve_key")
        if key and key in rates:
            yld = round(float(rates[key]), 2)
            row["yield_pct"] = yld
            # Classroom notes/bonds are sold at par, so coupon tracks the live yield.
            if row.get("kind") in ("T-Note", "T-Bond"):
                row["coupon_pct"] = yld
            row["as_of"] = as_of
            matured_label = maturity_label_from_tenor(as_of, row.get("tenor_months"))
            if matured_label:
                row["maturity"] = matured_label
            row["note"] = f"Daily Treasury Par Yield Curve ({key}) as of {as_of}"
            row["live_yield"] = True
        out.append(row)
    return out


def bond_interest_to_horizon(bond: dict, today=None) -> dict:
    """
    Estimate interest on one $face unit from today through May 15, 2027
    (or maturity if earlier). Coupon bonds use coupon; T-bills use yield.
    Sold at par in class, so this is simple face * rate * years.
    """
    today = today or datetime.now(timezone.utc).date()
    face = float(bond.get("face_value") or bond.get("price") or 100)
    coupon = float(bond.get("coupon_pct") or 0)
    yld = float(bond.get("yield_pct") or 0)
    rate = coupon if coupon > 0 else yld
    maturity = parse_bond_maturity(bond.get("maturity") or "")
    horizon = BOND_INTEREST_HORIZON

    if maturity is None:
        end = horizon
        matured = False
    else:
        end = min(maturity, horizon)
        matured = maturity <= today

    days = max(0, (end - today).days)
    years = days / 365.25
    interest = round(face * (rate / 100.0) * years, 2)

    return {
        "horizon": "May 15, 2027",
        "horizon_date": horizon.isoformat(),
        "earn_until": end.isoformat() if end else horizon.isoformat(),
        "years": round(years, 3),
        "rate_pct": rate,
        "interest_per_unit": interest,
        "face_value": face,
        "matured": matured,
        "uses_coupon": coupon > 0,
    }


def currency_usd_price(raw: float, meta: dict) -> float:
    """Convert a raw FX quote into USD cost per classroom unit."""
    price = float(raw)
    if meta.get("invert"):
        if price == 0:
            return 0.0
        price = 1.0 / price
    lot = float(meta.get("lot") or 1)
    return price * lot


def _frankfurter_currency_quotes(
    symbols: list[str],
) -> dict[str, tuple[float | None, float | None]]:
    """Free ECB FX via Frankfurter — no API key. Rates are foreign units per 1 USD."""
    wanted = [s for s in symbols if s in CURRENCY_BY_TICKER]
    out: dict[str, tuple[float | None, float | None]] = {}
    if not wanted:
        return out
    try:
        res = requests.get(
            "https://api.frankfurter.app/latest",
            params={"from": "USD", "to": ",".join(sorted(set(wanted)))},
            timeout=10,
        )
        if res.status_code != 200:
            return out
        payload = res.json() or {}
        rates = payload.get("rates") or {}
    except Exception:
        return out

    for symbol in wanted:
        meta = CURRENCY_BY_TICKER[symbol]
        try:
            foreign_per_usd = float(rates.get(symbol))
        except (TypeError, ValueError):
            continue
        if foreign_per_usd <= 0:
            continue
        # Classroom price is always USD per unit (or pack).
        # invert tickers are quoted as foreign-per-USD (same as USD_JPY).
        raw = foreign_per_usd if meta.get("invert") else (1.0 / foreign_per_usd)
        try:
            price = currency_usd_price(raw, meta)
        except Exception:
            continue
        if price and price > 0:
            out[symbol] = (price, None)
    return out


def _finnhub_get(path: str, params: dict | None = None) -> tuple[dict | list | None, str | None]:
    if not FINNHUB_API_KEY:
        return None, "FINNHUB_API_KEY is not set"
    if _finnhub_on_cooldown():
        return None, "rate limited"
    query = dict(params or {})
    query["token"] = FINNHUB_API_KEY
    try:
        res = requests.get(f"{FINNHUB_BASE}{path}", params=query, timeout=12)
        if res.status_code == 429:
            _trip_finnhub_cooldown()
            return None, "rate limited"
        if res.status_code >= 400:
            detail = ""
            try:
                detail = (res.json() or {}).get("error") or ""
            except Exception:
                detail = (res.text or "")[:160]
            msg = f"Finnhub error {res.status_code}"
            if detail:
                msg = f"{msg}: {detail}"
            return None, msg
        return res.json(), None
    except Exception as exc:
        return None, str(exc)


def _industry_from_text(*parts: str | None) -> str | None:
    """Map free-text sector/industry labels onto classroom filter tags."""
    blob = " ".join(str(p or "") for p in parts).strip().lower()
    if not blob:
        return None
    # Exact-ish Finnhub sector aliases first.
    aliases = {
        "technology": "Technology",
        "semiconductors": "Technology",
        "software": "Technology",
        "it services": "Technology",
        "electronic technology": "Technology",
        "communications": "Technology",
        "retail": "Consumer",
        "consumer cyclical": "Consumer",
        "consumer defensive": "Consumer",
        "consumer staples": "Consumer",
        "consumer discretionary": "Consumer",
        "food": "Consumer",
        "tobacco": "Consumer",
        "apparel": "Consumer",
        "textiles": "Consumer",
        "financial": "Finance",
        "financial services": "Finance",
        "insurance": "Finance",
        "banks": "Finance",
        "healthcare": "Healthcare",
        "health care": "Healthcare",
        "biotechnology": "Healthcare",
        "pharmaceuticals": "Healthcare",
        "energy": "Energy",
        "oil": "Energy",
        "utilities": "Energy",
        "media": "Entertainment",
        "communication services": "Entertainment",
        "entertainment": "Entertainment",
        "leisure": "Entertainment",
        "hotels": "Entertainment",
        "restaurants": "Entertainment",
        "automobiles": "Autos",
        "auto manufacturers": "Autos",
        "auto parts": "Autos",
        "industrials": "Industrials",
        "industrial": "Industrials",
        "aerospace": "Industrials",
        "defense": "Industrials",
        "basic materials": "Industrials",
        "real estate": "Finance",
    }
    for key, industry in aliases.items():
        if key in blob:
            return industry
    rules = (
        ("Autos", ("auto", "vehicle", "ev ", "automobile")),
        (
            "Technology",
            (
                "software",
                "semiconductor",
                "technology",
                "internet",
                "chip",
                "computer",
                "electronic",
                "cyber",
            ),
        ),
        (
            "Healthcare",
            ("health", "pharma", "biotech", "medical", "drug", "therapeutics"),
        ),
        (
            "Finance",
            ("bank", "insurance", "financial", "capital market", "asset management"),
        ),
        ("Energy", ("oil", "gas", "energy", "petroleum", "renewable", "utility")),
        (
            "Entertainment",
            (
                "entertainment",
                "media",
                "gaming",
                "streaming",
                "broadcast",
                "leisure",
                "hotel",
                "casino",
            ),
        ),
        (
            "Consumer",
            (
                "retail",
                "consumer",
                "apparel",
                "food",
                "beverage",
                "restaurant",
                "tobacco",
                "household",
            ),
        ),
        (
            "Industrials",
            (
                "industrial",
                "aerospace",
                "defense",
                "machinery",
                "airline",
                "railroad",
                "logistics",
                "shipping",
                "construction",
            ),
        ),
    )
    for industry, needles in rules:
        if any(n in blob for n in needles):
            return industry
    return None


def classify_classroom_industry(
    ticker: str, *, name: str | None = None, hint: str | None = None
) -> str:
    """Place a teacher-added ticker into an existing classroom industry (never Custom)."""
    hint_s = str(hint or "").strip()
    if hint_s in CLASSROOM_INDUSTRIES:
        return hint_s
    mapped = _industry_from_text(hint_s, name)
    if mapped:
        return mapped
    symbol = str(ticker or "").strip().upper()
    if symbol and finnhub_configured() and not _finnhub_on_cooldown():
        payload, _err = _finnhub_get("/stock/profile2", {"symbol": symbol})
        if isinstance(payload, dict):
            mapped = _industry_from_text(
                payload.get("finnhubIndustry"),
                payload.get("name"),
                name,
            )
            if mapped:
                return mapped
    mapped = _industry_from_text(name)
    return mapped or "Consumer"


_PLACEHOLDER_SUMMARY_RE = re.compile(
    r"was added to the shared classroom market by a teacher\.?\s*$",
    re.IGNORECASE,
)


def is_placeholder_company_summary(summary: str | None, name: str | None = None) -> bool:
    text = str(summary or "").strip()
    if not text:
        return True
    if _PLACEHOLDER_SUMMARY_RE.search(text):
        return True
    # Legacy exact template
    display = str(name or "").strip()
    if display and text.lower() == f"{display} was added to the shared classroom market by a teacher.".lower():
        return True
    return False


def _finnhub_company_profile(ticker: str) -> dict:
    symbol = str(ticker or "").strip().upper()
    if not symbol or not finnhub_configured() or _finnhub_on_cooldown():
        return {}
    payload, _err = _finnhub_get("/stock/profile2", {"symbol": symbol})
    return payload if isinstance(payload, dict) else {}


def _template_company_summary(
    ticker: str,
    *,
    name: str | None = None,
    industry: str | None = None,
    profile: dict | None = None,
) -> str:
    profile = profile or {}
    display = (
        str(name or "").strip()
        or str(profile.get("name") or "").strip()
        or str(ticker or "").strip().upper()
        or "This company"
    )
    sector = (
        str(industry or "").strip()
        or str(profile.get("finnhubIndustry") or "").strip()
    )
    country = str(profile.get("country") or "").strip()
    exchange = str(profile.get("exchange") or "").strip()
    blob = f"{display} {sector} {profile.get('finnhubIndustry') or ''}".lower()
    is_etf = "etf" in blob or "exchange traded" in blob

    if is_etf:
        lead = f"{display} is an exchange-traded fund"
    else:
        lead = f"{display} is a publicly traded company"
    if sector and sector.lower() not in ("custom",):
        lead += f" in the {sector} sector"
    if country:
        lead += f", based in {country}"
    lead += "."
    if exchange:
        lead += f" Its shares trade on {exchange}."
    elif ticker:
        lead += f" Students can buy shares of {str(ticker).upper()} in the classroom market."
    return lead[:420]


def _llm_company_summary(
    ticker: str,
    *,
    name: str,
    industry: str | None = None,
    profile: dict | None = None,
) -> str | None:
    """Ask OpenAI (preferred for blurbs) or Claude for a short classroom company description."""
    profile = profile or {}
    facts = {
        "ticker": str(ticker or "").upper(),
        "name": name,
        "classroomIndustry": industry or None,
        "finnhubIndustry": profile.get("finnhubIndustry"),
        "country": profile.get("country"),
        "exchange": profile.get("exchange"),
        "ipo": profile.get("ipo"),
        "marketCap": profile.get("marketCapitalization"),
        "weburl": profile.get("weburl"),
    }
    system = (
        "You write short company descriptions for Ledger Lab, a high-school classroom "
        "investing game. Explain what the company (or ETF) actually does in plain English. "
        "2 sentences max. Grade 9–11 reading level. No URLs, no stock tips, no hype, "
        "no politics. School-safe. Return ONLY the description text — no quotes or labels."
    )
    user = (
        "Write a factual classroom blurb for this listed company or fund.\n"
        f"FACTS:\n{json.dumps(facts, indent=2)}"
    )

    openai_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    openai_model = (os.environ.get("OPENAI_MODEL") or "gpt-4o-mini").strip()
    if openai_key:
        try:
            res = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {openai_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": openai_model,
                    "temperature": 0.3,
                    "max_tokens": 160,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                },
                timeout=25,
            )
            res.raise_for_status()
            text = (
                res.json()
                .get("choices", [{}])[0]
                .get("message", {})
                .get("content")
                or ""
            ).strip()
            text = text.strip("\"'` \n")
            if len(text) >= 40:
                return text[:420]
        except Exception:
            pass

    anthropic_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    anthropic_model = (os.environ.get("ANTHROPIC_MODEL") or "claude-sonnet-5").strip()
    if anthropic_key:
        try:
            res = requests.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": anthropic_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": anthropic_model,
                    "max_tokens": 200,
                    "system": system,
                    "messages": [{"role": "user", "content": user}],
                },
                timeout=25,
            )
            res.raise_for_status()
            parts = res.json().get("content") or []
            text = "".join(
                str(p.get("text") or "")
                for p in parts
                if isinstance(p, dict) and p.get("type") == "text"
            ).strip()
            text = text.strip("\"'` \n")
            if len(text) >= 40:
                return text[:420]
        except Exception:
            pass
    return None


def generate_classroom_company_summary(
    ticker: str,
    *,
    name: str | None = None,
    industry: str | None = None,
) -> str:
    """Real company blurb for teacher-added tickers (LLM + Finnhub profile, with template fallback)."""
    symbol = str(ticker or "").strip().upper()
    profile = _finnhub_company_profile(symbol) if symbol else {}
    display = (
        str(name or "").strip()
        or str(profile.get("name") or "").strip()
        or symbol
        or "This company"
    )
    sector = str(industry or "").strip() or None
    llm = _llm_company_summary(
        symbol,
        name=display,
        industry=sector,
        profile=profile,
    )
    if llm and not is_placeholder_company_summary(llm, display):
        return llm
    return _template_company_summary(
        symbol, name=display, industry=sector, profile=profile
    )


def _finnhub_quote_one(local_symbol: str) -> tuple[str, float | None, float | None]:
    provider, is_fx = finnhub_symbol_for(local_symbol)
    if is_fx and _finnhub_fx_blocked():
        return local_symbol, None, None
    payload, err = _finnhub_get("/quote", {"symbol": provider})
    if err:
        global _last_quote_provider_error
        # Forex 403 is expected on free Finnhub — don't poison the UI error; Yahoo handles FX.
        if is_fx and ("403" in err or "don't have access" in err.lower() or "access" in err.lower()):
            _trip_finnhub_fx_block()
        else:
            _last_quote_provider_error = err
    if not isinstance(payload, dict):
        return local_symbol, None, None
    current = payload.get("c")
    prev = payload.get("pc")
    pct = payload.get("dp")
    try:
        price = float(current) if current not in (None, 0, 0.0) else None
        if price is None and prev not in (None, 0, 0.0):
            price = float(prev)
        prev_f = float(prev) if prev not in (None, 0, 0.0) else None
    except (TypeError, ValueError):
        return local_symbol, None, None
    if price is None:
        return local_symbol, None, None

    cur_meta = CURRENCY_BY_TICKER.get(local_symbol)
    if cur_meta:
        price = currency_usd_price(price, cur_meta)
        if prev_f is not None:
            prev_f = currency_usd_price(prev_f, cur_meta)
    elif local_symbol in COMMODITY_BY_TICKER:
        # Finnhub uses ETF/proxy feeds; only accept intentional proxy modes.
        if not commodity_etf_proxy_ok(local_symbol):
            return local_symbol, None, None
        # Keep the raw ETF mark so we can calibrate scale = futures / ETF.
        if provider and str(provider).upper() != local_symbol:
            try:
                _remember_quote(
                    str(provider).upper(),
                    float(price),
                    time.time(),
                    float(pct) if pct is not None else None,
                    "finnhub",
                )
            except (TypeError, ValueError):
                pass
        price, prev_f = _apply_commodity_scale(local_symbol, price, prev_f)
        if price is None or price <= 0:
            return local_symbol, None, None

    change_pct = None
    if pct is not None and not cur_meta:
        try:
            change_pct = float(pct)
        except (TypeError, ValueError):
            change_pct = None
    if change_pct is None and prev_f:
        change_pct = ((price - prev_f) / prev_f) * 100
    return local_symbol, price, change_pct


def _yahoo_chart_quote(yahoo_symbol: str) -> tuple[float | None, float | None]:
    """Lightweight Yahoo chart quote — more reliable than yfinance under rate limits."""
    from urllib.parse import quote

    if _yahoo_on_cooldown():
        return None, None

    # Futures tickers contain "=" (CL=F). Leaving it unencoded breaks on some hosts (Vercel).
    encoded = quote(str(yahoo_symbol), safe="")
    hosts = (
        "https://query1.finance.yahoo.com",
        "https://query2.finance.yahoo.com",
    )
    headers = {
        **HTTP_HEADERS,
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    for host in hosts:
        url = f"{host}/v8/finance/chart/{encoded}"
        try:
            res = requests.get(
                url,
                params={"range": "5d", "interval": "1d"},
                headers=headers,
                timeout=4,
            )
            if res.status_code == 429:
                _trip_yahoo_cooldown()
                return None, None
            if res.status_code != 200:
                continue
            payload = res.json()
            result = (payload.get("chart") or {}).get("result") or []
            if not result:
                continue
            meta = result[0].get("meta") or {}
            price = meta.get("regularMarketPrice")
            prev = meta.get("chartPreviousClose")
            if prev is None:
                prev = meta.get("previousClose")
            price_f = float(price) if price not in (None, 0, 0.0) else None
            prev_f = float(prev) if prev not in (None, 0, 0.0) else None
            if price_f is None:
                quotes = (result[0].get("indicators") or {}).get("quote") or []
                closes = (quotes[0].get("close") if quotes else None) or []
                closes = [float(v) for v in closes if v is not None]
                if closes:
                    price_f = closes[-1]
                    if len(closes) >= 2:
                        prev_f = closes[-2]
            if price_f is not None:
                return price_f, prev_f
        except Exception:
            continue
    return None, None


def _yfinance_quote_one(local_symbol: str) -> tuple[str, float | None, float | None]:
    """Live quote via Yahoo chart API only (no yfinance lib — it hangs under rate limits)."""
    yahoo = yahoo_quote_symbol(local_symbol)
    price, prev_f = _yahoo_chart_quote(yahoo)

    if price is None:
        return local_symbol, None, None

    cur_meta = CURRENCY_BY_TICKER.get(local_symbol)
    if cur_meta:
        price = currency_usd_price(price, cur_meta)
        if prev_f is not None:
            prev_f = currency_usd_price(prev_f, cur_meta)
    elif local_symbol in COMMODITY_BY_TICKER:
        div = commodity_yahoo_divisor(local_symbol)
        if div != 1:
            price = price / div
            if prev_f is not None:
                prev_f = prev_f / div

    change_pct = None
    if prev_f:
        change_pct = ((price - prev_f) / prev_f) * 100
    return local_symbol, price, change_pct


def _commodity_proxy_via_yahoo_etf(
    local_symbol: str,
) -> tuple[str, float | None, float | None]:
    """When futures are blocked, price the Finnhub ETF on Yahoo and apply scale."""
    if local_symbol not in COMMODITY_BY_TICKER or not commodity_etf_proxy_ok(local_symbol):
        return local_symbol, None, None
    feed = (COMMODITY_BY_TICKER[local_symbol].get("finnhub") or "").strip()
    if not feed:
        return local_symbol, None, None
    price, prev_f = _yahoo_chart_quote(feed)
    if price is None:
        return local_symbol, None, None
    price, prev_f = _apply_commodity_scale(local_symbol, price, prev_f)
    if price is None or price <= 0:
        return local_symbol, None, None
    change_pct = None
    if prev_f:
        change_pct = ((price - prev_f) / prev_f) * 100
    return local_symbol, price, change_pct


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_disk_quotes() -> None:
    if not QUOTE_CACHE_PATH.exists():
        return
    try:
        data = json.loads(QUOTE_CACHE_PATH.read_text())
        for ticker, row in data.items():
            _quote_cache[ticker] = (
                float(row["price"]),
                float(row["fetched_at"]),
                row.get("change_pct"),
            )
            src = row.get("source")
            if src:
                _quote_source_by_ticker[ticker] = str(src)
    except Exception:
        pass


def _commodity_quote_from_feed_cache(
    local: str, *, allow_stale: bool = False
) -> tuple[float | None, float | None]:
    """Derive GOLD/… from cached Finnhub ETF feeds when scale converts to unit price."""
    meta = COMMODITY_BY_TICKER.get(local)
    if not meta or not commodity_etf_proxy_ok(local):
        return None, None
    feed = meta.get("finnhub")
    if not feed or feed == local:
        return None, None
    price, change_pct = _cache_get(feed, allow_stale=allow_stale)
    if price is None:
        return None, None
    scaled = float(price) * commodity_price_scale(local)
    src = _quote_cache.get(feed)
    if src:
        _remember_quote(local, scaled, src[1], change_pct, "proxy")
    return scaled, change_pct


def _seed_commodity_quotes_from_feeds() -> None:
    for local, meta in COMMODITY_BY_TICKER.items():
        if local in _quote_cache and _quote_cache[local][0] is not None:
            continue
        if not commodity_etf_proxy_ok(local):
            continue
        feed = meta.get("finnhub")
        if not feed or feed == local:
            continue
        src = _quote_cache.get(feed)
        if not src or src[0] is None:
            continue
        scale = commodity_price_scale(local)
        _remember_quote(local, float(src[0]) * scale, src[1], src[2], "proxy")


def _scrub_bad_commodity_proxy_cache() -> None:
    """
    Drop classroom commodity quotes that must not come from unscaled ETF shares.
    Keep Yahoo futures prices (true $/bbl, $/bushel, …) — only scrub when we
    have no futures path and Finnhub proxy is disallowed.

    Also drop known-bad platinum marks from the old PPLT×10 bug (~$160/oz).
    """
    changed = False
    for local, meta in COMMODITY_BY_TICKER.items():
        if commodity_etf_proxy_ok(local):
            continue
        # Futures-backed commodities: a cached price is almost certainly from Yahoo.
        if meta.get("yahoo"):
            continue
        feed = meta.get("finnhub")
        if not feed or feed == local:
            continue
        if local in _quote_cache:
            _forget_quote(local)
            changed = True
    # Legacy PLAT: Finnhub used PPLT×10 (~$160) while PL=F is ~$1,000+/oz.
    plat = _quote_cache.get("PLAT")
    if plat and plat[0] is not None and float(plat[0]) < 500:
        _forget_quote("PLAT")
        changed = True
    if changed:
        _save_disk_quotes()


def _save_disk_quotes() -> None:
    payload = {
        ticker: {
            "price": price,
            "fetched_at": fetched_at,
            "change_pct": change_pct,
            "source": _quote_source_by_ticker.get(ticker),
        }
        for ticker, (price, fetched_at, change_pct) in _quote_cache.items()
    }
    try:
        QUOTE_CACHE_PATH.write_text(json.dumps(payload, indent=2))
    except Exception:
        pass


_load_disk_quotes()
_load_commodity_scales()
_scrub_bad_commodity_proxy_cache()
_seed_commodity_quotes_from_feeds()


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                cash REAL NOT NULL DEFAULT 100000,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS holdings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                ticker TEXT NOT NULL,
                shares REAL NOT NULL,
                avg_cost REAL NOT NULL DEFAULT 0,
                mortgage_balance REAL NOT NULL DEFAULT 0,
                mortgage_rate_pct REAL,
                loan_years INTEGER,
                closing_paid REAL NOT NULL DEFAULT 0,
                UNIQUE(student_id, ticker),
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS portfolio_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                recorded_at TEXT NOT NULL,
                total_value REAL NOT NULL,
                cash REAL NOT NULL,
                portfolio_value REAL NOT NULL DEFAULT 0,
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
            );
            """
        )
        # Migrate older DBs that predate mortgage columns.
        cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(holdings)").fetchall()
        }
        migrations = []
        if "mortgage_balance" not in cols:
            migrations.append(
                "ALTER TABLE holdings ADD COLUMN mortgage_balance REAL NOT NULL DEFAULT 0"
            )
        if "mortgage_rate_pct" not in cols:
            migrations.append("ALTER TABLE holdings ADD COLUMN mortgage_rate_pct REAL")
        if "loan_years" not in cols:
            migrations.append("ALTER TABLE holdings ADD COLUMN loan_years INTEGER")
        if "closing_paid" not in cols:
            migrations.append(
                "ALTER TABLE holdings ADD COLUMN closing_paid REAL NOT NULL DEFAULT 0"
            )
        if "monthly_rent" not in cols:
            migrations.append("ALTER TABLE holdings ADD COLUMN monthly_rent REAL")
        if "monthly_payment" not in cols:
            migrations.append("ALTER TABLE holdings ADD COLUMN monthly_payment REAL")
        if "last_rent_settled" not in cols:
            migrations.append("ALTER TABLE holdings ADD COLUMN last_rent_settled TEXT")
        for sql in migrations:
            conn.execute(sql)
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_snapshots_student_time
                ON portfolio_snapshots(student_id, recorded_at)
            """
        )


HOME_CLOSING_COST_PCT = 1.0


def home_purchase_costs(home: dict) -> dict:
    price = float(home["price"])
    down_pct = float(home.get("down_payment_pct") or 20)
    rate = float(home.get("mortgage_rate_pct") or 0)
    years = int(home.get("loan_years") or 30)
    down_payment = price * (down_pct / 100.0)
    closing_costs = price * (HOME_CLOSING_COST_PCT / 100.0)
    due_today = down_payment + closing_costs
    loan = price - down_payment
    payment = estimate_mortgage_payment(
        price, rate, down_payment_pct=down_pct, loan_years=years
    )
    return {
        "price": round(price, 2),
        "down_payment_pct": down_pct,
        "down_payment": round(down_payment, 2),
        "closing_cost_pct": HOME_CLOSING_COST_PCT,
        "closing_costs": round(closing_costs, 2),
        "due_today": round(due_today, 2),
        "loan_amount": round(loan, 2),
        "mortgage_rate_pct": round(rate, 2),
        "loan_years": years,
        "est_monthly_payment": round(payment, 2),
    }


STARTING_BALANCE = 100000.0


def compute_student_totals(conn: sqlite3.Connection, student_id: int) -> tuple[float, float, float]:
    row = student_row(conn, student_id)
    if not row:
        return 0.0, 0.0, 0.0
    cash = float(row["cash"])
    holdings = conn.execute(
        """
        SELECT ticker, shares, avg_cost, mortgage_balance
        FROM holdings WHERE student_id = ?
        """,
        (student_id,),
    ).fetchall()
    portfolio_value = 0.0
    mortgage_debt = 0.0
    if holdings:
        quotes = fetch_quotes_batch([h["ticker"] for h in holdings])
        for h in holdings:
            price = quotes.get(h["ticker"], (None, None))[0]
            if price is not None:
                portfolio_value += price * float(h["shares"])
            else:
                portfolio_value += float(h["avg_cost"]) * float(h["shares"])
            mortgage_debt += float(h["mortgage_balance"] or 0)
    total_value = cash + portfolio_value - mortgage_debt
    return cash, portfolio_value, total_value


def _holding_select_sql() -> str:
    return """
        SELECT ticker, shares, avg_cost,
               COALESCE(mortgage_balance, 0) AS mortgage_balance,
               mortgage_rate_pct, loan_years,
               COALESCE(closing_paid, 0) AS closing_paid,
               monthly_rent, monthly_payment, last_rent_settled
        FROM holdings
        WHERE student_id = ?
        ORDER BY ticker
    """


def sync_realestate_prices_from_zhvi(*, force_refresh: bool = False) -> dict:
    """Pull ZHVI into MARKET_CATALOG / REALESTATE_BY_TICKER. Safe no-op on failure."""
    try:
        if force_refresh:
            housing_index.get_zhvi_bundle(force_refresh=True)
        result = housing_index.refresh_realestate_catalog_prices(MARKET_CATALOG["realestate"])
        for row in MARKET_CATALOG["realestate"]:
            REALESTATE_BY_TICKER[row["ticker"]] = row
        return result
    except Exception:
        return {"updated": 0, "source": None, "as_of": None}


def holdings_from_sqlite_rows(rows) -> list[dict]:
    out = []
    for h in rows:
        out.append(
            {
                "ticker": h["ticker"],
                "shares": float(h["shares"]),
                "avg_cost": float(h["avg_cost"]),
                "mortgage_balance": float(h["mortgage_balance"] or 0),
                "mortgage_rate_pct": h["mortgage_rate_pct"],
                "loan_years": h["loan_years"],
                "closing_paid": float(h["closing_paid"] or 0),
                "monthly_rent": h["monthly_rent"],
                "monthly_payment": h["monthly_payment"],
                "last_rent_settled": h["last_rent_settled"],
            }
        )
    return out


def settle_housing_for_firestore_student(class_id: str, student_id: str, student: dict, holdings: list[dict]):
    """Apply due months; persist cash + holdings. Returns (student, holdings)."""
    sync_realestate_prices_from_zhvi()
    new_cash, holdings, changed = housing_settlement.apply_housing_settlement_to_holdings(
        holdings,
        float(student["cash"]),
        is_home=lambda t: t in REALESTATE_BY_TICKER,
        catalog_home=lambda t: REALESTATE_BY_TICKER.get(t),
    )
    if not changed:
        return student, holdings
    for h in holdings:
        if h.get("ticker") in REALESTATE_BY_TICKER:
            fs_ledger.upsert_holding(class_id, student_id, h)
    fs_ledger.set_cash(class_id, student_id, new_cash, holdings_count=len(holdings))
    student["cash"] = new_cash
    return student, holdings


def settle_housing_for_sqlite_student(conn: sqlite3.Connection, student_id: int, row, holdings_rows):
    sync_realestate_prices_from_zhvi()
    holdings = holdings_from_sqlite_rows(holdings_rows)
    new_cash, holdings, changed = housing_settlement.apply_housing_settlement_to_holdings(
        holdings,
        float(row["cash"]),
        is_home=lambda t: t in REALESTATE_BY_TICKER,
        catalog_home=lambda t: REALESTATE_BY_TICKER.get(t),
    )
    if not changed:
        return row, holdings_rows
    conn.execute("UPDATE students SET cash = ? WHERE id = ?", (new_cash, student_id))
    for h in holdings:
        if h.get("ticker") not in REALESTATE_BY_TICKER:
            continue
        conn.execute(
            """
            UPDATE holdings
               SET mortgage_balance = ?,
                   monthly_rent = ?,
                   monthly_payment = ?,
                   last_rent_settled = ?
             WHERE student_id = ? AND ticker = ?
            """,
            (
                float(h.get("mortgage_balance") or 0),
                h.get("monthly_rent"),
                h.get("monthly_payment"),
                h.get("last_rent_settled"),
                student_id,
                h["ticker"],
            ),
        )
    row = student_row(conn, student_id)
    holdings_rows = conn.execute(_holding_select_sql(), (student_id,)).fetchall()
    return row, holdings_rows


def record_snapshot(
    conn: sqlite3.Connection,
    student_id: int,
    *,
    cash: float | None = None,
    portfolio_value: float | None = None,
    total_value: float | None = None,
    recorded_at: str | None = None,
) -> None:
    if cash is None or portfolio_value is None or total_value is None:
        cash, portfolio_value, total_value = compute_student_totals(conn, student_id)
    ts = recorded_at or utc_now()
    # Avoid noisy duplicates within a few seconds.
    latest = conn.execute(
        """
        SELECT recorded_at, total_value FROM portfolio_snapshots
        WHERE student_id = ?
        ORDER BY recorded_at DESC LIMIT 1
        """,
        (student_id,),
    ).fetchone()
    if latest and abs(float(latest["total_value"]) - float(total_value)) < 0.005:
        try:
            prev = datetime.fromisoformat(latest["recorded_at"])
            now = datetime.fromisoformat(ts)
            if abs((now - prev).total_seconds()) < 15:
                return
        except Exception:
            pass
    conn.execute(
        """
        INSERT INTO portfolio_snapshots (student_id, recorded_at, total_value, cash, portfolio_value)
        VALUES (?, ?, ?, ?, ?)
        """,
        (student_id, ts, float(total_value), float(cash), float(portfolio_value)),
    )


def ensure_starting_snapshot(conn: sqlite3.Connection, row: sqlite3.Row) -> None:
    existing = conn.execute(
        "SELECT id FROM portfolio_snapshots WHERE student_id = ? LIMIT 1",
        (row["id"],),
    ).fetchone()
    if existing:
        return
    record_snapshot(
        conn,
        row["id"],
        cash=float(row["cash"]),
        portfolio_value=0.0,
        total_value=float(row["cash"]),
        recorded_at=row["created_at"],
    )


def fetch_quote(ticker: str) -> float | None:
    symbol = ticker.strip().upper()
    if not symbol:
        return None
    price, _change = fetch_quote_detail(symbol)
    return price


def _cache_get(symbol: str, *, allow_stale: bool = False) -> tuple[float | None, float | None]:
    cached = _quote_cache.get(symbol)
    if not cached:
        return None, None
    age = datetime.now(timezone.utc).timestamp() - cached[1]
    if age < CACHE_TTL_SECONDS or (allow_stale and age < STALE_OK_SECONDS):
        return cached[0], cached[2]
    return None, None


def _equity_industry_map() -> dict[str, str]:
    """Ticker → industry for fair quote scheduling across catalog sectors."""
    out: dict[str, str] = {}
    for cat in ("stocks", "etfs"):
        for item in MARKET_CATALOG.get(cat, []):
            ticker = str(item.get("ticker") or "").strip().upper()
            if ticker:
                out[ticker] = str(item.get("industry") or "Other")
    return out


def _fair_quote_order(tickers: list[str]) -> list[str]:
    """Round-robin by industry so Industrials (last in catalog) aren't starved."""
    if not tickers:
        return []
    industry_of = _equity_industry_map()
    buckets: dict[str, deque[str]] = {}
    for symbol in tickers:
        key = industry_of.get(symbol, "Other")
        buckets.setdefault(key, deque()).append(symbol)
    order: list[str] = []
    queues = list(buckets.values())
    while any(queues):
        for q in queues:
            if q:
                order.append(q.popleft())
    return order


def _prioritize_finnhub_symbols(symbols: list[str], *, max_n: int) -> list[str]:
    """Never-cached first, industry-fair, capped under free-tier Finnhub limits."""
    if not symbols:
        return []
    never: list[str] = []
    have_stale: list[str] = []
    for symbol in symbols:
        if _cache_get(symbol, allow_stale=True)[0] is None:
            never.append(symbol)
        else:
            have_stale.append(symbol)
    ordered = _fair_quote_order(never) + _fair_quote_order(have_stale)
    return ordered[: max(0, int(max_n))]


def fetch_quotes_batch(
    tickers: list[str], *, force_refresh: bool = False
) -> dict[str, tuple[float | None, float | None]]:
    """Fetch live quotes (Finnhub first, yfinance fallback, then stale cache)."""
    global _last_quote_source, _last_quote_provider_error

    symbols = [t.strip().upper() for t in tickers if t and t.strip()]
    out: dict[str, tuple[float | None, float | None]] = {s: (None, None) for s in symbols}
    if not symbols:
        return out

    sources_used: set[str] = set()
    _last_quote_provider_error = None
    need: list[str] = []
    for symbol in symbols:
        bond = BOND_BY_TICKER.get(symbol)
        if bond:
            out[symbol] = (float(bond["price"]), None)
            sources_used.add("catalog")
            continue
        home = REALESTATE_BY_TICKER.get(symbol)
        if home:
            out[symbol] = (float(home["price"]), home.get("yoy_change_pct"))
            sources_used.add("catalog")
            continue
        hit = _cache_get(symbol)
        if hit[0] is None:
            derived = _commodity_quote_from_feed_cache(symbol)
            if derived[0] is not None:
                hit = derived
                sources_used.add("derived")
        if hit[0] is not None and not force_refresh:
            out[symbol] = hit
            sources_used.add("cache")
        else:
            need.append(symbol)

    if not need:
        _last_quote_source = "+".join(sorted(sources_used)) or "cache"
        return out

    now = datetime.now(timezone.utc).timestamp()
    finnhub_budget = FINNHUB_MAX_QUOTES_PER_BATCH

    # Currencies: Yahoo FX first. Free Finnhub keys usually 403 on OANDA forex.
    currency_need = [s for s in need if s in CURRENCY_BY_TICKER and out[s][0] is None]
    if currency_need and not _yahoo_on_cooldown():
        workers = min(4, len(currency_need))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(_yfinance_quote_one, symbol) for symbol in currency_need]
            for fut in as_completed(futures):
                try:
                    local, price, change_pct = fut.result()
                except Exception as exc:
                    _last_quote_provider_error = f"yfinance: {exc}"
                    continue
                if price is None:
                    continue
                out[local] = (price, change_pct)
                _remember_quote(local, price, now, change_pct, "yahoo")
                sources_used.add("yfinance")
                if _yahoo_on_cooldown():
                    break

    # Free ECB rates when Yahoo is blocked / Finnhub denies forex.
    currency_need = [s for s in need if s in CURRENCY_BY_TICKER and out[s][0] is None]
    if currency_need:
        try:
            fx_marks = _frankfurter_currency_quotes(currency_need)
        except Exception as exc:
            _last_quote_provider_error = f"frankfurter: {exc}"
            fx_marks = {}
        for local, (price, change_pct) in fx_marks.items():
            if price is None:
                continue
            out[local] = (price, change_pct)
            _remember_quote(local, price, now, change_pct, "ecb")
            sources_used.add("frankfurter")

    # Commodities: Finnhub ETF proxies first (stable under classroom load). Yahoo
    # futures are a nicety — one 429 trips a global cooldown and used to block buys.
    commodity_need = [s for s in need if s in COMMODITY_BY_TICKER]
    finnhub_candidates = [
        s
        for s in need
        if out[s][0] is None
        and not (
            s in COMMODITY_BY_TICKER and not COMMODITY_BY_TICKER[s].get("finnhub")
        )
        # Skip FX on Finnhub when free-tier access was denied.
        and not (s in CURRENCY_BY_TICKER and _finnhub_fx_blocked())
    ]
    commodity_finnhub = [s for s in finnhub_candidates if s in COMMODITY_BY_TICKER]
    equity_finnhub = [s for s in finnhub_candidates if s not in COMMODITY_BY_TICKER]
    # Commodities first (small set), then industry-fair equities under the remaining budget.
    take_cmd = commodity_finnhub[:finnhub_budget]
    take_eq = _prioritize_finnhub_symbols(
        equity_finnhub, max_n=max(0, finnhub_budget - len(take_cmd))
    )
    finnhub_need = take_cmd + take_eq
    if finnhub_configured() and not _finnhub_on_cooldown() and finnhub_need:
        workers = min(4, len(finnhub_need))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(_finnhub_quote_one, symbol) for symbol in finnhub_need]
            for fut in as_completed(futures):
                try:
                    local, price, change_pct = fut.result()
                except Exception as exc:
                    _last_quote_provider_error = str(exc)
                    continue
                if price is None:
                    continue
                out[local] = (price, change_pct)
                src_label = "proxy" if local in COMMODITY_BY_TICKER else "finnhub"
                _remember_quote(local, price, now, change_pct, src_label)
                sources_used.add("finnhub")
        finnhub_budget = max(0, finnhub_budget - len(finnhub_need))

    # Yahoo futures only for commodities still missing (or when forced), and never
    # while cooling down after a 429.
    yahoo_commodity_need = [
        s for s in commodity_need if out[s][0] is None
    ]
    if yahoo_commodity_need and not _yahoo_on_cooldown():
        for symbol in yahoo_commodity_need:
            if _yahoo_on_cooldown():
                break
            try:
                local, price, change_pct = _yfinance_quote_one(symbol)
            except Exception as exc:
                _last_quote_provider_error = f"yfinance: {exc}"
                continue
            if price is None:
                continue
            out[local] = (price, change_pct)
            _remember_quote(local, price, now, change_pct, "yahoo")
            _calibrate_commodity_scale(local, float(price))
            sources_used.add("yfinance")

    # Finnhub for any non-commodity still missing after the first pass
    # (stocks/ETFs; currencies only if Yahoo missed and FX isn't blocked).
    finnhub_need = [
        s
        for s in need
        if out[s][0] is None
        and s not in COMMODITY_BY_TICKER
        and not (s in CURRENCY_BY_TICKER and _finnhub_fx_blocked())
    ]
    finnhub_need = _prioritize_finnhub_symbols(finnhub_need, max_n=finnhub_budget)
    if finnhub_configured() and not _finnhub_on_cooldown() and finnhub_need:
        workers = min(4, len(finnhub_need))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(_finnhub_quote_one, symbol) for symbol in finnhub_need]
            for fut in as_completed(futures):
                try:
                    local, price, change_pct = fut.result()
                except Exception as exc:
                    _last_quote_provider_error = str(exc)
                    continue
                if price is None:
                    continue
                out[local] = (price, change_pct)
                _remember_quote(local, price, now, change_pct, "finnhub")
                sources_used.add("finnhub")

    # Last resort for commodities: Yahoo-quote the ETF/ETN proxy (e.g. JO for coffee)
    # when futures are rate-limited and Finnhub has no quote for that feed.
    commodity_proxy_need = [
        s for s in need if out[s][0] is None and s in COMMODITY_BY_TICKER
    ]
    if commodity_proxy_need:
        workers = 1
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [
                pool.submit(_commodity_proxy_via_yahoo_etf, symbol)
                for symbol in commodity_proxy_need
            ]
            for fut in as_completed(futures):
                try:
                    local, price, change_pct = fut.result()
                except Exception as exc:
                    _last_quote_provider_error = f"yahoo-etf-proxy: {exc}"
                    continue
                if price is None:
                    continue
                out[local] = (price, change_pct)
                _remember_quote(local, price, now, change_pct, "proxy")
                sources_used.add("yahoo-etf")

    # Sequential Yahoo fallback — parallel fan-out trips a global 429 cooldown and
    # leaves late catalog sectors (Industrials) with no mark.
    still_need = _fair_quote_order(
        [s for s in need if out[s][0] is None and s not in COMMODITY_BY_TICKER]
    )
    if still_need and not _yahoo_on_cooldown():
        for symbol in still_need:
            if _yahoo_on_cooldown():
                break
            try:
                local, price, change_pct = _yfinance_quote_one(symbol)
            except Exception as exc:
                _last_quote_provider_error = f"yfinance: {exc}"
                continue
            if price is None:
                continue
            out[local] = (price, change_pct)
            _remember_quote(local, price, now, change_pct, "yahoo")
            sources_used.add("yfinance")

    # Sparse futures samples → live ETF scales stay aligned with real $/unit.
    if commodity_need:
        before = len(_commodity_live_scales)
        _maybe_calibrate_commodity_scales(commodity_need, out)
        if len(_commodity_live_scales) > before or any(
            quote_source_for(s) == "yahoo" for s in commodity_need
        ):
            sources_used.add("scale-cal")

    if any(out[s][0] is not None for s in need):
        _save_disk_quotes()
        # Don't surface a Finnhub FX 403 (or similar) once we have usable marks.
        _last_quote_provider_error = None

    for symbol in need:
        if out[symbol][0] is not None:
            continue
        stale = _cache_get(symbol, allow_stale=True)
        if stale[0] is None:
            stale = _commodity_quote_from_feed_cache(symbol, allow_stale=True)
            if stale[0] is not None:
                sources_used.add("derived")
        if stale[0] is not None:
            out[symbol] = stale
            sources_used.add("stale")

    missing = [s for s in need if out[s][0] is None]
    if missing and not _last_quote_provider_error:
        if not finnhub_configured() and "yfinance" not in sources_used:
            _last_quote_provider_error = "FINNHUB_API_KEY is not set and yfinance fallback failed"
        elif _yahoo_on_cooldown() and any(s in CURRENCY_BY_TICKER for s in missing):
            _last_quote_provider_error = (
                "Currency prices are rate-limited right now. Try again in a moment."
            )
        elif _finnhub_on_cooldown():
            _last_quote_provider_error = "Finnhub rate limited; yfinance fallback also missed some quotes"
        else:
            _last_quote_provider_error = f"No live price for {', '.join(missing[:6])}"
            if len(missing) > 6:
                _last_quote_provider_error += f" (+{len(missing) - 6} more)"

    _last_quote_source = "+".join(sorted(sources_used)) or "none"
    return out


def fetch_quote_detail(ticker: str) -> tuple[float | None, float | None]:
    symbol = ticker.strip().upper()
    if not symbol:
        return None, None
    return fetch_quotes_batch([symbol]).get(symbol, (None, None))


def catalog_snapshot(category: str) -> list[dict]:
    """Fast market list without live quote providers — names/meta only."""
    items = MARKET_CATALOG.get(category, [])
    if category == "bonds":
        final = []
        for item in items:
            final.append(
                {
                    "ticker": item["ticker"],
                    "name": item["name"],
                    "issuer": item.get("issuer"),
                    "kind": item.get("kind"),
                    "price": None,
                    "face_value": item.get("face_value", 100),
                    "yield_pct": item.get("yield_pct"),
                    "coupon_pct": item.get("coupon_pct"),
                    "maturity": item.get("maturity"),
                    "as_of": item.get("as_of"),
                    "note": item.get("note"),
                    "live_yield": False,
                    "change_pct": None,
                    "asset_type": "bond",
                    "info": item.get("info"),
                }
            )
        return final

    if category == "realestate":
        sync_realestate_prices_from_zhvi()
        items = MARKET_CATALOG.get("realestate", items)
        final = []
        for item in items:
            price = float(item["price"])
            rate = float(item.get("mortgage_rate_pct") or 0)
            down_pct = float(item.get("down_payment_pct") or 20)
            years = int(item.get("loan_years") or 30)
            costs = home_purchase_costs(item)
            yoy = item.get("yoy_change_pct")
            rent = item.get("monthly_rent")
            final.append(
                {
                    "ticker": item["ticker"],
                    "name": item["name"],
                    "region": item.get("region"),
                    "price": round(price, 2),
                    "mortgage_rate_pct": round(rate, 2),
                    "yoy_change_pct": round(float(yoy), 2) if yoy is not None else None,
                    "change_pct": round(float(yoy), 2) if yoy is not None else None,
                    "down_payment_pct": down_pct,
                    "down_payment": costs["down_payment"],
                    "closing_cost_pct": costs["closing_cost_pct"],
                    "closing_costs": costs["closing_costs"],
                    "due_today": costs["due_today"],
                    "loan_amount": costs["loan_amount"],
                    "loan_years": years,
                    "est_monthly_payment": costs["est_monthly_payment"],
                    "monthly_rent": round(float(rent), 2) if rent is not None else None,
                    "as_of": item.get("as_of"),
                    "asset_type": "realestate",
                    "info": item.get("info"),
                }
            )
        return final

    final = []
    for item in items:
        row = {
            "ticker": item["ticker"],
            "name": item["name"],
            "price": None,
            "change_pct": None,
            "asset_type": (
                "commodity"
                if category == "commodities"
                else "currency"
                if category == "currencies"
                else "equity"
            ),
        }
        if item.get("kind"):
            row["kind"] = item["kind"]
        if item.get("industry"):
            row["industry"] = item["industry"]
        if item.get("info"):
            row["info"] = item["info"]
        if item.get("unit_label"):
            row["unit_label"] = item["unit_label"]
        if item.get("lot"):
            row["lot"] = item["lot"]
        final.append(row)
    return final


def enrich_catalog(category: str, *, force_refresh: bool = False) -> list[dict]:
    items = MARKET_CATALOG.get(category, [])
    now = datetime.now(timezone.utc).timestamp()

    # Bonds: Treasuries use the official daily par yield curve; corporates stay fixed.
    if category == "bonds":
        live_items = apply_live_treasury_yields(items, force_refresh=force_refresh)
        # Keep quote lookup in sync with any catalog overlays.
        for row in live_items:
            BOND_BY_TICKER[row["ticker"]] = row
        final = []
        for item in live_items:
            income = bond_interest_to_horizon(item)
            if income["matured"]:
                summary = (
                    f"This bond’s maturity ({item.get('maturity')}) is already past, "
                    f"so there is no remaining interest through {income['horizon']}."
                )
            elif income["interest_per_unit"] <= 0:
                summary = (
                    f"Holding one ${income['face_value']:.0f} unit through {income['horizon']} "
                    f"earns about $0.00 of interest at the classroom rate."
                )
            else:
                rate_word = "coupon" if income["uses_coupon"] else "yield"
                summary = (
                    f"Hold one ${income['face_value']:.0f} unit and you earn about "
                    f"${income['interest_per_unit']:.2f} in fixed interest by {income['horizon']} "
                    f"({income['years']:.2f} years at {income['rate_pct']:.2f}% {rate_word}). "
                    f"Income stops at maturity if that comes first."
                )
            final.append(
                {
                    "ticker": item["ticker"],
                    "name": item["name"],
                    "issuer": item.get("issuer"),
                    "kind": item.get("kind"),
                    "price": round(float(item["price"]), 2),
                    "face_value": item.get("face_value", 100),
                    "yield_pct": item.get("yield_pct"),
                    "coupon_pct": item.get("coupon_pct"),
                    "maturity": item.get("maturity"),
                    "as_of": item.get("as_of"),
                    "note": item.get("note"),
                    "live_yield": bool(item.get("live_yield")),
                    "change_pct": None,
                    "asset_type": "bond",
                    "interest_to_horizon": income,
                    "info": {
                        "summary": summary,
                        "interest_per_unit": income["interest_per_unit"],
                        "horizon": income["horizon"],
                        "years": income["years"],
                        "rate_pct": income["rate_pct"],
                        "matured": income["matured"],
                    },
                }
            )
        _category_cache[category] = (now, final)
        return final

    # Real estate: ZHVI city indexes + classroom mortgage terms.
    if category == "realestate":
        sync_realestate_prices_from_zhvi()
        items = MARKET_CATALOG.get("realestate", items)
        final = []
        for item in items:
            price = float(item["price"])
            rate = float(item.get("mortgage_rate_pct") or 0)
            down_pct = float(item.get("down_payment_pct") or 20)
            years = int(item.get("loan_years") or 30)
            payment = estimate_mortgage_payment(
                price, rate, down_payment_pct=down_pct, loan_years=years
            )
            down_payment = price * (down_pct / 100.0)
            yoy = item.get("yoy_change_pct")
            costs = home_purchase_costs(item)
            rent = item.get("monthly_rent")
            final.append(
                {
                    "ticker": item["ticker"],
                    "name": item["name"],
                    "region": item.get("region"),
                    "price": round(price, 2),
                    "mortgage_rate_pct": round(rate, 2),
                    "yoy_change_pct": round(float(yoy), 2) if yoy is not None else None,
                    "change_pct": round(float(yoy), 2) if yoy is not None else None,
                    "down_payment_pct": down_pct,
                    "down_payment": costs["down_payment"],
                    "closing_cost_pct": costs["closing_cost_pct"],
                    "closing_costs": costs["closing_costs"],
                    "due_today": costs["due_today"],
                    "loan_amount": costs["loan_amount"],
                    "loan_years": years,
                    "est_monthly_payment": costs["est_monthly_payment"],
                    "monthly_rent": round(float(rent), 2) if rent is not None else None,
                    "as_of": item.get("as_of"),
                    "asset_type": "realestate",
                    "info": item.get("info"),
                }
            )
        _category_cache[category] = (now, final)
        return final

    cached_cat = _category_cache.get(category)
    if (
        not force_refresh
        and cached_cat
        and now - cached_cat[0] < CACHE_TTL_SECONDS
        and all(row.get("price") is not None for row in cached_cat[1])
    ):
        if category == "commodities":
            refreshed = []
            for row in cached_cat[1]:
                next_row = dict(row)
                ticker = next_row["ticker"]
                quality = commodity_price_quality(ticker)
                next_row["price_source"] = quote_source_for(ticker)
                next_row["price_quality"] = quality
                next_row["buy_ok"] = bool(
                    next_row.get("price") is not None
                    and commodity_buy_allowed(ticker)
                )
                if quality == "approximate":
                    next_row["price_note"] = (
                        "Approximate classroom price (ETF proxy). "
                        "Your buy locks in at this price — it won’t be rewritten later."
                    )
                elif quality == "futures":
                    next_row["price_note"] = "Live futures-based classroom price."
                else:
                    next_row.pop("price_note", None)
                refreshed.append(next_row)
            return refreshed
        return cached_cat[1]

    _load_disk_quotes()
    _seed_commodity_quotes_from_feeds()
    tickers = [item["ticker"] for item in items]
    quotes = fetch_quotes_batch(tickers, force_refresh=force_refresh)
    final = []
    for item in items:
        price, change_pct = quotes.get(item["ticker"], (None, None))
        row = {
            "ticker": item["ticker"],
            "name": item["name"],
            "price": round(price, 4) if price is not None and category == "currencies" else (
                round(price, 2) if price is not None else None
            ),
            "change_pct": round(change_pct, 2) if change_pct is not None else None,
            "asset_type": (
                "commodity"
                if category == "commodities"
                else "currency"
                if category == "currencies"
                else "equity"
            ),
        }
        if item.get("kind"):
            row["kind"] = item["kind"]
        if item.get("industry"):
            row["industry"] = item["industry"]
        if item.get("info"):
            row["info"] = item["info"]
        if item.get("unit_label"):
            row["unit_label"] = item["unit_label"]
        if item.get("lot"):
            row["lot"] = item["lot"]
        if category == "commodities":
            src = quote_source_for(item["ticker"])
            row["price_source"] = src
            quality = commodity_price_quality(item["ticker"])
            row["price_quality"] = quality
            row["buy_ok"] = bool(price is not None and commodity_buy_allowed(item["ticker"]))
            if quality == "approximate":
                row["price_note"] = (
                    "Approximate classroom price (ETF proxy). "
                    "Your buy locks in at this price — it won’t be rewritten later."
                )
            elif quality == "futures":
                row["price_note"] = "Live futures-based classroom price."
        final.append(row)

    if any(row["price"] is not None for row in final):
        _category_cache[category] = (now, final)
    return final


def student_row(conn: sqlite3.Connection, student_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()


def serialize_student(conn: sqlite3.Connection, row: sqlite3.Row, with_portfolio: bool = False) -> dict:
    holdings = conn.execute(_holding_select_sql(), (row["id"],)).fetchall()

    quotes = {}
    if with_portfolio and holdings:
        quotes = fetch_quotes_batch([h["ticker"] for h in holdings])

    portfolio_value = 0.0
    mortgage_debt = 0.0
    holding_payload = []
    for h in holdings:
        ticker = h["ticker"]
        is_home = ticker in REALESTATE_BY_TICKER
        price = quotes.get(ticker, (None, None))[0] if with_portfolio else None
        if with_portfolio and price is None:
            price = float(h["avg_cost"])
        market_value = (price * h["shares"]) if price is not None and with_portfolio else None
        mortgage_balance = float(h["mortgage_balance"] or 0)
        mortgage_debt += mortgage_balance
        if market_value is not None:
            portfolio_value += market_value
        cost_basis = float(h["avg_cost"]) * float(h["shares"])
        if is_home:
            # Cost basis for a home is what was paid up front (down + closing).
            cost_basis = float(h["avg_cost"]) - mortgage_balance + float(h["closing_paid"] or 0)
            # Prefer explicit cash-in: down payment portion of avg is purchase price;
            # equity gain = market - purchase, cash-in = down + closing.
            purchase_price = float(h["avg_cost"])
            cash_in = (purchase_price - mortgage_balance) + float(h["closing_paid"] or 0)
            equity = (market_value - mortgage_balance) if market_value is not None else None
            gain_loss = (equity - cash_in) if equity is not None else None
            gain_loss_pct = (
                (gain_loss / cash_in) * 100 if gain_loss is not None and cash_in > 0 else None
            )
            cost_basis = cash_in
        else:
            gain_loss = (market_value - cost_basis) if market_value is not None else None
            gain_loss_pct = (
                ((market_value - cost_basis) / cost_basis) * 100
                if market_value is not None and cost_basis > 0
                else None
            )
            equity = market_value

        payload = {
            "ticker": ticker,
            "shares": round(h["shares"], 4),
            "avg_cost": round(h["avg_cost"], 2),
            "cost_basis": round(cost_basis, 2),
            "price": round(price, 2) if price is not None and with_portfolio else None,
            "market_value": round(market_value, 2) if market_value is not None else None,
            "gain_loss": round(gain_loss, 2) if gain_loss is not None else None,
            "gain_loss_pct": round(gain_loss_pct, 2) if gain_loss_pct is not None else None,
            "asset_type": "realestate" if is_home else None,
        }
        if is_home:
            home = REALESTATE_BY_TICKER.get(ticker) or {}
            monthly_rent = h["monthly_rent"] if "monthly_rent" in h.keys() else None
            monthly_payment = h["monthly_payment"] if "monthly_payment" in h.keys() else None
            last_settled = h["last_rent_settled"] if "last_rent_settled" in h.keys() else None
            rent_val = (
                float(monthly_rent)
                if monthly_rent is not None
                else float(home.get("monthly_rent") or 0)
            )
            pay_val = float(monthly_payment) if monthly_payment is not None else None
            payload.update(
                {
                    "name": home.get("name") or ticker,
                    "mortgage_balance": round(mortgage_balance, 2),
                    "mortgage_rate_pct": h["mortgage_rate_pct"],
                    "loan_years": h["loan_years"],
                    "closing_paid": round(float(h["closing_paid"] or 0), 2),
                    "equity": round(equity, 2) if equity is not None else None,
                    "monthly_rent": round(rent_val, 2) if rent_val else None,
                    "monthly_payment": round(pay_val, 2) if pay_val is not None else None,
                    "last_rent_settled": last_settled,
                    "monthly_net": (
                        round(rent_val - pay_val, 2) if pay_val is not None else None
                    ),
                }
            )
        holding_payload.append(payload)

    cash = float(row["cash"])
    total = (
        cash + portfolio_value - mortgage_debt if with_portfolio else cash
    )

    return {
        "id": row["id"],
        "name": row["name"],
        "cash": round(cash, 2),
        "portfolio_value": round(portfolio_value, 2) if with_portfolio else None,
        "mortgage_debt": round(mortgage_debt, 2) if with_portfolio else None,
        "total_value": round(total, 2) if with_portfolio else round(cash, 2),
        "holdings_count": len(holdings),
        "holdings": holding_payload if with_portfolio else None,
        "created_at": row["created_at"],
    }



def request_class_id() -> str:
    body = request.get_json(silent=True) or {}
    return (
        (request.headers.get("X-Class-Id") or "")
        or (request.args.get("classId") or "")
        or str(body.get("classId") or "")
    ).strip()


def require_firestore_class_id():
    """Return (class_id, error_response). error_response is a Flask (body, status) or None."""
    if not using_firestore():
        return "", None
    class_id = request_class_id()
    if not class_id:
        return "", (
            jsonify({"error": "X-Class-Id header (or classId) is required for the Firestore ledger"}),
            400,
        )
    return class_id, None


@app.get("/api/health")
def health():
    ledger = "firestore" if using_firestore() else "sqlite"
    firestore_error = None if using_firestore() else fs_ledger.config_error()
    firestore_ok = None
    if using_firestore():
        try:
            # Prove credentials can actually read (health alone only checks SDK init).
            next(fs_ledger.db().collection("classes").limit(1).stream(), None)
            firestore_ok = True
        except Exception as exc:
            firestore_ok = False
            firestore_error = str(exc)
            ledger = "firestore-error"
    return jsonify({
        "ok": firestore_ok is not False,
        "ledger": ledger,
        "firestore_ok": firestore_ok,
        "firestore_error": firestore_error,
    })


@app.get("/api/fear-greed")
def fear_greed():
    """CNN Fear & Greed Index (0–100). Cached ~1 hour."""
    force = str(request.args.get("refresh") or "").lower() in {"1", "true", "yes"}
    data = fetch_fear_greed(force_refresh=force)
    if not data:
        return jsonify({"error": "Fear & Greed index is unavailable right now."}), 503
    return jsonify(data)


@app.get("/api/class/popular-stocks")
def class_popular_stocks():
    """
    Most-held classroom stocks from a cache on the class doc.
    Rebuilds once if the cache is missing (existing classes); later buy/sell
    updates keep it fresh with a single class-doc write.
    """
    class_id, err = require_firestore_class_id()
    if err:
        return err
    if not using_firestore():
        return jsonify({"stocks": [], "className": ""})
    if not class_id:
        return jsonify({"error": "X-Class-Id header (or classId) is required"}), 400
    stock_names = {item["ticker"]: item["name"] for item in MARKET_CATALOG.get("stocks", [])}
    force = str(request.args.get("rebuild") or "").lower() in {"1", "true", "yes"}
    try:
        if force:
            rows = fs_ledger.rebuild_popular_stocks(class_id, stock_names)
        else:
            rows = fs_ledger.ensure_popular_stocks(class_id, stock_names)
    except Exception as exc:
        return jsonify({"error": f"Could not load popular stocks: {exc}"}), 500
    cls = fs_ledger.get_class(class_id) or {}
    return jsonify(
        {
            "stocks": rows[:15],
            "className": cls.get("name") or "",
            "updatedAt": cls.get("popularStocksUpdatedAt"),
        }
    )


@app.get("/api/standings")
def class_standings():
    """
    Lightweight class ranking for the standings UI.
    Uses last stored totals (snapshots / student cache) — no live quotes, ZHVI, or settlement.
    """
    class_id, err = require_firestore_class_id()
    if err:
        return err
    rows: list[dict] = []
    if using_firestore():
        if not class_id:
            return jsonify({"error": "X-Class-Id header (or classId) is required"}), 400
        for student in fs_ledger.list_students(class_id):
            cash = float(student.get("cash") or 0)
            total = student.get("last_total_value")
            portfolio_value = student.get("last_portfolio_value")
            if total is None:
                # First visit after deploy / never snapshotted: book value, no live quotes.
                holdings = fs_ledger.list_holdings(class_id, student["id"])
                pv = 0.0
                mort = 0.0
                for h in holdings:
                    pv += float(h.get("avg_cost") or 0) * float(h.get("shares") or 0)
                    mort += float(h.get("mortgage_balance") or 0)
                portfolio_value = pv
                total = cash + pv - mort
                fs_ledger.set_last_totals(
                    class_id,
                    student["id"],
                    cash=cash,
                    portfolio_value=pv,
                    total_value=total,
                    holdings_count=len(holdings),
                )
            rows.append(
                {
                    "id": student["id"],
                    "name": student.get("name") or "Student",
                    "cash": round(cash, 2),
                    "total_value": round(float(total), 2),
                    "portfolio_value": (
                        round(float(portfolio_value), 2)
                        if portfolio_value is not None
                        else None
                    ),
                }
            )
    else:
        with get_db() as conn:
            db_rows = conn.execute(
                """
                SELECT s.id, s.name, s.cash,
                       COALESCE(
                         (
                           SELECT ps.total_value
                             FROM portfolio_snapshots ps
                            WHERE ps.student_id = s.id
                            ORDER BY ps.recorded_at DESC
                            LIMIT 1
                         ),
                         s.cash
                       ) AS total_value,
                       (
                         SELECT ps.portfolio_value
                           FROM portfolio_snapshots ps
                          WHERE ps.student_id = s.id
                          ORDER BY ps.recorded_at DESC
                          LIMIT 1
                       ) AS portfolio_value
                  FROM students s
                 ORDER BY s.name COLLATE NOCASE
                """
            ).fetchall()
            for r in db_rows:
                rows.append(
                    {
                        "id": r["id"],
                        "name": r["name"],
                        "cash": round(float(r["cash"]), 2),
                        "total_value": round(float(r["total_value"]), 2),
                        "portfolio_value": (
                            round(float(r["portfolio_value"]), 2)
                            if r["portfolio_value"] is not None
                            else None
                        ),
                    }
                )

    rows.sort(key=lambda s: (-float(s["total_value"]), (s["name"] or "").lower()))
    for i, row in enumerate(rows, start=1):
        row["rank"] = i
    return jsonify({"students": rows, "class_total": round(sum(float(s["total_value"]) for s in rows), 2)})


@app.get("/api/students")
def list_students():
    refresh = request.args.get("refresh") == "1"
    class_id, err = require_firestore_class_id()
    if err:
        return err
    if using_firestore():
        rows = []
        for student in fs_ledger.list_students(class_id):
            if refresh:
                holdings = fs_ledger.list_holdings(class_id, student["id"])
                rows.append(
                    serialize_portfolio(
                        student,
                        holdings,
                        with_portfolio=True,
                        realestate_by_ticker=REALESTATE_BY_TICKER,
                        fetch_quotes_batch=fetch_quotes_batch,
                    )
                )
            else:
                # Light roster path: one student-doc read each — do NOT fan out into
                # holdings subcollections (that burned Firestore free-tier quota in class).
                holdings_count = int(student.get("holdings_count") or 0)
                cash = float(student.get("cash") or 0)
                rows.append(
                    {
                        "id": student["id"],
                        "name": student.get("name") or "Student",
                        "cash": round(cash, 2),
                        "portfolio_value": None,
                        "mortgage_debt": None,
                        "total_value": round(cash, 2),
                        "holdings_count": holdings_count,
                        "holdings": None,
                        "created_at": student.get("created_at"),
                        "class_id": student.get("class_id"),
                        "ledger": "firestore",
                    }
                )
        return jsonify(rows)

    with get_db() as conn:
        rows = conn.execute("SELECT * FROM students ORDER BY name COLLATE NOCASE").fetchall()
        return jsonify([serialize_student(conn, r, with_portfolio=refresh) for r in rows])


@app.post("/api/students")
def create_student():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    starting_cash = float(data["cash"]) if data.get("cash") is not None else STARTING_BALANCE
    if not name:
        return jsonify({"error": "Name is required"}), 400
    if starting_cash < 0:
        return jsonify({"error": "Starting cash cannot be negative"}), 400

    if using_firestore():
        class_id = (data.get("classId") or request_class_id()).strip()
        student_id = (data.get("studentId") or "").strip()
        if not class_id or not student_id:
            return jsonify({"error": "classId and studentId are required for Firestore ledger"}), 400
        student = fs_ledger.ensure_student(
            class_id,
            student_id,
            name=name,
            cash=starting_cash,
            auth_uid=(data.get("authUid") or None),
        )
        ensure_fs_starting_snapshot(class_id, student)
        holdings = fs_ledger.list_holdings(class_id, student_id)
        return jsonify(
            serialize_portfolio(
                student,
                holdings,
                with_portfolio=False,
                realestate_by_ticker=REALESTATE_BY_TICKER,
                fetch_quotes_batch=fetch_quotes_batch,
            )
        ), 201

    with get_db() as conn:
        created = utc_now()
        cur = conn.execute(
            "INSERT INTO students (name, cash, created_at) VALUES (?, ?, ?)",
            (name, starting_cash, created),
        )
        student_id = cur.lastrowid
        record_snapshot(
            conn,
            student_id,
            cash=starting_cash,
            portfolio_value=0.0,
            total_value=starting_cash,
            recorded_at=created,
        )
        row = student_row(conn, student_id)
        return jsonify(serialize_student(conn, row, with_portfolio=False)), 201


@app.delete("/api/students/<student_id>")
def delete_student(student_id: str):
    class_id, err = require_firestore_class_id()
    if err:
        return err
    if using_firestore():
        ok = fs_ledger.delete_student(class_id, student_id)
        if not ok:
            return jsonify({"error": "Student not found"}), 404
        return jsonify({"ok": True})

    try:
        sid = int(student_id)
    except ValueError:
        return jsonify({"error": "Student not found"}), 404
    with get_db() as conn:
        existing = student_row(conn, sid)
        if not existing:
            return jsonify({"error": "Student not found"}), 404
        conn.execute("DELETE FROM students WHERE id = ?", (sid,))
        return jsonify({"ok": True})


@app.get("/api/students/<student_id>")
def get_student(student_id: str):
    class_id, err = require_firestore_class_id()
    if err:
        return err
    if using_firestore():
        student = fs_ledger.get_student(class_id, student_id)
        if not student:
            return jsonify({"error": "Student not found"}), 404
        ensure_fs_starting_snapshot(class_id, student)
        holdings = fs_ledger.list_holdings(class_id, student_id)
        student, holdings = settle_housing_for_firestore_student(
            class_id, student_id, student, holdings
        )
        payload = serialize_portfolio(
            student,
            holdings,
            with_portfolio=True,
            realestate_by_ticker=REALESTATE_BY_TICKER,
            fetch_quotes_batch=fetch_quotes_batch,
        )
        # Cache standings totals only — do NOT write a history snapshot on every page load
        # (that was burning Firestore free-tier quota during back-to-back classes).
        try:
            fs_ledger.set_last_totals(
                class_id,
                student_id,
                cash=payload["cash"],
                portfolio_value=payload["portfolio_value"] or 0,
                total_value=payload["total_value"],
                holdings_count=payload.get("holdings_count"),
            )
        except Exception:
            pass
        return jsonify(payload)

    try:
        sid = int(student_id)
    except ValueError:
        return jsonify(
            {
                "error": (
                    "Student not found. This student id is not in the local ledger. "
                    "If you're on the live site, set FIREBASE_SERVICE_ACCOUNT_JSON "
                    "so the API uses Firestore (GET /api/health should say "
                    "\"ledger\": \"firestore\")."
                )
            }
        ), 404
    with get_db() as conn:
        row = student_row(conn, sid)
        if not row:
            return jsonify({"error": "Student not found"}), 404
        ensure_starting_snapshot(conn, row)
        holdings_rows = conn.execute(_holding_select_sql(), (sid,)).fetchall()
        row, holdings_rows = settle_housing_for_sqlite_student(
            conn, sid, row, holdings_rows
        )
        payload = serialize_student(conn, row, with_portfolio=True)
        record_snapshot(
            conn,
            sid,
            cash=payload["cash"],
            portfolio_value=payload["portfolio_value"] or 0,
            total_value=payload["total_value"],
        )
        return jsonify(payload)


@app.post("/api/students/<student_id>/adjust")
def adjust_cash(student_id: str):
    data = request.get_json(silent=True) or {}
    try:
        amount = float(data.get("amount"))
    except (TypeError, ValueError):
        return jsonify({"error": "Valid amount is required"}), 400

    class_id, err = require_firestore_class_id()
    if err:
        return err
    if using_firestore():
        student = fs_ledger.get_student(class_id, student_id)
        if not student:
            return jsonify({"error": "Student not found"}), 404
        new_cash = float(student["cash"]) + amount
        if new_cash < 0:
            return jsonify({"error": "Balance cannot go below $0"}), 400
        holdings = fs_ledger.list_holdings(class_id, student_id)
        fs_ledger.set_cash(class_id, student_id, new_cash, holdings_count=len(holdings))
        student["cash"] = new_cash
        cash, portfolio_value, total_value = portfolio_compute_totals(
            student, holdings, fetch_quotes_batch
        )
        record_fs_snapshot(
            class_id,
            student_id,
            student,
            holdings,
            fetch_quotes_batch,
            cash=cash,
            portfolio_value=portfolio_value,
            total_value=total_value,
        )
        return jsonify(
            serialize_portfolio(
                student,
                holdings,
                with_portfolio=False,
                realestate_by_ticker=REALESTATE_BY_TICKER,
                fetch_quotes_batch=fetch_quotes_batch,
            )
        )

    try:
        sid = int(student_id)
    except ValueError:
        return jsonify({"error": "Student not found"}), 404
    with get_db() as conn:
        row = student_row(conn, sid)
        if not row:
            return jsonify({"error": "Student not found"}), 404
        new_cash = float(row["cash"]) + amount
        if new_cash < 0:
            return jsonify({"error": "Balance cannot go below $0"}), 400
        conn.execute("UPDATE students SET cash = ? WHERE id = ?", (new_cash, sid))
        cash, portfolio_value, total_value = compute_student_totals(conn, sid)
        record_snapshot(
            conn,
            sid,
            cash=cash,
            portfolio_value=portfolio_value,
            total_value=total_value,
        )
        updated = student_row(conn, sid)
        return jsonify(serialize_student(conn, updated, with_portfolio=False))


@app.get("/api/quote/<ticker>")
def quote(ticker: str):
    price, change_pct = fetch_quote_detail(ticker)
    if price is None:
        return jsonify({"error": f"Could not find price for {ticker.upper()}"}), 404
    return jsonify(
        {
            "ticker": ticker.strip().upper(),
            "price": round(price, 2),
            "change_pct": round(change_pct, 2) if change_pct is not None else None,
        }
    )


@app.get("/api/quotes")
def quotes_many():
    """Hydrate a small set of tickers (e.g. Industrials filter) without re-quoting all stocks."""
    raw = request.args.get("symbols") or ""
    symbols = []
    seen: set[str] = set()
    for part in raw.split(","):
        sym = part.strip().upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        symbols.append(sym)
        if len(symbols) >= 40:
            break
    if not symbols:
        return jsonify({"quotes": {}})
    batch = fetch_quotes_batch(symbols, force_refresh=False)
    quotes = {}
    for sym in symbols:
        price, change_pct = batch.get(sym, (None, None))
        if price is None:
            continue
        quotes[sym] = {
            "ticker": sym,
            "price": round(float(price), 2),
            "change_pct": round(change_pct, 2) if change_pct is not None else None,
        }
    return jsonify(
        {
            "quotes": quotes,
            "priced": len(quotes),
            "requested": len(symbols),
            "source": _last_quote_source,
            "error": _last_quote_provider_error,
        }
    )


def class_extra_market_tickers(class_id: str | None = None) -> set[str]:
    """Tickers teachers added to the shared classroom market (stocks / etfs)."""
    _ = class_id
    if not using_firestore():
        return set()
    try:
        return {
            str(row.get("ticker") or "").strip().upper()
            for row in fs_ledger.get_extra_market_items(None)
            if row.get("ticker")
        }
    except Exception:
        return set()


def append_class_extra_market(
    items: list[dict],
    category: str,
    *,
    catalog_only: bool = False,
    force_refresh: bool = False,
) -> list[dict]:
    """Merge shared teacher-added stocks/ETFs into a market list response."""
    if category not in {"stocks", "etfs"}:
        return items
    if not using_firestore():
        return items
    try:
        extras = fs_ledger.get_extra_market_items(None, category=category)
    except Exception:
        return items
    if not extras:
        return items

    existing = {
        str(row.get("ticker") or "").strip().upper()
        for row in items
        if row.get("ticker")
    }

    pending: list[dict] = []
    industry_updates: dict[str, str] = {}
    for extra in extras:
        ticker = str(extra.get("ticker") or "").strip().upper()
        if not ticker or ticker in existing:
            continue
        row = dict(extra)
        industry = str(row.get("industry") or "").strip()
        classified = industry
        if industry not in CLASSROOM_INDUSTRIES or industry.lower() == "custom":
            classified = classify_classroom_industry(
                ticker, name=row.get("name"), hint=None
            )
        elif industry == "Consumer":
            # Upgrade weak first-pass defaults using the company name (no API call).
            upgraded = _industry_from_text(row.get("name"))
            if upgraded and upgraded != "Consumer":
                classified = upgraded
        if classified not in CLASSROOM_INDUSTRIES:
            classified = "Consumer"
        if classified != industry:
            industry_updates[ticker] = classified
        row["industry"] = classified
        pending.append(row)

    if industry_updates:
        try:
            fs_ledger.update_extra_market_industries(industry_updates)
        except Exception:
            pass

    # Backfill placeholder "added by a teacher" blurbs (a few per request).
    summary_updates: dict[str, str] = {}
    backfill_budget = 8
    for extra in pending:
        if backfill_budget <= 0:
            break
        ticker = extra["ticker"]
        name = extra.get("name") or ticker
        info = extra.get("info") if isinstance(extra.get("info"), dict) else {}
        summary = str(info.get("summary") or "")
        if not is_placeholder_company_summary(summary, name):
            continue
        try:
            blurb = generate_classroom_company_summary(
                ticker, name=name, industry=extra.get("industry")
            )
        except Exception:
            continue
        if not blurb or is_placeholder_company_summary(blurb, name):
            continue
        summary_updates[ticker] = blurb
        extra["info"] = {**info, "summary": blurb}
        backfill_budget -= 1
    if summary_updates:
        try:
            fs_ledger.update_extra_market_summaries(summary_updates)
        except Exception:
            pass

    quotes: dict[str, tuple[float | None, float | None]] = {}
    if not catalog_only and pending:
        quotes = fetch_quotes_batch(
            [e["ticker"] for e in pending], force_refresh=force_refresh
        )

    out = list(items)
    for extra in pending:
        ticker = extra["ticker"]
        price, change_pct = (None, None) if catalog_only else quotes.get(
            ticker, (None, None)
        )
        industry = extra.get("industry") or "Consumer"
        if industry not in CLASSROOM_INDUSTRIES:
            industry = "Consumer"
        info = extra.get("info") if isinstance(extra.get("info"), dict) else {}
        summary = str(info.get("summary") or "").strip()
        if not summary or is_placeholder_company_summary(summary, extra.get("name")):
            # Prefer any just-generated blurb; otherwise leave a short non-placeholder fallback.
            summary = summary_updates.get(ticker) or _template_company_summary(
                ticker,
                name=extra.get("name"),
                industry=industry,
            )
        out.append(
            {
                "ticker": ticker,
                "name": extra.get("name") or ticker,
                "industry": industry,
                "price": round(price, 2) if price is not None else None,
                "change_pct": round(change_pct, 2) if change_pct is not None else None,
                "asset_type": "equity",
                "custom": True,
                "info": {"summary": summary},
            }
        )
    return out


def _is_us_classroom_symbol(symbol: str) -> bool:
    """Keep US-style tickers students actually trade (AAPL, BRK.B) — drop foreign listings."""
    s = (symbol or "").strip().upper()
    if not s or len(s) > 8:
        return False
    # Pure letter tickers (most US commons / ETFs).
    if re.fullmatch(r"[A-Z]{1,5}", s):
        return True
    # US share classes only (BRK.B, BF.A). Reject foreign suffixes like VOD.L.
    m = re.fullmatch(r"([A-Z]{1,4})\.([A-Z])", s)
    if m and m.group(2) in {"A", "B", "C", "D", "K", "P", "W", "V", "U"}:
        return True
    return False


def _finnhub_search_results(
    query: str, *, limit: int = 15, quote_limit: int = 5
) -> tuple[list[dict], str | None]:
    q = (query or "").strip()
    if len(q) < 1:
        return [], None
    if not finnhub_configured():
        return [], "FINNHUB_API_KEY is not set"
    # Prefer US exchange results from Finnhub, then harden with local ticker rules.
    payload, err = _finnhub_get("/search", {"q": q, "exchange": "US"})
    if err:
        return [], err
    if not isinstance(payload, dict):
        return [], "Unexpected Finnhub search response"
    raw = payload.get("result") or []
    if not isinstance(raw, list):
        return [], None

    out: list[dict] = []
    seen: set[str] = set()
    for row in raw:
        if not isinstance(row, dict):
            continue
        symbol = str(row.get("symbol") or row.get("displaySymbol") or "").strip().upper()
        display = str(row.get("displaySymbol") or symbol).strip().upper()
        if not symbol or symbol in seen:
            continue
        if any(ch in symbol for ch in ("*", "=", "^")):
            continue
        # Drop foreign / numeric listings even if Finnhub tagged them oddly
        # (e.g. 601288.SS, BNC.CR, RY.TO).
        if not _is_us_classroom_symbol(symbol):
            continue
        if display and display != symbol and not _is_us_classroom_symbol(display):
            continue
        typ = str(row.get("type") or "").strip()
        typ_l = typ.lower()
        if typ_l in {"equity option", "warrant", "unit", "right"}:
            continue
        if "etf" in typ_l or typ_l in {"etp", "closed-end fund", "mutual fund"}:
            category = "etfs"
        elif typ_l in {"common stock", "adr", "preferred stock", "equity"} or not typ:
            category = "stocks"
        else:
            if any(x in typ_l for x in ("bond", "crypto", "index", "future", "forex")):
                continue
            category = "stocks"
        seen.add(symbol)
        out.append(
            {
                "ticker": symbol,
                "name": str(row.get("description") or symbol)[:80],
                "type": typ or "Equity",
                "category": category,
                "displaySymbol": display or symbol,
            }
        )
        if len(out) >= max(1, min(int(limit or 15), 25)):
            break

    # Only quote the first few — “Show more” rows still return, without burning quota.
    n_quote = max(0, min(int(quote_limit or 0), len(out)))
    if n_quote:
        quotes = fetch_quotes_batch([r["ticker"] for r in out[:n_quote]])
        for row in out[:n_quote]:
            price, change_pct = quotes.get(row["ticker"], (None, None))
            row["price"] = round(price, 2) if price is not None else None
            row["change_pct"] = (
                round(change_pct, 2) if change_pct is not None else None
            )
        for row in out[n_quote:]:
            row["price"] = None
            row["change_pct"] = None
    else:
        for row in out:
            row["price"] = None
            row["change_pct"] = None
    return out, None


@app.get("/api/market/<category>")
def market_category(category: str):
    key = category.strip().lower()
    if key not in MARKET_CATALOG:
        return jsonify({"error": "Unknown market category"}), 404
    force = request.args.get("refresh") == "1"
    catalog_only = request.args.get("catalog") == "1"
    if catalog_only:
        items = catalog_snapshot(key)
        items = append_class_extra_market(items, key, catalog_only=True)
        # Real estate ships with classroom prices; other markets need live quotes.
        needs_live = key in {"stocks", "etfs", "commodities", "currencies", "bonds"}
        return jsonify(
            {
                "category": key,
                "items": items,
                "pricing": {
                    "ok": True,
                    "pending": needs_live,
                    "priced": sum(1 for row in items if row.get("price") is not None),
                    "total": len(items),
                    "source": None,
                    "error": None,
                },
            }
        )

    # Teacher-added tickers first — small set, otherwise catalog Finnhub spend
    # leaves extras with no mark under free-tier limits.
    if key in {"stocks", "etfs"} and using_firestore():
        try:
            extras = fs_ledger.get_extra_market_items(None, category=key)
            extra_tickers = [
                str(row.get("ticker") or "").strip().upper()
                for row in extras
                if row.get("ticker")
            ]
            if extra_tickers:
                fetch_quotes_batch(extra_tickers, force_refresh=force)
        except Exception:
            pass

    items = enrich_catalog(key, force_refresh=force)
    items = append_class_extra_market(
        items, key, catalog_only=False, force_refresh=force
    )
    priced = sum(1 for row in items if row.get("price") is not None)
    needs_live = key in {"stocks", "etfs", "commodities", "currencies"}
    pricing = {
        "ok": (priced > 0) if needs_live else True,
        "pending": False,
        "priced": priced,
        "total": len(items),
        "source": _last_quote_source,
        "error": _last_quote_provider_error if needs_live and priced == 0 else None,
    }
    return jsonify(
        {
            "category": key,
            "items": items,
            "pricing": pricing,
        }
    )


@app.get("/api/teacher/market/search")
def market_search():
    """Teacher Finnhub symbol search — find tickers to add to the class market."""
    class_id, err = require_firestore_class_id()
    if err:
        return err
    q = (request.args.get("q") or "").strip()
    if len(q) < 1:
        return jsonify({"query": q, "results": []})
    # Up to 15 US-filtered hits; no quote fan-out on search (buy modal prices live).
    results, search_err = _finnhub_search_results(q, limit=15, quote_limit=0)
    if search_err and not results:
        status = 503 if "not set" in search_err.lower() else 502
        return jsonify({"error": search_err}), status

    already = set()
    for cat in ("stocks", "etfs"):
        for item in MARKET_CATALOG.get(cat, []):
            already.add(item["ticker"])
    already |= class_extra_market_tickers(class_id)

    for row in results:
        row["alreadyOnMarket"] = row["ticker"] in already
        row["inCatalog"] = any(
            item["ticker"] == row["ticker"]
            for cat in ("stocks", "etfs")
            for item in MARKET_CATALOG.get(cat, [])
        )

    return jsonify({"query": q, "results": results})


@app.get("/api/teacher/market/extras")
def list_market_extras():
    class_id, err = require_firestore_class_id()
    if err:
        return err
    try:
        rows = fs_ledger.get_extra_market_items(class_id)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    return jsonify({"items": rows})


@app.post("/api/teacher/market/extras")
def add_market_extra():
    class_id, err = require_firestore_class_id()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    teacher_uid = (data.get("teacherUid") or "").strip()
    ticker = (data.get("ticker") or "").strip().upper()
    name = (data.get("name") or ticker).strip()
    category = (data.get("category") or "stocks").strip().lower()
    industry_hint = (data.get("industry") or "").strip()
    if category not in ("stocks", "etfs"):
        category = "stocks"
    if not ticker:
        return jsonify({"error": "Ticker is required"}), 400
    try:
        import closet_ai

        closet_ai._require_teacher(teacher_uid)
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    # Prefer a live quote so dead symbols don't enter the classroom market.
    price = fetch_quote(ticker)
    if price is None or price <= 0:
        return (
            jsonify(
                {
                    "error": (
                        f"Could not find a live price for {ticker}. "
                        "Try another symbol."
                    )
                }
            ),
            404,
        )

    industry = classify_classroom_industry(
        ticker, name=name, hint=industry_hint or None
    )

    try:
        summary = generate_classroom_company_summary(
            ticker, name=name, industry=industry
        )
    except Exception:
        summary = None

    try:
        existing = fs_ledger.get_extra_market_items(class_id)
        if len(existing) >= 80 and not any(
            str(r.get("ticker") or "").upper() == ticker for r in existing
        ):
            return jsonify({"error": "Shared classroom market already has 80 custom tickers"}), 400
        item = fs_ledger.add_extra_market_item(
            class_id,
            ticker=ticker,
            name=name,
            category=category,
            industry=industry,
            added_by=teacher_uid,
            summary=summary,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    return jsonify(
        {
            "ok": True,
            "item": {
                **item,
                "price": round(float(price), 2),
            },
        }
    )


@app.delete("/api/teacher/market/extras/<ticker>")
def remove_market_extra(ticker: str):
    class_id, err = require_firestore_class_id()
    if err:
        return err
    teacher_uid = (
        (request.args.get("teacherUid") or "")
        or str((request.get_json(silent=True) or {}).get("teacherUid") or "")
    ).strip()
    try:
        import closet_ai

        closet_ai._require_teacher(teacher_uid)
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    try:
        removed = fs_ledger.remove_extra_market_item(class_id, ticker)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    if not removed:
        return jsonify({"error": "Ticker not found on this class market"}), 404
    return jsonify({"ok": True, "ticker": ticker.strip().upper()})


@app.get("/api/students/<student_id>/history")
def student_history(student_id: str):
    """Portfolio value over time. Today sits at the chart midpoint; right half is future."""
    class_id, err = require_firestore_class_id()
    if err:
        return err
    if using_firestore():
        student = fs_ledger.get_student(class_id, student_id)
        if not student:
            return jsonify({"error": "Student not found"}), 404
        ensure_fs_starting_snapshot(class_id, student)
        holdings = fs_ledger.list_holdings(class_id, student_id)
        cash, portfolio_value, total_value = portfolio_compute_totals(
            student, holdings, fetch_quotes_batch
        )
        record_fs_snapshot(
            class_id,
            student_id,
            student,
            holdings,
            fetch_quotes_batch,
            cash=cash,
            portfolio_value=portfolio_value,
            total_value=total_value,
            recorded_at=utc_now(),
        )
        snaps = fs_ledger.list_snapshots(class_id, student_id)
        return jsonify(
            build_history_payload(student_id, snaps, baseline=STARTING_BALANCE, utc_now_fn=utc_now)
        )

    try:
        sid = int(student_id)
    except ValueError:
        return jsonify({"error": "Student not found"}), 404
    with get_db() as conn:
        row = student_row(conn, sid)
        if not row:
            return jsonify({"error": "Student not found"}), 404
        ensure_starting_snapshot(conn, row)

        snaps = conn.execute(
            """
            SELECT recorded_at, total_value, cash, portfolio_value
            FROM portfolio_snapshots
            WHERE student_id = ?
            ORDER BY recorded_at ASC
            """,
            (sid,),
        ).fetchall()

        cash, portfolio_value, total_value = compute_student_totals(conn, sid)
        now_iso = utc_now()
        record_snapshot(
            conn,
            sid,
            cash=cash,
            portfolio_value=portfolio_value,
            total_value=total_value,
            recorded_at=now_iso,
        )
        snaps = conn.execute(
            """
            SELECT recorded_at, total_value, cash, portfolio_value
            FROM portfolio_snapshots
            WHERE student_id = ?
            ORDER BY recorded_at ASC
            """,
            (sid,),
        ).fetchall()

    snap_dicts = [
        {
            "recorded_at": s["recorded_at"],
            "total_value": s["total_value"],
            "cash": s["cash"],
            "portfolio_value": s["portfolio_value"],
        }
        for s in snaps
    ]
    return jsonify(
        build_history_payload(sid, snap_dicts, baseline=STARTING_BALANCE, utc_now_fn=utc_now)
    )


CHART_RANGES = {
    # period/interval for yfinance (Finnhub free tier blocks /stock/candle).
    "1mo": {"period": "1mo", "interval": "1d"},
    "3mo": {"period": "3mo", "interval": "1d"},
    "6mo": {"period": "6mo", "interval": "1d"},
    "1y": {"period": "1y", "interval": "1d"},
    "5y": {"period": "5y", "interval": "1wk"},
}

_chart_cache: dict[str, tuple[float, dict]] = {}
CHART_CACHE_TTL = 60 * 60 * 24  # 24 hours — classroom charts don't need minute-fresh history


def _load_disk_charts() -> None:
    if not CHART_CACHE_PATH.exists():
        return
    try:
        data = json.loads(CHART_CACHE_PATH.read_text())
        now = datetime.now(timezone.utc).timestamp()
        for key, body in data.items():
            _chart_cache[key] = (now, body)
    except Exception:
        pass


def _save_disk_charts() -> None:
    try:
        payload = {key: body for key, (_ts, body) in _chart_cache.items()}
        CHART_CACHE_PATH.write_text(json.dumps(payload))
    except Exception:
        pass


_load_disk_charts()


def yahoo_chart_symbol(local_ticker: str) -> str:
    return yahoo_quote_symbol(local_ticker)


def _fetch_chart_body(symbol: str, span: str) -> tuple[dict | None, str | None]:
    """
    Historical series for the price chart.
    Finnhub free accounts cannot call /stock/candle (403), so we use yfinance
    for on-demand charts only. Live quotes still come from Finnhub.
    """
    cfg = CHART_RANGES[span]
    yahoo_symbol = yahoo_chart_symbol(symbol)
    cur_meta = CURRENCY_BY_TICKER.get(symbol)

    try:
        import yfinance as yf

        hist = yf.Ticker(yahoo_symbol).history(
            period=cfg["period"],
            interval=cfg["interval"],
            auto_adjust=True,
        )
    except Exception as exc:
        return None, str(exc)

    if hist is None or getattr(hist, "empty", True) or "Close" not in getattr(hist, "columns", []):
        return None, f"No chart data for {symbol}"

    points = []
    for idx, row in hist.iterrows():
        close = row.get("Close")
        if close is None:
            continue
        try:
            value = float(close)
        except (TypeError, ValueError):
            continue
        if cur_meta:
            value = currency_usd_price(value, cur_meta)
        if hasattr(idx, "timestamp"):
            ts = int(idx.timestamp())
            date_str = idx.strftime("%Y-%m-%d")
        else:
            continue
        points.append(
            {
                "t": ts,
                "date": date_str,
                "close": round(value, 4 if cur_meta else 2),
            }
        )

    if not points:
        return None, f"No price points for {symbol}"

    first = points[0]["close"]
    last = points[-1]["close"]
    change_pct = ((last - first) / first) * 100 if first else None
    body = {
        "ticker": symbol,
        "range": span,
        "interval": cfg["interval"],
        "points": points,
        "start": first,
        "end": last,
        "change_pct": round(change_pct, 2) if change_pct is not None else None,
        "source": "yfinance",
    }
    return body, None


def warm_chart_cache(symbols: list[str] | None = None, span: str = "1y") -> dict:
    """Slowly fill disk chart cache so classroom browsing doesn't hammer live APIs."""
    import time as _time

    if span not in CHART_RANGES:
        span = "1y"
    if symbols is None:
        symbols = []
        for cat, rows in MARKET_CATALOG.items():
            if cat == "bonds":
                continue
            symbols.extend(r["ticker"] for r in rows)
    saved = 0
    failed = []
    for symbol in symbols:
        cache_key = f"{symbol}:{span}"
        cached = _chart_cache.get(cache_key)
        now = datetime.now(timezone.utc).timestamp()
        if cached and now - cached[0] < CHART_CACHE_TTL:
            continue
        body, err = _fetch_chart_body(symbol, span)
        if body:
            _chart_cache[cache_key] = (now, body)
            saved += 1
            _save_disk_charts()
        else:
            failed.append({"ticker": symbol, "error": err})
        _time.sleep(1.25)
    return {"saved": saved, "failed": failed, "cached": len(_chart_cache)}


@app.get("/api/chart/<ticker>")
def chart(ticker: str):
    symbol = ticker.strip().upper()
    span = (request.args.get("range") or "1y").strip().lower()
    if span not in CHART_RANGES:
        return jsonify({"error": "range must be one of: 1mo, 3mo, 6mo, 1y, 5y"}), 400

    cache_key = f"{symbol}:{span}"
    now = datetime.now(timezone.utc).timestamp()
    cached = _chart_cache.get(cache_key)

    def _stale_chart_response():
        if cached:
            return jsonify(cached[1])
        _load_disk_charts()
        disk = _chart_cache.get(cache_key)
        if disk:
            return jsonify(disk[1])
        for key, (_ts, body) in _chart_cache.items():
            if key.startswith(f"{symbol}:") and body.get("points"):
                return jsonify(body)
        return None

    if cached and now - cached[0] < CHART_CACHE_TTL:
        return jsonify(cached[1])

    body, err = _fetch_chart_body(symbol, span)
    if body:
        _chart_cache[cache_key] = (now, body)
        _save_disk_charts()
        return jsonify(body)

    stale = _stale_chart_response()
    if stale is not None:
        return stale

    friendly = err or f"Could not load chart for {symbol}"
    if err and ("Rate limited" in err or "Too Many" in err):
        friendly = "Chart provider is busy — try again in a minute, or open a ticker you viewed earlier."
    elif err and ("403" in err or "Tunnel" in err or "ProxyError" in err or "access" in err.lower()):
        friendly = "Couldn’t reach the chart data provider right now. Try again in a moment."
    elif err and ("delisted" in err.lower() or "No chart data" in err or "No price points" in err):
        friendly = f"No historical chart data available for {symbol} right now."
    return jsonify({"error": friendly}), 503


@app.post("/api/charts/warm")
def warm_charts():
    """Optional admin helper: prefetch 1y charts into local cache."""
    result = warm_chart_cache(span="1y")
    return jsonify(result)


@app.post("/api/students/<student_id>/buy-home")
def buy_home(student_id: str):
    """Purchase one Florida classroom home: pay down payment + closing; carry a mortgage."""
    data = request.get_json(silent=True) or {}
    ticker = (data.get("ticker") or "").strip().upper()
    if not ticker:
        return jsonify({"error": "Ticker is required"}), 400
    home = REALESTATE_BY_TICKER.get(ticker)
    if not home:
        return jsonify({"error": "Unknown real estate market"}), 404

    costs = home_purchase_costs(home)
    due_today = costs["due_today"]

    class_id, err = require_firestore_class_id()
    if err:
        return err
    if using_firestore():
        student = fs_ledger.get_student(class_id, student_id)
        if not student:
            return jsonify({"error": "Student not found"}), 404
        cash = float(student["cash"])
        if due_today > cash + 1e-9:
            return jsonify(
                {
                    "error": (
                        f"Not enough cash for the upfront cost. "
                        f"Need ${due_today:,.2f} today, have ${cash:,.2f}."
                    )
                }
            ), 400
        if fs_ledger.get_holding(class_id, student_id, ticker):
            return jsonify({"error": f"You already own a home in {home['name']}."}), 400
        settled_month = housing_settlement.iso_month(
            housing_settlement.month_start(datetime.now(timezone.utc).date())
        )
        fs_ledger.upsert_holding(
            class_id,
            student_id,
            {
                "ticker": ticker,
                "shares": 1,
                "avg_cost": costs["price"],
                "mortgage_balance": costs["loan_amount"],
                "mortgage_rate_pct": costs["mortgage_rate_pct"],
                "loan_years": costs["loan_years"],
                "closing_paid": costs["closing_costs"],
                "monthly_rent": float(home.get("monthly_rent") or 0),
                "monthly_payment": costs["est_monthly_payment"],
                "last_rent_settled": settled_month,
            },
        )
        holdings = fs_ledger.list_holdings(class_id, student_id)
        fs_ledger.set_cash(class_id, student_id, cash - due_today, holdings_count=len(holdings))
        student["cash"] = cash - due_today
        payload = serialize_portfolio(
            student,
            holdings,
            with_portfolio=True,
            realestate_by_ticker=REALESTATE_BY_TICKER,
            fetch_quotes_batch=fetch_quotes_batch,
        )
        record_fs_snapshot(
            class_id,
            student_id,
            student,
            holdings,
            fetch_quotes_batch,
            cash=payload["cash"],
            portfolio_value=payload["portfolio_value"] or 0,
            total_value=payload["total_value"],
        )
        try:
            fs_ledger.record_trade(
                class_id,
                student_id,
                side="buy",
                ticker=ticker,
                shares=1,
                price=costs["price"],
                notional=due_today,
                kind="home",
                student_name=student.get("name"),
                extra={
                    "loanAmount": costs["loan_amount"],
                    "downPayment": costs.get("down_payment"),
                    "closingCosts": costs["closing_costs"],
                },
            )
        except Exception:
            pass
        return jsonify(payload)

    try:
        sid = int(student_id)
    except ValueError:
        return jsonify({"error": "Student not found"}), 404
    with get_db() as conn:
        row = student_row(conn, sid)
        if not row:
            return jsonify({"error": "Student not found"}), 404
        cash = float(row["cash"])
        if due_today > cash + 1e-9:
            return jsonify(
                {
                    "error": (
                        f"Not enough cash for the upfront cost. "
                        f"Need ${due_today:,.2f} today, have ${cash:,.2f}."
                    )
                }
            ), 400

        existing = conn.execute(
            "SELECT id FROM holdings WHERE student_id = ? AND ticker = ?",
            (sid, ticker),
        ).fetchone()
        if existing:
            return jsonify({"error": f"You already own a home in {home['name']}."}), 400

        conn.execute(
            """
            INSERT INTO holdings (
                student_id, ticker, shares, avg_cost,
                mortgage_balance, mortgage_rate_pct, loan_years, closing_paid,
                monthly_rent, monthly_payment, last_rent_settled
            ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sid,
                ticker,
                costs["price"],
                costs["loan_amount"],
                costs["mortgage_rate_pct"],
                costs["loan_years"],
                costs["closing_costs"],
                float(home.get("monthly_rent") or 0),
                costs["est_monthly_payment"],
                housing_settlement.iso_month(
                    housing_settlement.month_start(datetime.now(timezone.utc).date())
                ),
            ),
        )
        conn.execute(
            "UPDATE students SET cash = ? WHERE id = ?",
            (cash - due_today, sid),
        )
        updated = student_row(conn, sid)
        payload = serialize_student(conn, updated, with_portfolio=True)
        record_snapshot(
            conn,
            sid,
            cash=payload["cash"],
            portfolio_value=payload["portfolio_value"] or 0,
            total_value=payload["total_value"],
        )
        return jsonify(payload)


@app.post("/api/students/<student_id>/buy")
def buy_shares(student_id: str):
    data = request.get_json(silent=True) or {}
    ticker = (data.get("ticker") or "").strip().upper()
    if ticker in REALESTATE_BY_TICKER:
        return buy_home(student_id)
    try:
        shares = float(data.get("shares") or 0)
    except (TypeError, ValueError):
        return jsonify({"error": "Valid share count is required"}), 400

    if not ticker:
        return jsonify({"error": "Ticker is required"}), 400
    if shares <= 0:
        return jsonify({"error": "Shares must be greater than 0"}), 400

    allowed = {
        item["ticker"]
        for cat, rows in MARKET_CATALOG.items()
        if cat not in {"bonds", "realestate"}
        for item in rows
    }
    allowed |= class_extra_market_tickers()
    if ticker not in allowed and ticker not in BOND_BY_TICKER:
        return jsonify({"error": f"{ticker} is not on the classroom market list"}), 400

    price = fetch_quote(ticker)
    if price is None:
        return jsonify({"error": f"Could not find a live price for {ticker}"}), 404
    if price <= 0:
        return jsonify({"error": f"Invalid price for {ticker}"}), 400
    if ticker in COMMODITY_BY_TICKER and not commodity_buy_allowed(ticker):
        return (
            jsonify(
                {
                    "error": (
                        "No usable commodity price right now. "
                        "Try again in a moment — selling still works."
                    )
                }
            ),
            503,
        )

    cost = price * shares
    class_id, err = require_firestore_class_id()
    if err:
        return err
    if using_firestore():
        student = fs_ledger.get_student(class_id, student_id)
        if not student:
            return jsonify({"error": "Student not found"}), 404
        cash = float(student["cash"])
        if cost > cash:
            return jsonify({"error": f"Not enough cash. Need ${cost:.2f}, have ${cash:.2f}"}), 400
        existing = fs_ledger.get_holding(class_id, student_id, ticker)
        if existing:
            old_shares = float(existing["shares"])
            old_cost = float(existing["avg_cost"])
            new_shares = old_shares + shares
            new_avg = ((old_shares * old_cost) + cost) / new_shares
            fs_ledger.upsert_holding(
                class_id,
                student_id,
                {
                    "ticker": ticker,
                    "shares": new_shares,
                    "avg_cost": new_avg,
                    "mortgage_balance": existing.get("mortgage_balance") or 0,
                    "mortgage_rate_pct": existing.get("mortgage_rate_pct"),
                    "loan_years": existing.get("loan_years"),
                    "closing_paid": existing.get("closing_paid") or 0,
                },
            )
        else:
            fs_ledger.upsert_holding(
                class_id,
                student_id,
                {
                    "ticker": ticker,
                    "shares": shares,
                    "avg_cost": price,
                    "mortgage_balance": 0,
                    "mortgage_rate_pct": None,
                    "loan_years": None,
                    "closing_paid": 0,
                },
            )
        holdings = fs_ledger.list_holdings(class_id, student_id)
        fs_ledger.set_cash(class_id, student_id, cash - cost, holdings_count=len(holdings))
        student["cash"] = cash - cost
        stock_names = {item["ticker"]: item["name"] for item in MARKET_CATALOG.get("stocks", [])}
        if ticker in stock_names:
            try:
                cached = fs_ledger.get_popular_stocks(class_id)
                if cached is None:
                    fs_ledger.rebuild_popular_stocks(class_id, stock_names)
                else:
                    fs_ledger.adjust_popular_stock(
                        class_id,
                        ticker,
                        name=stock_names[ticker],
                        holders_delta=0 if existing else 1,
                        shares_delta=shares,
                    )
            except Exception:
                pass
        payload = serialize_portfolio(
            student,
            holdings,
            with_portfolio=True,
            realestate_by_ticker=REALESTATE_BY_TICKER,
            fetch_quotes_batch=fetch_quotes_batch,
        )
        record_fs_snapshot(
            class_id,
            student_id,
            student,
            holdings,
            fetch_quotes_batch,
            cash=payload["cash"],
            portfolio_value=payload["portfolio_value"] or 0,
            total_value=payload["total_value"],
        )
        try:
            fs_ledger.record_trade(
                class_id,
                student_id,
                side="buy",
                ticker=ticker,
                shares=shares,
                price=price,
                notional=cost,
                kind="bond" if ticker in BOND_BY_TICKER else "market",
                student_name=student.get("name"),
            )
        except Exception:
            pass
        return jsonify(payload)

    try:
        sid = int(student_id)
    except ValueError:
        return jsonify({"error": "Student not found"}), 404
    with get_db() as conn:
        row = student_row(conn, sid)
        if not row:
            return jsonify({"error": "Student not found"}), 404
        cash = float(row["cash"])
        if cost > cash:
            return jsonify({"error": f"Not enough cash. Need ${cost:.2f}, have ${cash:.2f}"}), 400

        existing = conn.execute(
            "SELECT shares, avg_cost FROM holdings WHERE student_id = ? AND ticker = ?",
            (sid, ticker),
        ).fetchone()

        if existing:
            old_shares = float(existing["shares"])
            old_cost = float(existing["avg_cost"])
            new_shares = old_shares + shares
            new_avg = ((old_shares * old_cost) + cost) / new_shares
            conn.execute(
                "UPDATE holdings SET shares = ?, avg_cost = ? WHERE student_id = ? AND ticker = ?",
                (new_shares, new_avg, sid, ticker),
            )
        else:
            conn.execute(
                "INSERT INTO holdings (student_id, ticker, shares, avg_cost) VALUES (?, ?, ?, ?)",
                (sid, ticker, shares, price),
            )

        conn.execute("UPDATE students SET cash = ? WHERE id = ?", (cash - cost, sid))
        updated = student_row(conn, sid)
        payload = serialize_student(conn, updated, with_portfolio=True)
        record_snapshot(
            conn,
            sid,
            cash=payload["cash"],
            portfolio_value=payload["portfolio_value"] or 0,
            total_value=payload["total_value"],
        )
        return jsonify(payload)


@app.post("/api/students/<student_id>/sell")
def sell_shares(student_id: str):
    data = request.get_json(silent=True) or {}
    ticker = (data.get("ticker") or "").strip().upper()
    try:
        shares = float(data.get("shares") or 0)
    except (TypeError, ValueError):
        return jsonify({"error": "Valid share count is required"}), 400

    if not ticker:
        return jsonify({"error": "Ticker is required"}), 400
    if shares <= 0:
        return jsonify({"error": "Shares must be greater than 0"}), 400

    price = fetch_quote(ticker)
    if price is None:
        return jsonify({"error": f"Could not find a live price for {ticker}"}), 404

    class_id, err = require_firestore_class_id()
    if err:
        return err
    if using_firestore():
        student = fs_ledger.get_student(class_id, student_id)
        if not student:
            return jsonify({"error": "Student not found"}), 404
        existing = fs_ledger.get_holding(class_id, student_id, ticker)
        if not existing:
            return jsonify({"error": f"No {ticker} shares to sell"}), 400
        owned = float(existing["shares"])
        mortgage_balance = float(existing.get("mortgage_balance") or 0)
        is_home = ticker in REALESTATE_BY_TICKER
        if is_home:
            if abs(shares - owned) > 1e-9 and shares < owned - 1e-9:
                return jsonify({"error": "Sell the whole home (use Sell all)."}), 400
            shares = owned
            proceeds = price * shares - mortgage_balance
            if proceeds < 0:
                return jsonify(
                    {"error": "Home value is below the mortgage — cannot sell for cash yet."}
                ), 400
        else:
            proceeds = price * shares
            if shares > owned + 1e-9:
                return jsonify({"error": f"Only own {owned:.4f} shares of {ticker}"}), 400
        remaining = owned - shares
        if remaining < 1e-9:
            fs_ledger.delete_holding(class_id, student_id, ticker)
        else:
            fs_ledger.upsert_holding(
                class_id,
                student_id,
                {
                    **existing,
                    "shares": remaining,
                },
            )
        holdings = fs_ledger.list_holdings(class_id, student_id)
        new_cash = float(student["cash"]) + proceeds
        fs_ledger.set_cash(class_id, student_id, new_cash, holdings_count=len(holdings))
        student["cash"] = new_cash
        stock_names = {item["ticker"]: item["name"] for item in MARKET_CATALOG.get("stocks", [])}
        if ticker in stock_names:
            try:
                cached = fs_ledger.get_popular_stocks(class_id)
                if cached is None:
                    fs_ledger.rebuild_popular_stocks(class_id, stock_names)
                else:
                    sold_all = remaining < 1e-9
                    fs_ledger.adjust_popular_stock(
                        class_id,
                        ticker,
                        name=stock_names[ticker],
                        holders_delta=-1 if sold_all else 0,
                        shares_delta=-shares,
                    )
            except Exception:
                pass
        payload = serialize_portfolio(
            student,
            holdings,
            with_portfolio=True,
            realestate_by_ticker=REALESTATE_BY_TICKER,
            fetch_quotes_batch=fetch_quotes_batch,
        )
        record_fs_snapshot(
            class_id,
            student_id,
            student,
            holdings,
            fetch_quotes_batch,
            cash=payload["cash"],
            portfolio_value=payload["portfolio_value"] or 0,
            total_value=payload["total_value"],
        )
        try:
            fs_ledger.record_trade(
                class_id,
                student_id,
                side="sell",
                ticker=ticker,
                shares=shares,
                price=price,
                notional=proceeds,
                kind="home" if is_home else (
                    "bond" if ticker in BOND_BY_TICKER else "market"
                ),
                student_name=student.get("name"),
                extra={"mortgagePayoff": mortgage_balance} if is_home else None,
            )
        except Exception:
            pass
        return jsonify(payload)

    try:
        sid = int(student_id)
    except ValueError:
        return jsonify({"error": "Student not found"}), 404
    with get_db() as conn:
        row = student_row(conn, sid)
        if not row:
            return jsonify({"error": "Student not found"}), 404

        existing = conn.execute(
            """
            SELECT shares, COALESCE(mortgage_balance, 0) AS mortgage_balance
            FROM holdings WHERE student_id = ? AND ticker = ?
            """,
            (sid, ticker),
        ).fetchone()
        if not existing:
            return jsonify({"error": f"No {ticker} shares to sell"}), 400

        owned = float(existing["shares"])
        mortgage_balance = float(existing["mortgage_balance"] or 0)
        is_home = ticker in REALESTATE_BY_TICKER

        if is_home:
            if abs(shares - owned) > 1e-9 and shares < owned - 1e-9:
                return jsonify({"error": "Sell the whole home (use Sell all)."}), 400
            shares = owned
            proceeds = price * shares - mortgage_balance
            if proceeds < 0:
                return jsonify(
                    {"error": "Home value is below the mortgage — cannot sell for cash yet."}
                ), 400
        else:
            proceeds = price * shares
            if shares > owned + 1e-9:
                return jsonify({"error": f"Only own {owned:.4f} shares of {ticker}"}), 400

        remaining = owned - shares
        if remaining < 1e-9:
            conn.execute(
                "DELETE FROM holdings WHERE student_id = ? AND ticker = ?",
                (sid, ticker),
            )
        else:
            conn.execute(
                "UPDATE holdings SET shares = ? WHERE student_id = ? AND ticker = ?",
                (remaining, sid, ticker),
            )

        cash = float(row["cash"]) + proceeds
        conn.execute("UPDATE students SET cash = ? WHERE id = ?", (cash, sid))
        updated = student_row(conn, sid)
        payload = serialize_student(conn, updated, with_portfolio=True)
        record_snapshot(
            conn,
            sid,
            cash=payload["cash"],
            portfolio_value=payload["portfolio_value"] or 0,
            total_value=payload["total_value"],
        )
        return jsonify(payload)


# --- Market news (free public RSS — no API key) ---------------------------------

NEWS_FEEDS = [
    {
        "source": "Yahoo Finance",
        "url": "https://finance.yahoo.com/news/rssindex",
    },
    {
        "source": "MarketWatch",
        "url": "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    },
    {
        "source": "CNBC",
        "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664",
    },
]
NEWS_CACHE_TTL = 60 * 15  # 15 minutes
_news_cache: tuple[float, list[dict]] | None = None


def _strip_html(text: str) -> str:
    import re

    cleaned = re.sub(r"<[^>]+>", " ", text or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _parse_rss_items(xml_bytes: bytes, source: str) -> list[dict]:
    from email.utils import parsedate_to_datetime
    from xml.etree import ElementTree as ET

    root = ET.fromstring(xml_bytes)
    items = []
    for node in root.findall(".//item"):
        title = _strip_html(node.findtext("title") or "")
        link = (node.findtext("link") or "").strip()
        if not title or not link:
            continue
        summary = _strip_html(node.findtext("description") or "")
        if summary.startswith(title):
            summary = summary[len(title) :].strip(" -–—|")
        if len(summary) > 180:
            summary = summary[:177].rstrip() + "…"
        pub_raw = node.findtext("pubDate") or node.findtext("published") or ""
        published_at = None
        if pub_raw:
            try:
                published_at = parsedate_to_datetime(pub_raw).astimezone(timezone.utc).isoformat()
            except Exception:
                try:
                    # Yahoo sometimes uses ISO-8601.
                    published_at = datetime.fromisoformat(pub_raw.replace("Z", "+00:00")).astimezone(
                        timezone.utc
                    ).isoformat()
                except Exception:
                    published_at = None
        items.append(
            {
                "id": f"{source}:{link}",
                "title": title,
                "url": link,
                "source": source,
                "summary": summary or None,
                "published_at": published_at,
            }
        )
    return items


def fetch_market_news(limit: int = 25, force_refresh: bool = False) -> list[dict]:
    global _news_cache
    now = datetime.now(timezone.utc).timestamp()

    if (
        not force_refresh
        and _news_cache
        and now - _news_cache[0] < NEWS_CACHE_TTL
        and _news_cache[1]
    ):
        return _news_cache[1][:limit]

    stale_items: list[dict] = []
    if NEWS_CACHE_PATH.exists():
        try:
            disk = json.loads(NEWS_CACHE_PATH.read_text())
            fetched_at = float(disk.get("fetched_at") or 0)
            items = disk.get("items") or []
            if (
                not force_refresh
                and items
                and now - fetched_at < NEWS_CACHE_TTL
            ):
                _news_cache = (fetched_at, items)
                return items[:limit]
            stale_items = items
        except Exception:
            stale_items = []

    collected: list[dict] = []
    seen_titles: set[str] = set()
    for feed in NEWS_FEEDS:
        try:
            res = requests.get(feed["url"], headers=HTTP_HEADERS, timeout=12)
            if res.status_code != 200:
                continue
            for item in _parse_rss_items(res.content, feed["source"]):
                key = item["title"].lower().strip()
                if key in seen_titles:
                    continue
                seen_titles.add(key)
                collected.append(item)
        except Exception:
            continue

    collected.sort(
        key=lambda row: row.get("published_at") or "",
        reverse=True,
    )
    if not collected and stale_items:
        collected = stale_items

    if collected:
        _news_cache = (now, collected)
        try:
            NEWS_CACHE_PATH.write_text(
                json.dumps({"fetched_at": now, "items": collected[:40]}, indent=2)
            )
        except Exception:
            pass

    return collected[:limit]


@app.get("/api/news")
def market_news():
    from classroom_news import build_classroom_news

    force = request.args.get("refresh") == "1"
    raw = fetch_market_news(limit=40, force_refresh=force)
    if not raw:
        return jsonify({"error": "Could not load market news right now"}), 502

    stories = build_classroom_news(
        raw,
        MARKET_CATALOG,
        cache_path=CLASSROOM_NEWS_CACHE_PATH,
        limit=8,
        force_refresh=force,
    )
    if not stories:
        return jsonify({"error": "Could not build classroom news right now"}), 502

    return jsonify(
        {
            "items": stories,
            "count": len(stories),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "mode": "classroom",
            "disclaimer": "Written for Ledger Lab from public market headlines.",
        }
    )


# --- Closet AI creator (any enrolled class student) ---


@app.get("/api/closet/ai/status")
def closet_ai_status():
    class_id, err = require_firestore_class_id()
    if err:
        return err
    student_id = (request.args.get("studentId") or "").strip()
    if not student_id:
        return jsonify({"error": "studentId is required"}), 400
    try:
        import closet_ai

        return jsonify(closet_ai.creator_status(class_id, student_id))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/closet/ai/draft")
def closet_ai_draft():
    class_id, err = require_firestore_class_id()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    student_id = (data.get("studentId") or "").strip()
    prompt = data.get("prompt") or ""
    product_name = data.get("productName") or data.get("product_name")
    primary_color = data.get("primaryColor") or data.get("primary_color")
    secondary_color = data.get("secondaryColor") or data.get("secondary_color")
    tertiary_color = data.get("tertiaryColor") or data.get("tertiary_color")
    quaternary_color = data.get("quaternaryColor") or data.get("quaternary_color")
    kind = data.get("kind")
    style = data.get("style")
    try:
        import closet_ai

        job = closet_ai.start_draft(
            class_id,
            student_id,
            prompt,
            product_name=product_name,
            primary_color=primary_color,
            secondary_color=secondary_color,
            tertiary_color=tertiary_color,
            quaternary_color=quaternary_color,
            kind=kind,
            style=style,
        )
        return jsonify({"job": job})
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/closet/ai/redo")
def closet_ai_redo():
    class_id, err = require_firestore_class_id()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    student_id = (data.get("studentId") or "").strip()
    job_id = (data.get("jobId") or "").strip()
    prompt = data.get("prompt")
    try:
        import closet_ai

        result = closet_ai.redo_draft(
            class_id,
            student_id,
            job_id,
            prompt=prompt,
        )
        return jsonify(result)
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.get("/api/closet/ai/jobs/<job_id>")
def closet_ai_job(job_id: str):
    class_id, err = require_firestore_class_id()
    if err:
        return err
    student_id = (request.args.get("studentId") or "").strip()
    if not student_id:
        return jsonify({"error": "studentId is required"}), 400
    try:
        import closet_ai

        job = closet_ai.advance_job(class_id, student_id, job_id)
        return jsonify({"job": job})
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/closet/ai/publish")
def closet_ai_publish():
    class_id, err = require_firestore_class_id()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    student_id = (data.get("studentId") or "").strip()
    job_id = (data.get("jobId") or "").strip()
    if not job_id:
        return jsonify({"error": "jobId is required"}), 400
    price = data.get("price", None)
    crew_slots = data.get("crewSlots", data.get("crew_slots", 0))
    try:
        import closet_ai

        result = closet_ai.publish_job(
            class_id, student_id, job_id, price=price, crew_slots=crew_slots
        )
        return jsonify(result)
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.get("/api/closet/crew/jobs")
def closet_crew_jobs():
    class_id, err = require_firestore_class_id()
    if err:
        return err
    student_id = (request.args.get("studentId") or "").strip() or None
    try:
        import closet_ai

        return jsonify(closet_ai.list_crew_jobs(class_id, student_id))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/closet/crew/invite")
def closet_crew_invite():
    """Partnership: creator invites one classmate (right after choosing Partnership)."""
    class_id, err = require_firestore_class_id()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    student_id = (data.get("studentId") or "").strip()
    crew_job_id = (data.get("crewJobId") or data.get("jobId") or "").strip()
    partner_id = (data.get("partnerId") or data.get("invitedStudentId") or "").strip()
    if not student_id or not partner_id:
        return jsonify({"error": "studentId and partnerId are required"}), 400
    try:
        import closet_ai

        return jsonify(
            closet_ai.invite_crew_partner(class_id, student_id, crew_job_id, partner_id)
        )
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/closet/crew/decline")
def closet_crew_decline():
    class_id, err = require_firestore_class_id()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    student_id = (data.get("studentId") or "").strip()
    crew_job_id = (data.get("crewJobId") or data.get("jobId") or "").strip()
    if not student_id or not crew_job_id:
        return jsonify({"error": "studentId and crewJobId are required"}), 400
    try:
        import closet_ai

        return jsonify(closet_ai.decline_crew_invite(class_id, student_id, crew_job_id))
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/closet/crew/join")
def closet_crew_join():
    class_id, err = require_firestore_class_id()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    student_id = (data.get("studentId") or "").strip()
    crew_job_id = (data.get("crewJobId") or data.get("jobId") or "").strip()
    if not student_id or not crew_job_id:
        return jsonify({"error": "studentId and crewJobId are required"}), 400
    try:
        import closet_ai

        return jsonify(closet_ai.join_crew_job(class_id, student_id, crew_job_id))
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/closet/crew/leave")
def closet_crew_leave():
    class_id, err = require_firestore_class_id()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    student_id = (data.get("studentId") or "").strip()
    crew_job_id = (data.get("crewJobId") or data.get("jobId") or "").strip()
    if not student_id or not crew_job_id:
        return jsonify({"error": "studentId and crewJobId are required"}), 400
    try:
        import closet_ai

        return jsonify(closet_ai.leave_crew_job(class_id, student_id, crew_job_id))
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/closet/ai/activate")
def closet_ai_activate():
    """After publish: quiz answers go to teacher review (payroll on approve)."""
    class_id, err = require_firestore_class_id()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    student_id = (data.get("studentId") or "").strip()
    job_id = (data.get("jobId") or "").strip()
    answers = data.get("answers")
    if not job_id:
        return jsonify({"error": "jobId is required"}), 400
    try:
        import closet_ai

        result = closet_ai.submit_quiz_for_review(
            class_id, student_id, job_id, answers=answers
        )
        return jsonify(result)
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/closet/ai/test-review")
def closet_ai_test_review():
    """Dev-only fake pending_review seed — disabled in production flows."""
    return jsonify({"error": "Test review seeding is disabled"}), 404


@app.get("/api/closet/ai/reviews")
def closet_ai_reviews():
    class_id, err = require_firestore_class_id()
    if err:
        return err
    teacher_uid = (request.args.get("teacherUid") or "").strip()
    try:
        import closet_ai

        return jsonify(closet_ai.list_pending_reviews(class_id, teacher_uid))
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/closet/ai/review")
def closet_ai_review():
    class_id, err = require_firestore_class_id()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    teacher_uid = (data.get("teacherUid") or "").strip()
    job_id = (data.get("jobId") or "").strip()
    action = data.get("action")
    note = data.get("note")
    if not job_id:
        return jsonify({"error": "jobId is required"}), 400
    try:
        import closet_ai

        result = closet_ai.review_submission(
            class_id, teacher_uid, job_id, action=action, note=note
        )
        return jsonify(result)
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)

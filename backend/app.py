"""Classroom financial tracker API — roster, balances, and live stock portfolios."""

from __future__ import annotations

import json
import os
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env")
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "classroom.db"
QUOTE_CACHE_PATH = BASE_DIR / "quote_cache.json"
CHART_CACHE_PATH = BASE_DIR / "chart_cache.json"
NEWS_CACHE_PATH = BASE_DIR / "news_cache.json"
CLASSROOM_NEWS_CACHE_PATH = BASE_DIR / "classroom_news_cache.json"
TREASURY_CACHE_PATH = BASE_DIR / "treasury_yields_cache.json"

app = Flask(__name__)
CORS(app)

# In-memory quote cache: ticker -> (price, fetched_at, change_pct)
_quote_cache: dict[str, tuple[float, float, float | None]] = {}
_category_cache: dict[str, tuple[float, list[dict]]] = {}
CACHE_TTL_SECONDS = 120
STALE_OK_SECONDS = 60 * 60 * 24

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


def _finnhub_on_cooldown() -> bool:
    return time.time() < _finnhub_cooldown_until


def _trip_finnhub_cooldown() -> None:
    global _finnhub_cooldown_until
    _finnhub_cooldown_until = time.time() + FINNHUB_COOLDOWN_SECONDS


def finnhub_configured() -> bool:
    return bool(FINNHUB_API_KEY)


# Curated classroom menus. Stocks/ETFs/commodities/currencies use Finnhub;
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
    # Commodity exposure via liquid ETFs that track physical/futures markets.
    # Live Finnhub prices (same path as stocks/ETFs).
    "commodities": [
        {
            "ticker": "GLD",
            "name": "Gold",
            "kind": "Precious metal",
            "info": {
                "summary": "Gold is a rare yellow precious metal that resists rust and corrosion. It is used in jewelry, electronics, and as a store of value by investors and central banks. Most newly mined gold comes from China, Australia, Russia, Canada, and the United States.",
            },
        },
        {
            "ticker": "SLV",
            "name": "Silver",
            "kind": "Precious metal",
            "info": {
                "summary": "Silver is a soft white precious metal and an excellent conductor of electricity. It is used in jewelry, electronics, and solar panels. Top mine producers include Mexico, China, and Peru, often as a byproduct of other metal ores.",
            },
        },
        {
            "ticker": "PPLT",
            "name": "Platinum",
            "kind": "Precious metal",
            "info": {
                "summary": "Platinum is a rare silvery-white precious metal. It is mainly used in car catalytic converters, jewelry, and industrial catalysts. Most of the world’s supply is mined in South Africa, with more from Russia and Zimbabwe.",
            },
        },
        {
            "ticker": "USO",
            "name": "Crude Oil",
            "kind": "Energy",
            "info": {
                "summary": "Crude oil is a liquid fossil fuel found in underground rock reservoirs. It is refined into gasoline, diesel, jet fuel, and materials for plastics. Major producers include the United States, Saudi Arabia, Russia, and Canada.",
            },
        },
        {
            "ticker": "UNG",
            "name": "Natural Gas",
            "kind": "Energy",
            "info": {
                "summary": "Natural gas is mostly methane and is often found with oil or in separate gas fields. It powers electricity plants, heats buildings, and feeds fertilizer and chemical industries. Leading producers include the United States, Russia, Iran, and Qatar.",
            },
        },
        {
            "ticker": "CPER",
            "name": "Copper",
            "kind": "Industrial metal",
            "info": {
                "summary": "Copper is a reddish industrial metal prized for carrying electricity well. It is used in wiring, electronics, construction, and electric vehicles. Chile is the top mine producer, followed by Peru, the DRC, China, and the United States.",
            },
        },
        {
            "ticker": "DBA",
            "name": "Agriculture Basket",
            "kind": "Agriculture",
            "info": {
                "summary": "This is not one crop — it tracks a mix of farm commodities such as grains and softs. Those goods feed people and livestock around the world. Major farm exporters include the United States, Brazil, Argentina, and India.",
            },
        },
        {
            "ticker": "CORN",
            "name": "Corn",
            "kind": "Agriculture",
            "info": {
                "summary": "Corn (maize) is a cereal grain grown widely for food and feed. It is also used for ethanol fuel and sweeteners. Top producers include the United States, China, Brazil, and Argentina.",
            },
        },
        {
            "ticker": "WEAT",
            "name": "Wheat",
            "kind": "Agriculture",
            "info": {
                "summary": "Wheat is a staple cereal grain used to make bread, pasta, and flour. It grows best in temperate grasslands. Major producers include China, India, Russia, the United States, and Canada.",
            },
        },
        {
            "ticker": "CANE",
            "name": "Sugar",
            "kind": "Agriculture",
            "info": {
                "summary": "Sugar comes mainly from tropical sugarcane and cooler-climate sugar beets. It sweetens food and drinks, and in Brazil cane is also made into ethanol. Brazil, India, and Thailand lead cane production.",
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
REALESTATE_BY_TICKER = {h["ticker"]: h for h in MARKET_CATALOG["realestate"]}


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


def finnhub_symbol_for(local_ticker: str) -> tuple[str, bool]:
    """Return (provider_symbol, is_forex)."""
    cur = CURRENCY_BY_TICKER.get(local_ticker)
    if cur:
        return cur["finnhub"], True
    return local_ticker, False


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


def _finnhub_quote_one(local_symbol: str) -> tuple[str, float | None, float | None]:
    provider, _is_fx = finnhub_symbol_for(local_symbol)
    payload, err = _finnhub_get("/quote", {"symbol": provider})
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

    change_pct = None
    if pct is not None and not cur_meta:
        try:
            change_pct = float(pct)
        except (TypeError, ValueError):
            change_pct = None
    if change_pct is None and prev_f:
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
    except Exception:
        pass


def _save_disk_quotes() -> None:
    payload = {
        ticker: {
            "price": price,
            "fetched_at": fetched_at,
            "change_pct": change_pct,
        }
        for ticker, (price, fetched_at, change_pct) in _quote_cache.items()
    }
    try:
        QUOTE_CACHE_PATH.write_text(json.dumps(payload, indent=2))
    except Exception:
        pass


_load_disk_quotes()


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
        for sql in migrations:
            conn.execute(sql)
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_snapshots_student_time
                ON portfolio_snapshots(student_id, recorded_at)
            """
        )


HOME_CLOSING_COST_PCT = 2.0


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
               COALESCE(closing_paid, 0) AS closing_paid
        FROM holdings
        WHERE student_id = ?
        ORDER BY ticker
    """


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


def fetch_quotes_batch(
    tickers: list[str], *, force_refresh: bool = False
) -> dict[str, tuple[float | None, float | None]]:
    """Fetch live quotes from Finnhub (with disk/memory cache)."""
    symbols = [t.strip().upper() for t in tickers if t and t.strip()]
    out: dict[str, tuple[float | None, float | None]] = {s: (None, None) for s in symbols}
    if not symbols:
        return out

    need: list[str] = []
    for symbol in symbols:
        bond = BOND_BY_TICKER.get(symbol)
        if bond:
            out[symbol] = (float(bond["price"]), None)
            continue
        home = REALESTATE_BY_TICKER.get(symbol)
        if home:
            out[symbol] = (float(home["price"]), home.get("yoy_change_pct"))
            continue
        hit = _cache_get(symbol)
        if hit[0] is not None and not force_refresh:
            out[symbol] = hit
        else:
            need.append(symbol)

    if not need:
        return out

    if not finnhub_configured() or _finnhub_on_cooldown():
        for symbol in need:
            stale = _cache_get(symbol, allow_stale=True)
            if stale[0] is not None:
                out[symbol] = stale
        return out

    now = datetime.now(timezone.utc).timestamp()
    workers = min(8, len(need))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_finnhub_quote_one, symbol) for symbol in need]
        for fut in as_completed(futures):
            try:
                local, price, change_pct = fut.result()
            except Exception:
                continue
            if price is None:
                continue
            out[local] = (price, change_pct)
            _quote_cache[local] = (price, now, change_pct)

    if any(out[s][0] is not None for s in need):
        _save_disk_quotes()

    for symbol in need:
        if out[symbol][0] is not None:
            continue
        stale = _cache_get(symbol, allow_stale=True)
        if stale[0] is not None:
            out[symbol] = stale

    return out


def fetch_quote_detail(ticker: str) -> tuple[float | None, float | None]:
    symbol = ticker.strip().upper()
    if not symbol:
        return None, None
    return fetch_quotes_batch([symbol]).get(symbol, (None, None))


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

    # Real estate: classroom city indexes with mortgage terms (no Finnhub).
    if category == "realestate":
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
        return cached_cat[1]

    _load_disk_quotes()
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
            payload.update(
                {
                    "name": home.get("name") or ticker,
                    "mortgage_balance": round(mortgage_balance, 2),
                    "mortgage_rate_pct": h["mortgage_rate_pct"],
                    "loan_years": h["loan_years"],
                    "closing_paid": round(float(h["closing_paid"] or 0), 2),
                    "equity": round(equity, 2) if equity is not None else None,
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


@app.get("/api/health")
def health():
    return jsonify({"ok": True})


@app.get("/api/students")
def list_students():
    refresh = request.args.get("refresh") == "1"
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


@app.delete("/api/students/<int:student_id>")
def delete_student(student_id: int):
    with get_db() as conn:
        existing = student_row(conn, student_id)
        if not existing:
            return jsonify({"error": "Student not found"}), 404
        conn.execute("DELETE FROM students WHERE id = ?", (student_id,))
        return jsonify({"ok": True})


@app.get("/api/students/<int:student_id>")
def get_student(student_id: int):
    with get_db() as conn:
        row = student_row(conn, student_id)
        if not row:
            return jsonify({"error": "Student not found"}), 404
        ensure_starting_snapshot(conn, row)
        payload = serialize_student(conn, row, with_portfolio=True)
        record_snapshot(
            conn,
            student_id,
            cash=payload["cash"],
            portfolio_value=payload["portfolio_value"] or 0,
            total_value=payload["total_value"],
        )
        return jsonify(payload)


@app.post("/api/students/<int:student_id>/adjust")
def adjust_cash(student_id: int):
    data = request.get_json(silent=True) or {}
    try:
        amount = float(data.get("amount"))
    except (TypeError, ValueError):
        return jsonify({"error": "Valid amount is required"}), 400

    with get_db() as conn:
        row = student_row(conn, student_id)
        if not row:
            return jsonify({"error": "Student not found"}), 404
        new_cash = float(row["cash"]) + amount
        if new_cash < 0:
            return jsonify({"error": "Balance cannot go below $0"}), 400
        conn.execute("UPDATE students SET cash = ? WHERE id = ?", (new_cash, student_id))
        cash, portfolio_value, total_value = compute_student_totals(conn, student_id)
        record_snapshot(
            conn,
            student_id,
            cash=cash,
            portfolio_value=portfolio_value,
            total_value=total_value,
        )
        updated = student_row(conn, student_id)
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


@app.get("/api/market/<category>")
def market_category(category: str):
    key = category.strip().lower()
    if key not in MARKET_CATALOG:
        return jsonify({"error": "Unknown market category"}), 404
    force = request.args.get("refresh") == "1"
    return jsonify(
        {
            "category": key,
            "items": enrich_catalog(key, force_refresh=force),
        }
    )


@app.get("/api/students/<int:student_id>/history")
def student_history(student_id: int):
    """Portfolio value over time. Today sits at the chart midpoint; right half is future."""
    with get_db() as conn:
        row = student_row(conn, student_id)
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
            (student_id,),
        ).fetchall()

        # Always include a fresh "now" point.
        cash, portfolio_value, total_value = compute_student_totals(conn, student_id)
        now_iso = utc_now()
        record_snapshot(
            conn,
            student_id,
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
            (student_id,),
        ).fetchall()

    def parse_ts(value: str) -> datetime:
        try:
            return datetime.fromisoformat(value)
        except Exception:
            return datetime.now(timezone.utc)

    points = []
    for s in snaps:
        ts = parse_ts(s["recorded_at"])
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        points.append(
            {
                "t": int(ts.timestamp()),
                "date": ts.strftime("%Y-%m-%d"),
                "label": ts.strftime("%b %d"),
                "value": round(float(s["total_value"]), 2),
                "cash": round(float(s["cash"]), 2),
                "portfolio_value": round(float(s["portfolio_value"]), 2),
                "future": False,
            }
        )

    if not points:
        now = datetime.now(timezone.utc)
        points = [
            {
                "t": int(now.timestamp()),
                "date": now.strftime("%Y-%m-%d"),
                "label": now.strftime("%b %d"),
                "value": STARTING_BALANCE,
                "cash": STARTING_BALANCE,
                "portfolio_value": 0,
                "future": False,
            }
        ]

    start_ts = points[0]["t"]
    present_ts = points[-1]["t"]
    # Keep a minimum span so a brand-new account still shows "today" at mid chart.
    min_half = 7 * 24 * 3600
    half = max(present_ts - start_ts, min_half)
    domain_start = present_ts - half
    domain_end = present_ts + half

    # Anchor left edge so the drawn history begins near the left half.
    if points[0]["t"] > domain_start:
        points.insert(
            0,
            {
                "t": domain_start,
                "date": datetime.fromtimestamp(domain_start, timezone.utc).strftime("%Y-%m-%d"),
                "label": "Start",
                "value": STARTING_BALANCE,
                "cash": STARTING_BALANCE,
                "portfolio_value": 0,
                "future": False,
            },
        )

    # Invisible future anchor so the x-axis extends past today (~halfway).
    points.append(
        {
            "t": domain_end,
            "date": datetime.fromtimestamp(domain_end, timezone.utc).strftime("%Y-%m-%d"),
            "label": "Future",
            "value": None,
            "cash": None,
            "portfolio_value": None,
            "future": True,
        }
    )

    current = next((p["value"] for p in reversed(points) if p["value"] is not None), STARTING_BALANCE)

    return jsonify(
        {
            "student_id": student_id,
            "baseline": STARTING_BALANCE,
            "current": current,
            "present_t": present_ts,
            "domain_start": domain_start,
            "domain_end": domain_end,
            "points": points,
        }
    )


CHART_RANGES = {
    # period/interval for yfinance (Finnhub free tier blocks /stock/candle).
    "1mo": {"period": "1mo", "interval": "1d"},
    "3mo": {"period": "3mo", "interval": "1d"},
    "6mo": {"period": "6mo", "interval": "1d"},
    "1y": {"period": "1y", "interval": "1d"},
    "5y": {"period": "5y", "interval": "1wk"},
}

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
    return _CURRENCY_YAHOO.get(local_ticker, local_ticker)


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
    if err and "Rate limited" in err:
        friendly = "Chart provider is busy — try again in a minute, or open a ticker you viewed earlier."
    elif err and ("403" in err or "access" in err.lower()):
        friendly = "Historical charts aren't on the free Finnhub plan; using backup source failed."
    return jsonify({"error": friendly}), 502


@app.post("/api/charts/warm")
def warm_charts():
    """Optional admin helper: prefetch 1y charts into local cache."""
    result = warm_chart_cache(span="1y")
    return jsonify(result)


@app.post("/api/students/<int:student_id>/buy-home")
def buy_home(student_id: int):
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

    with get_db() as conn:
        row = student_row(conn, student_id)
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
            (student_id, ticker),
        ).fetchone()
        if existing:
            return jsonify({"error": f"You already own a home in {home['name']}."}), 400

        conn.execute(
            """
            INSERT INTO holdings (
                student_id, ticker, shares, avg_cost,
                mortgage_balance, mortgage_rate_pct, loan_years, closing_paid
            ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
            """,
            (
                student_id,
                ticker,
                costs["price"],
                costs["loan_amount"],
                costs["mortgage_rate_pct"],
                costs["loan_years"],
                costs["closing_costs"],
            ),
        )
        conn.execute(
            "UPDATE students SET cash = ? WHERE id = ?",
            (cash - due_today, student_id),
        )
        updated = student_row(conn, student_id)
        payload = serialize_student(conn, updated, with_portfolio=True)
        record_snapshot(
            conn,
            student_id,
            cash=payload["cash"],
            portfolio_value=payload["portfolio_value"] or 0,
            total_value=payload["total_value"],
        )
        return jsonify(payload)


@app.post("/api/students/<int:student_id>/buy")
def buy_shares(student_id: int):
    data = request.get_json(silent=True) or {}
    ticker = (data.get("ticker") or "").strip().upper()
    if ticker in REALESTATE_BY_TICKER:
        # Homes use the dedicated mortgage purchase path.
        return buy_home(student_id)
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

    cost = price * shares

    with get_db() as conn:
        row = student_row(conn, student_id)
        if not row:
            return jsonify({"error": "Student not found"}), 404
        cash = float(row["cash"])
        if cost > cash:
            return jsonify({"error": f"Not enough cash. Need ${cost:.2f}, have ${cash:.2f}"}), 400

        existing = conn.execute(
            "SELECT shares, avg_cost FROM holdings WHERE student_id = ? AND ticker = ?",
            (student_id, ticker),
        ).fetchone()

        if existing:
            old_shares = float(existing["shares"])
            old_cost = float(existing["avg_cost"])
            new_shares = old_shares + shares
            new_avg = ((old_shares * old_cost) + cost) / new_shares
            conn.execute(
                "UPDATE holdings SET shares = ?, avg_cost = ? WHERE student_id = ? AND ticker = ?",
                (new_shares, new_avg, student_id, ticker),
            )
        else:
            conn.execute(
                "INSERT INTO holdings (student_id, ticker, shares, avg_cost) VALUES (?, ?, ?, ?)",
                (student_id, ticker, shares, price),
            )

        conn.execute("UPDATE students SET cash = ? WHERE id = ?", (cash - cost, student_id))
        updated = student_row(conn, student_id)
        payload = serialize_student(conn, updated, with_portfolio=True)
        record_snapshot(
            conn,
            student_id,
            cash=payload["cash"],
            portfolio_value=payload["portfolio_value"] or 0,
            total_value=payload["total_value"],
        )
        return jsonify(payload)


@app.post("/api/students/<int:student_id>/sell")
def sell_shares(student_id: int):
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

    with get_db() as conn:
        row = student_row(conn, student_id)
        if not row:
            return jsonify({"error": "Student not found"}), 404

        existing = conn.execute(
            """
            SELECT shares, COALESCE(mortgage_balance, 0) AS mortgage_balance
            FROM holdings WHERE student_id = ? AND ticker = ?
            """,
            (student_id, ticker),
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
            # Sale pays off the mortgage; cash received is seller equity.
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
                (student_id, ticker),
            )
        else:
            conn.execute(
                "UPDATE holdings SET shares = ? WHERE student_id = ? AND ticker = ?",
                (remaining, student_id, ticker),
            )

        cash = float(row["cash"]) + proceeds
        conn.execute("UPDATE students SET cash = ? WHERE id = ?", (cash, student_id))
        updated = student_row(conn, student_id)
        payload = serialize_student(conn, updated, with_portfolio=True)
        record_snapshot(
            conn,
            student_id,
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
            "disclaimer": "Written for Ledger Lab from public market headlines. No outbound links.",
        }
    )


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)

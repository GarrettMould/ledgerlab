# Ledger Lab

Classroom investing lab for economics classes. Teachers run a roster and invite link; students join with a code, trade real stocks with classroom cash, and track standings.

## Features

- **Teacher dashboard** — create classes, invite students (link + QR), adjust cash, manage roster
- **Student portfolio** — buy/sell stocks, bonds, and other markets with live prices
- **Class standings** — full-screen wealth bubbles sized by net worth
- **News desk** — classroom-safe market briefs (no outbound article links)
- **Closet** — optional cosmetics purchased with classroom cash

## Setup

### 1. Frontend env

Copy `.env.example` to `.env.local` and fill in your Firebase web app config (`VITE_FIREBASE_*`).

### 2. Backend env

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Set `FINNHUB_API_KEY` in `backend/.env`. Optionally set `OPENAI_API_KEY` for rewritten classroom news (template briefs work without it).

### 3. Firebase

In the Firebase console: enable **Email/Password** auth and create a Firestore database. Teachers sign up on the main site with instructor code `9759`. Students join only via class invite links (`/?join=CODE`).

## Run

Terminal 1 — API (port 5001):

```bash
npm run dev:api
```

Terminal 2 — UI:

```bash
npm run dev
```

Open the Vite URL (usually http://localhost:5173). The UI proxies `/api` to Flask.

## Notes

- Do not commit `.env`, `.env.local`, or `backend/.env` — they are gitignored.
- Invite QR codes encode whatever host you’re on; use a real hostname for phones, not `localhost`.

## Deploy on Vercel (Services)

This repo uses `vercel.json` with a Vite frontend and Flask backend. On import, choose **Services** / the preset Vercel suggests, root `./`.

Set environment variables in the Vercel project (Production + Preview):

| Variable | Where used |
| --- | --- |
| `VITE_FIREBASE_*` (all keys from `.env.example`) | Frontend build |
| `FINNHUB_API_KEY` | Backend |
| `OPENAI_API_KEY` (optional) | Backend news rewrite |

After deploy, add your `*.vercel.app` domain under Firebase Auth → **Authorized domains**.

**Caveat:** trading/cash data uses SQLite under `/tmp` on Vercel, so it can reset when the function cold-starts. Fine for demos; for a real class you’ll want a hosted DB later.

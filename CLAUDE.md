# Jimmy - Workout Tracker

## Overview
Single-page workout tracker app with diary calendar. Dark-themed, mobile-first design.

## Tech Stack
- **Backend:** Node.js + Express (single `server.js`)
- **Frontend:** Vanilla HTML/CSS/JS (single `public/index.html`)
- **Database:** PostgreSQL via `pg` (connection string from `DATABASE_URL`)
- **Hosting:** Railway (project: Jimmy)

## Project Structure
```
server.js           # Express API + static file serving
public/index.html   # Entire frontend (styles + JS inlined)
```

## Key Features
- 4 workout programs (A: Squat, B: Deadlift, C: Front Sq, D: HIIT)
- Per-exercise progress tracking with set counters
- Diary calendar with color-coded workout entries per day
- Workout history view

## Database Tables
- `progress` — per-exercise set counts and completion state
- `workout_log` — completed workout sessions
- `diary` — calendar entries (date + workout type + notes)

## API Endpoints (no auth required)
- `GET/POST /api/progress` — exercise state
- `POST /api/log` — log completed workout
- `GET/POST /api/diary` — diary entries (GET needs `?month=YYYY-MM`)
- `DELETE /api/diary/:id` — remove diary entry
- `GET /api/history-all` — merged history
- `DELETE /api/progress/day/:day` — reset a day

## Deploy
```bash
cd "/Users/adi/Claude code/Jimmy"
railway up --detach           # deploy to Railway
git push origin main          # push to GitHub (adida8/Jimmy)
```

## URLs
- **Live:** https://jimmy-production-4ea0.up.railway.app
- **GitHub:** https://github.com/adida8/Jimmy
- **Railway dashboard:** https://railway.com/project/2f26bc7b-d833-436b-bb73-ffeb910d29d3

## Environment Variables (Railway)
- `DATABASE_URL` — Postgres connection string (set to internal Railway Postgres URL)
- `NODE_ENV` — `production`
- `PORT` — auto-set by Railway

## Notes
- No API key auth — endpoints are open
- Frontend is a single HTML file with inlined CSS/JS
- Mobile-responsive calendar and workout views
- Title displays as "JIMMY" (was renamed from "6-Pack by Summer")

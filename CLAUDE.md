# Jimmy - Workout Tracker & Food Logger

## Overview
Single-page workout tracker app with diary calendar and AI-powered food photo logging. Dark-themed, mobile-first design.

## Tech Stack
- **Backend:** Node.js 18+ / Express (single `server.js`)
- **Frontend:** Vanilla HTML/CSS/JS (single `public/index.html`)
- **Database:** PostgreSQL via `pg` (connection string from `DATABASE_URL`)
- **AI:** Claude Vision API (claude-opus-4-5) for food photo analysis
- **Hosting:** Railway (project: Jimmy)

## Project Structure
```
server.js           # Express API + static file serving + Claude Vision proxy
public/index.html   # Entire frontend (styles + JS inlined, ~88KB)
```

## Key Features
- 4 workout programs (A: Squat, B: Deadlift, C: Front Sq, D: HIIT)
- Per-exercise progress tracking with set counters
- Diary calendar with color-coded workout entries per day
- Workout history view with streak tracking
- **Food photo logging** — snap/upload a meal photo, Claude Vision analyzes paleo compliance, flags each ingredient as ok/warn/bad, daily score

## Tabs
`A` `B` `C` `D` `Diary` `Food` `History` — tab bar scrolls horizontally on mobile

## Database Tables
- `progress` — per-exercise set counts and completion state
- `workout_log` — completed workout sessions
- `diary` — calendar entries (date + workout type + notes)
- `food_log` — food photo entries (date, meal_time, description, is_paleo, verdict, flags JSONB, notes, image_data TEXT)

## API Endpoints (no auth required)
- `GET/POST /api/progress` — exercise state
- `POST /api/log` — log completed workout
- `GET/POST /api/diary` — diary entries (GET needs `?month=YYYY-MM`)
- `DELETE /api/diary/:id` — remove diary entry
- `GET /api/history-all` — merged history
- `DELETE /api/progress/day/:day` — reset a day
- `POST /api/food/analyze` — send `{ image_base64, mime_type }`, returns paleo analysis via Claude Vision
- `POST /api/food` — save food entry
- `GET /api/food?date=YYYY-MM-DD` — get food entries for a date
- `DELETE /api/food/:id` — remove food entry

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
- `ANTHROPIC_API_KEY` — required for food photo analysis (Claude Vision)

## Known Issues / TODO
- **Food analysis returns 502** — the `/api/food/analyze` endpoint calls Claude API but gets an error. Debug next session: check `ANTHROPIC_API_KEY` is set in Railway (`railway vars`), check model name is valid, check Railway logs for the specific error message.
- Body size limit set to 10mb (`express.json({ limit: '10mb' })`) for base64 image uploads

## Notes
- No API key auth on endpoints — they are open
- Frontend is a single HTML file with inlined CSS/JS
- Mobile-responsive: calendar, workout views, food sheet all work on mobile
- Food sheet has two buttons: "📸 Camera" (uses `capture="environment"`) and "🖼️ Gallery" (plain file picker)
- Title displays as "JIMMY"

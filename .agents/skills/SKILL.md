---
name: EVENTS Booking System
description: Complete tech stack, architecture, deployment, and workflow reference for the Boekeerlijk/EVENTS restaurant booking platform
---

# EVENTS Booking System — Full Reference

## Tech Stack

| Layer | Technology | Location |
|---|---|---|
| **Frontend Framework** | React 19 + TypeScript | `components/`, `App.tsx` |
| **Build Tool** | Vite 6 | `vite.admin.config.ts`, `vite.widget.config.ts` |
| **Styling** | Tailwind CSS 3 | `tailwind.config.js`, `index.css` |
| **Icons** | lucide-react | Used across all components |
| **Charts** | Recharts | `components/stats/` |
| **UI Library** | Preact (widget only) | `vite.widget.config.ts` aliases React → Preact |
| **Error Tracking** | Sentry (`@sentry/react`) | Frontend + `server/sentry.js` |
| **Backend** | Node.js 20 + Express | `server/index.js` |
| **Database** | PostgreSQL (Neon) | `server/db-postgres.js`, schema in `server/schema.sql` |
| **Auth** | JWT (bcrypt passwords) | `server/auth.js`, `server/routes/auth.js` |
| **Email** | Resend | `server/email.js` |
| **Rate Limiting** | Redis (Upstash) / in-memory fallback | `server/ratelimit.js` |
| **Caching** | In-process stale-while-revalidate | `server/public-cache.js` |

---

## Repository

- **GitHub**: `https://github.com/Jezza5153/booking.git`
- **Branch**: `main`
- **Monorepo**: frontend + server in one repo

---

## Deployment — ALWAYS DO THIS

### The Deploy Flow

```bash
# 1. Build to catch errors
npx vite build --config vite.admin.config.ts

# 2. Commit and push — this triggers BOTH deploys
git add -A && git commit -m "description" && git push origin main
```

**That's it.** Both platforms auto-deploy from GitHub `main`.

### Platform Mapping

| Service | Platform | URL | Config |
|---|---|---|---|
| **Frontend** | Vercel (GitHub integration) | `events-plum-nine.vercel.app` | `vercel.json` |
| **Backend API** | Railway (GitHub integration) | `booking-production-de35.up.railway.app` | `server/railway.toml` |
| **Database** | Neon PostgreSQL | Connection via `DATABASE_URL` env | `server/db-postgres.js` |

### How Routing Works

`vercel.json` proxies all `/api/*` requests to Railway:
```json
{ "source": "/api/:path*", "destination": "https://booking-production-de35.up.railway.app/api/:path*" }
```

Everything else serves the SPA (`/index.html`).

> [!CAUTION]
> Google Cloud Run (`events-api-ovey55g3fa-ew.a.run.app`) is **STALE and NOT used**.
> The `DEPLOY.md` file references GCR but is **outdated**. Ignore it.
> GCloud accounts `info@jezzacooks.com` and `info@tafelaaramersfoort.nl` have billing disabled.

> [!IMPORTANT]
> **NEVER deploy with `npx vercel --prod`** — always use `git push` so both frontend AND backend deploy together.

---

## Environment Variables

All set on Railway (backend). See `server/.env.example` for full list:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `JWT_SECRET` | JWT signing key (min 32 chars) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin login (password is bcrypt hash) |
| `FRONTEND_URL` | CORS allowed origin |
| `CORS_ALLOWED_ORIGINS` | Additional CORS origins (comma-separated) |
| `RESEND_API_KEY` | Resend email API key |
| `RESEND_FROM_EMAIL` | From address for emails |
| `BOOKING_NOTIFICATION_EMAIL` | Where booking notifications go |
| `REDIS_URL` | Upstash Redis for rate limiting |
| `SENTRY_DSN` | Sentry error tracking |
| `PUBLIC_CACHE_MAX_ENTRIES` | In-process cache size (default 400) |
| `DB_KEEPALIVE_INTERVAL_MS` | DB keepalive interval (default 240000) |

---

## Architecture

### Backend Routes

| File | Purpose | Auth |
|---|---|---|
| `server/routes/public.js` | Guest-facing booking API, availability, widget config | None (rate-limited) |
| `server/routes/admin.js` | Full admin API: CRUD bookings, tables, settings, blocks | JWT required |
| `server/routes/auth.js` | Login, verify, refresh JWT | None / JWT |

### Backend Utilities

| File | Key Functions |
|---|---|
| `server/utils.js` | `computeEndTime()`, `selectTablesForSlot()`, `pickTablesGreedy()`, `buildBookingsMap()` |
| `server/email.js` | Booking confirmation emails via Resend |
| `server/public-cache.js` | Stale-while-revalidate caching for public endpoints |
| `server/ratelimit.js` | Rate limiting (Redis or in-memory) |
| `server/auth.js` | JWT verify middleware, bcrypt password comparison |
| `server/sentry.js` | Sentry error tracking setup |
| `server/env.js` | Environment variable loader |

### Frontend Components

| Component | Purpose |
|---|---|
| `TimelineGrid.tsx` | **Tafels page** — main admin grid, quick-book, walk-in, edit modal, table blocking, timed blocks |
| `BookingsManager.tsx` | **Boekingen page** — event + restaurant bookings list, mini timeline, edit/create modals |
| `AdminDashboard.tsx` | **Dashboard** — overview, settings, restaurant config |
| `BookingStats.tsx` | **Analyse** — stats/analytics with charts |
| `RestaurantBooking.tsx` | **Public widget** — guest-facing booking form |
| `CalendarManager.tsx` | **Kalender** — opening hours, closed days |
| `EventCard.tsx` | Event management cards |
| `EventsWidget.tsx` | Public events listing widget |
| `LoginPage.tsx` | Admin login screen |
| `Newsletter.tsx` | Newsletter subscription management |
| `IntegrationGuide.tsx` | Widget embed code generator |
| `SlotBubble.tsx` | Time slot selection bubbles |
| `components/stats/` | Analytics sub-components (charts, KPIs, heatmaps, etc.) |

### Build System

Two Vite configs produce two outputs:
1. **`vite.admin.config.ts`** → `dist/` — Full admin SPA (React)
2. **`vite.widget.config.ts`** → `dist-widget/` — Embeddable booking widget (Preact, smaller bundle)

The `build` script merges both: `build:admin && build:widget && cp -R dist-widget/. dist/`

### Database Schema

Main tables (see `server/schema.sql` + `server/migration-*.sql`):

| Table | Purpose |
|---|---|
| `restaurants` | Restaurant config (name, slug, settings) |
| `restaurant_tables` | Table definitions (name, seats, zone) |
| `restaurant_bookings` | All reservations (guest info, time, status, table assignment) |
| `restaurant_table_blocks` | Timed table blocks |
| `customers` | Customer profiles (name, email, phone, visit history) |
| `events` | Event definitions |
| `bookings` | Event bookings |
| `slots` | Event time slots |
| `admin_users` | Admin accounts (bcrypt hashed passwords) |

---

## Workflow Rules — FOLLOW THESE ALWAYS

### 1. Deploy = Git Push
```bash
git add -A && git commit -m "..." && git push origin main
```
Both Vercel (frontend) and Railway (backend) auto-deploy. **Never** use `npx vercel --prod`.

### 2. Code Only — No Browser Testing
- **DO NOT** use browser subagent for testing — it can't log in
- User handles all browser testing themselves
- Focus on writing correct code, building, and pushing

### 3. Read Before Writing
- Always read the existing code FIRST before making changes
- Understand the current implementation before modifying

### 4. Build Check Before Push
```bash
npx vite build --config vite.admin.config.ts
```
Always verify the build passes before pushing.

### 5. Time Formatting
- Backend: use `to_char(column, 'HH24:MI')` — never `::text`
- Frontend: `fmtTime()` helper strips seconds as safety net

### 6. Database Query Rules
- Visit counts: only `status = 'arrived' AND booking_date <= CURRENT_DATE`
- Never count future or cancelled bookings as visits
- Always filter by `restaurant_id` in multi-tenant queries

### 7. Admin Booking Defaults
- Default duration: **180 min (3 uur)**
- Guest count: **unlimited** (free number input)
- Public/guest booking max: **50 guests**, up to **4 hours**
- Admin duration options: up to **6 hours**

---

## Scripts

| Script | Purpose |
|---|---|
| `scripts/ping-backend.mjs` | Keepalive pings to prevent Railway cold starts |
| `scripts/assign-tables.mjs` | Bulk table assignment utility |
| `scripts/import-tapla.mjs` | Import data from Tapla |
| `scripts/scrape-tapla.mjs` | Scrape Tapla data |

---

## Docker (Railway)

`Dockerfile` builds the backend for Railway/Cloud Run:
- Base: `node:20-alpine`
- Copies `server/` only
- Runs as non-root user
- Healthcheck on `/api/health`
- Port: `8080` (overridden by Railway's `PORT` env)

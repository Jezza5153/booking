---
name: EVENTS Booking System
description: Tech stack, deployment, and architecture reference for the EVENTS booking platform
---

# EVENTS Booking System

## Tech Stack

| Layer | Technology | Details |
|---|---|---|
| **Frontend** | React + Vite + TypeScript | Components in `components/`, entry in `App.tsx` |
| **Styling** | Tailwind CSS | Config in `tailwind.config.js`, base in `index.css` |
| **Backend** | Node.js + Express | Entry `server/index.js`, routes in `server/routes/` |
| **Database** | PostgreSQL (Neon) | Schema in `server/schema.sql`, connection in `server/db-postgres.js` |
| **Auth** | JWT | Routes in `server/routes/auth.js` |

## Deployment

| Service | Platform | Auto-deploy |
|---|---|---|
| **Frontend** | Vercel | ✅ Auto on push to `main` |
| **Backend** | Railway | ✅ Auto on push to `main` |

- **Railway URL**: `https://booking-production-de35.up.railway.app`
- **Vercel config**: `vercel.json` proxies `/api/*` → Railway
- **Deploy = just `git push`** — both platforms auto-deploy from GitHub `main`

> [!CAUTION]
> Google Cloud Run (`events-api-ovey55g3fa-ew.a.run.app`) is STALE and NOT used.
> The `DEPLOY.md` file references GCR but is outdated. Ignore it.

## Key Architecture

### Routes
- `server/routes/public.js` — Guest-facing booking API (has restrictions: max 50 guests)
- `server/routes/admin.js` — Admin API (no guest limit, PATCH editing, full control)
- `server/routes/auth.js` — JWT login/verify/refresh

### Shared Utilities (`server/utils.js`)
- `computeEndTime(start, close, durationMins?)` — calculates booking end time
- `selectTablesForSlot()` — table allocation (single → same-zone → cross-zone)
- `pickTablesGreedy()` — combines tables for large groups
- `buildBookingsMap()` — builds occupancy lookup

### Key Frontend Components
- `TimelineGrid.tsx` — Tafels page (main admin grid, quick-book, edit modal)
- `BookingsManager.tsx` — Boekingen page (event + restaurant bookings, mini timeline)
- `BookingStats.tsx` — Stats/analytics dashboard
- `RestaurantBooking.tsx` — Public guest booking widget
- `App.tsx` — Navigation, auth, view routing

### Defaults
- Admin booking default duration: **180 min (3 uur)**
- Admin guest count: **unlimited** (free number input)
- Guest/public booking max: **50 guests**
- Duration options: up to **6 hours** (admin), **4 hours** (public)

## Database
- Connection string via `DATABASE_URL` env var (Neon PostgreSQL)
- Migrations in `server/migration-*.sql`
- Main tables: `restaurant_bookings`, `restaurant_tables`, `bookings`, `customers`, `slots`

## Git
- Repo: `https://github.com/Jezza5153/booking.git`
- Branch: `main`
- GCloud accounts: `info@jezzacooks.com`, `info@tafelaaramersfoort.nl` (billing disabled)

import './env.js';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import helmet from 'helmet';
import pool from './db-postgres.js';
import { escapeHtml, sanitizeString, validateRestaurantId, generateUnsubscribeToken } from './utils.js';
import { authMiddleware } from './auth.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';
import { loginRateLimiter, bookingRateLimiter, widgetRateLimiter, calendarRateLimiter, isRedisConnected } from './ratelimit.js';
import { initSentry, sentryErrorHandler, captureException } from './sentry.js';
import { sendBookingConfirmation, sendLargeGroupNotification, sendRestaurantBookingConfirmation, sendChefsChoiceNotification } from './email.js';
import { Resend } from 'resend';
import multer from 'multer';

// Email config for newsletter — re-use from email.js where possible
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'De Tafelaar <reserveren@tafelaaramersfoort.nl>';
const REPLY_TO_EMAIL = 'reserveren@tafelaaramersfoort.nl';
// HMAC helper for secure unsubscribe tokens (P0 fix #2)
// Imported from utils.js

// ============================================
// NON-NEGOTIABLE: Fail fast if JWT_SECRET missing
// ============================================
if (!process.env.JWT_SECRET) {
    console.error('❌ FATAL: JWT_SECRET environment variable is required');
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// SECURITY: Initialize Sentry (must be first)
// ============================================
initSentry(app);

// ============================================
// SECURITY: Middleware
// ============================================

// Trust proxy for Cloudflare + Railway (required for rate limiting to work correctly)
app.set('trust proxy', 1);

// SECURITY FIX #32: Restrict CORS — no wildcards in production
const DEFAULT_ALLOWED_ORIGINS = [
    'https://events-widget.vercel.app',
    'https://booking-widget-frontendbooking.vercel.app',
    'https://detafelaar.nl',
    'https://www.detafelaar.nl',
    'http://localhost:5173',  // Vite dev server
    'http://localhost:3000',  // Local dev
    'http://localhost:3002',  // Studio Next.js dev
];

function parseOriginsFromEnv(value) {
    return String(value || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

const ALLOWED_ORIGINS = Array.from(new Set([
    ...parseOriginsFromEnv(process.env.FRONTEND_URL),
    ...parseOriginsFromEnv(process.env.CORS_ALLOWED_ORIGINS),
    ...DEFAULT_ALLOWED_ORIGINS,
]));

const ALLOWED_ORIGIN_PATTERNS = [
    /^https:\/\/booking-widget-frontendbooking(?:-[a-z0-9-]+)?\.vercel\.app$/i,
    /^https:\/\/events-widget(?:-[a-z0-9-]+)?\.vercel\.app$/i,
];

const FRAME_ANCESTORS = Array.from(new Set([
    "'self'",
    ...ALLOWED_ORIGINS.filter((origin) => origin.startsWith('http://') || origin.startsWith('https://')),
]));

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (e.g. server-to-server, mobile apps, curl)
        if (!origin) return callback(null, true);
        const matchesAllowedPattern = ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
        if (ALLOWED_ORIGINS.includes(origin) || matchesAllowedPattern || process.env.NODE_ENV === 'development') {
            return callback(null, true);
        }
        console.warn(`CORS blocked origin: ${origin}`);
        return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true
}));
app.use(express.json({ limit: '16kb' }));

// Helmet for security headers including CSP
// FIX #34: Tighten CSP — restrict frame-ancestors and connect-src
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            // Only allow embedding on known restaurant sites
            'frame-ancestors': FRAME_ANCESTORS,
            'connect-src': ["'self'"],
        },
    },
    // Let frame-ancestors CSP directive handle framing (more flexible than X-Frame-Options)
    frameguard: false,
}));

// Additional security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
});

// Request ID for logging (don't log sensitive data)
app.use((req, res, next) => {
    req.requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    next();
});

// ============================================
// AUTH ROUTES (Public, Rate Limited)
// ============================================
app.use('/api/auth', authRoutes);
app.use('/', publicRoutes);
app.use('/', adminRoutes);

// ============================================
// PUBLIC ROUTES (Rate Limited)
// ============================================

// Input sanitization handlers imported from utils.js

// GET /api/widget/:restaurantId - Widget data

// NOTE: Idempotency is handled at the DB level via unique constraint on idempotency_key.
// In-memory cache removed (audit fix #13/#21) — it didn't survive restarts or work across instances.

// ============================================
// TABLE ALLOCATION: Greedy algorithm for large groups
// ============================================
// Finds optimal table combination for guest_count
// Returns: { tables: [{seats: 6, count: 1}, {seats: 4, count: 1}], totalSeats: 10 } or null if impossible
function allocateTables(guestCount, available2, available4, available6) {
    // Greedy: prefer larger tables first to minimize table count
    const tables = [];
    let remaining = guestCount;

    // Use 6-tops first
    const need6 = Math.min(Math.floor(remaining / 6), available6);
    if (need6 > 0) {
        tables.push({ seats: 6, count: need6 });
        remaining -= need6 * 6;
    }

    // Use 4-tops next
    const need4 = Math.min(Math.floor(remaining / 4), available4);
    if (need4 > 0) {
        tables.push({ seats: 4, count: need4 });
        remaining -= need4 * 4;
    }

    // Use 2-tops for remainder
    const need2 = Math.min(Math.ceil(remaining / 2), available2);
    if (need2 > 0) {
        tables.push({ seats: 2, count: need2 });
        remaining -= need2 * 2;
    }

    // Check if we can fit everyone (allow slight overflow from last table)
    if (remaining > 0) {
        // Not enough tables - try different approach with partial 4-top or 6-top
        // Reset and try filling with partial larger tables
        remaining = guestCount;
        tables.length = 0;

        // Calculate minimum tables needed with overfill allowed
        let use6 = Math.min(Math.ceil(remaining / 6), available6);
        if (use6 * 6 >= remaining) {
            tables.push({ seats: 6, count: use6 });
            remaining = 0;
        } else {
            if (use6 > 0) {
                tables.push({ seats: 6, count: use6 });
                remaining -= use6 * 6;
            }
            let use4 = Math.min(Math.ceil(remaining / 4), available4);
            if (use4 * 4 >= remaining) {
                tables.push({ seats: 4, count: use4 });
                remaining = 0;
            } else {
                if (use4 > 0) {
                    tables.push({ seats: 4, count: use4 });
                    remaining -= use4 * 4;
                }
                let use2 = Math.min(Math.ceil(remaining / 2), available2);
                if (use2 * 2 >= remaining) {
                    tables.push({ seats: 2, count: use2 });
                    remaining = 0;
                }
            }
        }
    }

    if (remaining > 0) {
        return null; // Cannot allocate - not enough tables
    }

    const totalSeats = tables.reduce((sum, t) => sum + t.seats * t.count, 0);
    return { tables, totalSeats };
}

// POST /api/book - Book a table (public, rate limited)
// Uses atomic capacity update and DB-level idempotency
// Supports both regular bookings (1-6) and large groups (7+)

// GET /api/calendar/:restaurantId.ics - iCal feed (public, rate limited)

// Health check with DB connectivity verification

// GET /api/events - Public events endpoint for widget

// ============================================
// PROTECTED ADMIN ROUTES (Auth required)
// ============================================
app.use('/api/admin', authMiddleware);

// Example: Get all events for admin
// P0-7 FIX: Scope to restaurant

// P0-3: Dedicated admin data endpoint with raw ISO dates for editing

// Clear all events and slots (Admin - for fresh start)
// FIX #19: Requires confirm=true to prevent accidental deletion

// Cancel a booking (Admin only) - marks cancelled, decrements slot counter
// SECURITY: Tenant-scoped, atomic, race-safe
// FIX #41: Added missing authMiddleware

// Get all bookings for admin view with filtering, search, and pagination
// Returns { bookings, total, limit, offset } for proper pagination
// FIX #31: Added authMiddleware — this endpoint exposes PII (names, emails, phones)

// GET /api/admin/stats - Aggregated stats for dashboard (efficient server-side)

// Reconciliation endpoint - verify slot counters match booking counts
// GET /api/admin/reconcile?restaurantId=xxx&repair=true

// Save zones and events (Admin) - FULL SYNC with SAFETY RAILS



// ============================================
// TABLE SELECTION HELPERS (shared by availability + booking endpoints)
// ============================================

const BOOKING_DURATION_MINS = 180; // 3-hour booking blocks
// Slot step is intentionally 30 min (fine-grained granularity), independent of BOOKING_DURATION_MINS
const SLOT_STEP_MINS = 30;

/** Normalize any time string ("HH:MM:SS" or "HH:MM" or "H:MM") to "HH:MM" */
function normalizeToHHMM(t) {
    const s = (t || '00:00').trim();
    const parts = s.split(':');
    return parts[0].padStart(2, '0') + ':' + (parts[1] || '00').padStart(2, '0');
}

function timeToMins(t) {
    const n = normalizeToHHMM(t);
    return parseInt(n.slice(0, 2)) * 60 + parseInt(n.slice(3, 5));
}

function minsToTime(m) {
    return `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
}

/** Compute booking end time, capped at closing */
function computeEndTime(startTime, closeTime) {
    const startMins = timeToMins(startTime);
    const closeMins = timeToMins(closeTime);
    return minsToTime(Math.min(startMins + BOOKING_DURATION_MINS, closeMins));
}

/** Check if two time intervals overlap. Compares as minutes to avoid format bugs. */
function overlaps(aStart, aEnd, bStart, bEnd) {
    const as = timeToMins(aStart);
    const ae = timeToMins(aEnd);
    const bs = timeToMins(bStart);
    const be = timeToMins(bEnd);
    return as < be && ae > bs;
}

/** Greedy: pick biggest tables until total seats >= guestCount. Returns null if impossible. */
function pickTablesGreedy(freeTables, guestCount) {
    let total = 0;
    const picked = [];
    for (const t of freeTables) {
        picked.push(t);
        total += t.seats;
        if (total >= guestCount) return picked;
    }
    return null; // not enough seats
}

/**
 * Single source of truth for table selection.
 * Prefer single table → same-zone combo → cross-zone combo.
 * 
 * @param {Object[]} allTables - All active tables, sorted seats DESC
 * @param {Map} bookingsByTableId - Map<tableId, Array<{start_time, end_time}>>
 * @param {string} slotStart - HH:MM
 * @param {string} slotEnd - HH:MM
 * @param {number} guestCount
 * @returns {Object[]|null} Selected tables, or null if unavailable
 */
function selectTablesForSlot({ allTables, bookingsByTableId, slotStart, slotEnd, guestCount }) {
    const isFree = (t) => {
        const intervals = bookingsByTableId.get(t.id) || [];
        for (const b of intervals) {
            if (overlaps(b.start_time, b.end_time, slotStart, slotEnd)) return false;
        }
        return true;
    };

    const freeTables = allTables.filter(isFree);

    // 1) Single table fits
    const single = freeTables.find(t => t.seats >= guestCount);
    if (single) return [single];

    // 2) Combine within a zone first (less operational fragmentation)
    const byZone = new Map();
    for (const t of freeTables) {
        const z = t.zone || '__NO_ZONE__';
        if (!byZone.has(z)) byZone.set(z, []);
        byZone.get(z).push(t);
    }
    for (const [, zoneTables] of byZone.entries()) {
        zoneTables.sort((a, b) => b.seats - a.seats);
        const picked = pickTablesGreedy(zoneTables, guestCount);
        if (picked) return picked;
    }

    // 3) Combine across zones
    freeTables.sort((a, b) => b.seats - a.seats);
    return pickTablesGreedy(freeTables, guestCount);
}

export function buildBookingsMap(bookingsRows) {
    const map = new Map();
    for (const b of bookingsRows) {
        if (!map.has(b.table_id)) map.set(b.table_id, []);
        map.get(b.table_id).push({ start_time: b.start_time, end_time: b.end_time });
    }
    return map;
}

// ============================================
// RESTAURANT BOOKING SYSTEM
// ============================================

// GET /api/restaurant/:restaurantId/tables - Get all tables

// GET /api/restaurant/:restaurantId/opening-hours - Get opening hours

// ============================================
// WAITLIST API ENDPOINTS
// ============================================

// GET /api/restaurant/:restaurantId/waitlist - Get waitlist entries

// POST /api/restaurant/:restaurantId/waitlist - Add to waitlist

// PUT /api/restaurant/:restaurantId/waitlist/:id - Update waitlist entry

// DELETE /api/restaurant/:restaurantId/waitlist/:id - Remove from waitlist

// PUT /api/restaurant/:restaurantId/tables - Update tables (replace all)

// GET /api/restaurant/:restaurantId/availability - Get available time slots

// POST /api/restaurant/book - Book a table

// GET /api/admin/restaurant-bookings - Get bookings for timeline grid

// PATCH /api/admin/restaurant-bookings/:id/status - Update booking status

// POST /api/admin/bookings - Create event booking from admin panel

// POST /api/admin/restaurant-bookings - Create restaurant booking from admin panel

// GET /api/admin/day-notes - Get day notes

// POST /api/admin/day-notes - Add day note

// DELETE /api/admin/day-notes/:id - Delete day note

// GET /api/admin/customers/search - Search customers

// GET /api/restaurant/:id/openings - Get opening hours for a restaurant

// NOTE: Duplicate POST /api/restaurant/book route removed (audit fix #1).
// Multi-table booking is handled via POST /api/admin/restaurant-bookings.

// POST /api/admin/restaurant-settings - Save restaurant tables & settings

// ============================================
// NEWSLETTER / EMAIL LIST ENDPOINTS
// ============================================

// GET /api/admin/newsletter/subscribers - Get all customer emails for mailing list

// POST /api/admin/newsletter/send - Send promotional email to subscribers
// Multer: store uploads in memory (max 10MB for newsletter images)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/admin/newsletter/send - Send newsletter (with optional inline image)

// POST /api/newsletter/subscribe - Public subscribe endpoint (no auth, rate limited)
// Used by the Studio website footer to let visitors join the mailing list
// P2 FIX #21: Added rate limiting to prevent bot abuse

// GET /api/newsletter/unsubscribe - Public unsubscribe endpoint (no auth)

// ============================================
// SENTRY ERROR HANDLER (before global handler)
// ============================================
sentryErrorHandler(app);

// ============================================
// GLOBAL ERROR HANDLER (Must be last)
// ============================================
app.use((err, req, res, next) => {
    // Log error safely (no sensitive data)
    console.error(`[${req.requestId}] Unhandled error:`, err.message);

    // Capture to Sentry
    captureException(err, { requestId: req.requestId });

    // Never expose stack traces or internal details
    res.status(500).json({
        error: 'Internal server error',
        requestId: req.requestId
    });
});

// P3 FIX #28: Run migrations BEFORE starting the server
async function runMigrations() {
    // Auto-migration: ensure newsletter columns exist (safe to run repeatedly)
    try {
        await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS newsletter_opt_in BOOLEAN DEFAULT false');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_customers_newsletter ON customers(restaurant_id) WHERE newsletter_opt_in = true');
        console.log('✅ Newsletter migration applied');
    } catch (e) {
        console.warn('⚠️ Newsletter migration skipped:', e.message);
    }

    // Auto-migration: ensure multi-table group columns exist (safe to run repeatedly)
    try {
        await pool.query('ALTER TABLE restaurant_bookings ADD COLUMN IF NOT EXISTS group_id TEXT');
        await pool.query('ALTER TABLE restaurant_bookings ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false');
        await pool.query('UPDATE restaurant_bookings SET is_primary = true WHERE group_id IS NULL AND is_primary = false');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_group ON restaurant_bookings(group_id) WHERE group_id IS NOT NULL');
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_lookup ON restaurant_bookings(restaurant_id, booking_date, table_id, start_time, end_time) WHERE lower(status) != 'cancelled'`);
        await pool.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
        await pool.query(`
            DO $$ BEGIN
                ALTER TABLE restaurant_bookings
                ADD CONSTRAINT restaurant_bookings_no_overlap
                EXCLUDE USING gist (
                    table_id WITH =,
                    tsrange(
                        (booking_date + start_time),
                        (booking_date + end_time),
                        '[)'
                    ) WITH &&
                ) WHERE (lower(status) <> 'cancelled');
            EXCEPTION WHEN duplicate_table THEN NULL;
            END $$;
        `);
        console.log('✅ Multi-table group migration + exclusion constraint applied');
    } catch (e) {
        console.warn('⚠️ Multi-table migration skipped:', e.message);
    }
}

// Start server: run migrations first, then listen
runMigrations().then(() => {
    const server = app.listen(PORT, () => {
        console.log(`🚀 EVENTS API server running on http://localhost:${PORT}`);
        console.log(`📅 Calendar: http://localhost:${PORT}/api/calendar/demo-restaurant.ics`);
        console.log(`🔐 Auth: POST /api/auth/login`);
        console.log(`🛡️  Security: Rate limiting, input validation, SERIALIZABLE transactions enabled`);
    });

    // P1 FIX #15: Request timeout to prevent hung connections
    server.setTimeout(30000);

    // FIX #29: Graceful shutdown — drain connections on SIGTERM/SIGINT
    function gracefulShutdown(signal) {
        console.log(`\n⚡ ${signal} received. Shutting down gracefully...`);
        server.close(() => {
            console.log('🔌 HTTP server closed');
            pool.end().then(() => {
                console.log('🗄️  Database pool closed');
                process.exit(0);
            }).catch(() => process.exit(1));
        });
        // Force exit after 10s if graceful shutdown hangs
        setTimeout(() => {
            console.error('⏰ Forced exit after timeout');
            process.exit(1);
        }, 10000);
    }
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}).catch(err => {
    console.error('❌ FATAL: Migration failed, not starting server:', err.message);
    process.exit(1);
});

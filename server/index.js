import './env.js';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import helmet from 'helmet';
import compression from 'compression';
import pool from './db-postgres.js';
import { escapeHtml, sanitizeString, validateRestaurantId, generateUnsubscribeToken, buildBookingsMap } from './utils.js';
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
    'https://booking-roan-eta.vercel.app',
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
    /^https:\/\/booking(?:-[a-z0-9-]+)?\.vercel\.app$/i,
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

// P5 PERF: Compress all responses (gzip/brotli)
app.use(compression({ threshold: 1024 }));

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

// Table helpers consolidated in utils.js (imported by routes/public.js and routes/admin.js)

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

    // Auto-migration: ensure service-mode columns exist (required for stats + timeline)
    try {
        await pool.query('ALTER TABLE restaurant_bookings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT \'confirmed\'');
        await pool.query('ALTER TABLE restaurant_bookings ADD COLUMN IF NOT EXISTS is_walkin BOOLEAN DEFAULT FALSE');
        await pool.query('ALTER TABLE restaurant_bookings ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ');
        await pool.query('ALTER TABLE restaurant_bookings ADD COLUMN IF NOT EXISTS customer_id TEXT');
        await pool.query("ALTER TABLE restaurant_bookings ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'website'");
        await pool.query("UPDATE restaurant_bookings SET source = 'walkin' WHERE is_walkin = true AND (source IS NULL OR source = 'website')");
        await pool.query('CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_status ON restaurant_bookings(status)');
        console.log('✅ Service-mode columns migration applied');
    } catch (e) {
        console.warn('⚠️ Service-mode migration skipped:', e.message);
    }

    // Auto-migration: table_blocks for per-table per-date blocking
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS table_blocks (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                restaurant_id TEXT NOT NULL,
                table_id TEXT NOT NULL REFERENCES restaurant_tables(id),
                block_date DATE NOT NULL,
                start_time TIME,
                end_time TIME,
                reason TEXT,
                created_by TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_table_blocks_unique ON table_blocks(table_id, block_date, COALESCE(start_time, \'00:00:00\'))');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_table_blocks_restaurant_date ON table_blocks(restaurant_id, block_date)');
        console.log('✅ Table blocks migration applied');
    } catch (e) {
        console.warn('⚠️ Table blocks migration skipped:', e.message);
    }

    // Daily revenue table for manual revenue input
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS daily_revenue (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                restaurant_id TEXT NOT NULL,
                date DATE NOT NULL,
                revenue NUMERIC(10,2) NOT NULL DEFAULT 0,
                notes TEXT,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE(restaurant_id, date)
            )
        `);
        console.log('✅ Daily revenue table migration applied');
    } catch (e) {
        console.warn('⚠️ Daily revenue migration skipped:', e.message);
    }

    // Auto-fix: redistribute oversized bookings (guest_count > table seats) across multiple tables
    // Catches: (1) no group_id at all, (2) group_id set but no secondary table entries
    try {
        const oversized = await pool.query(
            `SELECT rb.id, rb.restaurant_id, rb.table_id, rb.booking_date::text, 
                    rb.start_time::text, rb.end_time::text, rb.guest_count,
                    rb.customer_name, rb.customer_email, rb.customer_phone, rb.remarks,
                    rb.customer_id, rb.status, rt.seats as table_seats, rb.group_id
             FROM restaurant_bookings rb
             JOIN restaurant_tables rt ON rt.id = rb.table_id
             WHERE rb.guest_count > rt.seats AND rb.status != 'cancelled'
               AND rb.is_primary = true
               AND NOT EXISTS (
                   SELECT 1 FROM restaurant_bookings rb2 
                   WHERE rb2.group_id = rb.group_id AND rb2.is_primary = false
               )`
        );
        if (oversized.rowCount > 0) {
            console.log(`🔧 Found ${oversized.rowCount} oversized bookings to redistribute...`);
            for (const booking of oversized.rows) {
                const groupId = booking.group_id || crypto.randomUUID();
                // Find free tables for this slot
                const freeTables = await pool.query(
                    `SELECT rt.id, rt.name, rt.seats, rt.zone FROM restaurant_tables rt
                     WHERE rt.restaurant_id = $1 AND rt.is_active = true
                       AND rt.id != $2
                       AND NOT EXISTS (
                           SELECT 1 FROM restaurant_bookings rb2
                           WHERE rb2.table_id = rt.id AND rb2.booking_date = $3
                             AND rb2.status != 'cancelled'
                             AND rb2.start_time < $5 AND rb2.end_time > $4
                       )
                     ORDER BY rt.seats ASC`,
                    [booking.restaurant_id, booking.table_id, booking.booking_date, booking.start_time, booking.end_time]
                );
                // Greedy: pick smallest tables until we have enough seats
                let needed = booking.guest_count - booking.table_seats;
                const extraTables = [];
                for (const t of freeTables.rows) {
                    if (needed <= 0) break;
                    extraTables.push(t);
                    needed -= t.seats;
                }
                if (needed <= 0 && extraTables.length > 0) {
                    // Mark original as primary with group_id
                    await pool.query('UPDATE restaurant_bookings SET group_id = $1, is_primary = true WHERE id = $2', [groupId, booking.id]);
                    // Insert secondary bookings for extra tables
                    for (const t of extraTables) {
                        await pool.query(
                            `INSERT INTO restaurant_bookings (id, restaurant_id, table_id, booking_date, start_time, end_time, guest_count, customer_name, customer_email, customer_phone, remarks, customer_id, group_id, is_primary, status)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $12, false, $13)`,
                            [crypto.randomUUID(), booking.restaurant_id, t.id, booking.booking_date, booking.start_time, booking.end_time, booking.guest_count, booking.customer_name, booking.customer_email, booking.customer_phone, booking.customer_id, groupId, booking.status]
                        );
                    }
                    const totalSeats = booking.table_seats + extraTables.reduce((s, t) => s + t.seats, 0);
                    console.log(`  ✅ Redistributed "${booking.customer_name}" (${booking.guest_count} guests) → ${1 + extraTables.length} tables (${totalSeats} seats)`);
                } else {
                    console.warn(`  ⚠️ Cannot redistribute "${booking.customer_name}" (${booking.guest_count} guests) — not enough free tables`);
                }
            }
        }
    } catch (e) {
        console.warn('⚠️ Oversized booking fix skipped:', e.message);
    }
}

// Start server: run migrations first, then listen
runMigrations().then(() => {
    const server = app.listen(PORT, async () => {
        console.log(`🚀 EVENTS API server running on http://localhost:${PORT}`);
        console.log(`📅 Calendar: http://localhost:${PORT}/api/calendar/demo-restaurant.ics`);
        console.log(`🔐 Auth: POST /api/auth/login`);

        // Diagnostic: check booking data
        try {
            const diag = await pool.query(`
                SELECT COUNT(*) as total, 
                  MIN(booking_date)::text as earliest, MAX(booking_date)::text as latest,
                  COUNT(*) FILTER (WHERE status != 'cancelled') as active,
                  COUNT(*) FILTER (WHERE group_id IS NULL OR is_primary = true) as primary_only
                FROM restaurant_bookings WHERE restaurant_id = 'demo-restaurant'`);
            const d = diag.rows[0];
            console.log(`📊 Booking data: ${d.total} total (${d.active} active, ${d.primary_only} primary), dates: ${d.earliest} → ${d.latest}`);
        } catch (e) { console.warn('📊 Diagnostic failed:', e.message); }
        console.log(`🛡️  Security: Rate limiting, input validation, SERIALIZABLE transactions enabled`);

        // PERF: Self-ping every 4 min to keep Railway warm (eliminates ~1.7s cold start)
        if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT) {
            const selfUrl = process.env.RAILWAY_PUBLIC_DOMAIN
                ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/health`
                : `http://localhost:${PORT}/api/health`;
            setInterval(() => {
                fetch(selfUrl).catch(() => { });
            }, 4 * 60 * 1000); // every 4 minutes
            console.log(`🏓 Self-ping enabled: ${selfUrl} every 4 min`);
        }
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

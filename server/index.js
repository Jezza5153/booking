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
}

// Start server: run migrations first, then listen
runMigrations().then(() => {
    const server = app.listen(PORT, () => {
        console.log(`🚀 EVENTS API server running on http://localhost:${PORT}`);
        console.log(`📅 Calendar: http://localhost:${PORT}/api/calendar/demo-restaurant.ics`);
        console.log(`🔐 Auth: POST /api/auth/login`);
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

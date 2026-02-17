import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import helmet from 'helmet';
import pool from './db-postgres.js';
import { loginHandler, authMiddleware } from './auth.js';
import { loginRateLimiter, bookingRateLimiter, widgetRateLimiter, calendarRateLimiter, isRedisConnected } from './ratelimit.js';
import { initSentry, sentryErrorHandler, captureException } from './sentry.js';
import { sendBookingConfirmation, sendLargeGroupNotification, sendRestaurantBookingConfirmation, sendChefsChoiceNotification } from './email.js';
import { Resend } from 'resend';
import multer from 'multer';

dotenv.config();

// Email config for newsletter (shared with email.js)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'De Tafelaar <reserveren@tafelaaramersfoort.nl>';
const REPLY_TO_EMAIL = 'reserveren@tafelaaramersfoort.nl';
const escapeHtml = (str) => {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

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

// SECURITY: Restrict CORS to known frontend origins
const ALLOWED_ORIGINS = [
    process.env.FRONTEND_URL || 'https://events-widget.vercel.app',
    'http://localhost:5173',  // Vite dev server
    'http://localhost:3000',  // Local dev
];
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (e.g. server-to-server, mobile apps, curl)
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin) || process.env.NODE_ENV === 'development') {
            return callback(null, true);
        }
        // In production, also allow any *.vercel.app preview deploys
        if (origin.endsWith('.vercel.app')) {
            return callback(null, true);
        }
        console.warn(`CORS blocked origin: ${origin}`);
        return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true
}));
app.use(express.json({ limit: '16kb' }));

// Helmet for security headers including CSP
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            // Allow widget to be embedded on any site
            'frame-ancestors': ['*'],
            'connect-src': ["'self'", process.env.ALLOWED_API_ORIGIN || '*'],
        },
    },
    // Allow X-Frame-Options to be overridden by frame-ancestors
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
app.post('/api/auth/login', loginRateLimiter, loginHandler);

// Verify token endpoint
app.get('/api/auth/verify', authMiddleware, (req, res) => {
    res.json({ valid: true, user: req.user });
});

// ============================================
// PUBLIC ROUTES (Rate Limited)
// ============================================

// Input sanitization helper
function sanitizeString(str, maxLength = 100) {
    if (typeof str !== 'string') return '';
    return str.slice(0, maxLength).replace(/[<>"']/g, '');
}

function validateRestaurantId(id) {
    if (typeof id !== 'string') return false;
    // Allow alphanumeric, hyphens, underscores
    return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

// GET /api/widget/:restaurantId - Widget data
app.get('/api/widget/:restaurantId', widgetRateLimiter, async (req, res) => {
    const { restaurantId } = req.params;

    // Validate input
    if (!validateRestaurantId(restaurantId)) {
        return res.status(400).json({ error: 'Invalid restaurant ID format' });
    }

    try {
        // Get restaurant
        const restaurantResult = await pool.query(
            'SELECT id, name, booking_email, handoff_url_base FROM restaurants WHERE id = $1',
            [restaurantId]
        );

        if (restaurantResult.rows.length === 0) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }
        const restaurant = restaurantResult.rows[0];

        // Get zones
        const zonesResult = await pool.query(
            `SELECT id, name, capacity_2_tops as count2tops, capacity_4_tops as count4tops, capacity_6_tops as count6tops
       FROM zones WHERE restaurant_id = $1`,
            [restaurantId]
        );

        // Get active events (SELECT * to handle pre/post migration gracefully)
        const eventsResult = await pool.query(
            `SELECT * FROM events WHERE restaurant_id = $1 AND is_active = true`,
            [restaurantId]
        );

        // FIX #12: Single JOIN query instead of N+1
        const allSlotsResult = await pool.query(
            `SELECT s.id, s.event_id, s.zone_id as "wijkId", s.start_datetime, s.is_highlighted,
                    s.booked_count_2_tops as booked2tops, s.booked_count_4_tops as booked4tops, s.booked_count_6_tops as booked6tops
             FROM slots s
             JOIN events e ON e.id = s.event_id
             WHERE e.restaurant_id = $1 AND e.is_active = true
             ORDER BY s.start_datetime ASC`,
            [restaurantId]
        );

        // Group slots by event_id
        const slotsByEvent = new Map();
        for (const slot of allSlotsResult.rows) {
            if (!slotsByEvent.has(slot.event_id)) slotsByEvent.set(slot.event_id, []);
            slotsByEvent.get(slot.event_id).push(slot);
        }

        // Reusable formatters (created once, not per-slot)
        const dateFormatter = new Intl.DateTimeFormat('nl-NL', {
            weekday: 'short', day: 'numeric', month: 'short',
            timeZone: 'Europe/Amsterdam'
        });
        const timeFormatter = new Intl.DateTimeFormat('nl-NL', {
            hour: '2-digit', minute: '2-digit', hour12: false,
            timeZone: 'Europe/Amsterdam'
        });

        const eventsWithSlots = eventsResult.rows.map(event => {
            const slots = slotsByEvent.get(event.id) || [];
            const formattedSlots = slots.map(slot => {
                const dt = new Date(slot.start_datetime);
                const parts = dateFormatter.formatToParts(dt);
                const weekday = parts.find(p => p.type === 'weekday')?.value || '';
                const day = parts.find(p => p.type === 'day')?.value || '';
                const month = parts.find(p => p.type === 'month')?.value?.replace('.', '') || '';
                const timeStr = timeFormatter.format(dt);

                return {
                    id: slot.id,
                    date: `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} ${day} ${month}`,
                    time: timeStr,
                    start_datetime: slot.start_datetime,
                    isNextAvailable: slot.is_highlighted,
                    wijkId: slot.wijkId,
                    booked2tops: slot.booked2tops,
                    booked4tops: slot.booked4tops,
                    booked6tops: slot.booked6tops
                };
            });

            return {
                id: event.id,
                title: event.title,
                description: event.description || null,
                price_per_person: event.price_per_person ? parseFloat(event.price_per_person) : null,
                slots: formattedSlots
            };
        });

        // Set caching header for widget data (short TTL, fresh data)
        res.set('Cache-Control', 'public, max-age=5, s-maxage=30');
        res.json({ restaurant, zones: zonesResult.rows, events: eventsWithSlots });
    } catch (error) {
        console.error('Widget data error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

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
app.post('/api/book', bookingRateLimiter, async (req, res) => {
    const { slot_id, table_type, guest_count, customer_name, customer_email, customer_phone, remarks, idempotency_key, _hp_field } = req.body;

    // SECURITY: Honeypot field - bots fill this, humans don't
    if (_hp_field) {
        console.log(`[${req.requestId}] Bot detected via honeypot`);
        return res.status(201).json({ success: true, message: 'Booking confirmed' });
    }

    // Input validation with proper 422 responses
    const name = (customer_name || '').trim();
    if (!name) return res.status(422).json({ error: 'customer_name is required' });
    if (name.length > 120) return res.status(422).json({ error: 'customer_name too long' });

    const email = (customer_email || '').trim();
    if (email && email.length > 254) return res.status(422).json({ error: 'customer_email too long' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(422).json({ error: 'Invalid email format' });

    const phone = (customer_phone || '').trim();
    if (phone && phone.length > 30) return res.status(422).json({ error: 'customer_phone too long' });

    const note = (remarks || '').trim();
    if (note && note.length > 1000) return res.status(422).json({ error: 'remarks too long' });

    if (!slot_id || typeof slot_id !== 'string' || slot_id.length > 64) {
        return res.status(422).json({ error: 'slot_id is required' });
    }

    // Allow guest_count from 1-50 (increased for large groups)
    if (!guest_count || typeof guest_count !== 'number' || guest_count < 1 || guest_count > 50) {
        return res.status(422).json({ error: 'guest_count must be 1-50' });
    }

    // Determine if this is a large group (7+)
    const isLargeGroup = guest_count >= 7;

    // For regular bookings (1-6), table_type is required
    // For large groups (7+), table_type is optional (handled manually by restaurant)
    let effectiveTableType = table_type;
    if (!isLargeGroup) {
        if (!['2', '4', '6'].includes(table_type)) {
            return res.status(422).json({ error: 'table_type must be 2, 4, or 6' });
        }
    } else {
        // Large groups: if no table_type provided, set to null (pending allocation)
        effectiveTableType = table_type || null;
    }

    const idem = (idempotency_key || '').trim() || null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // IDEMPOTENCY: Check for existing booking FIRST (before any counter updates)
        if (idem) {
            const existingBooking = await client.query(
                'SELECT id FROM bookings WHERE idempotency_key = $1 LIMIT 1',
                [idem]
            );
            if (existingBooking.rows.length > 0) {
                await client.query('COMMIT');
                console.log(`[${req.requestId}] Idempotent request - returning existing booking`);
                return res.status(200).json({ success: true, booking_id: existingBooking.rows[0].id });
            }
        }
        // Lock slot + fetch capacities via zone
        const slotQ = await client.query(
            `SELECT s.id, s.zone_id, s.start_datetime,
                    s.booked_count_2_tops, s.booked_count_4_tops, s.booked_count_6_tops,
                    COALESCE(s.current_couverts, 0) as current_couverts,
                    z.capacity_2_tops, z.capacity_4_tops, z.capacity_6_tops,
                    z.max_couverts,
                    e.restaurant_id, e.title as event_title, z.name as zone_name
             FROM slots s
             JOIN zones z ON z.id = s.zone_id
             JOIN events e ON e.id = s.event_id
             WHERE s.id = $1
             FOR UPDATE`,
            [slot_id]
        );

        if (slotQ.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'slot not found' });
        }

        const slot = slotQ.rows[0];

        // Prevent booking in the past
        const slotTime = new Date(slot.start_datetime);
        if (slotTime < new Date()) {
            await client.query('ROLLBACK');
            return res.status(422).json({ error: 'cannot book a slot in the past' });
        }

        // Check max_couverts limit if set
        if (slot.max_couverts && (slot.current_couverts + guest_count > slot.max_couverts)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'max_couverts exceeded for this slot' });
        }

        // Calculate available tables
        const available2 = slot.capacity_2_tops - slot.booked_count_2_tops;
        const available4 = slot.capacity_4_tops - slot.booked_count_4_tops;
        const available6 = slot.capacity_6_tops - slot.booked_count_6_tops;

        let tablesAllocated = null;

        // For regular bookings (1-6): check and update single table counter
        if (!isLargeGroup && effectiveTableType) {
            const col =
                effectiveTableType === '2' ? 'booked_count_2_tops' :
                    effectiveTableType === '4' ? 'booked_count_4_tops' :
                        effectiveTableType === '6' ? 'booked_count_6_tops' : null;

            const cap =
                effectiveTableType === '2' ? slot.capacity_2_tops :
                    effectiveTableType === '4' ? slot.capacity_4_tops :
                        effectiveTableType === '6' ? slot.capacity_6_tops : null;

            if (!col || cap == null) {
                await client.query('ROLLBACK');
                return res.status(422).json({ error: 'invalid table_type' });
            }

            // ATOMIC capacity update - only succeeds if capacity remains
            const upd = await client.query(
                `UPDATE slots SET ${col} = ${col} + 1 WHERE id = $1 AND ${col} < $2 RETURNING id`,
                [slot_id, cap]
            );

            if (upd.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'capacity exceeded' });
            }
        } else if (isLargeGroup) {
            // For large groups (7+): auto-allocate tables using greedy algorithm
            const allocation = allocateTables(guest_count, available2, available4, available6);

            if (!allocation) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'not enough tables available for this group size' });
            }

            tablesAllocated = allocation.tables;

            // Update table counters for each allocated table type
            for (const table of allocation.tables) {
                const col = table.seats === 2 ? 'booked_count_2_tops' :
                    table.seats === 4 ? 'booked_count_4_tops' : 'booked_count_6_tops';

                await client.query(
                    `UPDATE slots SET ${col} = ${col} + $1 WHERE id = $2`,
                    [table.count, slot_id]
                );
            }

            console.log(`[${req.requestId}] Large group (${guest_count}) allocated: ${JSON.stringify(allocation.tables)}`);
        }

        // Update current_couverts counter
        await client.query(
            `UPDATE slots SET current_couverts = COALESCE(current_couverts, 0) + $1 WHERE id = $2`,
            [guest_count, slot_id]
        );

        // Generate booking ID
        const bookingId = crypto.randomUUID();

        // Insert booking record with is_large_group flag and tables_allocated
        let insertedBookingId;
        try {
            const inserted = await client.query(
                `INSERT INTO bookings (id, restaurant_id, slot_id, table_type, guest_count,
                                       customer_name, customer_email, customer_phone, remarks, 
                                       idempotency_key, is_large_group, tables_allocated)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                 RETURNING id`,
                [bookingId, slot.restaurant_id, slot_id, effectiveTableType, guest_count,
                    name, email || null, phone || null, note || null, idem, isLargeGroup,
                    tablesAllocated ? JSON.stringify(tablesAllocated) : null]
            );
            insertedBookingId = inserted.rows[0].id;
        } catch (e) {
            // If idempotency conflict (unique violation), fetch existing booking
            if (idem && String(e.code) === '23505') {
                const existing = await client.query(
                    'SELECT id FROM bookings WHERE idempotency_key = $1 LIMIT 1',
                    [idem]
                );
                await client.query('COMMIT');
                console.log(`[${req.requestId}] Idempotent request, returning existing booking`);
                return res.status(200).json({ success: true, booking_id: existing.rows[0]?.id });
            }
            throw e;
        }

        await client.query('COMMIT');

        console.log(`[${req.requestId}] Booking ${insertedBookingId} created for slot ${slot_id} (large_group: ${isLargeGroup})`);

        // Send appropriate email based on group size
        const emailData = {
            customerName: name,
            customerEmail: email || null,
            customerPhone: phone || null,
            remarks: note || null,
            eventTitle: slot.event_title || 'Event',
            slotTime: slotTime.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }),
            slotDate: slotTime.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam' }),
            guestCount: guest_count,
            tableType: effectiveTableType,
            zoneName: slot.zone_name || 'Main',
        };

        if (isLargeGroup) {
            // Large groups get "we will contact you" email
            sendLargeGroupNotification(emailData).catch(err => console.error('Large group email failed:', err));
        } else {
            // Regular bookings get confirmation email
            sendBookingConfirmation(emailData).catch(err => console.error('Email sending failed:', err));
        }

        // Return full booking details for confirmation screen
        return res.status(201).json({
            success: true,
            booking_id: insertedBookingId,
            start_datetime: slot.start_datetime,
            event_title: slot.event_title || 'Event',
            zone_name: slot.zone_name || 'Main',
            customer_name: name,
            guest_count: guest_count,
            table_type: effectiveTableType,
            is_large_group: isLargeGroup,
            message: isLargeGroup ? 'Aanvraag ontvangen - we nemen contact op' : 'Reservering bevestigd'
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[${req.requestId}] Booking error:`, error.message);
        return res.status(500).json({ error: 'internal error' });
    } finally {
        client.release();
    }
});

// GET /api/calendar/:restaurantId.ics - iCal feed (public, rate limited)
app.get('/api/calendar/:restaurantId.ics', calendarRateLimiter, async (req, res) => {
    const restaurantId = req.params.restaurantId.replace('.ics', '');
    const bookedOnly = req.query.booked_only === 'true';

    try {
        const restaurantResult = await pool.query(
            'SELECT * FROM restaurants WHERE id = $1',
            [restaurantId]
        );

        if (restaurantResult.rows.length === 0) {
            return res.status(404).send('Restaurant not found');
        }
        const restaurant = restaurantResult.rows[0];

        const slotsResult = await pool.query(
            `SELECT s.*, e.title as event_title, z.name as zone_name,
              z.capacity_2_tops, z.capacity_4_tops, z.capacity_6_tops,
              ro.slot_duration_minutes
       FROM slots s
       JOIN events e ON s.event_id = e.id
       JOIN zones z ON s.zone_id = z.id
       LEFT JOIN restaurant_openings ro ON ro.restaurant_id = e.restaurant_id
         AND ro.day_of_week = EXTRACT(DOW FROM s.start_datetime)::int
       WHERE e.restaurant_id = $1 AND e.is_active = true
       ORDER BY s.start_datetime ASC`,
            [restaurantId]
        );

        let slots = slotsResult.rows;
        if (bookedOnly) {
            slots = slots.filter(s =>
                s.booked_count_2_tops > 0 || s.booked_count_4_tops > 0 || s.booked_count_6_tops > 0
            );
        }

        let icalContent = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            `PRODID:-//EVENTS//${restaurant.name}//EN`,
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            `X-WR-CALNAME:${restaurant.name} Bookings`,
            'X-WR-TIMEZONE:Europe/Amsterdam'
        ];

        // ICS sanitization helper - prevent injection
        const sanitizeICS = (str) => String(str)
            .replace(/[\r\n]/g, ' ')      // No newlines in field values
            .replace(/[;,\\]/g, '\\$&')   // Escape special chars
            .slice(0, 200);               // Length limit

        for (const slot of slots) {
            const start = new Date(slot.start_datetime);
            // FIX #25: Use slot_duration_minutes from DB instead of hardcoded 2h
            const durationMs = (slot.slot_duration_minutes || 120) * 60 * 1000;
            const end = new Date(start.getTime() + durationMs);
            const formatICalDate = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            const totalBooked = slot.booked_count_2_tops + slot.booked_count_4_tops + slot.booked_count_6_tops;
            const totalCapacity = slot.capacity_2_tops + slot.capacity_4_tops + slot.capacity_6_tops;

            icalContent.push('BEGIN:VEVENT');
            icalContent.push(`UID:${slot.id}@events.app`);
            icalContent.push(`DTSTAMP:${formatICalDate(new Date())}`);
            icalContent.push(`DTSTART:${formatICalDate(start)}`);
            icalContent.push(`DTEND:${formatICalDate(end)}`);
            icalContent.push(`SUMMARY:(${totalBooked}/${totalCapacity}) ${sanitizeICS(slot.event_title)}`);
            icalContent.push(`DESCRIPTION:Zone: ${sanitizeICS(slot.zone_name)}\\n2-Tops: ${slot.booked_count_2_tops}\\n4-Tops: ${slot.booked_count_4_tops}\\n6-Tops: ${slot.booked_count_6_tops}`);
            icalContent.push(`LOCATION:${sanitizeICS(restaurant.name)} - ${sanitizeICS(slot.zone_name)}`);
            icalContent.push('STATUS:CONFIRMED');
            icalContent.push('END:VEVENT');
        }

        icalContent.push('END:VCALENDAR');

        res.set({
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `attachment; filename="${restaurantId}-bookings.ics"`,
            'Cache-Control': 'public, max-age=60'
        });
        res.send(icalContent.join('\r\n'));
    } catch (error) {
        console.error('Calendar error:', error);
        res.status(500).send('Internal server error');
    }
});

// Health check with DB connectivity verification
app.get('/api/health', async (req, res) => {
    try {
        // Verify DB connectivity
        const dbResult = await pool.query('SELECT 1 as ok');
        if (dbResult.rows[0]?.ok !== 1) {
            throw new Error('DB check failed');
        }
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            db: 'connected'
        });
    } catch (error) {
        console.error('Health check failed:', error.message);
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            db: 'disconnected'
        });
    }
});

// GET /api/events - Public events endpoint for widget
app.get('/api/events', async (req, res) => {
    const restaurantId = req.query.restaurantId || 'demo-restaurant';
    try {
        const eventsResult = await pool.query(
            `SELECT * FROM events WHERE restaurant_id = $1 AND is_active = true ORDER BY title`,
            [restaurantId]
        );

        // Get slots for each event
        const eventsWithSlots = await Promise.all(
            eventsResult.rows.map(async (event) => {
                const slotsResult = await pool.query(
                    `SELECT * FROM slots WHERE event_id = $1 ORDER BY start_datetime`,
                    [event.id]
                );
                return { ...event, slots: slotsResult.rows };
            })
        );

        res.json({ events: eventsWithSlots });
    } catch (error) {
        console.error('Failed to fetch events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// ============================================
// PROTECTED ADMIN ROUTES (Auth required)
// ============================================
app.use('/api/admin', authMiddleware);

// Example: Get all events for admin
// P0-7 FIX: Scope to restaurant
app.get('/api/admin/events', async (req, res) => {
    const restaurantId = req.query.restaurantId || 'demo-restaurant';
    try {
        const result = await pool.query(
            'SELECT * FROM events WHERE restaurant_id = $1 ORDER BY title',
            [restaurantId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// P0-3: Dedicated admin data endpoint with raw ISO dates for editing
app.get('/api/admin/data', async (req, res) => {
    const restaurantId = req.query.restaurantId || 'demo-restaurant';
    try {
        // Get zones (including max_couverts for couvert limit)
        const zonesResult = await pool.query(
            `SELECT id, name, 
                    capacity_2_tops as count2tops, 
                    capacity_4_tops as count4tops, 
                    capacity_6_tops as count6tops,
                    max_couverts as "maxCouverts"
             FROM zones WHERE restaurant_id = $1`,
            [restaurantId]
        );

        // Get events with slots (SELECT * handles pre/post migration)
        const eventsResult = await pool.query(
            `SELECT * FROM events WHERE restaurant_id = $1 AND is_active = true`,
            [restaurantId]
        );

        const eventsWithSlots = await Promise.all(
            eventsResult.rows.map(async (event) => {
                const slotsResult = await pool.query(
                    `SELECT id, zone_id as "wijkId", start_datetime, is_highlighted as "isNextAvailable",
                            booked_count_2_tops as booked2tops, booked_count_4_tops as booked4tops, booked_count_6_tops as booked6tops
                     FROM slots WHERE event_id = $1 ORDER BY start_datetime ASC`,
                    [event.id]
                );

                // Return raw data for admin editing (ISO dates)
                const slots = slotsResult.rows.map(slot => {
                    const dt = new Date(slot.start_datetime);
                    // Extract date and time in Amsterdam timezone for admin inputs
                    const dateFormatter = new Intl.DateTimeFormat('en-CA', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        timeZone: 'Europe/Amsterdam'
                    });
                    const timeFormatter = new Intl.DateTimeFormat('nl-NL', {
                        hour: '2-digit', minute: '2-digit', hour12: false,
                        timeZone: 'Europe/Amsterdam'
                    });
                    return {
                        id: slot.id,
                        date: dateFormatter.format(dt), // YYYY-MM-DD format for <input type="date">
                        time: timeFormatter.format(dt), // HH:MM format
                        start_datetime: slot.start_datetime,
                        isNextAvailable: slot.isNextAvailable,
                        wijkId: slot.wijkId,
                        booked2tops: slot.booked2tops,
                        booked4tops: slot.booked4tops,
                        booked6tops: slot.booked6tops
                    };
                });

                return {
                    id: event.id,
                    title: event.title,
                    description: event.description || null,
                    price_per_person: event.price_per_person ? parseFloat(event.price_per_person) : null,
                    slots
                };
            })
        );

        // FIX #26: Admin endpoints should not be cached
        res.set('Cache-Control', 'no-store');
        res.json({ zones: zonesResult.rows, events: eventsWithSlots });
    } catch (error) {
        console.error('Admin data error:', error);
        res.status(500).json({ error: 'Failed to fetch admin data' });
    }
});

// Clear all events and slots (Admin - for fresh start)
// FIX #19: Requires confirm=true to prevent accidental deletion
app.delete('/api/admin/clear', authMiddleware, async (req, res) => {
    const restaurantId = req.query.restaurantId || 'demo-restaurant';
    const confirm = req.query.confirm === 'true';

    if (!confirm) {
        return res.status(400).json({
            error: 'This will delete ALL events and slots. Send confirm=true to proceed.',
            hint: 'DELETE /api/admin/clear?restaurantId=X&confirm=true'
        });
    }

    try {
        // Delete in order: slots -> events (due to foreign keys)
        await pool.query(
            'DELETE FROM slots WHERE event_id IN (SELECT id FROM events WHERE restaurant_id = $1)',
            [restaurantId]
        );
        await pool.query('DELETE FROM events WHERE restaurant_id = $1', [restaurantId]);
        console.log(`✅ All events and slots cleared for ${restaurantId}`);
        res.json({ success: true, message: 'All events and slots cleared' });
    } catch (error) {
        console.error('Clear failed:', error.message);
        res.status(500).json({ error: 'Failed to clear data' });
    }
});

// Cancel a booking (Admin only) - marks cancelled, decrements slot counter
// SECURITY: Tenant-scoped, atomic, race-safe
app.post('/api/admin/bookings/:id/cancel', async (req, res) => {
    const bookingId = req.params.id;
    const restaurantId = req.query.restaurantId || req.body?.restaurantId || 'demo-restaurant';

    // Input validation
    if (!bookingId || typeof bookingId !== 'string') {
        return res.status(422).json({ error: 'Invalid booking ID' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get and lock BOTH booking AND slot (race-safe)
        const bookingResult = await client.query(
            `SELECT b.*, s.booked_count_2_tops, s.booked_count_4_tops, s.booked_count_6_tops
             FROM bookings b
             JOIN slots s ON s.id = b.slot_id
             WHERE b.id = $1 AND b.restaurant_id = $2
             FOR UPDATE OF b, s`,
            [bookingId, restaurantId]
        );

        if (bookingResult.rowCount === 0) {
            await client.query('ROLLBACK');
            // SECURITY: Don't reveal if booking exists but belongs to different restaurant
            return res.status(404).json({ error: 'Booking not found' });
        }

        const booking = bookingResult.rows[0];

        // Idempotent: already cancelled = 409 with no side effects
        if (booking.status === 'cancelled') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Booking already cancelled', cancelled_at: booking.cancelled_at });
        }

        // Mark as cancelled with timestamp
        await client.query(
            `UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = $1`,
            [bookingId]
        );

        // Decrement slot counters
        // For large-group bookings with tables_allocated, decrement each table type
        // For regular bookings, decrement based on table_type
        const colMap = { '2': 'booked_count_2_tops', '4': 'booked_count_4_tops', '6': 'booked_count_6_tops' };

        if (booking.is_large_group && booking.tables_allocated) {
            // Large group: parse tables_allocated JSON and decrement each type
            let tablesAllocated;
            try {
                tablesAllocated = typeof booking.tables_allocated === 'string'
                    ? JSON.parse(booking.tables_allocated)
                    : booking.tables_allocated;
            } catch (e) {
                console.error(`[${req.requestId}] Failed to parse tables_allocated for booking ${bookingId}`);
                tablesAllocated = [];
            }

            for (const table of tablesAllocated) {
                const col = colMap[String(table.seats)];
                if (col) {
                    await client.query(
                        `UPDATE slots SET ${col} = GREATEST(0, ${col} - $1) WHERE id = $2`,
                        [table.count, booking.slot_id]
                    );
                    console.log(`[${req.requestId}] Decremented ${col} by ${table.count} for slot ${booking.slot_id}`);
                }
            }
        } else {
            // Regular booking: decrement single table counter
            const col = colMap[booking.table_type];
            if (col) {
                const currentCount = booking[col] || 0;
                if (currentCount <= 0) {
                    console.warn(`[${req.requestId}] Counter mismatch: ${col} already 0 for slot ${booking.slot_id}, booking ${bookingId}`);
                }
                await client.query(
                    `UPDATE slots SET ${col} = GREATEST(0, ${col} - 1) WHERE id = $1`,
                    [booking.slot_id]
                );
            }
        }

        // FIX #5: Always decrement current_couverts by guest_count
        await client.query(
            `UPDATE slots SET current_couverts = GREATEST(0, COALESCE(current_couverts, 0) - $1) WHERE id = $2`,
            [booking.guest_count, booking.slot_id]
        );

        await client.query('COMMIT');
        console.log(`[${req.requestId}] Booking ${bookingId} cancelled for restaurant ${restaurantId}`);

        return res.status(200).json({ success: true, message: 'Booking cancelled' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[${req.requestId}] Cancel error:`, error.message);
        return res.status(500).json({ error: 'Internal error' });
    } finally {
        client.release();
    }
});

// Get all bookings for admin view with filtering, search, and pagination
// Returns { bookings, total, limit, offset } for proper pagination
app.get('/api/admin/bookings', async (req, res) => {
    const restaurantId = req.query.restaurantId || 'demo-restaurant';
    const from = req.query.from || null; // ISO date string
    const to = req.query.to || null; // ISO date string
    const statusParam = req.query.status || null; // 'confirmed' | 'cancelled' | null (all)
    const search = req.query.q || null; // search term

    // Input validation
    const limitRaw = parseInt(req.query.limit);
    const offsetRaw = parseInt(req.query.offset);

    const limit = isNaN(limitRaw) ? 200 : Math.max(1, Math.min(limitRaw, 500));
    const offset = isNaN(offsetRaw) ? 0 : Math.max(0, offsetRaw);

    // Validate status param
    const validStatuses = ['confirmed', 'cancelled', 'all', null];
    const status = statusParam === 'all' ? null : statusParam;
    if (statusParam && !validStatuses.includes(statusParam)) {
        return res.status(422).json({ error: 'Invalid status. Use: confirmed, cancelled, or all' });
    }

    // Validate date params (if provided, must be parseable)
    if (from && isNaN(Date.parse(from))) {
        return res.status(422).json({ error: 'Invalid from date. Use ISO format: YYYY-MM-DDTHH:mm:ssZ' });
    }
    if (to && isNaN(Date.parse(to))) {
        return res.status(422).json({ error: 'Invalid to date. Use ISO format: YYYY-MM-DDTHH:mm:ssZ' });
    }

    try {
        // Get total count for pagination
        const countResult = await pool.query(
            `SELECT COUNT(*) as total
             FROM bookings b
             JOIN slots s ON s.id = b.slot_id
             JOIN events e ON e.id = s.event_id
             JOIN zones z ON z.id = s.zone_id
             WHERE b.restaurant_id = $1
               AND ($2::timestamptz IS NULL OR s.start_datetime >= $2)
               AND ($3::timestamptz IS NULL OR s.start_datetime < $3)
               AND ($4::text IS NULL OR b.status = $4)
               AND ($5::text IS NULL OR (
                   b.customer_name ILIKE '%' || $5 || '%'
                   OR COALESCE(b.customer_email, '') ILIKE '%' || $5 || '%'
                   OR COALESCE(b.customer_phone, '') ILIKE '%' || $5 || '%'
                   OR COALESCE(b.remarks, '') ILIKE '%' || $5 || '%'
               ))`,
            [restaurantId, from, to, status, search]
        );
        const total = parseInt(countResult.rows[0]?.total) || 0;

        // Get paginated results
        const result = await pool.query(
            `SELECT 
                b.id,
                b.created_at,
                b.status,
                b.customer_name,
                b.customer_email,
                b.customer_phone,
                b.remarks,
                b.guest_count,
                b.table_type,
                b.slot_id,
                s.start_datetime,
                e.title as event_title,
                z.name as zone_name
             FROM bookings b
             JOIN slots s ON s.id = b.slot_id
             JOIN events e ON e.id = s.event_id
             JOIN zones z ON z.id = s.zone_id
             WHERE b.restaurant_id = $1
               AND ($2::timestamptz IS NULL OR s.start_datetime >= $2)
               AND ($3::timestamptz IS NULL OR s.start_datetime < $3)
               AND ($4::text IS NULL OR b.status = $4)
               AND ($5::text IS NULL OR (
                   b.customer_name ILIKE '%' || $5 || '%'
                   OR COALESCE(b.customer_email, '') ILIKE '%' || $5 || '%'
                   OR COALESCE(b.customer_phone, '') ILIKE '%' || $5 || '%'
                   OR COALESCE(b.remarks, '') ILIKE '%' || $5 || '%'
               ))
             ORDER BY s.start_datetime ASC
             LIMIT $6 OFFSET $7`,
            [restaurantId, from, to, status, search, limit, offset]
        );

        res.json({
            bookings: result.rows,
            total,
            limit,
            offset
        });
    } catch (error) {
        console.error('Bookings fetch error:', error.message);
        res.status(500).json({ error: 'Kon boekingen niet ophalen' });
    }
});

// GET /api/admin/stats - Aggregated stats for dashboard (efficient server-side)
app.get('/api/admin/stats', async (req, res) => {
    const restaurantId = req.query.restaurantId || 'demo-restaurant';
    const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const to = req.query.to || new Date().toISOString().split('T')[0];

    try {
        // Daily breakdown
        const dailyResult = await pool.query(
            `SELECT 
                booking_date::text as date,
                COUNT(*) FILTER (WHERE status != 'cancelled') as bookings,
                COALESCE(SUM(guest_count) FILTER (WHERE status != 'cancelled'), 0) as couverts,
                COUNT(*) FILTER (WHERE is_walkin = true AND status != 'cancelled') as walkins,
                COUNT(*) FILTER (WHERE status = 'no_show') as no_shows,
                COUNT(*) FILTER (WHERE status = 'cancelled') as cancellations,
                COUNT(*) FILTER (WHERE status = 'arrived') as arrived
            FROM restaurant_bookings
            WHERE restaurant_id = $1 AND booking_date BETWEEN $2 AND $3
            GROUP BY booking_date
            ORDER BY booking_date`,
            [restaurantId, from, to]
        );

        // Peak hours
        const peakHoursResult = await pool.query(
            `SELECT 
                EXTRACT(HOUR FROM start_time::time) as hour,
                COUNT(*) as count
            FROM restaurant_bookings
            WHERE restaurant_id = $1 AND booking_date BETWEEN $2 AND $3 AND status != 'cancelled'
            GROUP BY EXTRACT(HOUR FROM start_time::time)
            ORDER BY count DESC`,
            [restaurantId, from, to]
        );

        // Average party size
        const avgResult = await pool.query(
            `SELECT 
                ROUND(AVG(guest_count), 1) as avg_party_size,
                COUNT(DISTINCT booking_date) as active_days
            FROM restaurant_bookings
            WHERE restaurant_id = $1 AND booking_date BETWEEN $2 AND $3 AND status != 'cancelled'`,
            [restaurantId, from, to]
        );

        // Busiest day of week
        const busiestDayResult = await pool.query(
            `SELECT 
                EXTRACT(DOW FROM booking_date) as day_of_week,
                COUNT(*) as count
            FROM restaurant_bookings
            WHERE restaurant_id = $1 AND booking_date BETWEEN $2 AND $3 AND status != 'cancelled'
            GROUP BY EXTRACT(DOW FROM booking_date)
            ORDER BY count DESC
            LIMIT 1`,
            [restaurantId, from, to]
        );

        // Totals
        const totals = dailyResult.rows.reduce((acc, row) => ({
            bookings: acc.bookings + parseInt(row.bookings),
            couverts: acc.couverts + parseInt(row.couverts),
            walkins: acc.walkins + parseInt(row.walkins),
            no_shows: acc.no_shows + parseInt(row.no_shows),
            cancellations: acc.cancellations + parseInt(row.cancellations),
            arrived: acc.arrived + parseInt(row.arrived)
        }), { bookings: 0, couverts: 0, walkins: 0, no_shows: 0, cancellations: 0, arrived: 0 });

        const dayNames = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];

        res.json({
            daily: dailyResult.rows,
            totals,
            peak_hours: peakHoursResult.rows.map(r => ({ hour: parseInt(r.hour), count: parseInt(r.count) })),
            avg_party_size: parseFloat(avgResult.rows[0]?.avg_party_size) || 0,
            active_days: parseInt(avgResult.rows[0]?.active_days) || 0,
            busiest_day: busiestDayResult.rows[0] ? dayNames[parseInt(busiestDayResult.rows[0].day_of_week)] : null,
            period: { from, to }
        });
    } catch (error) {
        console.error('Stats error:', error.message);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Reconciliation endpoint - verify slot counters match booking counts
// GET /api/admin/reconcile?restaurantId=xxx&repair=true
app.get('/api/admin/reconcile', async (req, res) => {
    const restaurantId = req.query.restaurantId || 'demo-restaurant';
    const shouldRepair = req.query.repair === 'true';

    try {
        // Get actual booking counts grouped by slot and table type
        const bookingCounts = await pool.query(
            `SELECT 
                b.slot_id,
                b.table_type,
                COUNT(*) as count
             FROM bookings b
             JOIN slots s ON s.id = b.slot_id
             JOIN events e ON e.id = s.event_id
             WHERE e.restaurant_id = $1 AND b.status = 'confirmed'
             GROUP BY b.slot_id, b.table_type`,
            [restaurantId]
        );

        // Get current slot counters
        const slotCounters = await pool.query(
            `SELECT s.id, s.booked_count_2_tops, s.booked_count_4_tops, s.booked_count_6_tops
             FROM slots s
             JOIN events e ON e.id = s.event_id
             WHERE e.restaurant_id = $1`,
            [restaurantId]
        );

        // Build lookup of actual counts
        const actualCounts = {};
        for (const row of bookingCounts.rows) {
            if (!actualCounts[row.slot_id]) {
                actualCounts[row.slot_id] = { '2': 0, '4': 0, '6': 0 };
            }
            actualCounts[row.slot_id][row.table_type] = parseInt(row.count);
        }

        // Compare and find mismatches
        const mismatches = [];
        const repairs = [];

        for (const slot of slotCounters.rows) {
            const actual = actualCounts[slot.id] || { '2': 0, '4': 0, '6': 0 };

            if (slot.booked_count_2_tops !== actual['2']) {
                mismatches.push({
                    slot_id: slot.id,
                    table_type: '2',
                    slot_counter: slot.booked_count_2_tops,
                    actual_bookings: actual['2']
                });
                if (shouldRepair) {
                    repairs.push({ slot_id: slot.id, column: 'booked_count_2_tops', value: actual['2'] });
                }
            }

            if (slot.booked_count_4_tops !== actual['4']) {
                mismatches.push({
                    slot_id: slot.id,
                    table_type: '4',
                    slot_counter: slot.booked_count_4_tops,
                    actual_bookings: actual['4']
                });
                if (shouldRepair) {
                    repairs.push({ slot_id: slot.id, column: 'booked_count_4_tops', value: actual['4'] });
                }
            }

            if (slot.booked_count_6_tops !== actual['6']) {
                mismatches.push({
                    slot_id: slot.id,
                    table_type: '6',
                    slot_counter: slot.booked_count_6_tops,
                    actual_bookings: actual['6']
                });
                if (shouldRepair) {
                    repairs.push({ slot_id: slot.id, column: 'booked_count_6_tops', value: actual['6'] });
                }
            }
        }

        // Apply repairs if requested
        if (shouldRepair && repairs.length > 0) {
            for (const repair of repairs) {
                await pool.query(
                    `UPDATE slots SET ${repair.column} = $1 WHERE id = $2`,
                    [repair.value, repair.slot_id]
                );
            }
            console.log(`✅ Reconciliation: repaired ${repairs.length} slot counters`);
        }

        res.json({
            status: mismatches.length === 0 ? 'ok' : 'mismatches_found',
            total_slots: slotCounters.rows.length,
            mismatches_count: mismatches.length,
            mismatches,
            repaired: shouldRepair ? repairs.length : 0
        });
    } catch (error) {
        console.error('Reconciliation error:', error.message);
        res.status(500).json({ error: 'Reconciliation failed' });
    }
});

// Save zones and events (Admin) - FULL SYNC with SAFETY RAILS
app.post('/api/admin/save', async (req, res) => {
    const { restaurantId, zones, events, force } = req.body;
    const targetRestaurantId = restaurantId || 'demo-restaurant';

    // SAFETY: Reject completely empty payloads
    if ((!zones || zones.length === 0) && (!events || events.length === 0)) {
        if (!force) {
            return res.status(400).json({
                error: 'Empty payload rejected. Send force=true to confirm deletion of all data.',
                warning: 'This would delete ALL zones and events.'
            });
        }
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // SAFETY: Get current counts to check for dangerous deletions
        const currentZonesResult = await client.query(
            'SELECT COUNT(*) as count FROM zones WHERE restaurant_id = $1',
            [targetRestaurantId]
        );
        const currentEventsResult = await client.query(
            'SELECT COUNT(*) as count FROM events WHERE restaurant_id = $1',
            [targetRestaurantId]
        );
        const currentZoneCount = parseInt(currentZonesResult.rows[0].count) || 0;
        const currentEventCount = parseInt(currentEventsResult.rows[0].count) || 0;

        const newZoneCount = (zones || []).length;
        const newEventCount = (events || []).length;

        // SAFETY: Calculate deletions
        const zoneDeleteCount = Math.max(0, currentZoneCount - newZoneCount);
        const eventDeleteCount = Math.max(0, currentEventCount - newEventCount);
        const zoneDeleteRatio = currentZoneCount > 0 ? zoneDeleteCount / currentZoneCount : 0;
        const eventDeleteRatio = currentEventCount > 0 ? eventDeleteCount / currentEventCount : 0;

        // SAFETY RAILS (Fix 5): Block dangerous deletions unless force=true
        // Rule 1: Block if deleting >50% of data
        // Rule 2: Block if deleting more than 2 events (absolute threshold)
        // Rule 3: Block if deleting more than 5 zones (absolute threshold)
        const isDangerousRatio = (zoneDeleteRatio > 0.5 || eventDeleteRatio > 0.5);
        const isDangerousAbsolute = (eventDeleteCount > 2 || zoneDeleteCount > 5);

        if ((isDangerousRatio || isDangerousAbsolute) && !force) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: 'Dangerous operation blocked.',
                warning: `Would delete ${eventDeleteCount} events and ${zoneDeleteCount} zones.`,
                current: { zones: currentZoneCount, events: currentEventCount },
                new: { zones: newZoneCount, events: newEventCount },
                hint: 'Send force=true to confirm this operation.'
            });
        }

        // --- ZONES: Delete zones NOT in payload, then upsert ---
        // CRITICAL FIX: Must delete slots referencing zones BEFORE deleting zones
        // (slots have ON DELETE RESTRICT constraint on zone_id)
        const zoneIds = (zones || []).map(z => z.id);
        if (zoneIds.length > 0) {
            // First, delete any slots that reference zones we're about to delete
            await client.query(
                `DELETE FROM slots WHERE zone_id IN (
                    SELECT id FROM zones WHERE restaurant_id = $1 AND id != ALL($2::text[])
                )`,
                [targetRestaurantId, zoneIds]
            );
            // Now safe to delete zones
            await client.query(
                `DELETE FROM zones WHERE restaurant_id = $1 AND id != ALL($2::text[])`,
                [targetRestaurantId, zoneIds]
            );
        } else if (force) {
            // Only delete all zones if force is set - delete slots first
            await client.query(`DELETE FROM slots WHERE zone_id IN (SELECT id FROM zones WHERE restaurant_id = $1)`, [targetRestaurantId]);
            await client.query(`DELETE FROM zones WHERE restaurant_id = $1`, [targetRestaurantId]);
        }

        // Upsert zones
        for (const zone of zones || []) {
            // Calculate max_couverts if not provided
            const calculatedCouverts = (zone.count2tops || 0) * 2 + (zone.count4tops || 0) * 4 + (zone.count6tops || 0) * 6;
            const maxCouverts = zone.maxCouverts ?? calculatedCouverts;

            await client.query(
                `INSERT INTO zones (id, restaurant_id, name, capacity_2_tops, capacity_4_tops, capacity_6_tops, max_couverts)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (id) DO UPDATE SET
                   name = $3, capacity_2_tops = $4, capacity_4_tops = $5, capacity_6_tops = $6, max_couverts = $7`,
                [zone.id, targetRestaurantId, zone.name, zone.count2tops || 0, zone.count4tops || 0, zone.count6tops || 0, maxCouverts]
            );
        }

        // --- EVENTS: Get current event IDs then delete those not in payload ---
        const eventIds = (events || []).map(e => e.id);
        if (eventIds.length > 0) {
            // Delete events NOT in the payload (slots cascade due to FK)
            await client.query(
                `DELETE FROM slots WHERE event_id IN (SELECT id FROM events WHERE restaurant_id = $1 AND id != ALL($2::text[]))`,
                [targetRestaurantId, eventIds]
            );
            await client.query(
                `DELETE FROM events WHERE restaurant_id = $1 AND id != ALL($2::text[])`,
                [targetRestaurantId, eventIds]
            );
        } else if (force) {
            // Only delete all if force is set
            await client.query(`DELETE FROM slots WHERE event_id IN (SELECT id FROM events WHERE restaurant_id = $1)`, [targetRestaurantId]);
            await client.query(`DELETE FROM events WHERE restaurant_id = $1`, [targetRestaurantId]);
        }

        // --- EVENTS: Upsert each event ---
        for (const event of events || []) {
            await client.query(
                `INSERT INTO events (id, restaurant_id, title, description, price_per_person, is_active)
                 VALUES ($1, $2, $3, $4, $5, true)
                 ON CONFLICT (id) DO UPDATE SET title = $3, description = $4, price_per_person = $5`,
                [event.id, targetRestaurantId, event.title, event.description || null, event.price_per_person || null]
            );

            // --- SLOTS: For this event, sync slots ---
            const slotIds = (event.slots || []).map(s => s.id);
            if (slotIds.length > 0) {
                // Delete slots NOT in this event's payload
                await client.query(
                    `DELETE FROM slots WHERE event_id = $1 AND id != ALL($2::text[])`,
                    [event.id, slotIds]
                );
            } else {
                // No slots = delete all for this event
                await client.query(`DELETE FROM slots WHERE event_id = $1`, [event.id]);
            }

            // Upsert each slot
            for (const slot of event.slots || []) {
                const startDatetime = parseSlotDateTime(slot.date, slot.time);
                await client.query(
                    `INSERT INTO slots (id, event_id, zone_id, start_datetime, is_highlighted, booked_count_2_tops, booked_count_4_tops, booked_count_6_tops)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT (id) DO UPDATE SET
                       zone_id = $3, start_datetime = $4, is_highlighted = $5,
                       booked_count_2_tops = $6, booked_count_4_tops = $7, booked_count_6_tops = $8`,
                    [slot.id, event.id, slot.wijkId, startDatetime, slot.isNextAvailable || false,
                    slot.booked2tops || 0, slot.booked4tops || 0, slot.booked6tops || 0]
                );
            }
        }

        await client.query('COMMIT');
        console.log('✅ Admin save: synced', (events || []).length, 'events');
        res.json({ success: true, message: 'Changes saved successfully' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Save error:', error.message, error.code);

        // P0-8: Handle foreign key violations gracefully
        if (error.code === '23503') {
            return res.status(409).json({
                error: 'Cannot delete zone or event with existing references',
                detail: error.detail || 'Slots or bookings still reference this item. Delete those first.',
                hint: 'Move or delete related slots/bookings before deleting zones or events.'
            });
        }

        res.status(500).json({ error: 'Failed to save changes' });
    } finally {
        client.release();
    }
});

// Helper function to parse slot date/time
// PREFERRED: ISO 8601 format (e.g., "2026-01-20T18:00:00" or "2026-01-20")
// FALLBACK: Dutch format "Di 20 jan" for backwards compatibility
// CRITICAL: All times are interpreted as Amsterdam local time
function parseSlotDateTime(dateStr, timeStr) {
    try {
        // PREFERRED: Check if dateStr is already ISO format
        if (dateStr && dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
            // ISO date format: "2026-01-20" or "2026-01-20T18:00:00"
            if (dateStr.includes('T')) {
                // Full ISO with time - parse as-is
                return new Date(dateStr);
            } else {
                // ISO date only (YYYY-MM-DD), combine with timeStr
                // CRITICAL FIX: Create ISO string with explicit Amsterdam timezone
                // This ensures the time is interpreted correctly regardless of server TZ
                const time = timeStr || '12:00';

                // Determine if DST is in effect for this date in Amsterdam
                // CET = UTC+1, CEST (summer) = UTC+2
                // DST in Netherlands: last Sunday of March to last Sunday of October
                const [year, month, day] = dateStr.split('-').map(Number);
                const testDate = new Date(year, month - 1, day);

                // Simple DST check for Europe/Amsterdam
                const jan = new Date(year, 0, 1);
                const jul = new Date(year, 6, 1);
                const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
                const isDST = testDate.getTimezoneOffset() < stdOffset;

                // For a robust solution, just use the ISO format with Amsterdam offset
                // Winter (CET) = +01:00, Summer (CEST) = +02:00
                // We need to calculate if this specific date is in DST
                const marchLast = new Date(year, 2, 31);
                const marchLastSunday = new Date(marchLast.setDate(31 - marchLast.getDay()));
                const octLast = new Date(year, 9, 31);
                const octLastSunday = new Date(octLast.setDate(31 - octLast.getDay()));

                const dateToCheck = new Date(year, month - 1, day);
                const inDST = dateToCheck >= marchLastSunday && dateToCheck < octLastSunday;
                const offset = inDST ? '+02:00' : '+01:00';

                // Create ISO string with explicit timezone
                const isoString = `${dateStr}T${time}:00${offset}`;
                return new Date(isoString);
            }
        }

        // FALLBACK: Dutch date format "Di 20 jan" or "Ma 14 okt"
        const months = {
            'jan': 0, 'feb': 1, 'mrt': 2, 'apr': 3, 'mei': 4, 'jun': 5,
            'jul': 6, 'aug': 7, 'sep': 8, 'okt': 9, 'nov': 10, 'dec': 11
        };
        const parts = dateStr.split(' ');
        if (parts.length >= 3) {
            const day = parseInt(parts[1]);
            const month = months[parts[2].toLowerCase()] ?? 0;
            let year = new Date().getFullYear();
            const [hours, minutes] = (timeStr || '12:00').split(':').map(Number);

            // Create date and check if it's in the past
            let parsedDate = new Date(year, month, day, hours, minutes);
            const now = new Date();

            // If the date is more than 1 day in the past, it's probably next year
            if (parsedDate < now && (now - parsedDate) > 24 * 60 * 60 * 1000) {
                parsedDate = new Date(year + 1, month, day, hours, minutes);
            }

            return parsedDate;
        }

        // Last resort: return current date with the time
        const [hours, minutes] = (timeStr || '12:00').split(':').map(Number);
        const now = new Date();
        now.setHours(hours, minutes, 0, 0);
        return now;
    } catch (e) {
        console.error('Date parsing error:', e.message);
        return new Date();
    }
}

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

/** Build a Map<tableId, bookingIntervals[]> from a booking query result */
function buildBookingsMap(bookingsRows) {
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
app.get('/api/restaurant/:restaurantId/tables', async (req, res) => {
    const { restaurantId } = req.params;
    try {
        const result = await pool.query(
            `SELECT id, name, seats, zone FROM restaurant_tables 
             WHERE restaurant_id = $1 AND is_active = true 
             ORDER BY zone, name`,
            [restaurantId]
        );
        res.json({ tables: result.rows });
    } catch (error) {
        console.error('Error fetching tables:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/restaurant/:restaurantId/opening-hours - Get opening hours
app.get('/api/restaurant/:restaurantId/opening-hours', async (req, res) => {
    const { restaurantId } = req.params;
    try {
        const result = await pool.query(
            `SELECT day_of_week, open_time, close_time, is_closed 
             FROM restaurant_openings 
             WHERE restaurant_id = $1 AND specific_date IS NULL
             ORDER BY day_of_week`,
            [restaurantId]
        );

        // Map to frontend format
        const openingHours = result.rows.map(row => ({
            dayOfWeek: row.day_of_week,
            open: row.open_time?.substring(0, 5) || '17:00',
            close: row.close_time?.substring(0, 5) || '23:00',
            isOpen: !row.is_closed
        }));

        res.json({ openingHours });
    } catch (error) {
        console.error('Error fetching opening hours:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// WAITLIST API ENDPOINTS
// ============================================

// GET /api/restaurant/:restaurantId/waitlist - Get waitlist entries
app.get('/api/restaurant/:restaurantId/waitlist', authMiddleware, async (req, res) => {
    const { restaurantId } = req.params;
    const { date } = req.query;

    try {
        let query = `SELECT * FROM waitlist WHERE restaurant_id = $1`;
        const params = [restaurantId];

        if (date) {
            query += ` AND date = $2`;
            params.push(date);
        }

        query += ` ORDER BY position ASC, created_at ASC`;

        const result = await pool.query(query, params);
        res.json({ waitlist: result.rows });
    } catch (error) {
        console.error('Error fetching waitlist:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/restaurant/:restaurantId/waitlist - Add to waitlist
app.post('/api/restaurant/:restaurantId/waitlist', bookingRateLimiter, async (req, res) => {
    const { restaurantId } = req.params;
    const { date, time_preference, guest_count, customer_name, phone, email, notes } = req.body;

    if (!date || !guest_count || !customer_name) {
        return res.status(400).json({ error: 'date, guest_count, and customer_name are required' });
    }

    // Input validation
    const name = (customer_name || '').trim();
    if (name.length > 120) return res.status(422).json({ error: 'customer_name too long' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(422).json({ error: 'Invalid email format' });
    if (phone && phone.length > 30) return res.status(422).json({ error: 'phone too long' });

    try {
        const posResult = await pool.query(
            `SELECT COALESCE(MAX(position), 0) + 1 as next_pos FROM waitlist WHERE restaurant_id = $1 AND date = $2`,
            [restaurantId, date]
        );
        const position = posResult.rows[0].next_pos;

        const result = await pool.query(
            `INSERT INTO waitlist (restaurant_id, date, time_preference, guest_count, customer_name, phone, email, notes, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [restaurantId, date, time_preference, guest_count, name, phone, email, notes, position]
        );

        res.status(201).json({ entry: result.rows[0] });
    } catch (error) {
        console.error('Error adding to waitlist:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/restaurant/:restaurantId/waitlist/:id - Update waitlist entry
app.put('/api/restaurant/:restaurantId/waitlist/:id', authMiddleware, async (req, res) => {
    const { restaurantId, id } = req.params;
    const { status, notes } = req.body;

    try {
        const result = await pool.query(
            `UPDATE waitlist SET status = COALESCE($1, status), notes = COALESCE($2, notes)
             WHERE id = $3 AND restaurant_id = $4
             RETURNING *`,
            [status, notes, id, restaurantId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Waitlist entry not found' });
        }

        res.json({ entry: result.rows[0] });
    } catch (error) {
        console.error('Error updating waitlist:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/restaurant/:restaurantId/waitlist/:id - Remove from waitlist
app.delete('/api/restaurant/:restaurantId/waitlist/:id', authMiddleware, async (req, res) => {
    const { restaurantId, id } = req.params;

    try {
        const result = await pool.query(
            `DELETE FROM waitlist WHERE id = $1 AND restaurant_id = $2 RETURNING id`,
            [id, restaurantId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Waitlist entry not found' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting from waitlist:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/restaurant/:restaurantId/tables - Update tables (replace all)
app.put('/api/restaurant/:restaurantId/tables', authMiddleware, async (req, res) => {
    const { restaurantId } = req.params;
    const { tables } = req.body;

    if (!Array.isArray(tables)) {
        return res.status(400).json({ error: 'Tables must be an array' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verify ownership (optional but recommended)
        // const check = await client.query('SELECT 1 FROM users WHERE id = $1 AND restaurant_id = $2', [req.user.id, restaurantId]);

        // Soft delete all existing tables for this restaurant
        await client.query(
            'UPDATE restaurant_tables SET is_active = false WHERE restaurant_id = $1',
            [restaurantId]
        );

        // Upsert new tables
        for (const table of tables) {
            await client.query(
                `INSERT INTO restaurant_tables (id, restaurant_id, name, seats, zone, is_active)
                 VALUES ($1, $2, $3, $4, $5, true)
                 ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    seats = EXCLUDED.seats,
                    zone = EXCLUDED.zone,
                    is_active = true`,
                [table.id, restaurantId, table.name, table.seats, table.zone || 'Main']
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, count: tables.length });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating tables:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// GET /api/restaurant/:restaurantId/availability - Get available time slots
app.get('/api/restaurant/:restaurantId/availability', async (req, res) => {
    const { restaurantId } = req.params;
    const { date, guests } = req.query;

    console.log(`🔍 Availability request: restaurant=${restaurantId}, date=${date}, guests=${guests}`);

    if (!date) {
        return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
    }

    const guestCount = parseInt(guests) || 2;
    // Parse date parts manually to avoid UTC timezone shift issues
    // new Date('2026-03-02') creates UTC midnight, which in CET (+1) is still March 1 → wrong dayOfWeek
    const [year, month, dayNum] = date.split('-').map(Number);
    const bookingDate = new Date(year, month - 1, dayNum); // Local date, no timezone shift
    const dayOfWeek = bookingDate.getDay();
    console.log(`🔍 Parsed: date=${date}, dayOfWeek=${dayOfWeek} (0=Sun, 5=Fri, 6=Sat)`);

    try {
        // Get opening hours
        let openingResult = await pool.query(
            `SELECT open_time, close_time, slot_duration_minutes, is_closed 
             FROM restaurant_openings 
             WHERE restaurant_id = $1 AND (day_of_week = $2 OR specific_date = $3)
             ORDER BY specific_date DESC NULLS LAST LIMIT 1`,
            [restaurantId, dayOfWeek, date]
        );

        // AUTO-PROVISION: Only for authenticated admin users (prevents data injection)
        if (openingResult.rowCount === 0 && req.headers.authorization) {
            console.log(`📋 Auto-provisioning opening hours for restaurant: ${restaurantId}`);

            // Create default opening hours (Mon-Sun 17:00-22:00)
            const defaultOpenings = [
                { day: 0, open: '17:00', close: '22:00' }, // Sunday
                { day: 1, open: '17:00', close: '22:00' }, // Monday
                { day: 2, open: '17:00', close: '22:00' }, // Tuesday
                { day: 3, open: '17:00', close: '22:00' }, // Wednesday
                { day: 4, open: '17:00', close: '23:00' }, // Thursday
                { day: 5, open: '17:00', close: '23:00' }, // Friday
                { day: 6, open: '17:00', close: '23:00' }, // Saturday
            ];

            for (const o of defaultOpenings) {
                await pool.query(
                    `INSERT INTO restaurant_openings (restaurant_id, day_of_week, open_time, close_time, slot_duration_minutes)
                     VALUES ($1, $2, $3, $4, 90) ON CONFLICT DO NOTHING`,
                    [restaurantId, o.day, o.open, o.close]
                );
            }

            // Create default tables if none exist
            const tablesCheck = await pool.query(
                'SELECT COUNT(*) FROM restaurant_tables WHERE restaurant_id = $1',
                [restaurantId]
            );

            if (parseInt(tablesCheck.rows[0].count) === 0) {
                console.log(`📋 Auto-provisioning tables for restaurant: ${restaurantId}`);

                const defaultTables = [
                    { name: 'Tafel 1', seats: 2 },
                    { name: 'Tafel 2', seats: 2 },
                    { name: 'Tafel 3', seats: 4 },
                    { name: 'Tafel 4', seats: 4 },
                    { name: 'Tafel 5', seats: 6 },
                    { name: 'Tafel 6', seats: 6 },
                    { name: 'Chef\'s Table', seats: 12 },
                ];

                for (let i = 0; i < defaultTables.length; i++) {
                    const t = defaultTables[i];
                    await pool.query(
                        `INSERT INTO restaurant_tables (id, restaurant_id, name, seats, zone, is_active)
                         VALUES ($1, $2, $3, $4, 'Binnen', true) ON CONFLICT DO NOTHING`,
                        [`${restaurantId}-t${i + 1}`, restaurantId, t.name, t.seats]
                    );
                }
            }

            // Re-fetch opening hours after provisioning
            openingResult = await pool.query(
                `SELECT open_time, close_time, slot_duration_minutes, is_closed 
                 FROM restaurant_openings 
                 WHERE restaurant_id = $1 AND day_of_week = $2
                 LIMIT 1`,
                [restaurantId, dayOfWeek]
            );
        }

        // If still no opening hours (unauthenticated or provisioning failed), return empty
        if (openingResult.rowCount === 0) {
            return res.json({ slots: [], message: 'No opening hours configured for this restaurant' });
        }

        if (openingResult.rows[0].is_closed) {
            return res.json({ slots: [], message: 'Restaurant is closed' });
        }

        const { open_time, close_time } = openingResult.rows[0];

        // Get ALL active tables (sorted seats DESC for greedy combo)
        const tablesResult = await pool.query(
            `SELECT id, name, seats, zone FROM restaurant_tables 
             WHERE restaurant_id = $1 AND is_active = true
             ORDER BY seats DESC`,
            [restaurantId]
        );
        const allTables = tablesResult.rows;

        // Prefetch all bookings for this day, build lookup map
        const bookingsResult = await pool.query(
            `SELECT table_id, to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time
             FROM restaurant_bookings 
             WHERE restaurant_id = $1 AND booking_date = $2 AND lower(status) != 'cancelled'`,
            [restaurantId, date]
        );
        const bookingsByTableId = buildBookingsMap(bookingsResult.rows);

        // Generate time slots
        const slots = [];
        const openMins = timeToMins(open_time);
        const closeMins = timeToMins(close_time);

        // Check if booking is for today - filter out past times
        const now = new Date();
        const isToday = bookingDate.toDateString() === now.toDateString();
        const currentMins = isToday ? now.getHours() * 60 + now.getMinutes() : 0;

        for (let m = openMins; m < closeMins; m += SLOT_STEP_MINS) {
            // Skip past time slots for today
            if (isToday && m <= currentMins) continue;

            const slotStart = minsToTime(m);
            const slotEndMins = Math.min(m + BOOKING_DURATION_MINS, closeMins);
            const slotEnd = minsToTime(slotEndMins);

            // Use the SAME selection logic as the booking endpoint
            const picked = selectTablesForSlot({ allTables, bookingsByTableId, slotStart, slotEnd, guestCount });
            if (picked) {
                const seatsTotal = picked.reduce((s, t) => s + t.seats, 0);
                slots.push({ time: slotStart, end_time: slotEnd, available: 1, tables_needed: picked.length, seats_total: seatsTotal });
            }
        }

        res.json({ date, guest_count: guestCount, close_time: close_time, slots });
    } catch (error) {
        console.error('Restaurant availability error:', error);
        res.status(500).json({ error: 'Failed to check availability' });
    }
});

// POST /api/restaurant/book - Book a table
app.post('/api/restaurant/book', bookingRateLimiter, async (req, res) => {
    const { restaurant_id, date, time, guest_count, customer_name, customer_email, customer_phone, remarks, newsletter_opt_in } = req.body;

    if (!restaurant_id || !date || !time || !guest_count || !customer_name || !customer_email) {
        return res.status(400).json({ error: 'Missing required fields (including email)' });
    }

    // Validate guest count (max 12 for restaurant bookings)
    if (guest_count < 1 || guest_count > 12) {
        return res.status(400).json({ error: 'Guest count must be between 1 and 12' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get closing time
        const dayOfWeek = new Date(date).getDay();
        const openingQ = await client.query(
            `SELECT close_time FROM restaurant_openings WHERE restaurant_id = $1 AND day_of_week = $2 LIMIT 1`,
            [restaurant_id, dayOfWeek]
        );
        const closeTime = openingQ.rows[0]?.close_time || '23:59';
        const endTime = computeEndTime(time, closeTime);

        // Reject bookings at or after closing time (zero-length booking)
        if (timeToMins(endTime) <= timeToMins(time)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Buiten openingstijden' });
        }

        // 1) Fetch ALL active tables
        const allTablesQ = await client.query(
            `SELECT id, name, seats, zone FROM restaurant_tables
             WHERE restaurant_id = $1 AND is_active = true
             ORDER BY seats DESC`,
            [restaurant_id]
        );
        const allTables = allTablesQ.rows;

        // 2) Fetch existing bookings for this date, build map
        const bookingsQ = await client.query(
            `SELECT table_id, to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time
             FROM restaurant_bookings
             WHERE restaurant_id = $1 AND booking_date = $2 AND lower(status) != 'cancelled'`,
            [restaurant_id, date]
        );
        const bookingsByTableId = buildBookingsMap(bookingsQ.rows);

        // 3) Use centralized selection (identical logic to availability endpoint)
        const selectedTables = selectTablesForSlot({ allTables, bookingsByTableId, slotStart: time, slotEnd: endTime, guestCount: guest_count });
        if (!selectedTables) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Geen tafels beschikbaar' });
        }

        // 4) Lock the selected table rows to prevent concurrent double-booking
        //    Sort for stable lock order (prevents deadlocks)
        const tableIds = selectedTables.map(t => t.id).sort();
        await client.query(
            `SELECT id FROM restaurant_tables WHERE id::text = ANY($1::text[]) ORDER BY id FOR UPDATE`,
            [tableIds]
        );

        // 5) Re-check overlap AFTER acquiring locks (prevents race condition)
        const overlapCheck = await client.query(
            `SELECT 1 FROM restaurant_bookings
             WHERE restaurant_id = $1 AND table_id::text = ANY($2::text[])
             AND booking_date = $3 AND lower(status) != 'cancelled'
             AND start_time < $5 AND end_time > $4
             LIMIT 1`,
            [restaurant_id, tableIds, date, time, endTime]
        );
        if (overlapCheck.rowCount > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Slot net geboekt door iemand anders. Kies een andere tijd.' });
        }

        // 6) Auto-create or find customer profile (CRM) — only once per group
        let customerId = null;
        try {
            if (customer_email || customer_phone) {
                const existingCustomer = await client.query(
                    `SELECT id FROM customers WHERE restaurant_id = $1 AND (email = $2 OR phone = $3) LIMIT 1`,
                    [restaurant_id, customer_email || '', customer_phone || '']
                );
                if (existingCustomer.rowCount > 0) {
                    customerId = existingCustomer.rows[0].id;
                    await client.query(
                        `UPDATE customers SET name = $1, newsletter_opt_in = COALESCE($2, newsletter_opt_in), updated_at = NOW() WHERE id = $3`,
                        [customer_name, newsletter_opt_in ?? null, customerId]
                    );
                } else {
                    customerId = crypto.randomUUID();
                    await client.query(
                        `INSERT INTO customers (id, restaurant_id, name, email, phone, newsletter_opt_in) VALUES ($1, $2, $3, $4, $5, $6)`,
                        [customerId, restaurant_id, customer_name, customer_email || null, customer_phone || null, newsletter_opt_in ?? false]
                    );
                }
            }
        } catch (custErr) {
            console.warn('Customer profile creation failed (non-fatal):', custErr.message);
        }

        // 7) Insert booking rows — one per table, linked by group_id
        const groupId = crypto.randomUUID();
        const primaryBookingId = crypto.randomUUID();
        for (let i = 0; i < selectedTables.length; i++) {
            const tbl = selectedTables[i];
            const rowId = i === 0 ? primaryBookingId : crypto.randomUUID();
            const isPrimary = i === 0;
            await client.query(
                `INSERT INTO restaurant_bookings (id, restaurant_id, table_id, booking_date, start_time, end_time, guest_count, customer_name, customer_email, customer_phone, remarks, customer_id, group_id, is_primary)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                [rowId, restaurant_id, tbl.id, date, time, endTime, guest_count, customer_name, customer_email, customer_phone, isPrimary ? remarks : null, customerId, groupId, isPrimary]
            );
        }

        await client.query('COMMIT');

        // Build table name string for email/response
        const tableNames = selectedTables.map(t => t.name).join(' + ');

        // 8) Send confirmation email ONCE (is_primary row only)
        const formattedDate = new Date(date).toLocaleDateString('nl-NL', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });

        const emailData = {
            customerName: customer_name,
            customerEmail: customer_email,
            customerPhone: customer_phone || null,
            remarks: remarks || null,
            tableName: tableNames,
            bookingDate: formattedDate,
            bookingTime: time,
            guestCount: guest_count,
        };

        if (guest_count >= 7) {
            sendChefsChoiceNotification(emailData).catch(err => console.error('Chef\'s Choice email failed:', err));
        } else {
            sendRestaurantBookingConfirmation(emailData).catch(err => console.error('Restaurant email failed:', err));
        }

        res.status(201).json({ success: true, booking_id: primaryBookingId, group_id: groupId, table_name: tableNames, tables_used: selectedTables.length, date, time });
    } catch (error) {
        await client.query('ROLLBACK');
        // SQLSTATE 23P01 = exclusion_violation (DB-level overlap constraint fired)
        if (error.code === '23P01') {
            return res.status(409).json({ error: 'Slot net geboekt door iemand anders. Kies een andere tijd.' });
        }
        console.error('Restaurant booking error:', error);
        res.status(500).json({ error: 'Booking failed' });
    } finally {
        client.release();
    }
});

// GET /api/admin/restaurant-bookings - Get bookings for timeline grid
app.get('/api/admin/restaurant-bookings', authMiddleware, async (req, res) => {
    const { restaurantId, date } = req.query;
    const targetRestaurantId = restaurantId || 'demo-restaurant';
    const targetDate = date || new Date().toISOString().split('T')[0];

    try {
        const result = await pool.query(
            `SELECT rb.id, rb.table_id, rb.start_time::text, rb.end_time::text, 
                    rb.guest_count, rb.customer_name, rb.status, rt.name as table_name
             FROM restaurant_bookings rb
             JOIN restaurant_tables rt ON rt.id = rb.table_id
             WHERE rb.restaurant_id = $1 AND rb.booking_date = $2 AND rb.status != 'cancelled'
             ORDER BY rb.start_time ASC`,
            [targetRestaurantId, targetDate]
        );
        res.json({ bookings: result.rows, date: targetDate });
    } catch (error) {
        console.error('Admin restaurant bookings error:', error);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});

// PATCH /api/admin/restaurant-bookings/:id/status - Update booking status
app.patch('/api/admin/restaurant-bookings/:id/status', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['confirmed', 'arrived', 'no_show', 'cancelled', 'walkin'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        const arrivedAt = status === 'arrived' ? 'NOW()' : 'NULL';
        const result = await pool.query(
            `UPDATE restaurant_bookings 
             SET status = $1, arrived_at = ${status === 'arrived' ? 'NOW()' : 'NULL'}, updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [status, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // Update customer visit count if arrived
        if (status === 'arrived' && result.rows[0].customer_id) {
            await pool.query(
                `UPDATE customers SET total_visits = total_visits + 1, last_visit = CURRENT_DATE WHERE id = $1`,
                [result.rows[0].customer_id]
            );
        }

        res.json({ success: true, booking: result.rows[0] });
    } catch (error) {
        console.error('Update booking status error:', error);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// POST /api/admin/bookings - Create event booking from admin panel
app.post('/api/admin/bookings', authMiddleware, async (req, res) => {
    try {
        const { restaurantId, eventId, customer_name, customer_email, customer_phone, guest_count, remarks } = req.body;

        if (!restaurantId || !eventId || !customer_name || !guest_count) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Get or create customer
        let customerId = null;
        if (customer_email || customer_phone) {
            const existingCustomer = await pool.query(
                `SELECT id FROM customers WHERE restaurant_id = $1 AND (email = $2 OR phone = $3) LIMIT 1`,
                [restaurantId, customer_email || '', customer_phone || '']
            );
            if (existingCustomer.rows.length > 0) {
                customerId = existingCustomer.rows[0].id;
            } else {
                const newCustomer = await pool.query(
                    `INSERT INTO customers (id, restaurant_id, name, email, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                    [crypto.randomUUID(), restaurantId, customer_name, customer_email || null, customer_phone || null]
                );
                customerId = newCustomer.rows[0].id;
            }
        }

        // Get event start datetime
        const eventResult = await pool.query(
            `SELECT start_datetime FROM slots WHERE event_id = $1 ORDER BY start_datetime LIMIT 1`,
            [eventId]
        );
        const startDatetime = eventResult.rows[0]?.start_datetime || new Date();

        // Create booking — table_type is optional (NULL allowed for admin bookings)
        const bookingId = crypto.randomUUID();
        const tableType = guest_count <= 2 ? '2' : guest_count <= 4 ? '4' : guest_count <= 6 ? '6' : null;
        await pool.query(
            `INSERT INTO bookings (id, restaurant_id, slot_id, customer_id, table_type, customer_name, customer_email, customer_phone, guest_count, status, idempotency_key, remarks, created_at)
             VALUES ($1, $2, (SELECT id FROM slots WHERE event_id = $3 LIMIT 1), $4, $5, $6, $7, $8, $9, 'confirmed', $10, $11, NOW())`,
            [bookingId, restaurantId, eventId, customerId, tableType, customer_name, customer_email || null, customer_phone || null, guest_count, crypto.randomUUID(), remarks || null]
        );

        res.json({ success: true, booking_id: bookingId });
    } catch (error) {
        console.error('Admin event booking error:', error);
        res.status(500).json({ error: 'Failed to create booking' });
    }
});

// POST /api/admin/restaurant-bookings - Create restaurant booking from admin panel
app.post('/api/admin/restaurant-bookings', authMiddleware, async (req, res) => {
    const { restaurantId, date, time, customer_name, customer_email, customer_phone, guest_count, remarks } = req.body;

    if (!restaurantId || !date || !time || !customer_name || !guest_count) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get closing time
        const dayOfWeek = new Date(date).getDay();
        const openingQ = await client.query(
            `SELECT close_time FROM restaurant_openings WHERE restaurant_id = $1 AND day_of_week = $2 LIMIT 1`,
            [restaurantId, dayOfWeek]
        );
        const closeTime = openingQ.rows[0]?.close_time || '23:59';
        const endTime = computeEndTime(time, closeTime);

        // Reject bookings at or after closing time (zero-length booking)
        if (timeToMins(endTime) <= timeToMins(time)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Buiten openingstijden' });
        }

        // 1) Fetch ALL active tables
        const allTablesQ = await client.query(
            `SELECT id, name, seats, zone FROM restaurant_tables
             WHERE restaurant_id = $1 AND is_active = true
             ORDER BY seats DESC`,
            [restaurantId]
        );
        const allTables = allTablesQ.rows;

        // 2) Fetch existing bookings, build map
        const bookingsQ = await client.query(
            `SELECT table_id, to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time
             FROM restaurant_bookings
             WHERE restaurant_id = $1 AND booking_date = $2 AND lower(status) != 'cancelled'`,
            [restaurantId, date]
        );
        const bookingsByTableId = buildBookingsMap(bookingsQ.rows);

        // 3) Use centralized selection (identical to availability + public booking)
        const selectedTables = selectTablesForSlot({ allTables, bookingsByTableId, slotStart: time, slotEnd: endTime, guestCount: guest_count });
        if (!selectedTables) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'No tables available for this time slot' });
        }

        // 4) Lock selected table rows (sorted for stable lock order — prevents deadlocks)
        const tableIds = selectedTables.map(t => t.id).sort();
        await client.query(
            `SELECT id FROM restaurant_tables WHERE id::text = ANY($1::text[]) ORDER BY id FOR UPDATE`,
            [tableIds]
        );

        // 5) Re-check overlap after lock
        const overlapCheck = await client.query(
            `SELECT 1 FROM restaurant_bookings
             WHERE restaurant_id = $1 AND table_id::text = ANY($2::text[])
             AND booking_date = $3 AND lower(status) != 'cancelled'
             AND start_time < $5 AND end_time > $4
             LIMIT 1`,
            [restaurantId, tableIds, date, time, endTime]
        );
        if (overlapCheck.rowCount > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Tables just booked by someone else' });
        }

        // 6) Get or create customer
        let customerId = null;
        if (customer_email || customer_phone) {
            const existingCustomer = await client.query(
                `SELECT id FROM customers WHERE restaurant_id = $1 AND (email = $2 OR phone = $3) LIMIT 1`,
                [restaurantId, customer_email || '', customer_phone || '']
            );
            if (existingCustomer.rows.length > 0) {
                customerId = existingCustomer.rows[0].id;
            } else {
                const newCustomer = await client.query(
                    `INSERT INTO customers (id, restaurant_id, name, email, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                    [crypto.randomUUID(), restaurantId, customer_name, customer_email || null, customer_phone || null]
                );
                customerId = newCustomer.rows[0].id;
            }
        }

        // 7) Insert booking rows with group_id/is_primary
        const groupId = crypto.randomUUID();
        const primaryBookingId = crypto.randomUUID();
        for (let i = 0; i < selectedTables.length; i++) {
            const tbl = selectedTables[i];
            const rowId = i === 0 ? primaryBookingId : crypto.randomUUID();
            const isPrimary = i === 0;
            await client.query(
                `INSERT INTO restaurant_bookings (id, restaurant_id, table_id, customer_id, customer_name, customer_email, customer_phone, guest_count, booking_date, start_time, end_time, status, remarks, group_id, is_primary, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'confirmed', $12, $13, $14, NOW())`,
                [rowId, restaurantId, tbl.id, customerId, customer_name, customer_email || null, customer_phone || null, guest_count, date, time, endTime, isPrimary ? (remarks || null) : null, groupId, isPrimary]
            );
        }

        await client.query('COMMIT');

        const tableNames = selectedTables.map(t => t.name).join(' + ');
        res.json({ success: true, booking_id: primaryBookingId, group_id: groupId, table_name: tableNames, tables_used: selectedTables.length });
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23P01') {
            return res.status(409).json({ error: 'Tables just booked by someone else' });
        }
        console.error('Admin restaurant booking error:', error);
        res.status(500).json({ error: 'Failed to create booking' });
    } finally {
        client.release();
    }
});

// GET /api/admin/day-notes - Get day notes
app.get('/api/admin/day-notes', authMiddleware, async (req, res) => {
    const { restaurantId, date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    try {
        const result = await pool.query(
            `SELECT id, note, created_at FROM day_notes 
             WHERE restaurant_id = $1 AND date = $2 ORDER BY created_at DESC`,
            [restaurantId || 'demo-restaurant', targetDate]
        );
        res.json({ notes: result.rows, date: targetDate });
    } catch (error) {
        // Table might not exist yet
        console.error('Get day notes error:', error);
        res.json({ notes: [], date: targetDate });
    }
});

// POST /api/admin/day-notes - Add day note
app.post('/api/admin/day-notes', authMiddleware, async (req, res) => {
    const { restaurantId, date, note } = req.body;

    if (!note || !note.trim()) {
        return res.status(400).json({ error: 'Note text required' });
    }

    try {
        const id = crypto.randomUUID();
        await pool.query(
            `INSERT INTO day_notes (id, restaurant_id, date, note, created_by) VALUES ($1, $2, $3, $4, $5)`,
            [id, restaurantId || 'demo-restaurant', date || new Date().toISOString().split('T')[0], note.trim(), req.user?.username || 'admin']
        );
        res.status(201).json({ success: true, id });
    } catch (error) {
        console.error('Add day note error:', error);
        res.status(500).json({ error: 'Failed to add note' });
    }
});

// DELETE /api/admin/day-notes/:id - Delete day note
app.delete('/api/admin/day-notes/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;

    try {
        await pool.query('DELETE FROM day_notes WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete day note error:', error);
        res.status(500).json({ error: 'Failed to delete note' });
    }
});

// GET /api/admin/customers/search - Search customers
app.get('/api/admin/customers/search', authMiddleware, async (req, res) => {
    const { restaurantId, q } = req.query;

    if (!q || q.length < 2) {
        return res.json({ customers: [] });
    }

    try {
        const result = await pool.query(
            `SELECT id, name, email, phone, total_visits, tags, dietary_notes 
             FROM customers 
             WHERE restaurant_id = $1 AND (
                 name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2
             ) ORDER BY total_visits DESC LIMIT 10`,
            [restaurantId || 'demo-restaurant', `%${q}%`]
        );
        res.json({ customers: result.rows });
    } catch (error) {
        // Table might not exist yet
        console.error('Customer search error:', error);
        res.json({ customers: [] });
    }
});

// GET /api/restaurant/:id/openings - Get opening hours for a restaurant
app.get('/api/restaurant/:id/openings', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `SELECT day_of_week as day, NOT is_closed as is_open, 
                    open_time::text as open_time, close_time::text as close_time
             FROM restaurant_openings 
             WHERE restaurant_id = $1 
             ORDER BY day_of_week`,
            [id]
        );
        res.json({ openings: result.rows });
    } catch (error) {
        console.error('Get openings error:', error);
        res.json({ openings: [] });
    }
});

// NOTE: Duplicate POST /api/restaurant/book route removed (audit fix #1).
// Multi-table booking is handled via POST /api/admin/restaurant-bookings.

// POST /api/admin/restaurant-settings - Save restaurant tables & settings
app.post('/api/admin/restaurant-settings', authMiddleware, async (req, res) => {
    const { restaurantId, tables, openingHours, settings } = req.body;
    // DEBUG log removed (audit fix #27)

    if (!restaurantId) {
        return res.status(400).json({ error: 'restaurantId required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Upsert tables
        if (tables && Array.isArray(tables)) {
            // Get existing table IDs
            const existing = await client.query(
                'SELECT id FROM restaurant_tables WHERE restaurant_id = $1',
                [restaurantId]
            );
            const existingIds = existing.rows.map(r => r.id);
            const newIds = tables.map(t => t.id);

            // Delete removed tables
            const toDelete = existingIds.filter(id => !newIds.includes(id));
            if (toDelete.length > 0) {
                await client.query(
                    'DELETE FROM restaurant_tables WHERE id = ANY($1)',
                    [toDelete]
                );
            }

            // Upsert tables
            for (const table of tables) {
                await client.query(`
                    INSERT INTO restaurant_tables (id, restaurant_id, name, seats, zone)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        seats = EXCLUDED.seats,
                        zone = EXCLUDED.zone
                `, [table.id, restaurantId, table.name, table.seats, table.zone || 'Binnen']);
            }
        }

        // Upsert opening hours
        if (openingHours && Array.isArray(openingHours)) {
            // Delete existing and re-insert
            await client.query(
                'DELETE FROM restaurant_openings WHERE restaurant_id = $1',
                [restaurantId]
            );

            for (const hour of openingHours) {
                if (hour.isOpen) {
                    await client.query(`
                        INSERT INTO restaurant_openings 
                        (restaurant_id, day_of_week, open_time, close_time, is_closed)
                        VALUES ($1, $2, $3, $4, false)
                    `, [restaurantId, hour.dayOfWeek, hour.open, hour.close]);
                } else {
                    await client.query(`
                        INSERT INTO restaurant_openings 
                        (restaurant_id, day_of_week, open_time, close_time, is_closed)
                        VALUES ($1, $2, '00:00', '00:00', true)
                    `, [restaurantId, hour.dayOfWeek]);
                }
            }
        }

        // TODO: Save settings (slotDuration, maxPartySize, bufferTime) to a restaurant_settings table

        await client.query('COMMIT');
        res.json({ success: true, message: 'Restaurant settings saved' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Save restaurant settings error:', error);
        res.status(500).json({ error: 'Failed to save restaurant settings' });
    } finally {
        client.release();
    }
});

// ============================================
// NEWSLETTER / EMAIL LIST ENDPOINTS
// ============================================

// GET /api/admin/newsletter/subscribers - Get all customer emails for mailing list
app.get('/api/admin/newsletter/subscribers', authMiddleware, async (req, res) => {
    const restaurantId = req.query.restaurantId || 'demo-restaurant';
    try {
        const result = await pool.query(
            `SELECT c.id, c.name, c.email, c.phone, c.newsletter_opt_in, c.total_visits, c.tags, c.dietary_notes, c.created_at,
                    (SELECT MAX(rb.booking_date) FROM restaurant_bookings rb WHERE rb.customer_id = c.id) as last_visit
             FROM customers c
             WHERE c.restaurant_id = $1 AND c.email IS NOT NULL AND c.email != ''
             ORDER BY c.created_at DESC`,
            [restaurantId]
        );

        const subscribers = result.rows;
        const optedIn = subscribers.filter(s => s.newsletter_opt_in === true);

        res.json({
            total: subscribers.length,
            opted_in: optedIn.length,
            opted_out: subscribers.length - optedIn.length,
            subscribers
        });
    } catch (error) {
        console.error('Newsletter subscribers error:', error.message);
        res.status(500).json({ error: 'Failed to fetch subscribers' });
    }
});

// POST /api/admin/newsletter/send - Send promotional email to subscribers
// Multer: store uploads in memory (max 10MB for newsletter images)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/admin/newsletter/send - Send newsletter (with optional inline image)
app.post('/api/admin/newsletter/send', authMiddleware, upload.single('attachment'), async (req, res) => {
    const { restaurantId, subject, message, sendToAll } = req.body;
    const rid = restaurantId || 'demo-restaurant';
    const imageFile = req.file; // multer parsed file (PNG/JPG)

    if (!subject) {
        return res.status(400).json({ error: 'Subject is required' });
    }

    // Either a message body or an image is required
    if (!message && !imageFile) {
        return res.status(400).json({ error: 'Message or image is required' });
    }

    try {
        // Get opted-in subscribers (or all if sendToAll)
        const query = (sendToAll === 'true' || sendToAll === true)
            ? `SELECT email, name FROM customers WHERE restaurant_id = $1 AND email IS NOT NULL AND email != ''`
            : `SELECT email, name FROM customers WHERE restaurant_id = $1 AND email IS NOT NULL AND email != '' AND newsletter_opt_in = true`;

        const result = await pool.query(query, [rid]);

        if (result.rowCount === 0) {
            return res.json({ success: true, sent: 0, message: 'No subscribers found' });
        }

        if (!resend) {
            return res.status(503).json({ error: 'Email service not configured' });
        }

        // Build inline image HTML if image uploaded
        let inlineImageHtml = '';
        let attachments = [];
        if (imageFile) {
            // Use CID (Content-ID) for inline embedding — works in all major email clients
            const cid = 'newsletter-image';
            inlineImageHtml = `<img src="cid:${cid}" alt="Nieuwsbrief" style="width: 100%; max-width: 600px; border-radius: 12px; display: block; margin: 0 auto 24px;" />`;
            attachments.push({
                filename: imageFile.originalname || 'nieuwsbrief.png',
                content: imageFile.buffer.toString('base64'),
                contentId: cid,
            });
        }

        // Send in batches of 50 (Resend batch limit)
        let sent = 0;
        let failed = 0;
        const batchSize = 50;
        const recipients = result.rows;
        const unsubBase = process.env.API_BASE_URL || 'https://booking-production-de35.up.railway.app';

        for (let i = 0; i < recipients.length; i += batchSize) {
            const batch = recipients.slice(i, i + batchSize);

            for (const recipient of batch) {
                try {
                    const unsubLink = `${unsubBase}/api/newsletter/unsubscribe?email=${encodeURIComponent(recipient.email)}&token=${Buffer.from(recipient.email).toString('base64')}`;
                    const greeting = escapeHtml(recipient.name) || 'daar';

                    const emailBody = `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f0f; color: #fff; padding: 32px; border-radius: 16px;">
                            <p style="color: #fff; font-size: 16px; margin: 0 0 20px;">Hi ${greeting},</p>
                            
                            ${inlineImageHtml}
                            
                            ${message ? `<div style="color: #ccc; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">${message.replace(/\n/g, '<br>')}</div>` : ''}
                            
                            <p style="color: #888; font-size: 14px; margin: 0;">
                                Tot snel!<br>
                                <strong style="color: #3D9970;">De Tafelaar</strong>
                            </p>
                            
                            <hr style="border: none; border-top: 1px solid #333; margin: 24px 0 16px;">
                            <p style="color: #555; font-size: 11px; margin: 0;">
                                Je ontvangt deze email omdat je hebt gereserveerd bij De Tafelaar.<br>
                                <a href="${unsubLink}" style="color: #666; text-decoration: underline;">Uitschrijven</a>
                            </p>
                        </div>
                    `;

                    await resend.emails.send({
                        from: FROM_EMAIL,
                        to: recipient.email,
                        replyTo: REPLY_TO_EMAIL,
                        subject: subject,
                        html: emailBody,
                        ...(attachments.length > 0 && { attachments }),
                    });
                    sent++;
                } catch (emailError) {
                    console.error(`Newsletter send failed for ${recipient.email}:`, emailError.message);
                    failed++;
                }
            }
        }

        // Log the campaign
        console.log(`📧 Newsletter sent: ${sent} delivered, ${failed} failed, subject: "${subject}"${imageFile ? ', with inline image: ' + imageFile.originalname : ''}`);

        res.json({
            success: true,
            sent,
            failed,
            total_recipients: recipients.length
        });
    } catch (error) {
        console.error('Newsletter send error:', error.message);
        res.status(500).json({ error: 'Failed to send newsletter' });
    }
});

// GET /api/newsletter/unsubscribe - Public unsubscribe endpoint (no auth)
app.get('/api/newsletter/unsubscribe', async (req, res) => {
    const { email, token } = req.query;

    if (!email) {
        return res.status(400).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Ongeldige link</h2></body></html>');
    }

    // Simple token validation: base64 of email must match
    const expectedToken = Buffer.from(email).toString('base64');
    if (token !== expectedToken) {
        return res.status(400).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Ongeldige link</h2></body></html>');
    }

    try {
        await pool.query(
            `UPDATE customers SET newsletter_opt_in = false WHERE email = $1`,
            [email]
        );

        res.send(`
            <html>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-align: center; padding: 60px; background: #0f0f0f; color: #fff;">
                <div style="max-width: 400px; margin: 0 auto;">
                    <h2 style="color: #3D9970;">✓ Uitgeschreven</h2>
                    <p style="color: #ccc;">Je ontvangt geen nieuwsbrief meer van De Tafelaar.</p>
                    <p style="color: #888; font-size: 14px; margin-top: 24px;">Je kunt je altijd opnieuw aanmelden bij je volgende reservering.</p>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Unsubscribe error:', error.message);
        res.status(500).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Er is iets misgegaan</h2></body></html>');
    }
});

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

// Auto-migration: ensure newsletter columns exist (safe to run repeatedly)
(async () => {
    try {
        await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS newsletter_opt_in BOOLEAN DEFAULT false');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_customers_newsletter ON customers(restaurant_id) WHERE newsletter_opt_in = true');
        console.log('✅ Newsletter migration applied');
    } catch (e) {
        console.warn('⚠️ Newsletter migration skipped:', e.message);
    }
})();

// Auto-migration: ensure multi-table group columns exist (safe to run repeatedly)
// NOTE: migration-multi-table.sql is the canonical source of truth for this schema change
(async () => {
    try {
        await pool.query('ALTER TABLE restaurant_bookings ADD COLUMN IF NOT EXISTS group_id TEXT');
        await pool.query('ALTER TABLE restaurant_bookings ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false');
        // Backfill: existing single bookings (no group_id) should be treated as primary
        await pool.query('UPDATE restaurant_bookings SET is_primary = true WHERE group_id IS NULL AND is_primary = false');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_group ON restaurant_bookings(group_id) WHERE group_id IS NOT NULL');
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_lookup ON restaurant_bookings(restaurant_id, booking_date, table_id, start_time, end_time) WHERE lower(status) != 'cancelled'`);
        // Exclusion constraint: DB-level guarantee against overlapping bookings per table
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
})();

// Start server
const server = app.listen(PORT, () => {
    console.log(`🚀 EVENTS API server running on http://localhost:${PORT}`);
    console.log(`📅 Calendar: http://localhost:${PORT}/api/calendar/demo-restaurant.ics`);
    console.log(`🔐 Auth: POST /api/auth/login`);
    console.log(`🛡️  Security: Rate limiting, input validation, SERIALIZABLE transactions enabled`);
});

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

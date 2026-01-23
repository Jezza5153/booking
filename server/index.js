import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import helmet from 'helmet';
import pool from './db-postgres.js';
import { loginHandler, authMiddleware } from './auth.js';
import { loginRateLimiter, bookingRateLimiter, widgetRateLimiter, calendarRateLimiter, isRedisConnected } from './ratelimit.js';
import { initSentry, sentryErrorHandler, captureException } from './sentry.js';
import { sendBookingConfirmation, sendLargeGroupNotification } from './email.js';

dotenv.config();

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

app.use(cors());
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
    return str.slice(0, maxLength).replace(/[<>"'&]/g, '');
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

        // For each event, get slots
        const eventsWithSlots = await Promise.all(
            eventsResult.rows.map(async (event) => {
                const slotsResult = await pool.query(
                    `SELECT id, zone_id as "wijkId", start_datetime, is_highlighted,
                  booked_count_2_tops as booked2tops, booked_count_4_tops as booked4tops, booked_count_6_tops as booked6tops
           FROM slots WHERE event_id = $1 ORDER BY start_datetime ASC`,
                    [event.id]
                );

                const formattedSlots = slotsResult.rows.map(slot => {
                    const dt = new Date(slot.start_datetime);
                    // P0-1 FIX: Always use Europe/Amsterdam timezone for consistent formatting
                    const dateFormatter = new Intl.DateTimeFormat('nl-NL', {
                        weekday: 'short', day: 'numeric', month: 'short',
                        timeZone: 'Europe/Amsterdam'
                    });
                    const timeFormatter = new Intl.DateTimeFormat('nl-NL', {
                        hour: '2-digit', minute: '2-digit', hour12: false,
                        timeZone: 'Europe/Amsterdam'
                    });
                    const parts = dateFormatter.formatToParts(dt);
                    const weekday = parts.find(p => p.type === 'weekday')?.value || '';
                    const day = parts.find(p => p.type === 'day')?.value || '';
                    const month = parts.find(p => p.type === 'month')?.value?.replace('.', '') || '';
                    const timeStr = timeFormatter.format(dt);

                    return {
                        id: slot.id,
                        date: `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} ${day} ${month}`,
                        time: timeStr,
                        start_datetime: slot.start_datetime, // P0-2: Include ISO for client-side consistency
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
            })
        );

        // Set caching header for widget data (short TTL, fresh data)
        res.set('Cache-Control', 'public, max-age=5, s-maxage=30');
        res.json({ restaurant, zones: zonesResult.rows, events: eventsWithSlots });
    } catch (error) {
        console.error('Widget data error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// BOOKING: Idempotency cache (in-memory, for demo)
// ============================================
const idempotencyCache = new Map();
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cleanup old entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of idempotencyCache) {
        if (now > entry.expiresAt) idempotencyCache.delete(key);
    }
}, 60 * 1000);

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
              z.capacity_2_tops, z.capacity_4_tops, z.capacity_6_tops
       FROM slots s
       JOIN events e ON s.event_id = e.id
       JOIN zones z ON s.zone_id = z.id
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
            const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
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

        res.json({ zones: zonesResult.rows, events: eventsWithSlots });
    } catch (error) {
        console.error('Admin data error:', error);
        res.status(500).json({ error: 'Failed to fetch admin data' });
    }
});

// Clear all events and slots (Admin - for fresh start)
// P0-7 FIX: Scope to restaurant
app.delete('/api/admin/clear', async (req, res) => {
    const restaurantId = req.query.restaurantId || 'demo-restaurant';
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

        // Decrement slot counter based on table_type
        const colMap = { '2': 'booked_count_2_tops', '4': 'booked_count_4_tops', '6': 'booked_count_6_tops' };
        const col = colMap[booking.table_type];

        if (col) {
            const currentCount = booking[col] || 0;

            // Warn if counter already 0 (data inconsistency)
            if (currentCount <= 0) {
                console.warn(`[${req.requestId}] Counter mismatch: ${col} already 0 for slot ${booking.slot_id}, booking ${bookingId}`);
            }

            // Decrement with floor at 0 (never negative)
            await client.query(
                `UPDATE slots SET ${col} = GREATEST(0, ${col} - 1) WHERE id = $1`,
                [booking.slot_id]
            );
        }

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
        console.error('Restaurant tables error:', error);
        res.status(500).json({ error: 'Failed to fetch tables' });
    }
});

// GET /api/restaurant/:restaurantId/availability - Get available time slots
app.get('/api/restaurant/:restaurantId/availability', async (req, res) => {
    const { restaurantId } = req.params;
    const { date, guests } = req.query;

    if (!date) {
        return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
    }

    const guestCount = parseInt(guests) || 2;
    const bookingDate = new Date(date);
    const dayOfWeek = bookingDate.getDay();

    try {
        // Get opening hours
        const openingResult = await pool.query(
            `SELECT open_time, close_time, slot_duration_minutes, is_closed 
             FROM restaurant_openings 
             WHERE restaurant_id = $1 AND (day_of_week = $2 OR specific_date = $3)
             ORDER BY specific_date DESC NULLS LAST LIMIT 1`,
            [restaurantId, dayOfWeek, date]
        );

        if (openingResult.rowCount === 0 || openingResult.rows[0].is_closed) {
            return res.json({ slots: [], message: 'Restaurant is closed' });
        }

        const { open_time, close_time, slot_duration_minutes } = openingResult.rows[0];
        const slotDuration = slot_duration_minutes || 90;

        // Get tables that fit party size
        const tablesResult = await pool.query(
            `SELECT id, name, seats, zone FROM restaurant_tables 
             WHERE restaurant_id = $1 AND is_active = true AND seats >= $2
             ORDER BY seats ASC`,
            [restaurantId, guestCount]
        );

        // Get existing bookings
        const bookingsResult = await pool.query(
            `SELECT table_id, start_time, end_time FROM restaurant_bookings 
             WHERE restaurant_id = $1 AND booking_date = $2 AND status != 'cancelled'`,
            [restaurantId, date]
        );

        // Generate time slots
        const slots = [];
        const openMins = parseInt(open_time.split(':')[0]) * 60 + parseInt(open_time.split(':')[1]);
        const closeMins = parseInt(close_time.split(':')[0]) * 60 + parseInt(close_time.split(':')[1]);

        for (let m = openMins; m + slotDuration <= closeMins; m += 30) {
            const slotTime = `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
            const endTime = `${Math.floor((m + slotDuration) / 60).toString().padStart(2, '0')}:${((m + slotDuration) % 60).toString().padStart(2, '0')}`;

            const availTables = tablesResult.rows.filter(t =>
                !bookingsResult.rows.some(b => b.table_id === t.id && b.start_time < endTime && b.end_time > slotTime)
            );

            if (availTables.length > 0) {
                slots.push({ time: slotTime, end_time: endTime, available: availTables.length });
            }
        }

        res.json({ date, guest_count: guestCount, slots });
    } catch (error) {
        console.error('Restaurant availability error:', error);
        res.status(500).json({ error: 'Failed to check availability' });
    }
});

// POST /api/restaurant/book - Book a table
app.post('/api/restaurant/book', bookingRateLimiter, async (req, res) => {
    const { restaurant_id, date, time, guest_count, customer_name, customer_email, customer_phone, remarks } = req.body;

    if (!restaurant_id || !date || !time || !guest_count || !customer_name) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get slot duration
        const dayOfWeek = new Date(date).getDay();
        const openingQ = await client.query(
            `SELECT slot_duration_minutes FROM restaurant_openings WHERE restaurant_id = $1 AND day_of_week = $2 LIMIT 1`,
            [restaurant_id, dayOfWeek]
        );
        const duration = openingQ.rows[0]?.slot_duration_minutes || 90;
        const startMins = parseInt(time.split(':')[0]) * 60 + parseInt(time.split(':')[1]);
        const endTime = `${Math.floor((startMins + duration) / 60).toString().padStart(2, '0')}:${((startMins + duration) % 60).toString().padStart(2, '0')}`;

        // Find available table
        const tableQ = await client.query(
            `SELECT id, name FROM restaurant_tables rt
             WHERE rt.restaurant_id = $1 AND rt.is_active = true AND rt.seats >= $2
             AND NOT EXISTS (
                 SELECT 1 FROM restaurant_bookings rb 
                 WHERE rb.table_id = rt.id AND rb.booking_date = $3 AND rb.status != 'cancelled'
                 AND rb.start_time < $5 AND rb.end_time > $4
             ) ORDER BY rt.seats ASC LIMIT 1`,
            [restaurant_id, guest_count, date, time, endTime]
        );

        if (tableQ.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'No tables available' });
        }

        const table = tableQ.rows[0];
        const bookingId = crypto.randomUUID();

        await client.query(
            `INSERT INTO restaurant_bookings (id, restaurant_id, table_id, booking_date, start_time, end_time, guest_count, customer_name, customer_email, customer_phone, remarks)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [bookingId, restaurant_id, table.id, date, time, endTime, guest_count, customer_name, customer_email, customer_phone, remarks]
        );

        await client.query('COMMIT');
        res.status(201).json({ success: true, booking_id: bookingId, table_name: table.name, date, time });
    } catch (error) {
        await client.query('ROLLBACK');
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

// Start server
app.listen(PORT, () => {
    console.log(`🚀 EVENTS API server running on http://localhost:${PORT}`);
    console.log(`📅 Calendar: http://localhost:${PORT}/api/calendar/demo-restaurant.ics`);
    console.log(`🔐 Auth: POST /api/auth/login`);
    console.log(`🛡️  Security: Rate limiting, input validation, SERIALIZABLE transactions enabled`);
});

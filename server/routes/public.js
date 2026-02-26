import express from 'express';
import pool from '../db-postgres.js';
import { authMiddleware } from '../auth.js';
import { bookingRateLimiter, widgetRateLimiter, calendarRateLimiter } from '../ratelimit.js';
import { captureException } from '../sentry.js';
import { sendBookingConfirmation, sendLargeGroupNotification, sendRestaurantBookingConfirmation, sendChefsChoiceNotification } from '../email.js';
import { escapeHtml, sanitizeString, validateRestaurantId, generateUnsubscribeToken, buildBookingsMap, allocateTables, normalizeToHHMM, timeToMins, minsToTime, computeEndTime, overlaps, pickTablesGreedy, selectTablesForSlot, BOOKING_DURATION_MINS, SLOT_STEP_MINS } from '../utils.js';
import { getCachedValue, invalidatePublicCacheForRestaurant } from '../public-cache.js';
import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

function setPublicCacheHeaders(res, { maxAge = 10, sMaxAge = 30, staleWhileRevalidate = 60 } = {}) {
    res.set('Cache-Control', `public, max-age=${maxAge}, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`);
}

// Table helpers (allocateTables, selectTablesForSlot, etc.) imported from ../utils.js

// Route: /api/widget/:restaurantId
router.get('/api/widget/:restaurantId', widgetRateLimiter, async (req, res) => {
    const { restaurantId } = req.params;

    // Validate input
    if (!validateRestaurantId(restaurantId)) {
        return res.status(400).json({ error: 'Invalid restaurant ID format' });
    }

    try {
        const dateFormatter = new Intl.DateTimeFormat('nl-NL', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            timeZone: 'Europe/Amsterdam',
        });
        const timeFormatter = new Intl.DateTimeFormat('nl-NL', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Europe/Amsterdam',
        });

        const cacheKey = `widget:${restaurantId}:v2`;
        const { value: payload, cacheStatus } = await getCachedValue({
            key: cacheKey,
            ttlMs: 120_000,   // 2 min fresh (event data rarely changes)
            staleMs: 600_000, // 10 min stale-while-revalidate
            loader: async () => {
                const [restaurantResult, zonesResult, openingHoursResult, eventSlotRows] = await Promise.all([
                    pool.query(
                        'SELECT id, name, booking_email, handoff_url_base FROM restaurants WHERE id = $1',
                        [restaurantId]
                    ),
                    pool.query(
                        `SELECT id, name, capacity_2_tops as count2tops, capacity_4_tops as count4tops, capacity_6_tops as count6tops
                         FROM zones WHERE restaurant_id = $1`,
                        [restaurantId]
                    ),
                    pool.query(
                        `SELECT day_of_week, open_time, close_time, is_closed
                         FROM restaurant_openings
                         WHERE restaurant_id = $1 AND specific_date IS NULL
                         ORDER BY day_of_week`,
                        [restaurantId]
                    ),
                    pool.query(
                        `SELECT e.id as event_id, e.title, e.description, e.price_per_person,
                                s.id as slot_id, s.zone_id as "wijkId", s.start_datetime, s.is_highlighted,
                                s.booked_count_2_tops as booked2tops, s.booked_count_4_tops as booked4tops, s.booked_count_6_tops as booked6tops
                         FROM events e
                         JOIN slots s ON s.event_id = e.id
                         WHERE e.restaurant_id = $1
                           AND e.is_active = true
                           AND s.start_datetime >= NOW() - INTERVAL '30 minutes'
                         ORDER BY s.start_datetime ASC`,
                        [restaurantId]
                    ),
                ]);

                if (restaurantResult.rowCount === 0) {
                    return null;
                }

                const eventsById = new Map();
                for (const row of eventSlotRows.rows) {
                    if (!eventsById.has(row.event_id)) {
                        eventsById.set(row.event_id, {
                            id: row.event_id,
                            title: row.title,
                            description: row.description || null,
                            price_per_person: row.price_per_person ? parseFloat(row.price_per_person) : null,
                            slots: [],
                        });
                    }

                    const dt = new Date(row.start_datetime);
                    const dateLabel = dateFormatter.format(dt).replace(/\./g, '');
                    const normalizedDate = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);

                    eventsById.get(row.event_id).slots.push({
                        id: row.slot_id,
                        date: normalizedDate,
                        time: timeFormatter.format(dt),
                        start_datetime: row.start_datetime,
                        isNextAvailable: row.is_highlighted,
                        wijkId: row.wijkId,
                        booked2tops: row.booked2tops,
                        booked4tops: row.booked4tops,
                        booked6tops: row.booked6tops,
                    });
                }

                const openingHours = openingHoursResult.rows.map((row) => ({
                    dayOfWeek: row.day_of_week,
                    open: row.open_time?.substring(0, 5) || '17:00',
                    close: row.close_time?.substring(0, 5) || '23:00',
                    isOpen: !row.is_closed,
                }));

                return {
                    restaurant: restaurantResult.rows[0],
                    zones: zonesResult.rows,
                    events: Array.from(eventsById.values()),
                    openingHours,
                };
            },
        });

        if (!payload) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }

        setPublicCacheHeaders(res, { maxAge: 30, sMaxAge: 120, staleWhileRevalidate: 300 });
        res.set('X-Cache-Status', cacheStatus);
        res.json(payload);
    } catch (error) {
        console.error('Widget data error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Route: /api/book
router.post('/api/book', bookingRateLimiter, async (req, res) => {
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
        invalidatePublicCacheForRestaurant(slot.restaurant_id);

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

// Route: /api/calendar/:restaurantId.ics
router.get('/api/calendar/:restaurantId.ics', calendarRateLimiter, async (req, res) => {
    const restaurantId = req.params.restaurantId.replace('.ics', '');
    const bookedOnly = req.query.booked_only === 'true';

    try {
        const cacheKey = `calendar:${restaurantId}:${bookedOnly ? 'booked' : 'all'}:v2`;
        const { value: payload, cacheStatus } = await getCachedValue({
            key: cacheKey,
            ttlMs: 30_000,
            staleMs: 240_000,
            loader: async () => {
                const [restaurantResult, slotsResult] = await Promise.all([
                    pool.query('SELECT id, name FROM restaurants WHERE id = $1', [restaurantId]),
                    pool.query(
                        `SELECT s.id, s.start_datetime, s.booked_count_2_tops, s.booked_count_4_tops, s.booked_count_6_tops,
                                e.title as event_title, z.name as zone_name,
                                z.capacity_2_tops, z.capacity_4_tops, z.capacity_6_tops,
                                ro.slot_duration_minutes
                         FROM slots s
                         JOIN events e ON s.event_id = e.id
                         JOIN zones z ON s.zone_id = z.id
                         LEFT JOIN restaurant_openings ro ON ro.restaurant_id = e.restaurant_id
                           AND ro.day_of_week = EXTRACT(DOW FROM s.start_datetime)::int
                         WHERE e.restaurant_id = $1
                           AND e.is_active = true
                         ORDER BY s.start_datetime ASC`,
                        [restaurantId]
                    ),
                ]);

                if (restaurantResult.rowCount === 0) {
                    return null;
                }
                const restaurant = restaurantResult.rows[0];

                let slots = slotsResult.rows;
                if (bookedOnly) {
                    slots = slots.filter((s) =>
                        s.booked_count_2_tops > 0 || s.booked_count_4_tops > 0 || s.booked_count_6_tops > 0
                    );
                }

                const sanitizeICS = (str) => String(str)
                    .replace(/[\r\n]/g, ' ')
                    .replace(/[;,\\]/g, '\\$&')
                    .slice(0, 200);

                const formatICalDate = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
                const nowStamp = formatICalDate(new Date());
                const icalContent = [
                    'BEGIN:VCALENDAR',
                    'VERSION:2.0',
                    `PRODID:-//EVENTS//${restaurant.name}//EN`,
                    'CALSCALE:GREGORIAN',
                    'METHOD:PUBLISH',
                    `X-WR-CALNAME:${restaurant.name} Bookings`,
                    'X-WR-TIMEZONE:Europe/Amsterdam',
                ];

                for (const slot of slots) {
                    const start = new Date(slot.start_datetime);
                    const durationMs = (slot.slot_duration_minutes || 120) * 60 * 1000;
                    const end = new Date(start.getTime() + durationMs);
                    const totalBooked = slot.booked_count_2_tops + slot.booked_count_4_tops + slot.booked_count_6_tops;
                    const totalCapacity = slot.capacity_2_tops + slot.capacity_4_tops + slot.capacity_6_tops;

                    icalContent.push('BEGIN:VEVENT');
                    icalContent.push(`UID:${slot.id}@events.app`);
                    icalContent.push(`DTSTAMP:${nowStamp}`);
                    icalContent.push(`DTSTART:${formatICalDate(start)}`);
                    icalContent.push(`DTEND:${formatICalDate(end)}`);
                    icalContent.push(`SUMMARY:(${totalBooked}/${totalCapacity}) ${sanitizeICS(slot.event_title)}`);
                    icalContent.push(`DESCRIPTION:Zone: ${sanitizeICS(slot.zone_name)}\\n2-Tops: ${slot.booked_count_2_tops}\\n4-Tops: ${slot.booked_count_4_tops}\\n6-Tops: ${slot.booked_count_6_tops}`);
                    icalContent.push(`LOCATION:${sanitizeICS(restaurant.name)} - ${sanitizeICS(slot.zone_name)}`);
                    icalContent.push('STATUS:CONFIRMED');
                    icalContent.push('END:VEVENT');
                }

                icalContent.push('END:VCALENDAR');
                return {
                    restaurantId,
                    body: icalContent.join('\r\n'),
                };
            },
        });

        if (!payload) {
            return res.status(404).send('Restaurant not found');
        }

        res.set({
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `attachment; filename="${payload.restaurantId}-bookings.ics"`,
            'X-Cache-Status': cacheStatus,
        });
        setPublicCacheHeaders(res, { maxAge: 30, sMaxAge: 120, staleWhileRevalidate: 300 });
        res.send(payload.body);
    } catch (error) {
        console.error('Calendar error:', error);
        res.status(500).send('Internal server error');
    }
});

// Route: /api/health
// P1 PERF: Cache DB health check to avoid hitting Neon on every Railway healthcheck
let _healthCache = { ok: false, ts: 0 };
router.get('/api/health', async (req, res) => {
    try {
        const now = Date.now();
        // Reuse cached result for 10 seconds
        if (_healthCache.ok && (now - _healthCache.ts) < 10_000) {
            return res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                db: 'connected'
            });
        }
        const dbResult = await pool.query('SELECT 1 as ok');
        if (dbResult.rows[0]?.ok !== 1) {
            throw new Error('DB check failed');
        }
        _healthCache = { ok: true, ts: now };
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            db: 'connected'
        });
    } catch (error) {
        _healthCache = { ok: false, ts: 0 };
        console.error('Health check failed:', error.message);
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            db: 'disconnected'
        });
    }
});

// Route: /api/events
router.get('/api/events', async (req, res) => {
    const restaurantId = req.query.restaurantId || 'demo-restaurant';
    try {
        const cacheKey = `events:${restaurantId}:v2`;
        const { value: payload, cacheStatus } = await getCachedValue({
            key: cacheKey,
            ttlMs: 15_000,
            staleMs: 90_000,
            loader: async () => {
                const rows = await pool.query(
                    `SELECT e.id as event_id, e.title, e.description, e.price_per_person, e.is_active,
                            s.id as slot_id, s.zone_id, s.start_datetime, s.is_highlighted,
                            s.booked_count_2_tops, s.booked_count_4_tops, s.booked_count_6_tops, s.current_couverts
                     FROM events e
                     LEFT JOIN slots s ON s.event_id = e.id
                     WHERE e.restaurant_id = $1
                       AND e.is_active = true
                       AND (s.id IS NULL OR s.start_datetime >= NOW() - INTERVAL '30 minutes')
                     ORDER BY e.title ASC, s.start_datetime ASC`,
                    [restaurantId]
                );

                const eventsById = new Map();
                for (const row of rows.rows) {
                    if (!eventsById.has(row.event_id)) {
                        eventsById.set(row.event_id, {
                            id: row.event_id,
                            title: row.title,
                            description: row.description,
                            price_per_person: row.price_per_person,
                            is_active: row.is_active,
                            slots: [],
                        });
                    }

                    if (row.slot_id) {
                        eventsById.get(row.event_id).slots.push({
                            id: row.slot_id,
                            event_id: row.event_id,
                            zone_id: row.zone_id,
                            start_datetime: row.start_datetime,
                            is_highlighted: row.is_highlighted,
                            booked_count_2_tops: row.booked_count_2_tops,
                            booked_count_4_tops: row.booked_count_4_tops,
                            booked_count_6_tops: row.booked_count_6_tops,
                            current_couverts: row.current_couverts,
                        });
                    }
                }

                return {
                    events: Array.from(eventsById.values()).filter((event) => event.slots.length > 0),
                };
            },
        });

        setPublicCacheHeaders(res, { maxAge: 15, sMaxAge: 45, staleWhileRevalidate: 120 });
        res.set('X-Cache-Status', cacheStatus);
        res.json(payload);
    } catch (error) {
        console.error('Failed to fetch events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// Route: /api/restaurant/:restaurantId/tables
router.get('/api/restaurant/:restaurantId/tables', async (req, res) => {
    const { restaurantId } = req.params;
    try {
        const cacheKey = `tables:${restaurantId}:v1`;
        const { value: payload, cacheStatus } = await getCachedValue({
            key: cacheKey,
            ttlMs: 60_000,
            staleMs: 600_000,
            loader: async () => {
                const result = await pool.query(
                    `SELECT id, name, seats, zone FROM restaurant_tables
                     WHERE restaurant_id = $1 AND is_active = true
                     ORDER BY zone, name`,
                    [restaurantId]
                );
                return { tables: result.rows };
            },
        });

        setPublicCacheHeaders(res, { maxAge: 60, sMaxAge: 120, staleWhileRevalidate: 600 });
        res.set('X-Cache-Status', cacheStatus);
        res.json(payload);
    } catch (error) {
        console.error('Error fetching tables:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Route: /api/restaurant/:restaurantId/opening-hours
router.get('/api/restaurant/:restaurantId/opening-hours', async (req, res) => {
    const { restaurantId } = req.params;
    try {
        const cacheKey = `opening-hours:${restaurantId}:v1`;
        const { value: payload, cacheStatus } = await getCachedValue({
            key: cacheKey,
            ttlMs: 300_000,
            staleMs: 1_800_000,
            loader: async () => {
                const result = await pool.query(
                    `SELECT day_of_week, open_time, close_time, is_closed
                     FROM restaurant_openings
                     WHERE restaurant_id = $1 AND specific_date IS NULL
                     ORDER BY day_of_week`,
                    [restaurantId]
                );

                return {
                    openingHours: result.rows.map((row) => ({
                        dayOfWeek: row.day_of_week,
                        open: row.open_time?.substring(0, 5) || '17:00',
                        close: row.close_time?.substring(0, 5) || '23:00',
                        isOpen: !row.is_closed,
                    })),
                };
            },
        });

        setPublicCacheHeaders(res, { maxAge: 300, sMaxAge: 600, staleWhileRevalidate: 1800 });
        res.set('X-Cache-Status', cacheStatus);
        res.json(payload);
    } catch (error) {
        console.error('Error fetching opening hours:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Route: /api/restaurant/:restaurantId/waitlist
router.post('/api/restaurant/:restaurantId/waitlist', bookingRateLimiter, async (req, res) => {
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
        // P2 FIX #20: Use a transaction with advisory lock to prevent duplicate positions
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const posResult = await client.query(
                `SELECT COALESCE(MAX(position), 0) + 1 as next_pos FROM waitlist WHERE restaurant_id = $1 AND date = $2 FOR UPDATE`,
                [restaurantId, date]
            );
            const position = posResult.rows[0].next_pos;

            const result = await client.query(
                `INSERT INTO waitlist (restaurant_id, date, time_preference, guest_count, customer_name, phone, email, notes, position)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING *`,
                [restaurantId, date, time_preference, guest_count, name, phone, email, notes, position]
            );
            await client.query('COMMIT');
            res.status(201).json({ entry: result.rows[0] });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error adding to waitlist:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Route: /api/restaurant/:restaurantId/availability
router.get('/api/restaurant/:restaurantId/availability', async (req, res) => {
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
        // AUTO-PROVISION: Only for authenticated admin users (runs outside cache)
        const firstCheck = await pool.query(
            `SELECT open_time, close_time, slot_duration_minutes, is_closed 
             FROM restaurant_openings 
             WHERE restaurant_id = $1 AND (day_of_week = $2 OR specific_date = $3)
             ORDER BY specific_date DESC NULLS LAST LIMIT 1`,
            [restaurantId, dayOfWeek, date]
        );

        if (firstCheck.rowCount === 0 && req.headers.authorization) {
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
        }

        // PERF P0+P2: Cache by restaurant+date only (guest filtering is cheap on cached data).
        // Increased TTL: underlying data (tables/bookings) rarely changes within 10 seconds.
        const cacheKey = `availability:${restaurantId}:${date}`;
        const { value: cachedData, cacheStatus } = await getCachedValue({
            key: cacheKey,
            ttlMs: 10_000,
            staleMs: 60_000,
            loader: async () => {
                // PERF P0: Run all 3 queries in parallel instead of sequentially
                const [openingResult, tablesResult, bookingsResult] = await Promise.all([
                    pool.query(
                        `SELECT open_time, close_time, slot_duration_minutes, is_closed 
                         FROM restaurant_openings 
                         WHERE restaurant_id = $1 AND (day_of_week = $2 OR specific_date = $3)
                         ORDER BY specific_date DESC NULLS LAST LIMIT 1`,
                        [restaurantId, dayOfWeek, date]
                    ),
                    pool.query(
                        `SELECT id, name, seats, zone FROM restaurant_tables 
                         WHERE restaurant_id = $1 AND is_active = true
                         ORDER BY seats DESC`,
                        [restaurantId]
                    ),
                    pool.query(
                        `SELECT table_id, to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time
                         FROM restaurant_bookings 
                         WHERE restaurant_id = $1 AND booking_date = $2 AND lower(status) != 'cancelled'`,
                        [restaurantId, date]
                    ),
                ]);

                if (openingResult.rowCount === 0) {
                    return { closed: false, noConfig: true };
                }
                if (openingResult.rows[0].is_closed) {
                    return { closed: true };
                }

                const { open_time, close_time } = openingResult.rows[0];

                // PERF P0: Pre-convert booking times to minutes once (avoids repeated parsing in hot loop)
                const bookingsMins = bookingsResult.rows.map(b => ({
                    table_id: b.table_id,
                    start: timeToMins(b.start_time),
                    end: timeToMins(b.end_time),
                }));
                const bookingsByTableIdMins = new Map();
                for (const b of bookingsMins) {
                    if (!bookingsByTableIdMins.has(b.table_id)) bookingsByTableIdMins.set(b.table_id, []);
                    bookingsByTableIdMins.get(b.table_id).push(b);
                }

                return {
                    closed: false,
                    open_time,
                    close_time,
                    allTables: tablesResult.rows,
                    bookingsByTableIdMins,
                    // Keep original string-based map for selectTablesForSlot compatibility
                    bookingsByTableId: buildBookingsMap(bookingsResult.rows),
                };
            },
        });

        // Handle closed / not configured
        if (cachedData.noConfig) {
            const payload = { date, guest_count: guestCount, close_time: null, slots: [], message: 'No opening hours configured for this restaurant' };
            setPublicCacheHeaders(res, { maxAge: 5, sMaxAge: 15, staleWhileRevalidate: 30 });
            res.set('X-Cache-Status', cacheStatus);
            return res.json(payload);
        }
        if (cachedData.closed) {
            const payload = { date, guest_count: guestCount, close_time: null, slots: [], message: 'Restaurant is closed' };
            setPublicCacheHeaders(res, { maxAge: 5, sMaxAge: 15, staleWhileRevalidate: 30 });
            res.set('X-Cache-Status', cacheStatus);
            return res.json(payload);
        }

        // PERF P2: Guest-specific slot filtering on cached data (fast, no DB hit)
        const { open_time, close_time, allTables, bookingsByTableId } = cachedData;
        const slots = [];
        const openMins = timeToMins(open_time);
        const closeMins = timeToMins(close_time);

        // FIX #37: Use Amsterdam timezone for "today" check instead of server TZ
        const nowAmsterdam = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
        const isToday = bookingDate.toDateString() === nowAmsterdam.toDateString();
        const currentMins = isToday ? nowAmsterdam.getHours() * 60 + nowAmsterdam.getMinutes() : 0;

        for (let m = openMins; m < closeMins; m += SLOT_STEP_MINS) {
            if (isToday && m <= currentMins) continue;

            const slotStart = minsToTime(m);
            const slotEndMins = Math.min(m + BOOKING_DURATION_MINS, closeMins);
            const slotEnd = minsToTime(slotEndMins);

            const picked = selectTablesForSlot({ allTables, bookingsByTableId, slotStart, slotEnd, guestCount });
            if (picked) {
                const seatsTotal = picked.reduce((s, t) => s + t.seats, 0);
                slots.push({ time: slotStart, end_time: slotEnd, available: 1, tables_needed: picked.length, seats_total: seatsTotal });
            }
        }

        const payload = { date, guest_count: guestCount, close_time: normalizeToHHMM(close_time), slots };

        setPublicCacheHeaders(res, { maxAge: 5, sMaxAge: 15, staleWhileRevalidate: 30 });
        res.set('X-Cache-Status', cacheStatus);
        res.json(payload);
    } catch (error) {
        console.error('Restaurant availability error:', error);
        res.status(500).json({ error: 'Failed to check availability' });
    }
});

// Route: /api/restaurant/book
router.post('/api/restaurant/book', bookingRateLimiter, async (req, res) => {
    const { restaurant_id, date, time, guest_count, customer_name, customer_email, customer_phone, remarks, newsletter_opt_in } = req.body;

    // FIX #43: Validate restaurant_id format
    if (!restaurant_id || typeof restaurant_id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(restaurant_id)) {
        return res.status(400).json({ error: 'Invalid restaurant ID' });
    }

    if (!date || !time || !guest_count || !customer_name || !customer_email) {
        return res.status(400).json({ error: 'Missing required fields (including email)' });
    }

    // FIX #35: Validate email format (same pattern as newsletter subscribe)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customer_email.trim())) {
        return res.status(400).json({ error: 'Ongeldig e-mailadres' });
    }

    // P4: Increased cap for real-life scenarios (birthday parties, company dinners)
    if (guest_count < 1 || guest_count > 20) {
        return res.status(400).json({ error: 'Guest count must be between 1 and 20' });
    }

    // FIX #36: Reject bookings in the past
    const [bookYear, bookMonth, bookDay] = date.split('-').map(Number);
    const bookingDateObj = new Date(bookYear, bookMonth - 1, bookDay);
    const todayAmsterdam = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
    todayAmsterdam.setHours(0, 0, 0, 0);
    if (bookingDateObj < todayAmsterdam) {
        return res.status(400).json({ error: 'Kan niet reserveren in het verleden' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // P1 FIX #11: Parse date parts manually to avoid UTC timezone shift (same as availability endpoint)
        const [yr, mo, dy] = date.split('-').map(Number);
        const dayOfWeek = new Date(yr, mo - 1, dy).getDay();
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
                `INSERT INTO restaurant_bookings (id, restaurant_id, table_id, booking_date, start_time, end_time, guest_count, customer_name, customer_email, customer_phone, remarks, customer_id, group_id, is_primary, source)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'website')`,
                [rowId, restaurant_id, tbl.id, date, time, endTime, guest_count, customer_name, customer_email, customer_phone, isPrimary ? remarks : null, customerId, groupId, isPrimary]
            );
        }

        await client.query('COMMIT');
        invalidatePublicCacheForRestaurant(restaurant_id);

        // Build table name string for email/response
        const tableNames = selectedTables.map(t => t.name).join(' + ');

        // 8) Send confirmation email ONCE (is_primary row only)
        // FIX #39: Use manual date parsing to avoid UTC midnight shift
        const [fYear, fMonth, fDay] = date.split('-').map(Number);
        const formattedDate = new Date(fYear, fMonth - 1, fDay).toLocaleDateString('nl-NL', {
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

// Route: /api/restaurant/:id/openings
router.get('/api/restaurant/:id/openings', async (req, res) => {
    const { id } = req.params;

    try {
        const cacheKey = `openings:${id}:v1`;
        const { value: payload, cacheStatus } = await getCachedValue({
            key: cacheKey,
            ttlMs: 300_000,
            staleMs: 1_800_000,
            loader: async () => {
                const result = await pool.query(
                    `SELECT day_of_week as day, NOT is_closed as is_open,
                            open_time::text as open_time, close_time::text as close_time
                     FROM restaurant_openings
                     WHERE restaurant_id = $1
                     ORDER BY day_of_week`,
                    [id]
                );
                return { openings: result.rows };
            },
        });

        setPublicCacheHeaders(res, { maxAge: 300, sMaxAge: 600, staleWhileRevalidate: 1800 });
        res.set('X-Cache-Status', cacheStatus);
        res.json(payload);
    } catch (error) {
        console.error('Get openings error:', error);
        res.json({ openings: [] });
    }
});

// Route: /api/newsletter/subscribe
router.post('/api/newsletter/subscribe', bookingRateLimiter, async (req, res) => {
    const { email, name } = req.body;
    const restaurantId = req.body.restaurant_id || 'demo-restaurant';

    // Validate email
    if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Email is verplicht' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ error: 'Ongeldig e-mailadres' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = (name || '').trim() || null;

    try {
        // Check if customer already exists
        const existing = await pool.query(
            `SELECT id, newsletter_opt_in FROM customers WHERE restaurant_id = $1 AND email = $2 LIMIT 1`,
            [restaurantId, cleanEmail]
        );

        if (existing.rowCount > 0) {
            const customer = existing.rows[0];
            if (customer.newsletter_opt_in) {
                return res.json({ success: true, status: 'already_subscribed', message: 'Je bent al aangemeld!' });
            }
            // Re-subscribe
            await pool.query(
                `UPDATE customers SET newsletter_opt_in = true, name = COALESCE($1, name), updated_at = NOW() WHERE id = $2`,
                [cleanName, customer.id]
            );
            return res.json({ success: true, status: 'resubscribed', message: 'Welkom terug! Je bent opnieuw aangemeld.' });
        }

        // New subscriber
        const customerId = crypto.randomUUID();
        await pool.query(
            `INSERT INTO customers (id, restaurant_id, name, email, newsletter_opt_in) VALUES ($1, $2, $3, $4, true)`,
            [customerId, restaurantId, cleanName, cleanEmail]
        );

        res.json({ success: true, status: 'subscribed', message: 'Bedankt! Je bent aangemeld voor de nieuwsbrief.' });
    } catch (error) {
        console.error('Newsletter subscribe error:', error.message);
        res.status(500).json({ error: 'Er is iets misgegaan. Probeer het later opnieuw.' });
    }
});

// Route: /api/newsletter/unsubscribe
router.get('/api/newsletter/unsubscribe', async (req, res) => {
    const { email, token } = req.query;

    if (!email) {
        return res.status(400).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Ongeldige link</h2></body></html>');
    }

    // P0 FIX #2: HMAC token validation (replaces trivially forgeable base64)
    const expectedToken = generateUnsubscribeToken(email);
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

export default router;

import express from 'express';
import pool from '../db-postgres.js';
import { authMiddleware } from '../auth.js';
import { bookingRateLimiter, widgetRateLimiter, calendarRateLimiter } from '../ratelimit.js';
import { captureException } from '../sentry.js';
import { sendBookingConfirmation, sendLargeGroupNotification, sendRestaurantBookingConfirmation, sendChefsChoiceNotification } from '../email.js';
import { escapeHtml, sanitizeString, validateRestaurantId, generateUnsubscribeToken, parseSlotDateTime, buildBookingsMap, selectTablesForSlot, overlaps, timeToMins, minsToTime, computeEndTime } from '../utils.js';
import { invalidatePublicCacheForRestaurant } from '../public-cache.js';
import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

// Route: /api/admin/events
router.get('/api/admin/events', authMiddleware, async (req, res) => {
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

// Route: /api/admin/data
router.get('/api/admin/data', authMiddleware, async (req, res) => {
    const restaurantId = req.query.restaurantId || 'demo-restaurant';
    try {
        // PERF: Run all queries in parallel instead of sequentially
        const [zonesResult, eventsResult] = await Promise.all([
            pool.query(
                `SELECT id, name, 
                        capacity_2_tops as count2tops, 
                        capacity_4_tops as count4tops, 
                        capacity_6_tops as count6tops,
                        max_couverts as "maxCouverts"
                 FROM zones WHERE restaurant_id = $1`,
                [restaurantId]
            ),
            pool.query(
                `SELECT * FROM events WHERE restaurant_id = $1 AND is_active = true`,
                [restaurantId]
            ),
        ]);

        // Slots query depends on events result, but still faster than 3 sequential queries
        const allSlotsResult = await pool.query(
            `SELECT id, event_id, zone_id as "wijkId", start_datetime, is_highlighted as "isNextAvailable",
                    booked_count_2_tops as booked2tops, booked_count_4_tops as booked4tops, booked_count_6_tops as booked6tops
             FROM slots WHERE event_id = ANY($1::text[])
             ORDER BY start_datetime ASC`,
            [eventsResult.rows.map(e => e.id)]
        );

        // Reusable formatters (created once)
        const dateFormatter = new Intl.DateTimeFormat('en-CA', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            timeZone: 'Europe/Amsterdam'
        });
        const timeFormatter = new Intl.DateTimeFormat('nl-NL', {
            hour: '2-digit', minute: '2-digit', hour12: false,
            timeZone: 'Europe/Amsterdam'
        });

        const slotsByEvent = new Map();
        for (const slot of allSlotsResult.rows) {
            const dt = new Date(slot.start_datetime);
            const formatted = {
                id: slot.id,
                date: dateFormatter.format(dt),
                time: timeFormatter.format(dt),
                start_datetime: slot.start_datetime,
                isNextAvailable: slot.isNextAvailable,
                wijkId: slot.wijkId,
                booked2tops: slot.booked2tops,
                booked4tops: slot.booked4tops,
                booked6tops: slot.booked6tops
            };
            if (!slotsByEvent.has(slot.event_id)) slotsByEvent.set(slot.event_id, []);
            slotsByEvent.get(slot.event_id).push(formatted);
        }

        const eventsWithSlots = eventsResult.rows.map(event => ({
            id: event.id,
            title: event.title,
            description: event.description || null,
            price_per_person: event.price_per_person ? parseFloat(event.price_per_person) : null,
            slots: slotsByEvent.get(event.id) || []
        }));

        // PERF: Allow browser to cache for 10s (private = only this user)
        res.set('Cache-Control', 'private, max-age=10');
        res.json({ zones: zonesResult.rows, events: eventsWithSlots });
    } catch (error) {
        console.error('Admin data error:', error);
        res.status(500).json({ error: 'Failed to fetch admin data' });
    }
});

// Route: /api/admin/clear
router.delete('/api/admin/clear', authMiddleware, async (req, res) => {
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
        invalidatePublicCacheForRestaurant(restaurantId);
        console.log(`✅ All events and slots cleared for ${restaurantId}`);
        res.json({ success: true, message: 'All events and slots cleared' });
    } catch (error) {
        console.error('Clear failed:', error.message);
        res.status(500).json({ error: 'Failed to clear data' });
    }
});

// Route: /api/admin/bookings/:id/cancel
router.post('/api/admin/bookings/:id/cancel', authMiddleware, async (req, res) => {
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
        invalidatePublicCacheForRestaurant(restaurantId);
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

// Route: /api/admin/bookings
router.get('/api/admin/bookings', authMiddleware, async (req, res) => {
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

// Route: /api/admin/stats (ENHANCED — full analytics dashboard)
router.get('/api/admin/stats', authMiddleware, async (req, res) => {
    const restaurantId = req.query.restaurantId || 'demo-restaurant';
    const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const to = req.query.to || new Date().toISOString().split('T')[0];

    // Calculate previous period for comparison
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const periodDays = Math.round((toDate - fromDate) / 86400000);
    const prevFrom = new Date(fromDate);
    prevFrom.setDate(prevFrom.getDate() - periodDays);
    const prevTo = from; // previous period ends where current starts

    // YoY: same period last year
    const yoyFrom = new Date(fromDate); yoyFrom.setFullYear(yoyFrom.getFullYear() - 1);
    const yoyTo = new Date(toDate); yoyTo.setFullYear(yoyTo.getFullYear() - 1);
    const yoyFromStr = yoyFrom.toISOString().split('T')[0];
    const yoyToStr = yoyTo.toISOString().split('T')[0];

    try {
        const baseWhere = `restaurant_id = $1 AND (group_id IS NULL OR is_primary = true)`;
        const activeWhere = `${baseWhere} AND status != 'cancelled'`;

        // Run ALL queries in parallel for performance
        const [
            dailyResult, peakHoursResult, avgResult, busiestDayResult,
            prevResult, prevDailyResult, prevRevenueResult,
            heatmapResult, tableUtilResult, repeatResult, revenueResult,
            partySizeResult, leadTimeResult, prevDailyRevenueResult,
            yoyBookingsResult, yoyRevenueResult, weekdayAvgResult, sourceResult,
            customerFreqResult
        ] = await Promise.all([
            // 1. Daily breakdown (current period)
            pool.query(
                `SELECT 
                    booking_date::text as date,
                    COUNT(*) FILTER (WHERE status != 'cancelled') as bookings,
                    COALESCE(SUM(guest_count) FILTER (WHERE status != 'cancelled'), 0) as couverts,
                    COUNT(*) FILTER (WHERE is_walkin = true AND status != 'cancelled') as walkins,
                    COUNT(*) FILTER (WHERE status = 'no_show') as no_shows,
                    COUNT(*) FILTER (WHERE status = 'cancelled') as cancellations,
                    COUNT(*) FILTER (WHERE status = 'arrived') as arrived
                FROM restaurant_bookings
                WHERE ${baseWhere} AND booking_date BETWEEN $2 AND $3
                GROUP BY booking_date ORDER BY booking_date`,
                [restaurantId, from, to]
            ),
            // 2. Peak hours
            pool.query(
                `SELECT EXTRACT(HOUR FROM start_time::time) as hour, COUNT(*) as count
                FROM restaurant_bookings
                WHERE ${activeWhere} AND booking_date BETWEEN $2 AND $3
                GROUP BY EXTRACT(HOUR FROM start_time::time) ORDER BY count DESC`,
                [restaurantId, from, to]
            ),
            // 3. Averages
            pool.query(
                `SELECT ROUND(AVG(guest_count), 1) as avg_party_size, COUNT(DISTINCT booking_date) as active_days
                FROM restaurant_bookings
                WHERE ${activeWhere} AND booking_date BETWEEN $2 AND $3`,
                [restaurantId, from, to]
            ),
            // 4. Busiest day of week
            pool.query(
                `SELECT EXTRACT(DOW FROM booking_date) as day_of_week, COUNT(*) as count
                FROM restaurant_bookings
                WHERE ${activeWhere} AND booking_date BETWEEN $2 AND $3
                GROUP BY EXTRACT(DOW FROM booking_date) ORDER BY count DESC LIMIT 1`,
                [restaurantId, from, to]
            ),
            // 5. PREVIOUS PERIOD comparison totals
            pool.query(
                `SELECT 
                    COUNT(*) FILTER (WHERE status != 'cancelled') as bookings,
                    COALESCE(SUM(guest_count) FILTER (WHERE status != 'cancelled'), 0) as couverts,
                    COUNT(*) FILTER (WHERE is_walkin = true AND status != 'cancelled') as walkins,
                    COUNT(*) FILTER (WHERE status = 'no_show') as no_shows,
                    COUNT(*) FILTER (WHERE status = 'cancelled') as cancellations
                FROM restaurant_bookings
                WHERE ${baseWhere} AND booking_date BETWEEN $2 AND $3`,
                [restaurantId, prevFrom.toISOString().split('T')[0], prevTo]
            ),
            // 5b. PREVIOUS PERIOD daily data (for chart overlay)
            pool.query(
                `SELECT booking_date::text as date,
                    COUNT(*) FILTER (WHERE status != 'cancelled') as bookings,
                    COALESCE(SUM(guest_count) FILTER (WHERE status != 'cancelled'), 0) as couverts
                FROM restaurant_bookings
                WHERE ${baseWhere} AND booking_date BETWEEN $2 AND $3
                GROUP BY booking_date ORDER BY booking_date`,
                [restaurantId, prevFrom.toISOString().split('T')[0], prevTo]
            ),
            // 5c. PREVIOUS PERIOD revenue
            pool.query(
                `SELECT COALESCE(SUM(revenue), 0) as total_revenue
                FROM daily_revenue
                WHERE restaurant_id = $1 AND date BETWEEN $2 AND $3`,
                [restaurantId, prevFrom.toISOString().split('T')[0], prevTo]
            ).catch(() => ({ rows: [{ total_revenue: 0 }] })),
            // 6. HOURLY HEATMAP (day_of_week × hour)
            pool.query(
                `SELECT 
                    EXTRACT(DOW FROM booking_date)::int as dow,
                    EXTRACT(HOUR FROM start_time::time)::int as hour,
                    COUNT(*) as count
                FROM restaurant_bookings
                WHERE ${activeWhere} AND booking_date BETWEEN $2 AND $3
                GROUP BY EXTRACT(DOW FROM booking_date), EXTRACT(HOUR FROM start_time::time)`,
                [restaurantId, from, to]
            ),
            // 7. TABLE UTILIZATION
            pool.query(
                `SELECT rt.id, rt.name, rt.seats, rt.zone,
                    COUNT(rb.id) as booking_count,
                    COALESCE(SUM(rb.guest_count), 0) as total_guests
                FROM restaurant_tables rt
                LEFT JOIN restaurant_bookings rb 
                    ON rb.table_id = rt.id AND rb.booking_date BETWEEN $2 AND $3 
                    AND rb.status != 'cancelled' AND (rb.group_id IS NULL OR rb.is_primary = true)
                WHERE rt.restaurant_id = $1 AND rt.is_active = true
                GROUP BY rt.id, rt.name, rt.seats, rt.zone
                ORDER BY booking_count DESC`,
                [restaurantId, from, to]
            ),
            // 8. REPEAT CUSTOMERS (by email, not customer_visits column)
            pool.query(
                `SELECT 
                    COUNT(*) as total_bookings,
                    COUNT(*) FILTER (WHERE customer_email IN (
                        SELECT customer_email FROM restaurant_bookings 
                        WHERE restaurant_id = $1 AND status != 'cancelled' AND customer_email IS NOT NULL AND customer_email != ''
                        GROUP BY customer_email HAVING COUNT(*) > 1
                    )) as repeat_bookings,
                    (SELECT COUNT(DISTINCT customer_email) FROM restaurant_bookings 
                     WHERE restaurant_id = $1 AND status != 'cancelled' AND customer_email IS NOT NULL AND customer_email != ''
                     AND customer_email IN (
                        SELECT customer_email FROM restaurant_bookings 
                        WHERE restaurant_id = $1 AND status != 'cancelled' AND customer_email IS NOT NULL
                        GROUP BY customer_email HAVING COUNT(*) > 1
                     )) as repeat_customers
                FROM restaurant_bookings
                WHERE ${activeWhere} AND booking_date BETWEEN $2 AND $3`,
                [restaurantId, from, to]
            ),
            // 9. DAILY REVENUE (left join)
            pool.query(
                `SELECT date::text, revenue::float, notes 
                FROM daily_revenue 
                WHERE restaurant_id = $1 AND date BETWEEN $2 AND $3
                ORDER BY date`,
                [restaurantId, from, to]
            ).catch(() => ({ rows: [] })), // table might not exist yet
            // 10. PARTY SIZE DISTRIBUTION
            pool.query(
                `SELECT 
                    CASE 
                        WHEN guest_count = 1 THEN '1'
                        WHEN guest_count = 2 THEN '2'
                        WHEN guest_count BETWEEN 3 AND 4 THEN '3-4'
                        WHEN guest_count BETWEEN 5 AND 6 THEN '5-6'
                        ELSE '7+'
                    END as party_size,
                    COUNT(*) as count,
                    COALESCE(SUM(guest_count), 0) as total_guests
                FROM restaurant_bookings
                WHERE ${activeWhere} AND booking_date BETWEEN $2 AND $3
                GROUP BY 1
                ORDER BY MIN(guest_count)`,
                [restaurantId, from, to]
            ),
            // 11. BOOKING LEAD TIME (days between created_at and booking_date)
            pool.query(
                `SELECT 
                    CASE 
                        WHEN (booking_date - created_at::date) = 0 THEN 'same_day'
                        WHEN (booking_date - created_at::date) = 1 THEN '1_day'
                        WHEN (booking_date - created_at::date) BETWEEN 2 AND 3 THEN '2_3_days'
                        WHEN (booking_date - created_at::date) BETWEEN 4 AND 7 THEN '4_7_days'
                        ELSE '8_plus'
                    END as lead_time,
                    COUNT(*) as count
                FROM restaurant_bookings
                WHERE ${activeWhere} AND booking_date BETWEEN $2 AND $3
                    AND created_at IS NOT NULL
                GROUP BY 1`,
                [restaurantId, from, to]
            ),
            // 12. PREVIOUS PERIOD daily revenue (for chart overlay)
            pool.query(
                `SELECT date::text, revenue::float
                FROM daily_revenue
                WHERE restaurant_id = $1 AND date BETWEEN $2 AND $3
                ORDER BY date`,
                [restaurantId, prevFrom.toISOString().split('T')[0], prevTo]
            ).catch(() => ({ rows: [] })),
            // 13. YOY bookings + couverts
            pool.query(
                `SELECT 
                    COUNT(*) FILTER (WHERE status != 'cancelled') as bookings,
                    COALESCE(SUM(guest_count) FILTER (WHERE status != 'cancelled'), 0) as couverts
                FROM restaurant_bookings
                WHERE ${baseWhere} AND booking_date BETWEEN $2 AND $3`,
                [restaurantId, yoyFromStr, yoyToStr]
            ).catch(() => ({ rows: [{ bookings: 0, couverts: 0 }] })),
            // 14. YOY revenue
            pool.query(
                `SELECT COALESCE(SUM(revenue), 0) as total_revenue
                FROM daily_revenue
                WHERE restaurant_id = $1 AND date BETWEEN $2 AND $3`,
                [restaurantId, yoyFromStr, yoyToStr]
            ).catch(() => ({ rows: [{ total_revenue: 0 }] })),
            // 15. WEEKDAY AVERAGES — all-time baseline per day-of-week
            pool.query(
                `SELECT 
                    EXTRACT(DOW FROM booking_date)::int as dow,
                    ROUND(COUNT(*) FILTER (WHERE status != 'cancelled')::numeric / NULLIF(COUNT(DISTINCT booking_date), 0), 1) as avg_bookings,
                    ROUND(COALESCE(SUM(guest_count) FILTER (WHERE status != 'cancelled'), 0)::numeric / NULLIF(COUNT(DISTINCT booking_date), 0), 1) as avg_couverts
                FROM restaurant_bookings
                WHERE ${baseWhere}
                GROUP BY 1 ORDER BY 1`,
                [restaurantId]
            ).catch(() => ({ rows: [] })),
            // 16. SOURCE BREAKDOWN
            pool.query(
                `SELECT 
                    COALESCE(source, 'website') as source,
                    COUNT(*) FILTER (WHERE status != 'cancelled') as bookings,
                    COALESCE(SUM(guest_count) FILTER (WHERE status != 'cancelled'), 0) as couverts
                FROM restaurant_bookings
                WHERE ${baseWhere} AND booking_date BETWEEN $2 AND $3
                GROUP BY 1 ORDER BY 2 DESC`,
                [restaurantId, from, to]
            ).catch(() => ({ rows: [] })),
            // 17. CUSTOMER BOOKING FREQUENCY (all-time per email)
            pool.query(
                `SELECT 
                    booking_count as times,
                    COUNT(*) as customers,
                    SUM(booking_count) as total_bookings,
                    SUM(total_couverts) as total_couverts
                FROM (
                    SELECT customer_email, 
                        COUNT(*) FILTER (WHERE status != 'cancelled') as booking_count,
                        COALESCE(SUM(guest_count) FILTER (WHERE status != 'cancelled'), 0) as total_couverts
                    FROM restaurant_bookings
                    WHERE restaurant_id = $1 AND (group_id IS NULL OR is_primary = true)
                        AND customer_email IS NOT NULL AND customer_email != ''
                    GROUP BY customer_email
                ) sub
                WHERE booking_count > 0
                GROUP BY booking_count
                ORDER BY booking_count`,
                [restaurantId]
            ).catch(() => ({ rows: [] }))
        ]);

        // Revenue totals (MUST be before comparison calc)
        const totalRevenue = revenueResult.rows.reduce((s, r) => s + (r.revenue || 0), 0);
        const revenueMap = {};
        for (const r of revenueResult.rows) revenueMap[r.date] = { revenue: r.revenue, notes: r.notes };

        // Previous period revenue map for chart overlay
        const prevRevenueMap = {};
        for (const r of (prevDailyRevenueResult?.rows || [])) prevRevenueMap[r.date] = r.revenue || 0;

        // Compute totals
        const totals = dailyResult.rows.reduce((acc, row) => ({
            bookings: acc.bookings + parseInt(row.bookings),
            couverts: acc.couverts + parseInt(row.couverts),
            walkins: acc.walkins + parseInt(row.walkins),
            no_shows: acc.no_shows + parseInt(row.no_shows),
            cancellations: acc.cancellations + parseInt(row.cancellations),
            arrived: acc.arrived + parseInt(row.arrived)
        }), { bookings: 0, couverts: 0, walkins: 0, no_shows: 0, cancellations: 0, arrived: 0 });

        // Previous period totals for comparison
        const prev = prevResult.rows[0] || {};
        const prevTotals = {
            bookings: parseInt(prev.bookings) || 0,
            couverts: parseInt(prev.couverts) || 0,
            walkins: parseInt(prev.walkins) || 0,
            no_shows: parseInt(prev.no_shows) || 0,
            cancellations: parseInt(prev.cancellations) || 0
        };
        const prevRevenue = parseFloat(prevRevenueResult.rows[0]?.total_revenue) || 0;

        // Calculate % change
        const pctChange = (curr, prev) => prev > 0 ? Math.round(((curr - prev) / prev) * 100) : (curr > 0 ? 100 : 0);
        const comparison = {
            bookings: pctChange(totals.bookings, prevTotals.bookings),
            couverts: pctChange(totals.couverts, prevTotals.couverts),
            walkins: pctChange(totals.walkins, prevTotals.walkins),
            no_shows: pctChange(totals.no_shows, prevTotals.no_shows),
            cancellations: pctChange(totals.cancellations, prevTotals.cancellations),
            revenue: pctChange(totalRevenue, prevRevenue)
        };

        // Repeat rate
        const repeatData = repeatResult.rows[0] || {};
        const repeatRate = parseInt(repeatData.total_bookings) > 0
            ? Math.round((parseInt(repeatData.repeat_bookings) || 0) / parseInt(repeatData.total_bookings) * 100)
            : 0;

        const dayNames = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];

        res.set('Cache-Control', 'private, max-age=30');
        res.json({
            daily: dailyResult.rows.map(r => ({
                ...r,
                revenue: revenueMap[r.date]?.revenue || null,
                revenue_notes: revenueMap[r.date]?.notes || null
            })),
            totals,
            comparison,
            peak_hours: peakHoursResult.rows.map(r => ({ hour: parseInt(r.hour), count: parseInt(r.count) })),
            avg_party_size: parseFloat(avgResult.rows[0]?.avg_party_size) || 0,
            active_days: parseInt(avgResult.rows[0]?.active_days) || 0,
            busiest_day: busiestDayResult.rows[0] ? dayNames[parseInt(busiestDayResult.rows[0].day_of_week)] : null,
            heatmap: heatmapResult.rows.map(r => ({ dow: parseInt(r.dow), hour: parseInt(r.hour), count: parseInt(r.count) })),
            table_utilization: tableUtilResult.rows.map(r => ({
                id: r.id, name: r.name, seats: r.seats, zone: r.zone,
                booking_count: parseInt(r.booking_count), total_guests: parseInt(r.total_guests)
            })),
            repeat_rate: repeatRate,
            repeat_customers: parseInt(repeatData.repeat_customers) || 0,
            revenue: { total: totalRevenue, avg_per_couvert: totals.couverts > 0 ? Math.round(totalRevenue / totals.couverts * 100) / 100 : 0 },
            prev_daily: prevDailyResult.rows.map((r, i) => {
                const prevRevRow = (prevDailyRevenueResult?.rows || []).find(pr => pr.date === r.date);
                return {
                    date: r.date,
                    bookings: parseInt(r.bookings) || 0,
                    couverts: parseInt(r.couverts) || 0,
                    revenue: prevRevRow?.revenue || 0
                };
            }),
            party_size_distribution: (partySizeResult?.rows || []).map(r => ({
                size: r.party_size,
                count: parseInt(r.count) || 0,
                guests: parseInt(r.total_guests) || 0
            })),
            lead_time_distribution: (leadTimeResult?.rows || []).map(r => ({
                bucket: r.lead_time,
                count: parseInt(r.count) || 0
            })),
            period: { from, to },
            yoy: (() => {
                const yb = parseInt(yoyBookingsResult?.rows?.[0]?.bookings) || 0;
                const yc = parseInt(yoyBookingsResult?.rows?.[0]?.couverts) || 0;
                const yr = parseFloat(yoyRevenueResult?.rows?.[0]?.total_revenue) || 0;
                return {
                    bookings: yb > 0 ? Math.round(((totals.bookings - yb) / yb) * 100) : null,
                    couverts: yc > 0 ? Math.round(((totals.couverts - yc) / yc) * 100) : null,
                    revenue: yr > 0 ? Math.round(((totalRevenue - yr) / yr) * 100) : null,
                    has_data: yb > 0 || yc > 0
                };
            }),
            weekday_averages: (weekdayAvgResult?.rows || []).map(r => ({
                dow: parseInt(r.dow),
                avg_bookings: parseFloat(r.avg_bookings) || 0,
                avg_couverts: parseFloat(r.avg_couverts) || 0
            })),
            source_breakdown: (sourceResult?.rows || []).map(r => ({
                source: r.source,
                bookings: parseInt(r.bookings) || 0,
                couverts: parseInt(r.couverts) || 0
            })),
            customer_frequency: (customerFreqResult?.rows || []).map(r => ({
                times: parseInt(r.times) || 0,
                customers: parseInt(r.customers) || 0,
                total_bookings: parseInt(r.total_bookings) || 0,
                total_couverts: parseInt(r.total_couverts) || 0
            }))
        });
    } catch (error) {
        console.error('Stats error:', error.message);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Route: PUT /api/admin/daily-revenue — save/update daily revenue
router.put('/api/admin/daily-revenue', authMiddleware, async (req, res) => {
    const restaurantId = req.body.restaurantId || req.query.restaurantId || 'demo-restaurant';
    const { date, revenue, notes } = req.body;

    if (!date || revenue === undefined) {
        return res.status(400).json({ error: 'date and revenue are required' });
    }

    try {
        await pool.query(
            `INSERT INTO daily_revenue (restaurant_id, date, revenue, notes, updated_at)
             VALUES ($1, $2, $3, $4, now())
             ON CONFLICT (restaurant_id, date) 
             DO UPDATE SET revenue = $3, notes = $4, updated_at = now()`,
            [restaurantId, date, parseFloat(revenue), notes || null]
        );
        res.json({ success: true, date, revenue: parseFloat(revenue) });
    } catch (error) {
        console.error('Revenue save error:', error.message);
        res.status(500).json({ error: 'Failed to save revenue' });
    }
});

// Route: GET /api/admin/stats/export — CSV export
router.get('/api/admin/stats/export', authMiddleware, async (req, res) => {
    const restaurantId = req.query.restaurantId || 'demo-restaurant';
    const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const to = req.query.to || new Date().toISOString().split('T')[0];

    try {
        const result = await pool.query(
            `SELECT 
                rb.booking_date::text as datum,
                COUNT(*) FILTER (WHERE rb.status != 'cancelled') as boekingen,
                COALESCE(SUM(rb.guest_count) FILTER (WHERE rb.status != 'cancelled'), 0) as couverts,
                COUNT(*) FILTER (WHERE rb.is_walkin = true AND rb.status != 'cancelled') as walkins,
                COUNT(*) FILTER (WHERE rb.status = 'no_show') as no_shows,
                COUNT(*) FILTER (WHERE rb.status = 'cancelled') as annuleringen,
                COALESCE(dr.revenue, 0) as omzet
            FROM restaurant_bookings rb
            LEFT JOIN daily_revenue dr ON dr.restaurant_id = rb.restaurant_id AND dr.date = rb.booking_date
            WHERE rb.restaurant_id = $1 AND rb.booking_date BETWEEN $2 AND $3
              AND (rb.group_id IS NULL OR rb.is_primary = true)
            GROUP BY rb.booking_date, dr.revenue
            ORDER BY rb.booking_date`,
            [restaurantId, from, to]
        );

        // Build CSV
        const headers = ['Datum', 'Boekingen', 'Couverts', 'Walk-ins', 'No-shows', 'Annuleringen', 'Omzet (€)'];
        const rows = result.rows.map(r =>
            [r.datum, r.boekingen, r.couverts, r.walkins, r.no_shows, r.annuleringen, r.omzet].join(',')
        );
        const csv = [headers.join(','), ...rows].join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="stats-${from}-${to}.csv"`);
        res.send('\uFEFF' + csv); // BOM for Excel compatibility
    } catch (error) {
        console.error('CSV export error:', error.message);
        res.status(500).json({ error: 'Failed to export stats' });
    }
});

// Route: POST /api/admin/stats/pdf-token — Generate short-lived token for PDF access
router.post('/api/admin/stats/pdf-token', authMiddleware, async (req, res) => {
    try {
        const jwt = require('jsonwebtoken');
        const secret = process.env.JWT_SECRET || 'your-secret-key';
        // Short-lived token (5 minutes) scoped to PDF only
        const pdfToken = jwt.sign(
            { userId: req.user?.id || req.user?.userId, purpose: 'pdf' },
            secret,
            { expiresIn: '5m' }
        );
        res.json({ token: pdfToken });
    } catch (error) {
        console.error('PDF token error:', error.message);
        res.status(500).json({ error: 'Failed to generate PDF token' });
    }
});

// Route: GET /api/admin/stats/pdf — Print-ready HTML summary (save as PDF from browser)
router.get('/api/admin/stats/pdf', async (req, res) => {
    // Auth via query param (since opened via <a> tag) — accepts both regular and short-lived tokens
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    try {
        const jwt = require('jsonwebtoken');
        jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    const restaurantId = req.query.restaurantId || 'demo-restaurant';
    const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const to = req.query.to || new Date().toISOString().split('T')[0];

    try {
        const baseWhere = `restaurant_id = $1 AND (group_id IS NULL OR is_primary = true)`;

        const [dailyResult, totalsResult, revenueResult] = await Promise.all([
            pool.query(
                `SELECT booking_date::text as date,
                    COUNT(*) FILTER (WHERE status != 'cancelled') as bookings,
                    COALESCE(SUM(guest_count) FILTER (WHERE status != 'cancelled'), 0) as couverts,
                    COUNT(*) FILTER (WHERE is_walkin = true AND status != 'cancelled') as walkins,
                    COUNT(*) FILTER (WHERE status = 'no_show') as no_shows,
                    COUNT(*) FILTER (WHERE status = 'cancelled') as cancellations
                FROM restaurant_bookings
                WHERE ${baseWhere} AND booking_date BETWEEN $2 AND $3
                GROUP BY booking_date ORDER BY booking_date`,
                [restaurantId, from, to]
            ),
            pool.query(
                `SELECT COUNT(*) FILTER (WHERE status != 'cancelled') as bookings,
                    COALESCE(SUM(guest_count) FILTER (WHERE status != 'cancelled'), 0) as couverts,
                    COUNT(*) FILTER (WHERE is_walkin = true AND status != 'cancelled') as walkins,
                    COUNT(*) FILTER (WHERE status = 'no_show') as no_shows,
                    COUNT(*) FILTER (WHERE status = 'cancelled') as cancellations
                FROM restaurant_bookings
                WHERE ${baseWhere} AND booking_date BETWEEN $2 AND $3`,
                [restaurantId, from, to]
            ),
            pool.query(
                `SELECT COALESCE(SUM(revenue), 0) as total FROM daily_revenue WHERE restaurant_id = $1 AND date BETWEEN $2 AND $3`,
                [restaurantId, from, to]
            ).catch(() => ({ rows: [{ total: 0 }] }))
        ]);

        const t = totalsResult.rows[0] || {};
        const rev = parseFloat(revenueResult.rows[0]?.total) || 0;
        const bookings = parseInt(t.bookings) || 0;
        const couverts = parseInt(t.couverts) || 0;

        const dailyRows = dailyResult.rows.map(r => {
            const d = new Date(r.date);
            return `<tr>
                <td>${d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                <td class="r">${r.bookings}</td><td class="r">${r.couverts}</td>
                <td class="r">${r.walkins}</td><td class="r">${r.no_shows}</td>
                <td class="r">${r.cancellations}</td>
            </tr>`;
        }).join('');

        const html = `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8">
<title>Dashboard Rapport ${from} – ${to}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111;padding:40px;max-width:800px;margin:0 auto;font-size:14px}
h1{font-size:22px;margin-bottom:4px}
.sub{color:#666;font-size:13px;margin-bottom:24px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}
.kpi{border:1px solid #e5e7eb;border-radius:12px;padding:16px}
.kpi .label{font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
.kpi .val{font-size:28px;font-weight:700}
.kpi .sub2{font-size:12px;color:#999;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#666;text-transform:uppercase}
td{padding:6px 8px;border-bottom:1px solid #f3f4f6}
.r{text-align:right;font-variant-numeric:tabular-nums}
.total td{font-weight:700;border-top:2px solid #111;border-bottom:none}
.footer{margin-top:24px;font-size:11px;color:#999;text-align:center}
@media print{body{padding:20px}}
</style></head><body>
<h1>Dashboard Rapport</h1>
<div class="sub">${new Date(from).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })} – ${new Date(to).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })} · Gegenereerd ${new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>

<div class="kpis">
<div class="kpi"><div class="label">Omzet</div><div class="val">€${rev.toLocaleString('nl-NL')}</div><div class="sub2">${couverts > 0 ? `€${(rev / couverts).toFixed(2)}/couvert` : ''}</div></div>
<div class="kpi"><div class="label">Couverts</div><div class="val">${couverts}</div><div class="sub2">Ø ${dailyResult.rows.length > 0 ? Math.round(couverts / dailyResult.rows.length) : 0}/dag</div></div>
<div class="kpi"><div class="label">Boekingen</div><div class="val">${bookings}</div></div>
<div class="kpi"><div class="label">No-shows / Annul.</div><div class="val">${t.no_shows || 0} / ${t.cancellations || 0}</div><div class="sub2">${bookings > 0 ? Math.round((parseInt(t.no_shows) || 0) / bookings * 100) : 0}% / ${bookings > 0 ? Math.round((parseInt(t.cancellations) || 0) / bookings * 100) : 0}%</div></div>
</div>

<table>
<thead><tr><th>Datum</th><th class="r">Boek.</th><th class="r">Couv.</th><th class="r">Walk-in</th><th class="r">No-show</th><th class="r">Annul.</th></tr></thead>
<tbody>${dailyRows}
<tr class="total"><td>Totaal</td><td class="r">${bookings}</td><td class="r">${couverts}</td><td class="r">${t.walkins || 0}</td><td class="r">${t.no_shows || 0}</td><td class="r">${t.cancellations || 0}</td></tr>
</tbody></table>

<div class="footer">Tapla Dashboard · ${new Date().getFullYear()}</div>
</body></html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (error) {
        console.error('PDF export error:', error.message);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// Route: /api/admin/reconcile
router.get('/api/admin/reconcile', authMiddleware, async (req, res) => {
    const restaurantId = req.query.restaurantId || 'demo-restaurant';
    const shouldRepair = req.query.repair === 'true';

    try {
        // Get actual booking counts grouped by slot and table type
        // P2 FIX #24: Include large-group bookings with tables_allocated
        const bookingCounts = await pool.query(
            `SELECT 
                b.slot_id,
                b.table_type,
                b.is_large_group,
                b.tables_allocated,
                COUNT(*) as count
             FROM bookings b
             JOIN slots s ON s.id = b.slot_id
             JOIN events e ON e.id = s.event_id
             WHERE e.restaurant_id = $1 AND b.status = 'confirmed'
             GROUP BY b.slot_id, b.table_type, b.is_large_group, b.tables_allocated`,
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

        // Build lookup of actual counts (handle both regular and large-group bookings)
        const actualCounts = {};
        for (const row of bookingCounts.rows) {
            if (!actualCounts[row.slot_id]) {
                actualCounts[row.slot_id] = { '2': 0, '4': 0, '6': 0 };
            }
            if (row.is_large_group && row.tables_allocated) {
                // Large-group: parse tables_allocated and add each table type
                let tablesAllocated;
                try {
                    tablesAllocated = typeof row.tables_allocated === 'string'
                        ? JSON.parse(row.tables_allocated) : row.tables_allocated;
                } catch (e) { tablesAllocated = []; }
                const bookingCount = parseInt(row.count);
                for (const table of tablesAllocated) {
                    const key = String(table.seats);
                    if (actualCounts[row.slot_id][key] !== undefined) {
                        actualCounts[row.slot_id][key] += table.count * bookingCount;
                    }
                }
            } else if (row.table_type) {
                actualCounts[row.slot_id][row.table_type] = parseInt(row.count);
            }
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

// Route: /api/admin/save
router.post('/api/admin/save', authMiddleware, async (req, res) => {
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
                let startDatetime;
                try {
                    startDatetime = parseSlotDateTime(slot.date, slot.time);
                } catch (parseError) {
                    const err = new Error(
                        `Invalid slot date/time for slot ${slot.id || 'unknown'}: ${parseError.message}`
                    );
                    err.statusCode = 422;
                    throw err;
                }
                // P0 FIX #5: Preserve existing booked counts on update — only set on INSERT
                await client.query(
                    `INSERT INTO slots (id, event_id, zone_id, start_datetime, is_highlighted, booked_count_2_tops, booked_count_4_tops, booked_count_6_tops)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT (id) DO UPDATE SET
                       zone_id = $3, start_datetime = $4, is_highlighted = $5`,
                    [slot.id, event.id, slot.wijkId, startDatetime, slot.isNextAvailable || false,
                    slot.booked2tops || 0, slot.booked4tops || 0, slot.booked6tops || 0]
                );
            }
        }

        await client.query('COMMIT');
        invalidatePublicCacheForRestaurant(targetRestaurantId);
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

        if (error.statusCode === 422) {
            return res.status(422).json({ error: error.message });
        }

        res.status(500).json({ error: 'Failed to save changes' });
    } finally {
        client.release();
    }
});

// Route: /api/restaurant/:restaurantId/waitlist
router.get('/api/restaurant/:restaurantId/waitlist', authMiddleware, async (req, res) => {
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

// Route: /api/restaurant/:restaurantId/waitlist/:id
router.put('/api/restaurant/:restaurantId/waitlist/:id', authMiddleware, async (req, res) => {
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

// Route: /api/restaurant/:restaurantId/waitlist/:id
router.delete('/api/restaurant/:restaurantId/waitlist/:id', authMiddleware, async (req, res) => {
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

// Route: /api/restaurant/:restaurantId/tables
router.put('/api/restaurant/:restaurantId/tables', authMiddleware, async (req, res) => {
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
        invalidatePublicCacheForRestaurant(restaurantId);
        res.json({ success: true, count: tables.length });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating tables:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Route: /api/admin/restaurant-bookings
router.get('/api/admin/restaurant-bookings', authMiddleware, async (req, res) => {
    const { restaurantId, date } = req.query;
    const targetRestaurantId = restaurantId || 'demo-restaurant';
    const targetDate = date || new Date().toISOString().split('T')[0];

    try {
        // P3 PERF: Use CTEs instead of correlated subqueries (eliminates N+1 queries)
        const result = await pool.query(
            `WITH visit_counts AS (
                SELECT customer_id, COUNT(DISTINCT id) as visit_count
                FROM restaurant_bookings
                WHERE restaurant_id = $1 AND customer_id IS NOT NULL AND status = 'arrived' AND booking_date < $2
                GROUP BY customer_id
            ),
            linked AS (
                SELECT sibling.group_id,
                       string_agg(COALESCE(rt2.name, sibling.table_id), ' + ' ORDER BY rt2.seats DESC) as linked_tables
                FROM restaurant_bookings sibling
                LEFT JOIN restaurant_tables rt2 ON rt2.id = sibling.table_id
                WHERE sibling.restaurant_id = $1 AND sibling.booking_date = $2
                  AND sibling.group_id IS NOT NULL AND sibling.status != 'cancelled'
                  AND sibling.is_primary IS DISTINCT FROM true
                GROUP BY sibling.group_id
            )
            SELECT rb.id, rb.table_id, to_char(rb.start_time, 'HH24:MI') as start_time, to_char(rb.end_time, 'HH24:MI') as end_time, 
                    rb.guest_count, rb.customer_name, rb.customer_email, rb.customer_phone,
                    rb.status, COALESCE(rt.name, 'Geen tafel') as table_name,
                    rb.remarks, rb.customer_id, rb.group_id, rb.is_primary,
                    COALESCE(vc.visit_count, 0) as visit_count,
                    lnk.linked_tables
             FROM restaurant_bookings rb
             LEFT JOIN restaurant_tables rt ON rt.id = rb.table_id
             LEFT JOIN visit_counts vc ON vc.customer_id = rb.customer_id
             LEFT JOIN linked lnk ON lnk.group_id = rb.group_id AND rb.group_id IS NOT NULL
             WHERE rb.restaurant_id = $1 AND rb.booking_date = $2 AND rb.status != 'cancelled'
               AND (rb.group_id IS NULL OR rb.is_primary = true)
             ORDER BY rb.start_time ASC`,
            [targetRestaurantId, targetDate]
        );
        res.json({ bookings: result.rows, date: targetDate });
    } catch (error) {
        console.error('Admin restaurant bookings error:', error);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});

// Route: /api/admin/customer-history
// Returns past bookings for a customer by email or customer_id
router.get('/api/admin/customer-history', authMiddleware, async (req, res) => {
    const { restaurantId, email, customerId } = req.query;
    const rid = restaurantId || 'demo-restaurant';

    try {
        let result;
        if (customerId) {
            result = await pool.query(
                `SELECT rb.booking_date::text, to_char(rb.start_time, 'HH24:MI') as start_time, rb.guest_count, 
                        rb.status, rb.remarks, rb.customer_name,
                        COALESCE(rt.name, '-') as table_name
                 FROM restaurant_bookings rb
                 LEFT JOIN restaurant_tables rt ON rt.id = rb.table_id
                 WHERE rb.restaurant_id = $1 AND rb.customer_id = $2
                 ORDER BY rb.booking_date DESC, rb.start_time DESC
                 LIMIT 10`,
                [rid, customerId]
            );
        } else if (email) {
            result = await pool.query(
                `SELECT rb.booking_date::text, to_char(rb.start_time, 'HH24:MI') as start_time, rb.guest_count, 
                        rb.status, rb.remarks, rb.customer_name,
                        COALESCE(rt.name, '-') as table_name
                 FROM restaurant_bookings rb
                 LEFT JOIN restaurant_tables rt ON rt.id = rb.table_id
                 WHERE rb.restaurant_id = $1 AND lower(rb.customer_email) = lower($2)
                 ORDER BY rb.booking_date DESC, rb.start_time DESC
                 LIMIT 10`,
                [rid, email]
            );
        } else {
            return res.json({ history: [] });
        }
        res.json({ history: result.rows });
    } catch (error) {
        console.error('Customer history error:', error);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

// Route: /api/admin/restaurant-bookings/:id/status
router.patch('/api/admin/restaurant-bookings/:id/status', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['confirmed', 'arrived', 'no_show', 'cancelled', 'walkin'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    // P1 FIX #13: Scope status update to authenticated restaurant
    const restaurantId = req.query.restaurantId || req.user?.restaurantId || 'demo-restaurant';

    try {
        const result = await pool.query(
            `UPDATE restaurant_bookings 
             SET status = $1, arrived_at = ${status === 'arrived' ? 'NOW()' : 'NULL'}, updated_at = NOW()
             WHERE id = $2 AND restaurant_id = $3
             RETURNING *`,
            [status, id, restaurantId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // Update customer visit count if arrived
        if (status === 'arrived' && result.rows[0].customer_id) {
            await pool.query(
                `UPDATE customers SET total_visits = total_visits + 1, last_visit = CURRENT_DATE WHERE id = $1`,
                [result.rows[0].customer_id]
            ).catch(() => { }); // silently fail if customers table doesn't exist
        }

        res.json({ success: true, booking: result.rows[0] });
    } catch (error) {
        console.error('Update booking status error:', error);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// Route: /api/admin/bookings
router.post('/api/admin/bookings', authMiddleware, async (req, res) => {
    try {
        const { restaurantId, eventId, customer_name, customer_email, customer_phone, guest_count, remarks } = req.body;

        if (!restaurantId || !eventId || !customer_name || !guest_count) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // FIX #45: Input validation on admin event booking
        if (typeof customer_name !== 'string' || customer_name.trim().length === 0 || customer_name.length > 120) {
            return res.status(422).json({ error: 'Invalid customer name' });
        }
        if (typeof guest_count !== 'number' || guest_count < 1) {
            return res.status(422).json({ error: 'Guest count must be at least 1' });
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

        invalidatePublicCacheForRestaurant(restaurantId);
        res.json({ success: true, booking_id: bookingId });
    } catch (error) {
        console.error('Admin event booking error:', error);
        res.status(500).json({ error: 'Failed to create booking' });
    }
});

// Route: /api/admin/restaurant-bookings
router.post('/api/admin/restaurant-bookings', authMiddleware, async (req, res) => {
    const { restaurantId, date, time, customer_name, customer_email, customer_phone, guest_count, remarks } = req.body;

    if (!restaurantId || !date || !time || !customer_name || !guest_count) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // FIX #44: Input validation on admin restaurant booking
    if (typeof customer_name !== 'string' || customer_name.trim().length === 0 || customer_name.length > 120) {
        return res.status(422).json({ error: 'Invalid customer name' });
    }
    if (typeof guest_count !== 'number' || guest_count < 1) {
        return res.status(422).json({ error: 'Guest count must be at least 1' });
    }
    if (customer_email && (typeof customer_email !== 'string' || customer_email.length > 254)) {
        return res.status(422).json({ error: 'Invalid email' });
    }
    if (customer_phone && (typeof customer_phone !== 'string' || customer_phone.length > 30)) {
        return res.status(422).json({ error: 'Invalid phone' });
    }
    if (remarks && (typeof remarks !== 'string' || remarks.length > 1000)) {
        return res.status(422).json({ error: 'Remarks too long' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get closing time
        // FIX #42: Parse date parts manually (same as #11 fix for public booking)
        const [yr2, mo2, dy2] = date.split('-').map(Number);
        const dayOfWeek = new Date(yr2, mo2 - 1, dy2).getDay();
        const openingQ = await client.query(
            `SELECT close_time FROM restaurant_openings WHERE restaurant_id = $1 AND day_of_week = $2 LIMIT 1`,
            [restaurantId, dayOfWeek]
        );
        const closeTime = openingQ.rows[0]?.close_time || '23:59';
        // Accept optional end_time or duration from frontend
        const reqEndTime = req.body.end_time;
        const reqDuration = req.body.duration; // in minutes
        let endTime;
        if (reqEndTime) {
            const closeMins = timeToMins(closeTime);
            const reqEndMins = timeToMins(reqEndTime);
            endTime = reqEndMins <= closeMins ? reqEndTime : minsToTime(closeMins);
        } else {
            endTime = computeEndTime(time, closeTime, reqDuration || undefined);
        }

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
        invalidatePublicCacheForRestaurant(restaurantId);

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

// Route: PATCH /api/admin/restaurant-bookings/:id — Edit booking details
router.patch('/api/admin/restaurant-bookings/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const restaurantId = req.body.restaurantId || req.query.restaurantId || req.user?.restaurantId || 'demo-restaurant';
    const { guest_count, customer_name, customer_email, customer_phone, remarks, date, time, end_time, duration } = req.body;

    // Input validation
    if (guest_count !== undefined && (typeof guest_count !== 'number' || guest_count < 1)) {
        return res.status(422).json({ error: 'Guest count must be at least 1' });
    }
    if (customer_name !== undefined && (typeof customer_name !== 'string' || customer_name.trim().length === 0 || customer_name.length > 120)) {
        return res.status(422).json({ error: 'Invalid customer name' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Fetch current booking
        const currentQ = await client.query(
            `SELECT * FROM restaurant_bookings WHERE id = $1 AND restaurant_id = $2`,
            [id, restaurantId]
        );
        if (currentQ.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Booking not found' });
        }
        const current = currentQ.rows[0];

        // Build updated fields
        const updatedName = customer_name !== undefined ? customer_name.trim() : current.customer_name;
        const updatedEmail = customer_email !== undefined ? (customer_email || null) : current.customer_email;
        const updatedPhone = customer_phone !== undefined ? (customer_phone || null) : current.customer_phone;
        const updatedRemarks = remarks !== undefined ? (remarks || null) : current.remarks;
        const updatedGuests = guest_count !== undefined ? guest_count : current.guest_count;
        const updatedDate = date || (typeof current.booking_date === 'string' ? current.booking_date : current.booking_date.toISOString().split('T')[0]);
        const currentStartStr = typeof current.start_time === 'string' ? current.start_time.substring(0, 5) : current.start_time;
        const updatedTime = time || currentStartStr;

        // Calculate end time if time/date/duration changed
        let updatedEndTime;
        if (end_time) {
            updatedEndTime = end_time;
        } else if (time || duration || date) {
            const [yr, mo, dy] = updatedDate.split('-').map(Number);
            const dayOfWeek = new Date(yr, mo - 1, dy).getDay();
            const openingQ = await client.query(
                `SELECT close_time FROM restaurant_openings WHERE restaurant_id = $1 AND day_of_week = $2 LIMIT 1`,
                [restaurantId, dayOfWeek]
            );
            const closeTime = openingQ.rows[0]?.close_time || '23:59';
            updatedEndTime = computeEndTime(updatedTime, closeTime, duration || undefined);
        } else {
            updatedEndTime = typeof current.end_time === 'string' ? current.end_time.substring(0, 5) : current.end_time;
        }

        // If time/date/guests changed, re-check table availability
        const timeChanged = time || date || (guest_count !== undefined && guest_count !== current.guest_count);
        let newTableId = current.table_id;

        if (timeChanged) {
            const allTablesQ = await client.query(
                `SELECT id, name, seats, zone FROM restaurant_tables WHERE restaurant_id = $1 AND is_active = true ORDER BY seats DESC`,
                [restaurantId]
            );
            const bookingsQ = await client.query(
                `SELECT table_id, to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time
                 FROM restaurant_bookings
                 WHERE restaurant_id = $1 AND booking_date = $2 AND lower(status) != 'cancelled' AND id != $3`,
                [restaurantId, updatedDate, id]
            );
            const bookingsByTableId = buildBookingsMap(bookingsQ.rows);
            const selectedTables = selectTablesForSlot({
                allTables: allTablesQ.rows,
                bookingsByTableId,
                slotStart: updatedTime,
                slotEnd: updatedEndTime,
                guestCount: updatedGuests
            });

            if (!selectedTables) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'Geen tafels beschikbaar voor deze wijziging' });
            }
            newTableId = selectedTables[0].id;
        }

        // Update the booking
        const result = await client.query(
            `UPDATE restaurant_bookings
             SET customer_name = $1, customer_email = $2, customer_phone = $3, remarks = $4,
                 guest_count = $5, booking_date = $6, start_time = $7, end_time = $8,
                 table_id = $9, updated_at = NOW()
             WHERE id = $10 AND restaurant_id = $11
             RETURNING *`,
            [updatedName, updatedEmail, updatedPhone, updatedRemarks, updatedGuests,
                updatedDate, updatedTime, updatedEndTime, newTableId, id, restaurantId]
        );

        await client.query('COMMIT');
        invalidatePublicCacheForRestaurant(restaurantId);

        // Get table name for response
        const tableQ = await pool.query('SELECT name FROM restaurant_tables WHERE id = $1', [newTableId]);
        const tableName = tableQ.rows[0]?.name || '';

        res.json({ success: true, booking: { ...result.rows[0], table_name: tableName } });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Edit booking error:', error);
        res.status(500).json({ error: 'Failed to update booking' });
    } finally {
        client.release();
    }
});

// Route: /api/admin/day-notes
router.get('/api/admin/day-notes', authMiddleware, async (req, res) => {
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

// Route: /api/admin/day-notes
router.post('/api/admin/day-notes', authMiddleware, async (req, res) => {
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

// Route: /api/admin/day-notes/:id
router.delete('/api/admin/day-notes/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    // P1 FIX #12: Scope delete to authenticated restaurant to prevent cross-tenant deletion
    const restaurantId = req.query.restaurantId || req.user?.restaurantId || 'demo-restaurant';

    try {
        await pool.query('DELETE FROM day_notes WHERE id = $1 AND restaurant_id = $2', [id, restaurantId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete day note error:', error);
        res.status(500).json({ error: 'Failed to delete note' });
    }
});

// Route: /api/admin/customers/search
router.get('/api/admin/customers/search', authMiddleware, async (req, res) => {
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

// Route: /api/admin/restaurant-settings
router.post('/api/admin/restaurant-settings', authMiddleware, async (req, res) => {
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
        invalidatePublicCacheForRestaurant(restaurantId);
        res.json({ success: true, message: 'Restaurant settings saved' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Save restaurant settings error:', error);
        res.status(500).json({ error: 'Failed to save restaurant settings' });
    } finally {
        client.release();
    }
});

// Route: /api/admin/newsletter/subscribers
router.get('/api/admin/newsletter/subscribers', authMiddleware, async (req, res) => {
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

// Route: /api/admin/newsletter/send
router.post('/api/admin/newsletter/send', authMiddleware, upload.single('attachment'), async (req, res) => {
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
                    // P0 FIX #2: Use HMAC token instead of trivially forgeable base64
                    const unsubLink = `${unsubBase}/api/newsletter/unsubscribe?email=${encodeURIComponent(recipient.email)}&token=${generateUnsubscribeToken(recipient.email)}`;
                    const greeting = escapeHtml(recipient.name) || 'daar';

                    const emailBody = `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f0f; color: #fff; padding: 32px; border-radius: 16px;">
                            <p style="color: #fff; font-size: 16px; margin: 0 0 20px;">Hi ${greeting},</p>
                            
                            ${inlineImageHtml}
                            
                            ${message ? `<div style="color: #ccc; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">${escapeHtml(message).replace(/\n/g, '<br>')}</div>` : ''}
                            
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

// ============================================
// TEMPORARY: Fix oversized Tapla-imported bookings
// ============================================
router.post('/api/admin/fix-oversized-bookings', authMiddleware, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const restaurantId = 'demo-restaurant';

        // Find bookings where guest_count > table seats and no group_id
        const oversized = await client.query(`
            SELECT rb.id, rb.customer_name, rb.customer_email, rb.customer_phone,
                   rb.guest_count, rb.booking_date::text, rb.table_id,
                   to_char(rb.start_time, 'HH24:MI') AS start_time,
                   to_char(rb.end_time, 'HH24:MI') AS end_time,
                   rb.status, rb.remarks, rb.customer_id,
                   rt.name AS table_name, rt.seats
            FROM restaurant_bookings rb
            LEFT JOIN restaurant_tables rt ON rt.id = rb.table_id
            WHERE rb.restaurant_id = $1
              AND rb.guest_count > COALESCE(rt.seats, 0)
              AND rb.group_id IS NULL
              AND lower(rb.status) != 'cancelled'
            ORDER BY rb.booking_date, rb.start_time
        `, [restaurantId]);

        const results = [];

        for (const booking of oversized.rows) {
            // Fetch all tables
            const allTablesQ = await client.query(
                `SELECT id, name, seats, zone FROM restaurant_tables WHERE restaurant_id = $1 AND is_active = true ORDER BY seats DESC`,
                [restaurantId]
            );
            const allTables = allTablesQ.rows;

            // Fetch existing bookings for that date (excluding current booking)
            const bookingsQ = await client.query(
                `SELECT table_id, to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time
                 FROM restaurant_bookings
                 WHERE restaurant_id = $1 AND booking_date = $2
                 AND lower(status) != 'cancelled' AND id != $3`,
                [restaurantId, booking.booking_date, booking.id]
            );
            const bookingsByTableId = buildBookingsMap(bookingsQ.rows);

            // Select tables for this booking
            const selectedTables = selectTablesForSlot({
                allTables,
                bookingsByTableId,
                slotStart: booking.start_time,
                slotEnd: booking.end_time,
                guestCount: booking.guest_count
            });

            if (!selectedTables || selectedTables.length <= 1) {
                results.push({ id: booking.id, name: booking.customer_name, guests: booking.guest_count, status: 'skipped', reason: selectedTables ? 'fits single table' : 'not enough tables' });
                continue;
            }

            // Create group_id and update original booking
            const crypto = await import('crypto');
            const groupId = crypto.randomUUID();

            // Update original booking: assign to first selected table, set group_id
            await client.query(
                `UPDATE restaurant_bookings SET table_id = $1, group_id = $2, is_primary = true WHERE id = $3`,
                [selectedTables[0].id, groupId, booking.id]
            );

            // Insert additional table bookings
            for (let i = 1; i < selectedTables.length; i++) {
                const tbl = selectedTables[i];
                const rowId = crypto.randomUUID();
                await client.query(
                    `INSERT INTO restaurant_bookings (id, restaurant_id, table_id, customer_id, customer_name, customer_email, customer_phone, guest_count, booking_date, start_time, end_time, status, remarks, group_id, is_primary, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false, NOW())`,
                    [rowId, restaurantId, tbl.id, booking.customer_id, booking.customer_name,
                        booking.customer_email, booking.customer_phone, booking.guest_count,
                        booking.booking_date, booking.start_time, booking.end_time,
                        booking.status, booking.remarks, groupId]
                );
            }

            results.push({
                id: booking.id, name: booking.customer_name, guests: booking.guest_count,
                status: 'fixed',
                tables: selectedTables.map(t => `${t.name} (${t.seats}p)`).join(' + ')
            });
        }

        await client.query('COMMIT');
        res.json({ success: true, totalOversized: oversized.rows.length, results });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Fix oversized error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

export default router;

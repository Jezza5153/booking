import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pool from './db-postgres.js';
import { loginHandler, authMiddleware } from './auth.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ============================================
// AUTH ROUTES (Public)
// ============================================
app.post('/api/auth/login', loginHandler);

// Verify token endpoint
app.get('/api/auth/verify', authMiddleware, (req, res) => {
    res.json({ valid: true, user: req.user });
});

// ============================================
// PUBLIC ROUTES (No auth required)
// ============================================

// GET /api/widget/:restaurantId - Widget data
app.get('/api/widget/:restaurantId', async (req, res) => {
    const { restaurantId } = req.params;

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

        // Get active events
        const eventsResult = await pool.query(
            'SELECT id, title FROM events WHERE restaurant_id = $1 AND is_active = true',
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
                    const formatter = new Intl.DateTimeFormat('nl-NL', {
                        weekday: 'short', day: 'numeric', month: 'short'
                    });
                    const parts = formatter.formatToParts(dt);
                    const weekday = parts.find(p => p.type === 'weekday')?.value || '';
                    const day = parts.find(p => p.type === 'day')?.value || '';
                    const month = parts.find(p => p.type === 'month')?.value?.replace('.', '') || '';
                    const hours = dt.getHours().toString().padStart(2, '0');
                    const minutes = dt.getMinutes().toString().padStart(2, '0');

                    return {
                        id: slot.id,
                        date: `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} ${day} ${month}`,
                        time: `${hours}:${minutes}`,
                        isNextAvailable: slot.is_highlighted,
                        wijkId: slot.wijkId,
                        booked2tops: slot.booked2tops,
                        booked4tops: slot.booked4tops,
                        booked6tops: slot.booked6tops
                    };
                });

                return { id: event.id, title: event.title, slots: formattedSlots };
            })
        );

        res.json({ restaurant, zones: zonesResult.rows, events: eventsWithSlots });
    } catch (error) {
        console.error('Widget data error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/book - Book a table (public)
app.post('/api/book', async (req, res) => {
    const { slot_id, table_type, guest_count } = req.body;

    if (!slot_id || !table_type || !guest_count) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get slot with zone capacity
        const slotResult = await client.query(
            `SELECT s.*, z.capacity_2_tops, z.capacity_4_tops, z.capacity_6_tops, e.restaurant_id
       FROM slots s
       JOIN zones z ON s.zone_id = z.id
       JOIN events e ON s.event_id = e.id
       WHERE s.id = $1`,
            [slot_id]
        );

        if (slotResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Slot not found' });
        }

        const slot = slotResult.rows[0];
        let canBook = false;
        let updateField = '';

        if (table_type === '2') {
            canBook = slot.booked_count_2_tops < slot.capacity_2_tops;
            updateField = 'booked_count_2_tops';
        } else if (table_type === '4') {
            canBook = slot.booked_count_4_tops < slot.capacity_4_tops;
            updateField = 'booked_count_4_tops';
        } else if (table_type === '6') {
            canBook = slot.booked_count_6_tops < slot.capacity_6_tops;
            updateField = 'booked_count_6_tops';
        } else {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid table_type' });
        }

        if (!canBook) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'No availability for this table size' });
        }

        await client.query(
            `UPDATE slots SET ${updateField} = ${updateField} + 1 WHERE id = $1`,
            [slot_id]
        );

        const restaurantResult = await client.query(
            'SELECT handoff_url_base FROM restaurants WHERE id = $1',
            [slot.restaurant_id]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            handoff_url: `${restaurantResult.rows[0].handoff_url_base}?slot=${slot_id}&guests=${guest_count}`,
            message: `Booking confirmed for ${guest_count} guests`
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Booking error:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// GET /api/calendar/:restaurantId.ics - iCal feed (public)
app.get('/api/calendar/:restaurantId.ics', async (req, res) => {
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
            icalContent.push(`SUMMARY:(${totalBooked}/${totalCapacity}) ${slot.event_title}`);
            icalContent.push(`DESCRIPTION:Zone: ${slot.zone_name}\\n2-Tops: ${slot.booked_count_2_tops}\\n4-Tops: ${slot.booked_count_4_tops}\\n6-Tops: ${slot.booked_count_6_tops}`);
            icalContent.push(`LOCATION:${restaurant.name} - ${slot.zone_name}`);
            icalContent.push('STATUS:CONFIRMED');
            icalContent.push('END:VEVENT');
        }

        icalContent.push('END:VCALENDAR');

        res.set({
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `attachment; filename="${restaurantId}-bookings.ics"`
        });
        res.send(icalContent.join('\r\n'));
    } catch (error) {
        console.error('Calendar error:', error);
        res.status(500).send('Internal server error');
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// PROTECTED ADMIN ROUTES (Auth required)
// ============================================
app.use('/api/admin', authMiddleware);

// Example: Get all events for admin
app.get('/api/admin/events', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM events ORDER BY title');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 EVENTS API server running on http://localhost:${PORT}`);
    console.log(`📅 Calendar: http://localhost:${PORT}/api/calendar/demo-restaurant.ics`);
    console.log(`🔐 Auth: POST /api/auth/login`);
});

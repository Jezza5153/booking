import express from 'express';
import cors from 'cors';
import db from './db.js';
import './seed.js'; // Run seed on startup

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ============================================
// GET /api/widget/:restaurantId
// Returns all data needed for the widget
// ============================================
app.get('/api/widget/:restaurantId', (req, res) => {
    const { restaurantId } = req.params;

    try {
        // Get restaurant
        const restaurant = db.prepare(`
      SELECT id, name, booking_email, handoff_url_base 
      FROM restaurants WHERE id = ?
    `).get(restaurantId);

        if (!restaurant) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }

        // Get zones
        const zones = db.prepare(`
      SELECT id, name, capacity_2_tops as count2tops, capacity_4_tops as count4tops, capacity_6_tops as count6tops
      FROM zones WHERE restaurant_id = ?
    `).all(restaurantId);

        // Get active events with their slots
        const events = db.prepare(`
      SELECT id, title FROM events 
      WHERE restaurant_id = ? AND is_active = 1
    `).all(restaurantId);

        // For each event, get slots and format for the frontend
        const eventsWithSlots = events.map(event => {
            const slots = db.prepare(`
        SELECT 
          id, 
          zone_id as wijkId,
          start_datetime,
          is_highlighted as isNextAvailable,
          booked_count_2_tops as booked2tops,
          booked_count_4_tops as booked4tops,
          booked_count_6_tops as booked6tops
        FROM slots WHERE event_id = ?
        ORDER BY start_datetime ASC
      `).all(event.id);

            // Format datetime to Dutch format for frontend compatibility
            const formattedSlots = slots.map(slot => {
                const dt = new Date(slot.start_datetime);
                const formatter = new Intl.DateTimeFormat('nl-NL', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short'
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
                    isNextAvailable: !!slot.isNextAvailable,
                    wijkId: slot.wijkId,
                    booked2tops: slot.booked2tops,
                    booked4tops: slot.booked4tops,
                    booked6tops: slot.booked6tops
                };
            });

            return {
                id: event.id,
                title: event.title,
                slots: formattedSlots
            };
        });

        res.json({
            restaurant,
            zones,
            events: eventsWithSlots
        });
    } catch (error) {
        console.error('Error fetching widget data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// POST /api/book
// Book a table with inventory validation
// ============================================
app.post('/api/book', (req, res) => {
    const { slot_id, table_type, guest_count } = req.body;

    if (!slot_id || !table_type || !guest_count) {
        return res.status(400).json({ error: 'Missing required fields: slot_id, table_type, guest_count' });
    }

    try {
        // Start transaction
        const transaction = db.transaction(() => {
            // Get slot with zone capacity
            const slot = db.prepare(`
        SELECT 
          s.*,
          z.capacity_2_tops, z.capacity_4_tops, z.capacity_6_tops,
          e.restaurant_id
        FROM slots s
        JOIN zones z ON s.zone_id = z.id
        JOIN events e ON s.event_id = e.id
        WHERE s.id = ?
      `).get(slot_id);

            if (!slot) {
                throw { status: 404, message: 'Slot not found' };
            }

            // Validate inventory based on table type
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
                throw { status: 400, message: 'Invalid table_type. Must be 2, 4, or 6.' };
            }

            if (!canBook) {
                throw { status: 409, message: 'No availability for this table size' };
            }

            // Update booking count
            db.prepare(`UPDATE slots SET ${updateField} = ${updateField} + 1 WHERE id = ?`).run(slot_id);

            // Get restaurant info for handoff URL
            const restaurant = db.prepare(`
        SELECT handoff_url_base, booking_email FROM restaurants WHERE id = ?
      `).get(slot.restaurant_id);

            return {
                success: true,
                handoff_url: `${restaurant.handoff_url_base}?slot=${slot_id}&guests=${guest_count}`,
                message: `Booking confirmed for ${guest_count} guests`
            };
        });

        const result = transaction();
        res.json(result);

    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        console.error('Booking error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// GET /api/calendar/:restaurantId.ics
// iCal feed for iPhone, Android, Google Calendar subscription
// ============================================
app.get('/api/calendar/:restaurantId.ics', (req, res) => {
    const { restaurantId } = req.params;
    const bookedOnly = req.query.booked_only === 'true';

    try {
        const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId);
        if (!restaurant) {
            return res.status(404).send('Restaurant not found');
        }

        // Get all slots with event and zone info
        const slots = db.prepare(`
      SELECT 
        s.*,
        e.title as event_title,
        z.name as zone_name,
        z.capacity_2_tops, z.capacity_4_tops, z.capacity_6_tops
      FROM slots s
      JOIN events e ON s.event_id = e.id
      JOIN zones z ON s.zone_id = z.id
      WHERE e.restaurant_id = ? AND e.is_active = 1
      ORDER BY s.start_datetime ASC
    `).all(restaurantId);

        // Filter to booked only if requested
        const filteredSlots = bookedOnly
            ? slots.filter(s => s.booked_count_2_tops > 0 || s.booked_count_4_tops > 0 || s.booked_count_6_tops > 0)
            : slots;

        // Build iCal content
        let icalContent = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            `PRODID:-//EVENTS//${restaurant.name}//EN`,
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            `X-WR-CALNAME:${restaurant.name} Bookings`,
            'X-WR-TIMEZONE:Europe/Amsterdam'
        ];

        for (const slot of filteredSlots) {
            const start = new Date(slot.start_datetime);
            const end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // 2 hour duration

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

// ============================================
// Health check
// ============================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🚀 EVENTS API server running on http://localhost:${PORT}`);
    console.log(`📅 Calendar subscription: http://localhost:${PORT}/api/calendar/demo-restaurant.ics`);
});

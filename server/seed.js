import db from './db.js';

// Check if already seeded
const existing = db.prepare('SELECT id FROM restaurants WHERE id = ?').get('demo-restaurant');

if (!existing) {
    console.log('🌱 Seeding demo restaurant...');

    // Insert restaurant
    db.prepare(`
    INSERT INTO restaurants (id, name, booking_email, handoff_url_base) 
    VALUES (?, ?, ?, ?)
  `).run('demo-restaurant', 'De Tafel', 'reserveren@tafelaaramersfoort.nl', 'https://booking.example.com/confirm');

    // Insert zones
    const zones = [
        { id: 'zone-main', name: 'Binnen (Main)', cap2: 5, cap4: 5, cap6: 2 },
        { id: 'zone-terras', name: 'Terras (Sunny)', cap2: 8, cap4: 2, cap6: 0 },
        { id: 'zone-serre', name: 'Serre', cap2: 2, cap4: 4, cap6: 1 },
    ];

    const insertZone = db.prepare(`
    INSERT INTO zones (id, restaurant_id, name, capacity_2_tops, capacity_4_tops, capacity_6_tops)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

    for (const z of zones) {
        insertZone.run(z.id, 'demo-restaurant', z.name, z.cap2, z.cap4, z.cap6);
    }

    // Insert events
    const events = [
        { id: 'event-maandag', title: 'Makkelijke maandag' },
        { id: 'event-wijn', title: 'Wijn en spijs' },
        { id: 'event-theater', title: 'Theaterweekend' },
    ];

    const insertEvent = db.prepare(`
    INSERT INTO events (id, restaurant_id, title, is_active)
    VALUES (?, ?, ?, ?)
  `);

    for (const e of events) {
        insertEvent.run(e.id, 'demo-restaurant', e.title, 1);
    }

    // Insert slots
    const slots = [
        // Makkelijke maandag
        { id: 'slot-m1', eventId: 'event-maandag', zoneId: 'zone-main', dt: '2026-01-20T17:00:00', hl: 1, b2: 1, b4: 0, b6: 0 },
        { id: 'slot-m2', eventId: 'event-maandag', zoneId: 'zone-main', dt: '2026-01-20T17:30:00', hl: 0, b2: 5, b4: 5, b6: 2 }, // Full
        { id: 'slot-m3', eventId: 'event-maandag', zoneId: 'zone-main', dt: '2026-01-20T18:00:00', hl: 0, b2: 4, b4: 2, b6: 0 },
        { id: 'slot-m4', eventId: 'event-maandag', zoneId: 'zone-main', dt: '2026-01-20T18:30:00', hl: 0, b2: 0, b4: 0, b6: 0 },
        { id: 'slot-m5', eventId: 'event-maandag', zoneId: 'zone-main', dt: '2026-01-20T19:00:00', hl: 0, b2: 2, b4: 4, b6: 1 },
        // Wijn en spijs
        { id: 'slot-w1', eventId: 'event-wijn', zoneId: 'zone-serre', dt: '2026-01-24T18:30:00', hl: 0, b2: 0, b4: 0, b6: 0 },
        { id: 'slot-w2', eventId: 'event-wijn', zoneId: 'zone-serre', dt: '2026-01-24T19:00:00', hl: 0, b2: 2, b4: 4, b6: 1 }, // Full
        // Theaterweekend
        { id: 'slot-t1', eventId: 'event-theater', zoneId: 'zone-main', dt: '2026-01-31T17:00:00', hl: 0, b2: 0, b4: 1, b6: 0 },
        { id: 'slot-t2', eventId: 'event-theater', zoneId: 'zone-main', dt: '2026-01-31T17:15:00', hl: 0, b2: 1, b4: 0, b6: 0 },
        { id: 'slot-t3', eventId: 'event-theater', zoneId: 'zone-main', dt: '2026-01-31T17:30:00', hl: 1, b2: 2, b4: 2, b6: 0 },
    ];

    const insertSlot = db.prepare(`
    INSERT INTO slots (id, event_id, zone_id, start_datetime, is_highlighted, booked_count_2_tops, booked_count_4_tops, booked_count_6_tops)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

    for (const s of slots) {
        insertSlot.run(s.id, s.eventId, s.zoneId, s.dt, s.hl, s.b2, s.b4, s.b6);
    }

    console.log('✅ Demo data seeded successfully!');
} else {
    console.log('ℹ️  Demo data already exists, skipping seed.');
}

#!/usr/bin/env node
// Import Tapla bookings into EVENTS restaurant_bookings table
import { readFileSync } from 'fs';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('Set DATABASE_URL env var');
    process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const bookings = JSON.parse(readFileSync(new URL('../tapla-bookings.json', import.meta.url)));
console.log(`Loaded ${bookings.length} Tapla bookings`);

const RESTAURANT_ID = 'demo-restaurant';
let imported = 0;
let skipped = 0;

for (const b of bookings) {
    // Calculate end_time from start + duration (in half-hours)
    const [h, m] = b.ReservationTime.split(':').map(Number);
    const durHours = b.Duration || 2; // default 2h
    const startMinutes = h * 60 + m;
    const endMinutes = startMinutes + Math.round(durHours * 60);
    const endH = Math.floor(endMinutes / 60) % 24;
    const endM = endMinutes % 60;
    const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
    const startTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    // Map Tapla status to EVENTS status
    let status = 'confirmed';
    if (b.Status === 'CHECKED_IN') status = 'arrived';
    else if (b.Status === 'CANCELLED') status = 'cancelled';
    else if (b.Status === 'NO_SHOW') status = 'no_show';

    // Skip future dates that don't have a status (PLANNED = upcoming)
    // Import all — both past and future bookings

    try {
        await pool.query(
            `INSERT INTO restaurant_bookings 
        (id, restaurant_id, booking_date, start_time, end_time, guest_count, 
         customer_name, customer_email, customer_phone, remarks, status, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO NOTHING`,
            [
                b.ReservationID,
                RESTAURANT_ID,
                b.ReservationDate,
                startTime,
                endTime,
                b.PartySize,
                b.CustomerName.trim(),
                b.CustomerMail || null,
                b.CustomerPhone || null,
                b.CustomerComments || null,
                status,
                'tapla-import'
            ]
        );
        imported++;
    } catch (e) {
        console.error(`Skip ${b.CustomerName} on ${b.ReservationDate}: ${e.message}`);
        skipped++;
    }
}

console.log(`\n✅ Imported: ${imported}`);
console.log(`⚠️  Skipped: ${skipped}`);
console.log(`Total: ${bookings.length}`);

await pool.end();

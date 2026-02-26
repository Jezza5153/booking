import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const bookings = (await pool.query(
    `SELECT id, guest_count, booking_date::text, start_time::text, end_time::text 
   FROM restaurant_bookings WHERE restaurant_id = 'demo-restaurant' AND table_id IS NULL 
   ORDER BY booking_date, start_time`
)).rows;
console.log('Bookings to assign:', bookings.length);

const t2 = ['tafel-10', 'tafel-11', 'tafel-12', 'tafel-14', 'tafel-15', 'tafel-16', 'tafel-17', 'schuif-2'];
const t4 = ['tafel-20', 'tafel-21', 'tafel-24', 'tafel-30', 'schuif-4'];
const t6 = ['tafel-23', 'tafel-25', 'tafel-27', 'tafel-31', 'schuif-6'];

const byDate = {};
for (const b of bookings) { (byDate[b.booking_date] ??= []).push(b); }

let assigned = 0, failed = 0;
for (const [date, dBookings] of Object.entries(byDate)) {
    const used = {};
    for (const b of dBookings) {
        let cands = b.guest_count <= 2 ? [...t2, ...t4, ...t6]
            : b.guest_count <= 4 ? [...t4, ...t6, ...t2]
                : [...t6, ...t4];
        let placed = false;
        for (const tid of cands) {
            const slots = used[tid] || [];
            if (!slots.some(s => b.start_time < s.end && b.end_time > s.start)) {
                await pool.query('UPDATE restaurant_bookings SET table_id = $1 WHERE id = $2', [tid, b.id]);
                (used[tid] ??= []).push({ start: b.start_time, end: b.end_time });
                assigned++; placed = true; break;
            }
        }
        if (!placed) failed++;
    }
}
console.log('Assigned:', assigned, 'Failed:', failed);
await pool.end();

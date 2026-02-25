import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  try {
    const res = await pool.query("SELECT id, title, is_active FROM events WHERE title ILIKE '%Makkelijk%'");
    console.log("EVENTS:", res.rows);

    if (res.rows.length > 0) {
      const slots = await pool.query("SELECT id, start_datetime FROM slots WHERE event_id = $1", [res.rows[0].id]);
      console.log("SLOTS:", slots.rows);
    }
  } catch (e) { console.error(e); } finally {
    pool.end();
  }
}
check();

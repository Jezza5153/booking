import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'events.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS restaurants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    booking_email TEXT,
    handoff_url_base TEXT
  );

  CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    capacity_2_tops INTEGER DEFAULT 0,
    capacity_4_tops INTEGER DEFAULT 0,
    capacity_6_tops INTEGER DEFAULT 0,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL,
    title TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
  );

  CREATE TABLE IF NOT EXISTS slots (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    zone_id TEXT NOT NULL,
    start_datetime TEXT NOT NULL,
    is_highlighted INTEGER DEFAULT 0,
    booked_count_2_tops INTEGER DEFAULT 0,
    booked_count_4_tops INTEGER DEFAULT 0,
    booked_count_6_tops INTEGER DEFAULT 0,
    FOREIGN KEY (event_id) REFERENCES events(id),
    FOREIGN KEY (zone_id) REFERENCES zones(id)
  );

  CREATE INDEX IF NOT EXISTS idx_zones_restaurant ON zones(restaurant_id);
  CREATE INDEX IF NOT EXISTS idx_events_restaurant ON events(restaurant_id);
  CREATE INDEX IF NOT EXISTS idx_slots_event ON slots(event_id);
  CREATE INDEX IF NOT EXISTS idx_slots_zone ON slots(zone_id);
`);

export default db;

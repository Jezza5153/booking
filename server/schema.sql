-- EVENTS Database Schema for Neon PostgreSQL
-- Run this in your Neon SQL Editor

-- 1. Restaurants Table
CREATE TABLE IF NOT EXISTS restaurants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  booking_email TEXT,
  handoff_url_base TEXT
);

-- 2. Zones Table
CREATE TABLE IF NOT EXISTS zones (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL,
  capacity_2_tops INTEGER DEFAULT 0,
  capacity_4_tops INTEGER DEFAULT 0,
  capacity_6_tops INTEGER DEFAULT 0
);

-- 3. Events Table
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  title TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true
);

-- 4. Slots Table
CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  zone_id TEXT NOT NULL REFERENCES zones(id),
  start_datetime TIMESTAMP NOT NULL,
  is_highlighted BOOLEAN DEFAULT false,
  booked_count_2_tops INTEGER DEFAULT 0,
  booked_count_4_tops INTEGER DEFAULT 0,
  booked_count_6_tops INTEGER DEFAULT 0
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_zones_restaurant ON zones(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_events_restaurant ON events(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_slots_event ON slots(event_id);
CREATE INDEX IF NOT EXISTS idx_slots_zone ON slots(zone_id);

-- =============================================
-- SEED DATA: Demo Restaurant
-- =============================================

-- Insert restaurant
INSERT INTO restaurants (id, name, booking_email, handoff_url_base) 
VALUES ('demo-restaurant', 'De Tafel', 'reserveren@tafelaaramersfoort.nl', 'https://booking.example.com/confirm')
ON CONFLICT (id) DO NOTHING;

-- Insert zones
INSERT INTO zones (id, restaurant_id, name, capacity_2_tops, capacity_4_tops, capacity_6_tops) VALUES
  ('zone-main', 'demo-restaurant', 'Binnen (Main)', 5, 5, 2),
  ('zone-terras', 'demo-restaurant', 'Terras (Sunny)', 8, 2, 0),
  ('zone-serre', 'demo-restaurant', 'Serre', 2, 4, 1)
ON CONFLICT (id) DO NOTHING;

-- Insert events
INSERT INTO events (id, restaurant_id, title, is_active) VALUES
  ('event-maandag', 'demo-restaurant', 'Makkelijke maandag', true),
  ('event-wijn', 'demo-restaurant', 'Wijn en spijs', true),
  ('event-theater', 'demo-restaurant', 'Theaterweekend', true)
ON CONFLICT (id) DO NOTHING;

-- Insert slots
INSERT INTO slots (id, event_id, zone_id, start_datetime, is_highlighted, booked_count_2_tops, booked_count_4_tops, booked_count_6_tops) VALUES
  -- Makkelijke maandag
  ('slot-m1', 'event-maandag', 'zone-main', '2026-01-20 17:00:00', true, 1, 0, 0),
  ('slot-m2', 'event-maandag', 'zone-main', '2026-01-20 17:30:00', false, 5, 5, 2),
  ('slot-m3', 'event-maandag', 'zone-main', '2026-01-20 18:00:00', false, 4, 2, 0),
  ('slot-m4', 'event-maandag', 'zone-main', '2026-01-20 18:30:00', false, 0, 0, 0),
  ('slot-m5', 'event-maandag', 'zone-main', '2026-01-20 19:00:00', false, 2, 4, 1),
  -- Wijn en spijs
  ('slot-w1', 'event-wijn', 'zone-serre', '2026-01-24 18:30:00', false, 0, 0, 0),
  ('slot-w2', 'event-wijn', 'zone-serre', '2026-01-24 19:00:00', false, 2, 4, 1),
  -- Theaterweekend
  ('slot-t1', 'event-theater', 'zone-main', '2026-01-31 17:00:00', false, 0, 1, 0),
  ('slot-t2', 'event-theater', 'zone-main', '2026-01-31 17:15:00', false, 1, 0, 0),
  ('slot-t3', 'event-theater', 'zone-main', '2026-01-31 17:30:00', true, 2, 2, 0)
ON CONFLICT (id) DO NOTHING;

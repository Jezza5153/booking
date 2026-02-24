-- EVENTS Seed Data (separated from schema.sql per audit fix #27)
-- This file should NOT be run in production — use only for local dev/staging

-- Insert demo restaurant
INSERT INTO restaurants (id, name, booking_email, handoff_url_base) 
VALUES ('demo-restaurant', 'De Tafel', 'reserveren@tafelaaramersfoort.nl', 'https://booking.example.com/confirm')
ON CONFLICT (id) DO NOTHING;

-- Insert demo zones
INSERT INTO zones (id, restaurant_id, name, capacity_2_tops, capacity_4_tops, capacity_6_tops) VALUES
  ('zone-main', 'demo-restaurant', 'Binnen (Main)', 5, 5, 2),
  ('zone-terras', 'demo-restaurant', 'Terras (Sunny)', 8, 2, 0),
  ('zone-serre', 'demo-restaurant', 'Serre', 2, 4, 1)
ON CONFLICT (id) DO NOTHING;

-- Insert demo events
INSERT INTO events (id, restaurant_id, title, is_active) VALUES
  ('event-maandag', 'demo-restaurant', 'Makkelijke maandag', true),
  ('event-wijn', 'demo-restaurant', 'Wijn en spijs', true),
  ('event-theater', 'demo-restaurant', 'Theaterweekend', true)
ON CONFLICT (id) DO NOTHING;

-- Insert demo slots (using TIMESTAMPTZ with explicit timezone)
INSERT INTO slots (id, event_id, zone_id, start_datetime, is_highlighted, booked_count_2_tops, booked_count_4_tops, booked_count_6_tops) VALUES
  ('slot-m1', 'event-maandag', 'zone-main', '2026-01-20 17:00:00+01', true, 0, 0, 0),
  ('slot-m2', 'event-maandag', 'zone-main', '2026-01-20 17:30:00+01', false, 0, 0, 0),
  ('slot-m3', 'event-maandag', 'zone-main', '2026-01-20 18:00:00+01', false, 0, 0, 0),
  ('slot-w1', 'event-wijn', 'zone-serre', '2026-01-24 18:30:00+01', false, 0, 0, 0),
  ('slot-w2', 'event-wijn', 'zone-serre', '2026-01-24 19:00:00+01', false, 0, 0, 0),
  ('slot-t1', 'event-theater', 'zone-main', '2026-01-31 17:00:00+01', false, 0, 0, 0),
  ('slot-t2', 'event-theater', 'zone-main', '2026-01-31 17:15:00+01', false, 0, 0, 0),
  ('slot-t3', 'event-theater', 'zone-main', '2026-01-31 17:30:00+01', true, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;

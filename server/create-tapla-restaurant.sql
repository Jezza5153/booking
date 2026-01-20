-- =============================================
-- NEW RESTAURANT: Tapla
-- Run this in Neon Console SQL Editor
-- =============================================

-- 1. Create the restaurant
INSERT INTO restaurants (id, name, booking_email, handoff_url_base) 
VALUES ('tapla', 'Tapla Restaurant', 'reserveren@tapla.nl', NULL)
ON CONFLICT (id) DO NOTHING;

-- 2. Create default zones for Tapla
INSERT INTO zones (id, restaurant_id, name, capacity_2_tops, capacity_4_tops, capacity_6_tops) VALUES
  ('tapla-zone-main', 'tapla', 'Main Floor', 6, 6, 3),
  ('tapla-zone-terras', 'tapla', 'Terrace', 4, 4, 2)
ON CONFLICT (id) DO NOTHING;

-- 3. Create a sample event to get started
INSERT INTO events (id, restaurant_id, title, description, price_per_person, is_active) VALUES
  ('tapla-event-1', 'tapla', 'Welcome Event', 'Try our new menu!', 29.50, true)
ON CONFLICT (id) DO NOTHING;

-- 4. Create a sample slot for the event (tomorrow at 18:00 Amsterdam time)
INSERT INTO slots (id, event_id, zone_id, start_datetime, is_highlighted) VALUES
  ('tapla-slot-1', 'tapla-event-1', 'tapla-zone-main', 
   (CURRENT_DATE + INTERVAL '1 day' + TIME '18:00:00') AT TIME ZONE 'Europe/Amsterdam', 
   true)
ON CONFLICT (id) DO NOTHING;

-- Verify it worked
SELECT 'Restaurant created:' as status, id, name FROM restaurants WHERE id = 'tapla';
SELECT 'Zones created:' as status, COUNT(*) as count FROM zones WHERE restaurant_id = 'tapla';
SELECT 'Events created:' as status, COUNT(*) as count FROM events WHERE restaurant_id = 'tapla';

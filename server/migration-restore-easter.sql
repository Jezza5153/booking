-- Migration: Restore Easter Sunday (Pasen Zondag) event
-- Date: 2026-04-05 (Easter Sunday / Eerste Paasdag)
-- Slots: 10:30 and 13:30 (as confirmed by email confirmations)

-- Insert Easter event
INSERT INTO events (id, restaurant_id, title, description, is_active)
VALUES ('event-pasen-zondag', 'demo-restaurant', 'Pasen Zondag', 'Eerste Paasdag brunch & lunch', true)
ON CONFLICT (id) DO NOTHING;

-- Insert slots for 10:30 and 13:30 (CET = +02 for April, CEST)
-- Using zone-main as default zone; adjust if needed
INSERT INTO slots (id, event_id, zone_id, start_datetime, is_highlighted, booked_count_2_tops, booked_count_4_tops, booked_count_6_tops)
VALUES
  ('slot-pasen-1030', 'event-pasen-zondag', 'zone-main', '2026-04-05 10:30:00+02', true, 0, 0, 0),
  ('slot-pasen-1330', 'event-pasen-zondag', 'zone-main', '2026-04-05 13:30:00+02', false, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;

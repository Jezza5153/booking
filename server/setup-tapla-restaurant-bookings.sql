-- =============================================
-- COMPLETE RESTAURANT SETUP: De Tafelaar
-- Run this in Neon Console SQL Editor
-- =============================================

-- 1. Restaurant opening hours (REQUIRED for availability)
-- De Tafelaar opens at 17:00, closes at 23:00
DELETE FROM restaurant_openings WHERE restaurant_id = 'tapla';
INSERT INTO restaurant_openings (restaurant_id, day_of_week, open_time, close_time, slot_duration_minutes)
VALUES 
  ('tapla', 0, '17:00', '22:00', 90),  -- Sunday (earlier close)
  ('tapla', 1, '17:00', '22:00', 90),  -- Monday
  ('tapla', 2, '17:00', '22:00', 90),  -- Tuesday
  ('tapla', 3, '17:00', '22:00', 90),  -- Wednesday
  ('tapla', 4, '17:00', '23:00', 90),  -- Thursday
  ('tapla', 5, '17:00', '23:00', 90),  -- Friday
  ('tapla', 6, '17:00', '23:00', 90);  -- Saturday

-- 2. Restaurant tables (REQUIRED for reservations)
DELETE FROM restaurant_tables WHERE restaurant_id = 'tapla';
INSERT INTO restaurant_tables (id, restaurant_id, name, seats, zone, is_active)
VALUES
  -- Binnen (inside) tables
  ('tapla-t1', 'tapla', 'Tafel 1', 2, 'Binnen', true),
  ('tapla-t2', 'tapla', 'Tafel 2', 2, 'Binnen', true),
  ('tapla-t3', 'tapla', 'Tafel 3', 4, 'Binnen', true),
  ('tapla-t4', 'tapla', 'Tafel 4', 4, 'Binnen', true),
  ('tapla-t5', 'tapla', 'Tafel 5', 6, 'Binnen', true),
  ('tapla-t6', 'tapla', 'Tafel 6', 6, 'Binnen', true),
  -- Chef's table for larger groups
  ('tapla-chef', 'tapla', 'Chef''s Table', 12, 'Binnen', true),
  -- Terrace tables (optional)
  ('tapla-terras-1', 'tapla', 'Terras 1', 4, 'Terras', true),
  ('tapla-terras-2', 'tapla', 'Terras 2', 4, 'Terras', true);

-- 3. Verify data was inserted
SELECT 'Opening hours:' as check, COUNT(*) as count FROM restaurant_openings WHERE restaurant_id = 'tapla';
SELECT 'Tables:' as check, COUNT(*) as count FROM restaurant_tables WHERE restaurant_id = 'tapla';

-- 4. Show the opening hours
SELECT day_of_week, open_time, close_time FROM restaurant_openings WHERE restaurant_id = 'tapla' ORDER BY day_of_week;

-- 5. Show the tables
SELECT name, seats, zone FROM restaurant_tables WHERE restaurant_id = 'tapla' ORDER BY seats;

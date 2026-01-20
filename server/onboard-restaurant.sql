-- =============================================
-- ONBOARD NEW RESTAURANT TEMPLATE
-- =============================================
-- Instructions:
-- 1. Replace all instances of 'test-resto' with a unique restaurant ID (lowercase, no spaces, use hyphens)
-- 2. Replace 'Test Restaurant' with the actual restaurant name
-- 3. Replace 'email@test-resto.nl' with their email
-- 4. Adjust zone capacities as needed
-- 5. Run this SQL in the Neon Console SQL Editor
-- =============================================

-- =============================================
-- STEP 1: Create the Restaurant
-- =============================================
INSERT INTO restaurants (id, name, booking_email, handoff_url_base) 
VALUES ('test-resto', 'Test Restaurant', 'email@test-resto.nl', NULL)
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  booking_email = EXCLUDED.booking_email;

-- =============================================
-- STEP 2: Create Zones (seating areas)
-- =============================================
-- Adjust capacities: capacity_X_tops = how many X-person tables available per slot
INSERT INTO zones (id, restaurant_id, name, capacity_2_tops, capacity_4_tops, capacity_6_tops) VALUES
  ('test-resto-main', 'test-resto', 'Main Floor', 5, 5, 2),
  ('test-resto-terras', 'test-resto', 'Terrace', 4, 3, 1)
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  capacity_2_tops = EXCLUDED.capacity_2_tops,
  capacity_4_tops = EXCLUDED.capacity_4_tops,
  capacity_6_tops = EXCLUDED.capacity_6_tops;

-- =============================================
-- STEP 3: Create a Sample Event
-- =============================================
INSERT INTO events (id, restaurant_id, title, description, price_per_person, is_active) VALUES
  ('test-resto-event-1', 'test-resto', 'Diner', 'Regulier diner', NULL, true)
ON CONFLICT (id) DO UPDATE SET 
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active;

-- =============================================
-- STEP 4: Create Sample Time Slots
-- =============================================
-- These are for the next few days at common dinner times
-- The restaurant can add more via the Admin Dashboard later
INSERT INTO slots (id, event_id, zone_id, start_datetime, is_highlighted) VALUES
  -- Tomorrow 17:00
  ('test-resto-slot-1', 'test-resto-event-1', 'test-resto-main', 
   (CURRENT_DATE + INTERVAL '1 day' + TIME '17:00:00') AT TIME ZONE 'Europe/Amsterdam', true),
  -- Tomorrow 17:30
  ('test-resto-slot-2', 'test-resto-event-1', 'test-resto-main', 
   (CURRENT_DATE + INTERVAL '1 day' + TIME '17:30:00') AT TIME ZONE 'Europe/Amsterdam', false),
  -- Tomorrow 18:00
  ('test-resto-slot-3', 'test-resto-event-1', 'test-resto-main', 
   (CURRENT_DATE + INTERVAL '1 day' + TIME '18:00:00') AT TIME ZONE 'Europe/Amsterdam', false),
  -- Tomorrow 18:30
  ('test-resto-slot-4', 'test-resto-event-1', 'test-resto-main', 
   (CURRENT_DATE + INTERVAL '1 day' + TIME '18:30:00') AT TIME ZONE 'Europe/Amsterdam', false),
  -- Day after tomorrow 17:00
  ('test-resto-slot-5', 'test-resto-event-1', 'test-resto-main', 
   (CURRENT_DATE + INTERVAL '2 days' + TIME '17:00:00') AT TIME ZONE 'Europe/Amsterdam', false),
  -- Day after tomorrow 18:00
  ('test-resto-slot-6', 'test-resto-event-1', 'test-resto-main', 
   (CURRENT_DATE + INTERVAL '2 days' + TIME '18:00:00') AT TIME ZONE 'Europe/Amsterdam', false)
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- STEP 5: Create Admin User for this Restaurant
-- =============================================
-- IMPORTANT: Generate a secure password hash with:
--   npx bcrypt-cli hash "YourSecurePassword123"
-- Then replace the hash below

-- Default password for testing: "testresto123"
-- Hash: $2a$10$rZJxVYu7fV5DmK9Q7EW6ZeQM1Q6bLdFJZK8q1sLXlC7xq3pM3qwFe
INSERT INTO admin_users (id, restaurant_id, username, password_hash, email) VALUES
  ('admin-test-resto', 'test-resto', 'admin', '$2a$10$rZJxVYu7fV5DmK9Q7EW6ZeQM1Q6bLdFJZK8q1sLXlC7xq3pM3qwFe', 'admin@test-resto.nl')
ON CONFLICT (restaurant_id, username) DO UPDATE SET 
  password_hash = EXCLUDED.password_hash,
  email = EXCLUDED.email;

-- =============================================
-- VERIFICATION: Check everything was created
-- =============================================
SELECT '✅ Restaurant:' as check, id, name FROM restaurants WHERE id = 'test-resto';
SELECT '✅ Zones:' as check, COUNT(*) as count FROM zones WHERE restaurant_id = 'test-resto';
SELECT '✅ Events:' as check, COUNT(*) as count FROM events WHERE restaurant_id = 'test-resto';
SELECT '✅ Slots:' as check, COUNT(*) as count FROM slots WHERE event_id LIKE 'test-resto%';
SELECT '✅ Admin User:' as check, username, email FROM admin_users WHERE restaurant_id = 'test-resto';

-- =============================================
-- DONE! Access URLs:
-- =============================================
-- Widget: https://booking-widget-frontendbooking.vercel.app/?restaurantId=test-resto
-- Admin:  (use restaurantId=test-resto in admin panel)
-- =============================================

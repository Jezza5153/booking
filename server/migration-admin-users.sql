-- =============================================
-- MULTI-TENANT USER AUTHENTICATION
-- Each restaurant has its own admin users
-- =============================================

-- 1. Admin Users Table (restaurant-scoped)
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL, -- bcrypt hash
  email TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ,
  
  -- Each username unique per restaurant
  CONSTRAINT unique_restaurant_username UNIQUE (restaurant_id, username)
);

-- Index for login lookups
CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);
CREATE INDEX IF NOT EXISTS idx_admin_users_restaurant ON admin_users(restaurant_id);

-- =============================================
-- SEED: Demo restaurant admin user
-- Password: "demo123" (bcrypt hash)
-- =============================================
-- Generate new password hash with: npx bcrypt-cli hash "yourpassword"
INSERT INTO admin_users (id, restaurant_id, username, password_hash, email) VALUES
  ('admin-demo', 'demo-restaurant', 'admin', '$2a$10$xQONVBqpv5vJxKY9hyK7DOK9n9TmvjNzXepZEBdIy/RAy3qWwZnVK', 'admin@detafel.nl')
ON CONFLICT (restaurant_id, username) DO NOTHING;

-- =============================================
-- VERIFY
-- =============================================
SELECT 'Admin users table ready' as status;
SELECT id, restaurant_id, username, is_active FROM admin_users;

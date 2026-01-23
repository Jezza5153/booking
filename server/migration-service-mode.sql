-- =====================================================
-- SERVICE MODE MIGRATION
-- Adds: Customer profiles, booking status, day notes
-- =====================================================

-- 1. Customer Profiles Table
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    restaurant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    tags TEXT[] DEFAULT '{}',
    notes TEXT,
    dietary_notes TEXT,
    total_visits INTEGER DEFAULT 0,
    last_visit DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_customers_restaurant ON customers(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- 2. Add customer_id to restaurant_bookings
ALTER TABLE restaurant_bookings 
ADD COLUMN IF NOT EXISTS customer_id TEXT REFERENCES customers(id);

-- 3. Add booking status tracking
ALTER TABLE restaurant_bookings 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'confirmed';

ALTER TABLE restaurant_bookings 
ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;

ALTER TABLE restaurant_bookings 
ADD COLUMN IF NOT EXISTS tables_linked TEXT[] DEFAULT '{}';

ALTER TABLE restaurant_bookings 
ADD COLUMN IF NOT EXISTS is_walkin BOOLEAN DEFAULT FALSE;

ALTER TABLE restaurant_bookings 
ADD COLUMN IF NOT EXISTS dietary_notes TEXT;

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_status ON restaurant_bookings(status);

-- 4. Day Notes Table
CREATE TABLE IF NOT EXISTS day_notes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    restaurant_id TEXT NOT NULL,
    date DATE NOT NULL,
    note TEXT NOT NULL,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_day_notes_restaurant_date ON day_notes(restaurant_id, date);

-- 5. Waitlist Table
CREATE TABLE IF NOT EXISTS waitlist (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    restaurant_id TEXT NOT NULL,
    date DATE NOT NULL,
    time_preference TEXT, -- 'early', 'mid', 'late', specific time
    guest_count INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    notes TEXT,
    status TEXT DEFAULT 'waiting', -- waiting, contacted, booked, expired
    position INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_restaurant_date ON waitlist(restaurant_id, date);

-- 6. Special Dates (holidays, closures, special hours)
CREATE TABLE IF NOT EXISTS special_dates (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    restaurant_id TEXT NOT NULL,
    date DATE NOT NULL,
    type TEXT NOT NULL, -- 'closed', 'special_hours', 'holiday'
    name TEXT, -- 'Christmas', 'Private Party'
    open_time TIME,
    close_time TIME,
    max_capacity INTEGER,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_special_dates_restaurant ON special_dates(restaurant_id, date);

-- 7. Table preferences/zones
ALTER TABLE restaurant_tables
ADD COLUMN IF NOT EXISTS preferences TEXT[] DEFAULT '{}'; -- ['window', 'quiet', 'romantic']

ALTER TABLE restaurant_tables
ADD COLUMN IF NOT EXISTS can_combine BOOLEAN DEFAULT TRUE;

ALTER TABLE restaurant_tables
ADD COLUMN IF NOT EXISTS min_spend DECIMAL(10,2);

-- 8. Restaurant settings table for slot duration, max party, buffer
CREATE TABLE IF NOT EXISTS restaurant_settings (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    restaurant_id TEXT NOT NULL UNIQUE,
    slot_duration INTEGER DEFAULT 90, -- minutes
    max_party_size INTEGER DEFAULT 8,
    buffer_time INTEGER DEFAULT 15, -- minutes between bookings
    auto_confirm BOOLEAN DEFAULT TRUE,
    require_phone BOOLEAN DEFAULT FALSE,
    require_email BOOLEAN DEFAULT TRUE,
    confirmation_message TEXT,
    reminder_hours INTEGER DEFAULT 2,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- UPDATE TRIGGERS
-- =====================================================

-- Function to update customer visit count
CREATE OR REPLACE FUNCTION update_customer_visits()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.customer_id IS NOT NULL AND NEW.status = 'arrived' AND OLD.status != 'arrived' THEN
        UPDATE customers 
        SET total_visits = total_visits + 1,
            last_visit = CURRENT_DATE,
            updated_at = NOW()
        WHERE id = NEW.customer_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger
DROP TRIGGER IF EXISTS trg_update_customer_visits ON restaurant_bookings;
CREATE TRIGGER trg_update_customer_visits
AFTER UPDATE ON restaurant_bookings
FOR EACH ROW
EXECUTE FUNCTION update_customer_visits();

-- =====================================================
-- END MIGRATION
-- =====================================================

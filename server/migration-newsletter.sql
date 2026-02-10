-- Newsletter opt-in column for customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS newsletter_opt_in BOOLEAN DEFAULT FALSE;

-- Newsletter opt-in on restaurant_bookings for historical tracking
ALTER TABLE restaurant_bookings ADD COLUMN IF NOT EXISTS newsletter_opt_in BOOLEAN DEFAULT FALSE;

-- Index for newsletter subscribers
CREATE INDEX IF NOT EXISTS idx_customers_newsletter ON customers(restaurant_id, newsletter_opt_in) WHERE newsletter_opt_in = TRUE;

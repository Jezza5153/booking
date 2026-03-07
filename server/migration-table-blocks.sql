-- =====================================================
-- TABLE BLOCKS MIGRATION
-- Per-table, per-date blocking for capacity management
-- =====================================================

CREATE TABLE IF NOT EXISTS table_blocks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  restaurant_id TEXT NOT NULL,
  table_id TEXT NOT NULL REFERENCES restaurant_tables(id),
  block_date DATE NOT NULL,
  start_time TIME,        -- NULL = entire day blocked
  end_time TIME,          -- NULL = entire day blocked
  reason TEXT,             -- 'kitchen full', 'private event', etc.
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(table_id, block_date, COALESCE(start_time, '00:00:00'))
);

CREATE INDEX IF NOT EXISTS idx_table_blocks_restaurant_date ON table_blocks(restaurant_id, block_date);
CREATE INDEX IF NOT EXISTS idx_table_blocks_table ON table_blocks(table_id, block_date);

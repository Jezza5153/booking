-- Performance migration: speed up public widget/events/calendar/opening-hours queries

-- Events lookup for public routes:
-- WHERE restaurant_id = ? AND is_active = true ORDER BY title
CREATE INDEX IF NOT EXISTS idx_events_restaurant_active_title
  ON events(restaurant_id, title)
  WHERE is_active = true;

-- Slot lookups used by widget + calendar routes:
-- JOIN slots ON event_id and ORDER BY start_datetime
CREATE INDEX IF NOT EXISTS idx_slots_event_start_datetime
  ON slots(event_id, start_datetime);

-- Helps range filters such as start_datetime >= NOW() - interval ...
CREATE INDEX IF NOT EXISTS idx_slots_start_datetime_event
  ON slots(start_datetime, event_id);

DO $$
BEGIN
  IF to_regclass('public.restaurant_openings') IS NOT NULL THEN
    -- Opening-hours lookups by restaurant + specific_date/day_of_week
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_restaurant_openings_lookup
             ON restaurant_openings(restaurant_id, specific_date, day_of_week)';
  END IF;

  IF to_regclass('public.restaurant_bookings') IS NOT NULL THEN
    -- Availability checks skip cancelled rows and filter by restaurant/date/table/time overlap
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_active_lookup
             ON restaurant_bookings(restaurant_id, booking_date, table_id, start_time, end_time)
             WHERE lower(status) <> ''cancelled''';
  END IF;
END $$;

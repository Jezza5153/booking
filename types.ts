// Types matching the persisted database schema
// These types represent what is STORED, not what is DISPLAYED

export interface Wijk {
  id: string;
  name: string;
  // Table Inventory (maps to DB capacity_X_tops columns)
  count2tops: number;
  count4tops: number;
  count6tops: number;
  // Maximum covers/seats per slot (optional - calculated from tables if not set)
  maxCouverts?: number;
}

export interface Slot {
  id: string;
  // PERSISTENCE: ISO 8601 date string (YYYY-MM-DD) - NOT display format
  // The display format "Ma 12 okt" is derived in UI, not stored
  date: string;
  time: string; // HH:MM format, e.g., "19:00"
  isNextAvailable?: boolean;
  wijkId?: string; // Links to a Wijk/Zone

  // Current Booking State (from DB booked_count_X_tops)
  booked2tops: number;
  booked4tops: number;
  booked6tops: number;
}

export interface EventData {
  id: string;
  title: string;
  description?: string; // Short subtext under title
  price_per_person?: number; // Price in euros, e.g. 35.00
  slots: Slot[];
}

// Type for what the backend actually stores (start_datetime as full ISO)
export interface SlotPersisted {
  id: string;
  event_id: string;
  zone_id: string;
  start_datetime: string; // Full ISO 8601: "2026-01-20T18:00:00.000Z"
  is_highlighted: boolean;
  booked_count_2_tops: number;
  booked_count_4_tops: number;
  booked_count_6_tops: number;
}

// Admin booking row (from /api/admin/bookings)
export interface BookingRow {
  id: string;
  created_at: string;
  status: 'confirmed' | 'cancelled';
  customer_name: string;
  customer_email?: string;
  customer_phone?: string;
  remarks?: string;
  guest_count: number;
  table_type: '2' | '4' | '6' | '7+';
  slot_id: string;
  start_datetime: string;
  event_title: string;
  zone_name: string;
}
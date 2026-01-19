export interface Wijk {
  id: string;
  name: string;
  // Table Inventory
  count2tops: number; // Max 2 people
  count4tops: number; // 3-4 people
  count6tops: number; // 5-6 people
}

export interface Slot {
  id: string;
  date: string; // e.g., "Ma 12 okt"
  time: string; // e.g., "19:00"
  isNextAvailable?: boolean;
  wijkId?: string; // Links to a Wijk
  
  // Current Booking State
  booked2tops: number;
  booked4tops: number;
  booked6tops: number;
}

export interface EventData {
  id: string;
  title: string;
  slots: Slot[];
}
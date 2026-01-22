// API Configuration
// Use environment variable if available, otherwise fallback to production API
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://booking-production-de35.up.railway.app';
export const RESTAURANT_ID = 'demo-restaurant';

// Fetch widget data
export async function fetchWidgetData(restaurantId: string) {
    const response = await fetch(`${API_BASE_URL}/api/widget/${restaurantId}`);
    if (!response.ok) {
        throw new Error('Failed to fetch widget data');
    }
    return response.json();
}

// Book a table
export interface BookingRequest {
    slot_id: string;
    table_type?: '2' | '4' | '6';  // Optional for 7+ groups
    guest_count: number;
    customer_name: string;      // Required - customer's name
    customer_email?: string;    // Optional - for booking confirmation email
    customer_phone?: string;    // Optional - contact phone
    remarks?: string;           // Optional - special requests/opmerkingen
    idempotency_key?: string;   // Auto-generated to prevent duplicate submissions
}

export interface BookingResponse {
    success: boolean;
    booking_id: string;
    start_datetime: string;
    event_title: string;
    zone_name: string;
    customer_name: string;
    guest_count: number;
    table_type: string | null;
    is_large_group?: boolean;
    message: string;
}

export async function bookTable(booking: BookingRequest): Promise<BookingResponse> {
    // Generate idempotency key if not provided (prevents double submissions)
    const idempotencyKey = booking.idempotency_key || crypto.randomUUID();

    const response = await fetch(`${API_BASE_URL}/api/book`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            ...booking,
            idempotency_key: idempotencyKey
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Booking failed');
    }

    return response.json();
}

// Get calendar URL for subscription
export function getCalendarUrl(restaurantId: string, bookedOnly: boolean = false) {
    const url = `${API_BASE_URL}/api/calendar/${restaurantId}.ics`;
    return bookedOnly ? `${url}?booked_only=true` : url;
}

// P0-3: Fetch admin data with raw ISO dates for editing
export async function fetchAdminData(restaurantId: string) {
    const token = localStorage.getItem('events_token');
    const response = await fetch(
        `${API_BASE_URL}/api/admin/data?restaurantId=${restaurantId}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!response.ok) {
        throw new Error('Failed to fetch admin data');
    }
    return response.json();
}

// Save admin data (zones and events)
export interface SaveAdminDataRequest {
    restaurantId: string;
    zones: any[];
    events: any[];
    force?: boolean; // Bypass safety rails for intentional deletions
}

export async function saveAdminData(data: SaveAdminDataRequest): Promise<{ success: boolean; message: string }> {
    const token = localStorage.getItem('events_token');
    const response = await fetch(`${API_BASE_URL}/api/admin/save`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            ...data,
            force: true // Always allow intentional admin changes
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Save failed');
    }

    return response.json();
}

// Fetch bookings with optional filters
export interface BookingsFilter {
    restaurantId?: string;
    from?: string;  // ISO date
    to?: string;    // ISO date
    status?: 'confirmed' | 'cancelled' | null;
    q?: string;     // search term
    limit?: number;
    offset?: number;
}

export async function fetchBookings(filters: BookingsFilter = {}) {
    const token = localStorage.getItem('events_token');
    if (!token) throw new Error('Niet ingelogd. Log opnieuw in.');

    const params = new URLSearchParams();

    params.set('restaurantId', filters.restaurantId || RESTAURANT_ID);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.status) params.set('status', filters.status);
    if (filters.q) params.set('q', filters.q);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));

    const response = await fetch(
        `${API_BASE_URL}/api/admin/bookings?${params.toString()}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Kon boekingen niet ophalen.');
    }
    return response.json();
}

// Cancel a booking
export async function cancelBooking(bookingId: string): Promise<{ success: boolean; message: string }> {
    const token = localStorage.getItem('events_token');
    const response = await fetch(`${API_BASE_URL}/api/admin/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to cancel booking');
    }
    return response.json();
}

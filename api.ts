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
    table_type: '2' | '4' | '6';
    guest_count: number;
}

export interface BookingResponse {
    success: boolean;
    handoff_url: string;
    message: string;
}

export async function bookTable(booking: BookingRequest): Promise<BookingResponse> {
    const response = await fetch(`${API_BASE_URL}/api/book`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(booking),
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

// Save admin data (zones and events)
export interface SaveAdminDataRequest {
    restaurantId: string;
    zones: any[];
    events: any[];
}

export async function saveAdminData(data: SaveAdminDataRequest): Promise<{ success: boolean; message: string }> {
    const token = localStorage.getItem('events_token');
    const response = await fetch(`${API_BASE_URL}/api/admin/save`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Save failed');
    }

    return response.json();
}

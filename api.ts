import { EventData, Wijk } from './types';

// API Configuration
// Prefer same-origin API in production so the widget avoids CORS and can use /api rewrites.
const REMOTE_PROD_API = 'https://booking-production-de35.up.railway.app';
const runtimeOrigin = typeof window !== 'undefined' ? window.location.origin : '';
const explicitApiBase = import.meta.env.VITE_API_URL;
const forceRemoteApi = import.meta.env.VITE_FORCE_REMOTE_API === 'true';
const isLocalRuntimeOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(runtimeOrigin);
const useSameOriginApi = !import.meta.env.DEV && Boolean(runtimeOrigin) && !forceRemoteApi && !isLocalRuntimeOrigin;
export const API_BASE_URL = useSameOriginApi
    ? runtimeOrigin
    : (explicitApiBase || REMOTE_PROD_API);
export const RESTAURANT_ID = import.meta.env.VITE_RESTAURANT_ID || 'demo-restaurant';

// Fetch opening hours for widget display
export interface OpeningHour {
    dayOfWeek: number
    open: string
    close: string
    isOpen: boolean
}

export interface WidgetDataResponse {
    restaurant?: {
        id: string
        name: string
        booking_email?: string | null
        handoff_url_base?: string | null
    }
    zones: Wijk[]
    events: EventData[]
    openingHours?: OpeningHour[]
}

interface WidgetFetchOptions {
    forceRefresh?: boolean
    signal?: AbortSignal
}

type WidgetCacheEntry = {
    data: WidgetDataResponse
    expiresAt: number
    staleUntil: number
};

const WIDGET_CACHE_FRESH_MS = 15_000;
const WIDGET_CACHE_STALE_MS = 90_000;
const WIDGET_CACHE_PREFIX = 'events:widget:';
const widgetCache = new Map<string, WidgetCacheEntry>();
const widgetInFlight = new Map<string, Promise<WidgetDataResponse>>();

function getWidgetKey(restaurantId: string) {
    return `${WIDGET_CACHE_PREFIX}${restaurantId}`;
}

function readWidgetCacheFromSession(key: string): WidgetCacheEntry | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.sessionStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.data || typeof parsed.expiresAt !== 'number' || typeof parsed.staleUntil !== 'number') {
            return null;
        }
        return parsed as WidgetCacheEntry;
    } catch {
        return null;
    }
}

function writeWidgetCacheToSession(key: string, entry: WidgetCacheEntry) {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(key, JSON.stringify(entry));
    } catch {
        // Ignore quota/security errors
    }
}

function setWidgetCache(key: string, data: WidgetDataResponse) {
    const now = Date.now();
    const entry: WidgetCacheEntry = {
        data,
        expiresAt: now + WIDGET_CACHE_FRESH_MS,
        staleUntil: now + WIDGET_CACHE_FRESH_MS + WIDGET_CACHE_STALE_MS,
    };
    widgetCache.set(key, entry);
    writeWidgetCacheToSession(key, entry);
}

function getWidgetCacheEntry(key: string): WidgetCacheEntry | null {
    const inMemory = widgetCache.get(key);
    if (inMemory) return inMemory;
    const fromSession = readWidgetCacheFromSession(key);
    if (fromSession) {
        widgetCache.set(key, fromSession);
        return fromSession;
    }
    return null;
}

export function peekWidgetDataCache(restaurantId: string): WidgetDataResponse | null {
    const key = getWidgetKey(restaurantId);
    const entry = getWidgetCacheEntry(key);
    if (!entry) return null;
    if (entry.staleUntil <= Date.now()) return null;
    return entry.data;
}

async function requestWidgetData(restaurantId: string, signal?: AbortSignal): Promise<WidgetDataResponse> {
    // Use prefetched data from widget.html <head> if available (zero-waterfall optimization).
    // widget.html starts the fetch before this JS bundle even loads, saving ~200-800ms.
    const prefetch = (window as any).__WIDGET_PREFETCH as Promise<WidgetDataResponse | null> | undefined;
    if (prefetch) {
        (window as any).__WIDGET_PREFETCH = null; // consume once
        try {
            const data = await prefetch;
            if (data && (data.events || data.zones)) {
                return data;
            }
        } catch {
            // Prefetch failed — fall through to normal fetch
        }
    }

    const response = await fetch(`${API_BASE_URL}/api/widget/${restaurantId}`, { signal });
    if (!response.ok) {
        throw new Error('Failed to fetch widget data');
    }
    return response.json();
}

// Fetch widget data with in-memory + session cache and stale-while-revalidate behavior
export async function fetchWidgetData(restaurantId: string, options: WidgetFetchOptions = {}): Promise<WidgetDataResponse> {
    const { forceRefresh = false, signal } = options;
    const key = getWidgetKey(restaurantId);
    const now = Date.now();
    const cached = getWidgetCacheEntry(key);

    if (!forceRefresh && cached) {
        if (cached.expiresAt > now) {
            return cached.data;
        }

        // Serve stale immediately and refresh in the background.
        if (cached.staleUntil > now) {
            if (!widgetInFlight.has(key)) {
                const refreshPromise = requestWidgetData(restaurantId)
                    .then((data) => {
                        setWidgetCache(key, data);
                        return data;
                    })
                    .finally(() => {
                        widgetInFlight.delete(key);
                    });
                widgetInFlight.set(key, refreshPromise);
            }
            return cached.data;
        }
    }

    // Avoid duplicate concurrent fetches unless this specific call is abortable.
    if (!forceRefresh && !signal) {
        const inFlight = widgetInFlight.get(key);
        if (inFlight) return inFlight;
    }

    const requestPromise = requestWidgetData(restaurantId, signal)
        .then((data) => {
            setWidgetCache(key, data);
            return data;
        })
        .finally(() => {
            if (!signal) {
                widgetInFlight.delete(key);
            }
        });

    if (!signal) {
        widgetInFlight.set(key, requestPromise);
    }

    return requestPromise;
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
        body: JSON.stringify(data),
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

export async function fetchOpeningHours(
    restaurantId: string,
    options: { signal?: AbortSignal } = {}
): Promise<OpeningHour[]> {
    try {
        const response = await fetch(`${API_BASE_URL}/api/restaurant/${restaurantId}/opening-hours`, {
            signal: options.signal,
        });
        if (!response.ok) return [];
        const data = await response.json();
        return data.openingHours ?? [];
    } catch {
        return [];
    }
}

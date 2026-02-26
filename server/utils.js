import crypto from 'crypto';

// Shared HTML escape helper (prevent XSS)
export const escapeHtml = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// Input sanitization helper
export function sanitizeString(str, maxLength = 100) {
    if (typeof str !== 'string') return '';
    return str.slice(0, maxLength).replace(/[<>"']/g, '');
}

// Ensure ID contains only safe URL characters
export function validateRestaurantId(id) {
    if (typeof id !== 'string') return false;
    return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

// HMAC helper for secure unsubscribe tokens
export function generateUnsubscribeToken(email) {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is required');
    }
    return crypto.createHmac('sha256', process.env.JWT_SECRET).update(email).digest('hex');
}

const DUTCH_MONTHS = {
    jan: 1,
    feb: 2,
    mrt: 3,
    apr: 4,
    mei: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    okt: 10,
    nov: 11,
    dec: 12,
};

const DUTCH_WEEKDAYS = new Set([
    'ma', 'di', 'wo', 'do', 'vr', 'za', 'zo',
    'maa', 'din', 'woe', 'don', 'vri', 'zat', 'zon',
]);

function parseTime(timeStr) {
    const value = (timeStr || '12:00').trim();
    const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
    if (!match) {
        throw new Error(`Invalid time format: "${timeStr}"`);
    }
    return {
        hour: parseInt(match[1], 10),
        minute: parseInt(match[2], 10),
        second: parseInt(match[3] || '0', 10),
    };
}

function getAmsterdamOffsetMinutes(year, month, day) {
    const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const amsterdamStr = probe.toLocaleString('en-US', {
        timeZone: 'Europe/Amsterdam',
        timeZoneName: 'shortOffset',
    });
    const offsetMatch = amsterdamStr.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);

    if (!offsetMatch) {
        return 60;
    }

    const sign = offsetMatch[1].startsWith('-') ? -1 : 1;
    const absHours = Math.abs(parseInt(offsetMatch[1], 10));
    const minutes = parseInt(offsetMatch[2] || '0', 10);
    return sign * ((absHours * 60) + minutes);
}

function isValidDateParts(year, month, day) {
    const test = new Date(Date.UTC(year, month - 1, day));
    return test.getUTCFullYear() === year
        && (test.getUTCMonth() + 1) === month
        && test.getUTCDate() === day;
}

function amsterdamLocalToUtcIso(year, month, day, hour, minute, second) {
    if (!isValidDateParts(year, month, day)) {
        throw new Error(`Invalid date: ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
    const offsetMinutes = getAmsterdamOffsetMinutes(year, month, day);
    const utcMillis = Date.UTC(year, month - 1, day, hour, minute, second) - (offsetMinutes * 60 * 1000);
    return new Date(utcMillis).toISOString();
}

function normalizeToken(value) {
    return String(value || '').trim().toLowerCase().replace(/\./g, '');
}

function inferYearForDutchDate(month, day, hour, minute, second) {
    const nowAmsterdam = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
    let year = nowAmsterdam.getFullYear();

    const candidate = new Date(year, month - 1, day, hour, minute, second, 0);
    const sixMonthsMs = 183 * 24 * 60 * 60 * 1000;
    if (candidate.getTime() < (nowAmsterdam.getTime() - sixMonthsMs)) {
        year += 1;
    }

    return year;
}

// Parse slot date/time into a UTC ISO string, interpreting date/time as Europe/Amsterdam local time.
// Supports:
// - ISO date: "2026-03-02"
// - ISO datetime: "2026-03-02T18:00:00", "2026-03-02T18:00:00Z", "2026-03-02T18:00:00+01:00"
// - Dutch display date: "Ma 2 mrt", "2 mei", "Wo 14 okt 2026"
export function parseSlotDateTime(dateStr, timeStr) {
    const dateValue = String(dateStr || '').trim();
    if (!dateValue) {
        throw new Error('date is required');
    }

    const { hour, minute, second } = parseTime(timeStr);

    const isoDateOnly = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateOnly) {
        const year = parseInt(isoDateOnly[1], 10);
        const month = parseInt(isoDateOnly[2], 10);
        const day = parseInt(isoDateOnly[3], 10);
        return amsterdamLocalToUtcIso(year, month, day, hour, minute, second);
    }

    const isoDateTime = dateValue.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/
    );
    if (isoDateTime) {
        const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(dateValue);
        if (hasOffset) {
            const parsed = new Date(dateValue);
            if (Number.isNaN(parsed.getTime())) {
                throw new Error(`Invalid ISO datetime: "${dateValue}"`);
            }
            return parsed.toISOString();
        }

        const year = parseInt(isoDateTime[1], 10);
        const month = parseInt(isoDateTime[2], 10);
        const day = parseInt(isoDateTime[3], 10);
        const localHour = parseInt(isoDateTime[4], 10);
        const localMinute = parseInt(isoDateTime[5], 10);
        const localSecond = parseInt(isoDateTime[6] || '0', 10);
        return amsterdamLocalToUtcIso(year, month, day, localHour, localMinute, localSecond);
    }

    const normalized = dateValue.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    const tokens = normalized.split(' ');
    const compactTokens = tokens.length > 0 && DUTCH_WEEKDAYS.has(normalizeToken(tokens[0]))
        ? tokens.slice(1)
        : tokens;

    if (compactTokens.length >= 2) {
        const day = parseInt(compactTokens[0], 10);
        const monthToken = normalizeToken(compactTokens[1]);
        const month = DUTCH_MONTHS[monthToken];
        const explicitYear = compactTokens.length >= 3 ? parseInt(compactTokens[2], 10) : NaN;

        if (!Number.isNaN(day) && month) {
            const year = Number.isNaN(explicitYear)
                ? inferYearForDutchDate(month, day, hour, minute, second)
                : explicitYear;
            return amsterdamLocalToUtcIso(year, month, day, hour, minute, second);
        }
    }

    throw new Error(`Unsupported date format: "${dateStr}"`);
}

/** Build a Map<tableId, bookingIntervals[]> from a booking query result */
export function buildBookingsMap(bookingsRows) {
    const map = new Map();
    for (const b of bookingsRows) {
        if (!map.has(b.table_id)) map.set(b.table_id, []);
        map.get(b.table_id).push({ start_time: b.start_time, end_time: b.end_time });
    }
    return map;
}

// ============================================
// TABLE SELECTION HELPERS (shared by availability + booking endpoints)
// ============================================

export const BOOKING_DURATION_MINS = 180; // 3-hour booking blocks
export const SLOT_STEP_MINS = 30;

/** Normalize any time string ("HH:MM:SS" or "HH:MM" or "H:MM") to "HH:MM" */
export function normalizeToHHMM(t) {
    const s = (t || '00:00').trim();
    const parts = s.split(':');
    return parts[0].padStart(2, '0') + ':' + (parts[1] || '00').padStart(2, '0');
}

export function timeToMins(t) {
    const n = normalizeToHHMM(t);
    return parseInt(n.slice(0, 2)) * 60 + parseInt(n.slice(3, 5));
}

export function minsToTime(m) {
    return `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
}

/** Compute booking end time, capped at closing */
export function computeEndTime(startTime, closeTime) {
    const startMins = timeToMins(startTime);
    const closeMins = timeToMins(closeTime);
    return minsToTime(Math.min(startMins + BOOKING_DURATION_MINS, closeMins));
}

/** Check if two time intervals overlap. Compares as minutes to avoid format bugs. */
export function overlaps(aStart, aEnd, bStart, bEnd) {
    const as = timeToMins(aStart);
    const ae = timeToMins(aEnd);
    const bs = timeToMins(bStart);
    const be = timeToMins(bEnd);
    return as < be && ae > bs;
}

/** Greedy: pick biggest tables until total seats >= guestCount. Returns null if impossible. */
export function pickTablesGreedy(freeTables, guestCount) {
    let total = 0;
    const picked = [];
    for (const t of freeTables) {
        picked.push(t);
        total += t.seats;
        if (total >= guestCount) return picked;
    }
    return null; // not enough seats
}

/**
 * Single source of truth for table selection.
 * Prefer single table → same-zone combo → cross-zone combo.
 */
export function selectTablesForSlot({ allTables, bookingsByTableId, slotStart, slotEnd, guestCount }) {
    const isFree = (t) => {
        const intervals = bookingsByTableId.get(t.id) || [];
        for (const b of intervals) {
            if (overlaps(b.start_time, b.end_time, slotStart, slotEnd)) return false;
        }
        return true;
    };

    const freeTables = allTables.filter(isFree);

    // 1) Single table fits — prefer smallest table that fits (sort ASC)
    const freeBySeatsAsc = [...freeTables].sort((a, b) => a.seats - b.seats);
    const single = freeBySeatsAsc.find(t => t.seats >= guestCount);
    if (single) return [single];

    // 2) Combine within a zone first (less operational fragmentation)
    const byZone = new Map();
    for (const t of freeTables) {
        const z = t.zone || '__NO_ZONE__';
        if (!byZone.has(z)) byZone.set(z, []);
        byZone.get(z).push(t);
    }
    for (const [, zoneTables] of byZone.entries()) {
        zoneTables.sort((a, b) => b.seats - a.seats);
        const picked = pickTablesGreedy(zoneTables, guestCount);
        if (picked) return picked;
    }

    // 3) Combine across zones
    freeTables.sort((a, b) => b.seats - a.seats);
    return pickTablesGreedy(freeTables, guestCount);
}

// ============================================
// TABLE ALLOCATION: Greedy algorithm for large groups
// ============================================
export function allocateTables(guestCount, available2, available4, available6) {
    const tables = [];
    let remaining = guestCount;

    const need6 = Math.min(Math.floor(remaining / 6), available6);
    if (need6 > 0) {
        tables.push({ seats: 6, count: need6 });
        remaining -= need6 * 6;
    }

    const need4 = Math.min(Math.floor(remaining / 4), available4);
    if (need4 > 0) {
        tables.push({ seats: 4, count: need4 });
        remaining -= need4 * 4;
    }

    const need2 = Math.min(Math.ceil(remaining / 2), available2);
    if (need2 > 0) {
        tables.push({ seats: 2, count: need2 });
        remaining -= need2 * 2;
    }

    if (remaining > 0) {
        remaining = guestCount;
        tables.length = 0;

        let use6 = Math.min(Math.ceil(remaining / 6), available6);
        if (use6 * 6 >= remaining) {
            tables.push({ seats: 6, count: use6 });
            remaining = 0;
        } else {
            if (use6 > 0) {
                tables.push({ seats: 6, count: use6 });
                remaining -= use6 * 6;
            }
            let use4 = Math.min(Math.ceil(remaining / 4), available4);
            if (use4 * 4 >= remaining) {
                tables.push({ seats: 4, count: use4 });
                remaining = 0;
            } else {
                if (use4 > 0) {
                    tables.push({ seats: 4, count: use4 });
                    remaining -= use4 * 4;
                }
                let use2 = Math.min(Math.ceil(remaining / 2), available2);
                if (use2 * 2 >= remaining) {
                    tables.push({ seats: 2, count: use2 });
                    remaining = 0;
                }
            }
        }
    }

    if (remaining > 0) return null;

    const totalSeats = tables.reduce((sum, t) => sum + t.seats * t.count, 0);
    return { tables, totalSeats };
}

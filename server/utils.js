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

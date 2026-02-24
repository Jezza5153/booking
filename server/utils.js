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

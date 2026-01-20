import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

// ============================================
// SECURITY: JWT Secret - FATAL if missing
// ============================================
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ FATAL: JWT_SECRET environment variable is required');
    console.error('   Set JWT_SECRET in your environment before starting the server');
    process.exit(1);
}

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.error('❌ FATAL: ADMIN_USERNAME and ADMIN_PASSWORD environment variables are required');
    process.exit(1);
}

// ============================================
// Rate Limiting (in-memory, simple implementation)
// ============================================
const rateLimitStore = new Map();

function createRateLimiter(maxRequests, windowMs) {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const key = `${req.path}:${ip}`;
        const now = Date.now();

        const record = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };

        // Reset window if expired
        if (now > record.resetAt) {
            record.count = 0;
            record.resetAt = now + windowMs;
        }

        record.count++;
        rateLimitStore.set(key, record);

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - record.count));
        res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));

        if (record.count > maxRequests) {
            return res.status(429).json({
                error: 'Too many requests',
                retryAfter: Math.ceil((record.resetAt - now) / 1000)
            });
        }

        next();
    };
}

// Export rate limiters for different endpoints
export const loginRateLimiter = createRateLimiter(5, 60 * 1000);      // 5 per minute
export const bookingRateLimiter = createRateLimiter(20, 60 * 1000);   // 20 per minute
export const widgetRateLimiter = createRateLimiter(60, 60 * 1000);    // 60 per minute

// ============================================
// Authentication
// ============================================

// Verify login credentials
export function verifyCredentials(username, password) {
    if (username !== ADMIN_USERNAME) {
        return false;
    }
    // TODO: In production, store hashed password and use bcrypt.compare
    // For now, using plain text comparison
    return password === ADMIN_PASSWORD;
}

// Generate JWT token
export function generateToken(username) {
    return jwt.sign(
        { username, role: 'admin' },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
}

// Middleware to verify JWT token
export function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        // Don't leak details about token verification failures
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// Login route handler
export function loginHandler(req, res) {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    // Security: Don't reveal whether username or password was wrong
    if (!verifyCredentials(username, password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(username);
    res.json({ token, username, expiresIn: '24h' });
}

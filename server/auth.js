import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import pool from './db-postgres.js';

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

// ============================================
// MULTI-TENANT: Database-backed authentication
// Each restaurant has their own admin users
// ============================================

// Fallback to env vars if admin_users table doesn't exist yet (migration pending)
const FALLBACK_USERNAME = process.env.ADMIN_USERNAME;
const FALLBACK_PASSWORD = process.env.ADMIN_PASSWORD;
const FALLBACK_RESTAURANT_ID = process.env.DEFAULT_RESTAURANT_ID || 'demo-restaurant';

// Verify login credentials against database
export async function verifyCredentials(username, password) {
    console.log('[AUTH] Attempting login for username:', username);
    try {
        // Try database lookup first
        const result = await pool.query(
            `SELECT id, restaurant_id, username, password_hash 
             FROM admin_users 
             WHERE username = $1 AND is_active = true`,
            [username]
        );

        console.log('[AUTH] Database query returned', result.rows.length, 'rows');
        if (result.rows.length > 0) {
            console.log('[AUTH] Found user:', result.rows[0].username, 'restaurant:', result.rows[0].restaurant_id);
        }

        if (result.rows.length > 0) {
            const user = result.rows[0];
            const isValid = await bcrypt.compare(password, user.password_hash);
            console.log('[AUTH] Password comparison result:', isValid);
            if (isValid) {
                // Update last_login
                await pool.query(
                    'UPDATE admin_users SET last_login = now() WHERE id = $1',
                    [user.id]
                ).catch(() => { }); // Non-blocking

                return {
                    valid: true,
                    userId: user.id,
                    username: user.username,
                    restaurantId: user.restaurant_id
                };
            }
        }
    } catch (error) {
        // Table might not exist yet - fall through to env var fallback
        console.warn('Database auth lookup failed, trying fallback:', error.message);
    }

    // FALLBACK: Use environment variables (for backwards compatibility)
    if (FALLBACK_USERNAME && FALLBACK_PASSWORD) {
        if (username !== FALLBACK_USERNAME) {
            return { valid: false };
        }

        // Support both hashed and unhashed fallback passwords
        let isValid = false;
        if (FALLBACK_PASSWORD.startsWith('$2')) {
            isValid = await bcrypt.compare(password, FALLBACK_PASSWORD);
        } else {
            // Plain text comparison (not recommended for production)
            isValid = password === FALLBACK_PASSWORD;
        }

        if (isValid) {
            return {
                valid: true,
                userId: 'fallback-admin',
                username: FALLBACK_USERNAME,
                restaurantId: FALLBACK_RESTAURANT_ID
            };
        }
    }

    return { valid: false };
}

// Generate JWT token with restaurant_id for multi-tenancy
export function generateToken(userId, username, restaurantId) {
    return jwt.sign(
        {
            userId,
            username,
            restaurantId,  // CRITICAL: This scopes all admin API calls
            role: 'admin'
        },
        JWT_SECRET,
        { expiresIn: '24h', algorithm: 'HS256' }
    );
}

// Middleware to verify JWT token and extract restaurant_id
export function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // SECURITY: Explicitly specify allowed algorithms to prevent "none" attack
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        req.user = decoded;

        // MULTI-TENANT: Override any query param with token's restaurant_id
        // This prevents a user from accessing another restaurant's data
        if (decoded.restaurantId) {
            req.query.restaurantId = decoded.restaurantId;
            req.body.restaurantId = decoded.restaurantId;
        }

        next();
    } catch (error) {
        // Don't leak details about token verification failures
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// Login route handler
export async function loginHandler(req, res) {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    // Security: Don't reveal whether username or password was wrong
    const authResult = await verifyCredentials(username, password);
    if (!authResult.valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(authResult.userId, authResult.username, authResult.restaurantId);
    res.json({
        token,
        username: authResult.username,
        restaurantId: authResult.restaurantId,
        expiresIn: '24h'
    });
}

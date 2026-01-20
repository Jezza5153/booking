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
// Authentication
// ============================================

// Verify login credentials (async for bcrypt)
export async function verifyCredentials(username, password) {
    if (username !== ADMIN_USERNAME) {
        return false;
    }

    // SECURITY: Require bcrypt-hashed password (starts with $2)
    if (!ADMIN_PASSWORD.startsWith('$2')) {
        console.error('❌ FATAL: ADMIN_PASSWORD must be bcrypt hashed. Generate with: npx bcrypt-cli hash "yourpassword"');
        return false;
    }

    // Compare with bcrypt
    return await bcrypt.compare(password, ADMIN_PASSWORD);
}

// Generate JWT token with explicit algorithm
export function generateToken(username) {
    return jwt.sign(
        { username, role: 'admin' },
        JWT_SECRET,
        { expiresIn: '24h', algorithm: 'HS256' }
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
        // SECURITY: Explicitly specify allowed algorithms to prevent "none" attack
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        req.user = decoded;
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
    const isValid = await verifyCredentials(username, password);
    if (!isValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(username);
    res.json({ token, username, expiresIn: '24h' });
}

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// Verify login credentials
export function verifyCredentials(username, password) {
    if (username !== ADMIN_USERNAME) {
        return false;
    }
    // For simplicity, using plain text comparison
    // In production, store hashed password and use bcrypt.compare
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
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// Login route handler
export function loginHandler(req, res) {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    if (!verifyCredentials(username, password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(username);
    res.json({ token, username, expiresIn: '24h' });
}

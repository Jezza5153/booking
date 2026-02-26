import express from 'express';
import { loginHandler, authMiddleware, generateToken } from '../auth.js';
import { loginRateLimiter } from '../ratelimit.js';

const router = express.Router();

// ============================================
// AUTH ROUTES (Public, Rate Limited)
// ============================================
router.post('/login', loginRateLimiter, loginHandler);

// Verify token endpoint
router.get('/verify', authMiddleware, (req, res) => {
    res.json({ valid: true, user: req.user });
});

// Refresh token — issue a fresh 30-day token if current one is still valid
router.post('/refresh', authMiddleware, (req, res) => {
    const { userId, username, restaurantId } = req.user;
    const token = generateToken(userId, username, restaurantId);
    res.json({ token, username, restaurantId, expiresIn: '30d' });
});

export default router;

import express from 'express';
import { loginHandler, authMiddleware } from '../auth.js';
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

export default router;

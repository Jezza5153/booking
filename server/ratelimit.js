import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import Redis from 'ioredis';

// ============================================
// Redis-based Rate Limiting (Multi-Instance Safe)
// ============================================

const redisUrl = process.env.REDIS_URL;
let redis = null;
let useRedis = false;

if (redisUrl) {
    try {
        redis = new Redis(redisUrl, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            retryDelayOnFailover: 100
        });
        redis.on('connect', () => console.log('✅ Redis connected for rate limiting'));
        redis.on('error', (err) => console.error('⚠️ Redis rate limit error:', err.message));
        useRedis = true;
    } catch (e) {
        console.warn('⚠️ Redis init failed, using in-memory rate limiting');
    }
} else {
    console.log('ℹ️  REDIS_URL not set, using in-memory rate limiting (single instance only)');
}

function makeLimiter({ points, duration, keyPrefix }) {
    let limiter;

    if (useRedis && redis) {
        limiter = new RateLimiterRedis({
            storeClient: redis,
            points,
            duration,
            keyPrefix: keyPrefix || 'rl',
        });
    } else {
        // Fallback to in-memory for development/single instance
        limiter = new RateLimiterMemory({
            points,
            duration,
            keyPrefix: keyPrefix || 'rl',
        });
    }

    return async function rateLimit(req, res, next) {
        try {
            // Support Cloudflare and Railway proxies
            const ip = req.ip ||
                req.headers['cf-connecting-ip'] ||
                req.headers['x-forwarded-for']?.split(',')[0] ||
                req.connection?.remoteAddress ||
                'unknown';

            const key = `${req.path}:${ip}`;
            const rateLimiterRes = await limiter.consume(key);

            // Set rate limit headers
            res.setHeader('X-RateLimit-Limit', points);
            res.setHeader('X-RateLimit-Remaining', rateLimiterRes.remainingPoints);
            res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + rateLimiterRes.msBeforeNext / 1000));

            next();
        } catch (rateLimiterRes) {
            // Rate limited
            res.setHeader('X-RateLimit-Limit', points);
            res.setHeader('X-RateLimit-Remaining', 0);
            res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + (rateLimiterRes.msBeforeNext || 60000) / 1000));
            res.setHeader('Retry-After', Math.ceil((rateLimiterRes.msBeforeNext || 60000) / 1000));

            res.status(429).json({
                error: 'Too many requests',
                retryAfter: Math.ceil((rateLimiterRes.msBeforeNext || 60000) / 1000)
            });
        }
    };
}

// Export rate limiters for different endpoints
export const loginRateLimiter = makeLimiter({ points: 5, duration: 60, keyPrefix: 'rl:login' });       // 5 per minute
export const bookingRateLimiter = makeLimiter({ points: 20, duration: 60, keyPrefix: 'rl:book' });     // 20 per minute
export const widgetRateLimiter = makeLimiter({ points: 60, duration: 60, keyPrefix: 'rl:widget' });    // 60 per minute
export const calendarRateLimiter = makeLimiter({ points: 60, duration: 60, keyPrefix: 'rl:calendar' }); // 60 per minute (separate for ICS)

// Export Redis status checker
export function isRedisConnected() {
    return useRedis && redis && redis.status === 'ready';
}

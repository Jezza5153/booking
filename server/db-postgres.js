import pg from 'pg';
import './env.js';

// ============================================
// SECURITY: DATABASE_URL is required (no SQLite fallback)
// ============================================
if (!process.env.DATABASE_URL) {
    console.error('❌ FATAL: DATABASE_URL environment variable is required');
    console.error('   Set DATABASE_URL in your environment before starting the server');
    process.exit(1);
}

const { Pool } = pg;

// Create PostgreSQL connection pool with production-safe settings
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: process.env.NODE_ENV === 'production'
    },
    max: parseInt(process.env.DB_POOL_MAX || '10', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// Test connection
pool.query('SELECT NOW()')
    .then(() => console.log('✅ Connected to Neon PostgreSQL'))
    .catch(err => console.error('❌ Database connection error:', err.message));

// Optional DB keep-alive to reduce first-query latency after idle periods.
// Set DB_KEEPALIVE_INTERVAL_MS (e.g. 240000 for 4 minutes) to enable.
const dbKeepAliveMs = parseInt(process.env.DB_KEEPALIVE_INTERVAL_MS || '0', 10);
if (dbKeepAliveMs >= 30000) {
    const keepAliveTimer = setInterval(() => {
        pool.query('SELECT 1').catch((err) => {
            console.warn('⚠️ DB keep-alive ping failed:', err.message);
        });
    }, dbKeepAliveMs);

    if (typeof keepAliveTimer.unref === 'function') {
        keepAliveTimer.unref();
    }
    console.log(`ℹ️ DB keep-alive enabled (${dbKeepAliveMs}ms interval)`);
}

export default pool;

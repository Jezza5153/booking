import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

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

export default pool;

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Create PostgreSQL connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test connection
pool.query('SELECT NOW()')
    .then(() => console.log('✅ Connected to Neon PostgreSQL'))
    .catch(err => console.error('❌ Database connection error:', err.message));

export default pool;

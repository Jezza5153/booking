import fs from 'fs';
import pg from 'pg';

const sqlOptions = {
    connectionString: process.env.DATABASE_URL
};

const pool = new pg.Pool(sqlOptions);

async function run() {
    try {
        const sql = fs.readFileSync('server/migration-performance-public-endpoints.sql', 'utf8');
        await pool.query(sql);
        console.log("Migration executed successfully!");
    } catch(err) {
        console.error("Migration failed:", err);
    } finally {
        await pool.end();
    }
}
run();

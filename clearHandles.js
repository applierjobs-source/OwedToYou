// Script to clear all Instagram handles from the leaderboard
const { Pool } = require('pg');

// Get database connection from environment variables (same as server.js)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway') ? {
        rejectUnauthorized: false
    } : false
});

async function clearHandles() {
    try {
        console.log('[CLEAR HANDLES] Starting...');
        
        // First, find and drop the UNIQUE constraint on handle
        try {
            // Try to find the constraint name
            const constraintQuery = await pool.query(`
                SELECT constraint_name 
                FROM information_schema.table_constraints 
                WHERE table_name = 'leaderboard' 
                AND constraint_type = 'UNIQUE'
                AND constraint_name LIKE '%handle%'
            `);
            
            if (constraintQuery.rows.length > 0) {
                const constraintName = constraintQuery.rows[0].constraint_name;
                console.log(`[CLEAR HANDLES] Found constraint: ${constraintName}`);
                await pool.query(`ALTER TABLE leaderboard DROP CONSTRAINT ${constraintName}`);
                console.log(`[CLEAR HANDLES] Dropped UNIQUE constraint: ${constraintName}`);
            } else {
                // Try common constraint names
                const commonNames = ['leaderboard_handle_key', 'leaderboard_handle_uk', 'leaderboard_pkey'];
                for (const name of commonNames) {
                    try {
                        await pool.query(`ALTER TABLE leaderboard DROP CONSTRAINT IF EXISTS ${name}`);
                        console.log(`[CLEAR HANDLES] Attempted to drop constraint: ${name}`);
                    } catch (e) {
                        // Ignore if doesn't exist
                    }
                }
            }
        } catch (e) {
            console.log(`[CLEAR HANDLES] Constraint handling note:`, e.message);
        }
        
        // Update all handles to empty string
        const updateResult = await pool.query(
            "UPDATE leaderboard SET handle = '' WHERE handle != ''"
        );
        
        console.log(`[CLEAR HANDLES] Cleared ${updateResult.rowCount} handles`);
        
        // Re-create index (non-unique)
        try {
            await pool.query(`
                DROP INDEX IF EXISTS idx_leaderboard_handle;
                CREATE INDEX idx_leaderboard_handle ON leaderboard(handle);
            `);
            console.log(`[CLEAR HANDLES] Recreated index on handle`);
        } catch (e) {
            console.log(`[CLEAR HANDLES] Index creation note:`, e.message);
        }
        
        console.log('[CLEAR HANDLES] Completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('[CLEAR HANDLES] Error:', error);
        process.exit(1);
    }
}

// Run the function
clearHandles();

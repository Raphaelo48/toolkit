import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
const isLocal = !connectionString || /localhost|127\.0\.0\.1/.test(connectionString);

export const pool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true
});

// Без этого обработчика обрыв простаивающего соединения с базой
// (обычное дело на облачном PostgreSQL) роняет весь процесс Node.
pool.on('error', err => {
    console.error('[db] idle client error:', err.message);
});

/** Запрос с одной повторной попыткой при сетевой ошибке соединения. */
export async function query(text, params) {
    try {
        return await pool.query(text, params);
    } catch (err) {
        if (isTransient(err)) {
            console.warn('[db] transient error, retrying:', err.message);
            await new Promise(r => setTimeout(r, 500));
            return pool.query(text, params);
        }
        throw err;
    }
}

function isTransient(err) {
    const code = err?.code || '';
    return ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', '57P01', '08006', '08003', '08000'].includes(code)
        || /Connection terminated|connection timeout/i.test(err?.message || '');
}

export async function ensureSchema() {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const sql = fs.readFileSync(path.join(dir, '..', 'schema.sql'), 'utf8');
    await pool.query(sql);

    // Supabase открывает таблицы схемы public через свой REST API. Включаем RLS без политик:
    // сервер (владелец таблиц) работает как раньше, а снаружи через API таблицы недоступны.
    for (const table of ['users', 'campaigns', 'campaign_members', 'rooms', 'room_state', 'token_inventory']) {
        try {
            await pool.query(`ALTER TABLE IF EXISTS ${table} ENABLE ROW LEVEL SECURITY`);
        } catch (err) {
            console.warn(`[db] RLS для ${table} не включён:`, err.message);
        }
    }
    console.log('[db] schema ok');
}

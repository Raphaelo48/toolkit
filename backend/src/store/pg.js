// Хранилище в PostgreSQL (Render, Supabase, свой сервер). Включается, если задан DATABASE_URL.
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

export function createPgStore(connectionString) {
    const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
    const pool = new Pool({
        connectionString,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        max: Number(process.env.PG_POOL_MAX || 5),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 15_000,
        keepAlive: true
    });

    // Без этого обработчика обрыв простаивающего соединения с базой роняет весь процесс Node
    pool.on('error', err => console.error('[db] idle client error:', err.message));

    async function query(text, params) {
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

    const MEMBER_SELECT = `
        SELECT cm.user_id::text AS user_id, cm.role, cm.token, u.username,
               r.id::text AS room_id, r.room_code, c.id::text AS campaign_id,
               c.name AS campaign_name, c.description AS campaign_description
          FROM campaign_members cm
          JOIN users u ON u.id = cm.user_id
          JOIN campaigns c ON c.id = cm.campaign_id
          JOIN rooms r ON r.campaign_id = c.id`;

    return {
        kind: 'postgres',

        async init() {
            const dir = path.dirname(fileURLToPath(import.meta.url));
            const sql = fs.readFileSync(path.join(dir, '..', '..', 'schema.sql'), 'utf8');
            await pool.query(sql);
            // Supabase открывает таблицы схемы public через REST API. RLS без политик закрывает этот доступ,
            // а сервер (владелец таблиц) работает как раньше.
            for (const table of ['users', 'campaigns', 'campaign_members', 'rooms', 'room_state', 'token_inventory']) {
                try { await pool.query(`ALTER TABLE IF EXISTS ${table} ENABLE ROW LEVEL SECURITY`); }
                catch (err) { console.warn(`[db] RLS для ${table} не включён:`, err.message); }
            }
        },

        async health() { await query('SELECT 1'); },

        async close() { await pool.end().catch(() => {}); },

        async createCampaign({ name, description, masterName, token, makeCode }) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const user = (await client.query('INSERT INTO users (username) VALUES ($1) RETURNING id::text, username', [masterName])).rows[0];
                const campaign = (await client.query(
                    'INSERT INTO campaigns (name, description, master_user_id) VALUES ($1, $2, $3) RETURNING id::text, name, description',
                    [name, description, user.id]
                )).rows[0];
                await client.query(
                    'INSERT INTO campaign_members (campaign_id, user_id, role, token) VALUES ($1, $2, $3, $4)',
                    [campaign.id, user.id, 'master', token]
                );
                let room = null;
                for (let i = 0; i < 10 && !room; i++) {
                    await client.query('SAVEPOINT code_try');
                    try {
                        room = (await client.query(
                            'INSERT INTO rooms (campaign_id, room_code) VALUES ($1, $2) RETURNING id::text, room_code', [campaign.id, makeCode()]
                        )).rows[0];
                    } catch (error) {
                        if (error.code !== '23505') throw error;
                        await client.query('ROLLBACK TO SAVEPOINT code_try');
                    }
                }
                if (!room) throw new Error('Не удалось создать уникальный код комнаты');
                await client.query('INSERT INTO room_state (room_id) VALUES ($1) ON CONFLICT DO NOTHING', [room.id]);
                await client.query('COMMIT');
                return { campaign, room, user };
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            } finally {
                client.release();
            }
        },

        async findRoomByCode(code) {
            const r = await query(
                `SELECT r.id::text AS id, r.room_code, r.campaign_id::text AS campaign_id,
                        c.name AS campaign_name, c.description AS campaign_description
                   FROM rooms r JOIN campaigns c ON c.id = r.campaign_id WHERE r.room_code = $1`, [code]);
            return r.rows[0] || null;
        },

        async memberByToken(token) {
            if (!token) return null;
            return (await query(`${MEMBER_SELECT} WHERE cm.token = $1 LIMIT 1`, [token])).rows[0] || null;
        },

        async memberInRoom(roomId, userId) {
            if (!/^\d+$/.test(String(roomId)) || !/^\d+$/.test(String(userId))) return null;
            return (await query(`${MEMBER_SELECT} WHERE r.id = $1 AND cm.user_id = $2 LIMIT 1`, [roomId, userId])).rows[0] || null;
        },

        async memberByName(roomId, name) {
            return (await query(
                `${MEMBER_SELECT} WHERE r.id = $1 AND lower(u.username) = lower($2) ORDER BY cm.joined_at LIMIT 1`, [roomId, name]
            )).rows[0] || null;
        },

        async setToken(campaignId, userId, token) {
            await query('UPDATE campaign_members SET token = $1 WHERE campaign_id = $2 AND user_id = $3', [token, campaignId, userId]);
        },

        async addPlayer(campaignId, name, token) {
            const user = (await query('INSERT INTO users (username) VALUES ($1) RETURNING id::text, username', [name])).rows[0];
            await query('INSERT INTO campaign_members (campaign_id, user_id, role, token) VALUES ($1, $2, $3, $4)',
                [campaignId, user.id, 'player', token]);
            return user;
        },

        async deleteMember(campaignId, userId) {
            await query('DELETE FROM campaign_members WHERE campaign_id = $1 AND user_id = $2', [campaignId, userId]);
        },

        async listMembers(roomId) {
            if (!/^\d+$/.test(String(roomId))) return [];
            return (await query(
                `SELECT u.id::text AS id, u.username AS name, cm.role, cm.joined_at
                   FROM campaign_members cm JOIN users u ON u.id = cm.user_id
                  WHERE cm.campaign_id = (SELECT campaign_id FROM rooms WHERE id = $1)
                  ORDER BY (cm.role = 'master') DESC, cm.joined_at`, [roomId]
            )).rows;
        },

        async loadRoomState(roomId) {
            if (!/^\d+$/.test(String(roomId))) return null;
            const r = await query('SELECT state, version, map_src, draw_canvas, fog_canvas, vision_walls, boards FROM room_state WHERE room_id = $1', [roomId]);
            return r.rows[0] || null;
        },

        async saveRoomState(roomId, s) {
            await query(
                `INSERT INTO room_state (room_id, state, version, map_src, draw_canvas, fog_canvas, vision_walls, boards, updated_at)
                 VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, NOW())
                 ON CONFLICT (room_id) DO UPDATE SET
                   state = EXCLUDED.state, version = EXCLUDED.version, map_src = EXCLUDED.map_src,
                   draw_canvas = EXCLUDED.draw_canvas, fog_canvas = EXCLUDED.fog_canvas,
                   vision_walls = EXCLUDED.vision_walls, boards = EXCLUDED.boards, updated_at = NOW()`,
                [roomId, JSON.stringify(s.state), s.version, s.map_src, s.draw_canvas, s.fog_canvas, s.vision_walls || null, s.boards || null]
            );
        }
    };
}

function isTransient(err) {
    const code = err?.code || '';
    return ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', '57P01', '08006', '08003', '08000'].includes(code)
        || /Connection terminated|connection timeout/i.test(err?.message || '');
}

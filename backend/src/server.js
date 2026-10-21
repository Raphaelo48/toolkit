import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import http from 'http';
import crypto from 'crypto';

dotenv.config();

const { pool, query, ensureSchema } = await import('./db.js');
const { getRoom, getLoadedRoom, flushAll } = await import('./rooms.js');

const PORT = Number(process.env.PORT || 5000);
const HEARTBEAT_MS = 25_000;
const MAX_WS_MESSAGE = 32 * 1024 * 1024; // карта или холст в base64 могут весить несколько МБ

// Ни одна ошибка не должна молча ронять сервер посреди игры
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));
process.on('uncaughtException', err => console.error('[uncaughtException]', err));

const app = express();
app.set('trust proxy', 1);
app.use(cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : true,
    credentials: true
}));
app.use(express.json({ limit: '2mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_WS_MESSAGE, perMessageDeflate: false });

/* =========================================================
   HELPERS
========================================================= */

const newToken = () => crypto.randomBytes(24).toString('base64url');
const newRoomCode = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих 0/O и 1/I
    return Array.from(crypto.randomBytes(6), b => alphabet[b % alphabet.length]).join('');
};
const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const httpError = (status, message) => Object.assign(new Error(message), { status });

// Express 5 сам ловит ошибки async-обработчиков, обёртка оставлена для наглядности
const route = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function sessionPayload(row) {
    return {
        campaign: { id: row.campaign_id, name: row.campaign_name, description: row.campaign_description || '' },
        room: { id: row.room_id, code: row.room_code, campaign_id: row.campaign_id },
        player: { id: row.user_id, name: row.username, role: row.role, token: row.token }
    };
}

const MEMBER_SELECT = `
    SELECT cm.user_id, cm.role, cm.token, u.username,
           r.id AS room_id, r.room_code, c.id AS campaign_id,
           c.name AS campaign_name, c.description AS campaign_description
      FROM campaign_members cm
      JOIN users u ON u.id = cm.user_id
      JOIN campaigns c ON c.id = cm.campaign_id
      JOIN rooms r ON r.campaign_id = c.id`;

async function memberByToken(token) {
    if (!token) return null;
    const r = await query(`${MEMBER_SELECT} WHERE cm.token = $1 LIMIT 1`, [token]);
    return r.rows[0] || null;
}

async function memberInRoom(roomId, userId) {
    const r = await query(`${MEMBER_SELECT} WHERE r.id = $1 AND cm.user_id = $2 LIMIT 1`, [roomId, userId]);
    return r.rows[0] || null;
}

async function ensureToken(member) {
    if (member.token) return member.token;
    const token = newToken();
    await query('UPDATE campaign_members SET token = $1 WHERE campaign_id = $2 AND user_id = $3',
        [token, member.campaign_id, member.user_id]);
    member.token = token;
    return token;
}

async function playersOf(roomId) {
    const r = await query(
        `SELECT u.id, u.username AS name, cm.role, cm.joined_at
           FROM campaign_members cm JOIN users u ON u.id = cm.user_id
          WHERE cm.campaign_id = (SELECT campaign_id FROM rooms WHERE id = $1)
          ORDER BY (cm.role = 'master') DESC, cm.joined_at`,
        [roomId]
    );
    const online = getLoadedRoom(roomId)?.onlinePlayerIds() || new Set();
    return r.rows.map(p => ({ ...p, online: online.has(String(p.id)) }));
}

async function notifyPlayers(roomId) {
    const room = getLoadedRoom(roomId);
    if (!room) return;
    try {
        room.broadcast({ type: 'players_updated', players: await playersOf(roomId) });
    } catch (err) {
        console.error('notifyPlayers:', err.message);
    }
}

/* =========================================================
   HTTP API
========================================================= */

app.get('/', (_req, res) => res.json({ ok: true, service: 'dnd-toolkit-backend' }));

app.get('/api/health', async (_req, res) => {
    try {
        await query('SELECT 1');
        res.json({ success: true, database: 'connected' });
    } catch (error) {
        res.status(503).json({ success: false, database: 'disconnected', error: error.message });
    }
});

// Создать кампанию (создатель становится мастером)
app.post('/api/campaigns', route(async (req, res) => {
    const name = clean(req.body?.name, 120);
    const description = clean(req.body?.description, 2000);
    const masterName = clean(req.body?.masterName, 80);
    if (!name || !masterName) throw httpError(400, 'Название кампании и имя мастера обязательны');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const user = (await client.query('INSERT INTO users (username) VALUES ($1) RETURNING *', [masterName])).rows[0];
        const campaign = (await client.query(
            'INSERT INTO campaigns (name, description, master_user_id) VALUES ($1, $2, $3) RETURNING *',
            [name, description, user.id]
        )).rows[0];
        const token = newToken();
        await client.query(
            'INSERT INTO campaign_members (campaign_id, user_id, role, token) VALUES ($1, $2, $3, $4)',
            [campaign.id, user.id, 'master', token]
        );

        let room = null;
        for (let i = 0; i < 10 && !room; i++) {
            await client.query('SAVEPOINT code_try');
            try {
                room = (await client.query(
                    'INSERT INTO rooms (campaign_id, room_code) VALUES ($1, $2) RETURNING *', [campaign.id, newRoomCode()]
                )).rows[0];
            } catch (error) {
                if (error.code !== '23505') throw error;
                await client.query('ROLLBACK TO SAVEPOINT code_try');
            }
        }
        if (!room) throw new Error('Не удалось создать уникальный код комнаты');

        await client.query('INSERT INTO room_state (room_id) VALUES ($1) ON CONFLICT DO NOTHING', [room.id]);
        await client.query('COMMIT');

        res.status(201).json({
            campaign: { id: campaign.id, name: campaign.name, description: campaign.description },
            room: { id: room.id, code: room.room_code, campaign_id: campaign.id },
            player: { id: user.id, name: user.username, role: 'master', token }
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}));

// Войти в комнату по коду. Повторный вход с тем же именем возвращает того же игрока.
app.post('/api/rooms/join', route(async (req, res) => {
    const roomCode = clean(req.body?.code, 8).toUpperCase();
    const name = clean(req.body?.playerName, 80);
    const token = clean(req.body?.token, 100);
    if (!roomCode || !name) throw httpError(400, 'Код комнаты и имя обязательны');

    const roomRow = (await query(
        `SELECT r.id, r.room_code, r.campaign_id, c.name AS campaign_name, c.description AS campaign_description
           FROM rooms r JOIN campaigns c ON c.id = r.campaign_id WHERE r.room_code = $1`, [roomCode]
    )).rows[0];
    if (!roomRow) throw httpError(404, 'Комната не найдена. Проверьте код.');

    // 1. Уже есть сохранённая сессия этого браузера в этой комнате
    const byToken = await memberByToken(token);
    if (byToken && String(byToken.room_id) === String(roomRow.id)) {
        return res.json(sessionPayload(byToken));
    }

    // 2. Участник с таким именем уже есть
    const existing = (await query(
        `${MEMBER_SELECT} WHERE r.id = $1 AND lower(u.username) = lower($2) ORDER BY cm.joined_at LIMIT 1`,
        [roomRow.id, name]
    )).rows[0];
    if (existing) {
        if (existing.role === 'master') {
            throw httpError(409, 'Это имя мастера. Мастер входит по своей ссылке (кнопка «Ссылка для входа» в панели комнаты).');
        }
        const online = getLoadedRoom(roomRow.id)?.onlinePlayerIds() || new Set();
        if (online.has(String(existing.user_id))) {
            throw httpError(409, 'Игрок с таким именем уже в комнате. Выберите другое имя.');
        }
        await ensureToken(existing);
        return res.json(sessionPayload(existing));
    }

    // 3. Новый игрок
    const user = (await query('INSERT INTO users (username) VALUES ($1) RETURNING *', [name])).rows[0];
    const newMemberToken = newToken();
    await query(
        'INSERT INTO campaign_members (campaign_id, user_id, role, token) VALUES ($1, $2, $3, $4)',
        [roomRow.campaign_id, user.id, 'player', newMemberToken]
    );
    await notifyPlayers(roomRow.id);
    res.json(sessionPayload({
        ...roomRow, room_id: roomRow.id, user_id: user.id, username: user.username, role: 'player', token: newMemberToken
    }));
}));

// Вернуться в комнату по сохранённому токену (перезагрузка страницы, другое устройство)
app.post('/api/session/resume', route(async (req, res) => {
    const member = await memberByToken(clean(req.body?.token, 100));
    if (!member) throw httpError(404, 'Сессия не найдена. Войдите в комнату заново.');
    res.json(sessionPayload(member));
}));

app.get('/api/rooms/:roomId/players', route(async (req, res) => {
    res.json({ players: await playersOf(req.params.roomId) });
}));

// Выйти из комнаты (сам игрок) или исключить игрока (мастер)
app.delete('/api/rooms/:roomId/players/:playerId', route(async (req, res) => {
    const { roomId, playerId } = req.params;
    const actor = await memberByToken(clean(req.get('X-Player-Token'), 100));
    if (!actor || String(actor.room_id) !== String(roomId)) throw httpError(401, 'Нужно войти в комнату');
    if (String(actor.user_id) !== String(playerId) && actor.role !== 'master') throw httpError(403, 'Недостаточно прав');

    const target = await memberInRoom(roomId, playerId);
    if (!target) return res.json({ success: true });
    if (target.role === 'master') throw httpError(400, 'Мастер не может покинуть свою кампанию');

    await query('DELETE FROM campaign_members WHERE campaign_id = $1 AND user_id = $2', [target.campaign_id, playerId]);
    const room = getLoadedRoom(roomId);
    for (const ws of room?.clients || []) {
        if (String(ws.meta?.playerId) === String(playerId)) ws.close(4003, 'removed');
    }
    await notifyPlayers(roomId);
    res.json({ success: true });
}));

app.get('/api/rooms/:roomId/state', route(async (req, res) => {
    const room = await getRoom(req.params.roomId);
    res.json({ state: room.state, version: room.version });
}));

app.use((_req, res) => res.status(404).json({ error: 'Не найдено' }));

app.use((error, _req, res, _next) => {
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error('Server error:', error);
    res.status(status).json({ error: status >= 500 ? 'Ошибка сервера. Попробуйте ещё раз.' : error.message });
});

/* =========================================================
   WEBSOCKET
========================================================= */

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', err => console.warn('[ws] error:', err.message));

    // Сообщения, пришедшие до окончания проверки доступа, не теряем
    const early = [];
    let handle = raw => early.push(raw);
    ws.on('message', raw => handle(raw));

    const url = new URL(req.url, 'http://localhost');
    const roomId = url.searchParams.get('roomId');
    const playerId = url.searchParams.get('playerId');
    const token = url.searchParams.get('token');

    authenticate(ws, roomId, playerId, token)
        .then(ctx => {
            if (!ctx) return;
            handle = raw => onMessage(ws, ctx, raw);
            early.splice(0).forEach(handle);
        })
        .catch(err => {
            console.error('[ws] connect error:', err);
            ws.close(1011, 'server error');
        });
});

async function authenticate(ws, roomId, playerId, token) {
    if (!roomId || !playerId) { ws.close(4000, 'roomId/playerId required'); return null; }

    const member = await memberInRoom(roomId, playerId);
    if (!member) { ws.close(4001, 'not a room member'); return null; }
    // Старые сессии (до появления токенов) пускаем и выдаём им токен
    if (member.token && member.token !== token) { ws.close(4001, 'bad token'); return null; }
    const issuedToken = member.token ? null : await ensureToken(member);

    if (ws.readyState !== 1) return null; // клиент успел отключиться
    const room = await getRoom(roomId);
    const ctx = { room, playerId: String(member.user_id), role: member.role, name: member.username };
    ws.meta = ctx;
    room.addClient(ws);

    ws.on('close', () => {
        room.removeClient(ws);
        notifyPlayers(roomId);
    });

    room.send(ws, {
        type: 'welcome',
        player: { id: member.user_id, name: member.username, role: member.role },
        token: issuedToken,
        roomEmpty: room.isEmpty()
    });
    room.send(ws, { type: 'map_image', src: room.mapSrc || null });
    for (const canvasType of ['draw', 'fog']) {
        if (room.canvases[canvasType]) room.send(ws, { type: 'canvas_update', canvasType, canvas: room.canvases[canvasType] });
    }
    room.send(ws, room.snapshot({ initial: true }));
    notifyPlayers(roomId);
    return ctx;
}

function onMessage(ws, ctx, raw) {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || typeof message !== 'object') return;
    const { room, playerId, role } = ctx;
    const deny = text => room.send(ws, { type: 'permission_error', message: text });

    switch (message.type) {
        case 'ping':
            room.send(ws, { type: 'pong', version: room.version });
            return;

        // Мастер меняет всё поле боя
        case 'state_update':
            if (role !== 'master') return deny('Только мастер может изменять состояние карты.');
            room.run(() => {
                const base = Number(message.baseVersion);
                const stale = !Number.isFinite(base) || base !== room.version;
                const { merged } = room.applyMasterState(message.state, Number.isFinite(base) ? base : -1);
                const snap = room.snapshot({ from: playerId });
                room.broadcast(snap, ws);
                // Если мастер работал со старой версией — отдаём ему итог слияния
                room.send(ws, stale || merged ? snap : { type: 'ack', version: room.version, seq: message.seq });
            });
            return;

        // Игрок меняет только своих персонажей, их токены и инвентарь
        case 'player_state_update':
            if (role !== 'player') return;
            room.run(() => {
                const base = Number(message.baseVersion);
                const stale = !Number.isFinite(base) || base !== room.version;
                const { remapped } = room.applyPlayerPatch(message.patch || {}, playerId);
                const snap = room.snapshot({ from: playerId });
                room.broadcast(snap, ws);
                room.send(ws, stale || remapped ? snap : { type: 'ack', version: room.version, seq: message.seq });
            });
            return;

        case 'map_image':
            if (role !== 'master') return deny('Загружать карту может только мастер.');
            room.run(() => {
                const src = typeof message.src === 'string' && message.src.startsWith('data:image/') ? message.src : null;
                room.setMap(src);
                room.broadcast({ type: 'map_image', src }, ws);
            });
            return;

        case 'canvas_update':
            if (role !== 'master') return deny('Рисование и туман доступны только мастеру.');
            room.run(() => {
                const canvasType = message.canvasType === 'fog' ? 'fog' : 'draw';
                const canvas = typeof message.canvas === 'string' && message.canvas.startsWith('data:image/') ? message.canvas : null;
                room.setCanvas(canvasType, canvas);
                room.broadcast({ type: 'canvas_update', canvasType, canvas, from: playerId }, ws);
            });
            return;

        case 'dice_roll':
            room.run(() => {
                const r = message.roll && typeof message.roll === 'object' ? message.roll : {};
                const playerName = clean(message.playerName || ctx.name, 80) || 'Игрок';
                room.addDiceRoll({
                    time: Number(r.time) || Date.now(), sides: r.sides, modStr: r.modifierStr || r.modStr || '',
                    total: r.total, isCrit: !!r.isCrit, isFail: !!r.isFail, playerName
                });
                room.broadcast({ type: 'dice_roll', roll: r, from: playerId, playerName, version: room.version }, ws);
                room.send(ws, { type: 'ack', version: room.version });
            });
            return;

        case 'room_event':
            room.broadcast({ type: 'room_event', from: playerId, event: message.event }, ws);
            return;
    }
}

// Сервер сам проверяет, что соединения живы, и закрывает «зависшие»
const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
        if (!ws.isAlive) { ws.terminate(); continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch { /* сокет уже закрыт */ }
    }
}, HEARTBEAT_MS);

/* =========================================================
   START / STOP
========================================================= */

async function start() {
    for (let attempt = 1; ; attempt++) {
        try { await ensureSchema(); break; }
        catch (err) {
            console.error(`[db] schema check failed (attempt ${attempt}):`, err.message);
            if (attempt >= 5) throw err;
            await new Promise(r => setTimeout(r, 3000 * attempt));
        }
    }
    server.listen(PORT, () => console.log(`D&D Toolkit backend: http://localhost:${PORT}`));
}

let stopping = false;
async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: сохраняю комнаты и останавливаюсь…`);
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.close(1012, 'server restart'); // клиенты сами переподключатся
    server.close();
    try { await flushAll(); } catch (err) { console.error('flush on shutdown failed:', err); }
    await pool.end().catch(() => {});
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch(err => {
    console.error('Не удалось запустить сервер:', err);
    process.exit(1);
});

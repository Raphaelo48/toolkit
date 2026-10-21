import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import http from 'http';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// Импорт после dotenv: хранилище читает DATABASE_URL при загрузке
const { store } = await import('./store/index.js');
const { getRoom, getLoadedRoom, flushAll, stateForPlayer } = await import('./rooms.js');
const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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

async function memberByToken(token) { return store.memberByToken(token); }
async function memberInRoom(roomId, userId) { return store.memberInRoom(roomId, userId); }

async function ensureToken(member) {
    if (member.token) return member.token;
    member.token = newToken();
    await store.setToken(member.campaign_id, member.user_id, member.token);
    return member.token;
}

async function playersOf(roomId) {
    const online = getLoadedRoom(roomId)?.onlinePlayerIds() || new Set();
    return (await store.listMembers(roomId)).map(p => ({ ...p, online: online.has(String(p.id)) }));
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

app.get('/api/health', async (_req, res) => {
    try {
        await store.health();
        res.json({ success: true, database: 'connected', storage: store.kind });
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

    const token = newToken();
    const { campaign, room, user } = await store.createCampaign({ name, description, masterName, token, makeCode: newRoomCode });
    res.status(201).json({
        campaign: { id: campaign.id, name: campaign.name, description: campaign.description },
        room: { id: room.id, code: room.room_code, campaign_id: campaign.id },
        player: { id: user.id, name: user.username, role: 'master', token }
    });
}));

// Войти в комнату по коду. Повторный вход с тем же именем возвращает того же игрока.
app.post('/api/rooms/join', route(async (req, res) => {
    const roomCode = clean(req.body?.code, 8).toUpperCase();
    const name = clean(req.body?.playerName, 80);
    const token = clean(req.body?.token, 100);
    if (!roomCode || !name) throw httpError(400, 'Код комнаты и имя обязательны');

    const roomRow = await store.findRoomByCode(roomCode);
    if (!roomRow) throw httpError(404, 'Комната не найдена. Проверьте код.');

    // 1. Уже есть сохранённая сессия этого браузера в этой комнате
    const byToken = await memberByToken(token);
    if (byToken && String(byToken.room_id) === String(roomRow.id)) {
        return res.json(sessionPayload(byToken));
    }

    // 2. Участник с таким именем уже есть
    const existing = await store.memberByName(roomRow.id, name);
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
    const newMemberToken = newToken();
    const user = await store.addPlayer(roomRow.campaign_id, name, newMemberToken);
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

    await store.deleteMember(target.campaign_id, playerId);
    const room = getLoadedRoom(roomId);
    for (const ws of room?.clients || []) {
        if (String(ws.meta?.playerId) === String(playerId)) ws.close(4003, 'removed');
    }
    await notifyPlayers(roomId);
    res.json({ success: true });
}));

app.get('/api/rooms/:roomId/state', route(async (req, res) => {
    // Только для участников комнаты; игрок получает свою (урезанную) версию
    const member = await memberByToken(clean(req.get('X-Player-Token'), 100));
    if (!member || String(member.room_id) !== String(req.params.roomId)) throw httpError(401, 'Нужно войти в комнату');
    const room = await getRoom(req.params.roomId);
    const state = member.role === 'master' ? room.state : stateForPlayer(room.state, member.user_id);
    res.json({ state, version: room.version });
}));

app.get('/api/api.js', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'api', 'api.js')));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Не найдено' }));

// Сам сайт: сервер отдаёт фронтенд, поэтому игра открывается по одному адресу.
// Отдаются только файлы сайта — папки backend/ и data/ наружу не видны.
const staticOpts = { maxAge: 0, etag: true };
app.get('/', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
app.get('/index.html', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
for (const dir of ['css', 'js', 'api', 'assets', 'img', 'images', 'fonts']) {
    app.use(`/${dir}`, express.static(path.join(FRONTEND_DIR, dir), staticOpts));
}
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
    if (member.role === 'master') room.masterId = String(member.user_id);
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
    room.sendWalls(ws);
    room.sendSnapshot(ws, { initial: true });
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
                const { merged } = room.applyMasterState(message.state, Number.isFinite(base) ? base : -1, { replace: message.replace === true });
                room.broadcastSnapshot({ from: playerId }, ws);
                // Если мастер работал со старой версией — отдаём ему итог слияния
                if (stale || merged) room.sendSnapshot(ws, { from: playerId });
                else room.send(ws, { type: 'ack', version: room.version, seq: message.seq });
            });
            return;

        // Игрок меняет только своих персонажей, их токены и инвентарь
        case 'player_state_update':
            if (role !== 'player') return;
            room.run(() => {
                const base = Number(message.baseVersion);
                const stale = !Number.isFinite(base) || base !== room.version;
                const { remapped } = room.applyPlayerPatch(message.patch || {}, playerId);
                room.broadcastSnapshot({ from: playerId }, ws);
                if (stale || remapped) room.sendSnapshot(ws, { from: playerId });
                else room.send(ws, { type: 'ack', version: room.version, seq: message.seq });
            });
            return;

        // Действия с инвентарём: передать, выбросить, подобрать, взять из сундука, деньги
        case 'inventory_action':
            room.run(() => {
                const action = message.action && typeof message.action === 'object' ? message.action : null;
                const res = room.applyInventoryAction(action, { role, playerId, name: ctx.name });
                if (!res.ok) {
                    room.send(ws, { type: 'action_error', message: res.error || 'Действие не выполнено', requestId: message.requestId });
                    room.sendSnapshot(ws, { resync: true }); // вернуть клиенту настоящее состояние
                    return;
                }
                // Всем, включая отправителя: так у всех одинаковые id и порядок
                room.broadcastSnapshot({ from: playerId, requestId: message.requestId });
            });
            return;

        // Бросок инициативы: игрок — один раз за своего персонажа, кубик бросает сервер
        case 'initiative_roll':
            room.run(() => {
                const res = room.rollInitiative(message.tokenId, message.mod, { role, playerId });
                if (!res.ok) {
                    room.send(ws, { type: 'action_error', message: res.error });
                    room.sendSnapshot(ws, { resync: true });
                    return;
                }
                room.broadcastSnapshot({ from: playerId });
                room.broadcast({ type: 'initiative_rolled', entry: res.entry, playerName: ctx.name });
            });
            return;

        // Стены для обзора (мастер распознал по карте или дорисовал)
        case 'vision_walls':
            if (role !== 'master') return deny('Стены задаёт только мастер.');
            room.run(() => {
                if (!room.setWalls(message.walls || null)) return deny('Не удалось сохранить стены');
                for (const client of room.clients) if (client !== ws) room.sendWalls(client);
                room.broadcastSnapshot({ from: playerId });
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
        try { await store.init(); break; }
        catch (err) {
            console.error(`[db] schema check failed (attempt ${attempt}):`, err.message);
            if (attempt >= 5) throw err;
            await new Promise(r => setTimeout(r, 3000 * attempt));
        }
    }
    server.listen(PORT, () => printAddresses());
}

function printAddresses() {
    const lines = [`  На этом компьютере:         http://localhost:${PORT}`];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
        for (const a of list || []) {
            if (a.family !== 'IPv4' || a.internal) continue;
            const label = a.address.startsWith('26.') ? 'Radmin VPN (для друзей)'
                : /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address) ? 'Tailscale (для друзей)'
                : 'Локальная сеть (Wi-Fi/LAN)';
            lines.push(`  ${label.padEnd(27)} http://${a.address}:${PORT}   [${name}]`);
        }
    }
    console.log(`\nD&D Toolkit запущен. Хранилище: ${store.kind === 'files' ? 'файлы в папке data' : 'PostgreSQL'}\n${lines.join('\n')}\n`);
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
    await store.close();
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch(err => {
    console.error('Не удалось запустить сервер:', err);
    process.exit(1);
});

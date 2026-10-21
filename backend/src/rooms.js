// Состояние комнат в памяти сервера.
// Сервер — единственный источник правды: каждое изменение получает номер версии,
// изменения одной комнаты обрабатываются строго по очереди, а в базу состояние
// пишется пакетно (не чаще раза в SAVE_DELAY_MS) и обязательно при остановке.

import { query } from './db.js';

const SAVE_DELAY_MS = 1000;
const UNLOAD_AFTER_MS = 10 * 60 * 1000;
const DICE_HISTORY_LIMIT = 20;
const MAX_PLAYER_CHARACTERS = 3;
// Эти поля персонажа меняет только мастер
const MASTER_ONLY_CHARACTER_FIELDS = ['xp', 'level', 'hpMax'];

const rooms = new Map(); // roomId(string) → Room

class Room {
    constructor(id) {
        this.id = String(id);
        this.state = {};
        this.version = 0;
        this.mapSrc = null;
        this.canvases = { draw: null, fog: null };
        this.clients = new Set();        // ws
        this.playerPatchVersion = new Map(); // playerId → версия последнего изменения игрока
        this.queue = Promise.resolve();
        this.saveTimer = null;
        this.dirty = false;
        this.unloadTimer = null;
    }

    /** Выполнить fn строго после всех предыдущих операций этой комнаты. */
    run(fn) {
        const next = this.queue.then(fn);
        this.queue = next.catch(err => console.error(`[room ${this.id}]`, err));
        return next;
    }

    markDirty() {
        this.dirty = true;
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.run(() => this.flush());
        }, SAVE_DELAY_MS);
    }

    async flush() {
        if (!this.dirty) return;
        this.dirty = false;
        try {
            await query(
                `INSERT INTO room_state (room_id, state, version, map_src, draw_canvas, fog_canvas, updated_at)
                 VALUES ($1, $2::jsonb, $3, $4, $5, $6, NOW())
                 ON CONFLICT (room_id) DO UPDATE SET
                   state = EXCLUDED.state, version = EXCLUDED.version, map_src = EXCLUDED.map_src,
                   draw_canvas = EXCLUDED.draw_canvas, fog_canvas = EXCLUDED.fog_canvas, updated_at = NOW()`,
                [this.id, JSON.stringify(this.state), this.version, this.mapSrc, this.canvases.draw, this.canvases.fog]
            );
        } catch (err) {
            this.dirty = true; // попробуем ещё раз
            console.error(`[room ${this.id}] save failed:`, err.message);
            this.markDirty();
        }
    }

    isEmpty() {
        const s = this.state || {};
        const hasItems = k => Array.isArray(s[k]) && s[k].length > 0;
        return this.version === 0 && !this.mapSrc
            && !hasItems('tokens') && !hasItems('characters') && !hasItems('monsters') && !hasItems('shapes');
    }

    /* ---------- изменения ---------- */

    applyMasterState(incoming, baseVersion) {
        const next = sanitizeState(incoming);
        const current = this.state || {};
        let merged = false;

        // Если мастер не видел свежих изменений игроков — сохраняем их, а не затираем
        for (const [playerId, v] of this.playerPatchVersion) {
            if (v > baseVersion) {
                keepPlayerEntities(next, current, playerId);
                merged = true;
            }
        }
        // История кубиков ведётся сервером
        next.diceHistory = Array.isArray(current.diceHistory) ? current.diceHistory : (next.diceHistory || []);
        next.nextId = Math.max(Number(next.nextId) || 1, Number(current.nextId) || 1, maxId(next) + 1);

        this.state = next;
        this.version++;
        this.markDirty();
        return { merged };
    }

    applyPlayerPatch(patch, playerId) {
        const { state, remapped } = mergePlayerPatch(this.state, patch, playerId);
        this.state = state;
        this.version++;
        this.playerPatchVersion.set(String(playerId), this.version);
        this.markDirty();
        return { remapped };
    }

    addDiceRoll(entry) {
        const history = Array.isArray(this.state.diceHistory) ? this.state.diceHistory : [];
        history.unshift(entry);
        if (history.length > DICE_HISTORY_LIMIT) history.length = DICE_HISTORY_LIMIT;
        this.state.diceHistory = history;
        this.version++;
        this.markDirty();
    }

    setMap(src) {
        this.mapSrc = src || null;
        this.markDirty();
    }

    setCanvas(type, dataUrl) {
        this.canvases[type === 'fog' ? 'fog' : 'draw'] = dataUrl || null;
        this.markDirty();
    }

    /* ---------- клиенты ---------- */

    addClient(ws) {
        this.clients.add(ws);
        if (this.unloadTimer) { clearTimeout(this.unloadTimer); this.unloadTimer = null; }
    }

    removeClient(ws) {
        this.clients.delete(ws);
        if (this.clients.size === 0 && !this.unloadTimer) {
            this.unloadTimer = setTimeout(() => {
                this.run(async () => {
                    await this.flush();
                    if (this.clients.size === 0) rooms.delete(this.id);
                });
            }, UNLOAD_AFTER_MS);
        }
    }

    onlinePlayerIds() {
        return new Set([...this.clients].map(ws => String(ws.meta?.playerId)));
    }

    send(ws, message) {
        if (ws.readyState === 1) ws.send(typeof message === 'string' ? message : JSON.stringify(message));
    }

    broadcast(message, exclude = null) {
        const data = JSON.stringify(message);
        for (const ws of this.clients) if (ws !== exclude) this.send(ws, data);
    }

    snapshot(extra = {}) {
        return { type: 'state_snapshot', state: this.state, version: this.version, ...extra };
    }
}

/* ---------- загрузка ---------- */

const loading = new Map();

export async function getRoom(roomId) {
    const id = String(roomId);
    if (rooms.has(id)) return rooms.get(id);
    if (loading.has(id)) return loading.get(id);

    const promise = (async () => {
        const room = new Room(id);
        const r = await query(
            'SELECT state, version, map_src, draw_canvas, fog_canvas FROM room_state WHERE room_id = $1', [id]
        );
        if (r.rowCount) {
            const row = r.rows[0];
            room.state = row.state || {};
            room.version = Number(row.version) || 0;
            room.mapSrc = row.map_src || null;
            room.canvases = { draw: row.draw_canvas || null, fog: row.fog_canvas || null };
            // Старые версии хранили картинку карты прямо в состоянии — переносим её
            if (room.state?.map?.src) {
                if (!room.mapSrc) room.mapSrc = room.state.map.src;
                delete room.state.map.src;
                room.dirty = true;
            }
            if (room.version === 0 && Object.keys(room.state).length) room.version = 1;
        }
        rooms.set(id, room);
        return room;
    })();
    loading.set(id, promise);
    try { return await promise; } finally { loading.delete(id); }
}

export function getLoadedRoom(roomId) {
    return rooms.get(String(roomId)) || null;
}

export async function flushAll() {
    await Promise.all([...rooms.values()].map(room => room.run(() => room.flush())));
}

/* ---------- слияние ---------- */

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

function sanitizeState(raw) {
    const s = clone(raw && typeof raw === 'object' ? raw : {});
    if (s.map && typeof s.map === 'object') delete s.map.src; // картинка карты передаётся отдельно
    return s;
}

function maxId(state) {
    let max = 0;
    for (const key of ['tokens', 'characters', 'monsters', 'shapes']) {
        for (const item of Array.isArray(state[key]) ? state[key] : []) {
            const n = Number(item?.id);
            if (Number.isFinite(n) && n > max) max = n;
        }
    }
    return max;
}

const isOwnChar = (c, playerId) => String(c?.ownerId) === String(playerId);

/** Перенести в next персонажей игрока, их токены и инвентарь из current. */
function keepPlayerEntities(next, current, playerId) {
    const curChars = Array.isArray(current.characters) ? current.characters : [];
    const curTokens = Array.isArray(current.tokens) ? current.tokens : [];
    const ownChars = curChars.filter(c => isOwnChar(c, playerId));
    const ownCharIds = new Set(ownChars.map(c => String(c.id)));
    const isOwnToken = t => t?.kind === 'character' && ownCharIds.has(String(t.sourceId));
    const ownTokens = curTokens.filter(isOwnToken);

    const nextChars = Array.isArray(next.characters) ? next.characters : [];
    next.characters = [
        ...nextChars.filter(c => !isOwnChar(c, playerId)),
        ...ownChars.map(c => {
            // Поля, которые меняет мастер, берём из версии мастера
            const fromMaster = nextChars.find(x => String(x.id) === String(c.id));
            const result = clone(c);
            if (fromMaster) for (const f of MASTER_ONLY_CHARACTER_FIELDS) if (f in fromMaster) result[f] = fromMaster[f];
            return result;
        })
    ];

    const nextTokens = Array.isArray(next.tokens) ? next.tokens : [];
    next.tokens = [
        ...nextTokens.filter(t => !(t?.kind === 'character' && ownCharIds.has(String(t.sourceId)))),
        ...clone(ownTokens)
    ];

    if (current.inventory && typeof current.inventory === 'object') {
        next.inventory = next.inventory && typeof next.inventory === 'object' ? next.inventory : {};
        for (const t of ownTokens) {
            const key = String(t.id);
            if (key in current.inventory) next.inventory[key] = clone(current.inventory[key]);
        }
    }
}

export function mergePlayerPatch(currentState, patch, playerId) {
    const current = clone(currentState || {});
    const incomingChars = Array.isArray(patch?.characters) ? patch.characters.slice(0, MAX_PLAYER_CHARACTERS) : [];
    const incomingTokens = Array.isArray(patch?.characterTokens) ? patch.characterTokens : [];

    const currentChars = Array.isArray(current.characters) ? current.characters : [];
    const currentTokens = Array.isArray(current.tokens) ? current.tokens : [];
    const ownCurrent = new Map(currentChars.filter(c => isOwnChar(c, playerId)).map(c => [String(c.id), c]));

    let nextId = Math.max(Number(current.nextId) || 1, maxId(current) + 1);
    let remapped = false;
    const allocId = () => { remapped = true; return nextId++; };

    const idMap = new Map();
    const normalizedChars = incomingChars.filter(c => c && typeof c === 'object').map(raw => {
        const c = { ...raw, ownerId: playerId };
        const existing = ownCurrent.get(String(c.id));
        if (existing) {
            for (const f of MASTER_ONLY_CHARACTER_FIELDS) if (f in existing) c[f] = existing[f];
            if (Number(c.hpCur) > Number(c.hpMax)) c.hpCur = c.hpMax;
            idMap.set(String(raw.id), existing.id);
            return c;
        }
        c.id = allocId();
        idMap.set(String(raw.id), c.id);
        return c;
    });

    current.characters = [
        ...currentChars.filter(c => !isOwnChar(c, playerId)),
        ...normalizedChars
    ];

    const ownTokenIds = new Set(
        currentTokens.filter(t => t?.kind === 'character' && ownCurrent.has(String(t.sourceId))).map(t => String(t.id))
    );
    const tokenIdMap = new Map();
    const normalizedTokens = incomingTokens
        .filter(t => t && t.kind === 'character')
        .map(raw => {
            const sourceId = idMap.get(String(raw.sourceId));
            if (sourceId == null) return null;
            const t = { ...raw, sourceId, ownerId: playerId };
            if (!ownTokenIds.has(String(raw.id))) t.id = allocId();
            tokenIdMap.set(String(raw.id), t.id);
            return t;
        })
        .filter(Boolean);

    current.tokens = [
        ...currentTokens.filter(t => !(t?.kind === 'character' && ownTokenIds.has(String(t.id)))),
        ...normalizedTokens
    ];

    // Инвентарь своих токенов
    if (patch?.inventory && typeof patch.inventory === 'object') {
        current.inventory = current.inventory && typeof current.inventory === 'object' ? current.inventory : {};
        for (const [rawKey, items] of Object.entries(patch.inventory)) {
            const key = String(tokenIdMap.get(String(rawKey)) ?? '');
            if (!key || !Array.isArray(items)) continue;
            current.inventory[key] = items.slice(0, 200);
        }
    }

    // Подобранный с карты лут
    if (Array.isArray(patch?.pickedLootTokenIds) && patch.pickedLootTokenIds.length) {
        const picked = new Set(patch.pickedLootTokenIds.map(String));
        current.tokens = current.tokens.filter(t => !(t?.kind === 'loot' && picked.has(String(t.id))));
    }

    current.nextId = nextId;
    return { state: current, remapped };
}

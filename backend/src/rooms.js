// Состояние комнат в памяти сервера.
// Сервер — единственный источник правды: каждое изменение получает номер версии,
// изменения одной комнаты обрабатываются строго по очереди, а в базу состояние
// пишется пакетно (не чаще раза в SAVE_DELAY_MS) и обязательно при остановке.

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { store } from './store/index.js';

// Общие с браузером модули (js/shared): правила инвентаря и расчёт обзора
function loadShared(name) {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'js', 'shared', name);
    const sandbox = { module: { exports: {} }, btoa, atob, Math, Uint8Array, Uint32Array, String };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
    return sandbox.module.exports;
}
const Inv = loadShared('inventory-core.js');
const Vision = loadShared('vision-core.js');
const MAX_VISION_CELLS = 2_000_000;
const DEFAULT_VISION_RADIUS = 12; // в клетках сетки

const SAVE_DELAY_MS = 1000;
const UNLOAD_AFTER_MS = 10 * 60 * 1000;
const DICE_HISTORY_LIMIT = 20;
const MAX_PLAYER_CHARACTERS = 3;    // сколько персонажей игрок может создать
const MAX_PLAYER_TOKENS_ON_MAP = 1; // сколько из них может стоять на поле одновременно
// Эти фишки игроки вообще не получают: тайное для мастера
const GM_ONLY_TOKEN_KINDS = new Set(['hidden', 'trap']);
// Эти поля персонажа меняет только мастер
const MASTER_ONLY_CHARACTER_FIELDS = ['xp', 'level', 'hpMax', 'visionRadius'];
// Эти поля меняются только действиями инвентаря на сервере — никакой снимок их не перезапишет
const SERVER_OWNED_CHARACTER_FIELDS = ['inventory', 'coins'];
const SERVER_OWNED_TOKEN_FIELDS = ['inventory', 'coins', 'contents', 'item', 'qty'];
const ACTION_HISTORY_LIMIT = 300;

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
        this.actionHistory = [];              // { version, addedTokens, removedTokenIds, logEntry } — для слияния со старыми снимками
        this.masterId = null;
        this.walls = null;                    // { w, h, cell, data, mask } — стены для обзора
        this.explored = new Map();            // группа обзора → Uint8Array «уже видели»
        this.vision = null;                   // последний расчёт: группа → { visible, explored }
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
            const memory = {};
            if (this.walls) for (const [key, mask] of this.explored) memory[key] = Vision.packBits(mask);
            await store.saveRoomState(this.id, {
                state: { ...this.state, _visionMemory: this.walls ? { w: this.walls.w, h: this.walls.h, groups: memory } : undefined },
                version: this.version, map_src: this.mapSrc,
                draw_canvas: this.canvases.draw, fog_canvas: this.canvases.fog,
                vision_walls: this.walls ? JSON.stringify({ w: this.walls.w, h: this.walls.h, cell: this.walls.cell, data: this.walls.data }) : null
            });
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

    applyMasterState(incoming, baseVersion, { replace = false } = {}) {
        const next = sanitizeState(incoming);
        const current = this.state || {};
        let merged = false;
        Inv.migrate(next);

        if (replace) {
            // Мастер загрузил сохранение — оно заменяет всё, включая инвентари
            next.diceHistory = Array.isArray(current.diceHistory) ? current.diceHistory : (next.diceHistory || []);
            next.nextId = Math.max(Number(next.nextId) || 1, maxId(next) + 1);
            this.state = next;
            this.version++;
            this.actionHistory = [];
            this.playerPatchVersion.clear();
            this.markDirty();
            return { merged: true };
        }

        // Если мастер не видел свежих изменений игроков — сохраняем их, а не затираем
        for (const [playerId, v] of this.playerPatchVersion) {
            if (v > baseVersion) {
                keepPlayerEntities(next, current, playerId);
                merged = true;
            }
        }
        // Инвентари, деньги и сундуки — только с сервера
        if (keepServerOwned(next, current)) merged = true;
        // Действия, которых мастер ещё не видел, повторяем поверх его снимка
        if (replayActions(next, this.actionHistory.filter(a => a.version > baseVersion))) merged = true;
        // История кубиков ведётся сервером
        next.diceHistory = Array.isArray(current.diceHistory) ? current.diceHistory : (next.diceHistory || []);
        next.nextId = Math.max(Number(next.nextId) || 1, Number(current.nextId) || 1, maxId(next) + 1);

        this.state = next;
        this.version++;
        this.markDirty();
        return { merged };
    }

    applyPlayerPatch(patch, playerId) {
        const { state, remapped } = mergePlayerPatch(this.state, patch, playerId, this.moveLimiter());
        this.state = state;
        this.version++;
        this.playerPatchVersion.set(String(playerId), this.version);
        this.markDirty();
        return { remapped };
    }

    /** Действие с инвентарём. Выполняется строго по очереди и сразу становится окончательным. */
    applyInventoryAction(action, actor) {
        const res = Inv.apply(this.state, action, actor, {
            allocId: () => {
                const id = Math.max(Number(this.state.nextId) || 1, maxId(this.state) + 1);
                this.state.nextId = id + 1;
                return id;
            }
        });
        if (!res.ok) return res;
        this.version++;
        this.actionHistory.push({
            version: this.version,
            addedTokens: clone(res.addedTokens),
            removedTokenIds: res.removedTokenIds.map(String),
            logEntry: res.logEntry || null
        });
        if (this.actionHistory.length > ACTION_HISTORY_LIMIT) this.actionHistory.splice(0, this.actionHistory.length - ACTION_HISTORY_LIMIT);
        this.markDirty();
        return res;
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

    /* ---------- обзор (туман войны по линии видимости) ---------- */

    setWalls(payload) {
        if (!payload) { this.walls = null; this.explored.clear(); this.vision = null; this.markDirty(); return true; }
        const w = Math.trunc(payload.w), h = Math.trunc(payload.h), cell = Number(payload.cell);
        if (!(w > 0 && h > 0 && w * h <= MAX_VISION_CELLS && cell >= 2 && cell <= 128) || typeof payload.data !== 'string') return false;
        const mask = Vision.unpackBits(payload.data, w * h);
        if (!this.walls || this.walls.w !== w || this.walls.h !== h) this.explored.clear(); // другая карта — память обнуляется
        this.walls = { w, h, cell, data: payload.data, mask };
        this.markDirty();
        return true;
    }

    /** Проверка хода фишки игрока: сквозь стены и закрытые двери нельзя. null — ограничений нет. */
    moveLimiter() {
        const v = this.state.vision && typeof this.state.vision === 'object' ? this.state.vision : {};
        if (!this.walls || v.collide === false) return null;
        const { w, h, cell, mask } = this.walls;
        const blocking = Vision.blockingMask(mask, w, h, Array.isArray(v.doors) ? v.doors : []);
        return (from, to) => Vision.limitMove(blocking, w, h, cell, Number(from.x) || 0, Number(from.y) || 0, Number(to.x) || 0, Number(to.y) || 0);
    }

    visionSettings() {
        const v = this.state.vision && typeof this.state.vision === 'object' ? this.state.vision : {};
        return {
            enabled: !!v.enabled && !!this.walls,
            shared: v.shared !== false,
            radius: Number(v.radius) > 0 ? Number(v.radius) : DEFAULT_VISION_RADIUS,
            doors: Array.isArray(v.doors) ? v.doors : [],
            resetAt: Number(v.resetAt) || 0
        };
    }

    /** Персонажи игроков (не мастера) — их фишки «смотрят» и всегда видны группе. */
    partyCharacters() {
        return (this.state.characters || []).filter(c => c && c.ownerId != null && String(c.ownerId) !== String(this.masterId));
    }

    groupKey(playerId) {
        return this.visionSettings().shared ? 'party' : `p:${playerId}`;
    }

    /** Пересчитать, что видит каждая группа. Вызывается перед рассылкой состояния. */
    updateVision() {
        const settings = this.visionSettings();
        if (!settings.enabled) { this.vision = null; return; }
        if (settings.resetAt && settings.resetAt !== this.lastResetAt) {
            this.lastResetAt = settings.resetAt;
            this.explored.clear(); // мастер начал новое исследование
        }
        const { w, h, cell, mask } = this.walls;
        const blocking = Vision.blockingMask(mask, w, h, settings.doors);
        const gridPx = Number(this.state.grid?.size) || 50;
        const chars = new Map(this.partyCharacters().map(c => [String(c.id), c]));
        const groups = new Map();
        if (settings.shared) groups.set('party', []);
        for (const c of chars.values()) if (!settings.shared) groups.set(`p:${c.ownerId}`, groups.get(`p:${c.ownerId}`) || []);
        for (const t of this.state.tokens || []) {
            const c = t?.kind === 'character' ? chars.get(String(t.sourceId)) : null;
            if (!c) continue;
            const key = settings.shared ? 'party' : `p:${c.ownerId}`;
            const r = (Number(c.visionRadius) > 0 ? Number(c.visionRadius) : settings.radius) * gridPx;
            groups.get(key).push({ x: Number(t.x) || 0, y: Number(t.y) || 0, r });
        }
        this.vision = new Map();
        for (const [key, sources] of groups) {
            const visible = Vision.computeVisible(blocking, w, h, cell, sources);
            let explored = this.explored.get(key);
            if (!explored || explored.length !== w * h) { explored = new Uint8Array(w * h); this.explored.set(key, explored); }
            let grew = false;
            for (let i = 0; i < visible.length; i++) if (visible[i] && !explored[i]) { explored[i] = 1; grew = true; }
            if (grew) this.markDirty();
            this.vision.set(key, { visible, explored });
        }
    }

    /** Маски для участника: игроку — его группы, мастеру — объединение (чтобы видеть, что видят игроки). */
    visionFor(ws) {
        if (!this.vision) return null;
        if (ws.meta?.role !== 'master') return this.vision.get(this.groupKey(ws.meta?.playerId)) || this.emptyVision();
        const n = this.walls.w * this.walls.h;
        const visible = new Uint8Array(n), explored = new Uint8Array(n);
        for (const v of this.vision.values()) for (let i = 0; i < n; i++) { visible[i] |= v.visible[i]; explored[i] |= v.explored[i]; }
        return { visible, explored };
    }

    emptyVision() {
        const n = this.walls.w * this.walls.h;
        const explored = this.explored.get(this.groupKey(null)) || new Uint8Array(n);
        return { visible: new Uint8Array(n), explored };
    }

    sendVision(ws) {
        const v = this.visionFor(ws);
        const msg = v
            ? JSON.stringify({ type: 'vision', w: this.walls.w, h: this.walls.h, cell: this.walls.cell,
                visible: Vision.rleEncode(v.visible), explored: Vision.rleEncode(v.explored) })
            : JSON.stringify({ type: 'vision', off: true });
        if (ws.lastVisionMsg === msg) return;
        ws.lastVisionMsg = msg;
        this.send(ws, msg);
    }

    sendWalls(ws) {
        this.send(ws, this.walls
            ? { type: 'vision_walls', w: this.walls.w, h: this.walls.h, cell: this.walls.cell, data: this.walls.data }
            : { type: 'vision_walls', none: true });
    }

    snapshot(extra = {}) {
        return { type: 'state_snapshot', state: this.state, version: this.version, ...extra };
    }

    /** Снимок для конкретного участника: игрок не получает тайного (заметки мастера, хиты врагов, ловушки…). */
    snapshotFor(ws, extra = {}) {
        const meta = ws.meta || {};
        let state = this.state;
        if (meta.role !== 'master') {
            const v = this.vision ? this.visionFor(ws) : null;
            state = stateForPlayer(this.state, meta.playerId, v && {
                visible: v.visible, w: this.walls.w, h: this.walls.h, cell: this.walls.cell,
                partyCharIds: new Set(this.partyCharacters().map(c => String(c.id)))
            });
        }
        return { type: 'state_snapshot', state, version: this.version, ...extra };
    }

    sendSnapshot(ws, extra = {}) {
        this.updateVision();
        this.send(ws, this.snapshotFor(ws, extra));
        this.sendVision(ws);
    }

    /**
     * Разослать снимок всем (каждому — свою версию). exclude — отправитель изменения: ему снимок не нужен,
     * но при включённом обзоре игроку он всё равно уходит — могли появиться/исчезнуть видимые фишки.
     */
    broadcastSnapshot(extra = {}, exclude = null) {
        this.updateVision();
        const cache = new Map();
        for (const ws of this.clients) {
            const skip = ws === exclude && !(this.vision && ws.meta?.role !== 'master');
            if (!skip) {
                const key = ws.meta?.role === 'master' ? 'master' : `p:${ws.meta?.playerId}`;
                if (!cache.has(key)) cache.set(key, JSON.stringify(this.snapshotFor(ws, extra)));
                this.send(ws, cache.get(key));
            }
            this.sendVision(ws);
        }
    }

    /** Игрок бросает инициативу за своего персонажа — один раз. Мастер может за кого угодно. */
    rollInitiative(tokenId, mod, actor) {
        const tokens = Array.isArray(this.state.tokens) ? this.state.tokens : [];
        const token = tokens.find(t => String(t.id) === String(tokenId));
        if (!token) return { ok: false, error: 'Фишка не найдена' };
        if (actor.role !== 'master') {
            const ch = (this.state.characters || []).find(c => String(c.id) === String(token.sourceId));
            if (token.kind !== 'character' || !ch || !isOwnChar(ch, actor.playerId)) {
                return { ok: false, error: 'Бросать инициативу можно только за своего персонажа' };
            }
        }
        const list = Array.isArray(this.state.initiative) ? this.state.initiative : (this.state.initiative = []);
        if (list.some(i => String(i.tokenId) === String(token.id))) {
            return { ok: false, error: 'Инициатива уже брошена. Изменить её может только мастер.' };
        }
        const modifier = Math.max(-5, Math.min(10, Math.trunc(Number(mod)) || 0));
        const die = 1 + Math.floor(Math.random() * 20);
        const id = Math.max(Number(this.state.nextId) || 1, maxId(this.state) + 1, ...list.map(i => Number(i.id) + 1 || 0));
        this.state.nextId = id + 1;
        const entry = {
            id, name: token.name, value: die + modifier, roll: die, mod: modifier,
            tokenId: token.id, sourceId: token.sourceId, sourceKind: token.kind,
            image: token.image || null, emoji: token.emoji, color: token.color
        };
        const initIndex = insertInitiative(this.state, entry);
        const sign = modifier ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : '';
        const logEntry = {
            id: Date.now() + Math.random(), type: 'combat', data: null, timestamp: Date.now(),
            message: `⚡ Инициатива «${token.name}»: ${entry.value} (d20 ${die}${sign})`
        };
        this.state.eventLog = Array.isArray(this.state.eventLog) ? this.state.eventLog : [];
        this.state.eventLog.unshift(logEntry);
        if (this.state.eventLog.length > 500) this.state.eventLog.length = 500;
        this.version++;
        this.actionHistory.push({ version: this.version, addedTokens: [], removedTokenIds: [], logEntry, initAdded: clone(entry) });
        this.markDirty();
        return { ok: true, entry, initIndex };
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
        const row = await store.loadRoomState(id);
        if (row) {
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
            if (row.vision_walls) {
                try { room.setWalls(JSON.parse(row.vision_walls)); room.dirty = false; } catch (err) { console.warn(`[room ${id}] walls:`, err.message); }
            }
            const memory = room.state._visionMemory;
            delete room.state._visionMemory;
            if (memory && room.walls && memory.w === room.walls.w && memory.h === room.walls.h) {
                for (const [key, data] of Object.entries(memory.groups || {})) room.explored.set(key, Vision.unpackBits(data, memory.w * memory.h));
            }
            // Старый формат инвентаря (по фишкам) → вещи у персонажей
            if (Inv.migrate(room.state)) room.dirty = true;
        }
        try {
            const master = (await store.listMembers(id)).find(m => m.role === 'master');
            if (master) room.masterId = String(master.id);
        } catch { /* не критично */ }
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

function copyFields(target, source, fields) {
    for (const f of fields) {
        if (source && f in source) target[f] = clone(source[f]);
        else delete target[f];
    }
}

/**
 * Вернуть в снимок мастера то, что хранит только сервер: вещи и деньги персонажей и фишек,
 * содержимое сундуков, общий склад. Вещи удалённых мастером персонажей переезжают на склад.
 */
function keepServerOwned(next, current) {
    let changed = false;
    const curChars = new Map((current.characters || []).map(c => [String(c.id), c]));
    const curTokens = new Map((current.tokens || []).map(t => [String(t.id), t]));
    const nextChars = Array.isArray(next.characters) ? next.characters : [];
    const nextTokens = Array.isArray(next.tokens) ? next.tokens : [];

    for (const c of nextChars) {
        const cur = curChars.get(String(c.id));
        if (cur) copyFields(c, cur, SERVER_OWNED_CHARACTER_FIELDS);
    }
    for (const t of nextTokens) {
        const cur = curTokens.get(String(t.id));
        if (cur) copyFields(t, cur, SERVER_OWNED_TOKEN_FIELDS);
    }
    next.party = clone(current.party) || next.party || {};
    Inv.ensureParty(next);

    const nextCharIds = new Set(nextChars.map(c => String(c.id)));
    for (const [id, c] of curChars) {
        if (!nextCharIds.has(id) && moveToParty(next, c)) changed = true;
    }
    return changed;
}

function moveToParty(state, holder) {
    const party = Inv.ensureParty(state);
    let moved = false;
    for (const item of Array.isArray(holder.inventory) ? holder.inventory : []) {
        const existing = item.custom ? null : party.inventory.find(e => e.id === item.id && !e.custom);
        if (existing) existing.qty += Number(item.qty) || 1; else party.inventory.push(clone(item));
        moved = true;
    }
    const coins = Inv.normCoins(holder.coins);
    for (const k of Inv.COIN_KEYS) if (coins[k]) { party.coins[k] += coins[k]; moved = true; }
    return moved;
}

/** Вставить участника в список инициативы по убыванию, не сбивая текущий ход. */
function insertInitiative(state, entry) {
    const list = Array.isArray(state.initiative) ? state.initiative : (state.initiative = []);
    const sorted = list.every((x, i) => i === 0 || Number(list[i - 1].value) >= Number(x.value));
    let pos = list.length;
    if (sorted) {
        pos = list.findIndex(x => Number(x.value) < Number(entry.value));
        if (pos < 0) pos = list.length;
    }
    list.splice(pos, 0, entry);
    const idx = Number(state.initIndex) || 0;
    if (list.length > 1 && pos <= idx) state.initIndex = idx + 1;
    return state.initIndex;
}

/**
 * Версия состояния для игрока. Убираем то, что игроку знать не положено:
 * ловушки и скрытые зоны, заметки мастера, хиты/КД и вещи чужих существ,
 * бестиарий мастера, вещи других персонажей, тайные записи журнала.
 */
export function stateForPlayer(state, playerId, vision = null) {
    const s = { ...state };
    const chars = Array.isArray(state.characters) ? state.characters : [];
    const ownCharIds = new Set(chars.filter(c => isOwnChar(c, playerId)).map(c => String(c.id)));
    const anyCharIds = new Set(chars.map(c => String(c.id)));
    // При включённом обзоре игрок получает только те фишки, которые его группа видит сейчас (и союзников)
    const seen = t => !vision
        || (t.kind === 'character' && vision.partyCharIds.has(String(t.sourceId)))
        || Vision.isPointVisible(vision.visible, vision.w, vision.h, vision.cell, Number(t.x) || 0, Number(t.y) || 0, vision.cell);

    s.tokens = (Array.isArray(state.tokens) ? state.tokens : [])
        .filter(t => t && !GM_ONLY_TOKEN_KINDS.has(t.kind) && seen(t))
        .map(t => {
            if (t.kind === 'character' && ownCharIds.has(String(t.sourceId))) return t;
            const c = { ...t };
            delete c.notes; delete c.inventory; delete c.coins;
            // Хиты союзников (персонажей других игроков) видны, хиты врагов и NPC — нет
            if (!(t.kind === 'character' && anyCharIds.has(String(t.sourceId)))) {
                delete c.hpCur; delete c.hpMax; delete c.ac; delete c.dex;
            }
            return c;
        });
    s.characters = chars.map(c => {
        if (isOwnChar(c, playerId)) return c;
        const copy = { ...c };
        delete copy.inventory; delete copy.coins; delete copy.notes;
        return copy;
    });
    s.monsters = [];
    if (vision) {
        // Инициатива: тех, кого не видно, игрок видит без имени
        const visibleIds = new Set(s.tokens.map(t => String(t.id)));
        s.initiative = (Array.isArray(state.initiative) ? state.initiative : []).map(i =>
            visibleIds.has(String(i.tokenId)) ? i : { id: i.id, value: i.value, tokenId: null, name: '???', emoji: '❔', sourceKind: 'hidden' });
    }
    s.initiative = (Array.isArray(s.initiative) ? s.initiative : []).map(i => {
        const isChar = i.sourceKind === 'character' && anyCharIds.has(String(i.sourceId));
        if (isChar) return i;
        const copy = { ...i };
        delete copy.hpCur; delete copy.hpMax;
        return copy;
    });
    s.eventLog = (Array.isArray(state.eventLog) ? state.eventLog : []).filter(e => !(e && e.data && e.data.gm));
    return s;
}

/** Повторить результат действий (появившиеся/исчезнувшие фишки, записи журнала) поверх старого снимка. */
function replayActions(next, actions) {
    if (!actions.length) return false;
    next.tokens = Array.isArray(next.tokens) ? next.tokens : [];
    next.eventLog = Array.isArray(next.eventLog) ? next.eventLog : [];
    for (const a of actions) {
        for (const t of a.addedTokens) {
            if (!next.tokens.some(x => String(x.id) === String(t.id))) next.tokens.push(clone(t));
        }
        if (a.removedTokenIds.length) {
            const removed = new Set(a.removedTokenIds);
            next.tokens = next.tokens.filter(t => !removed.has(String(t.id)));
        }
        if (a.logEntry && !next.eventLog.some(e => e && e.id === a.logEntry.id)) next.eventLog.push(clone(a.logEntry));
        if (a.initAdded) {
            next.initiative = Array.isArray(next.initiative) ? next.initiative : [];
            const tokenStillThere = next.tokens.some(t => String(t.id) === String(a.initAdded.tokenId));
            if (tokenStillThere && !next.initiative.some(i => String(i.tokenId) === String(a.initAdded.tokenId))) {
                insertInitiative(next, clone(a.initAdded));
            }
        }
    }
    next.eventLog.sort((x, y) => (Number(y?.timestamp) || 0) - (Number(x?.timestamp) || 0));
    if (next.eventLog.length > 500) next.eventLog.length = 500;
    return true;
}

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
            if (fromMaster) {
                for (const f of MASTER_ONLY_CHARACTER_FIELDS) if (f in fromMaster) result[f] = fromMaster[f];
                // Мастер изменил HP позже, чем игрок, — берём HP мастера
                if ((Number(fromMaster.hpRev) || 0) > (Number(c.hpRev) || 0)) { result.hpCur = fromMaster.hpCur; result.hpRev = fromMaster.hpRev; }
            }
            return result;
        })
    ];

    const nextTokens = Array.isArray(next.tokens) ? next.tokens : [];
    const hpOf = new Map(next.characters.filter(c => isOwnChar(c, playerId)).map(c => [String(c.id), c.hpCur]));
    next.tokens = [
        ...nextTokens.filter(t => !(t?.kind === 'character' && ownCharIds.has(String(t.sourceId)))),
        ...clone(ownTokens).map(t => (hpOf.get(String(t.sourceId)) != null ? { ...t, hpCur: hpOf.get(String(t.sourceId)) } : t))
    ];

}

export function mergePlayerPatch(currentState, patch, playerId, limitMove = null) {
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
            copyFields(c, existing, SERVER_OWNED_CHARACTER_FIELDS);
            // Игрок прислал более старое HP (мастер успел ударить) — оставляем свежее
            if ((Number(c.hpRev) || 0) < (Number(existing.hpRev) || 0)) { c.hpCur = existing.hpCur; c.hpRev = existing.hpRev; }
            if (Number(c.hpCur) > Number(c.hpMax)) c.hpCur = c.hpMax;
            idMap.set(String(raw.id), existing.id);
            return c;
        }
        c.id = allocId();
        // Новый персонаж начинает с пустыми карманами: вещи выдаются только действиями
        c.inventory = [];
        c.coins = Inv.normCoins(null);
        idMap.set(String(raw.id), c.id);
        return c;
    });

    // Игрок удалил своего персонажа — его вещи не пропадают, а уходят на общий склад
    const keptIds = new Set(normalizedChars.map(c => String(c.id)));
    for (const [id, c] of ownCurrent) if (!keptIds.has(id)) moveToParty(current, c);

    current.characters = [
        ...currentChars.filter(c => !isOwnChar(c, playerId)),
        ...normalizedChars
    ];

    const ownTokenIds = new Set(
        currentTokens.filter(t => t?.kind === 'character' && ownCurrent.has(String(t.sourceId))).map(t => String(t.id))
    );
    const normalizedTokens = incomingTokens
        .filter(t => t && t.kind === 'character')
        .map(raw => {
            const sourceId = idMap.get(String(raw.sourceId));
            if (sourceId == null) return null;
            const t = { ...raw, sourceId, ownerId: playerId };
            const owner = normalizedChars.find(ch => String(ch.id) === String(sourceId));
            if (owner && owner.hpCur != null) t.hpCur = owner.hpCur; // фишка показывает HP персонажа
            for (const f of SERVER_OWNED_TOKEN_FIELDS) delete t[f];
            // Ход сквозь стену или закрытую дверь — фишка останавливается у препятствия
            const prev = limitMove && ownTokenIds.has(String(raw.id)) ? currentTokens.find(x => String(x.id) === String(raw.id)) : null;
            if (prev && (prev.x !== t.x || prev.y !== t.y)) {
                const res = limitMove(prev, t);
                if (res.blocked) { t.x = res.x; t.y = res.y; remapped = true; }
            }
            if (!ownTokenIds.has(String(raw.id))) t.id = allocId();
            return t;
        })
        .filter(Boolean);

    // На поле — не больше одного своего персонажа (уже стоявшая фишка в приоритете)
    normalizedTokens.sort((a, b) => Number(ownTokenIds.has(String(b.id))) - Number(ownTokenIds.has(String(a.id))));
    const allowedTokens = normalizedTokens.slice(0, MAX_PLAYER_TOKENS_ON_MAP);
    if (allowedTokens.length < normalizedTokens.length) remapped = true; // пусть клиент получит правильное состояние

    current.tokens = [
        ...currentTokens.filter(t => !(t?.kind === 'character' && ownTokenIds.has(String(t.id)))),
        ...allowedTokens
    ];

    current.nextId = nextId;
    return { state: current, remapped };
}

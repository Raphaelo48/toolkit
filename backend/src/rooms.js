// Состояние комнат в памяти сервера.
// Сервер — единственный источник правды: каждое изменение получает номер версии,
// изменения одной комнаты обрабатываются строго по очереди, а в базу состояние
// пишется пакетно (не чаще раза в SAVE_DELAY_MS) и обязательно при остановке.

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { store } from './store/index.js';

// Правила инвентаря — общий файл с браузером (js/shared/inventory-core.js)
const Inv = (() => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'js', 'shared', 'inventory-core.js');
    const sandbox = { module: { exports: {} } };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
    return sandbox.module.exports;
})();

const SAVE_DELAY_MS = 1000;
const UNLOAD_AFTER_MS = 10 * 60 * 1000;
const DICE_HISTORY_LIMIT = 20;
const MAX_PLAYER_CHARACTERS = 3;
// Эти поля персонажа меняет только мастер
const MASTER_ONLY_CHARACTER_FIELDS = ['xp', 'level', 'hpMax'];
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
            await store.saveRoomState(this.id, {
                state: this.state, version: this.version, map_src: this.mapSrc,
                draw_canvas: this.canvases.draw, fog_canvas: this.canvases.fog
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
        const { state, remapped } = mergePlayerPatch(this.state, patch, playerId);
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
            // Старый формат инвентаря (по фишкам) → вещи у персонажей
            if (Inv.migrate(room.state)) room.dirty = true;
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
            if (fromMaster) for (const f of MASTER_ONLY_CHARACTER_FIELDS) if (f in fromMaster) result[f] = fromMaster[f];
            return result;
        })
    ];

    const nextTokens = Array.isArray(next.tokens) ? next.tokens : [];
    next.tokens = [
        ...nextTokens.filter(t => !(t?.kind === 'character' && ownCharIds.has(String(t.sourceId)))),
        ...clone(ownTokens)
    ];

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
            copyFields(c, existing, SERVER_OWNED_CHARACTER_FIELDS);
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
            for (const f of SERVER_OWNED_TOKEN_FIELDS) delete t[f];
            if (!ownTokenIds.has(String(raw.id))) t.id = allocId();
            return t;
        })
        .filter(Boolean);

    current.tokens = [
        ...currentTokens.filter(t => !(t?.kind === 'character' && ownTokenIds.has(String(t.id)))),
        ...normalizedTokens
    ];

    current.nextId = nextId;
    return { state: current, remapped };
}

// Хранилище в обычных файлах на диске — для запуска игры на компьютере мастера.
// Ничего устанавливать не нужно; все кампании лежат в папке data/ (её можно копировать как резервную копию).
//
// data/meta.json             — кампании, комнаты, участники
// data/rooms/<id>/state.json — состояние поля боя
// data/rooms/<id>/map.txt, draw.txt, fog.txt — картинка карты, рисунки и туман (data URL)
import fs from 'fs/promises';
import path from 'path';

export function createFileStore(dataDir) {
    const metaPath = path.join(dataDir, 'meta.json');
    let meta = null;
    let metaWrite = Promise.resolve();
    const lastSaved = new Map(); // roomId → { map, draw, fog } — не переписывать большие файлы без изменений

    const now = () => new Date().toISOString();
    const roomDir = id => path.join(dataDir, 'rooms', String(id));

    function nextId(kind) {
        meta.nextIds[kind] = (meta.nextIds[kind] || 0) + 1;
        return String(meta.nextIds[kind]);
    }

    // Запись по очереди и через временный файл: при сбое старый файл остаётся целым
    function saveMeta() {
        const data = JSON.stringify(meta, null, 1);
        metaWrite = metaWrite.then(() => writeAtomic(metaPath, data)).catch(err => console.error('[store] meta save failed:', err.message));
        return metaWrite;
    }

    function memberRow(m) {
        const campaign = meta.campaigns[m.campaign_id];
        const room = Object.values(meta.rooms).find(r => r.campaign_id === m.campaign_id);
        const user = meta.users[m.user_id];
        if (!campaign || !room || !user) return null;
        return {
            user_id: m.user_id, role: m.role, token: m.token, username: user.username,
            room_id: room.id, room_code: room.room_code, campaign_id: campaign.id,
            campaign_name: campaign.name, campaign_description: campaign.description
        };
    }

    const roomById = id => meta.rooms[String(id)] || null;

    return {
        kind: 'files',

        async init() {
            await fs.mkdir(path.join(dataDir, 'rooms'), { recursive: true });
            try {
                meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    // Файл повреждён — сохраняем копию и начинаем с чистого листа, а не падаем
                    const backup = `${metaPath}.broken-${Date.now()}`;
                    await fs.copyFile(metaPath, backup).catch(() => {});
                    console.error(`[store] meta.json повреждён, копия: ${backup}`);
                }
                meta = null;
            }
            meta = Object.assign({ nextIds: {}, users: {}, campaigns: {}, rooms: {}, members: [] }, meta || {});
            await saveMeta();
        },

        async health() {},

        async close() { await metaWrite; },

        async createCampaign({ name, description, masterName, token, makeCode }) {
            const user = { id: nextId('user'), username: masterName, created_at: now() };
            const campaign = { id: nextId('campaign'), name, description, master_user_id: user.id, created_at: now() };
            const codes = new Set(Object.values(meta.rooms).map(r => r.room_code));
            let code = makeCode();
            while (codes.has(code)) code = makeCode();
            const room = { id: nextId('room'), campaign_id: campaign.id, room_code: code, created_at: now() };
            meta.users[user.id] = user;
            meta.campaigns[campaign.id] = campaign;
            meta.rooms[room.id] = room;
            meta.members.push({ campaign_id: campaign.id, user_id: user.id, role: 'master', token, joined_at: now() });
            await saveMeta();
            return {
                campaign: { id: campaign.id, name, description },
                room: { id: room.id, room_code: room.room_code },
                user: { id: user.id, username: user.username }
            };
        },

        async findRoomByCode(code) {
            const room = Object.values(meta.rooms).find(r => r.room_code === code);
            if (!room) return null;
            const c = meta.campaigns[room.campaign_id];
            return { id: room.id, room_code: room.room_code, campaign_id: room.campaign_id, campaign_name: c?.name, campaign_description: c?.description };
        },

        async memberByToken(token) {
            if (!token) return null;
            const m = meta.members.find(x => x.token === token);
            return m ? memberRow(m) : null;
        },

        async memberInRoom(roomId, userId) {
            const room = roomById(roomId);
            if (!room) return null;
            const m = meta.members.find(x => x.campaign_id === room.campaign_id && x.user_id === String(userId));
            return m ? memberRow(m) : null;
        },

        async memberByName(roomId, name) {
            const room = roomById(roomId);
            if (!room) return null;
            const lower = String(name).toLowerCase();
            const m = meta.members
                .filter(x => x.campaign_id === room.campaign_id)
                .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
                .find(x => meta.users[x.user_id]?.username.toLowerCase() === lower);
            return m ? memberRow(m) : null;
        },

        async setToken(campaignId, userId, token) {
            const m = meta.members.find(x => x.campaign_id === String(campaignId) && x.user_id === String(userId));
            if (m) { m.token = token; await saveMeta(); }
        },

        async addPlayer(campaignId, name, token) {
            const user = { id: nextId('user'), username: name, created_at: now() };
            meta.users[user.id] = user;
            meta.members.push({ campaign_id: String(campaignId), user_id: user.id, role: 'player', token, joined_at: now() });
            await saveMeta();
            return { id: user.id, username: user.username };
        },

        async deleteMember(campaignId, userId) {
            meta.members = meta.members.filter(x => !(x.campaign_id === String(campaignId) && x.user_id === String(userId)));
            await saveMeta();
        },

        async listMembers(roomId) {
            const room = roomById(roomId);
            if (!room) return [];
            return meta.members
                .filter(x => x.campaign_id === room.campaign_id)
                .sort((a, b) => (b.role === 'master') - (a.role === 'master') || a.joined_at.localeCompare(b.joined_at))
                .map(x => ({ id: x.user_id, name: meta.users[x.user_id]?.username || '?', role: x.role, joined_at: x.joined_at }));
        },

        async loadRoomState(roomId) {
            if (!roomById(roomId)) return null;
            const dir = roomDir(roomId);
            const read = async (file, json) => {
                try {
                    const text = await fs.readFile(path.join(dir, file), 'utf8');
                    return json ? JSON.parse(text) : (text || null);
                } catch { return null; }
            };
            const saved = await read('state.json', true);
            if (!saved) return null;
            const result = {
                state: saved.state || {}, version: saved.version || 0,
                map_src: await read('map.txt'), draw_canvas: await read('draw.txt'), fog_canvas: await read('fog.txt'),
                vision_walls: await read('walls.txt')
            };
            lastSaved.set(String(roomId), { map: result.map_src, draw: result.draw_canvas, fog: result.fog_canvas, walls: result.vision_walls });
            return result;
        },

        async saveRoomState(roomId, s) {
            const id = String(roomId);
            const dir = roomDir(id);
            await fs.mkdir(dir, { recursive: true });
            const prev = lastSaved.get(id) || {};
            const writeBlob = async (file, key, value) => {
                if (prev[key] === value) return;
                if (value) await writeAtomic(path.join(dir, file), value);
                else await fs.rm(path.join(dir, file), { force: true });
                prev[key] = value;
            };
            await writeBlob('map.txt', 'map', s.map_src || null);
            await writeBlob('draw.txt', 'draw', s.draw_canvas || null);
            await writeBlob('fog.txt', 'fog', s.fog_canvas || null);
            await writeBlob('walls.txt', 'walls', s.vision_walls || null);
            await writeAtomic(path.join(dir, 'state.json'), JSON.stringify({ version: s.version, state: s.state }));
            lastSaved.set(id, prev);
        }
    };
}

async function writeAtomic(file, data) {
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, data, 'utf8');
    // На Windows антивирус может ненадолго держать файл — повторяем
    for (let attempt = 0; ; attempt++) {
        try { await fs.rename(tmp, file); return; }
        catch (err) {
            if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
            await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        }
    }
}

// ============ ОБЗОР (туман войны по линии видимости) ============
// Мастер один раз задаёт стены (распознать по цвету пола + поправить кистью) и двери.
// Дальше игроки видят только то, что видят их персонажи: впереди туман рассеивается, позади —
// остаётся «память» (тусклая карта без существ), неисследованное — чёрное.
// В онлайне видимость считает сервер (js/shared/vision-core.js) и не присылает невидимые фишки.

const VIS = {
  walls: null,          // { w, h, cell, mask: Uint8Array }
  server: null,         // { visible, explored } — пришло с сервера
  localExplored: null,  // без онлайна: что уже видели
  dragPreview: null,    // игрок тащит свою фишку — обзор считаем сразу, не дожидаясь сервера
  view: 'hint',         // как мастер видит туман: 'hint' — подсказка, 'players' — как у игроков, 'off'
  doorStart: null,
  sendTimer: null,
  raf: 0,
};
const VISION_DEFAULT_RADIUS = 12;

function visionSettings() {
  if (!state.vision || typeof state.vision !== 'object') state.vision = {};
  const v = state.vision;
  if (!Array.isArray(v.doors)) v.doors = [];
  if (v.shared === undefined) v.shared = true;
  if (!(Number(v.radius) > 0)) v.radius = VISION_DEFAULT_RADIUS;
  return v;
}

const visionOnline = () => !!window.dndOnlineGetRole?.();
const visionIsPlayer = () => window.dndOnlineGetRole?.() === 'player';
const visionActive = () => !!(VIS.walls && visionSettings().enabled);

/* ───────── слои ───────── */

function visionCanvases() {
  const layer = document.getElementById('map-layer');
  let fog = document.getElementById('vision-canvas');
  if (!fog) {
    fog = document.createElement('canvas');
    fog.id = 'vision-canvas';
    layer.appendChild(fog);
    const edit = document.createElement('canvas');
    edit.id = 'vision-edit-canvas';
    layer.appendChild(edit);
  }
  return { fog, edit: document.getElementById('vision-edit-canvas') };
}

function sizeVisionCanvas(canvas, w, h) {
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  canvas.style.width = (state.map.width || w) + 'px';
  canvas.style.height = (state.map.height || h) + 'px';
}

/** Перерисовать туман (не чаще раза за кадр). */
function visionRender() {
  if (VIS.raf) return;
  VIS.raf = requestAnimationFrame(() => { VIS.raf = 0; visionRenderNow(); });
}
window.dndVisionRender = visionRender;

function visionRenderNow() {
  const { fog, edit } = visionCanvases();
  const player = visionIsPlayer();
  const masks = visionMasks();
  const show = visionActive() && masks && (player || VIS.view !== 'off');

  fog.style.display = show ? 'block' : 'none';
  if (show) {
    const { w, h } = VIS.walls;
    sizeVisionCanvas(fog, w, h);
    const asPlayer = player || VIS.view === 'players';
    const aUnknown = asPlayer ? 255 : 140, aMemory = asPlayer ? 165 : 70;
    const ctx = fog.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let i = 0; i < w * h; i++) {
      d[i * 4 + 3] = masks.visible[i] ? 0 : masks.explored[i] ? aMemory : aUnknown;
    }
    ctx.putImageData(img, 0, 0);
  }
  renderVisionEditOverlay(edit);
}

/** Что сейчас видно и что уже видели — с сервера или посчитано на месте (без онлайна). */
function visionMasks() {
  if (!VIS.walls) return null;
  const n = VIS.walls.w * VIS.walls.h;
  if (visionOnline()) {
    if (!VIS.server || VIS.server.visible.length !== n) return null;
    if (!VIS.dragPreview) return VIS.server;
    const visible = new Uint8Array(VIS.server.visible), explored = new Uint8Array(VIS.server.explored);
    for (let i = 0; i < n; i++) if (VIS.dragPreview[i]) { visible[i] = 1; explored[i] = 1; }
    return { visible, explored };
  }
  // Без онлайна: смотрят все персонажи на карте
  const visible = visionCompute(state.tokens.filter(t => t.kind === 'character'));
  if (!VIS.localExplored || VIS.localExplored.length !== n) VIS.localExplored = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (visible[i]) VIS.localExplored[i] = 1;
  return { visible, explored: VIS.localExplored };
}

function visionCompute(tokens) {
  const v = visionSettings();
  const { w, h, cell, mask } = VIS.walls;
  const grid = Number(state.grid?.size) || 50;
  const sources = tokens.map(t => {
    const c = state.characters.find(x => x.id === t.sourceId);
    const r = (Number(c?.visionRadius) > 0 ? Number(c.visionRadius) : Number(v.radius) || VISION_DEFAULT_RADIUS) * grid;
    return { x: t.x, y: t.y, r };
  });
  return VisionCore.computeVisible(VisionCore.blockingMask(mask, w, h, v.doors), w, h, cell, sources);
}

/** Игрок тащит свою фишку: мгновенный предпросмотр обзора. */
window.dndVisionOnDrag = function (token) {
  if (!visionActive() || !visionIsPlayer() || token?.kind !== 'character') return;
  VIS.dragPreview = visionCompute([token]);
  visionRender();
};
window.addEventListener('mouseup', () => { if (VIS.dragPreview) { VIS.dragPreview = null; visionRender(); } });

/* ───────── данные из сети ───────── */

window.dndVisionSetWalls = function (msg) {
  if (!msg || msg.none) { VIS.walls = null; VIS.server = null; }
  else VIS.walls = { w: msg.w, h: msg.h, cell: msg.cell, mask: VisionCore.unpackBits(msg.data, msg.w * msg.h) };
  VIS.localExplored = null;
  visionRender(); renderVisionPanel();
};

window.dndVisionSetMasks = function (msg) {
  if (msg.off || !VIS.walls || msg.w !== VIS.walls.w || msg.h !== VIS.walls.h) VIS.server = null;
  else {
    const n = msg.w * msg.h;
    VIS.server = { visible: VisionCore.rleDecode(msg.visible, n), explored: VisionCore.rleDecode(msg.explored, n) };
  }
  visionRender();
};

function visionSendWalls() {
  if (!visionOnline() || visionIsPlayer()) return;
  clearTimeout(VIS.sendTimer);
  VIS.sendTimer = setTimeout(() => {
    const payload = VIS.walls ? { w: VIS.walls.w, h: VIS.walls.h, cell: VIS.walls.cell, data: VisionCore.packBits(VIS.walls.mask) } : null;
    window.DND_ONLINE?.sendVisionWalls?.(payload);
  }, 300);
}

function visionChanged(reason) {
  visionRender(); renderVisionPanel();
  window.dndOnlineSync?.(reason || 'vision');
}

/* ───────── стены: распознать и поправить ───────── */

function visionStartDetect() {
  if (!state.map?.src) { toast('Сначала загрузите карту', 'error'); return; }
  setTool('vdetect');
  toast('Кликните по полу на карте — по его цвету найдутся стены');
}

function visionDetectAt(x, y) {
  const img = document.getElementById('map-image');
  if (!img?.naturalWidth) { toast('Карта ещё не загрузилась', 'error'); return; }
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  let pixels;
  try { pixels = ctx.getImageData(0, 0, W, H).data; }
  catch (e) { toast('Не удалось прочитать картинку карты', 'error'); return; }
  // Цвет пола — самый частый цвет в квадрате 15×15 вокруг клика (линии сетки и значки не мешают)
  const sx = Math.round(x * W / (state.map.width || W)), sy = Math.round(y * H / (state.map.height || H));
  const buckets = new Map();
  for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
    const px = Math.min(W - 1, Math.max(0, sx + dx)), py = Math.min(H - 1, Math.max(0, sy + dy));
    const p = (py * W + px) * 4;
    const key = (pixels[p] >> 4) * 256 + (pixels[p + 1] >> 4) * 16 + (pixels[p + 2] >> 4);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += pixels[p]; b.g += pixels[p + 1]; b.b += pixels[p + 2];
    buckets.set(key, b);
  }
  const best = [...buckets.values()].sort((u, v) => v.n - u.n)[0];
  const ref = [best.r / best.n, best.g / best.n, best.b / best.n];
  const cell = Math.max(4, Math.min(16, Math.round((Number(state.grid?.size) || 50) / 7)));
  const gridCells = (Number(state.grid?.size) || 50) / cell;
  const res = VisionCore.detectWalls(pixels, W, H, cell, ref, 42, Math.round((gridCells * 0.7) ** 2));
  VIS.walls = { w: res.w, h: res.h, cell, mask: res.walls };
  VIS.localExplored = null;
  const v = visionSettings();
  v.enabled = true;
  v.doors = [];
  v.resetAt = Date.now();
  setTool('select');
  visionSendWalls();
  visionChanged('vision_walls');
  const floor = res.walls.reduce((s, x) => s + (x ? 0 : 1), 0);
  toast(`Стены найдены: пол — ${Math.round(floor * 100 / res.walls.length)}% карты. Поправьте кистью, если нужно.`);
  logEvent('map', '👁 Обзор игроков: стены распознаны по карте', { gm: true });
}

function visionPaintAt(x, y) {
  if (!VIS.walls) return;
  const value = state.tool === 'vwall' ? 1 : 0;
  VisionCore.paint(VIS.walls.mask, VIS.walls.w, VIS.walls.h, VIS.walls.cell, x, y, (state.drawSettings.size || 12) / 2, value);
  visionRender();
}

function visionCommitWalls() {
  visionSendWalls();
  visionRender();
}

/* ───────── двери ───────── */

function visionCellAt(x, y) {
  const c = VIS.walls.cell;
  return { x: Math.floor(x / c), y: Math.floor(y / c) };
}

function visionDoorAt(x, y) {
  if (!VIS.walls) return null;
  const p = visionCellAt(x, y);
  return visionSettings().doors.find(d =>
    p.x >= Math.min(d.x1, d.x2) - 1 && p.x <= Math.max(d.x1, d.x2) + 1 &&
    p.y >= Math.min(d.y1, d.y2) - 1 && p.y <= Math.max(d.y1, d.y2) + 1) || null;
}

function visionDoorDown(x, y) {
  if (!VIS.walls) { toast('Сначала распознайте стены', 'error'); return; }
  VIS.doorStart = { x, y };
}

function visionDoorUp(x, y, shift) {
  const start = VIS.doorStart;
  VIS.doorStart = null;
  if (!start) return;
  const v = visionSettings();
  const moved = Math.hypot(x - start.x, y - start.y) > VIS.walls.cell * 1.5;
  if (!moved) {
    const door = visionDoorAt(x, y);
    if (!door) { toast('Обведите дверной проём прямоугольником, чтобы поставить дверь'); return; }
    if (shift) v.doors = v.doors.filter(d => d !== door);
    else door.open = !door.open;
    visionChanged('vision_door');
    return;
  }
  // Дверь — прямоугольник, которым мастер обвёл дверной проём целиком
  const a = visionCellAt(start.x, start.y), b = visionCellAt(x, y);
  const door = { id: Date.now(), x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y), open: false };
  v.doors.push(door);
  visionChanged('vision_door');
  toast('Дверь поставлена (закрыта). Клик по ней — открыть/закрыть, Shift+клик — удалить');
}

/** Мастер щёлкнул по карте без перетаскивания — если там дверь, открыть/закрыть. */
function visionTryToggleDoor(x, y) {
  if (visionIsPlayer() || !visionActive()) return false;
  const door = visionDoorAt(x, y);
  if (!door) return false;
  door.open = !door.open;
  visionChanged('vision_door');
  toast(door.open ? '🚪 Дверь открыта' : '🚪 Дверь закрыта');
  return true;
}

/* ───────── слой мастера: стены и двери ───────── */

function renderVisionEditOverlay(canvas) {
  const editing = ['vwall', 'vfloor', 'vdoor'].includes(state.tool);
  const showDoors = !visionIsPlayer() && VIS.walls && (editing || visionActive()) && VIS.view !== 'off';
  if (!VIS.walls || (!editing && !showDoors)) { canvas.style.display = 'none'; return; }
  const { w, h, cell, mask } = VIS.walls;
  canvas.style.display = 'block';
  sizeVisionCanvas(canvas, w * 2, h * 2);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (editing) {
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) if (mask[i]) { img.data[i * 4] = 220; img.data[i * 4 + 1] = 60; img.data[i * 4 + 2] = 60; img.data[i * 4 + 3] = 110; }
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, w * 2, h * 2);
  }
  for (const d of visionSettings().doors) {
    const x = Math.min(d.x1, d.x2) * 2, y = Math.min(d.y1, d.y2) * 2;
    const dw = (Math.abs(d.x2 - d.x1) + 1) * 2, dh = (Math.abs(d.y2 - d.y1) + 1) * 2;
    ctx.fillStyle = d.open ? 'rgba(127,168,105,0.55)' : 'rgba(201,120,120,0.85)';
    ctx.strokeStyle = d.open ? '#7fa869' : '#ffb0a0';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, dw, dh);
    ctx.strokeRect(x + 0.5, y + 0.5, dw - 1, dh - 1);
  }
}

/* ───────── панель мастера ───────── */

function renderVisionPanel() {
  const el = document.getElementById('vision-panel');
  if (!el) return;
  const v = visionSettings();
  const has = !!VIS.walls;
  el.innerHTML = `
    <button class="tool-item ${state.tool === 'vdetect' ? 'active' : ''}" onclick="visionStartDetect()">
      <span class="vision-ico">🪄</span><span class="tool-label">${has ? 'Распознать стены заново' : 'Распознать стены по карте'}</span>
    </button>
    ${has ? `
    <button class="tool-item ${state.tool === 'vwall' ? 'active' : ''}" data-tool="vwall" onclick="setTool('vwall')"><span class="vision-ico">🧱</span><span class="tool-label">Дорисовать стену</span></button>
    <button class="tool-item ${state.tool === 'vfloor' ? 'active' : ''}" data-tool="vfloor" onclick="setTool('vfloor')"><span class="vision-ico">🧽</span><span class="tool-label">Стереть стену (проход)</span></button>
    <button class="tool-item ${state.tool === 'vdoor' ? 'active' : ''}" data-tool="vdoor" onclick="setTool('vdoor')"><span class="vision-ico">🚪</span><span class="tool-label">Двери (${v.doors.length})</span></button>
    <div class="vision-settings">
      <label class="vision-check"><input type="checkbox" ${v.enabled ? 'checked' : ''} onchange="visionSet('enabled', this.checked)"> Обзор игроков включён</label>
      <label class="vision-check"><input type="checkbox" ${v.shared ? 'checked' : ''} onchange="visionSet('shared', this.checked)"> Общий обзор группы</label>
      <label class="vision-row">Радиус обзора
        <input type="number" class="input" min="1" max="60" value="${v.radius}" onchange="visionSet('radius', Math.max(1, Math.min(60, Number(this.value) || 12)))"> кл.</label>
      <label class="vision-row">Мне показывать
        <select class="input" onchange="VIS.view = this.value; visionRender()">
          <option value="hint" ${VIS.view === 'hint' ? 'selected' : ''}>подсказку</option>
          <option value="players" ${VIS.view === 'players' ? 'selected' : ''}>как у игроков</option>
          <option value="off" ${VIS.view === 'off' ? 'selected' : ''}>ничего</option>
        </select></label>
      <button class="btn btn-sm" style="width:100%" onclick="visionResetExplored()">Забыть исследованное</button>
    </div>` : '<div class="vision-hint">Загрузите карту, нажмите кнопку выше и кликните по полу.</div>'}`;
}

function visionSet(key, value) {
  visionSettings()[key] = value;
  if (key === 'shared') visionSettings().resetAt = Date.now();
  VIS.localExplored = key === 'shared' ? null : VIS.localExplored;
  visionChanged('vision_settings');
}

function visionResetExplored() {
  if (!confirm('Игроки «забудут» всё исследованное — карта снова станет тёмной. Продолжить?')) return;
  visionSettings().resetAt = Date.now();
  VIS.localExplored = null;
  visionChanged('vision_reset');
}

/** Мастер: радиус обзора конкретного персонажа (например, тёмное зрение). */
function visionEditCharacterRadius(charId) {
  const c = state.characters.find(x => x.id === charId);
  if (!c) return;
  const cur = Number(c.visionRadius) > 0 ? c.visionRadius : '';
  const v = prompt(`Обзор «${c.name}» в клетках (пусто — общий радиус ${visionSettings().radius}):`, String(cur));
  if (v === null) return;
  const n = Math.trunc(Number(v));
  if (v.trim() === '' || !(n > 0)) delete c.visionRadius; else c.visionRadius = Math.min(60, n);
  renderInfoPanel();
  visionChanged('vision_radius');
}

/** Новая карта — старые стены к ней не подходят. */
function visionResetForNewMap() {
  if (!VIS.walls && !visionSettings().enabled) return;
  VIS.walls = null; VIS.server = null; VIS.localExplored = null;
  const v = visionSettings();
  v.enabled = false; v.doors = [];
  visionSendWalls();
  visionChanged('vision_map');
  toast('Новая карта: распознайте стены заново, чтобы включить обзор игроков');
}

/* ───────── сохранение в файл ───────── */

function visionSaveData() {
  return VIS.walls ? { w: VIS.walls.w, h: VIS.walls.h, cell: VIS.walls.cell, data: VisionCore.packBits(VIS.walls.mask) } : null;
}

function visionLoadData(data) {
  VIS.walls = data && data.w ? { w: data.w, h: data.h, cell: data.cell, mask: VisionCore.unpackBits(data.data, data.w * data.h) } : null;
  VIS.localExplored = null;
  visionSendWalls();
  visionRender(); renderVisionPanel();
}

window.addEventListener('DOMContentLoaded', () => { visionCanvases(); renderVisionPanel(); });

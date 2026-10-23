// ============ ХОЛСТЫ ДЛЯ ПРОСМОТРА ============
// Кроме игровой карты (там фишки, туман, бой) у мастера могут быть холсты-картинки:
// карта мира, область, город, портрет NPC… Их только смотрят — без фишек и инструментов.
// Каждый участник сам переключается между холстами; игра продолжается на игровой карте.
// Список холстов — в state.boards ({ id, name }), картинки передаются отдельно (они большие).

const BOARDS = {
  images: {},       // id → data URL
  current: null,    // null — игровая карта, иначе id холста
  view: { zoom: 1, panX: 0, panY: 0 },
  drag: null,
  seen: new Set(),  // какие холсты игрок уже видел — новым ставим отметку
};

function boardsList() {
  if (!Array.isArray(state.boards)) state.boards = [];
  return state.boards;
}

const boardsMaster = () => !isPlayerRole();

/* ───────── переключатель в верхней панели ───────── */
// Переключатель живёт в верхней панели, а не на карте — поверх карты ничего не мешает рисовать.

function renderBoardTabs() {
  const btn = document.getElementById('boards-btn');
  if (!btn) return;
  const list = boardsList();
  if (BOARDS.current && !list.some(b => b.id === BOARDS.current)) BOARDS.current = null;
  const cur = list.find(b => b.id === BOARDS.current);
  const fresh = isPlayerRole() && list.some(b => !BOARDS.seen.has(b.id) && b.id !== BOARDS.current);
  btn.style.display = list.length || boardsMaster() ? '' : 'none';
  btn.classList.toggle('viewing', !!cur);
  btn.innerHTML = `${cur ? '🗺 ' + escapeHtml(cur.name) : '⚔ Игровая карта'} <span class="boards-caret">▾</span>${fresh ? '<span class="board-new"></span>' : ''}`;
  btn.title = cur ? 'Сейчас открыт холст для просмотра. Нажмите, чтобы вернуться к игровой карте или выбрать другой холст' : 'Холсты: карта мира, области — только для просмотра';
  if (document.getElementById('boards-menu')) renderBoardsMenu();
}
window.renderBoardTabs = renderBoardTabs;

function toggleBoardsMenu(e) {
  e?.stopPropagation();
  if (document.getElementById('boards-menu')) { closeBoardsMenu(); return; }
  const menu = document.createElement('div');
  menu.id = 'boards-menu';
  menu.className = 'boards-menu';
  document.body.appendChild(menu);
  renderBoardsMenu();
  setTimeout(() => document.addEventListener('mousedown', boardsMenuOutside), 0);
}

function boardsMenuOutside(e) {
  if (!e.target.closest('#boards-menu, #boards-btn')) closeBoardsMenu();
}

function closeBoardsMenu() {
  document.getElementById('boards-menu')?.remove();
  document.removeEventListener('mousedown', boardsMenuOutside);
}

function renderBoardsMenu() {
  const menu = document.getElementById('boards-menu');
  const btn = document.getElementById('boards-btn');
  if (!menu || !btn) return;
  const r = btn.getBoundingClientRect();
  menu.style.left = r.left + 'px';
  menu.style.top = (r.bottom + 6) + 'px';
  const item = (id, label, note) => {
    const active = (BOARDS.current || null) === id;
    const fresh = id && !active && !BOARDS.seen.has(id) && isPlayerRole();
    return `<button class="boards-item ${active ? 'active' : ''}" onclick="openBoard(${id ? `'${id}'` : 'null'}); closeBoardsMenu()">
      <span>${escapeHtml(label)}</span>${fresh ? '<span class="board-new-inline">новый</span>' : ''}<small>${note}</small></button>`;
  };
  const list = boardsList();
  menu.innerHTML = item(null, '⚔ Игровая карта', 'фишки, бой, туман') +
    (list.length ? '<div class="boards-sep"></div>' + list.map(b => item(b.id, '🗺 ' + b.name, 'только просмотр')).join('') : '') +
    (boardsMaster() ? `<div class="boards-sep"></div><button class="boards-item boards-add" onclick="closeBoardsMenu(); addBoard()"><span>＋ Добавить холст</span><small>карта мира, область, рисунок</small></button>` : '');
}

/* ───────── просмотр ───────── */

function boardViewer() {
  let v = document.getElementById('board-viewer');
  if (v) return v;
  v = document.createElement('div');
  v.id = 'board-viewer';
  v.className = 'board-viewer';
  v.innerHTML = `
    <img id="board-image" draggable="false" alt="">
    <div class="board-empty" id="board-empty">Картинка загружается…</div>
    <div class="board-toolbar">
      <button class="btn btn-sm btn-primary" onclick="openBoard(null)" title="Вернуться к игровой карте">⚔ К игре</button>
      <span class="board-title" id="board-title"></span>
      <button class="btn btn-sm" onclick="boardZoom(1.2)" title="Приблизить">＋</button>
      <button class="btn btn-sm" onclick="boardZoom(1 / 1.2)" title="Отдалить">－</button>
      <button class="btn btn-sm" onclick="boardFit()" title="Целиком">⤢</button>
      <span class="gm-only-inline board-master-tools">
        <button class="btn btn-sm" onclick="renameBoard()" title="Переименовать">✎</button>
        <button class="btn btn-sm" onclick="replaceBoardImage()" title="Заменить картинку">🖼</button>
        <button class="btn btn-sm btn-danger" onclick="deleteBoard()" title="Удалить холст">✕</button>
      </span>
      <span class="board-hint">Только просмотр</span>
    </div>`;
  document.getElementById('map-area').appendChild(v);

  v.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = v.getBoundingClientRect();
    boardZoom(e.deltaY > 0 ? 0.9 : 1.1, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
  v.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('.board-toolbar')) return;
    BOARDS.drag = { x: e.clientX, y: e.clientY, panX: BOARDS.view.panX, panY: BOARDS.view.panY };
    v.classList.add('panning');
  });
  window.addEventListener('mousemove', e => {
    if (!BOARDS.drag) return;
    BOARDS.view.panX = BOARDS.drag.panX + e.clientX - BOARDS.drag.x;
    BOARDS.view.panY = BOARDS.drag.panY + e.clientY - BOARDS.drag.y;
    boardApplyTransform();
  });
  window.addEventListener('mouseup', () => { BOARDS.drag = null; v.classList.remove('panning'); });
  return v;
}

function openBoard(id) {
  BOARDS.current = id || null;
  const v = boardViewer();
  if (!id) {
    v.style.display = 'none';
    renderBoardTabs();
    return;
  }
  BOARDS.seen.add(id);
  const board = boardsList().find(b => b.id === id);
  document.getElementById('board-title').textContent = board ? board.name : '';
  v.style.display = 'block';
  renderBoardImage(true);
  renderBoardTabs();
}

function renderBoardImage(fit) {
  if (!BOARDS.current) return;
  const img = document.getElementById('board-image');
  const src = BOARDS.images[BOARDS.current];
  document.getElementById('board-empty').style.display = src ? 'none' : 'flex';
  if (!src) { img.removeAttribute('src'); return; }
  if (img.getAttribute('src') !== src) {
    img.onload = () => { if (fit) boardFit(); else boardApplyTransform(); };
    img.src = src;
  } else if (fit) boardFit();
}

function boardFit() {
  const img = document.getElementById('board-image');
  const v = document.getElementById('board-viewer');
  if (!img?.naturalWidth || !v) return;
  const rect = v.getBoundingClientRect();
  const zoom = Math.min(rect.width / img.naturalWidth, (rect.height - 50) / img.naturalHeight) * 0.95;
  BOARDS.view.zoom = zoom;
  BOARDS.view.panX = (rect.width - img.naturalWidth * zoom) / 2;
  BOARDS.view.panY = (rect.height - img.naturalHeight * zoom) / 2;
  boardApplyTransform();
}

function boardZoom(k, cx, cy) {
  const v = document.getElementById('board-viewer');
  const rect = v.getBoundingClientRect();
  cx = cx ?? rect.width / 2; cy = cy ?? rect.height / 2;
  const z0 = BOARDS.view.zoom, z1 = Math.max(0.05, Math.min(8, z0 * k));
  BOARDS.view.panX = cx - (cx - BOARDS.view.panX) * (z1 / z0);
  BOARDS.view.panY = cy - (cy - BOARDS.view.panY) * (z1 / z0);
  BOARDS.view.zoom = z1;
  boardApplyTransform();
}

function boardApplyTransform() {
  const img = document.getElementById('board-image');
  if (img) img.style.transform = `translate(${BOARDS.view.panX}px, ${BOARDS.view.panY}px) scale(${BOARDS.view.zoom})`;
}

/* ───────── мастер: добавить / переименовать / удалить ───────── */

function pickBoardImage() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = async ev => resolve({ name: file.name.replace(/\.[^.]+$/, ''), src: await prepareMapImage(ev.target.result, file.size) });
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

async function addBoard() {
  if (!boardsMaster()) return;
  const picked = await pickBoardImage();
  if (!picked) return;
  const name = (prompt('Название холста (например: Карта мира):', picked.name) || picked.name).trim().slice(0, 40) || 'Холст';
  const id = 'b' + Date.now().toString(36);
  BOARDS.images[id] = picked.src;
  boardsList().push({ id, name });
  window.DND_ONLINE?.sendBoardImage?.(id, picked.src);
  window.dndOnlineSync?.('board_add');
  logEvent('map', `🗺 Добавлен холст «${name}»`);
  openBoard(id);
}

function renameBoard() {
  const board = boardsList().find(b => b.id === BOARDS.current);
  if (!board) return;
  const name = prompt('Название холста:', board.name);
  if (!name || !name.trim()) return;
  board.name = name.trim().slice(0, 40);
  document.getElementById('board-title').textContent = board.name;
  renderBoardTabs();
  window.dndOnlineSync?.('board_rename');
}

async function replaceBoardImage() {
  const id = BOARDS.current;
  if (!id) return;
  const picked = await pickBoardImage();
  if (!picked) return;
  BOARDS.images[id] = picked.src;
  window.DND_ONLINE?.sendBoardImage?.(id, picked.src);
  renderBoardImage(true);
}

function deleteBoard() {
  const board = boardsList().find(b => b.id === BOARDS.current);
  if (!board || !confirm(`Удалить холст «${board.name}»?`)) return;
  state.boards = boardsList().filter(b => b.id !== board.id);
  delete BOARDS.images[board.id];
  window.DND_ONLINE?.sendBoardImage?.(board.id, null);
  window.dndOnlineSync?.('board_delete');
  openBoard(null);
}

/* ───────── сеть и сохранения ───────── */

window.dndBoardImage = function (msg) {
  if (msg.src) BOARDS.images[msg.id] = msg.src; else delete BOARDS.images[msg.id];
  if (BOARDS.current === msg.id) renderBoardImage(false);
};

/** После прихода состояния: список холстов мог измениться. */
window.dndBoardsChanged = function () {
  const before = new Set(BOARDS.known || []);
  const now = boardsList().map(b => b.id);
  if (BOARDS.known && isPlayerRole()) {
    const added = boardsList().filter(b => !before.has(b.id));
    if (added.length) toast(`🗺 Мастер добавил холст «${added[0].name}» — кнопка «⚔ Игровая карта» вверху`);
  }
  BOARDS.known = now;
  if (BOARDS.current && !now.includes(BOARDS.current)) openBoard(null);
  else if (BOARDS.current) {
    const b = boardsList().find(x => x.id === BOARDS.current);
    document.getElementById('board-title').textContent = b ? b.name : '';
  }
  renderBoardTabs();
};

/** Мастер впервые заполняет пустую комнату — отправить все картинки холстов. */
window.dndBoardsResend = function () {
  for (const b of boardsList()) if (BOARDS.images[b.id]) window.DND_ONLINE?.sendBoardImage?.(b.id, BOARDS.images[b.id]);
};

function boardsSaveData() {
  const out = {};
  for (const b of boardsList()) if (BOARDS.images[b.id]) out[b.id] = BOARDS.images[b.id];
  return out;
}

function boardsLoadData(images) {
  BOARDS.images = images && typeof images === 'object' ? { ...images } : {};
  window.dndBoardsResend();
  window.dndBoardsChanged();
}

window.addEventListener('DOMContentLoaded', () => { boardViewer().style.display = 'none'; renderBoardTabs(); });
window.addEventListener('resize', () => renderBoardsMenu());

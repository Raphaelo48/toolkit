// ============ SAVE / LOAD ============
function buildSaveData() {
  return {
    version: 9,
    map: state.map,
    grid: state.grid,
    view: state.view,
    tokens: state.tokens,
    characters: state.characters,
    monsters: state.monsters,
    initiative: state.initiative,
    initIndex: state.initIndex,
    initRound: state.initRound,
    nextId: state.nextId,
    eventLog: state.eventLog,
    expanded: {
      characters: Array.from(state.expanded.characters),
      monsters: Array.from(state.expanded.monsters)
    },
    sidebarLeftCollapsed: state.sidebarLeftCollapsed,
    sidebarRightCollapsed: state.sidebarRightCollapsed,
    diceHistory: state.diceHistory,
    drawings: document.getElementById('draw-canvas').toDataURL(),
    fog: document.getElementById('fog-canvas').toDataURL(),
    shapes: state.shapes,
    drawSettings: state.drawSettings,
    shapeSettings: state.shapeSettings,
  };
}

function applySaveData(data) {
  if (!data) return;
  state.map = data.map || state.map;
  state.grid = data.grid || state.grid;
  state.view = data.view || state.view;
  state.tokens = data.tokens || [];
  state.characters = data.characters || [];
  state.monsters = data.monsters || [];
  state.initiative = data.initiative || [];
  state.initIndex = data.initIndex || 0;
  state.initRound = data.initRound || 1;
  state.nextId = data.nextId || 1;
  state.eventLog = data.eventLog || [];
  state.expanded.characters = new Set(data.expanded?.characters || []);
  state.expanded.monsters = new Set(data.expanded?.monsters || []);
  state.sidebarLeftCollapsed = data.sidebarLeftCollapsed || false;
  state.sidebarRightCollapsed = data.sidebarRightCollapsed || false;
  state.diceHistory = data.diceHistory || [];
  state.shapes = Array.isArray(data.shapes) ? data.shapes : [];
  state.drawSettings = { ...state.drawSettings, ...(data.drawSettings || {}) };
  state.shapeSettings = { ...state.shapeSettings, ...(data.shapeSettings || {}) };
  state.selectedTokenId = null;

  document.getElementById('app').classList.toggle('sidebar-left-collapsed', state.sidebarLeftCollapsed);
  document.body.classList.toggle('sidebar-left-is-collapsed', state.sidebarLeftCollapsed);
  document.getElementById('app').classList.toggle('sidebar-right-collapsed', state.sidebarRightCollapsed);
  document.body.classList.toggle('sidebar-right-is-collapsed', state.sidebarRightCollapsed);

  if (state.map.src) {
    const img = document.getElementById('map-image');
    img.onload = () => {
      state.map.width = img.naturalWidth;
      state.map.height = img.naturalHeight;
      img.style.display = 'block';
      ['grid-canvas', 'draw-canvas', 'fog-canvas', 'shapes-back-canvas', 'shapes-canvas'].forEach(id => {
        const c = document.getElementById(id);
        c.width = state.map.width;
        c.height = state.map.height;
      });
      document.getElementById('map-empty').style.display = 'none';
      drawGrid();
      if (data.drawings) {
        const dImg = new Image();
        dImg.onload = () => {
          document.getElementById('draw-canvas').getContext('2d').drawImage(dImg, 0, 0);
        };
        dImg.src = data.drawings;
      }
      if (data.fog) {
        const fImg = new Image();
        fImg.onload = () => {
          document.getElementById('fog-canvas').getContext('2d').drawImage(fImg, 0, 0);
        };
        fImg.src = data.fog;
      }
      renderShapes();
      updateMapTransform();
    };
    img.src = state.map.src;
  } else {
    document.getElementById('map-image').style.display = 'none';
    document.getElementById('map-empty').style.display = 'flex';
  }

  document.getElementById('grid-size').value = state.grid.size;
  document.getElementById('grid-key').textContent = state.grid.enabled ? 'ВКЛ' : 'ВЫКЛ';
  document.getElementById('zoom-display').textContent = Math.round(state.view.zoom * 100) + '%';
  drawGrid();
  updateMapTransform();
  renderAll();
  renderLogFilters();
  renderLog();
  renderLootCategories();
  renderLoot();
  renderAtmosphere();
}

function renderAll() {
  renderTokens();
  renderCharactersList();
  renderMonstersList();
  renderInfoPanel();
  renderInitiative();
}

function saveGame() {
  try {
    const data = buildSaveData();
    localStorage.setItem('dm_toolkit_save_v9', JSON.stringify(data));
    logEvent('system', 'Игра сохранена');
    toast('Игра сохранена', 'success');
    document.getElementById('topbar-status').textContent = 'Сохранено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    console.error(e);
    toast('Ошибка сохранения', 'error');
  }
}

function loadGame() {
  const raw = localStorage.getItem('dm_toolkit_save_v9') || localStorage.getItem('dm_toolkit_save_v8');
  if (!raw) { toast('Нет сохранённой игры', 'error'); return; }
  try {
    const data = JSON.parse(raw);
    applySaveData(data);
    logEvent('system', 'Игра загружена');
    toast('Игра загружена', 'success');
  } catch (e) {
    console.error(e);
    toast('Ошибка загрузки', 'error');
  }
}

function loadFromStorage() {
  const raw = localStorage.getItem('dm_toolkit_save_v9') || localStorage.getItem('dm_toolkit_save_v8');
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    applySaveData(data);
  } catch (e) {
    console.error(e);
  }
}

function exportJSON() {
  const data = buildSaveData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dm-toolkit-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  logEvent('system', 'Игра экспортирована в файл');
  toast('Файл экспортирован', 'success');
}

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      applySaveData(data);
      logEvent('system', `Игра импортирована из файла: ${file.name}`);
      toast('Игра импортирована', 'success');
    } catch (err) {
      console.error(err);
      toast('Неверный формат файла', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

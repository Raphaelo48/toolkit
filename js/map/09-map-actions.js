// ============ MAP ACTIONS ============
function addMapMarker(x, y) {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Это действие доступно только мастеру', 'error'); return; }
  const text = prompt('Текст маркера:');
  if (!text) return;
  const token = {
    id: state.nextId++, name: '📝 ' + text.slice(0, 30), type: 'object', emoji: '📝', image: null,
    color: '#d4a574', size: 36, notes: text, x, y, kind: 'marker', conditions: []
  };
  state.tokens.push(token);
  renderTokens();
  selectToken(token.id);
  logEvent('map', `📝 Добавлен маркер: "${text}"`);
  toast('Маркер добавлен', 'map');
  window.dndOnlineSync?.('object_change');
}

function addPOI(x, y) {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Это действие доступно только мастеру', 'error'); return; }
  const name = prompt('Название локации:');
  if (!name) return;
  const desc = prompt('Описание (необязательно):') || '';
  const icons = ['📍', '🏰', '⛪', '🏚', '🗿', '⛰', '🌲', '🕯', '🚪', '⚑'];
  const icon = icons[Math.floor(Math.random() * icons.length)];
  const token = {
    id: state.nextId++, name, type: 'object', emoji: icon, image: null,
    color: '#7fa869', size: 44, notes: desc ? `${name}\n\n${desc}` : name,
    x, y, kind: 'poi', conditions: []
  };
  state.tokens.push(token);
  renderTokens();
  selectToken(token.id);
  logEvent('map', `${icon} Точка интереса: «${name}»`);
  toast(`${icon} Точка интереса добавлена`, 'map');
  window.dndOnlineSync?.('object_change');
}

function addHiddenArea(x, y) {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Это действие доступно только мастеру', 'error'); return; }
  const name = prompt('Название зоны:') || 'Скрытая зона';
  const desc = prompt('Эффект при активации:') || '';
  const token = {
    id: state.nextId++, name, type: 'object', emoji: '⚠', image: null,
    color: '#c97878', size: 32, notes: `${name}\n\n${desc}`,
    x, y, kind: 'hidden', conditions: []
  };
  state.tokens.push(token);
  renderTokens();
  selectToken(token.id);
  logEvent('map', `⚠ Скрытая зона: «${name}»`);
  toast('Скрытая зона добавлена', 'map');
  window.dndOnlineSync?.('object_change');
}

function startMeasureFrom(x, y) {
  state.measureStart = { x, y };
  setTool('measure');
  toast('Кликните в конечную точку для измерения');
}

function centerViewOn(x, y) {
  const area = document.getElementById('map-area');
  const rect = area.getBoundingClientRect();
  state.view.panX = rect.width / 2 - x * state.view.zoom;
  state.view.panY = rect.height / 2 - y * state.view.zoom;
  updateMapTransform();
}

function pasteLastToken(x, y) {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Это действие доступно только мастеру', 'error'); return; }
  const src = state.lastTokenPlaced;
  if (!src) return;
  const copy = { ...src, id: state.nextId++, x, y, conditions: src.conditions ? [...src.conditions] : [] };
  state.tokens.push(copy);
  renderTokens();
  selectToken(copy.id);
  logEvent('token', `📋 Вставлена копия: «${copy.name}»`);
  toast('Токен вставлен');
  window.dndOnlineSync?.('object_change');
}

function spawnCharacterAt(charId, x, y) {
  if (window.dndOnlineGetRole?.() === 'player') { const c = state.characters.find(ch => ch.id === charId); if (!c || String(c.ownerId) !== String(window.DND_ONLINE?.meta?.player?.id)) { toast('Можно размещать только своего персонажа', 'error'); return; } }
  const c = state.characters.find(ch => ch.id === charId);
  if (!c) return;
  const token = {
    id: state.nextId++, name: c.name, type: 'character',
    emoji: c.emoji, image: c.image, color: c.color, size: 50,
    notes: `${c.charClass || '—'}, ур. ${c.level}`,
    x, y, kind: 'character', sourceId: c.id, ownerId: c.ownerId || null,
    hpCur: c.hpCur, hpMax: c.hpMax, conditions: []
  };
  state.tokens.push(token);
  state.lastTokenPlaced = { ...token };
  renderTokens();
  selectToken(token.id);
  logEvent('character', `«${c.name}» размещён на карте`);
  toast(`«${c.name}» размещён`);
  window.dndOnlineSync?.('object_change');
}

function spawnMonsterAt(monsterId, x, y) {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Это действие доступно только мастеру', 'error'); return; }
  const m = state.monsters.find(mo => mo.id === monsterId);
  if (!m) return;
  const token = {
    id: state.nextId++, name: m.name, type: 'monster',
    emoji: m.emoji, image: m.image, color: m.color, size: 50,
    notes: m.notes, x, y, kind: 'monster', sourceId: m.id,
    hpCur: m.hpCur, hpMax: m.hpMax, conditions: []
  };
  state.tokens.push(token);
  state.lastTokenPlaced = { ...token };
  renderTokens();
  selectToken(token.id);
  logEvent('monster', `«${m.name}» размещён на карте`);
  toast(`«${m.name}» размещён`);
  window.dndOnlineSync?.('object_change');
}

function spawnQuickChest(x, y) {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Это действие доступно только мастеру', 'error'); return; }
  const pools = ['basic', 'valuable', 'treasure'];
  const poolKey = pools[Math.floor(Math.random() * pools.length)];
  const chestItems = LOOT_ITEMS.filter(i => i.isLootChest && i.lootPool === poolKey);
  const chest = chestItems[Math.floor(Math.random() * chestItems.length)] || getLootItem('chest_wooden');
  placeLootOnMap(chest.id, x, y);
}

function spawnQuickLoot(x, y) {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Это действие доступно только мастеру', 'error'); return; }
  const all = LOOT_ITEMS.filter(i => !i.isLootChest);
  const weighted = [];
  all.forEach(item => {
    const weights = { common: 10, uncommon: 6, rare: 3, 'very-rare': 1, legendary: 1 };
    const w = weights[item.rarity] || 1;
    for (let i = 0; i < w; i++) weighted.push(item);
  });
  const item = weighted[Math.floor(Math.random() * weighted.length)];
  placeLootOnMap(item.id, x, y);
}

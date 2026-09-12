// ============ LOOT ============
function getLootItem(id) { return LOOT_ITEMS.find(x => x.id === id); }

function renderLootCategories() {
  const container = document.getElementById('loot-categories');
  const counts = { all: LOOT_ITEMS.length };
  Object.keys(LOOT_CATEGORIES).forEach(k => {
    if (k !== 'all') counts[k] = LOOT_ITEMS.filter(i => i.category === k).length;
  });
  container.innerHTML = Object.entries(LOOT_CATEGORIES).map(([key, cfg]) => `
    <button class="loot-cat ${state.lootFilter === key ? 'active' : ''}" onclick="setLootFilter('${key}')">
      <span>${cfg.icon}</span>
      <span>${cfg.label}</span>
      <span class="loot-cat-count">${counts[key] || 0}</span>
    </button>
  `).join('');
}

function setLootFilter(filter) {
  state.lootFilter = filter;
  renderLootCategories();
  renderLoot();
}

function renderLoot() {
  const list = document.getElementById('loot-list');
  const search = (document.getElementById('loot-search').value || '').toLowerCase().trim();
  let items = LOOT_ITEMS;
  if (state.lootFilter !== 'all') items = items.filter(i => i.category === state.lootFilter);
  if (search) items = items.filter(i => i.name.toLowerCase().includes(search) || i.desc.toLowerCase().includes(search));
  if (items.length === 0) {
    list.innerHTML = '<div class="loot-empty">Ничего не найдено</div>';
    return;
  }
  list.innerHTML = items.map(item => `
    <div class="loot-item rarity-${item.rarity}"
         onclick="selectLootItem('${item.id}')"
         title="${escapeHtml(item.name)} — ${escapeHtml(item.desc)}">
      <div class="loot-rarity-dot"></div>
      <div class="loot-item-icon">${item.icon}</div>
      <div class="loot-item-name">${escapeHtml(item.name)}</div>
    </div>
  `).join('');
  renderLootInfoPanel();
}

function selectLootItem(id) {
  state.selectedLootId = id;
  renderLoot();
}

function renderLootInfoPanel() {
  const panel = document.getElementById('loot-info-panel');
  if (!state.selectedLootId) { panel.classList.remove('visible'); return; }
  const item = getLootItem(state.selectedLootId);
  if (!item) { panel.classList.remove('visible'); return; }
  const rarityLabels = { 'common': 'Обычный', 'uncommon': 'Необычный', 'rare': 'Редкий', 'very-rare': 'Очень редкий', 'legendary': 'Легендарный' };
  const catLabel = LOOT_CATEGORIES[item.category]?.label || '';
  panel.classList.add('visible');
  panel.innerHTML = `
    <div class="loot-info-header">
      <div class="loot-info-icon">${item.icon}</div>
      <div style="flex:1; min-width:0;">
        <div class="loot-info-name">${escapeHtml(item.name)}</div>
        <div class="loot-info-meta">
          <span class="rarity-label-${item.rarity}">${rarityLabels[item.rarity]}</span>
          · ${escapeHtml(catLabel)}
        </div>
      </div>
    </div>
    <div class="loot-info-desc">${escapeHtml(item.desc)}</div>
    <div class="loot-info-actions">
      <button class="btn btn-primary btn-sm" style="flex:1" onclick="placeLootOnMap('${item.id}')">
        <svg style="width:11px;height:11px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
        Разместить
      </button>
      ${item.isLootChest ? `
        <button class="btn btn-sm" onclick="openLootChest('${item.id}')">
          <svg style="width:11px;height:11px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg>
          Открыть
        </button>
      ` : ''}
    </div>
  `;
}

function placeLootOnMap(itemId, x, y) {
  const item = getLootItem(itemId);
  if (!item) return;
  const area = document.getElementById('map-area');
  const rect = area.getBoundingClientRect();
  if (x == null || y == null) {
    const center = screenToMap(rect.width / 2, rect.height / 2);
    x = center.x + (Math.random() - 0.5) * 40;
    y = center.y + (Math.random() - 0.5) * 40;
  }
  const rarityColors = { 'common': '#8a8078', 'uncommon': '#7fa869', 'rare': '#7ba3c9', 'very-rare': '#b88ad4', 'legendary': '#d4a574' };
  const color = rarityColors[item.rarity] || '#d4a574';
  const rarityLabels = { 'common': 'Обычный', 'uncommon': 'Необычный', 'rare': 'Редкий', 'very-rare': 'Очень редкий', 'legendary': 'Легендарный' };
  const token = {
    id: state.nextId++, name: item.name, type: 'object', emoji: item.icon, image: null, color,
    size: item.isLootChest ? 55 : 40,
    notes: `[${rarityLabels[item.rarity]}] ${item.desc}`,
    x, y, kind: 'loot', lootId: item.id,
    isLootChest: item.isLootChest || false, lootPool: item.lootPool || null,
    conditions: []
  };
  state.tokens.push(token);
  state.lastTokenPlaced = { ...token };
  renderTokens();
  selectToken(token.id);
  logEvent('loot', `Размещён предмет: ${item.icon} «${item.name}»`);
  toast(`${item.icon} ${item.name} размещён`, 'loot');
}

function openLootChest(itemId) {
  const item = getLootItem(itemId);
  if (!item || !item.isLootChest) return;
  const pool = LOOT_POOLS[item.lootPool];
  if (!pool) { toast('У этого сундука нет добычи', 'error'); return; }
  const contents = [];
  pool.forEach(entry => {
    if (Math.random() < entry.chance) {
      const qty = entry.qty[0] + Math.floor(Math.random() * (entry.qty[1] - entry.qty[0] + 1));
      const lootItem = getLootItem(entry.itemId);
      if (lootItem) contents.push({ item: lootItem, qty });
    }
  });
  if (contents.length === 0) contents.push({ item: getLootItem('gold_pile'), qty: 1 });
  const rarityLabels = { 'common': 'Обычный', 'uncommon': 'Необычный', 'rare': 'Редкий', 'very-rare': 'Очень редкий', 'legendary': 'Легендарный' };
  document.getElementById('loot-content-title').innerHTML = `${item.icon} Добыча: ${escapeHtml(item.name)}`;
  const list = document.getElementById('loot-content-list');
  list.innerHTML = contents.map(c => `
    <div style="display:flex; align-items:center; gap:10px; padding:8px 10px; background:var(--bg-2); border:1px solid var(--border); border-radius:6px;">
      <div style="width:32px; height:32px; background:var(--bg-3); border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0;">${c.item.icon}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-size:12px; font-weight:500; color:var(--text-0);">${escapeHtml(c.item.name)}${c.qty > 1 ? ` × ${c.qty}` : ''}</div>
        <div style="font-size:10px; color:var(--text-2); margin-top:2px;">
          <span class="rarity-label-${c.item.rarity}">${rarityLabels[c.item.rarity]}</span>
        </div>
      </div>
      <button class="btn btn-sm" onclick="closeModal('loot-content-modal'); placeLootOnMap('${c.item.id}')">На карту</button>
      <button class="btn btn-sm btn-primary" onclick="addLootItemToCharInventory('${c.item.id}')">В инвентарь</button>
    </div>
  `).join('');
  document.getElementById('loot-content-modal').style.display = 'flex';
  const names = contents.map(c => `${c.item.icon} ${c.item.name}${c.qty > 1 ? ' ×' + c.qty : ''}`).join(', ');
  logEvent('loot', `Открыт ${item.icon} «${item.name}»: ${names}`);
}

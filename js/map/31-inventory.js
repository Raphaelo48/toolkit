// ============ INVENTORY ============
// Инвентарь токенов — хранится в state.inventory[tokenId] = [{ id, name, icon, qty, rarity, desc, source }]
// Синхронизируется как часть общего стейта через buildSharedState / applySharedState

if (!state.inventory) state.inventory = {};

// ---- Утилиты ----

function getTokenInventory(tokenId) {
  if (!state.inventory[tokenId]) state.inventory[tokenId] = [];
  return state.inventory[tokenId];
}

function addToInventory(tokenId, item, qty = 1) {
  const inv = getTokenInventory(tokenId);
  const existing = inv.find(e => e.id === item.id);
  if (existing) {
    existing.qty += qty;
  } else {
    inv.push({ id: item.id, name: item.name, icon: item.icon, qty, rarity: item.rarity, desc: item.desc || '' });
  }
  state.inventory[tokenId] = inv;
  renderInventoryIfOpen(tokenId);
  window.dndOnlineSync?.('inventory_update');
  toast(`${item.icon} ${item.name} → инвентарь`, 'success');
}

function removeFromInventory(tokenId, itemId, qty = 1) {
  const inv = getTokenInventory(tokenId);
  const idx = inv.findIndex(e => e.id === itemId);
  if (idx < 0) return;
  inv[idx].qty -= qty;
  if (inv[idx].qty <= 0) inv.splice(idx, 1);
  state.inventory[tokenId] = inv;
  renderInventoryModal(tokenId);
  window.dndOnlineSync?.('inventory_update');
}

function renderInventoryIfOpen(tokenId) {
  const modal = document.getElementById('inventory-modal');
  if (modal && modal.style.display !== 'none' && modal.dataset.tokenId == tokenId) {
    renderInventoryModal(tokenId);
  }
}

// ---- Модальное окно инвентаря ----

function openInventoryModal(tokenId) {
  const token = state.tokens.find(t => t.id === tokenId);
  if (!token) return;

  // Проверка прав: игрок видит только свой инвентарь
  const role = window.dndOnlineGetRole?.();
  if (role === 'player') {
    const myId = window.DND_ONLINE?.meta?.player?.id;
    const isOwnChar = token.kind === 'character' && String(token.ownerId) === String(myId);
    if (!isOwnChar) {
      toast('Вы можете открыть только инвентарь своего персонажа', 'error');
      return;
    }
  }

  const modal = document.getElementById('inventory-modal');
  modal.dataset.tokenId = tokenId;
  modal.style.display = 'flex';
  renderInventoryModal(tokenId);
}

function renderInventoryModal(tokenId) {
  const token = state.tokens.find(t => t.id === tokenId);
  if (!token) return;
  const inv = getTokenInventory(tokenId);
  const role = window.dndOnlineGetRole?.();
  const isMaster = role === 'master' || !role;

  document.getElementById('inventory-modal-title').textContent = `🎒 Инвентарь: ${token.name}`;

  const rarityLabels = { common:'Обычный', uncommon:'Необычный', rare:'Редкий', 'very-rare':'Очень редкий', legendary:'Легендарный' };

  const listEl = document.getElementById('inventory-list');
  if (inv.length === 0) {
    listEl.innerHTML = '<div style="text-align:center; color:var(--text-2); padding:24px 0; font-size:13px;">Инвентарь пуст</div>';
  } else {
    listEl.innerHTML = inv.map(entry => `
      <div class="inv-item" style="display:flex; align-items:center; gap:10px; padding:8px 10px; background:var(--bg-2); border:1px solid var(--border); border-radius:6px;">
        <div style="width:32px;height:32px;background:var(--bg-3);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">${entry.icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:500;color:var(--text-0);">${escapeHtml(entry.name)}${entry.qty > 1 ? ` × ${entry.qty}` : ''}</div>
          ${entry.rarity ? `<div style="font-size:10px;color:var(--text-2);margin-top:2px;"><span class="rarity-label-${entry.rarity}">${rarityLabels[entry.rarity] || ''}</span></div>` : ''}
          ${entry.desc ? `<div style="font-size:10px;color:var(--text-2);margin-top:2px;">${escapeHtml(entry.desc)}</div>` : ''}
        </div>
        ${isMaster ? `
          <div style="display:flex;gap:4px;flex-shrink:0;">
            ${entry.qty > 1 ? `<button class="btn btn-sm" onclick="removeFromInventory(${tokenId}, '${entry.id}', 1)" title="Убрать 1">−1</button>` : ''}
            <button class="btn btn-sm btn-danger" onclick="removeFromInventory(${tokenId}, '${entry.id}', ${entry.qty})" title="Удалить">
              <svg style="width:10px;height:10px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            </button>
          </div>
        ` : ''}
      </div>
    `).join('');
  }

  // Кнопка "Добавить из наград" — только для мастера
  const addFromLootBtn = document.getElementById('inv-add-from-loot-btn');
  if (addFromLootBtn) addFromLootBtn.style.display = isMaster ? '' : 'none';
}

function closeInventoryModal() {
  document.getElementById('inventory-modal').style.display = 'none';
}

// ---- Выбор предмета из библиотеки наград для добавления в инвентарь ----

function openAddItemToInventory(tokenId) {
  const modal = document.getElementById('inventory-modal');
  modal.dataset.addingFor = tokenId;
  // Показываем панель выбора предмета поверх инвентаря
  const panel = document.getElementById('inv-item-picker');
  panel.style.display = 'flex';
  renderItemPicker(tokenId, '');
}

function closeItemPicker() {
  document.getElementById('inv-item-picker').style.display = 'none';
  document.getElementById('inv-picker-search').value = '';
}

function renderItemPicker(tokenId, search) {
  const s = (search || '').toLowerCase().trim();
  let items = LOOT_ITEMS;
  if (s) items = items.filter(i => i.name.toLowerCase().includes(s) || i.desc.toLowerCase().includes(s));
  const rarityLabels = { common:'Обычный', uncommon:'Необычный', rare:'Редкий', 'very-rare':'Очень редкий', legendary:'Легендарный' };
  const list = document.getElementById('inv-picker-list');
  list.innerHTML = items.slice(0, 80).map(item => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-2);border:1px solid var(--border);border-radius:6px;cursor:pointer;"
         onclick="addToInventory(${tokenId}, ${JSON.stringify(JSON.stringify(item)).replace(/</g,'\\u003c')}, 1); renderItemPicker(${tokenId}, document.getElementById('inv-picker-search').value)">
      <div style="font-size:18px;width:28px;text-align:center;flex-shrink:0;">${item.icon}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:500;color:var(--text-0);">${escapeHtml(item.name)}</div>
        <div style="font-size:10px;color:var(--text-2);"><span class="rarity-label-${item.rarity}">${rarityLabels[item.rarity]||''}</span></div>
      </div>
      <svg style="width:14px;height:14px;color:var(--accent);flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
    </div>
  `).join('');
}

// ---- Добавить вещь из открытого сундука прямо в инвентарь персонажа ----

// Вызывается из модального окна лута вместо "На карту"
function addLootItemToCharInventory(itemId) {
  // Найти собственных персонажей текущего пользователя с токенами на карте
  const role = window.dndOnlineGetRole?.();
  const myId = window.DND_ONLINE?.meta?.player?.id;
  const item = getLootItem(itemId);
  if (!item) return;

  let candidates = [];
  if (!role || role === 'master') {
    // Мастер выбирает любого персонажа с токеном на карте
    candidates = state.tokens.filter(t => t.kind === 'character' || t.kind === 'monster' || t.type === 'object');
    if (candidates.length === 0) candidates = state.tokens;
  } else {
    // Игрок — только свои персонажи
    const ownChars = state.characters.filter(c => String(c.ownerId) === String(myId));
    const ownIds = new Set(ownChars.map(c => String(c.id)));
    candidates = state.tokens.filter(t => t.kind === 'character' && ownIds.has(String(t.sourceId)));
  }

  if (candidates.length === 0) {
    toast('Нет токенов на карте, которым можно передать предмет', 'error');
    return;
  }

  if (candidates.length === 1) {
    addToInventory(candidates[0].id, item, 1);
    return;
  }

  // Показать выбор получателя
  openRecipientPicker(item, candidates);
}

function openRecipientPicker(item, candidates) {
  const modal = document.getElementById('recipient-picker-modal');
  document.getElementById('recipient-picker-title').textContent = `${item.icon} ${item.name} → кому?`;
  document.getElementById('recipient-picker-list').innerHTML = candidates.map(t => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg-2);border:1px solid var(--border);border-radius:6px;cursor:pointer;"
         onclick="addToInventory(${t.id}, ${JSON.stringify(JSON.stringify(item)).replace(/</g,'\\u003c')}, 1); closeRecipientPicker();">
      <div style="font-size:18px;width:28px;text-align:center;">${t.emoji || t.image ? '🖼' : '?'}</div>
      <div style="font-size:13px;color:var(--text-0);">${escapeHtml(t.name)}</div>
    </div>
  `).join('');
  modal.style.display = 'flex';
}
function closeRecipientPicker() {
  document.getElementById('recipient-picker-modal').style.display = 'none';
}

// ---- Патч buildSharedState и applySharedState для инвентаря ----
// Оборачиваем после загрузки, чтобы inventory попало в синк
(function patchSync() {
  const _orig = window.dndOnlineSync;
  // inventory включён в state напрямую, buildSharedState в realtime.js уже захватывает всё через state.*
  // Нам нужно только убедиться что state.inventory попадает в buildSharedState
  // Это делается через патч realtime: добавляем inventory в buildSharedState и applySharedState
  // Но т.к. realtime.js уже загружен — делаем через monkey-patch DND_ONLINE
  const patchInterval = setInterval(() => {
    if (!window.DND_ONLINE) return;
    clearInterval(patchInterval);

    const online = window.DND_ONLINE;
    const origHandleMessage = online.handleMessage.bind(online);

    // После apply — убедиться что inventory восстановлен
    online.handleMessage = function(m) {
      if (m.type === 'state_snapshot' && m.state?.inventory) {
        state.inventory = m.state.inventory;
      }
      origHandleMessage(m);
    };
  }, 100);
})();

// Регистрируем inventory в state для save/load
window.addEventListener('DOMContentLoaded', () => {
  if (!state.inventory) state.inventory = {};
});

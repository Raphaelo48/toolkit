// ============ INVENTORY ============
// state.inventory[tokenId] = [{ id, name, icon, qty, rarity, desc }]
// Синхронизируется как часть buildSharedState (realtime.js уже включает inventory).

if (!state.inventory) state.inventory = {};

// ───────── утилиты ─────────

function getTokenInventory(tokenId) {
  const key = String(tokenId);
  if (!state.inventory[key]) state.inventory[key] = [];
  return state.inventory[key];
}

function addToInventory(tokenId, item, qty) {
  qty = qty || 1;
  // item может прийти как строка (из inline onclick) или как объект
  if (typeof item === 'string') {
    try { item = JSON.parse(item); } catch(e) { console.error('addToInventory: bad item', item); return; }
  }
  if (!item || !item.id) { console.error('addToInventory: item missing id', item); return; }

  const key = String(tokenId);
  if (!state.inventory[key]) state.inventory[key] = [];
  const inv = state.inventory[key];

  const existing = inv.find(e => e.id === item.id);
  if (existing) {
    existing.qty += qty;
  } else {
    inv.push({
      id: item.id,
      name: item.name || '?',
      icon: item.icon || '❓',
      qty: qty,
      rarity: item.rarity || 'common',
      desc: item.desc || ''
    });
  }
  renderInventoryIfOpen(tokenId);
  renderInfoPanel?.();
  window.dndOnlineSync?.('inventory_update');
  toast(`${item.icon || '❓'} ${item.name || '?'} → инвентарь`, 'success');
}

function removeFromInventory(tokenId, itemId, qty) {
  qty = qty || 1;
  const key = String(tokenId);
  const inv = state.inventory[key];
  if (!inv) return;
  const idx = inv.findIndex(e => e.id === itemId);
  if (idx < 0) return;
  inv[idx].qty -= qty;
  if (inv[idx].qty <= 0) inv.splice(idx, 1);
  renderInventoryModal(tokenId);
  renderInfoPanel?.();
  window.dndOnlineSync?.('inventory_update');
}

function renderInventoryIfOpen(tokenId) {
  const modal = document.getElementById('inventory-modal');
  if (modal && modal.style.display !== 'none' && String(modal.dataset.tokenId) === String(tokenId)) {
    renderInventoryModal(tokenId);
  }
}

// ───────── модальное окно инвентаря ─────────

function openInventoryModal(tokenId) {
  const token = state.tokens.find(t => t.id === tokenId);
  if (!token) return;

  const role = window.dndOnlineGetRole?.();
  if (role === 'player') {
    const myId = String(window.DND_ONLINE?.meta?.player?.id ?? '');
    const isOwn = token.kind === 'character' && String(token.ownerId) === myId;
    if (!isOwn) { toast('Только свой персонаж', 'error'); return; }
  }

  const modal = document.getElementById('inventory-modal');
  modal.dataset.tokenId = String(tokenId);
  modal.style.display = 'flex';
  renderInventoryModal(tokenId);
}

function renderInventoryModal(tokenId) {
  const token = state.tokens.find(t => t.id === tokenId);
  if (!token) return;
  const inv = getTokenInventory(tokenId);
  const role = window.dndOnlineGetRole?.();
  const isMaster = !role || role === 'master';

  document.getElementById('inventory-modal-title').textContent =
    `🎒 Инвентарь: ${token.emoji || ''} ${token.name}`;

  const rarityLabels = {
    common: 'Обычный', uncommon: 'Необычный', rare: 'Редкий',
    'very-rare': 'Очень редкий', legendary: 'Легендарный'
  };

  const listEl = document.getElementById('inventory-list');
  if (inv.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;color:var(--text-2);padding:24px 0;font-size:13px;">Инвентарь пуст</div>';
  } else {
    listEl.innerHTML = inv.map(entry => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg-2);border:1px solid var(--border);border-radius:6px;">
        <div style="width:32px;height:32px;background:var(--bg-3);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">${entry.icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:500;color:var(--text-0);">${escapeHtml(entry.name)}${entry.qty > 1 ? ` × ${entry.qty}` : ''}</div>
          ${entry.rarity ? `<div style="font-size:10px;color:var(--text-2);margin-top:2px;"><span class="rarity-label-${entry.rarity}">${rarityLabels[entry.rarity] || ''}</span></div>` : ''}
          ${entry.desc ? `<div style="font-size:10px;color:var(--text-2);margin-top:2px;">${escapeHtml(entry.desc)}</div>` : ''}
        </div>
        ${isMaster ? `
          <div style="display:flex;gap:4px;flex-shrink:0;">
            ${entry.qty > 1 ? `<button class="btn btn-sm" onclick="removeFromInventory(${tokenId},'${entry.id}',1)">−1</button>` : ''}
            <button class="btn btn-sm btn-danger" onclick="removeFromInventory(${tokenId},'${entry.id}',${entry.qty})" title="Удалить">
              <svg style="width:10px;height:10px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            </button>
          </div>` : ''}
      </div>`).join('');
  }

  const addBtn = document.getElementById('inv-add-from-loot-btn');
  if (addBtn) addBtn.style.display = isMaster ? '' : 'none';
}

function closeInventoryModal() {
  document.getElementById('inventory-modal').style.display = 'none';
  closeItemPicker();
}

// ───────── выбор предмета из библиотеки ─────────

function openAddItemToInventory(tokenId) {
  document.getElementById('inventory-modal').dataset.addingFor = String(tokenId);
  document.getElementById('inv-item-picker').style.display = 'flex';
  renderItemPicker(tokenId, '');
}

function closeItemPicker() {
  const picker = document.getElementById('inv-item-picker');
  if (picker) picker.style.display = 'none';
  const search = document.getElementById('inv-picker-search');
  if (search) search.value = '';
}

function renderItemPicker(tokenId, search) {
  const s = (search || '').toLowerCase().trim();
  let items = LOOT_ITEMS;
  if (s) items = items.filter(i =>
    i.name.toLowerCase().includes(s) || (i.desc || '').toLowerCase().includes(s)
  );
  const rarityLabels = {
    common:'Обычный', uncommon:'Необычный', rare:'Редкий',
    'very-rare':'Очень редкий', legendary:'Легендарный'
  };
  const list = document.getElementById('inv-picker-list');
  list.innerHTML = items.slice(0, 80).map(item => {
    // Сериализуем только нужные поля чтобы избежать проблем с HTML
    const safe = JSON.stringify({
      id: item.id, name: item.name, icon: item.icon,
      rarity: item.rarity, desc: item.desc || ''
    }).replace(/'/g, "\\'").replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-2);border:1px solid var(--border);border-radius:6px;cursor:pointer;"
           onclick="addToInventory(${tokenId}, '${safe}', 1); renderItemPicker(${tokenId}, document.getElementById('inv-picker-search').value)">
        <div style="font-size:18px;width:28px;text-align:center;flex-shrink:0;">${item.icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:500;color:var(--text-0);">${escapeHtml(item.name)}</div>
          <div style="font-size:10px;color:var(--text-2);"><span class="rarity-label-${item.rarity}">${rarityLabels[item.rarity] || ''}</span></div>
        </div>
        <svg style="width:14px;height:14px;color:var(--accent);flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
      </div>`;
  }).join('');
}

// ───────── подобрать лут с карты / из сундука → инвентарь ─────────

function addLootItemToCharInventory(itemId, removeTokenId) {
  const item = getLootItem(itemId);
  if (!item) return;

  const role = window.dndOnlineGetRole?.();
  const myId = String(window.DND_ONLINE?.meta?.player?.id ?? '');

  let candidates = [];
  if (!role || role === 'master') {
    candidates = state.tokens.filter(t => t.kind === 'character' || t.kind === 'monster');
    if (candidates.length === 0) candidates = state.tokens.slice();
  } else {
    const ownChars = state.characters.filter(c => String(c.ownerId) === myId);
    const ownIds = new Set(ownChars.map(c => String(c.id)));
    candidates = state.tokens.filter(t => t.kind === 'character' && ownIds.has(String(t.sourceId)));
  }

  if (candidates.length === 0) {
    toast('Нет подходящего токена на карте', 'error');
    return;
  }

  const doAdd = (tokenId) => {
    addToInventory(tokenId, item, 1);
    // Удаляем предмет с карты если передан id токена-лута
    if (removeTokenId != null) {
      const idx = state.tokens.findIndex(t => t.id === removeTokenId);
      if (idx >= 0) {
        state.tokens.splice(idx, 1);
        if (state.selectedTokenId === removeTokenId) state.selectedTokenId = null;
        renderTokens?.();
        renderInfoPanel?.();
        window.dndOnlineSync?.('pickup_loot');
      }
    }
  };

  if (candidates.length === 1) { doAdd(candidates[0].id); return; }
  openRecipientPicker(item, candidates, doAdd);
}

function openRecipientPicker(item, candidates, onPick) {
  window._recipientPickCallback = onPick;
  document.getElementById('recipient-picker-title').textContent = `${item.icon} ${item.name} → кому?`;
  document.getElementById('recipient-picker-list').innerHTML = candidates.map(t => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg-2);border:1px solid var(--border);border-radius:6px;cursor:pointer;"
         onclick="window._recipientPickCallback(${t.id}); closeRecipientPicker();">
      <div style="font-size:18px;width:28px;text-align:center;">${t.emoji || '👤'}</div>
      <div style="font-size:13px;color:var(--text-0);">${escapeHtml(t.name)}</div>
    </div>`).join('');
  document.getElementById('recipient-picker-modal').style.display = 'flex';
}

function closeRecipientPicker() {
  document.getElementById('recipient-picker-modal').style.display = 'none';
  window._recipientPickCallback = null;
}

// ───────── патч apply для inventory ─────────
(function patchApply() {
  const interval = setInterval(() => {
    if (!window.DND_ONLINE) return;
    clearInterval(interval);
    const online = window.DND_ONLINE;
    const orig = online.handleMessage.bind(online);
    online.handleMessage = function(m) {
      if (m.type === 'state_snapshot' && m.state && typeof m.state.inventory === 'object') {
        state.inventory = m.state.inventory;
        renderInventoryIfOpen(document.getElementById('inventory-modal')?.dataset?.tokenId);
        renderInfoPanel?.();
      }
      orig(m);
    };
  }, 100);
})();

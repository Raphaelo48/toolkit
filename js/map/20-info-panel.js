// ============ INFO PANEL ============
function renderInfoPanel() {
  const panel = document.getElementById('info-panel');
  if (!state.selectedTokenId) {
    panel.innerHTML = `
      <div class="info-empty">
        <div class="info-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        </div>
        Выберите токен на карте,<br>чтобы увидеть информацию
      </div>
    `;
    return;
  }
  const token = state.tokens.find(t => t.id === state.selectedTokenId);
  if (!token) { panel.innerHTML = '<div class="info-empty">Токен не найден</div>'; return; }

  const typeLabels = { character: 'Персонаж', monster: 'Монстр', npc: 'NPC', object: 'Объект' };
  const kindLabels = { marker: '📝 Маркер', poi: '⭐ Точка интереса', hidden: '⚠ Скрытая зона', trap: '⚠ Ловушка', npc: '👤 NPC' };
  let typeLabel = typeLabels[token.type] || 'Токен';
  if (kindLabels[token.kind]) typeLabel = kindLabels[token.kind];

  let extraStats = '';
  if (token.kind === 'character') {
    const src = state.characters.find(c => c.id === token.sourceId);
    if (src) {
      extraStats = `
        <div class="stat-box">
          <div class="stat-label">Класс</div>
          <div class="stat-value" style="font-size:14px">${escapeHtml(src.charClass || '—')}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Уровень</div>
          <div class="stat-value">${src.level}</div>
        </div>
      `;
    }
  }

  const hasHP = token.hpMax != null;
  const hpPercent = hasHP ? Math.max(0, Math.min(100, (token.hpCur / token.hpMax) * 100)) : 0;
  const hpClass = hpPercent < 25 ? 'low' : hpPercent < 50 ? 'mid' : '';
  const avatarContent = token.image ? `<img src="${token.image}" alt="">` : (token.emoji || '?');

  let conditionsHtml = '';
  if (token.conditions && token.conditions.length > 0) {
    conditionsHtml = `
      <div>
        <div class="label">Состояния</div>
        <div style="display:flex; flex-wrap:wrap; gap:4px;">
          ${token.conditions.map(c => {
            const cond = CONDITIONS.find(x => x.id === c.id) || CONDITIONS[CONDITIONS.length - 1];
            const label = c.id === 'custom' ? (c.customName || 'Своё') : cond.name;
            return `<span style="background:${cond.color}; color:#fff; padding:2px 8px; border-radius:10px; font-size:10px; display:inline-flex; align-items:center; gap:4px;">
              <span>${cond.icon}</span>${escapeHtml(label)}
            </span>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  let lootActions = '';
  if (token.kind === 'loot' && token.isLootChest) {
    lootActions = `
      <button class="btn btn-sm btn-primary" style="flex:1" onclick="openLootChestForToken(${token.id})">
        <svg style="width:12px;height:12px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg>
        Открыть добычу
      </button>
    `;
  }

  panel.innerHTML = `
    <div class="info-panel">
      <div class="info-header">
        <div class="info-avatar" style="border-color:${token.color}">${avatarContent}</div>
        <div style="flex:1; min-width:0;">
          <div class="info-title">${escapeHtml(token.name)}</div>
          <div class="info-type">${typeLabel}</div>
        </div>
      </div>

      ${hasHP ? `
        <div>
          <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">
            <span class="label" style="margin:0;">Здоровье</span>
            <span style="font-family:'Cormorant Garamond',serif; font-size:18px; color:var(--text-0);">
              ${token.hpCur} <small style="color:var(--text-2); font-size:13px;">/ ${token.hpMax}</small>
            </span>
          </div>
          <div class="hp-bar">
            <div class="hp-fill ${hpClass}" style="width:${hpPercent}%"></div>
          </div>
          <div class="hp-controls" style="margin-top:8px;">
            <button class="btn btn-sm btn-danger" onclick="modTokenHP(${token.id}, -5)">−5</button>
            <button class="btn btn-sm btn-danger" onclick="modTokenHP(${token.id}, -1)">−1</button>
            <button class="btn btn-sm" onclick="modTokenHP(${token.id}, 1)">+1</button>
            <button class="btn btn-sm" onclick="modTokenHP(${token.id}, 5)">+5</button>
          </div>
        </div>
      ` : ''}

      <div class="info-stats">
        ${extraStats}
        <div class="stat-box">
          <div class="stat-label">Размер</div>
          <div class="stat-value">${token.size}<small>px</small></div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Позиция</div>
          <div class="stat-value" style="font-size:13px">${Math.round(token.x)}, ${Math.round(token.y)}</div>
        </div>
      </div>

      ${conditionsHtml}

      <div>
        <div class="label">Заметки</div>
        <div class="info-notes ${token.notes ? '' : 'empty'}">${token.notes ? escapeHtml(token.notes) : 'Нет заметок'}</div>
      </div>

      ${lootActions ? `<div style="display:flex; gap:6px;">${lootActions}</div>` : ''}

      <div style="display:flex; gap:6px;">
        <button class="btn btn-sm" style="flex:1" onclick="openTokenModal(${token.id})">
          <svg style="width:12px;height:12px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Редактировать
        </button>
        <button class="btn btn-sm btn-danger" onclick="deleteToken(${token.id})">
          <svg style="width:12px;height:12px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          Удалить
        </button>
      </div>
    </div>
  `;
}

function openLootChestForToken(tokenId) {
  const token = state.tokens.find(t => t.id === tokenId);
  if (!token || !token.isLootChest) return;
  openLootChest(token.lootId);
}

function modTokenHP(id, delta) {
  const token = state.tokens.find(t => t.id === id);
  if (!token || token.hpMax == null) return;
  const oldHP = token.hpCur;
  token.hpCur = Math.max(0, Math.min(token.hpMax, token.hpCur + delta));
  if (token.sourceId) {
    if (token.kind === 'character') {
      const src = state.characters.find(c => c.id === token.sourceId);
      if (src) src.hpCur = token.hpCur;
    } else if (token.kind === 'monster') {
      const src = state.monsters.find(m => m.id === token.sourceId);
      if (src) src.hpCur = token.hpCur;
    }
  }
  renderTokens(); renderInfoPanel();
  if (token.kind === 'character') renderCharactersList();
  if (token.kind === 'monster') renderMonstersList();
  renderInitiative();
  const diff = token.hpCur - oldHP;
  const sign = diff > 0 ? '+' : '';
  logEvent('combat', `«${token.name}» HP: ${oldHP} → ${token.hpCur} (${sign}${diff})`);
}

function closeContextMenu() {
  const m = document.getElementById('context-menu');
  if (m) m.remove();
  state.contextTokenId = null;
}

function editContextToken() {
  const id = state.contextTokenId;
  closeContextMenu();
  const token = state.tokens.find(t => t.id === id);
  if (!token) return;
  if (token.kind === 'character' && token.sourceId) openCharacterModal(token.sourceId);
  else if (token.kind === 'monster' && token.sourceId) openMonsterModal(token.sourceId);
  else openTokenModal(id);
}

function duplicateToken(id) {
  closeContextMenu();
  const t = state.tokens.find(x => x.id === id);
  if (!t) return;
  const copy = {
    ...t, id: state.nextId++, x: t.x + 30, y: t.y + 30,
    name: t.name + ' (копия)',
    conditions: t.conditions ? [...t.conditions] : []
  };
  state.tokens.push(copy);
  renderTokens();
  selectToken(copy.id);
  logEvent('token', `Дублирован токен: «${t.name}»`);
  toast('Токен дублирован');
}

function toggleCondition(tokenId, conditionId) {
  const token = state.tokens.find(t => t.id === tokenId);
  if (!token) return;
  if (!token.conditions) token.conditions = [];
  const idx = token.conditions.findIndex(c => c.id === conditionId);
  if (idx >= 0) {
    token.conditions.splice(idx, 1);
    const cond = CONDITIONS.find(c => c.id === conditionId);
    logEvent('combat', `С «${token.name}» снято состояние: ${cond ? cond.name : conditionId}`);
  } else {
    const cond = CONDITIONS.find(c => c.id === conditionId);
    if (conditionId === 'custom') {
      const customName = prompt('Название состояния:');
      if (!customName) return;
      token.conditions.push({ id: 'custom', customName });
      logEvent('combat', `На «${token.name}» наложено состояние: ${customName}`);
    } else {
      token.conditions.push({ id: conditionId });
      logEvent('combat', `На «${token.name}» наложено состояние: ${cond ? cond.name : conditionId}`);
    }
  }
  renderTokens();
  renderInfoPanel();
  // Обновить меню, не закрывая его
  const menu = document.getElementById('context-menu');
  if (menu) {
    // Перерисовываем меню в той же позиции
    const rect = menu.getBoundingClientRect();
    closeContextMenu();
    openTokenContextMenu(rect.left + 10, rect.top + 10, tokenId);
  }
}

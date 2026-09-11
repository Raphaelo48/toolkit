// ============ КОНТЕКСТНОЕ МЕНЮ ТОКЕНА ============
function openTokenContextMenu(clientX, clientY, tokenId) {
  closeContextMenu();
  state.contextTokenId = tokenId;
  const token = state.tokens.find(t => t.id === tokenId);
  if (!token) return;

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'context-menu';

  const hasHP = token.hpMax != null;

  // Упрощённый список состояний — только иконка и название
  const conditionsItems = CONDITIONS.map(c => {
    const active = token.conditions && token.conditions.some(tc => tc.id === c.id);
    return `
      <div class="ctx-condition ${active ? 'active' : ''}" onclick="toggleCondition(${tokenId}, '${c.id}')">
        <div class="ctx-condition-icon" style="background:${c.color}">${c.icon}</div>
        <span>${escapeHtml(c.name)}</span>
        ${active ? '<span style="margin-left:auto; color:var(--accent);">✓</span>' : ''}
      </div>
    `;
  }).join('');

  let lootMenuItem = '';
  if (token.kind === 'loot' && token.isLootChest) {
    lootMenuItem = `
      <div class="ctx-item" onclick="openLootChestForToken(${tokenId}); closeContextMenu();">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg>
        <span>Открыть добычу</span>
      </div>
      <div class="ctx-separator"></div>
    `;
  }

  menu.innerHTML = `
    ${lootMenuItem}
    <div class="ctx-item" onclick="rollInitForToken(${tokenId})">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
      <span>Бросить инициативу</span>
    </div>
    <div class="ctx-item" onclick="addToInitiative(${tokenId})">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
      <span>Добавить в инициативу</span>
    </div>
    <div class="ctx-separator"></div>
    ${hasHP ? `
      <div class="ctx-item" onclick="openHpModal(${tokenId})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
        <span>Изменить HP</span>
      </div>
    ` : ''}
    <div class="ctx-item" onclick="openRenameModal(${tokenId})">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      <span>Переименовать</span>
    </div>
    <div class="ctx-submenu" data-submenu="conditions">
      <div class="ctx-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        <span>Наложить состояние</span>
      </div>
      <div class="ctx-submenu-content">${conditionsItems}</div>
    </div>
    <div class="ctx-separator"></div>
    <div class="ctx-item" onclick="editContextToken()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      <span>Редактировать</span>
    </div>
    <div class="ctx-item" onclick="duplicateToken(${tokenId})">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      <span>Дублировать</span>
    </div>
    <div class="ctx-separator"></div>
    <div class="ctx-item danger" onclick="deleteToken(${tokenId}); closeContextMenu();">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
      <span>Удалить токен</span>
    </div>
  `;

  document.body.appendChild(menu);
  positionContextMenu(menu, clientX, clientY);
  adjustSubmenus(menu);
}

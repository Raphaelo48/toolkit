// ============ КОНТЕКСТНОЕ МЕНЮ КАРТЫ ============
function openMapContextMenu(clientX, clientY, mapCoords) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'context-menu';
  menu.dataset.type = 'map';

  const coordText = `${Math.round(mapCoords.x / state.grid.size)}, ${Math.round(mapCoords.y / state.grid.size)}`;

  // Упрощённые подменю — только иконка и имя
  const hasMonsters = state.monsters.length > 0;
  const monsterSubmenu = hasMonsters ? state.monsters.slice(0, 30).map(m => `
    <div class="ctx-entity-item" onclick="spawnMonsterAt(${m.id}, ${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
      <div class="ctx-entity-icon">${m.emoji || '👹'}</div>
      <div class="ctx-entity-name">${escapeHtml(m.name)}</div>
    </div>
  `).join('') : '<div class="ctx-empty-hint">Сначала создайте монстров</div>';

  const hasCharacters = state.characters.length > 0;
  const characterSubmenu = hasCharacters ? state.characters.slice(0, 30).map(c => `
    <div class="ctx-entity-item" onclick="spawnCharacterAt(${c.id}, ${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
      <div class="ctx-entity-icon">${c.emoji || '👤'}</div>
      <div class="ctx-entity-name">${escapeHtml(c.name)}</div>
    </div>
  `).join('') : '<div class="ctx-empty-hint">Сначала создайте персонажей</div>';

  menu.innerHTML = `
    <div class="ctx-header">📍 Координаты: ${coordText}</div>

    <div class="ctx-item" onclick="addMapMarker(${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
      <span class="ctx-label">Добавить маркер</span>
    </div>
    <div class="ctx-item" onclick="addPOI(${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      <span class="ctx-label">Точка интереса</span>
    </div>
    <div class="ctx-item" onclick="addHiddenArea(${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <span class="ctx-label">Скрытая зона</span>
    </div>

    <div class="ctx-separator"></div>
    <div class="ctx-header">🎲 Случайные таблицы</div>

    <div class="ctx-item" onclick="rollRandomTable('encounter_easy', ${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
      <span style="font-size:14px; width:18px; text-align:center;">🐺</span>
      <span class="ctx-label">Лёгкое столкновение</span>
    </div>
    <div class="ctx-item" onclick="rollRandomTable('encounter_medium', ${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
      <span style="font-size:14px; width:18px; text-align:center;">⚔</span>
      <span class="ctx-label">Среднее столкновение</span>
    </div>
    <div class="ctx-item" onclick="rollRandomTable('encounter_hard', ${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
      <span style="font-size:14px; width:18px; text-align:center;">🐉</span>
      <span class="ctx-label">Сложное столкновение</span>
    </div>
    <div class="ctx-item" onclick="rollRandomTable('trap', ${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
      <span style="font-size:14px; width:18px; text-align:center;">⚠</span>
      <span class="ctx-label">Случайная ловушка</span>
    </div>
    <div class="ctx-item" onclick="rollRandomTable('event', ${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
      <span style="font-size:14px; width:18px; text-align:center;">🎭</span>
      <span class="ctx-label">Случайное событие</span>
    </div>
    <div class="ctx-item" onclick="rollRandomTable('weather'); closeContextMenu();">
      <span style="font-size:14px; width:18px; text-align:center;">⛅</span>
      <span class="ctx-label">Смена погоды</span>
    </div>
    <div class="ctx-item" onclick="rollRandomTable('npc', ${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
      <span style="font-size:14px; width:18px; text-align:center;">👤</span>
      <span class="ctx-label">Случайный NPC</span>
    </div>

    <div class="ctx-separator"></div>
    <div class="ctx-header">⚡ Быстрое размещение</div>

    <div class="ctx-item" onclick="spawnQuickChest(${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>
      <span class="ctx-label">Случайный сундук</span>
    </div>
    <div class="ctx-item" onclick="spawnQuickLoot(${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>
      <span class="ctx-label">Случайный предмет</span>
    </div>

    <div class="ctx-submenu" data-submenu="characters">
      <div class="ctx-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <span class="ctx-label">Разместить персонажа</span>
      </div>
      <div class="ctx-submenu-content">${characterSubmenu}</div>
    </div>

    <div class="ctx-submenu" data-submenu="monsters">
      <div class="ctx-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>
        <span class="ctx-label">Разместить монстра</span>
      </div>
      <div class="ctx-submenu-content">${monsterSubmenu}</div>
    </div>

    ${state.lastTokenPlaced ? `
      <div class="ctx-item" onclick="pasteLastToken(${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        <span class="ctx-label">Вставить «${escapeHtml(state.lastTokenPlaced.name)}»</span>
      </div>
    ` : ''}

    <div class="ctx-separator"></div>
    <div class="ctx-header">🧭 Навигация</div>

    <div class="ctx-item" onclick="startMeasureFrom(${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.3 15.3l-6-6-9 9 6 6 9-9z"/></svg>
      <span class="ctx-label">Измерить отсюда</span>
    </div>
    <div class="ctx-item" onclick="centerViewOn(${mapCoords.x}, ${mapCoords.y}); closeContextMenu();">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
      <span class="ctx-label">Центрировать здесь</span>
    </div>
    <div class="ctx-item" onclick="fitMap(); closeContextMenu();">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/></svg>
      <span class="ctx-label">Вписать карту</span>
    </div>
  `;

  document.body.appendChild(menu);
  positionContextMenu(menu, clientX, clientY);
  adjustSubmenus(menu);
}

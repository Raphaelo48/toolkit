// ============ RANDOM TABLES ============
function rollRandomTable(tableId, x, y) {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Случайные события доступны только мастеру', 'error'); return; }
  const table = RANDOM_TABLES[tableId];
  if (!table) return;
  const entry = table.entries[Math.floor(Math.random() * table.entries.length)];
  const roll = Math.floor(Math.random() * table.entries.length) + 1;
  state.lastTableRoll = { tableId, entry, roll };

  document.getElementById('table-result-title').innerHTML = `${table.icon} ${table.name}`;
  const list = document.getElementById('table-result-list');
  list.innerHTML = `
    <div class="table-result-item" style="border-color: var(--accent-soft);">
      <div class="table-result-icon">${entry.icon}</div>
      <div style="flex:1; min-width:0;">
        <div class="table-result-name">${escapeHtml(entry.name)}</div>
        <div class="table-result-desc">${escapeHtml(entry.desc)}</div>
      </div>
      <div class="table-result-roll">${roll}</div>
    </div>
  `;
  document.getElementById('table-result-modal').style.display = 'flex';
  logEvent('dice', `🎲 ${table.name}: ${entry.icon} ${entry.name} (${roll}/${table.entries.length})`);

  if (tableId.startsWith('encounter_') && x != null && y != null && entry.monsters) {
    setTimeout(() => spawnEncounter(entry, x, y), 400);
  } else if (tableId === 'npc' && x != null && y != null) {
    setTimeout(() => {
      const token = {
        id: state.nextId++, name: entry.name, type: 'npc', emoji: entry.icon, image: null,
        color: '#b8ad98', size: 44, notes: `${entry.name}\n\n${entry.desc}`,
        x, y, kind: 'npc', conditions: []
      };
      state.tokens.push(token);
      renderTokens();
      selectToken(token.id);
    }, 400);
  } else if (tableId === 'trap' && x != null && y != null) {
    setTimeout(() => {
      const token = {
        id: state.nextId++, name: entry.name, type: 'object', emoji: entry.icon, image: null,
        color: '#c97878', size: 40, notes: `⚠ ${entry.name}\n\n${entry.desc}`,
        x, y, kind: 'trap', conditions: []
      };
      state.tokens.push(token);
      renderTokens();
      selectToken(token.id);
    }, 400);
  }
}

function spawnEncounter(entry, x, y) {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) return;
  const count = entry.count[0] + Math.floor(Math.random() * (entry.count[1] - entry.count[0] + 1));
  let placed = 0;
  entry.monsters.forEach(monsterName => {
    const existing = state.monsters.find(m => m.name === monsterName);
    const perMonster = Math.ceil(count / entry.monsters.length);
    for (let i = 0; i < perMonster && placed < count; i++) {
      const offsetX = (Math.random() - 0.5) * 120;
      const offsetY = (Math.random() - 0.5) * 120;
      if (existing) {
        spawnMonsterAt(existing.id, x + offsetX, y + offsetY);
        placed++;
      } else {
        const token = {
          id: state.nextId++,
          name: monsterName + (perMonster > 1 ? ` ${placed + 1}` : ''),
          type: 'monster', emoji: entry.icon, image: null, color: '#c97878', size: 44,
          notes: `Из таблицы: ${entry.name}`,
          x: x + offsetX, y: y + offsetY,
          kind: 'token', hpCur: 10, hpMax: 10, conditions: []
        };
        state.tokens.push(token);
        placed++;
      }
    }
  });
  if (placed > 0) {
    renderTokens();
    logEvent('combat', `⚔ Столкновение: ${entry.name} — размещено ${placed} существ`);
  }
}

function rerollLastTable() {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Переброс случайного события доступен только мастеру', 'error'); return; }
  if (!state.lastTableRoll) return;
  const table = RANDOM_TABLES[state.lastTableRoll.tableId];
  if (!table) return;
  const entry = table.entries[Math.floor(Math.random() * table.entries.length)];
  const roll = Math.floor(Math.random() * table.entries.length) + 1;
  state.lastTableRoll = { tableId: state.lastTableRoll.tableId, entry, roll };
  const list = document.getElementById('table-result-list');
  list.innerHTML = `
    <div class="table-result-item" style="border-color: var(--accent-soft);">
      <div class="table-result-icon">${entry.icon}</div>
      <div style="flex:1; min-width:0;">
        <div class="table-result-name">${escapeHtml(entry.name)}</div>
        <div class="table-result-desc">${escapeHtml(entry.desc)}</div>
      </div>
      <div class="table-result-roll">${roll}</div>
    </div>
  `;
  logEvent('dice', `🎲 ${table.name}: ${entry.icon} ${entry.name} (${roll}/${table.entries.length}) — переброс`);
}

// ============ RANDOM TABLES ============
// Бросок по таблице сначала только показывает результат. Мастер решает:
// «Перебросить» — новый результат (если уже размещён на карте, он заменяется),
// «Разместить» — поставить на карту, «Убрать» — снять с карты, «В инициативу» — бросить инициативу всем.

function rollDiceExpr(expr) {
  if (typeof expr === 'number') return expr;
  const m = String(expr || '').replace(/\s/g, '').match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return Math.max(0, Number(expr) || 0);
  const n = Number(m[1] || 1), sides = Number(m[2]);
  let sum = Number(m[3] || 0);
  for (let i = 0; i < n; i++) sum += 1 + Math.floor(Math.random() * sides);
  return sum;
}

const pickRandom = list => list[Math.floor(Math.random() * list.length)];

function generateNpc(occupation) {
  const female = Math.random() < 0.5;
  const race = pickRandom(NPC_PARTS.races)[female ? 1 : 0];
  const first = pickRandom(female ? NPC_PARTS.female : NPC_PARTS.male);
  let surname = pickRandom(NPC_PARTS.surnames);
  if (female) surname = surname.replace(/ий$/, 'ая').replace(/ый$/, 'ая').replace(/ой$/, 'ая');
  return {
    name: `${first} ${surname}`,
    race, occupation: occupation.name, occupationDesc: occupation.desc, icon: occupation.icon,
    look: pickRandom(NPC_PARTS.looks), trait: pickRandom(NPC_PARTS.traits)[female ? 1 : 0],
    want: pickRandom(NPC_PARTS.wants), secret: pickRandom(NPC_PARTS.secrets)
  };
}

function npcNotes(npc) {
  return `${npc.race}, ${npc.occupation.toLowerCase()} (${npc.occupationDesc})\n` +
    `Внешность: ${npc.look}\nХарактер: ${npc.trait}\nХочет: ${npc.want}\nСекрет: ${npc.secret}`;
}

/** Бросок по таблице: выбирает запись и сразу «докидывает» детали (сколько существ, их хиты, кто NPC). */
function rollTableResult(tableId) {
  const table = RANDOM_TABLES[tableId];
  const index = Math.floor(Math.random() * table.entries.length);
  const entry = table.entries[index];
  const result = { tableId, index, roll: index + 1, sides: table.entries.length, creatures: null, npc: null };
  if (entry.group) {
    result.creatures = [];
    entry.group.forEach(g => {
      const stats = MONSTER_STATS[g.monster] || { emoji: entry.icon, hp: '2d8', ac: 12, dex: 0 };
      const template = state.monsters.find(m => m.name === g.monster);
      const count = Math.max(1, rollDiceExpr(g.count));
      for (let i = 0; i < count; i++) {
        const hp = template ? Number(template.hpMax) || 10 : Math.max(1, rollDiceExpr(stats.hp));
        result.creatures.push({
          name: g.monster + (count > 1 ? ` ${i + 1}` : ''), base: g.monster,
          emoji: template?.emoji || stats.emoji, image: template?.image || null,
          color: template?.color || (stats.kind === 'npc' ? '#b8ad98' : '#c97878'),
          hp, ac: stats.ac, dex: stats.dex || 0, kind: stats.kind || 'monster'
        });
      }
    });
  }
  if (tableId === 'npc') result.npc = generateNpc(entry);
  return result;
}

function rollRandomTable(tableId, x, y) {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Случайные события доступны только мастеру', 'error'); return; }
  const table = RANDOM_TABLES[tableId];
  if (!table) return;
  state.lastTableRoll = { ...rollTableResult(tableId), x: x ?? null, y: y ?? null, placedTokenIds: [] };
  logTableRoll(false);
  renderTableResult();
  document.getElementById('table-result-modal').style.display = 'flex';
}

function rerollLastTable() {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Переброс случайного события доступен только мастеру', 'error'); return; }
  const last = state.lastTableRoll;
  if (!last || !RANDOM_TABLES[last.tableId]) return;
  const wasPlaced = last.placedTokenIds?.length > 0;
  if (wasPlaced) removeTablePlacement(true);
  state.lastTableRoll = { ...rollTableResult(last.tableId), x: last.x, y: last.y, placedTokenIds: [] };
  logTableRoll(true);
  if (wasPlaced) placeTableResult(true); // уже стояло на карте — сразу ставим новый вариант на то же место
  renderTableResult();
}

function logTableRoll(isReroll) {
  const r = state.lastTableRoll;
  const table = RANDOM_TABLES[r.tableId];
  const entry = table.entries[r.index];
  let text = `🎲 ${table.name}: ${entry.icon} ${entry.name} (${r.roll}/${r.sides})`;
  if (r.creatures) text += ` — ${r.creatures.length} сущ.`;
  if (r.npc) text += ` — ${r.npc.name}`;
  logEvent('dice', text + (isReroll ? ' — переброс' : ''));
}

function canPlaceTableResult(r) {
  return r && r.x != null && r.y != null && (r.creatures || r.npc || r.tableId === 'trap');
}

function renderTableResult() {
  const r = state.lastTableRoll;
  if (!r) return;
  const table = RANDOM_TABLES[r.tableId];
  const entry = table.entries[r.index];
  document.getElementById('table-result-title').innerHTML = `${table.icon} ${escapeHtml(table.name)}`;

  let details = '';
  if (r.creatures) {
    const groups = {};
    r.creatures.forEach(c => { (groups[c.base] = groups[c.base] || []).push(c); });
    details = Object.entries(groups).map(([name, list]) => `
      <div class="table-detail-row">
        <span>${escapeHtml(list[0].emoji)} ${escapeHtml(name)} ×${list.length}</span>
        <span class="table-detail-meta">КД ${list[0].ac} · хиты ${list.map(c => c.hp).join(', ')}</span>
      </div>`).join('');
  } else if (r.npc) {
    const n = r.npc;
    details = `
      <div class="table-detail-row"><b>${escapeHtml(n.name)}</b><span class="table-detail-meta">${escapeHtml(n.race)}</span></div>
      <div class="table-detail-text">
        <div><span>Внешность:</span> ${escapeHtml(n.look)}</div>
        <div><span>Характер:</span> ${escapeHtml(n.trait)}</div>
        <div><span>Хочет:</span> ${escapeHtml(n.want)}</div>
        <div><span>Секрет:</span> ${escapeHtml(n.secret)}</div>
      </div>`;
  }

  document.getElementById('table-result-list').innerHTML = `
    <div class="table-result-item" style="border-color: var(--accent-soft);">
      <div class="table-result-icon">${entry.icon}</div>
      <div style="flex:1; min-width:0;">
        <div class="table-result-name">${escapeHtml(r.npc ? r.npc.occupation : entry.name)}</div>
        <div class="table-result-desc">${escapeHtml(entry.desc)}</div>
      </div>
      <div class="table-result-roll" title="Бросок d${r.sides}">${r.roll}</div>
    </div>
    ${details ? `<div class="table-details">${details}</div>` : ''}
    ${r.placedTokenIds.length ? `<div class="table-placed-note">✓ Размещено на карте: ${r.placedTokenIds.length}. «Перебросить» заменит их новым вариантом.</div>` : ''}`;

  const placed = r.placedTokenIds.length > 0;
  const placeable = canPlaceTableResult(r);
  document.getElementById('table-result-footer').innerHTML = `
    <button class="btn" onclick="rerollLastTable()">🔄 Перебросить</button>
    ${placeable && !placed ? '<button class="btn btn-primary" onclick="placeTableResult()">📍 Разместить на карте</button>' : ''}
    ${placed ? '<button class="btn" onclick="removeTablePlacement()">✕ Убрать с карты</button>' : ''}
    ${placed && r.creatures ? '<button class="btn" onclick="rollTableInitiative()">⚔ В инициативу</button>' : ''}
    <button class="btn ${placed || !placeable ? 'btn-primary' : ''}" style="margin-left:auto" onclick="closeModal('table-result-modal')">Закрыть</button>`;
}

function placeTableResult(silent) {
  const r = state.lastTableRoll;
  if (!canPlaceTableResult(r) || r.placedTokenIds.length) return;
  const table = RANDOM_TABLES[r.tableId];
  const entry = table.entries[r.index];
  const tokens = [];

  if (r.creatures) {
    // Ставим по кругу вокруг точки, чтобы фишки не слипались
    const n = r.creatures.length;
    const radius = n === 1 ? 0 : Math.max(45, n * 9);
    r.creatures.forEach((c, i) => {
      const angle = (i / n) * Math.PI * 2;
      tokens.push({
        id: state.nextId++, name: c.name, type: c.kind === 'npc' ? 'npc' : 'monster',
        emoji: c.emoji, image: c.image, color: c.color, size: 44,
        notes: `${entry.name}\nКД ${c.ac}`,
        x: r.x + Math.cos(angle) * radius, y: r.y + Math.sin(angle) * radius,
        kind: c.kind, hpCur: c.hp, hpMax: c.hp, ac: c.ac, dex: c.dex, conditions: []
      });
    });
    logEvent('combat', `⚔ Столкновение: ${entry.name} — размещено ${tokens.length} сущ.`);
  } else if (r.npc) {
    tokens.push({
      id: state.nextId++, name: r.npc.name, type: 'npc', emoji: r.npc.icon, image: null,
      color: '#b8ad98', size: 44, notes: npcNotes(r.npc), x: r.x, y: r.y, kind: 'npc', conditions: []
    });
    logEvent('token', `👤 На карте NPC: ${r.npc.name} (${r.npc.occupation.toLowerCase()})`);
  } else if (r.tableId === 'trap') {
    tokens.push({
      id: state.nextId++, name: entry.name, type: 'object', emoji: entry.icon, image: null,
      color: '#c97878', size: 40, notes: `⚠ ${entry.name}\n\n${entry.desc}`, x: r.x, y: r.y, kind: 'trap', conditions: []
    });
  }

  state.tokens.push(...tokens);
  r.placedTokenIds = tokens.map(t => t.id);
  renderTokens();
  if (tokens.length === 1) selectToken(tokens[0].id);
  window.dndOnlineSync?.('random_table');
  if (!silent) renderTableResult();
}

function removeTablePlacement(silent) {
  const r = state.lastTableRoll;
  if (!r?.placedTokenIds?.length) return;
  const ids = new Set(r.placedTokenIds);
  state.tokens = state.tokens.filter(t => !ids.has(t.id));
  state.initiative = state.initiative.filter(i => !ids.has(i.tokenId));
  if (ids.has(state.selectedTokenId)) state.selectedTokenId = null;
  r.placedTokenIds = [];
  renderTokens(); renderInfoPanel(); renderInitiative();
  window.dndOnlineSync?.('random_table');
  if (!silent) renderTableResult();
}

function rollTableInitiative() {
  const r = state.lastTableRoll;
  const tokens = state.tokens.filter(t => r?.placedTokenIds?.includes(t.id));
  tokens.forEach(token => {
    const value = 1 + Math.floor(Math.random() * 20) + (Number(token.dex) || 0);
    state.initiative = state.initiative.filter(i => i.tokenId !== token.id);
    state.initiative.push({
      id: state.nextId++, name: token.name, value,
      tokenId: token.id, sourceId: token.sourceId, sourceKind: token.kind,
      image: token.image, emoji: token.emoji, color: token.color,
      hpCur: token.hpCur, hpMax: token.hpMax
    });
  });
  renderInitiative();
  logEvent('combat', `⚔ Инициатива брошена для ${tokens.length} сущ.`);
  toast(`Инициатива: ${tokens.map(t => `${t.name} ${state.initiative.find(i => i.tokenId === t.id)?.value}`).join(', ')}`);
  window.dndOnlineSync?.('initiative');
}

// Для старого кода, который вызывал напрямую
function spawnEncounter() { placeTableResult(); }

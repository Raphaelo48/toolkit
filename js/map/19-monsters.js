// ============ MONSTERS ============
function openMonsterModal(editId = null) {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Только мастер может управлять монстрами', 'error'); return; }
  state.editingId.mon = editId;
  const title = document.getElementById('mon-modal-title');
  const confirm = document.getElementById('mon-modal-confirm');
  if (editId) {
    const m = state.monsters.find(x => x.id === editId);
    if (!m) return;
    title.textContent = 'Редактировать монстра';
    confirm.textContent = 'Сохранить';
    document.getElementById('mon-name').value = m.name;
    document.getElementById('mon-hp-max').value = m.hpMax;
    document.getElementById('mon-hp-cur').value = m.hpCur;
    document.getElementById('mon-emoji').value = m.emoji || '';
    document.getElementById('mon-notes').value = m.notes || '';
    state.modalImages.mon = m.image;
    state.modalColors.mon = m.color;
    if (m.image) document.getElementById('mon-img-preview').innerHTML = `<img src="${m.image}" alt="">`;
    else resetImagePreview('mon-img-preview');
  } else {
    title.textContent = 'Новый монстр';
    confirm.textContent = 'Создать монстра';
    document.getElementById('mon-name').value = '';
    document.getElementById('mon-hp-max').value = 15;
    document.getElementById('mon-hp-cur').value = 15;
    document.getElementById('mon-emoji').value = '';
    document.getElementById('mon-notes').value = '';
    state.modalImages.mon = null;
    state.modalColors.mon = '#c97878';
    resetImagePreview('mon-img-preview');
  }
  updateColorSelection('mon-colors', 'mon');
  document.getElementById('monster-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('mon-name').focus(), 50);
}

function confirmAddMonster() {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Только мастер может управлять монстрами', 'error'); return; }
  const name = document.getElementById('mon-name').value.trim() || 'Монстр';
  const hpMax = parseInt(document.getElementById('mon-hp-max').value) || 15;
  const hpCur = parseInt(document.getElementById('mon-hp-cur').value) || hpMax;
  const emoji = document.getElementById('mon-emoji').value.trim();
  const notes = document.getElementById('mon-notes').value.trim();
  const image = state.modalImages.mon;
  const color = state.modalColors.mon;

  if (state.editingId.mon) {
    const m = state.monsters.find(x => x.id === state.editingId.mon);
    if (m) {
      const oldName = m.name;
      m.name = name; m.hpMax = hpMax; m.hpCur = hpCur;
      m.emoji = emoji; m.notes = notes; m.image = image; m.color = color;
      state.tokens.forEach(t => {
        if (t.kind === 'monster' && t.sourceId === m.id) {
          t.name = name; t.emoji = emoji; t.image = image;
          t.color = color; t.notes = notes;
          t.hpMax = hpMax; t.hpCur = Math.min(t.hpCur, hpMax);
        }
      });
      state.initiative.forEach(i => {
        if (i.sourceId === m.id && i.sourceKind === 'monster') i.name = name;
      });
      renderTokens(); renderInitiative(); renderInfoPanel();
      logEvent('monster', `Монстр обновлён: «${oldName}» → «${name}»`);
      toast('Монстр обновлён');
      window.dndOnlineSync?.('monster_change');
    }
  } else {
    const monster = { id: state.nextId++, name, hpMax, hpCur, emoji, notes, image, color, kind: 'monster' };
    state.monsters.push(monster);
    logEvent('monster', `Создан монстр: «${name}» (HP ${hpCur}/${hpMax})`);
    toast(`Монстр «${name}» создан`);
    window.dndOnlineSync?.('monster_change');
  }
  renderMonstersList();
  closeModal('monster-modal');
  state.editingId.mon = null;
}

function deleteMonster(id) {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Только мастер может управлять монстрами', 'error'); return; }
  const m = state.monsters.find(x => x.id === id);
  if (!m) return;
  if (!confirm(`Удалить монстра «${m.name}»?`)) return;
  state.monsters = state.monsters.filter(x => x.id !== id);
  state.tokens = state.tokens.filter(t => !(t.kind === 'monster' && t.sourceId === id));
  state.initiative = state.initiative.filter(i => !(i.sourceId === id && i.sourceKind === 'monster'));
  state.expanded.monsters.delete(id);
  if (state.selectedTokenId && !state.tokens.find(t => t.id === state.selectedTokenId)) state.selectedTokenId = null;
  renderMonstersList(); renderTokens(); renderInitiative(); renderInfoPanel();
  logEvent('monster', `Удалён монстр: «${m.name}»`);
  toast('Монстр удалён');
  window.dndOnlineSync?.('monster_delete');
}

function spawnMonsterToken(id) {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Только мастер может управлять монстрами', 'error'); return; }
  const m = state.monsters.find(x => x.id === id);
  if (!m) return;
  const area = document.getElementById('map-area');
  const rect = area.getBoundingClientRect();
  const center = screenToMap(rect.width / 2, rect.height / 2);
  spawnMonsterAt(id, center.x + (Math.random() - 0.5) * 40, center.y + (Math.random() - 0.5) * 40);
}

function renderMonstersList() {
  const list = document.getElementById('monsters-list');
  if (state.monsters.length === 0) {
    list.innerHTML = '<div class="empty-state">Нет монстров</div>';
    return;
  }
  list.innerHTML = state.monsters.map(m => {
    const avatarContent = m.image ? `<img src="${m.image}" alt="">` : (m.emoji || '👹');
    const isExpanded = state.expanded.monsters.has(m.id);
    return `
      <div>
        <div class="list-item">
          <button class="expand-toggle ${isExpanded ? 'expanded' : ''}" onclick="event.stopPropagation(); toggleExpand('monster', ${m.id})" title="${isExpanded ? 'Свернуть' : 'Развернуть'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div class="list-item-avatar" style="border-color:${m.color}" onclick="spawnMonsterToken(${m.id})" title="Разместить на карте">${avatarContent}</div>
          <div class="list-item-info" onclick="spawnMonsterToken(${m.id})" title="Разместить на карте">
            <div class="list-item-name">${escapeHtml(m.name)}</div>
            <div class="list-item-meta">HP ${m.hpCur}/${m.hpMax}</div>
          </div>
          <div class="list-item-actions">
            <button class="icon-btn" onclick="event.stopPropagation(); openMonsterModal(${m.id})" title="Редактировать">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="icon-btn" onclick="event.stopPropagation(); deleteMonster(${m.id})" title="Удалить" style="color:var(--danger)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        ${isExpanded ? renderMonsterExpanded(m) : ''}
      </div>
    `;
  }).join('');
}

function renderMonsterExpanded(m) {
  const hpPercent = Math.max(0, Math.min(100, (m.hpCur / m.hpMax) * 100));
  const hpClass = hpPercent < 25 ? 'low' : hpPercent < 50 ? 'mid' : '';
  return `
    <div class="list-item-expanded">
      <div class="expanded-stats">
        <div class="expanded-stat" style="grid-column: span 2;">
          <div class="expanded-stat-label">HP</div>
          <div class="expanded-stat-value">${m.hpCur}<span style="color:var(--text-2); font-size:11px;">/${m.hpMax}</span></div>
        </div>
        <div class="expanded-stat">
          <div class="expanded-stat-label">Состояние</div>
          <div class="expanded-stat-value" style="font-size:11px; color:${hpClass === 'low' ? 'var(--danger)' : hpClass === 'mid' ? 'var(--accent)' : 'var(--success)'}">
            ${hpPercent <= 0 ? 'Мёртв' : hpPercent < 25 ? 'Критич.' : hpPercent < 50 ? 'Ранен' : 'Здоров'}
          </div>
        </div>
      </div>
      <div class="hp-bar" style="margin-bottom:8px;">
        <div class="hp-fill ${hpClass}" style="width:${hpPercent}%"></div>
      </div>
      <div class="expanded-hp-controls">
        <button class="btn btn-sm btn-danger" onclick="modMonsterHP(${m.id}, -5)">−5</button>
        <button class="btn btn-sm btn-danger" onclick="modMonsterHP(${m.id}, -1)">−1</button>
        <button class="btn btn-sm" onclick="modMonsterHP(${m.id}, 1)">+1</button>
        <button class="btn btn-sm" onclick="modMonsterHP(${m.id}, 5)">+5</button>
      </div>
      ${m.notes ? `<div class="expanded-notes">${escapeHtml(m.notes)}</div>` : ''}
      <div class="expanded-actions" style="margin-top:8px;">
        <button class="btn btn-sm btn-primary" onclick="spawnMonsterToken(${m.id})">На карту</button>
        <button class="btn btn-sm" onclick="openMonsterModal(${m.id})">Изменить</button>
      </div>
    </div>
  `;
}

function modMonsterHP(id, delta) {
  const m = state.monsters.find(x => x.id === id);
  if (!m) return;
  const oldHP = m.hpCur;
  m.hpCur = Math.max(0, Math.min(m.hpMax, m.hpCur + delta));
  state.tokens.forEach(t => { if (t.kind === 'monster' && t.sourceId === id) t.hpCur = m.hpCur; });
  renderMonstersList(); renderTokens(); renderInfoPanel(); renderInitiative();
  const diff = m.hpCur - oldHP;
  const sign = diff > 0 ? '+' : '';
  logEvent('combat', `«${m.name}» HP: ${oldHP} → ${m.hpCur} (${sign}${diff})`);
  window.dndOnlineSync?.('monster_change');
}

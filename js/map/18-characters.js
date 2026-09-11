// ============ CHARACTERS ============
function openCharacterModal(editId = null) {
  const role = window.dndOnlineGetRole?.();
  if (role === 'player' && editId) {
    const existing = state.characters.find(x => x.id === editId);
    if (!existing || String(existing.ownerId) !== String(window.DND_ONLINE?.meta?.player?.id)) {
      toast('Можно редактировать только своего персонажа', 'error');
      return;
    }
  }
  if (role === 'player' && !editId && state.characters.filter(x => String(x.ownerId) === String(window.DND_ONLINE?.meta?.player?.id)).length >= 3) {
    toast('Можно создать максимум 3 персонажа', 'error');
    return;
  }
  state.editingId.char = editId;
  const title = document.getElementById('char-modal-title');
  const confirm = document.getElementById('char-modal-confirm');
  if (editId) {
    const c = state.characters.find(x => x.id === editId);
    if (!c) return;
    title.textContent = 'Редактировать персонажа';
    confirm.textContent = 'Сохранить';
    document.getElementById('char-name').value = c.name;
    document.getElementById('char-class').value = c.charClass || '';
    document.getElementById('char-level').value = c.level;
    document.getElementById('char-hp-max').value = c.hpMax;
    document.getElementById('char-hp-cur').value = c.hpCur;
    document.getElementById('char-emoji').value = c.emoji || '';
    state.modalImages.char = c.image;
    state.modalColors.char = c.color;
    if (c.image) document.getElementById('char-img-preview').innerHTML = `<img src="${c.image}" alt="">`;
    else resetImagePreview('char-img-preview');
  } else {
    title.textContent = 'Новый персонаж';
    confirm.textContent = 'Создать персонажа';
    document.getElementById('char-name').value = '';
    document.getElementById('char-class').value = '';
    document.getElementById('char-level').value = 1;
    document.getElementById('char-hp-max').value = 20;
    document.getElementById('char-hp-cur').value = 20;
    document.getElementById('char-emoji').value = '';
    state.modalImages.char = null;
    state.modalColors.char = '#7ba3c9';
    resetImagePreview('char-img-preview');
  }
  updateColorSelection('char-colors', 'char');
  document.getElementById('character-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('char-name').focus(), 50);
}

function confirmAddCharacter() {
  const name = document.getElementById('char-name').value.trim() || 'Персонаж';
  const charClass = document.getElementById('char-class').value.trim();
  const level = parseInt(document.getElementById('char-level').value) || 1;
  const hpMax = parseInt(document.getElementById('char-hp-max').value) || 20;
  const hpCur = parseInt(document.getElementById('char-hp-cur').value) || hpMax;
  const emoji = document.getElementById('char-emoji').value.trim();
  const image = state.modalImages.char;
  const color = state.modalColors.char;

  if (state.editingId.char) {
    const c = state.characters.find(x => x.id === state.editingId.char);
    if (c) {
      const oldName = c.name;
      c.name = name; c.charClass = charClass; c.level = level;
      c.hpMax = hpMax; c.hpCur = hpCur; c.emoji = emoji;
      c.image = image; c.color = color;
      state.tokens.forEach(t => {
        if (t.kind === 'character' && t.sourceId === c.id) {
          t.name = name; t.emoji = emoji; t.image = image;
          t.color = color; t.hpMax = hpMax; t.hpCur = Math.min(t.hpCur, hpMax);
        }
      });
      state.initiative.forEach(i => {
        if (i.sourceId === c.id && i.sourceKind === 'character') i.name = name;
      });
      renderTokens(); renderInitiative(); renderInfoPanel();
      logEvent('character', `Персонаж обновлён: «${oldName}» → «${name}»`);
      toast('Персонаж обновлён');
      window.dndOnlineSync?.('character_change');
    }
  } else {
    const character = {
      id: state.nextId++, name, charClass, level, hpMax, hpCur, emoji, image, color,
      kind: 'character',
      ownerId: window.DND_ONLINE?.meta?.player?.id || null
    };
    state.characters.push(character);
    logEvent('character', `Создан персонаж: «${name}»${charClass ? ` (${charClass}, ур. ${level})` : ''}`);
    toast(`Персонаж «${name}» создан`);
    window.dndOnlineSync?.('character_change');
  }
  renderCharactersList();
  closeModal('character-modal');
  state.editingId.char = null;
}

function deleteCharacter(id) {
  const role = window.dndOnlineGetRole?.();
  if (role === 'player') {
    const own = state.characters.find(x => x.id === id);
    if (!own || String(own.ownerId) !== String(window.DND_ONLINE?.meta?.player?.id)) {
      toast('Можно удалить только своего персонажа', 'error');
      return;
    }
  }
  const c = state.characters.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`Удалить персонажа «${c.name}»?`)) return;
  state.characters = state.characters.filter(x => x.id !== id);
  state.tokens = state.tokens.filter(t => !(t.kind === 'character' && t.sourceId === id));
  state.initiative = state.initiative.filter(i => !(i.sourceId === id && i.sourceKind === 'character'));
  state.expanded.characters.delete(id);
  if (state.selectedTokenId && !state.tokens.find(t => t.id === state.selectedTokenId)) state.selectedTokenId = null;
  renderCharactersList(); renderTokens(); renderInitiative(); renderInfoPanel();
  logEvent('character', `Удалён персонаж: «${c.name}»`);
  toast('Персонаж удалён');
  window.dndOnlineSync?.('character_delete');
}

function spawnCharacterToken(id) {
  const role = window.dndOnlineGetRole?.();
  if (role === 'player') {
    const own = state.characters.find(x => x.id === id);
    if (!own || String(own.ownerId) !== String(window.DND_ONLINE?.meta?.player?.id)) {
      toast('Можно размещать только своего персонажа', 'error');
      return;
    }
  }
  const c = state.characters.find(x => x.id === id);
  if (!c) return;
  const area = document.getElementById('map-area');
  const rect = area.getBoundingClientRect();
  const center = screenToMap(rect.width / 2, rect.height / 2);
  spawnCharacterAt(id, center.x + (Math.random() - 0.5) * 40, center.y + (Math.random() - 0.5) * 40);
}

function toggleExpand(kind, id) {
  const set = state.expanded[kind + 's'];
  if (set.has(id)) set.delete(id); else set.add(id);
  if (kind === 'character') renderCharactersList(); else renderMonstersList();
}

function renderCharactersList() {
  const list = document.getElementById('characters-list');
  if (state.characters.length === 0) {
    list.innerHTML = '<div class="empty-state">Нет персонажей</div>';
    return;
  }
  list.innerHTML = state.characters.map(c => {
    const avatarContent = c.image ? `<img src="${c.image}" alt="">` : (c.emoji || '👤');
    const meta = [c.charClass, c.level ? `ур. ${c.level}` : null].filter(Boolean).join(' · ') || 'Персонаж';
    const isExpanded = state.expanded.characters.has(c.id);
    const isPlayer = window.dndOnlineGetRole?.() === 'player';
    const isOwn = !isPlayer || String(c.ownerId) === String(window.DND_ONLINE?.meta?.player?.id);
    return `
      <div>
        <div class="list-item">
          <button class="expand-toggle ${isExpanded ? 'expanded' : ''}" onclick="event.stopPropagation(); toggleExpand('character', ${c.id})" title="${isExpanded ? 'Свернуть' : 'Развернуть'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div class="list-item-avatar" style="border-color:${c.color}" onclick="spawnCharacterToken(${c.id})" title="Разместить на карте">${avatarContent}</div>
          <div class="list-item-info" onclick="spawnCharacterToken(${c.id})" title="Разместить на карте">
            <div class="list-item-name">${escapeHtml(c.name)}</div>
            <div class="list-item-meta">${escapeHtml(meta)} · HP ${c.hpCur}/${c.hpMax}</div>
          </div>
          <div class="list-item-actions">
            <button class="icon-btn" ${isOwn ? '' : 'disabled'} onclick="event.stopPropagation(); openCharacterModal(${c.id})" title="Редактировать">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="icon-btn" ${isOwn ? '' : 'disabled'} onclick="event.stopPropagation(); deleteCharacter(${c.id})" title="Удалить" style="color:var(--danger)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        ${isExpanded ? renderCharacterExpanded(c) : ''}
      </div>
    `;
  }).join('');
}

function renderCharacterExpanded(c) {
  const hpPercent = Math.max(0, Math.min(100, (c.hpCur / c.hpMax) * 100));
  const hpClass = hpPercent < 25 ? 'low' : hpPercent < 50 ? 'mid' : '';
  return `
    <div class="list-item-expanded">
      <div class="expanded-stats">
        <div class="expanded-stat">
          <div class="expanded-stat-label">Класс</div>
          <div class="expanded-stat-value" style="font-size:12px">${escapeHtml(c.charClass || '—')}</div>
        </div>
        <div class="expanded-stat">
          <div class="expanded-stat-label">Уровень</div>
          <div class="expanded-stat-value">${c.level}</div>
        </div>
        <div class="expanded-stat">
          <div class="expanded-stat-label">HP</div>
          <div class="expanded-stat-value">${c.hpCur}<span style="color:var(--text-2); font-size:11px;">/${c.hpMax}</span></div>
        </div>
      </div>
      <div class="hp-bar" style="margin-bottom:8px;">
        <div class="hp-fill ${hpClass}" style="width:${hpPercent}%"></div>
      </div>
      <div class="expanded-hp-controls">
        <button class="btn btn-sm btn-danger" onclick="modCharacterHP(${c.id}, -5)">−5</button>
        <button class="btn btn-sm btn-danger" onclick="modCharacterHP(${c.id}, -1)">−1</button>
        <button class="btn btn-sm" onclick="modCharacterHP(${c.id}, 1)">+1</button>
        <button class="btn btn-sm" onclick="modCharacterHP(${c.id}, 5)">+5</button>
      </div>
      <div class="expanded-actions" style="margin-top:8px;">
        <button class="btn btn-sm btn-primary" ${isOwn ? '' : 'disabled'} onclick="spawnCharacterToken(${c.id})">На карту</button>
        <button class="btn btn-sm" ${isOwn ? '' : 'disabled'} onclick="openCharacterModal(${c.id})">Изменить</button>
      </div>
    </div>
  `;
}

function modCharacterHP(id, delta) {
  const c = state.characters.find(x => x.id === id);
  if (!c) return;
  const oldHP = c.hpCur;
  c.hpCur = Math.max(0, Math.min(c.hpMax, c.hpCur + delta));
  state.tokens.forEach(t => { if (t.kind === 'character' && t.sourceId === id) t.hpCur = c.hpCur; });
  renderCharactersList(); renderTokens(); renderInfoPanel(); renderInitiative();
  const diff = c.hpCur - oldHP;
  const sign = diff > 0 ? '+' : '';
  logEvent('combat', `«${c.name}» HP: ${oldHP} → ${c.hpCur} (${sign}${diff})`);
  window.dndOnlineSync?.('character_change');
}

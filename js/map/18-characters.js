// ============ CHARACTERS ============
const CHARACTER_XP_LEVELS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

function getCharacterLevelFromXP(xp) {
  const value = Math.max(0, Number(xp) || 0);
  let level = 1;
  for (let i = 0; i < CHARACTER_XP_LEVELS.length; i++) {
    if (value >= CHARACTER_XP_LEVELS[i]) level = i + 1;
  }
  return Math.min(20, level);
}

function getCharacterXPProgress(c) {
  const level = Math.max(1, Math.min(20, Number(c.level) || 1));
  const xp = Math.max(0, Number(c.xp) || 0);
  if (level >= 20) return { current: xp, next: null, percent: 100 };
  const start = CHARACTER_XP_LEVELS[level - 1];
  const next = CHARACTER_XP_LEVELS[level];
  return { current: xp, next, percent: Math.max(0, Math.min(100, ((xp - start) / (next - start)) * 100)) };
}

function awardCharacterXP(id, delta) {
  if (window.dndOnlineGetRole?.() !== 'master') {
    toast('Опыт и повышение уровня выдаёт только мастер', 'error');
    return;
  }
  const c = state.characters.find(x => x.id === id);
  if (!c) return;
  const oldXP = Math.max(0, Number(c.xp) || 0);
  const oldLevel = Math.max(1, Number(c.level) || 1);
  c.xp = Math.max(0, oldXP + Number(delta || 0));
  c.level = getCharacterLevelFromXP(c.xp);
  renderCharactersList(); renderTokens(); renderInfoPanel(); renderInitiative();
  if (c.level !== oldLevel) {
    logEvent('character', `«${c.name}»: уровень ${oldLevel} → ${c.level} (опыт ${c.xp})`);
    toast(`«${c.name}» достиг ${c.level} уровня!`);
  } else {
    logEvent('character', `«${c.name}»: опыт ${oldXP} → ${c.xp}`);
  }
  window.dndOnlineSync?.('character_progression');
}

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
    document.getElementById('char-level-display').value = c.level;
    document.getElementById('char-xp').value = Number(c.xp) || 0;
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
    document.getElementById('char-level-display').value = 1;
    document.getElementById('char-xp').value = 0;
    document.getElementById('char-hp-max').value = 20;
    document.getElementById('char-hp-cur').value = 20;
    document.getElementById('char-emoji').value = '';
    state.modalImages.char = null;
    state.modalColors.char = '#7ba3c9';
    resetImagePreview('char-img-preview');
  }
  updateColorSelection('char-colors', 'char');
  const charRole = window.dndOnlineGetRole?.();
  const progressionLocked = charRole === 'player';
  document.getElementById('char-xp').disabled = progressionLocked;
  document.getElementById('char-hp-max').disabled = progressionLocked;
  document.getElementById('char-progression-note').textContent = progressionLocked ? '🎲 Уровень, опыт и максимальный HP изменяет мастер. Вы можете менять только текущее HP.' : '👑 Мастер управляет опытом, уровнем и максимальным HP.';
  const xpField = document.getElementById('char-xp');
  if (xpField) xpField.oninput = () => { document.getElementById('char-level-display').value = getCharacterLevelFromXP(parseInt(xpField.value) || 0); };
  document.getElementById('char-level-display').value = getCharacterLevelFromXP(parseInt(document.getElementById('char-xp').value) || 0);
  document.getElementById('character-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('char-name').focus(), 50);
}

function confirmAddCharacter() {
  const name = document.getElementById('char-name').value.trim() || 'Персонаж';
  const charClass = document.getElementById('char-class').value.trim();
  const role = window.dndOnlineGetRole?.();
  const xpInput = Math.max(0, parseInt(document.getElementById('char-xp').value) || 0);
  const hpMaxInput = Math.max(1, parseInt(document.getElementById('char-hp-max').value) || 20);
  const existingCharacter = state.editingId.char ? state.characters.find(x => x.id === state.editingId.char) : null;
  const level = role === 'player' && existingCharacter ? existingCharacter.level : Math.max(1, Math.min(20, getCharacterLevelFromXP(xpInput)));
  const xp = role === 'player' && existingCharacter ? (Number(existingCharacter.xp) || 0) : xpInput;
  const hpMax = role === 'player' && existingCharacter ? existingCharacter.hpMax : hpMaxInput;
  const hpCur = parseInt(document.getElementById('char-hp-cur').value) || hpMax;
  const emoji = document.getElementById('char-emoji').value.trim();
  const image = state.modalImages.char;
  const color = state.modalColors.char;

  if (state.editingId.char) {
    const c = state.characters.find(x => x.id === state.editingId.char);
    if (c) {
      const oldName = c.name;
      c.name = name; c.charClass = charClass; c.level = level;
      c.xp = xp; c.hpMax = hpMax; c.hpCur = Math.min(hpCur, hpMax); c.emoji = emoji;
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
      id: state.nextId++, name, charClass, level, xp, hpMax, hpCur: Math.min(hpCur, hpMax), emoji, image, color,
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
        <button class="btn btn-sm" onclick="setCharacterHPPrompt(${c.id})">HP…</button>
      </div>
      ${window.dndOnlineGetRole?.() === 'master' ? `
      <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
        <div style="font-size:11px;color:var(--text-2);margin-bottom:6px;">📈 Прокачка · XP ${Number(c.xp)||0}${Number(c.level)>=20 ? '' : ` / ${CHARACTER_XP_LEVELS[Math.max(0,(Number(c.level)||1))]}`}</div>
        <div class="hp-bar" style="margin-bottom:7px;"><div class="hp-fill" style="width:${getCharacterXPProgress(c).percent}%"></div></div>
        <div class="expanded-hp-controls">
          <button class="btn btn-sm btn-danger" onclick="awardCharacterXP(${c.id}, -100)">−100 XP</button>
          <button class="btn btn-sm" onclick="awardCharacterXP(${c.id}, 100)">+100 XP</button>
          <button class="btn btn-sm" onclick="awardCharacterXP(${c.id}, 500)">+500 XP</button>
        </div>
      </div>` : ''}
      <div class="expanded-actions" style="margin-top:8px;">
        <button class="btn btn-sm btn-primary" ${isOwn ? '' : 'disabled'} onclick="spawnCharacterToken(${c.id})">На карту</button>
        <button class="btn btn-sm" ${isOwn ? '' : 'disabled'} onclick="openCharacterModal(${c.id})">Изменить</button>
      </div>
    </div>
  `;
}

function modCharacterHP(id, delta) {
  const c = state.characters.find(x => x.id === id);
  const role = window.dndOnlineGetRole?.();
  if (role === 'player' && (!c || String(c.ownerId) !== String(window.DND_ONLINE?.meta?.player?.id))) { toast('Можно изменять HP только своего персонажа', 'error'); return; }
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


function setCharacterHPPrompt(id) {
  const c = state.characters.find(x => x.id === id);
  if (!c) return;
  const role = window.dndOnlineGetRole?.();
  if (role === 'player' && String(c.ownerId) !== String(window.DND_ONLINE?.meta?.player?.id)) {
    toast('Можно изменять HP только своего персонажа', 'error'); return;
  }
  const value = prompt(`Текущее HP «${c.name}» (0–${c.hpMax}):`, String(c.hpCur));
  if (value === null) return;
  const hp = Number.parseInt(value, 10);
  if (!Number.isFinite(hp)) { toast('Введите целое число', 'error'); return; }
  const oldHP = c.hpCur;
  c.hpCur = Math.max(0, Math.min(c.hpMax, hp));
  state.tokens.forEach(t => { if (t.kind === 'character' && t.sourceId === id) t.hpCur = c.hpCur; });
  renderCharactersList(); renderTokens(); renderInfoPanel(); renderInitiative();
  logEvent('combat', `«${c.name}» HP: ${oldHP} → ${c.hpCur}`);
  window.dndOnlineSync?.('character_hp');
}

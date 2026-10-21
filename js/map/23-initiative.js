// ============ INITIATIVE ============
// Игрок бросает инициативу один раз за своего персонажа (кубик бросает сервер),
// всё остальное — порядок, ходы, удаление — только мастер.

function initMasterOnly() {
  if (isPlayerRole()) { toast('Ходом боя управляет мастер', 'error'); return false; }
  return true;
}

/** Игрок: бросить инициативу за своего персонажа на поле. Мастер/без онлайна — обычный бросок. */
function rollMyInitiative(tokenId) {
  const token = tokenId != null ? state.tokens.find(t => t.id === tokenId) : (isPlayerRole() ? myTokenOnMap() : null);
  if (!token) { toast(isPlayerRole() ? 'Сначала поставьте своего персонажа на поле' : 'Выберите фишку', 'error'); return; }
  if (!isPlayerRole()) { rollInitForToken(token.id); return; }
  if (!canControlToken(token)) { toast('Бросать инициативу можно только за своего персонажа', 'error'); return; }
  if (state.initiative.some(i => i.tokenId === token.id)) { toast('Инициатива уже брошена. Изменить её может только мастер.', 'error'); return; }
  const c = state.characters.find(x => x.id === token.sourceId);
  const answer = prompt(`Модификатор инициативы «${token.name}» (обычно бонус Ловкости):`, String(c?.initMod ?? 0));
  if (answer === null) return;
  const mod = Math.max(-5, Math.min(10, Math.trunc(Number(answer)) || 0));
  if (c && c.initMod !== mod) { c.initMod = mod; window.dndOnlineSync?.('init_mod'); }
  if (!window.DND_ONLINE?.sendInitiativeRoll?.(token.id, mod)) toast('Нет связи с сервером', 'error');
}

function rollInitForToken(tokenId) {
  closeContextMenu();
  if (!initMasterOnly()) return;
  const token = state.tokens.find(t => t.id === tokenId);
  if (!token) return;
  const roll = Math.floor(Math.random() * 20) + 1;
  state.initiative = state.initiative.filter(i => i.tokenId !== tokenId);
  state.initiative.push({
    id: state.nextId++, name: token.name, value: roll,
    tokenId: tokenId, sourceId: token.sourceId, sourceKind: token.kind,
    image: token.image, emoji: token.emoji, color: token.color,
    hpCur: token.hpCur, hpMax: token.hpMax
  });
  renderInitiative();
  logEvent('combat', `Бросок инициативы: «${token.name}» — ${roll}`);
  toast(`${token.name}: инициатива ${roll}`);
  window.dndOnlineSync?.('initiative');
}

function addToInitiative(tokenId) {
  closeContextMenu();
  if (!initMasterOnly()) return;
  const token = state.tokens.find(t => t.id === tokenId);
  if (!token) return;
  if (state.initiative.some(i => i.tokenId === tokenId)) { toast('Уже в инициативе'); return; }
  state.initiative.push({
    id: state.nextId++, name: token.name, value: 0,
    tokenId: tokenId, sourceId: token.sourceId, sourceKind: token.kind,
    image: token.image, emoji: token.emoji, color: token.color,
    hpCur: token.hpCur, hpMax: token.hpMax
  });
  renderInitiative();
  logEvent('combat', `«${token.name}» добавлен в инициативу`);
  toast(`${token.name} добавлен в инициативу`);
  window.dndOnlineSync?.('initiative');
}

function sortInit() {
  if (!initMasterOnly()) return;
  state.initiative.sort((a, b) => b.value - a.value);
  state.initIndex = 0;
  renderInitiative();
  logEvent('combat', 'Инициатива отсортирована');
  toast('Инициатива отсортирована');
  window.dndOnlineSync?.('initiative');
}

function nextInit() {
  if (!initMasterOnly()) return;
  if (state.initiative.length === 0) { toast('Нет участников'); return; }
  state.initIndex++;
  if (state.initIndex >= state.initiative.length) {
    state.initIndex = 0;
    state.initRound++;
    logEvent('combat', `Начался раунд ${state.initRound}`);
  }
  renderInitiative();
  const current = state.initiative[state.initIndex];
  logEvent('combat', `Ход: «${current.name}» (раунд ${state.initRound})`);
  toast(`Ход: ${current.name}`);
  window.dndOnlineSync?.('initiative');
}

function resetInit() {
  if (!initMasterOnly()) return;
  if (!confirm('Сбросить инициативу?')) return;
  state.initiative = [];
  state.initIndex = 0;
  state.initRound = 1;
  renderInitiative();
  logEvent('combat', 'Инициатива сброшена');
  toast('Инициатива сброшена');
  window.dndOnlineSync?.('initiative');
}

function removeFromInit(initId) {
  if (!initMasterOnly()) return;
  const idx = state.initiative.findIndex(i => i.id === initId);
  const item = state.initiative[idx];
  state.initiative = state.initiative.filter(i => i.id !== initId);
  // Убрали того, кто ходил раньше текущего, — текущий ход не должен перескакивать
  if (idx >= 0 && idx < state.initIndex) state.initIndex--;
  if (state.initIndex >= state.initiative.length) state.initIndex = 0;
  renderInitiative();
  if (item) logEvent('combat', `«${item.name}» убран из инициативы`);
  window.dndOnlineSync?.('initiative');
}

function renderInitiative() {
  const list = document.getElementById('init-list');
  const empty = document.getElementById('init-empty');
  document.getElementById('init-round').textContent = state.initRound;

  if (state.initiative.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const master = !isPlayerRole();
  const rollBtn = document.getElementById('init-roll-mine');
  if (rollBtn) {
    const mine = isPlayerRole() ? myTokenOnMap() : null;
    const done = mine && state.initiative.some(i => i.tokenId === mine.id);
    rollBtn.disabled = !mine || done;
    rollBtn.textContent = !mine ? '⚡ Поставьте персонажа на поле' : done ? '✓ Инициатива брошена' : '⚡ Бросить инициативу';
  }

  list.innerHTML = state.initiative.map((item, i) => {
    const avatarContent = item.image ? `<img src="${item.image}" alt="">` : (item.emoji || '⚔');
    // HP берём с самой фишки: копия в списке устаревает
    const token = state.tokens.find(t => t.id === item.tokenId);
    const hpCur = token ? token.hpCur : item.hpCur, hpMax = token ? token.hpMax : item.hpMax;
    const hpText = hpMax != null && hpCur != null ? `${hpCur}/${hpMax}` : '';
    return `
      <div class="init-row ${i === state.initIndex ? 'active' : ''}" onclick="selectInitToken(${item.tokenId})">
        <div class="init-avatar" style="border-color:${item.color || 'var(--border-strong)'}">${avatarContent}</div>
        <div class="init-val">${item.value}</div>
        <div class="init-name">${escapeHtml(item.name)}</div>
        ${hpText ? `<div class="init-hp">${hpText}</div>` : ''}
        ${master ? `<button class="icon-btn" onclick="event.stopPropagation(); editInitValue(${item.id})" title="Изменить значение">✎</button>
        <button class="icon-btn" onclick="event.stopPropagation(); removeFromInit(${item.id})" title="Убрать">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>` : ''}
      </div>
    `;
  }).join('');
}

function selectInitToken(tokenId) {
  if (tokenId) selectToken(tokenId);
}

/** Мастер: исправить значение инициативы. */
function editInitValue(initId) {
  if (!initMasterOnly()) return;
  const item = state.initiative.find(i => i.id === initId);
  if (!item) return;
  const v = prompt(`Инициатива «${item.name}»:`, String(item.value));
  if (v === null) return;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) { toast('Введите число', 'error'); return; }
  item.value = n;
  renderInitiative();
  logEvent('combat', `Инициатива «${item.name}» изменена на ${n}`);
  window.dndOnlineSync?.('initiative');
}

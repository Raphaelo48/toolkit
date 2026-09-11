// ============ INITIATIVE ============
function rollInitForToken(tokenId) {
  closeContextMenu();
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
}

function addToInitiative(tokenId) {
  closeContextMenu();
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
}

function sortInit() {
  state.initiative.sort((a, b) => b.value - a.value);
  state.initIndex = 0;
  renderInitiative();
  logEvent('combat', 'Инициатива отсортирована');
  toast('Инициатива отсортирована');
}

function nextInit() {
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
}

function resetInit() {
  if (!confirm('Сбросить инициативу?')) return;
  state.initiative = [];
  state.initIndex = 0;
  state.initRound = 1;
  renderInitiative();
  logEvent('combat', 'Инициатива сброшена');
  toast('Инициатива сброшена');
}

function removeFromInit(initId) {
  const item = state.initiative.find(i => i.id === initId);
  state.initiative = state.initiative.filter(i => i.id !== initId);
  if (state.initIndex >= state.initiative.length) state.initIndex = Math.max(0, state.initiative.length - 1);
  renderInitiative();
  if (item) logEvent('combat', `«${item.name}» убран из инициативы`);
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

  list.innerHTML = state.initiative.map((item, i) => {
    const avatarContent = item.image ? `<img src="${item.image}" alt="">` : (item.emoji || '⚔');
    const hpText = item.hpMax != null ? `${item.hpCur}/${item.hpMax}` : '';
    return `
      <div class="init-row ${i === state.initIndex ? 'active' : ''}" onclick="selectInitToken(${item.tokenId})">
        <div class="init-avatar" style="border-color:${item.color || 'var(--border-strong)'}">${avatarContent}</div>
        <div class="init-val">${item.value}</div>
        <div class="init-name">${escapeHtml(item.name)}</div>
        ${hpText ? `<div class="init-hp">${hpText}</div>` : ''}
        <button class="icon-btn" onclick="event.stopPropagation(); removeFromInit(${item.id})" title="Убрать">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    `;
  }).join('');
}

function selectInitToken(tokenId) {
  if (tokenId) selectToken(tokenId);
}

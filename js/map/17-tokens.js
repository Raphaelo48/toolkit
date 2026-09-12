// ============ TOKENS ============
function selectToken(id) {
  state.selectedTokenId = id;
  document.querySelectorAll('.token').forEach(el => {
    el.classList.toggle('selected', parseInt(el.dataset.id) === id);
  });
  renderInfoPanel();
}

function renderTokens() {
  const layer = document.getElementById('tokens-layer');
  layer.innerHTML = '';
  state.tokens.forEach(t => {
    const el = document.createElement('div');
    el.className = 'token' + (t.id === state.selectedTokenId ? ' selected' : '');
    if (t.kind === 'poi' || t.kind === 'marker' || t.kind === 'hidden') el.classList.add('poi-token');
    el.dataset.id = t.id;
    el.style.left = (t.x - t.size / 2) + 'px';
    el.style.top = (t.y - t.size / 2) + 'px';
    el.style.width = t.size + 'px';
    el.style.height = t.size + 'px';
    el.style.borderColor = t.color;

    const inner = document.createElement('div');
    inner.className = 'token-inner';
    if (t.image) inner.innerHTML = `<img class="token-img" src="${t.image}" alt="">`;
    else if (t.emoji) inner.innerHTML = `<span class="token-emoji">${t.emoji}</span>`;
    else inner.innerHTML = `<span class="token-emoji" style="color:var(--text-2)">?</span>`;
    el.appendChild(inner);

    const nameLabel = document.createElement('div');
    nameLabel.className = 'token-name';
    nameLabel.textContent = t.name || 'Токен';
    el.appendChild(nameLabel);

    if (t.hpMax != null) {
      const hpBadge = document.createElement('div');
      hpBadge.className = 'token-hp-badge';
      const pct = (t.hpCur / t.hpMax) * 100;
      if (pct < 25) hpBadge.classList.add('low');
      else if (pct < 50) hpBadge.classList.add('mid');
      hpBadge.textContent = t.hpCur;
      el.appendChild(hpBadge);
    }

    if (t.conditions && t.conditions.length > 0) {
      const condWrap = document.createElement('div');
      condWrap.className = 'token-conditions';
      t.conditions.forEach(c => {
        const cond = CONDITIONS.find(x => x.id === c.id) || CONDITIONS[CONDITIONS.length - 1];
        const badge = document.createElement('div');
        badge.className = 'condition-badge';
        badge.style.background = cond.color;
        badge.style.color = '#fff';
        badge.textContent = cond.icon;
        badge.title = c.id === 'custom' ? (c.customName || 'Своё состояние') : cond.name;
        condWrap.appendChild(badge);
      });
      el.appendChild(condWrap);
    }

    layer.appendChild(el);
  });
}

function openTokenModal(editId = null) {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) {
    toast('Только мастер может управлять токенами', 'error');
    return;
  }
  state.editingId.token = editId;
  const title = document.getElementById('token-modal-title');
  const confirm = document.getElementById('token-modal-confirm');
  if (editId) {
    const t = state.tokens.find(x => x.id === editId);
    if (!t) return;
    title.textContent = 'Редактировать токен';
    confirm.textContent = 'Сохранить';
    document.getElementById('token-name').value = t.name;
    document.getElementById('token-type').value = t.type;
    document.getElementById('token-emoji').value = t.emoji || '';
    document.getElementById('token-notes').value = t.notes || '';
    document.getElementById('token-size').value = t.size;
    document.getElementById('token-size-val').textContent = t.size;
    state.modalImages.token = t.image;
    state.modalColors.token = t.color;
    if (t.image) document.getElementById('token-img-preview').innerHTML = `<img src="${t.image}" alt="">`;
    else resetImagePreview('token-img-preview');
  } else {
    title.textContent = 'Новый токен';
    confirm.textContent = 'Создать токен';
    document.getElementById('token-name').value = '';
    document.getElementById('token-type').value = 'character';
    document.getElementById('token-emoji').value = '';
    document.getElementById('token-notes').value = '';
    document.getElementById('token-size').value = 50;
    document.getElementById('token-size-val').textContent = '50';
    state.modalImages.token = null;
    state.modalColors.token = '#d4a574';
    resetImagePreview('token-img-preview');
  }
  updateColorSelection('token-colors', 'token');
  document.getElementById('token-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('token-name').focus(), 50);
}

function confirmAddToken() {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) return;
  const name = document.getElementById('token-name').value.trim() || 'Токен';
  const type = document.getElementById('token-type').value;
  const emoji = document.getElementById('token-emoji').value.trim();
  const notes = document.getElementById('token-notes').value.trim();
  const size = parseInt(document.getElementById('token-size').value) || 50;
  const image = state.modalImages.token;
  const color = state.modalColors.token;

  if (state.editingId.token) {
    const t = state.tokens.find(x => x.id === state.editingId.token);
    if (t) {
      const oldName = t.name;
      t.name = name; t.type = type; t.emoji = emoji; t.notes = notes;
      t.size = size; t.image = image; t.color = color;
      renderTokens();
      renderInfoPanel();
      logEvent('token', `Токен обновлён: «${oldName}» → «${name}»`);
      toast('Токен обновлён');
      window.dndOnlineSync?.('token_change');
    }
  } else {
    const area = document.getElementById('map-area');
    const rect = area.getBoundingClientRect();
    const center = screenToMap(rect.width / 2, rect.height / 2);
    const token = {
      id: state.nextId++, name, type, emoji, notes, size, image, color,
      x: center.x, y: center.y, kind: 'token', conditions: []
    };
    state.tokens.push(token);
    state.lastTokenPlaced = { ...token };
    renderTokens();
    selectToken(token.id);
    logEvent('token', `Создан токен: «${name}»`);
    toast(`Токен «${name}» добавлен`);
  }
  closeModal('token-modal');
  state.editingId.token = null;
}

function deleteToken(id) {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) {
    toast('Только мастер может удалять токены', 'error');
    return;
  }
  const token = state.tokens.find(t => t.id === id);
  if (!token) return;
  if (!confirm(`Удалить токен «${token.name}»?`)) return;
  state.initiative = state.initiative.filter(i => i.tokenId !== id);
  state.tokens = state.tokens.filter(t => t.id !== id);
  if (state.selectedTokenId === id) state.selectedTokenId = null;
  renderTokens();
  renderInfoPanel();
  renderInitiative();
  logEvent('token', `Удалён токен: «${token.name}»`);
  toast('Токен удалён');
  window.dndOnlineSync?.('token_delete');
}

// ============ HP MODAL ============
function openHpModal(tokenId) {
  closeContextMenu();
  state.hpModalTokenId = tokenId;
  const token = state.tokens.find(t => t.id === tokenId);
  if (!token) return;
  document.getElementById('hp-modal-current').textContent = token.hpCur;
  document.getElementById('hp-modal-max').textContent = token.hpMax;
  document.getElementById('hp-modal-input').value = token.hpCur;
  document.getElementById('hp-modal').style.display = 'flex';
  setTimeout(() => {
    const inp = document.getElementById('hp-modal-input');
    inp.focus();
    inp.select();
  }, 50);
}

function hpModalDelta(d) {
  const inp = document.getElementById('hp-modal-input');
  const cur = parseInt(inp.value) || 0;
  const token = state.tokens.find(t => t.id === state.hpModalTokenId);
  if (!token) return;
  inp.value = Math.max(0, Math.min(token.hpMax, cur + d));
}

function hpModalSet(v) { document.getElementById('hp-modal-input').value = v; }

function hpModalSetMax() {
  const token = state.tokens.find(t => t.id === state.hpModalTokenId);
  if (!token) return;
  document.getElementById('hp-modal-input').value = token.hpMax;
}

function confirmHpModal() {
  const token = state.tokens.find(t => t.id === state.hpModalTokenId);
  if (!token) return;
  const v = parseInt(document.getElementById('hp-modal-input').value);
  if (isNaN(v)) return;
  const oldHP = token.hpCur;
  token.hpCur = Math.max(0, Math.min(token.hpMax, v));
  if (token.sourceId) {
    if (token.kind === 'character') {
      const src = state.characters.find(c => c.id === token.sourceId);
      if (src) src.hpCur = token.hpCur;
    } else if (token.kind === 'monster') {
      const src = state.monsters.find(m => m.id === token.sourceId);
      if (src) src.hpCur = token.hpCur;
    }
  }
  closeModal('hp-modal');
  renderTokens(); renderInfoPanel(); renderCharactersList(); renderMonstersList(); renderInitiative();
  const diff = token.hpCur - oldHP;
  const sign = diff > 0 ? '+' : '';
  logEvent('combat', `«${token.name}» HP: ${oldHP} → ${token.hpCur} (${sign}${diff})`);
  toast('HP обновлены');
}

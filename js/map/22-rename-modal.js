// ============ RENAME MODAL ============
function openRenameModal(tokenId) {
  closeContextMenu();
  state.renameTokenId = tokenId;
  const token = state.tokens.find(t => t.id === tokenId);
  if (!token) return;
  document.getElementById('rename-input').value = token.name;
  document.getElementById('rename-modal').style.display = 'flex';
  setTimeout(() => {
    const inp = document.getElementById('rename-input');
    inp.focus();
    inp.select();
  }, 50);
}

function confirmRename() {
  const token = state.tokens.find(t => t.id === state.renameTokenId);
  if (!token) return;
  const newName = document.getElementById('rename-input').value.trim();
  if (!newName) return;
  const oldName = token.name;
  token.name = newName;
  if (token.sourceId) {
    if (token.kind === 'character') {
      const src = state.characters.find(c => c.id === token.sourceId);
      if (src) src.name = newName;
    } else if (token.kind === 'monster') {
      const src = state.monsters.find(m => m.id === token.sourceId);
      if (src) src.name = newName;
    }
  }
  state.initiative.forEach(i => { if (i.tokenId === token.id) i.name = newName; });
  closeModal('rename-modal');
  renderTokens(); renderInfoPanel(); renderCharactersList(); renderMonstersList(); renderInitiative();
  logEvent('token', `Токен переименован: «${oldName}» → «${newName}»`);
  toast('Имя изменено');
}

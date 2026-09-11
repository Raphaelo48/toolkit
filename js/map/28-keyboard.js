// ============ KEYBOARD ============
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === 'Escape') {
      closeModal('token-modal');
      closeModal('character-modal');
      closeModal('monster-modal');
      closeModal('hp-modal');
      closeModal('rename-modal');
      closeModal('loot-content-modal');
      closeModal('dice-modal');
      closeModal('table-result-modal');
      closeContextMenu();
      selectToken(null);
      clearMeasure();
      return;
    }
    if (e.key === '1') setTool('select');
    else if (e.key === '2') setTool('pan');
    else if (e.key === '3') openTokenModal();
    else if (e.key === '4') openCharacterModal();
    else if (e.key === '5') openMonsterModal();
    else if (e.key === '6') toggleGrid();
    else if (e.key === 'b' || e.key === 'B' || e.key === 'и' || e.key === 'И') setTool('brush');
    else if (e.key === 'e' || e.key === 'E' || e.key === 'у' || e.key === 'У') setTool('eraser');
    else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') setTool('fog');
    else if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') setTool('measure');
    else if (e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') setTool('text');
    else if (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') setTool('shape');
    else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedTokenId) {
      deleteToken(state.selectedTokenId);
    }
  });
}

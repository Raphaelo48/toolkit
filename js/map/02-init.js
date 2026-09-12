// ============ INIT ============
window.addEventListener('DOMContentLoaded', () => {
  renderColorSwatches('token-colors', 'token');
  renderColorSwatches('char-colors', 'char');
  renderColorSwatches('mon-colors', 'mon');
  setupMapInteraction();
  setupKeyboard();
  setupDrawControls();
  loadFromStorage();
  renderAll();
  updateGrid();
  updateMapTransform();
  updateDrawBarVisibility();
  renderLogFilters();
  renderLog();
  renderLootCategories();
  renderLoot();
  renderAtmosphere();
  updateDiceButtons();

  logEvent('system', 'Сессия начата');
  logEvent('map', '💡 ПКМ по карте — быстрые действия · Правая панель: 6 вкладок');

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) closeContextMenu();
  });
});

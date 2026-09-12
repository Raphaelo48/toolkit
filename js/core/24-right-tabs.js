// ============ RIGHT TABS ============
function switchRightTab(tab) {
  // Игроки не могут открыть вкладку Награды
  const role = window.dndOnlineGetRole?.();
  if (tab === 'loot' && role === 'player') return;

  document.querySelectorAll('.right-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('.right-tab-content').forEach(c => {
    c.classList.toggle('active', c.dataset.content === tab);
  });
  if (tab === 'log') { renderLog(); renderLogFilters(); }
  if (tab === 'loot') { renderLoot(); renderLootCategories(); }
}

// Скрываем/показываем вкладку Награды в зависимости от роли
function applyRoleTabVisibility() {
  const role = window.dndOnlineGetRole?.();
  const lootTab = document.getElementById('tab-loot-btn');
  if (!lootTab) return;
  if (role === 'player') {
    lootTab.style.display = 'none';
    // Если игрок был на вкладке наград — переключить на инфо
    if (document.querySelector('.right-tab[data-tab="loot"]')?.classList.contains('active')) {
      switchRightTab('info');
    }
  } else {
    lootTab.style.display = '';
  }
}

// Вызывается из campaigns.js при подключении к комнате
window.dndApplyRoleUI = applyRoleTabVisibility;

// ============ RIGHT TABS ============
function switchRightTab(tab) {
  document.querySelectorAll('.right-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('.right-tab-content').forEach(c => {
    c.classList.toggle('active', c.dataset.content === tab);
  });
  if (tab === 'log') { renderLog(); renderLogFilters(); }
  if (tab === 'loot') { renderLoot(); renderLootCategories(); }
}

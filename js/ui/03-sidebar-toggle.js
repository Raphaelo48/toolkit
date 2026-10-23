// ============ SIDEBAR TOGGLE ============
function toggleSidebar(side) {
  if (side === 'left') {
    state.sidebarLeftCollapsed = !state.sidebarLeftCollapsed;
    document.getElementById('app').classList.toggle('sidebar-left-collapsed', state.sidebarLeftCollapsed);
    document.body.classList.toggle('sidebar-left-is-collapsed', state.sidebarLeftCollapsed);
  } else {
    state.sidebarRightCollapsed = !state.sidebarRightCollapsed;
    document.getElementById('app').classList.toggle('sidebar-right-collapsed', state.sidebarRightCollapsed);
    document.body.classList.toggle('sidebar-right-is-collapsed', state.sidebarRightCollapsed);
  }
}

// ============ КОМПАКТНАЯ ЛЕВАЯ ПАНЕЛЬ ============
// Разделы сворачиваются по клику на заголовок; что свёрнуто — запоминается в браузере.
const SECTIONS_KEY = 'dnd-collapsed-sections';

function sectionKey(sec) {
  const t = sec.querySelector('.section-title');
  return (t?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function loadCollapsedSections() {
  try { return new Set(JSON.parse(localStorage.getItem(SECTIONS_KEY) || '[]')); } catch { return new Set(); }
}

function setupCollapsibleSections() {
  const collapsed = loadCollapsedSections();
  document.querySelectorAll('.sidebar-left > .section').forEach(sec => {
    const title = sec.querySelector('.section-title');
    if (!title) return;
    const key = sectionKey(sec);
    title.classList.add('collapsible');
    title.insertAdjacentHTML('afterbegin', '<span class="section-caret">▾</span>');
    if (collapsed.has(key)) sec.classList.add('collapsed');
    title.addEventListener('click', e => {
      if (e.target.closest('button, input, select, .vision-badge')) return;
      sec.classList.toggle('collapsed');
      const set = loadCollapsedSections();
      sec.classList.contains('collapsed') ? set.add(key) : set.delete(key);
      try { localStorage.setItem(SECTIONS_KEY, JSON.stringify([...set])); } catch {}
    });
  });
  // Подсказки с горячими клавишами (в две колонки клавиши не показываются)
  document.querySelectorAll('.tool-grid .tool-item').forEach(b => {
    const key = b.querySelector('.tool-key')?.textContent.trim();
    if (!b.title) b.title = b.querySelector('.tool-label')?.textContent.trim() + (key && key !== '—' && b.dataset.tool !== 'grid' ? ` (${key})` : '');
  });
}

// ============ МЕНЮ «ФАЙЛ» В ВЕРХНЕЙ ПАНЕЛИ ============
function toggleFileMenu(e) {
  e?.stopPropagation();
  const menu = document.getElementById('file-menu');
  if (menu.classList.contains('open')) { closeFileMenu(); return; }
  const r = document.getElementById('file-btn').getBoundingClientRect();
  menu.style.top = (r.bottom + 6) + 'px';
  menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  menu.classList.add('open');
  setTimeout(() => document.addEventListener('mousedown', fileMenuOutside), 0);
}
function fileMenuOutside(e) { if (!e.target.closest('.file-menu-wrap')) closeFileMenu(); }
function closeFileMenu() {
  document.getElementById('file-menu')?.classList.remove('open');
  document.removeEventListener('mousedown', fileMenuOutside);
}

window.addEventListener('DOMContentLoaded', setupCollapsibleSections);

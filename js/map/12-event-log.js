// ============ EVENT LOG ============
function logEvent(type, message, data = null) {
  const entry = { id: Date.now() + Math.random(), type, message, data, timestamp: Date.now() };
  state.eventLog.unshift(entry);
  if (state.eventLog.length > MAX_LOG_ENTRIES) state.eventLog.length = MAX_LOG_ENTRIES;
  const logTab = document.querySelector('.right-tab[data-tab="log"]');
  if (logTab && logTab.classList.contains('active')) renderLog();
  renderLogFilters();

  // В онлайн-комнате журнал является общей частью состояния и редактируется мастером.
  // Игроки могут только видеть журнал, но не отправляют свои локальные записи на сервер.
  if (window.dndOnlineGetRole?.() === 'master') {
    window.dndOnlineSync?.('event_log');
  }
}

function renderLogFilters() {
  const container = document.getElementById('log-filters');
  const counts = { all: state.eventLog.length };
  Object.keys(LOG_TYPES).forEach(k => {
    if (k !== 'all') counts[k] = state.eventLog.filter(e => e.type === k).length;
  });
  container.innerHTML = Object.entries(LOG_TYPES).map(([key, cfg]) => `
    <button class="log-filter ${state.logFilter === key ? 'active' : ''}" onclick="setLogFilter('${key}')">
      <span>${cfg.icon}</span>
      <span>${cfg.label}</span>
      <span class="log-filter-count">${counts[key] || 0}</span>
    </button>
  `).join('');
}

function setLogFilter(filter) {
  state.logFilter = filter;
  renderLogFilters();
  renderLog();
}

function renderLog() {
  const list = document.getElementById('log-list');
  const empty = document.getElementById('log-empty');
  const search = (document.getElementById('log-search').value || '').toLowerCase().trim();
  let entries = state.eventLog;
  if (state.logFilter !== 'all') entries = entries.filter(e => e.type === state.logFilter);
  if (search) entries = entries.filter(e => (e.message || '').toLowerCase().includes(search));
  if (entries.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = search ? 'Ничего не найдено' : 'Журнал событий пуст';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = entries.map(e => {
    const cfg = LOG_TYPES[e.type] || LOG_TYPES.system;
    const time = new Date(e.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `
      <div class="log-entry ${e.type}">
        <div class="log-entry-header">
          <span class="log-entry-icon">${cfg.icon}</span>
          <span class="log-entry-type">${cfg.label}</span>
          <span class="log-entry-time">${time}</span>
        </div>
        <div class="log-entry-message">${escapeHtml(e.message)}</div>
      </div>
    `;
  }).join('');
}

function clearLog() {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Очищать журнал может только мастер', 'error'); return; }
  if (state.eventLog.length === 0) return;
  if (!confirm('Очистить весь журнал событий?')) return;
  state.eventLog = [];
  renderLog();
  renderLogFilters();
  logEvent('system', 'Журнал очищен');
}

function exportLog() {
  if (state.eventLog.length === 0) { toast('Журнал пуст', 'error'); return; }
  const lines = state.eventLog.slice().reverse().map(e => {
    const time = new Date(e.timestamp).toLocaleString('ru-RU');
    const cfg = LOG_TYPES[e.type] || LOG_TYPES.system;
    return `[${time}] [${cfg.label}] ${e.message}`;
  }).join('\n');
  const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dm-toolkit-log-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  logEvent('system', 'Журнал экспортирован');
}

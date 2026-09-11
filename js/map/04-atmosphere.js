// ============ ATMOSPHERE ============
function renderAtmosphere() {
  renderAtmGroup('atm-dungeon', ATMOSPHERE.dungeon);
  renderAtmGroup('atm-nature', ATMOSPHERE.nature);
  renderAtmGroup('atm-settlement', ATMOSPHERE.settlement);
  renderAtmGroup('atm-combat', ATMOSPHERE.combat);
  renderAtmGroup('atm-night', ATMOSPHERE.night);
}

function renderAtmGroup(containerId, items) {
  const container = document.getElementById(containerId);
  container.innerHTML = items.map(item => `
    <div class="atm-card ${state.activeAtmId === item.id ? 'active' : ''}" onclick="selectAtm('${item.id}', this)">
      <div class="atm-card-icon">${item.icon}</div>
      <div class="atm-card-name">${escapeHtml(item.name)}</div>
    </div>
  `).join('');
}

function findAtmById(id) {
  for (const group of Object.values(ATMOSPHERE)) {
    const found = group.find(x => x.id === id);
    if (found) return found;
  }
  return null;
}

function selectAtm(id, el) {
  state.activeAtmId = id;
  const item = findAtmById(id);
  if (!item) return;

  document.querySelectorAll('.atm-card').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');

  const preview = document.getElementById('atm-preview');
  const title = document.getElementById('atm-preview-title');
  const text = document.getElementById('atm-preview-text');
  title.innerHTML = `${item.icon} ${escapeHtml(item.name)}`;
  text.textContent = item.text;
  preview.classList.add('visible');

  logEvent('atm', `${item.icon} Атмосфера: «${item.name}»`);
}

function closeAtmPreview() {
  document.getElementById('atm-preview').classList.remove('visible');
  state.activeAtmId = null;
  document.querySelectorAll('.atm-card').forEach(c => c.classList.remove('active'));
}

function copyAtmToClipboard() {
  const text = document.getElementById('atm-preview-text').textContent;
  navigator.clipboard.writeText(text).then(() => {
    toast('Описание скопировано в буфер обмена', 'success');
  }).catch(() => {
    toast('Не удалось скопировать', 'error');
  });
}

function sendAtmToLog() {
  const title = document.getElementById('atm-preview-title').textContent;
  const text = document.getElementById('atm-preview-text').textContent;
  logEvent('atm', `📜 ${title}\n${text}`);
  toast('Описание добавлено в журнал', 'success');
  switchRightTab('log');
}

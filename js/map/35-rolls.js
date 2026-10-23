// ============ ЗАПРОСЫ БРОСКОВ И ВДОХНОВЕНИЕ ============
// В онлайн-комнате игроки не бросают кубики когда захотят: мастер просит бросок
// («Проверка Ловкости, d20, КС 15»), у каждого игрока — один бросок. Перебросить можно,
// потратив вдохновение. Вдохновение выдаёт мастер, а ещё его даёт запертый или древний сундук.
// Кубики бросает сервер — результат честный и сразу виден всем.

const ROLLS = { mods: {} }; // запомненный модификатор игрока по запросу

const rollsOnline = () => !!window.dndOnlineGetRole?.();
const rollsMaster = () => window.dndOnlineGetRole?.() === 'master';

function rollsPanel() {
  let el = document.getElementById('roll-requests');
  if (!el) {
    el = document.createElement('div');
    el.id = 'roll-requests';
    el.className = 'roll-requests';
    const side = document.querySelector('.sidebar-right');
    side.insertBefore(el, side.firstChild);
  }
  return el;
}

/** Мой персонаж для бросков: тот, что на поле, иначе первый свой. */
function rollsMyCharacter() {
  const t = myTokenOnMap();
  if (t) return state.characters.find(c => c.id === t.sourceId) || null;
  return state.characters.find(c => String(c.ownerId) === myPlayerId()) || null;
}

const signedNum = n => (n >= 0 ? '+' + n : String(n));

function renderRollRequests() {
  const el = rollsPanel();
  if (!rollsOnline()) { el.style.display = 'none'; return; }
  const list = (Array.isArray(state.rollRequests) ? state.rollRequests : []).filter(r => r.open);
  el.style.display = '';

  if (rollsMaster()) {
    const party = rollsPartyMembers();
    el.innerHTML = `
      <div class="rr-head">
        <span>🎲 Броски игроков</span>
        <button class="btn btn-sm btn-primary" onclick="openRollRequestDialog()">📣 Запросить бросок</button>
      </div>
      ${list.length ? list.map(r => {
        const targets = r.targets === 'all' ? party : party.filter(p => r.targets.includes(String(p.id)));
        const rows = targets.map(p => {
          const res = r.results?.[p.id];
          if (!res) return `<div class="rr-row wait"><span>${escapeHtml(p.label)}</span><span>ждём…</span></div>`;
          const ok = r.dc ? (res.total >= r.dc ? ' ✔' : ' ✖') : '';
          return `<div class="rr-row ${r.dc ? (res.total >= r.dc ? 'ok' : 'bad') : ''}"><span>${escapeHtml(res.charName || res.name)}</span>
            <span><b>${res.total}</b>${ok}${res.rolls.length > 1 ? ` <small title="Перебросы за вдохновение">✨×${res.rolls.length - 1}</small>` : ''}</span></div>`;
        }).join('') || '<div class="rr-row wait"><span>Нет игроков</span></div>';
        return `<div class="rr-card">
          <div class="rr-card-head"><span>${escapeHtml(r.label)} · d${r.sides}${r.dc ? ` · КС ${r.dc}${r.showDc ? '' : ' (скрыт)'}` : ''}</span>
            <button class="icon-btn" title="Закрыть запрос" onclick="window.DND_ONLINE?.closeRollRequest?.(${r.id})">✕</button></div>
          ${rows}
        </div>`;
      }).join('') : '<div class="rr-empty">Попросите игроков бросить: проверка, спасбросок, инициатива…</div>'}`;
    return;
  }

  // Игрок
  const c = rollsMyCharacter();
  const insp = Number(c?.inspiration) || 0;
  if (!list.length) {
    el.innerHTML = `<div class="rr-idle">🎲 Кубики бросаются по запросу мастера${insp ? ` · ✨ вдохновение: ${insp}` : ''}</div>`;
    return;
  }
  const st = c ? ItemsCore.stats(c, state.initRound) : null;
  el.innerHTML = list.map(r => {
    const res = r.results?.[myPlayerId()];
    const saved = ROLLS.mods[r.id] || { ab: '', extra: 0 };
    const abilitySelect = `<select class="input rr-ab" id="rr-ab-${r.id}" onchange="rollsRememberMod(${r.id})">
        <option value="">без характеристики</option>
        ${ItemsCore.ABILITIES.map(a => `<option value="${a.id}" ${saved.ab === a.id ? 'selected' : ''}>${a.label} ${st ? signedNum(st.abilityMods[a.id]) : ''}</option>`).join('')}
      </select>`;
    const modControls = `<div class="rr-mod">${abilitySelect}
        <label title="Дополнительно: бонус мастерства и т.п.">+<input type="number" class="input" id="rr-extra-${r.id}" value="${saved.extra}" onchange="rollsRememberMod(${r.id})"></label></div>`;
    if (!res) {
      return `<div class="rr-card rr-pending">
        <div class="rr-ask">📣 Мастер просит: <b>${escapeHtml(r.label)}</b></div>
        <div class="rr-sub">d${r.sides}${r.dc ? ` · КС ${r.dc}` : ''}</div>
        ${modControls}
        <button class="btn btn-primary rr-roll" onclick="rollsDoRoll(${r.id})">🎲 Бросить d${r.sides}</button>
      </div>`;
    }
    const last = res.rolls[res.rolls.length - 1];
    const verdict = r.dc ? (res.total >= r.dc ? '<span class="rr-ok">успех</span>' : '<span class="rr-bad">провал</span>') : '';
    return `<div class="rr-card">
      <div class="rr-ask">${escapeHtml(r.label)}</div>
      <div class="rr-result"><b>${res.total}</b> <small>(d${r.sides} = ${last.die}${last.mod ? ' ' + signedNum(last.mod) : ''})</small> ${verdict}</div>
      ${insp > 0
        ? `${modControls}<button class="btn btn-sm rr-reroll" onclick="rollsDoRoll(${r.id})">✨ Перебросить (вдохновение: ${insp})</button>`
        : `<div class="rr-sub">Перебросить можно только за вдохновение — у вас его нет</div>`}
    </div>`;
  }).join('');
}
window.renderRollRequests = renderRollRequests;

function rollsRememberMod(id) {
  ROLLS.mods[id] = {
    ab: document.getElementById('rr-ab-' + id)?.value || '',
    extra: Math.trunc(Number(document.getElementById('rr-extra-' + id)?.value)) || 0
  };
}

function rollsDoRoll(id, charId) {
  if (document.getElementById('rr-ab-' + id) || !ROLLS.mods[id]) rollsRememberMod(id);
  const c = (charId != null && state.characters.find(x => String(x.id) === String(charId))) || rollsMyCharacter();
  const { ab, extra } = ROLLS.mods[id];
  const abMod = ab && c ? ItemsCore.stats(c, state.initRound).abilityMods[ab] : 0;
  if (!window.DND_ONLINE?.rollForRequest?.(id, c?.id ?? null, abMod + extra)) toast('Нет связи с сервером', 'error');
}

/** Игроки группы (для мастера): владельцы персонажей, кроме самого мастера. */
function rollsPartyMembers() {
  const me = myPlayerId();
  const byOwner = new Map();
  for (const c of state.characters) {
    if (c.ownerId == null || String(c.ownerId) === me) continue;
    const key = String(c.ownerId);
    const onMap = state.tokens.some(t => t.kind === 'character' && t.sourceId === c.id);
    if (!byOwner.has(key) || onMap) byOwner.set(key, { id: key, label: c.name });
  }
  return [...byOwner.values()];
}

window.dndRollRequested = function (req) {
  if (rollsMaster()) return;
  toast(`📣 Мастер просит бросок: ${req.label} (d${req.sides})`);
  if (document.querySelector('.app')?.classList.contains('sidebar-right-collapsed')) toggleSidebar?.('right');
};

/* ───────── окно запроса (мастер) ───────── */

const ROLL_PRESETS = [
  'Проверка Силы', 'Проверка Ловкости', 'Проверка Телосложения', 'Проверка Интеллекта', 'Проверка Мудрости', 'Проверка Харизмы',
  'Восприятие', 'Скрытность', 'Атлетика', 'Акробатика', 'Убеждение', 'Обман', 'Анализ', 'Расследование',
  'Спасбросок Ловкости', 'Спасбросок Телосложения', 'Спасбросок Мудрости', 'Инициатива'
];

function openRollRequestDialog() {
  const party = rollsPartyMembers();
  invDialog('inv-sub', `
    <div class="modal-title">📣 Запросить бросок</div>
    <div class="modal-body inv-form">
      <label>Что бросают<input id="rq-label" class="input" list="rq-presets" placeholder="Например: Проверка Ловкости" maxlength="80"></label>
      <datalist id="rq-presets">${ROLL_PRESETS.map(p => `<option value="${p}">`).join('')}</datalist>
      <div style="display:flex;gap:8px">
        <label style="flex:1">Кубик<select id="rq-sides" class="input">${[20, 4, 6, 8, 10, 12, 100].map(d => `<option value="${d}">d${d}</option>`).join('')}</select></label>
        <label style="width:110px">КС (необяз.)<input id="rq-dc" class="input" type="number" min="1" max="40" placeholder="—"></label>
      </div>
      <label class="inv-check"><input type="checkbox" id="rq-showdc" checked> Игроки видят КС</label>
      <div class="inv-section-label" style="margin:4px 0 0">Кто бросает</div>
      <label class="inv-check"><input type="checkbox" id="rq-all" checked onchange="document.querySelectorAll('.rq-target').forEach(x => x.disabled = this.checked)"> Все игроки</label>
      <div class="rq-targets">${party.map(p => `<label class="inv-check"><input type="checkbox" class="rq-target" value="${escapeHtml(p.id)}" disabled> ${escapeHtml(p.label)}</label>`).join('') || '<span class="sheet-muted">Игроков пока нет</span>'}</div>
    </div>
    <div class="modal-footer inv-footer">
      <button class="btn btn-primary" onclick="sendRollRequest()">Запросить</button>
      <button class="btn" style="margin-left:auto" onclick="closeInvDialog('inv-sub')">Отмена</button>
    </div>`);
  document.getElementById('rq-label').focus();
}

function sendRollRequest() {
  const label = document.getElementById('rq-label').value.trim() || 'Бросок';
  const all = document.getElementById('rq-all').checked;
  const targets = all ? 'all' : [...document.querySelectorAll('.rq-target:checked')].map(x => x.value);
  if (!all && !targets.length) { toast('Отметьте, кто бросает', 'error'); return; }
  const request = {
    label, sides: Number(document.getElementById('rq-sides').value) || 20,
    dc: Number(document.getElementById('rq-dc').value) || null,
    showDc: document.getElementById('rq-showdc').checked, targets
  };
  if (!window.DND_ONLINE?.sendRollRequest?.(request)) { toast('Нет связи с сервером', 'error'); return; }
  closeInvDialog('inv-sub');
  toast(`📣 Запрошено: ${label}`);
}

/* ───────── вдохновение (мастер) ───────── */

function giveInspiration(charId, delta) {
  invAction({ type: 'inspiration', who: { kind: 'character', id: charId }, delta });
}

window.addEventListener('DOMContentLoaded', () => renderRollRequests());

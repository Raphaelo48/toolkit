// ============ INVENTORY ============
// Вещи и деньги принадлежат персонажу (а не фишке на карте), монстрам/NPC — их фишке,
// группе — общему складу. Правила — в js/shared/inventory-core.js (их же проверяет сервер).
// Любое изменение идёт через invAction(): локально применяется сразу, в онлайне — отправляется на сервер.

const INV_RARITY = {
  common: 'Обычный', uncommon: 'Необычный', rare: 'Редкий', 'very-rare': 'Очень редкий', legendary: 'Легендарный'
};
const invUI = { main: null }; // что открыто в главном окне: { view:'box', ref } | { view:'overview' } | { view:'chest', tokenId }

if (!state.party) InventoryCore.ensureParty(state);

/* ───────── кто действует и что ему можно ───────── */

function invRole() { return window.dndOnlineGetRole?.() || null; }
function invIsMaster() { const r = invRole(); return !r || r === 'master'; }
function invActor() {
  const role = invRole();
  if (!role) return null; // без онлайна — полный доступ
  const p = window.DND_ONLINE?.meta?.player || {};
  return { role, playerId: p.id, name: p.name };
}
function invMyCharacters() {
  if (invIsMaster()) return state.characters.slice();
  const me = String(window.DND_ONLINE?.meta?.player?.id ?? '');
  return state.characters.filter(c => String(c.ownerId) === me);
}
const invBox = ref => InventoryCore.resolve(state, ref);
const invCanManage = box => InventoryCore.canManage(box, invActor());
const invCanView = box => InventoryCore.canView(box, invActor());
const invRefKey = ref => ref.kind === 'party' ? 'party' : `${ref.kind}:${ref.id}`;

// Обработчики для onclick: замыкание регистрируется и вызывается по номеру — без экранирования данных в HTML
const invFns = new Map();
let invFnSeq = 0;
function H(fn) {
  const id = ++invFnSeq;
  invFns.set(id, fn);
  if (invFns.size > 3000) invFns.delete(invFns.keys().next().value);
  return `_invCall(${id})`;
}
window._invCall = id => { const fn = invFns.get(id); if (fn) fn(); };

/* ───────── действия ───────── */

function invAction(action) {
  const online = window.DND_ONLINE;
  const inRoom = !!invRole();
  if (inRoom && !online?.isReady?.()) { toast('Нет связи с сервером — попробуйте через пару секунд', 'error'); return false; }
  action.logId = Date.now() + Math.random();
  if (action.type === 'drop' && action.tokenId == null) action.tokenId = state.nextId;
  const sigBefore = inRoom ? online.signatureNow() : null;
  const res = InventoryCore.apply(state, action, invActor(), { allocId: () => state.nextId++ });
  if (!res.ok) { toast(res.error || 'Не получилось', 'error'); return false; }
  if (inRoom) online.sendInventoryAction(action, sigBefore);
  invRerender();
  return true;
}

function invRerender() {
  renderTokens?.(); renderInfoPanel?.(); renderCharactersList?.(); renderMonstersList?.();
  renderLogFilters?.(); renderLog?.();
  invRefresh();
}

/** Перерисовать открытое окно инвентаря (вызывается и при приходе состояния с сервера). */
function invRefresh() {
  const m = invUI.main;
  if (!m || !document.getElementById('inv-main')) return;
  if (m.view === 'box') { if (invBox(m.ref)) renderInvBox(m.ref); else closeInvDialog('inv-main'); }
  else if (m.view === 'overview') renderInvOverview();
  else if (m.view === 'chest') renderInvChest(m.tokenId);
}
window.dndInventoryRefresh = invRefresh;

/* ───────── окна ───────── */

function invDialog(id, html, wide) {
  document.getElementById(id)?.remove(); // только убрать старое окно; invUI.main не трогаем
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay inv-overlay';
  overlay.id = id;
  overlay.style.display = 'flex';
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeInvDialog(id); });
  overlay.innerHTML = `<div class="modal inv-modal${wide ? ' inv-wide' : ''}">${html}</div>`;
  document.body.appendChild(overlay);
  return overlay;
}
function closeInvDialog(id) {
  document.getElementById(id)?.remove();
  if (id === 'inv-main') { invUI.main = null; closeInvDialog('inv-sub'); }
}
function setInvMain(html) {
  const el = document.getElementById('inv-main');
  if (el) el.querySelector('.modal').innerHTML = html; else invDialog('inv-main', html, true);
}

function invCoinsHtml(coins) {
  const c = InventoryCore.normCoins(coins);
  return InventoryCore.COIN_KEYS.map(k =>
    `<span class="inv-coin inv-coin-${k} ${c[k] ? '' : 'zero'}" title="${InventoryCore.COIN_NAMES[k]}">${c[k]} ${InventoryCore.COIN_LABELS[k]}</span>`
  ).join('');
}

function invItemHtml(entry, actions) {
  const desc = entry.coins ? '' : (ItemsCore.defOf(entry) ? ItemsCore.describe(entry) : entry.desc);
  return `
    <div class="inv-item rarity-${escapeHtml(entry.rarity || 'common')}">
      <div class="inv-item-icon">${escapeHtml(entry.icon || '❓')}</div>
      <div class="inv-item-info">
        <div class="inv-item-name">${escapeHtml(entry.name)}${entry.qty > 1 ? ` <span class="inv-qty">×${entry.qty}</span>` : ''}${entry.charges != null ? ` <span class="inv-charges">⚡${entry.charges}</span>` : ''}</div>
        <div class="inv-item-meta">
          ${entry.coins ? '' : `<span class="rarity-label-${escapeHtml(entry.rarity || 'common')}">${INV_RARITY[entry.rarity] || ''}</span>`}
          ${entry.custom ? ' · свой предмет' : ''}
        </div>
        ${desc ? `<div class="inv-item-desc">${escapeHtml(desc)}</div>` : ''}
      </div>
      ${actions ? `<div class="inv-item-actions">${actions}</div>` : ''}
    </div>`;
}

/** Кнопки предмета в рюкзаке: надеть / использовать / передать / на карту / удалить. */
function invItemActions(box, e) {
  if (!invCanManage(box)) return '';
  const ref0 = box.ref;
  const def = ItemsCore.defOf(e);
  const isChar = box.kind === 'character';
  const btn = (label, title, fn, cls = '') => `<button class="btn btn-sm ${cls}" title="${title}" onclick="${H(fn)}">${label}</button>`;
  let out = '';
  if (isChar && def?.slot) out += btn('Надеть', 'Надеть или взять в руку', () => invEquip(ref0, e.id), 'btn-primary');
  if (isChar && def?.use) out += btn('Исп.', 'Использовать', () => invUseItem(ref0, e.id), 'btn-primary');
  if (!def?.slot && !def?.use) out += btn('Исп.', 'Израсходовать одну штуку', () => invUse(ref0, e.id));
  out += btn('Передать', 'Передать', () => invPickTransfer(ref0, e.id));
  out += btn('На карту', 'Выбросить на карту', () => invDrop(ref0, e.id));
  if (invIsMaster()) out += btn('✕', 'Удалить совсем', () => invDelete(ref0, e.id), 'btn-danger');
  return out;
}

/* ───────── инвентарь персонажа / монстра / склада ───────── */

function openInventory(ref) {
  const box = invBox(ref);
  if (!box) { toast('Не найдено', 'error'); return; }
  if (!invCanView(box)) { toast('Это чужой инвентарь', 'error'); return; }
  invUI.main = { view: 'box', ref: box.ref };
  renderInvBox(box.ref);
}
// Старое имя — для кнопок в панели информации
function openInventoryModal(tokenId) { openInventory({ kind: 'token', id: tokenId }); }

function invFooter(ref0) {
  return `
    <div class="modal-footer inv-footer">
      ${invIsMaster() ? `
        <button class="btn btn-primary" onclick="${H(() => invOpenItemPicker(ref0))}">+ Из списка</button>
        <button class="btn" onclick="${H(() => invOpenCustomItem(ref0))}">+ Свой предмет</button>` : ''}
      <button class="btn" onclick="openInventoryOverview()">Все инвентари</button>
      <button class="btn" style="margin-left:auto" onclick="closeInvDialog('inv-main')">Закрыть</button>
    </div>`;
}

function renderInvBox(ref) {
  const box = invBox(ref);
  if (!box) return;
  if (box.kind === 'character') { renderCharacterSheet(box); return; }
  const manage = invCanManage(box);
  const items = box.holder.inventory;
  const ref0 = box.ref;
  const subtitle = box.kind === 'party' ? 'Общий запас группы' : 'Существо на карте';
  const list = items.length ? items.map(e => invItemHtml(e, invItemActions(box, e))).join('') : '<div class="inv-empty">Пусто</div>';
  setInvMain(`
    <div class="modal-title inv-title">
      <span>${escapeHtml(box.icon)} ${escapeHtml(box.name)}</span>
      <span class="inv-subtitle">${subtitle} · ${InventoryCore.countItems(box.holder)} предм.</span>
    </div>
    <div class="inv-coins-row">
      <div class="inv-coins">${invCoinsHtml(box.holder.coins)}</div>
      ${manage ? `<button class="btn btn-sm" onclick="${H(() => invOpenCoins(ref0))}">💰 Деньги…</button>` : ''}
    </div>
    <div class="modal-body inv-list">${list}</div>
    ${invFooter(ref0)}`);
}

/* ───────── лист персонажа: снаряжение, характеристики, атаки ───────── */

const SHEET_LAYOUT = [
  ['head', 'neck', 'cloak'],
  ['mainhand', 'chest', 'offhand'],
  ['hands', 'legs', 'feet'],
  ['ring1', null, 'ring2'],
];

function renderCharacterSheet(box) {
  const c = box.character;
  const ref0 = box.ref;
  const manage = invCanManage(box);
  const st = ItemsCore.stats(c, state.initRound);
  const eq = c.equipment || {};
  const slotInfo = Object.fromEntries(ItemsCore.SLOTS.map(x => [x.id, x]));
  const twoHanded = ItemsCore.isTwoHanded(ItemsCore.defOf(eq.mainhand));
  const signed = n => (n >= 0 ? '+' + n : String(n));

  const slotHtml = id => {
    if (!id) return '<div class="sheet-slot sheet-slot-blank"></div>';
    const info = slotInfo[id];
    const item = eq[id];
    const blockedByTwo = id === 'offhand' && !item && twoHanded;
    if (!item) {
      return `<div class="sheet-slot empty ${blockedByTwo ? 'blocked' : ''}" title="${info.label}${blockedByTwo ? ': занято двуручным оружием' : ''}">
        <span class="sheet-slot-icon">${blockedByTwo ? '🔒' : info.icon}</span><span class="sheet-slot-label">${info.label}</span></div>`;
    }
    return `<div class="sheet-slot filled rarity-${escapeHtml(item.rarity || 'common')}" title="${escapeHtml(item.name + ' — ' + ItemsCore.describe(item))}">
      <span class="sheet-slot-icon">${escapeHtml(item.icon || '❓')}</span>
      <span class="sheet-slot-name">${escapeHtml(item.name)}</span>
      ${manage ? `<button class="sheet-slot-off" title="Снять" onclick="${H(() => invAction({ type: 'unequip', who: ref0, slot: id }))}">снять</button>` : ''}
    </div>`;
  };

  const abilities = ItemsCore.ABILITIES.map(a => `
    <div class="sheet-ability" title="${a.name}">
      <div class="sheet-ability-label">${a.label}</div>
      <div class="sheet-ability-mod">${signed(st.abilityMods[a.id])}</div>
      <div class="sheet-ability-score ${st.abilities[a.id] !== (Number(c.abilities?.[a.id]) || 10) ? 'boosted' : ''}">${st.abilities[a.id]}</div>
    </div>`).join('');

  const attacks = st.attacks.map(at => {
    const dmg = `${at.dice}${at.dmgMod ? signed(at.dmgMod) : ''} ${at.type}` + at.extras.map(x => ` + ${x.dice} ${x.type}`).join('');
    return `<div class="sheet-attack">
      <span class="sheet-attack-icon">${escapeHtml(at.icon)}</span>
      <div class="sheet-attack-info">
        <div class="sheet-attack-name">${escapeHtml(at.name)}${at.note ? ` <small>(${at.note})</small>` : ''}</div>
        <div class="sheet-attack-meta">Атака ${signed(at.toHit)} · Урон ${escapeHtml(dmg)}${at.range ? ` · ${at.range}` : ''}</div>
      </div>
      ${manage ? `<button class="btn btn-sm btn-primary" title="Бросить атаку и урон — увидят все" onclick="${H(() => rollCharacterAttack(c.id, at.slot))}">🎲 Атака</button>` : ''}
    </div>`;
  }).join('');

  const effects = st.effects.length ? st.effects.map(e => {
    const left = e.untilRound != null ? `ещё ${Math.max(0, e.untilRound - (Number(state.initRound) || 1) + 1)} р.` : (e.duration || 'пока не снимут');
    const mods = ItemsCore.describe({ id: '_', mech: { mods: e.mods } }).replace(/\.$/, '');
    return `<span class="sheet-effect" title="${escapeHtml([mods, e.text].filter(x => x && x !== 'Без особых свойств').join('. '))}">
      ${escapeHtml(e.icon || '✨')} ${escapeHtml(e.name)} <small>${left}</small>
      ${manage ? `<button title="Снять эффект" onclick="${H(() => invAction({ type: 'effect_remove', who: ref0, effectId: e.id }))}">✕</button>` : ''}</span>`;
  }).join('') : '<span class="sheet-muted">Нет</span>';

  const bag = c.inventory.length ? c.inventory.map(e => invItemHtml(e, invItemActions(box, e))).join('') : '<div class="inv-empty">Рюкзак пуст</div>';
  const hpPct = c.hpMax ? Math.round(100 * c.hpCur / c.hpMax) : 0;

  setInvMain(`
    <div class="modal-title inv-title">
      <span>${escapeHtml(box.icon)} ${escapeHtml(c.name)}</span>
      <span class="inv-subtitle">${escapeHtml(c.charClass || 'Персонаж')} · ур. ${c.level || 1} · бонус мастерства +${st.prof}</span>
    </div>
    <div class="sheet">
      <div class="sheet-doll">
        ${SHEET_LAYOUT.map(row => row.map(slotHtml).join('')).join('')}
      </div>
      <div class="sheet-stats">
        <div class="sheet-top">
          <div class="sheet-big" title="${escapeHtml(st.acNote)}"><div class="sheet-big-val">${st.ac}</div><div class="sheet-big-label">КД</div></div>
          <div class="sheet-big"><div class="sheet-big-val">${c.hpCur}<small>/${c.hpMax}</small></div><div class="sheet-big-label">Хиты</div>
            <div class="hp-bar"><div class="hp-fill ${hpPct < 25 ? 'low' : hpPct < 50 ? 'mid' : ''}" style="width:${hpPct}%"></div></div></div>
          <div class="sheet-big"><div class="sheet-big-val">${String(st.speed).replace('.', ',')}<small> м</small></div><div class="sheet-big-label">Скорость</div></div>
        </div>
        <div class="sheet-abilities">${abilities}</div>
        <div class="sheet-line">${st.saves ? `Спасброски ${signed(st.saves)} · ` : ''}${st.spell ? `Заклинания ${signed(st.spell)} к атаке и КС · ` : ''}${escapeHtml(st.acNote)}</div>
        ${st.notes.length ? `<div class="sheet-warn">${st.notes.map(escapeHtml).join(' · ')}</div>` : ''}
        <div class="inv-section-label">Атаки</div>
        ${attacks}
        <div class="inv-section-label">Эффекты</div>
        <div class="sheet-effects">${effects}</div>
      </div>
    </div>
    <div class="inv-coins-row" style="margin-top:12px">
      <div class="inv-section-label" style="margin:0">Рюкзак · ${InventoryCore.countItems(c)} предм.</div>
      <div class="inv-coins">${invCoinsHtml(c.coins)}${manage ? `<button class="btn btn-sm" onclick="${H(() => invOpenCoins(ref0))}">💰</button>` : ''}</div>
    </div>
    <div class="modal-body inv-list sheet-bag">${bag}</div>
    ${invFooter(ref0)}`);
  document.querySelector('#inv-main .modal')?.classList.add('inv-sheet');
}

/* ───────── надеть / использовать ───────── */

function invEquip(ref, itemId) {
  invAction({ type: 'equip', who: ref, itemId });
}

/** Использовать предмет: кости бросаются здесь, результат видят все. */
function invUseItem(ref, itemId) {
  const box = invBox(ref);
  const item = box?.holder.inventory.find(e => e.id === itemId && (e.charges == null || e.charges > 0)) || box?.holder.inventory.find(e => e.id === itemId);
  const def = ItemsCore.defOf(item);
  const u = def?.use;
  if (!u) return;
  let roll = null;
  if (u.kind === 'heal' || u.kind === 'spell') roll = ItemsCore.rollDice(u.dice);
  const action = { type: 'use', who: ref, itemId, rolled: roll ? roll.total : undefined };
  if (!invAction(action)) return;
  if (roll) {
    const label = u.kind === 'heal' ? `🧪 ${box.name}: ${item.name}` : `✨ ${box.name}: ${item.name}`;
    const detail = u.kind === 'heal'
      ? `Лечение ${u.dice} → [${roll.rolls.join(', ')}]${roll.mod ? (roll.mod > 0 ? ' + ' : ' − ') + Math.abs(roll.mod) : ''}`
      : `Урон ${u.type}: ${u.dice} → [${roll.rolls.join(', ')}]${roll.mod ? (roll.mod > 0 ? ' + ' : ' − ') + Math.abs(roll.mod) : ''}${u.save ? ' · ' + u.save : ''}`;
    announceRoll({ sides: ItemsCore.parseDice(u.dice)?.sides || 6, total: roll.total, mainRolls: roll.rolls, title: label, detail });
  }
}

/** Бросок атаки оружием: d20 + бонус атаки, урон (на 20 — кости урона удваиваются). */
function rollCharacterAttack(charId, slot) {
  const c = state.characters.find(x => x.id === charId);
  if (!c) return;
  const at = ItemsCore.stats(c, state.initRound).attacks.find(a => a.slot === slot);
  if (!at) return;
  const d20 = 1 + Math.floor(Math.random() * 20);
  const crit = d20 === 20, fail = d20 === 1;
  const dmgRoll = ItemsCore.rollDice(at.dice, crit);
  const extras = at.extras.map(x => ({ ...x, r: ItemsCore.rollDice(x.dice, crit) }));
  const dmg = Math.max(1, dmgRoll.total + at.dmgMod) + extras.reduce((s, x) => s + x.r.total, 0);
  const signed = n => (n >= 0 ? '+' + n : String(n));
  const parts = [`${at.dice}${crit ? '×2' : ''} [${dmgRoll.rolls.join(', ') || at.dice}]${at.dmgMod ? ' ' + signed(at.dmgMod) : ''} ${at.type}`,
    ...extras.map(x => `${x.dice}${crit ? '×2' : ''} [${x.r.rolls.join(', ')}] ${x.type}`)];
  announceRoll({
    sides: 20, total: d20 + at.toHit, mainRolls: [d20], fixed: at.toHit, modifierStr: signed(at.toHit),
    isCrit: crit, isFail: fail,
    title: `⚔ ${c.name}: ${at.name}`,
    detail: fail ? 'Промах (выпала 1)' : `Урон: ${dmg}${crit ? ' — КРИТ!' : ''} · ${parts.join(' + ')}`
  });
  logEvent('combat', `⚔ ${c.name} — ${at.name}: атака ${d20 + at.toHit} (d20=${d20})${fail ? ', промах' : `, урон ${dmg}`}${crit ? ' 🌟 КРИТ' : ''}`);
}

/** Показать результат у себя и у всех в комнате, записать в историю бросков. */
function announceRoll(r) {
  const result = {
    sides: r.sides, mainRolls: r.mainRolls || [], mainTotal: (r.mainRolls || []).reduce((s, x) => s + x, 0),
    extraDiceResults: [], fixed: r.fixed || 0, modifierStr: r.modifierStr || '', total: r.total,
    isCrit: !!r.isCrit, isFail: !!r.isFail, title: r.title, detail: r.detail
  };
  showDiceResult(result);
  state.diceHistory.unshift({ time: Date.now(), sides: result.sides, modStr: result.modifierStr, total: result.total, isCrit: result.isCrit, isFail: result.isFail, title: r.title });
  if (state.diceHistory.length > 20) state.diceHistory.length = 20;
  window.DND_ONLINE?.sendDice?.(result);
}

function invFindItem(ref, itemId) {
  return invBox(ref)?.holder.inventory.find(e => e.id === itemId) || null;
}

function invUse(ref, itemId) {
  invAction({ type: 'remove', reason: 'use', from: ref, itemId, qty: 1 });
}

function invDelete(ref, itemId) {
  const e = invFindItem(ref, itemId);
  if (!e || !confirm(`Удалить «${e.name}»${e.qty > 1 ? ` ×${e.qty}` : ''} без следа?`)) return;
  invAction({ type: 'remove', reason: 'discard', from: ref, itemId, qty: e.qty });
}

function invAskQty(max, text) {
  if (max <= 1) return 1;
  const v = prompt(`${text} (1–${max})`, String(max));
  if (v == null) return 0;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(max, n);
}

function invDrop(ref, itemId) {
  const e = invFindItem(ref, itemId);
  if (!e) return;
  const qty = invAskQty(e.qty, `Сколько выбросить «${e.name}»?`);
  if (!qty) return;
  const pos = invDropPosition(ref);
  invAction({ type: 'drop', from: ref, itemId, qty, x: pos.x, y: pos.y });
}

/** Рядом с фишкой владельца, иначе в центре экрана. */
function invDropPosition(ref) {
  let token = null;
  if (ref.kind === 'character') token = state.tokens.find(t => t.kind === 'character' && String(t.sourceId) === String(ref.id));
  if (ref.kind === 'token') token = state.tokens.find(t => String(t.id) === String(ref.id));
  const jitter = () => (Math.random() - 0.5) * 30;
  if (token) return { x: token.x + 45 + jitter(), y: token.y + 20 + jitter() };
  const rect = document.getElementById('map-area').getBoundingClientRect();
  const c = screenToMap(rect.width / 2, rect.height / 2);
  return { x: c.x + jitter(), y: c.y + jitter() };
}

/* ───────── выбор получателя ───────── */

/** Список, кому можно передать: все персонажи, склад; мастеру — ещё существа на карте. */
function invTargets(excludeRef, { ownOnly = false } = {}) {
  const exclude = excludeRef ? invRefKey(InventoryCore.resolve(state, excludeRef)?.ref || excludeRef) : null;
  const out = [];
  const chars = ownOnly ? invMyCharacters() : state.characters;
  chars.forEach(c => out.push({ ref: { kind: 'character', id: c.id }, icon: c.emoji || '👤', name: c.name, note: c.charClass || 'Персонаж' }));
  if (!ownOnly || invIsMaster()) out.push({ ref: { kind: 'party' }, icon: '🏰', name: 'Общий склад группы', note: 'Для всей группы' });
  if (invIsMaster()) {
    state.tokens.filter(t => ['monster', 'npc', 'token'].includes(t.kind)).forEach(t =>
      out.push({ ref: { kind: 'token', id: t.id }, icon: t.emoji || '❔', name: t.name, note: 'На карте' }));
  }
  return out.filter(t => invRefKey(t.ref) !== exclude);
}

function invPickTarget(title, targets, onPick, { autoSingle = false } = {}) {
  if (!targets.length) { toast('Некому передать', 'error'); return; }
  // Взять себе, когда персонаж один, — без лишнего вопроса; передачу всегда подтверждаем выбором
  if (autoSingle && targets.length === 1) { onPick(targets[0].ref); return; }
  invDialog('inv-sub', `
    <div class="modal-title">${title}</div>
    <div class="modal-body inv-list">
      ${targets.map(t => `
        <div class="inv-target" onclick="${H(() => { closeInvDialog('inv-sub'); onPick(t.ref); })}">
          <div class="inv-item-icon">${escapeHtml(t.icon)}</div>
          <div class="inv-item-info"><div class="inv-item-name">${escapeHtml(t.name)}</div><div class="inv-item-meta">${escapeHtml(t.note || '')}</div></div>
        </div>`).join('')}
    </div>
    <div class="modal-footer"><button class="btn btn-block" onclick="closeInvDialog('inv-sub')">Отмена</button></div>`);
}

function invPickTransfer(ref, itemId) {
  const e = invFindItem(ref, itemId);
  if (!e) return;
  invPickTarget(`${escapeHtml(e.icon)} ${escapeHtml(e.name)} → кому?`, invTargets(ref), to => {
    const fresh = invFindItem(ref, itemId);
    if (!fresh) return;
    const qty = invAskQty(fresh.qty, `Сколько передать «${fresh.name}»?`);
    if (qty) invAction({ type: 'transfer', from: ref, to, itemId, qty });
  });
}

/* ───────── деньги ───────── */

function invOpenCoins(ref) {
  const box = invBox(ref);
  if (!box) return;
  const master = invIsMaster();
  const ref0 = box.ref;
  const inputs = InventoryCore.COIN_KEYS.map(k => `
    <label class="inv-coin-input"><span>${InventoryCore.COIN_NAMES[k]}</span>
      <input type="number" min="0" step="1" value="0" data-coin="${k}" class="input"></label>`).join('');
  invDialog('inv-sub', `
    <div class="modal-title">💰 ${escapeHtml(box.name)}</div>
    <div class="modal-body">
      <div class="inv-coins" style="margin-bottom:12px">${invCoinsHtml(box.holder.coins)}</div>
      <div class="inv-coin-grid">${inputs}</div>
      <div class="inv-hint">1 пм = 10 зм · 1 зм = 10 см · 1 см = 10 мм</div>
    </div>
    <div class="modal-footer inv-footer">
      ${master ? `<button class="btn btn-primary" onclick="${H(() => invCoins(ref0, 1))}">Выдать</button>
                  <button class="btn" onclick="${H(() => invCoins(ref0, -1))}">Забрать</button>`
               : `<button class="btn" onclick="${H(() => invCoins(ref0, -1))}">Потратить</button>`}
      <button class="btn" onclick="${H(() => invCoinsTransfer(ref0))}">Передать…</button>
      <button class="btn" style="margin-left:auto" onclick="closeInvDialog('inv-sub')">Отмена</button>
    </div>`);
}

function invReadCoins() {
  const amount = {};
  document.querySelectorAll('#inv-sub [data-coin]').forEach(inp => { amount[inp.dataset.coin] = Math.max(0, Math.floor(Number(inp.value) || 0)); });
  if (!InventoryCore.hasCoins(amount)) { toast('Укажите сумму', 'error'); return null; }
  return amount;
}

function invCoins(ref, sign) {
  const amount = invReadCoins();
  if (!amount) return;
  const delta = {};
  for (const k of InventoryCore.COIN_KEYS) delta[k] = sign * amount[k];
  if (invAction({ type: 'coins', target: ref, delta })) closeInvDialog('inv-sub');
}

function invCoinsTransfer(ref) {
  const amount = invReadCoins();
  if (!amount) return;
  closeInvDialog('inv-sub');
  invPickTarget(`💰 ${InventoryCore.formatCoins(amount)} → кому?`, invTargets(ref), to =>
    invAction({ type: 'coins_transfer', from: ref, to, amount }));
}

/* ───────── выдача предметов мастером ───────── */

function invOpenItemPicker(ref) {
  window._invPickerRef = ref;
  invDialog('inv-sub', `
    <div class="modal-title">Выдать предмет</div>
    <div style="display:flex;gap:8px;padding:0 0 10px">
      <input id="inv-picker-search" class="input" placeholder="Поиск предмета…" style="flex:1" oninput="renderInvItemPicker()">
      <input id="inv-picker-qty" class="input" type="number" min="1" value="1" style="width:70px" title="Количество">
    </div>
    <div class="modal-body inv-list" id="inv-picker-list"></div>
    <div class="modal-footer"><button class="btn btn-block" onclick="closeInvDialog('inv-sub')">Готово</button></div>`);
  renderInvItemPicker();
  document.getElementById('inv-picker-search')?.focus();
}

function renderInvItemPicker() {
  const q = (document.getElementById('inv-picker-search')?.value || '').toLowerCase().trim();
  let items = LOOT_ITEMS.filter(i => !i.isLootChest);
  if (q) items = items.filter(i => i.name.toLowerCase().includes(q) || (i.desc || '').toLowerCase().includes(q));
  document.getElementById('inv-picker-list').innerHTML = items.slice(0, 100).map(item => `
    <div class="inv-target" onclick="${H(() => invGiveLibraryItem(item.id))}">
      <div class="inv-item-icon">${escapeHtml(item.icon)}</div>
      <div class="inv-item-info">
        <div class="inv-item-name">${escapeHtml(item.name)}</div>
        <div class="inv-item-meta"><span class="rarity-label-${item.rarity}">${INV_RARITY[item.rarity] || ''}</span> · ${escapeHtml(item.desc || '')}</div>
      </div>
      <span class="inv-plus">+</span>
    </div>`).join('') || '<div class="inv-empty">Ничего не найдено</div>';
}

function invGiveLibraryItem(itemId) {
  const item = getLootItem(itemId);
  const qty = Math.max(1, Math.floor(Number(document.getElementById('inv-picker-qty')?.value) || 1));
  if (!item || !window._invPickerRef) return;
  if (item.id === 'gold_pile') {
    let gp = 0;
    for (let i = 0; i < qty; i++) gp += InventoryCore.rollGoldPile();
    if (invAction({ type: 'coins', target: window._invPickerRef, delta: { gp }, note: item.name })) toast(`💰 +${gp} зм`);
    return;
  }
  if (invAction({ type: 'add', to: window._invPickerRef, item, qty })) toast(`${item.icon} ${item.name} ×${qty} выдан`);
}

// Тип своего предмета → какие поля механики показать
const CUSTOM_KINDS = [
  { id: 'none', label: 'Обычный (без механики)' },
  { id: 'weapon', label: 'Оружие' },
  { id: 'armor', label: 'Доспех' },
  { id: 'shield', label: 'Щит' },
  { id: 'head', label: 'Голова' }, { id: 'neck', label: 'Амулет' }, { id: 'cloak', label: 'Плащ' },
  { id: 'hands', label: 'Перчатки' }, { id: 'legs', label: 'Штаны' }, { id: 'feet', label: 'Обувь' },
  { id: 'ring', label: 'Кольцо' },
  { id: 'heal', label: 'Лечебное (зелье)' },
];

function invOpenCustomItem(ref) {
  window._invPickerRef = ref;
  invDialog('inv-sub', `
    <div class="modal-title">Свой предмет</div>
    <div class="modal-body inv-form">
      <label>Название<input id="inv-custom-name" class="input" maxlength="120" placeholder="Например: Клинок барона"></label>
      <div style="display:flex;gap:8px">
        <label style="width:80px">Значок<input id="inv-custom-icon" class="input" maxlength="4" value="📜"></label>
        <label style="width:90px">Кол-во<input id="inv-custom-qty" class="input" type="number" min="1" value="1"></label>
        <label style="flex:1">Редкость<select id="inv-custom-rarity" class="input">
          ${Object.entries(INV_RARITY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select></label>
      </div>
      <label>Тип<select id="inv-custom-kind" class="input" onchange="invCustomKindChanged()">
        ${CUSTOM_KINDS.map(k => `<option value="${k.id}">${k.label}</option>`).join('')}
      </select></label>
      <div id="inv-custom-mech" class="inv-custom-mech"></div>
      <label>Описание<textarea id="inv-custom-desc" class="input" rows="2" maxlength="1000" placeholder="История, особые свойства словами"></textarea></label>
    </div>
    <div class="modal-footer inv-footer">
      <button class="btn btn-primary" onclick="invAddCustomItem()">Добавить</button>
      <button class="btn" style="margin-left:auto" onclick="closeInvDialog('inv-sub')">Отмена</button>
    </div>`);
  invCustomKindChanged();
  document.getElementById('inv-custom-name')?.focus();
}

function invCustomKindChanged() {
  const kind = document.getElementById('inv-custom-kind').value;
  const el = document.getElementById('inv-custom-mech');
  const num = (id, label, value, w = 90) => `<label style="width:${w}px">${label}<input id="${id}" class="input" type="number" value="${value}"></label>`;
  const txt = (id, label, value, ph) => `<label style="flex:1">${label}<input id="${id}" class="input" value="${value}" placeholder="${ph || ''}"></label>`;
  const check = (id, label) => `<label class="inv-check"><input type="checkbox" id="${id}"> ${label}</label>`;
  let html = '';
  if (kind === 'weapon') {
    html = `<div style="display:flex;gap:8px">${txt('cm-dice', 'Урон', '1d8', '1d8')}${txt('cm-type', 'Тип урона', 'рубящий')}${num('cm-bonus', 'Магия +', 0, 70)}</div>
      <div style="display:flex;gap:8px">${txt('cm-extra', 'Доп. урон', '', '1d6')}${txt('cm-extra-type', 'Его тип', '', 'огнём')}</div>
      <div class="inv-checks">${check('cm-light', 'лёгкое')}${check('cm-finesse', 'фехтовальное')}${check('cm-two', 'двуручное')}${check('cm-ranged', 'дальнобойное')}</div>`;
  } else if (kind === 'armor') {
    html = `<div style="display:flex;gap:8px"><label style="flex:1">Вид<select id="cm-armor" class="input">
      <option value="light">лёгкий (КД + ЛОВ)</option><option value="medium">средний (КД + ЛОВ, макс. 2)</option><option value="heavy">тяжёлый (без ЛОВ)</option></select></label>
      ${num('cm-ac', 'КД', 12, 70)}${num('cm-bonus', 'Магия +', 0, 70)}</div>`;
  } else if (kind === 'shield') {
    html = `<div style="display:flex;gap:8px">${num('cm-bonus', 'Магия + (к +2 щита)', 0, 160)}</div>`;
  } else if (kind === 'heal') {
    html = `<div style="display:flex;gap:8px">${txt('cm-heal', 'Лечит (кости)', '2d4+2', '2d4+2')}</div>`;
  } else if (kind !== 'none') {
    html = `<div style="display:flex;gap:8px">${num('cm-ac', 'КД +', 0, 70)}${num('cm-saves', 'Спасброски +', 0, 100)}${num('cm-speed', 'Скорость + (м)', 0, 110)}</div>`;
  }
  el.innerHTML = html;
}

function invCustomMech() {
  const kind = document.getElementById('inv-custom-kind').value;
  const v = id => document.getElementById(id)?.value?.trim() || '';
  const n = id => Math.max(-5, Math.min(10, Math.trunc(Number(v(id))) || 0));
  const on = id => !!document.getElementById(id)?.checked;
  const diceOk = d => /^\d*d\d+([+-]\d+)?$/i.test(d);
  if (kind === 'none') return null;
  if (kind === 'weapon') {
    const props = ['light', 'finesse', 'two', 'ranged'].filter(p => on('cm-' + p));
    const dice = diceOk(v('cm-dice')) ? v('cm-dice') : '1d6';
    const weapon = { dice, type: v('cm-type') || 'дробящий', props, bonus: n('cm-bonus') };
    if (diceOk(v('cm-extra'))) weapon.extra = { dice: v('cm-extra'), type: v('cm-extra-type') || 'магией' };
    return { slot: 'weapon', weapon };
  }
  if (kind === 'armor') return { slot: 'chest', armor: { kind: v('cm-armor') || 'light', ac: Math.max(10, Math.min(20, Math.trunc(Number(v('cm-ac'))) || 11)), bonus: n('cm-bonus') } };
  if (kind === 'shield') return { slot: 'shield', armor: { kind: 'shield', ac: 2, bonus: n('cm-bonus') } };
  if (kind === 'heal') return { use: { kind: 'heal', dice: diceOk(v('cm-heal')) ? v('cm-heal') : '2d4+2' } };
  const mods = {};
  if (n('cm-ac')) mods.ac = n('cm-ac');
  if (n('cm-saves')) mods.saves = n('cm-saves');
  if (Number(v('cm-speed'))) mods.speed = Math.max(-9, Math.min(9, Number(v('cm-speed'))));
  return { slot: kind, mods };
}

function invAddCustomItem() {
  const name = document.getElementById('inv-custom-name').value.trim();
  if (!name) { toast('Введите название', 'error'); return; }
  const item = {
    id: 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name, custom: true,
    icon: document.getElementById('inv-custom-icon').value.trim() || '📦',
    rarity: document.getElementById('inv-custom-rarity').value,
    desc: document.getElementById('inv-custom-desc').value.trim()
  };
  const mech = invCustomMech();
  if (mech) { mech.desc = item.desc; item.mech = mech; }
  const qty = Math.max(1, Math.floor(Number(document.getElementById('inv-custom-qty').value) || 1));
  if (invAction({ type: 'add', to: window._invPickerRef, item, qty })) closeInvDialog('inv-sub');
}

/* ───────── обзор всех инвентарей ───────── */

function openInventoryOverview() {
  invUI.main = { view: 'overview' };
  renderInvOverview();
}

function renderInvOverview() {
  const master = invIsMaster();
  const card = (ref, icon, name, note, holder, clickable) => `
    <div class="inv-card ${clickable ? '' : 'disabled'}" ${clickable ? `onclick="${H(() => openInventory(ref))}"` : ''}>
      <div class="inv-card-head">
        <span class="inv-item-icon">${escapeHtml(icon)}</span>
        <div class="inv-item-info">
          <div class="inv-item-name">${escapeHtml(name)}</div>
          <div class="inv-item-meta">${escapeHtml(note)}</div>
        </div>
        <span class="inv-card-count">${InventoryCore.countItems(holder)} 🎒</span>
      </div>
      <div class="inv-coins">${invCoinsHtml(holder.coins)}</div>
      ${clickable && holder.inventory.length ? `<div class="inv-card-items">${holder.inventory.slice(0, 8).map(e =>
        `<span title="${escapeHtml(e.name)}">${escapeHtml(e.icon)}${e.qty > 1 ? `<small>${e.qty}</small>` : ''}</span>`).join('')}${holder.inventory.length > 8 ? '<span>…</span>' : ''}</div>` : ''}
    </div>`;

  const party = InventoryCore.ensureParty(state);
  const chars = master ? state.characters : invMyCharacters();
  const others = master ? state.characters.length - chars.length : state.characters.length - chars.length;
  const creatures = master ? state.tokens.filter(t => ['monster', 'npc', 'token'].includes(t.kind) &&
    ((Array.isArray(t.inventory) && t.inventory.length) || InventoryCore.hasCoins(t.coins))) : [];

  setInvMain(`
    <div class="modal-title inv-title"><span>🎒 Инвентари</span>
      <span class="inv-subtitle">${master ? 'Мастер видит всё' : 'Ваши персонажи и общий склад'}</span></div>
    <div class="modal-body">
      <div class="inv-section-label">Общий склад</div>
      ${card({ kind: 'party' }, '🏰', 'Общий склад группы', master ? 'Отсюда мастер раздаёт вещи' : 'Сюда можно сдавать вещи', party, true)}
      <div class="inv-section-label">Персонажи</div>
      <div class="inv-grid">
        ${chars.map(c => { InventoryCore.resolve(state, { kind: 'character', id: c.id });
          return card({ kind: 'character', id: c.id }, c.emoji || '👤', c.name, [c.charClass, c.level ? `ур. ${c.level}` : ''].filter(Boolean).join(' · ') || 'Персонаж', c, true); }).join('')
          || '<div class="inv-empty">Нет персонажей</div>'}
      </div>
      ${!master && others > 0 ? `<div class="inv-hint">Инвентари других игроков видит только мастер. Передать им вещь можно из своего инвентаря.</div>` : ''}
      ${creatures.length ? `<div class="inv-section-label">Существа на карте</div><div class="inv-grid">${
        creatures.map(t => card({ kind: 'token', id: t.id }, t.emoji || '❔', t.name, 'На карте', InventoryCore.resolve(state, { kind: 'token', id: t.id }).holder, true)).join('')}</div>` : ''}
    </div>
    <div class="modal-footer"><button class="btn" style="margin-left:auto" onclick="closeInvDialog('inv-main')">Закрыть</button></div>`);
}

/** Кнопка «Инвентарь» в верхней панели: игроку с одним персонажем — сразу его вещи. */
function openMyInventory() {
  const mine = invMyCharacters();
  if (!invIsMaster() && mine.length === 1) openInventory({ kind: 'character', id: mine[0].id });
  else openInventoryOverview();
}

/* ───────── сундуки ───────── */

/** Содержимое сундука выпадает один раз: при размещении или при первом открытии. */
function rollChestContents(poolKey) {
  const pool = LOOT_POOLS[poolKey];
  if (!pool) return [];
  const contents = [];
  let gold = 0;
  pool.forEach(entry => {
    if (Math.random() >= entry.chance) return;
    const qty = entry.qty[0] + Math.floor(Math.random() * (entry.qty[1] - entry.qty[0] + 1));
    if (entry.itemId === 'gold_pile') { for (let i = 0; i < qty; i++) gold += InventoryCore.rollGoldPile(); return; }
    const item = getLootItem(entry.itemId);
    if (item) contents.push({ id: item.id, name: item.name, icon: item.icon, rarity: item.rarity, desc: item.desc, qty });
  });
  if (gold || !contents.length) contents.unshift({ coins: { gp: gold || InventoryCore.rollGoldPile() } });
  return contents;
}

function openLootChestForToken(tokenId) {
  const token = state.tokens.find(t => t.id === tokenId);
  if (!token || !token.isLootChest) return;
  if (!Array.isArray(token.contents)) {
    const lib = getLootItem(token.lootId);
    if (!invAction({ type: 'chest_fill', tokenId, contents: rollChestContents(token.lootPool || lib?.lootPool) })) return;
  }
  invUI.main = { view: 'chest', tokenId };
  renderInvChest(tokenId);
}

function renderInvChest(tokenId) {
  const token = state.tokens.find(t => t.id === tokenId);
  if (!token || !Array.isArray(token.contents)) { closeInvDialog('inv-main'); return; }
  const list = token.contents.length ? token.contents.map((e, i) => {
    const entry = e.coins ? { ...e, name: InventoryCore.formatCoins(e.coins), icon: '💰' } : e;
    return invItemHtml(entry, `<button class="btn btn-sm btn-primary" onclick="invChestTake(${tokenId}, ${i})">Взять</button>`);
  }).join('') : '<div class="inv-empty">Сундук пуст</div>';
  setInvMain(`
    <div class="modal-title inv-title"><span>${escapeHtml(token.emoji || '📦')} ${escapeHtml(token.name)}</span>
      <span class="inv-subtitle">Что взято — исчезает из сундука у всех</span></div>
    <div class="modal-body inv-list">${list}</div>
    <div class="modal-footer"><button class="btn" style="margin-left:auto" onclick="closeInvDialog('inv-main')">Закрыть</button></div>`);
}

function invChestTake(tokenId, index) {
  const token = state.tokens.find(t => t.id === tokenId);
  const entry = token?.contents?.[index];
  if (!entry) return;
  const targets = invIsMaster() ? invTargets(null) : invTargets(null, { ownOnly: true });
  if (!targets.length) { toast('Сначала создайте своего персонажа', 'error'); return; }
  invPickTarget(`${escapeHtml(entry.coins ? '💰 ' + InventoryCore.formatCoins(entry.coins) : `${entry.icon} ${entry.name}`)} → кому?`, targets, to => {
    const fresh = state.tokens.find(t => t.id === tokenId)?.contents?.[index];
    if (!fresh) return;
    const qty = fresh.coins ? 1 : invAskQty(fresh.qty || 1, `Сколько взять «${fresh.name}»?`);
    if (qty) invAction({ type: 'chest_take', tokenId, index, itemId: fresh.coins ? 'coins' : fresh.id, qty, to });
  }, { autoSingle: !invIsMaster() });
}

/* ───────── предмет на карте ───────── */

/** Подобрать предмет с карты (removeTokenId) или выдать предмет из библиотеки (мастер). */
function addLootItemToCharInventory(itemId, removeTokenId) {
  const lib = getLootItem(itemId);
  if (removeTokenId != null) {
    const token = state.tokens.find(t => t.id === removeTokenId);
    if (!token) return;
    const targets = invIsMaster() ? invTargets(null) : invTargets(null, { ownOnly: true });
    if (!targets.length) { toast('Сначала создайте своего персонажа', 'error'); return; }
    const item = token.item || (lib && { id: lib.id, name: lib.name, icon: lib.icon, rarity: lib.rarity, desc: lib.desc });
    invPickTarget(`${escapeHtml(token.emoji || '')} ${escapeHtml(token.name)} → кому?`, targets, to => {
      const qty = Number(token.qty) || 1;
      let gold;
      if ((item?.id || itemId) === 'gold_pile') { gold = 0; for (let i = 0; i < qty; i++) gold += InventoryCore.rollGoldPile(); }
      invAction({ type: 'pickup', tokenId: removeTokenId, to, item, gold });
    }, { autoSingle: !invIsMaster() });
    return;
  }
  if (!lib) return;
  if (!invIsMaster()) { toast('Выдавать предметы может только мастер', 'error'); return; }
  invPickTarget(`${escapeHtml(lib.icon)} ${escapeHtml(lib.name)} → кому?`, invTargets(null), to => {
    if (lib.id === 'gold_pile') invAction({ type: 'coins', target: to, delta: { gp: InventoryCore.rollGoldPile() }, note: lib.name });
    else invAction({ type: 'add', to, item: lib, qty: 1 });
  });
}

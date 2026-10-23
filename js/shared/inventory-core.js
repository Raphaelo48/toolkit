// ============ INVENTORY CORE ============
// Общая логика инвентаря: одни и те же правила работают в браузере (без сервера и для мгновенного отклика)
// и на сервере (там они окончательные). Файл подключается и как обычный <script>, и через import в Node.
//
// Где лежат вещи:
//   персонаж            → character.inventory, character.coins   (вещи принадлежат персонажу, а не фишке)
//   монстр / NPC / иное → token.inventory, token.coins
//   общий склад группы  → state.party.inventory, state.party.coins
//   сундук на карте     → token.contents (выпадает один раз)
//   предмет на карте    → token.kind === 'loot', token.item, token.qty
(function (root) {
  'use strict';

  const COIN_KEYS = ['pp', 'gp', 'sp', 'cp'];
  const COIN_LABELS = { pp: 'пм', gp: 'зм', sp: 'см', cp: 'мм' };
  const COIN_NAMES = { pp: 'Платина', gp: 'Золото', sp: 'Серебро', cp: 'Медь' };
  const MAX_ITEMS = 300;
  const MAX_QTY = 99999;
  const MAX_LOG = 500;

  const str = (v, max) => String(v == null ? '' : v).slice(0, max);
  const int = (v, min, max) => Math.max(min, Math.min(max, Math.trunc(Number(v)) || 0));
  const sameId = (a, b) => a != null && b != null && String(a) === String(b);

  function normItem(raw, qty) {
    if (!raw || typeof raw !== 'object') return null;
    const id = str(raw.id, 80).trim();
    const name = str(raw.name, 120).trim();
    if (!id || !name) return null;
    const item = {
      id, name,
      icon: str(raw.icon || '❓', 16),
      rarity: str(raw.rarity || 'common', 20),
      desc: str(raw.desc, 1000),
      qty: int(qty != null ? qty : raw.qty, 1, MAX_QTY) || 1
    };
    if (raw.custom) item.custom = true;
    // Механика своего предмета мастера (слот, урон, КД…) — небольшой объект
    if (raw.mech && typeof raw.mech === 'object') {
      try { const m = JSON.stringify(raw.mech); if (m.length <= 2000) item.mech = JSON.parse(m); } catch (e) { /* без механики */ }
    }
    // У жезлов свои заряды — такие предметы не складываются в стопку
    const def = Items() && Items().defOf(item);
    if (def && def.charges) item.charges = int(raw.charges != null ? raw.charges : def.charges, 0, 999);
    return item;
  }

  const Items = () => root.ItemsCore || null;

  function normCoins(raw) {
    const c = {};
    for (const k of COIN_KEYS) c[k] = int(raw && raw[k], 0, 1e9);
    return c;
  }

  const hasCoins = c => !!c && COIN_KEYS.some(k => Number(c[k]) > 0);

  function formatCoins(c) {
    const parts = COIN_KEYS.filter(k => Number(c && c[k]) > 0).map(k => `${c[k]} ${COIN_LABELS[k]}`);
    return parts.length ? parts.join(' ') : '0 зм';
  }

  function ensureHolder(obj) {
    if (!Array.isArray(obj.inventory)) obj.inventory = [];
    obj.coins = normCoins(obj.coins);
    return obj;
  }

  function ensureParty(state) {
    if (!state.party || typeof state.party !== 'object') state.party = {};
    return ensureHolder(state.party);
  }

  /** Найти «контейнер» по ссылке { kind: 'character'|'token'|'party', id }. Фишка персонажа → сам персонаж. */
  function resolve(state, ref) {
    if (!ref || typeof ref !== 'object') return null;
    if (ref.kind === 'party') {
      return { kind: 'party', id: 'party', ref: { kind: 'party' }, name: 'Общий склад группы', icon: '🏰', holder: ensureParty(state) };
    }
    if (ref.kind === 'character') {
      const c = (state.characters || []).find(x => sameId(x.id, ref.id));
      if (!c) return null;
      ensureHolder(c);
      if (!c.equipment || typeof c.equipment !== 'object' || Array.isArray(c.equipment)) c.equipment = {};
      if (!Array.isArray(c.effects)) c.effects = [];
      return { kind: 'character', id: c.id, ref: { kind: 'character', id: c.id }, name: c.name, icon: c.emoji || '👤', ownerId: c.ownerId, holder: c, character: c };
    }
    if (ref.kind === 'token') {
      const t = (state.tokens || []).find(x => sameId(x.id, ref.id));
      if (!t) return null;
      if (t.kind === 'character' && t.sourceId != null) return resolve(state, { kind: 'character', id: t.sourceId });
      if (t.kind === 'loot') return null;
      return { kind: 'token', id: t.id, ref: { kind: 'token', id: t.id }, name: t.name, icon: t.emoji || '❔', holder: ensureHolder(t) };
    }
    return null;
  }

  const isMaster = actor => !actor || actor.role !== 'player';

  /** Может ли участник распоряжаться содержимым: мастер — всем, игрок — только своими персонажами. */
  function canManage(box, actor) {
    if (!box) return false;
    if (isMaster(actor)) return true;
    return box.kind === 'character' && sameId(box.ownerId, actor.playerId);
  }

  /** Может ли участник положить вещь сюда: игрок — любому персонажу или на общий склад. */
  function canGiveTo(box, actor) {
    if (!box) return false;
    if (isMaster(actor)) return true;
    return box.kind === 'character' || box.kind === 'party';
  }

  /** Может ли участник смотреть содержимое. */
  function canView(box, actor) {
    if (!box) return false;
    if (isMaster(actor)) return true;
    return box.kind === 'party' || canManage(box, actor);
  }

  function addItem(inventory, item, qty) {
    const n = int(qty != null ? qty : item.qty, 1, MAX_QTY) || 1;
    if (item.charges != null) {
      if (inventory.length + n > MAX_ITEMS) return false;
      for (let i = 0; i < n; i++) inventory.push({ ...item, qty: 1 });
      return true;
    }
    const existing = item.custom ? null : inventory.find(e => e.id === item.id && !e.custom && e.charges == null);
    if (existing) {
      existing.qty = Math.min(MAX_QTY, (Number(existing.qty) || 0) + n);
      return true;
    }
    if (inventory.length >= MAX_ITEMS) return false;
    inventory.push({ ...item, qty: n });
    return true;
  }

  function takeItem(inventory, itemId, qty) {
    const idx = inventory.findIndex(e => e.id === itemId);
    if (idx < 0) return null;
    const entry = inventory[idx];
    const n = Math.min(Number(entry.qty) || 1, int(qty, 1, MAX_QTY) || 1);
    entry.qty = (Number(entry.qty) || 1) - n;
    if (entry.qty <= 0) inventory.splice(idx, 1);
    return { ...entry, qty: n };
  }

  function countItems(holder) {
    return (holder && Array.isArray(holder.inventory) ? holder.inventory : []).reduce((s, e) => s + (Number(e.qty) || 1), 0);
  }

  const itemLabel = (item, qty) => `${item.icon} «${item.name}»${qty > 1 ? ` ×${qty}` : ''}`;

  function rollGoldPile() { return 50 + Math.floor(Math.random() * 251); }

  /**
   * Применить действие с инвентарём к состоянию.
   * actor: { role: 'master'|'player'|null, playerId, name }
   * opts.allocId(): новый id для фишки на карте
   * Возвращает { ok, error?, log?, addedTokens, removedTokenIds }.
   */
  function apply(state, action, actor, opts) {
    const result = { ok: false, addedTokens: [], removedTokenIds: [] };
    const fail = error => Object.assign(result, { ok: false, error });
    if (!state || !action || typeof action !== 'object') return fail('Неизвестное действие');
    const allocId = (opts && opts.allocId) || (() => { state.nextId = (Number(state.nextId) || 1) + 1; return state.nextId - 1; });
    const who = actor && actor.role === 'player' ? (actor.name || 'Игрок') : 'Мастер';

    switch (action.type) {
      case 'add': {
        if (!isMaster(actor)) return fail('Выдавать предметы может только мастер');
        const box = resolve(state, action.to);
        if (!box) return fail('Получатель не найден');
        const item = normItem(action.item, action.qty);
        if (!item) return fail('Неверный предмет');
        if (!addItem(box.holder.inventory, item, item.qty)) return fail('Инвентарь переполнен');
        result.log = `${box.icon} «${box.name}» получает ${itemLabel(item, item.qty)}`;
        break;
      }

      case 'remove': {
        const box = resolve(state, action.from);
        if (!canManage(box, actor)) return fail('Можно распоряжаться только своими вещами');
        const taken = takeItem(box.holder.inventory, str(action.itemId, 80), action.qty);
        if (!taken) return fail('Предмет не найден');
        const verb = action.reason === 'use' ? 'использует' : 'выбрасывает';
        result.log = `${box.icon} «${box.name}» ${verb} ${itemLabel(taken, taken.qty)}`;
        break;
      }

      case 'transfer': {
        const from = resolve(state, action.from);
        const to = resolve(state, action.to);
        if (!canManage(from, actor)) return fail('Можно передавать только свои вещи');
        if (!canGiveTo(to, actor)) return fail('Сюда нельзя передать предмет');
        if (from.kind === to.kind && sameId(from.id, to.id)) return fail('Это тот же инвентарь');
        const taken = takeItem(from.holder.inventory, str(action.itemId, 80), action.qty);
        if (!taken) return fail('Предмет не найден');
        if (!addItem(to.holder.inventory, taken, taken.qty)) {
          addItem(from.holder.inventory, taken, taken.qty);
          return fail('Инвентарь получателя переполнен');
        }
        result.log = `${from.icon} «${from.name}» → ${to.icon} «${to.name}»: ${itemLabel(taken, taken.qty)}`;
        break;
      }

      case 'drop': {
        const from = resolve(state, action.from);
        if (!canManage(from, actor)) return fail('Можно выбрасывать только свои вещи');
        const taken = takeItem(from.holder.inventory, str(action.itemId, 80), action.qty);
        if (!taken) return fail('Предмет не найден');
        const preferred = Number(action.tokenId);
        const id = Number.isFinite(preferred) && preferred > 0 && !(state.tokens || []).some(t => sameId(t.id, preferred))
          ? preferred : allocId();
        if (Number(state.nextId) <= id) state.nextId = id + 1;
        const token = {
          id, name: taken.name, type: 'object', emoji: taken.icon, image: null,
          color: '#d4a574', size: 40, notes: taken.desc || '',
          x: Number(action.x) || 0, y: Number(action.y) || 0,
          kind: 'loot', lootId: taken.id, item: { ...taken, qty: 1 }, qty: taken.qty,
          isLootChest: false, conditions: []
        };
        state.tokens = state.tokens || [];
        state.tokens.push(token);
        result.addedTokens.push(token);
        result.log = `${from.icon} «${from.name}» оставляет на карте ${itemLabel(taken, taken.qty)}`;
        break;
      }

      case 'pickup': {
        const idx = (state.tokens || []).findIndex(t => sameId(t.id, action.tokenId));
        const token = idx >= 0 ? state.tokens[idx] : null;
        if (!token || token.kind !== 'loot' || token.isLootChest) return fail('Предмет уже подобрали');
        const to = resolve(state, action.to);
        if (!canManage(to, actor)) return fail('Подобрать можно только своим персонажем');
        const qty = int(token.qty || 1, 1, MAX_QTY) || 1;
        const item = normItem(token.item || action.item, qty);
        if (!item) return fail('Неизвестный предмет');
        if (item.id === 'gold_pile') {
          const gp = int(action.gold != null ? action.gold : rollGoldPile() * qty, 0, 1e9);
          to.holder.coins.gp += gp;
          result.log = `${to.icon} «${to.name}» подбирает ${gp} зм`;
        } else {
          if (!addItem(to.holder.inventory, item, qty)) return fail('Инвентарь переполнен');
          result.log = `${to.icon} «${to.name}» подбирает ${itemLabel(item, qty)}`;
        }
        state.tokens.splice(idx, 1);
        result.removedTokenIds.push(token.id);
        break;
      }

      case 'chest_fill': {
        const token = (state.tokens || []).find(t => sameId(t.id, action.tokenId));
        if (!token || !token.isLootChest) return fail('Сундук не найден');
        if (Array.isArray(token.contents)) { result.ok = true; return result; } // уже открыт — ничего не делаем
        token.contents = (Array.isArray(action.contents) ? action.contents : []).slice(0, 50).map(normChestEntry).filter(Boolean);
        result.log = `📦 Открыт «${token.name}»`;
        const opener = action.who ? resolve(state, action.who) : null;
        const bonus = grantChestInspiration(token, opener, actor);
        if (bonus) result.log += `. ${bonus}`;
        break;
      }

      case 'chest_open': { // уже заполненный сундук открыт игроком: вдохновение за особый сундук
        const token = (state.tokens || []).find(t => sameId(t.id, action.tokenId));
        if (!token || !token.isLootChest) return fail('Сундук не найден');
        const bonus = grantChestInspiration(token, action.who ? resolve(state, action.who) : null, actor);
        if (!bonus) { result.ok = true; return result; }
        result.log = bonus;
        break;
      }

      case 'chest_take': {
        const token = (state.tokens || []).find(t => sameId(t.id, action.tokenId));
        if (!token || !token.isLootChest || !Array.isArray(token.contents)) return fail('Сундук не найден');
        const to = resolve(state, action.to);
        if (!canManage(to, actor)) return fail('Взять можно только своим персонажем');
        const entry = token.contents[int(action.index, 0, 1000)];
        if (!entry || (action.itemId && entry.id !== action.itemId && !(entry.coins && action.itemId === 'coins'))) {
          return fail('Этого уже нет в сундуке');
        }
        if (entry.coins) {
          for (const k of COIN_KEYS) to.holder.coins[k] += int(entry.coins[k], 0, 1e9);
          result.log = `${to.icon} «${to.name}» берёт из «${token.name}» ${formatCoins(entry.coins)}`;
          token.contents.splice(int(action.index, 0, 1000), 1);
        } else {
          const n = Math.min(entry.qty || 1, int(action.qty || entry.qty, 1, MAX_QTY) || 1);
          if (!addItem(to.holder.inventory, entry, n)) return fail('Инвентарь переполнен');
          entry.qty = (entry.qty || 1) - n;
          if (entry.qty <= 0) token.contents.splice(int(action.index, 0, 1000), 1);
          result.log = `${to.icon} «${to.name}» берёт из «${token.name}» ${itemLabel(entry, n)}`;
        }
        const bonus = grantChestInspiration(token, to, actor);
        if (bonus) result.log += `. ${bonus}`;
        break;
      }

      case 'coins': {
        const box = resolve(state, action.target);
        if (!box) return fail('Не найдено');
        const delta = {};
        for (const k of COIN_KEYS) delta[k] = int(action.delta && action.delta[k], -1e9, 1e9);
        const increases = COIN_KEYS.some(k => delta[k] > 0);
        if (!isMaster(actor) && (!canManage(box, actor) || increases)) {
          return fail(increases ? 'Деньги выдаёт мастер' : 'Можно тратить только свои деньги');
        }
        for (const k of COIN_KEYS) {
          if (box.holder.coins[k] + delta[k] < 0) return fail(`Не хватает: ${COIN_NAMES[k].toLowerCase()}`);
        }
        for (const k of COIN_KEYS) box.holder.coins[k] += delta[k];
        const plus = {}, minus = {};
        for (const k of COIN_KEYS) { if (delta[k] > 0) plus[k] = delta[k]; if (delta[k] < 0) minus[k] = -delta[k]; }
        result.log = `${box.icon} «${box.name}»: ` + [hasCoins(plus) ? `+${formatCoins(plus)}` : '', hasCoins(minus) ? `−${formatCoins(minus)}` : '']
          .filter(Boolean).join(', ') + (action.note ? ` (${str(action.note, 100)})` : '');
        break;
      }

      case 'coins_transfer': {
        const from = resolve(state, action.from);
        const to = resolve(state, action.to);
        if (!canManage(from, actor)) return fail('Можно передавать только свои деньги');
        if (!canGiveTo(to, actor)) return fail('Сюда нельзя передать деньги');
        const amount = normCoins(action.amount);
        if (!hasCoins(amount)) return fail('Укажите сумму');
        for (const k of COIN_KEYS) if (from.holder.coins[k] < amount[k]) return fail(`Не хватает: ${COIN_NAMES[k].toLowerCase()}`);
        for (const k of COIN_KEYS) { from.holder.coins[k] -= amount[k]; to.holder.coins[k] += amount[k]; }
        result.log = `${from.icon} «${from.name}» → ${to.icon} «${to.name}»: ${formatCoins(amount)}`;
        break;
      }

      /* ---------- снаряжение и использование ---------- */

      case 'equip': {
        const box = resolve(state, action.who);
        if (!box || box.kind !== 'character') return fail('Надевать вещи может только персонаж');
        if (!canManage(box, actor)) return fail('Можно распоряжаться только своими вещами');
        const c = box.character;
        const item = c.inventory.find(e => e.id === str(action.itemId, 80));
        if (!item) return fail('Предмет не найден');
        const plan = Items().planEquip(item, c.equipment, action.slot);
        if (plan.error) return fail(plan.error);
        const taken = takeItem(c.inventory, item.id, 1);
        for (const slot of plan.clear) {
          if (c.equipment[slot]) { addItem(c.inventory, c.equipment[slot], 1); delete c.equipment[slot]; }
        }
        c.equipment[plan.slot] = { ...taken, qty: 1 };
        result.log = `${box.icon} «${box.name}» надевает ${itemLabel(taken, 1)}`;
        break;
      }

      case 'unequip': {
        const box = resolve(state, action.who);
        if (!box || box.kind !== 'character') return fail('Не найдено');
        if (!canManage(box, actor)) return fail('Можно распоряжаться только своими вещами');
        const c = box.character;
        const slot = str(action.slot, 20);
        const item = c.equipment[slot];
        if (!item) return fail('Слот пуст');
        if (!addItem(c.inventory, item, 1)) return fail('Рюкзак переполнен');
        delete c.equipment[slot];
        result.log = `${box.icon} «${box.name}» снимает ${itemLabel(item, 1)}`;
        break;
      }

      case 'use': {
        const box = resolve(state, action.who);
        if (!box || box.kind !== 'character') return fail('Использовать предмет может только персонаж');
        if (!canManage(box, actor)) return fail('Можно использовать только свои вещи');
        const c = box.character;
        const id = str(action.itemId, 80);
        const item = c.inventory.find(e => e.id === id && (e.charges == null || e.charges > 0)) || c.inventory.find(e => e.id === id);
        if (!item) return fail('Предмет не найден');
        const def = Items().defOf(item);
        const u = def && def.use;
        if (!u) return fail('Этот предмет нельзя использовать — его можно надеть или отдать мастеру');
        if (def.charges && !(item.charges > 0)) return fail('В жезле не осталось зарядов');
        const hpMax = Number(c.hpMax) || 0, hpCur = Number(c.hpCur) || 0;
        if (u.kind === 'revive' && hpCur > 0) return fail('Персонаж жив — свиток возрождения не нужен');
        if (u.kind === 'heal' && hpCur >= hpMax && hpMax > 0) return fail('Хиты и так полные');

        // Сколько выпало: бросок присылает клиент, сервер проверяет, что он возможен
        const rolled = () => {
          const lo = Items().diceMin(u.dice), hi = Items().diceMax(u.dice);
          const v = Number(action.rolled);
          return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : Items().rollDice(u.dice).total;
        };
        const setHp = v => {
          c.hpCur = Math.max(0, Math.min(hpMax || v, v));
          c.hpRev = (Number(c.hpRev) || 0) + 1;
          for (const t of state.tokens || []) if (t.kind === 'character' && sameId(t.sourceId, c.id)) t.hpCur = c.hpCur;
        };

        // Расход: заряд жезла или сам предмет
        if (def.charges) item.charges -= 1;
        else takeItem(c.inventory, item.id, 1);

        const what = `${item.icon} «${item.name}»`;
        if (u.kind === 'heal') {
          const amount = rolled();
          setHp(hpCur + amount);
          result.amount = amount;
          result.log = `${box.icon} «${box.name}» использует ${what}: +${amount} хитов (${c.hpCur}/${hpMax})`;
        } else if (u.kind === 'revive') {
          setHp(1);
          result.log = `${box.icon} «${box.name}» возвращается к жизни: ${what} (1/${hpMax})`;
        } else if (u.kind === 'spell') {
          const amount = rolled();
          result.amount = amount;
          result.log = `${box.icon} «${box.name}» применяет ${what}: ${amount} урона ${u.type}${u.save ? ` (${u.save})` : ''}`;
        } else if (u.kind === 'buff') {
          const round = Number(state.initRound) || 1;
          const effect = {
            id: Number(action.logId) || Date.now(), name: str(u.name, 60), icon: item.icon,
            mods: JSON.parse(JSON.stringify(u.mods || {})), startRound: round,
            untilRound: u.rounds ? round + u.rounds - 1 : null, duration: u.duration || '', text: u.text || ''
          };
          c.effects = c.effects.filter(e => e.name !== effect.name);
          c.effects.push(effect);
          result.log = `${box.icon} «${box.name}» использует ${what}: ${effect.name}${effect.duration ? ` на ${effect.duration}` : ''}`;
        } else {
          result.log = `${box.icon} «${box.name}» использует ${what}`;
        }
        if (def.charges) result.log += ` — зарядов осталось ${item.charges}`;
        break;
      }

      /* ---------- вдохновение ---------- */

      case 'inspiration': {
        if (!isMaster(actor)) return fail('Вдохновение выдаёт мастер');
        const box = resolve(state, action.who);
        if (!box || box.kind !== 'character') return fail('Не найдено');
        const c = box.character;
        const before = int(c.inspiration, 0, 99);
        c.inspiration = Math.max(0, Math.min(99, before + int(action.delta, -99, 99)));
        if (c.inspiration === before) return fail('Вдохновение не изменилось');
        result.log = `${box.icon} «${box.name}»: вдохновение ${c.inspiration > before ? '+' : '−'}${Math.abs(c.inspiration - before)} (стало ${c.inspiration})${action.note ? ' — ' + str(action.note, 80) : ''}`;
        break;
      }

      case 'effect_remove': {
        const box = resolve(state, action.who);
        if (!box || box.kind !== 'character') return fail('Не найдено');
        if (!canManage(box, actor)) return fail('Снимать эффекты можно только со своего персонажа');
        const before = box.character.effects.length;
        const removed = box.character.effects.find(e => sameId(e.id, action.effectId));
        box.character.effects = box.character.effects.filter(e => !sameId(e.id, action.effectId));
        if (box.character.effects.length === before) return fail('Эффект не найден');
        result.log = `${box.icon} «${box.name}»: эффект «${removed.name}» закончился`;
        break;
      }

      default:
        return fail('Неизвестное действие');
    }

    result.ok = true;
    if (result.log) {
      const logId = Number(action.logId);
      result.logEntry = { id: Number.isFinite(logId) && logId > 0 ? logId : Date.now() + Math.random(), type: 'loot', message: `🎒 ${result.log}`, data: null, timestamp: Date.now() };
      if (!Array.isArray(state.eventLog)) state.eventLog = [];
      state.eventLog.unshift(result.logEntry);
      if (state.eventLog.length > MAX_LOG) state.eventLog.length = MAX_LOG;
    }
    return result;
  }

  // Запертый и древний сундук: первый игрок, добравшийся до него, получает вдохновение
  const INSPIRING_CHESTS = ['chest_locked', 'chest_ancient'];
  function grantChestInspiration(token, box, actor) {
    if (!token || !INSPIRING_CHESTS.includes(token.lootId) || token.inspirationGiven) return '';
    if (isMaster(actor) || !box || box.kind !== 'character' || !canManage(box, actor)) return '';
    token.inspirationGiven = true;
    box.character.inspiration = Math.min(99, int(box.character.inspiration, 0, 99) + 1);
    return `✨ «${box.name}» получает вдохновение за «${token.name}»`;
  }

  function normChestEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.coins) {
      const coins = normCoins(raw.coins);
      return hasCoins(coins) ? { id: 'coins', coins, name: formatCoins(coins), icon: '💰' } : null;
    }
    return normItem(raw, raw.qty);
  }

  /**
   * Перенос старого формата (state.inventory[tokenId]) в новый (вещи у персонажей и фишек).
   * Вызывается при загрузке сохранения и состояния комнаты. Безопасно вызывать повторно.
   */
  function migrate(state) {
    if (!state || typeof state !== 'object') return false;
    let changed = false;
    const old = state.inventory;
    if (old && typeof old === 'object' && !Array.isArray(old)) {
      for (const [tokenId, items] of Object.entries(old)) {
        if (!Array.isArray(items) || !items.length) continue;
        let box = resolve(state, { kind: 'token', id: tokenId });
        if (!box) box = resolve(state, { kind: 'party' }); // фишку удалили — вещи не теряем, кладём на склад
        for (const raw of items) {
          const item = normItem(raw, raw && raw.qty);
          if (item) addItem(box.holder.inventory, item, item.qty);
        }
      }
      changed = true;
    }
    if ('inventory' in state) { delete state.inventory; changed = true; }
    ensureParty(state);
    return changed;
  }

  const api = {
    COIN_KEYS, COIN_LABELS, COIN_NAMES,
    normItem, normCoins, hasCoins, formatCoins, rollGoldPile,
    resolve, canManage, canGiveTo, canView, countItems, apply, migrate, ensureParty
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.InventoryCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

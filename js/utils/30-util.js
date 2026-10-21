// ============ UTIL ============
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(msg, type = '') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}


// ============ РОЛИ ============
// Без онлайна или у мастера — полный доступ; игрок управляет только своими персонажами.
function isPlayerRole() { return window.dndOnlineGetRole?.() === 'player'; }
function myPlayerId() { return String(window.DND_ONLINE?.meta?.player?.id ?? ''); }
function isOwnCharacter(c) { return !!c && (!isPlayerRole() || String(c.ownerId) === myPlayerId()); }
/** Фишка, которой текущий участник может управлять (HP, инициатива и т.п.). */
function canControlToken(t) {
  if (!t) return false;
  if (!isPlayerRole()) return true;
  if (t.kind !== 'character') return false;
  return isOwnCharacter(state.characters.find(c => c.id === t.sourceId));
}
/** Своя фишка игрока на поле (не больше одной). */
function myTokenOnMap() {
  const mine = new Set(state.characters.filter(c => String(c.ownerId) === myPlayerId()).map(c => c.id));
  return state.tokens.find(t => t.kind === 'character' && mine.has(t.sourceId)) || null;
}

/**
 * Отметить, что у персонажа поменялось HP. Номер правки нужен серверу: если мастер и игрок
 * меняют персонажа одновременно (мастер бьёт, игрок двигает фишку), побеждает более свежее HP,
 * а не тот, чьё сообщение пришло позже.
 */
function bumpHp(c) { if (c) c.hpRev = (Number(c.hpRev) || 0) + 1; }

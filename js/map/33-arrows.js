// ============ ДВИЖЕНИЕ СТРЕЛКАМИ ============
// Игрок ведёт своего персонажа стрелками (или WASD) — плавно, пока клавиша зажата.
// Мастер так же двигает выбранную фишку. Shift — быстрее. Стены и закрытые двери не пускают игрока.

const ARROWS = { keys: new Set(), raf: 0, last: 0, lastSync: 0, token: null };
const ARROW_KEYS = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
};
const ARROW_CELLS_PER_SEC = 4;

function arrowTarget() {
  if (isPlayerRole()) return myTokenOnMap();
  return state.tokens.find(t => t.id === state.selectedTokenId) || null;
}

function arrowTyping(e) {
  const t = e.target;
  return t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable);
}

document.addEventListener('keydown', e => {
  if (!(e.code in ARROW_KEYS) || arrowTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (typeof BOARDS !== 'undefined' && BOARDS.current) return; // открыт холст для просмотра — фишки не двигаем
  if (document.querySelector('.modal-overlay[style*="flex"]:not(#dice-modal), .inv-overlay')) return; // открыто окно
  // WASD — только для движения, когда есть кого двигать (иначе это горячие клавиши инструментов)
  const isLetter = e.code.startsWith('Key');
  const token = arrowTarget();
  if (!token) { if (!isLetter && isPlayerRole()) toast('Сначала поставьте своего персонажа на поле'); return; }
  if (isLetter && !isPlayerRole()) return; // у мастера буквы заняты инструментами
  e.preventDefault();
  e.stopImmediatePropagation();
  ARROWS.keys.add(e.code);
  if (!ARROWS.raf) {
    ARROWS.token = token;
    ARROWS.last = performance.now();
    state.arrowMoving = true;
    if (state.selectedTokenId !== token.id) selectToken(token.id);
    ARROWS.raf = requestAnimationFrame(arrowStep);
  }
}, true);

document.addEventListener('keyup', e => {
  if (!(e.code in ARROW_KEYS)) return;
  ARROWS.keys.delete(e.code);
  if (!ARROWS.keys.size) arrowStop();
}, true);
window.addEventListener('blur', () => { ARROWS.keys.clear(); arrowStop(); });

function arrowStep(now) {
  const token = ARROWS.token && state.tokens.find(t => t.id === ARROWS.token.id);
  if (!token || !ARROWS.keys.size) { arrowStop(); return; }
  const dt = Math.min(0.25, (now - ARROWS.last) / 1000);
  ARROWS.last = now;
  let dx = 0, dy = 0;
  for (const code of ARROWS.keys) { dx += ARROW_KEYS[code][0]; dy += ARROW_KEYS[code][1]; }
  const len = Math.hypot(dx, dy);
  if (len) {
    const fast = ARROWS.shift ? 2 : 1;
    const speed = (Number(state.grid?.size) || 50) * ARROW_CELLS_PER_SEC * fast;
    const tx = token.x + (dx / len) * speed * dt, ty = token.y + (dy / len) * speed * dt;
    const to = window.dndLimitMove?.(token, tx, ty) || { x: tx, y: ty, blocked: false };
    token.x = Math.max(0, Math.min(state.map.width || 99999, to.x));
    token.y = Math.max(0, Math.min(state.map.height || 99999, to.y));
    const el = document.querySelector(`.token[data-id="${token.id}"]`);
    if (el) {
      el.style.left = (token.x - token.size / 2) + 'px';
      el.style.top = (token.y - token.size / 2) + 'px';
      el.classList.toggle('bumped', !!to.blocked);
    }
    window.dndVisionOnDrag?.(token);
    arrowKeepInView(token);
    if (now - ARROWS.lastSync > 200) { ARROWS.lastSync = now; window.dndOnlineSync?.('token_arrows'); }
  }
  ARROWS.raf = requestAnimationFrame(arrowStep);
}

function arrowStop() {
  if (ARROWS.raf) cancelAnimationFrame(ARROWS.raf);
  ARROWS.raf = 0;
  if (!state.arrowMoving) return;
  state.arrowMoving = false;
  document.querySelectorAll('.token.bumped').forEach(el => el.classList.remove('bumped'));
  ARROWS.token = null;
  window.dndVisionEndDrag?.();
  renderInfoPanel?.();
  window.dndOnlineSync?.('token_arrows');
  window.DND_ONLINE?.flushPending?.();
}

/** Фишка у края экрана — сдвигаем вид, чтобы она не уходила за край. */
function arrowKeepInView(token) {
  const area = document.getElementById('map-area');
  const rect = area.getBoundingClientRect();
  const sx = token.x * state.view.zoom + state.view.panX, sy = token.y * state.view.zoom + state.view.panY;
  const m = 90;
  let moved = false;
  if (sx < m) { state.view.panX += m - sx; moved = true; }
  if (sx > rect.width - m) { state.view.panX -= sx - (rect.width - m); moved = true; }
  if (sy < m) { state.view.panY += m - sy; moved = true; }
  if (sy > rect.height - m) { state.view.panY -= sy - (rect.height - m); moved = true; }
  if (moved) updateMapTransform();
}

document.addEventListener('keydown', e => { if (e.key === 'Shift') ARROWS.shift = true; });
document.addEventListener('keyup', e => { if (e.key === 'Shift') ARROWS.shift = false; });

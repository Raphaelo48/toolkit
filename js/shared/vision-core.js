// ============ VISION CORE ============
// Обзор персонажей с учётом стен («туман войны» как в MOBA). Общий для браузера и сервера.
//
// Карта делится на мелкие клетки (cell px). walls[i] = 1 — клетка непрозрачна (стена).
// Двери — прямоугольники в клетках: закрытая дверь непрозрачна, открытая — проход.
// Видимость считается лучами от каждой фишки до первой стены в пределах радиуса.
(function (root) {
  'use strict';

  /* ---------- упаковка масок ---------- */

  function packBits(mask) {
    const bytes = new Uint8Array(Math.ceil(mask.length / 8));
    for (let i = 0; i < mask.length; i++) if (mask[i]) bytes[i >> 3] |= 1 << (i & 7);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  }

  function unpackBits(str, n) {
    const bin = typeof atob === 'function' ? atob(str || '') : Buffer.from(str || '', 'base64').toString('binary');
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const byte = bin.charCodeAt(i >> 3) || 0;
      if (byte & (1 << (i & 7))) mask[i] = 1;
    }
    return mask;
  }

  /** Маски крупные и «пятнистые» — длины серий сжимают их в сотни раз. Начинается с серии нулей. */
  function rleEncode(mask) {
    const runs = [];
    let cur = 0, len = 0;
    for (let i = 0; i < mask.length; i++) {
      const v = mask[i] ? 1 : 0;
      if (v === cur) len++;
      else { runs.push(len); cur = v; len = 1; }
    }
    runs.push(len);
    return runs;
  }

  function rleDecode(runs, n) {
    const mask = new Uint8Array(n);
    let pos = 0, v = 0;
    for (const len of runs || []) {
      if (v) mask.fill(1, pos, Math.min(n, pos + len));
      pos += len; v ^= 1;
    }
    return mask;
  }

  /* ---------- стены и двери ---------- */

  /** Стены с учётом дверей: закрытая дверь — стена, открытая — проход (даже если нарисована поверх стены). */
  function blockingMask(walls, w, h, doors) {
    const out = new Uint8Array(walls);
    for (const d of doors || []) {
      const x1 = Math.max(0, Math.min(d.x1, d.x2)), x2 = Math.min(w - 1, Math.max(d.x1, d.x2));
      const y1 = Math.max(0, Math.min(d.y1, d.y2)), y2 = Math.min(h - 1, Math.max(d.y1, d.y2));
      const v = d.open ? 0 : 1;
      for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) out[y * w + x] = v;
    }
    return out;
  }

  /* ---------- видимость ---------- */

  /**
   * sources: [{ x, y, r }] — в пикселях карты (r — радиус обзора в пикселях).
   * Возвращает Uint8Array w*h: 1 — клетку сейчас видно.
   */
  function computeVisible(blocking, w, h, cell, sources) {
    const vis = new Uint8Array(w * h);
    for (const s of sources || []) {
      const cx = s.x / cell, cy = s.y / cell;
      const R = Math.max(1, s.r / cell);
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
      const rays = Math.max(360, Math.ceil(2 * Math.PI * R * 1.6));
      const R2 = R * R;
      const startIdx = Math.floor(cy) * w + Math.floor(cx);
      vis[startIdx] = 1;
      for (let k = 0; k < rays; k++) {
        const a = (k / rays) * Math.PI * 2;
        const dx = Math.cos(a) * 0.5, dy = Math.sin(a) * 0.5;
        let x = cx, y = cy;
        let leftStart = false;
        for (let step = 0; step < R * 2 + 2; step++) {
          x += dx; y += dy;
          const ix = x | 0, iy = y | 0;
          if (ix < 0 || iy < 0 || ix >= w || iy >= h) break;
          const ox = x - cx, oy = y - cy;
          if (ox * ox + oy * oy > R2) break;
          const idx = iy * w + ix;
          vis[idx] = 1;
          if (blocking[idx]) {
            // Фишка может стоять на стене/в проёме — первые клетки не останавливают взгляд
            if (leftStart || step > 3) break;
          } else leftStart = true;
        }
      }
    }
    // Подсветить края стен вокруг видимого пола — иначе стены выглядят «обгрызенными»
    const out = new Uint8Array(vis);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (vis[i] || !blocking[i]) continue;
        if ((vis[i - 1] && !blocking[i - 1]) || (vis[i + 1] && !blocking[i + 1]) ||
            (vis[i - w] && !blocking[i - w]) || (vis[i + w] && !blocking[i + w])) out[i] = 1;
      }
    }
    return out;
  }

  const cellIndex = (x, y, w, h, cell) => {
    const ix = Math.floor(x / cell), iy = Math.floor(y / cell);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return -1;
    return iy * w + ix;
  };

  /** Видна ли точка (центр фишки) — с небольшим допуском, чтобы фишка у стены не «мигала». */
  function isPointVisible(vis, w, h, cell, x, y, slackPx) {
    const s = slackPx || 0;
    for (const [ox, oy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) {
      const i = cellIndex(x + ox, y + oy, w, h, cell);
      if (i >= 0 && vis[i]) return true;
    }
    return false;
  }

  /* ---------- распознавание стен по картинке ---------- */

  /**
   * pixels — RGBA (ImageData.data) карты размером W×H. ref — цвет пола [r,g,b] (клик мастера по полу).
   * Клетка — пол, если в ней достаточно пикселей похожего цвета. Возвращает walls (1 — стена).
   */
  function detectWalls(pixels, W, H, cell, ref, tolerance, iconCells) {
    const w = Math.ceil(W / cell), h = Math.ceil(H / cell);
    const tol = tolerance || 40, tol2 = tol * tol;
    const floorCount = new Uint32Array(w * h), total = new Uint32Array(w * h);
    for (let y = 0; y < H; y++) {
      const cy = (y / cell) | 0;
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        const i = cy * w + ((x / cell) | 0);
        total[i]++;
        if (pixels[p + 3] < 20) continue; // прозрачное — не пол
        const dr = pixels[p] - ref[0], dg = pixels[p + 1] - ref[1], db = pixels[p + 2] - ref[2];
        if (dr * dr + dg * dg + db * db <= tol2) floorCount[i]++;
      }
    }
    const walls = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) walls[i] = floorCount[i] >= total[i] * 0.35 ? 0 : 1;
    // Значки на полу (звёзды, камешки, линии) — не стены; размер берётся от клетки сетки
    removeSmallIslands(walls, w, h, 1, Math.max(6, iconCells || 6));
    removeSmallIslands(walls, w, h, 0, 3); // одиночные «пол»-точки в стенах — шум
    return { walls, w, h, cell };
  }

  /** Убрать связные области значения value размером меньше minSize (заменить на противоположное). */
  function removeSmallIslands(mask, w, h, value, minSize) {
    const seen = new Uint8Array(w * h);
    const stack = [], comp = [];
    for (let start = 0; start < w * h; start++) {
      if (seen[start] || mask[start] !== value) continue;
      stack.length = 0; comp.length = 0;
      stack.push(start); seen[start] = 1;
      while (stack.length) {
        const i = stack.pop();
        comp.push(i);
        const x = i % w, y = (i / w) | 0;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
          if (j >= 0 && !seen[j] && mask[j] === value) { seen[j] = 1; stack.push(j); }
        }
      }
      if (comp.length < minSize) for (const i of comp) mask[i] = value ? 0 : 1;
    }
  }

  /** Нарисовать кистью: value 1 — стена, 0 — проход. Координаты и радиус — в пикселях карты. */
  function paint(walls, w, h, cell, x, y, radiusPx, value) {
    const r = Math.max(0.5, radiusPx / cell);
    const cx = x / cell, cy = y / cell;
    for (let iy = Math.floor(cy - r); iy <= Math.ceil(cy + r); iy++) {
      for (let ix = Math.floor(cx - r); ix <= Math.ceil(cx + r); ix++) {
        if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
        const dx = ix + 0.5 - cx, dy = iy + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) walls[iy * w + ix] = value;
      }
    }
  }

  const api = { packBits, unpackBits, rleEncode, rleDecode, blockingMask, computeVisible, isPointVisible, detectWalls, paint, cellIndex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VisionCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

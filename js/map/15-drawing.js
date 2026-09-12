// ============ DRAWING ============
function drawAt(x, y) {
  const size = state.drawSettings.size;
  const color = state.drawSettings.color;
  if (state.tool === 'brush') {
    const canvas = document.getElementById('draw-canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (state.tool === 'eraser') {
    const drawCanvas = document.getElementById('draw-canvas');
    const fogCanvas = document.getElementById('fog-canvas');
    const drawCtx = drawCanvas.getContext('2d');
    const fogCtx = fogCanvas.getContext('2d');
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.beginPath();
    drawCtx.arc(x, y, size / 2, 0, Math.PI * 2);
    drawCtx.fill();
    drawCtx.globalCompositeOperation = 'source-over';
    fogCtx.globalCompositeOperation = 'destination-out';
    fogCtx.beginPath();
    fogCtx.arc(x, y, size / 2, 0, Math.PI * 2);
    fogCtx.fill();
    fogCtx.globalCompositeOperation = 'source-over';
  } else if (state.tool === 'fog') {
    const canvas = document.getElementById('fog-canvas');
    const ctx = canvas.getContext('2d');
    const opacity = state.drawSettings.opacity / 100;
    ctx.fillStyle = hexToRgba(color, opacity);
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLine(x1, y1, x2, y2) {
  const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  const step = Math.max(2, state.drawSettings.size / 4);
  const steps = Math.max(1, Math.floor(dist / step));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    drawAt(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
  }
}

function drawText(x, y, text) {
  const canvas = document.getElementById('draw-canvas');
  const ctx = canvas.getContext('2d');
  const size = state.drawSettings.size;
  ctx.font = `bold ${Math.max(14, size * 2)}px "Cormorant Garamond", serif`;
  ctx.fillStyle = state.drawSettings.color;
  ctx.strokeStyle = 'rgba(21, 18, 14, 0.8)';
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

function hexToRgba(hex, alpha) {
  const value = String(hex || '#000000').replace('#', '');
  const normalized = value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value;
  const r = parseInt(normalized.slice(0, 2), 16) || 0;
  const g = parseInt(normalized.slice(2, 4), 16) || 0;
  const b = parseInt(normalized.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shapeTypeLabel(type) {
  return ({ rect: 'прямоугольник', circle: 'круг', line: 'линия', arrow: 'стрелка' })[type] || 'фигура';
}

function makeShapeFromPoints(start, end, preview = false) {
  const type = state.shapeSettings.type;
  return {
    type, layer: state.shapeSettings.layer, color: state.drawSettings.color,
    size: Math.max(1, state.drawSettings.size),
    opacity: 1, start: { ...start }, end: { ...end }, preview
  };
}

function drawShape(ctx, shape) {
  const { start: a, end: b, color, size, type } = shape;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = hexToRgba(color, 0.16);
  ctx.lineWidth = Math.max(1, size);
  ctx.globalAlpha = shape.preview ? 0.65 : 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (type === 'rect') {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
  } else if (type === 'circle') {
    const dx = b.x - a.x, dy = b.y - a.y;
    const radius = Math.sqrt(dx * dx + dy * dy);
    ctx.beginPath(); ctx.arc(a.x, a.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (type === 'line' || type === 'arrow') {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    if (type === 'arrow') {
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const head = Math.max(10, size * 3);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 6), b.y - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 6), b.y - head * Math.sin(angle + Math.PI / 6));
      ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    }
  }
  ctx.restore();
}

function renderShapes() {
  const w = state.map.width || MAP_MAX, h = state.map.height || MAP_MAX;
  const back = document.getElementById('shapes-back-canvas');
  const front = document.getElementById('shapes-canvas');
  if (!back || !front) return;
  [back, front].forEach(canvas => {
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').clearRect(0, 0, w, h);
  });
  const backCtx = back.getContext('2d'), frontCtx = front.getContext('2d');
  state.shapes.forEach(shape => drawShape(shape.layer === 'front' ? frontCtx : backCtx, shape));
  if (state.shapePreview) drawShape(state.shapePreview.layer === 'front' ? frontCtx : backCtx, state.shapePreview);
}

function finishMeasure(end) {
  const start = state.measureStart;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const px = Math.sqrt(dx * dx + dy * dy);
  const cells = px / state.grid.size;
  const dist = cells.toFixed(1);
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  if (state.measureLabel) state.measureLabel.remove();
  const label = document.createElement('div');
  label.className = 'measure-label';
  label.style.left = midX + 'px';
  label.style.top = midY + 'px';
  label.style.transform = 'translate(-50%, -50%)';
  label.textContent = `${dist} кл. (${Math.round(px)} px)`;
  document.getElementById('map-layer').appendChild(label);
  state.measureLabel = label;
  logEvent('map', `📏 Измерение: ${dist} клеток`);
  toast(`Расстояние: ${dist} клеток`);
  state.measureStart = null;
  setTimeout(() => {
    if (state.measureLabel === label) { label.remove(); state.measureLabel = null; }
  }, 5000);
}

function clearMeasure() {
  if (state.measureLabel) { state.measureLabel.remove(); state.measureLabel = null; }
  state.measureStart = null;
}

// ============ TOOLS ============
function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.tool-item[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  const area = document.getElementById('map-area');
  area.classList.remove('tool-select', 'tool-pan', 'tool-draw');
  if (['brush', 'eraser', 'fog', 'text', 'measure', 'shape'].includes(tool)) area.classList.add('tool-draw');
  else area.classList.add('tool-' + tool);
  const drawCanvas = document.getElementById('draw-canvas');
  drawCanvas.classList.toggle('interactive', ['brush', 'eraser', 'fog', 'text', 'measure', 'shape'].includes(tool));
  if (tool !== 'measure') clearMeasure();
  updateDrawBarVisibility();
}

function updateDrawBarVisibility() {
  const bar = document.getElementById('draw-bar');
  const show = ['brush', 'eraser', 'fog', 'shape'].includes(state.tool);
  bar.classList.toggle('visible', show);
  const opacityLabel = document.getElementById('draw-opacity-label');
  const opacityDivider = document.getElementById('draw-opacity-divider');
  const shapeTypeLabel = document.getElementById('shape-type-label');
  const shapeLayerLabel = document.getElementById('shape-layer-label');
  const isFog = state.tool === 'fog';
  const isShape = state.tool === 'shape';
  opacityLabel.style.display = isFog ? 'flex' : 'none';
  opacityDivider.style.display = isFog ? 'block' : 'none';
  shapeTypeLabel.style.display = isShape ? 'flex' : 'none';
  shapeLayerLabel.style.display = isShape ? 'flex' : 'none';
}

function setupDrawControls() {
  const bar = document.getElementById('draw-bar');
  const color = document.getElementById('draw-color');
  const size = document.getElementById('draw-size');
  const opacity = document.getElementById('draw-opacity');
  color.addEventListener('input', (e) => { state.drawSettings.color = e.target.value; renderShapes(); });
  size.addEventListener('input', (e) => {
    state.drawSettings.size = parseInt(e.target.value);
    document.getElementById('draw-size-val').textContent = e.target.value;
  });
  // Колесо мыши над ползунком меняет размер, а не масштаб карты.
  size.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const min = parseInt(size.min) || 2, max = parseInt(size.max) || 80;
    const step = e.deltaY < 0 ? 2 : -2;
    size.value = Math.max(min, Math.min(max, parseInt(size.value) + step));
    size.dispatchEvent(new Event('input', { bubbles: true }));
  }, { passive: false });
  opacity.addEventListener('input', (e) => {
    state.drawSettings.opacity = parseInt(e.target.value);
    document.getElementById('draw-opacity-val').textContent = e.target.value + '%';
  });
  opacity.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });
  color.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  bar.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });

  // Панель инструментов находится внутри #map-area. Поэтому её mousedown
  // доходил до обработчика карты и воспринимался как начало рисования/фигуры.
  // Из-за этого range/select было невозможно нормально перетаскивать/менять.
  ['mousedown', 'pointerdown', 'click', 'dblclick'].forEach(type => {
    bar.addEventListener(type, (e) => e.stopPropagation());
  });

  document.getElementById('shape-type').addEventListener('change', (e) => {
    state.shapeSettings.type = e.target.value;
    renderShapes();
  });
  document.getElementById('shape-layer').addEventListener('change', (e) => {
    state.shapeSettings.layer = e.target.value;
    renderShapes();
  });
}

function toggleGrid() {
  state.grid.enabled = !state.grid.enabled;
  document.getElementById('grid-key').textContent = state.grid.enabled ? 'ВКЛ' : 'ВЫКЛ';
  updateGrid();
  logEvent('system', state.grid.enabled ? 'Сетка включена' : 'Сетка выключена');
  toast(state.grid.enabled ? 'Сетка включена' : 'Сетка выключена');
}

function updateGrid() {
  const size = parseInt(document.getElementById('grid-size').value) || 50;
  state.grid.size = Math.max(10, Math.min(200, size));
  document.getElementById('grid-size').value = state.grid.size;
  drawGrid();
}

function drawGrid() {
  const canvas = document.getElementById('grid-canvas');
  const w = state.map.width || MAP_MAX;
  const h = state.map.height || MAP_MAX;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!state.grid.enabled) return;
  const size = state.grid.size;
  ctx.strokeStyle = 'rgba(236, 228, 214, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x += size) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
  for (let y = 0; y <= h; y += size) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
  ctx.stroke();
}

function clearDrawings() {
  if (!confirm('Очистить все рисунки и туман войны?')) return;
  const drawCtx = document.getElementById('draw-canvas').getContext('2d');
  const fogCtx = document.getElementById('fog-canvas').getContext('2d');
  const shapesCtx = document.getElementById('shapes-canvas').getContext('2d');
  const shapesBackCtx = document.getElementById('shapes-back-canvas').getContext('2d');
  const w = state.map.width || MAP_MAX;
  const h = state.map.height || MAP_MAX;
  drawCtx.clearRect(0, 0, w, h);
  fogCtx.clearRect(0, 0, w, h);
  shapesCtx.clearRect(0, 0, w, h);
  shapesBackCtx.clearRect(0, 0, w, h);
  state.shapes = [];
  logEvent('system', 'Рисунки и фигуры очищены');
  toast('Рисунки очищены');
}

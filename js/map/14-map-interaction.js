// ============ MAP INTERACTION ============
function setupMapInteraction() {
  const area = document.getElementById('map-area');
  const drawCanvas = document.getElementById('draw-canvas');

  area.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const tokenEl = e.target.closest('.token');

    if (['brush', 'eraser', 'fog'].includes(state.tool) && drawCanvas.classList.contains('interactive')) {
      const rect = area.getBoundingClientRect();
      const mc = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
      state.isDrawing = true;
      state.lastDrawPos = mc;
      drawAt(mc.x, mc.y);
      e.preventDefault();
      return;
    }

    if (state.tool === 'shape' && drawCanvas.classList.contains('interactive')) {
      const rect = area.getBoundingClientRect();
      const mc = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
      state.shapeStart = mc;
      state.shapePreview = null;
      e.preventDefault();
      return;
    }

    if (state.tool === 'text' && drawCanvas.classList.contains('interactive')) {
      const rect = area.getBoundingClientRect();
      const mc = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
      const text = prompt('Введите текст:');
      if (text) {
        drawText(mc.x, mc.y, text);
        logEvent('system', `Добавлен текст: "${text}"`);
      }
      return;
    }

    if (state.tool === 'measure' && drawCanvas.classList.contains('interactive')) {
      const rect = area.getBoundingClientRect();
      const mc = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
      if (!state.measureStart) {
        state.measureStart = mc;
        toast('Кликните в конечную точку для измерения');
      } else {
        finishMeasure(mc);
      }
      return;
    }

    if (tokenEl) {
      const id = parseInt(tokenEl.dataset.id);
      const token = state.tokens.find(t => t.id === id);
      if (!token) return;
      const role = window.dndOnlineGetRole?.();
      if (role === 'player' && !(token.kind === 'character' && String(token.ownerId) === String(window.DND_ONLINE?.meta?.player?.id))) {
        selectToken(id);
        toast('Игрок может перемещать только своего персонажа', 'error');
        return;
      }
      selectToken(id);
      const rect = area.getBoundingClientRect();
      const mc = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
      state.draggingToken = tokenEl;
      state.dragOffset.x = mc.x - token.x;
      state.dragOffset.y = mc.y - token.y;
      tokenEl.classList.add('dragging');
      e.stopPropagation();
      return;
    }

    if (state.tool === 'select') selectToken(null);

    if (state.tool === 'pan' || state.tool === 'select') {
      state.isPanning = true;
      state.panStart.x = e.clientX;
      state.panStart.y = e.clientY;
      state.panStart.viewX = state.view.panX;
      state.panStart.viewY = state.view.panY;
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (state.isPanning) {
      const dx = e.clientX - state.panStart.x;
      const dy = e.clientY - state.panStart.y;
      state.view.panX = state.panStart.viewX + dx;
      state.view.panY = state.panStart.viewY + dy;
      updateMapTransform();
    } else if (state.draggingToken) {
      const area = document.getElementById('map-area');
      const rect = area.getBoundingClientRect();
      const mc = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
      const id = parseInt(state.draggingToken.dataset.id);
      const token = state.tokens.find(t => t.id === id);
      if (token) {
        token.x = mc.x - state.dragOffset.x;
        token.y = mc.y - state.dragOffset.y;
        state.draggingToken.style.left = (token.x - token.size / 2) + 'px';
        state.draggingToken.style.top = (token.y - token.size / 2) + 'px';
      }
    } else if (state.shapeStart) {
      const area = document.getElementById('map-area');
      const rect = area.getBoundingClientRect();
      const mc = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
      state.shapePreview = makeShapeFromPoints(state.shapeStart, mc, true);
      renderShapes();
    } else if (state.isDrawing) {
      const area = document.getElementById('map-area');
      const rect = area.getBoundingClientRect();
      const mc = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
      drawLine(state.lastDrawPos.x, state.lastDrawPos.y, mc.x, mc.y);
      state.lastDrawPos = mc;
    }
  });

  window.addEventListener('mouseup', () => {
    if (state.isPanning) state.isPanning = false;
    if (state.draggingToken) {
      state.draggingToken.classList.remove('dragging');
      state.draggingToken = null;
      window.dndOnlineSync?.('token_move');
    }
    if (state.shapeStart) {
      if (state.shapePreview) {
        state.shapes.push({ ...state.shapePreview, id: state.nextId++ });
        logEvent('map', `Фигура добавлена: ${shapeTypeLabel(state.shapeSettings.type)} (${state.shapeSettings.layer === 'front' ? 'передний слой' : 'задний слой'})`);
      }
      state.shapeStart = null;
      state.shapePreview = null;
      renderShapes();
    }
    if (!state.shapeStart && !state.shapePreview) window.dndOnlineSync?.('shape_change');
    if (state.isDrawing) {
      state.isDrawing = false;
      state.lastDrawPos = null;
      window.dndOnlineSync?.('drawing');
      window.dndOnlineCanvasSync?.('draw');
    }
  });

  area.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.15, Math.min(4, state.view.zoom * delta));
    const rect = area.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    state.view.panX = mx - (mx - state.view.panX) * (newZoom / state.view.zoom);
    state.view.panY = my - (my - state.view.panY) * (newZoom / state.view.zoom);
    state.view.zoom = newZoom;
    updateMapTransform();
    document.getElementById('zoom-display').textContent = Math.round(state.view.zoom * 100) + '%';
  }, { passive: false });

  // Контекстное меню: токен ИЛИ карта
  area.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const tokenEl = e.target.closest('.token');
    if (tokenEl) {
      const id = parseInt(tokenEl.dataset.id);
      openTokenContextMenu(e.clientX, e.clientY, id);
    } else {
      const rect = area.getBoundingClientRect();
      const mc = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
      openMapContextMenu(e.clientX, e.clientY, mc);
    }
  });
}

function screenToMap(sx, sy) {
  return { x: (sx - state.view.panX) / state.view.zoom, y: (sy - state.view.panY) / state.view.zoom };
}

function updateMapTransform() {
  const layer = document.getElementById('map-layer');
  if (!layer) return;
  if (state.map.width && state.map.height) {
    layer.style.width = state.map.width + 'px';
    layer.style.height = state.map.height + 'px';
  }
  layer.style.transformOrigin = '0 0';
  layer.style.transform = `translate(${state.view.panX}px, ${state.view.panY}px) scale(${state.view.zoom})`;
}

function zoomIn() {
  const area = document.getElementById('map-area');
  const rect = area.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  const newZoom = Math.min(4, state.view.zoom * 1.2);
  state.view.panX = cx - (cx - state.view.panX) * (newZoom / state.view.zoom);
  state.view.panY = cy - (cy - state.view.panY) * (newZoom / state.view.zoom);
  state.view.zoom = newZoom;
  updateMapTransform();
  document.getElementById('zoom-display').textContent = Math.round(state.view.zoom * 100) + '%';
}

function zoomOut() {
  const area = document.getElementById('map-area');
  const rect = area.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  const newZoom = Math.max(0.15, state.view.zoom / 1.2);
  state.view.panX = cx - (cx - state.view.panX) * (newZoom / state.view.zoom);
  state.view.panY = cy - (cy - state.view.panY) * (newZoom / state.view.zoom);
  state.view.zoom = newZoom;
  updateMapTransform();
  document.getElementById('zoom-display').textContent = Math.round(state.view.zoom * 100) + '%';
}

function resetView() {
  state.view.zoom = 1;
  state.view.panX = 0;
  state.view.panY = 0;
  updateMapTransform();
  document.getElementById('zoom-display').textContent = '100%';
}

function fitMap() {
  if (!state.map.width) return;
  const area = document.getElementById('map-area');
  const rect = area.getBoundingClientRect();
  const padding = 40;
  const scaleX = (rect.width - padding * 2) / state.map.width;
  const scaleY = (rect.height - padding * 2) / state.map.height;
  state.view.zoom = Math.min(scaleX, scaleY, 2);
  state.view.panX = (rect.width - state.map.width * state.view.zoom) / 2;
  state.view.panY = (rect.height - state.map.height * state.view.zoom) / 2;
  updateMapTransform();
  document.getElementById('zoom-display').textContent = Math.round(state.view.zoom * 100) + '%';
}

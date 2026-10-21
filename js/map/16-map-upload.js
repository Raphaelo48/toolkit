// ============ MAP UPLOAD ============
function uploadMap() {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Загружать карту может только мастер', 'error'); return; }
  document.getElementById('map-input').click();
}

// Большие карты уменьшаем: их получает каждый игрок, а холсты рисунка и тумана
// создаются того же размера, что и карта.
const MAP_MAX_SIDE = 4096;
const MAP_MAX_BYTES = 3 * 1024 * 1024;

function prepareMapImage(dataUrl, fileSize) {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => {
      const w = probe.naturalWidth, h = probe.naturalHeight;
      const scale = Math.min(1, MAP_MAX_SIDE / Math.max(w, h));
      if (scale === 1 && fileSize <= MAP_MAX_BYTES) { resolve(dataUrl); return; }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(probe, 0, 0, canvas.width, canvas.height);
      try { resolve(canvas.toDataURL('image/jpeg', 0.88)); } catch (err) { resolve(dataUrl); }
    };
    probe.onerror = () => resolve(dataUrl);
    probe.src = dataUrl;
  });
}

function handleMapUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const src = await prepareMapImage(ev.target.result, file.size);
    const img = document.getElementById('map-image');
    img.onload = () => {
      state.map.src = src;
      state.map.width = img.naturalWidth;
      state.map.height = img.naturalHeight;
      img.style.display = 'block';
      ['grid-canvas', 'draw-canvas', 'fog-canvas', 'shapes-back-canvas', 'shapes-canvas'].forEach(id => {
        const c = document.getElementById(id);
        c.width = state.map.width;
        c.height = state.map.height;
      });
      document.getElementById('map-empty').style.display = 'none';
      drawGrid();
      fitMap();
      logEvent('system', `Карта загружена: ${file.name} (${state.map.width}×${state.map.height})`);
      toast('Карта загружена');
      window.visionResetForNewMap?.();
      window.dndOnlineSync?.('map_upload');
      // Новая карта очищает рисунки и туман — сообщаем об этом игрокам
      window.dndOnlineCanvasSync?.('draw');
      window.dndOnlineCanvasSync?.('fog');
    };
    img.src = src;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

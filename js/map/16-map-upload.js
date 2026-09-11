// ============ MAP UPLOAD ============
function uploadMap() {
  if (window.dndOnlineCan && !window.dndOnlineCan('master')) { toast('Загружать карту может только мастер', 'error'); return; }
  document.getElementById('map-input').click();
}

function handleMapUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = document.getElementById('map-image');
    img.onload = () => {
      state.map.src = ev.target.result;
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
      window.dndOnlineSync?.('map_upload');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

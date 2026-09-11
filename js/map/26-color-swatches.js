// ============ COLOR SWATCHES ============
function renderColorSwatches(containerId, key) {
  const container = document.getElementById(containerId);
  container.innerHTML = COLORS.map(c => `
    <div class="color-swatch ${state.modalColors[key] === c ? 'selected' : ''}"
         style="background:${c}"
         onclick="selectColor('${key}', '${c}', '${containerId}')"></div>
  `).join('');
}

function selectColor(key, color, containerId) {
  state.modalColors[key] = color;
  updateColorSelection(containerId, key);
}

function updateColorSelection(containerId, key) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.color-swatch').forEach(sw => {
    sw.classList.toggle('selected', rgbToHex(sw.style.background) === state.modalColors[key].toLowerCase());
  });
}

function rgbToHex(rgb) {
  if (rgb.startsWith('#')) return rgb.toLowerCase();
  const m = rgb.match(/\d+/g);
  if (!m) return rgb;
  return '#' + m.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
}

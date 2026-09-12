// ============ IMAGE UPLOAD ============
function handleImageUpload(e, key) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    state.modalImages[key] = ev.target.result;
    const previewId = key === 'token' ? 'token-img-preview' : key === 'char' ? 'char-img-preview' : 'mon-img-preview';
    document.getElementById(previewId).innerHTML = `<img src="${ev.target.result}" alt="">`;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function resetImagePreview(id) {
  document.getElementById(id).innerHTML = `<svg style="width:22px;height:22px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
}

// Persisted photos use authenticated same-origin media URLs; new drafts are
// compressed locally and uploaded by the customer save flow, never in its JSON.
(() => {
  let draft = null, original = null, revision = 0, busy = false;
  const el = id => document.getElementById(id);
  const mediaUrl = value => typeof value === 'string' && /^\/api\/media\/[a-f\d]{24}$/i.test(value) ? value : null;
  const dataUrl = value => typeof value === 'string' && value.length <= 600000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
  function source(value) {
    if (typeof value === 'string') return mediaUrl(value);
    if (!value || typeof value !== 'object') return null;
    if (Object.hasOwn(value, 'landmark_photo') || Object.hasOwn(value, 'landmarkPhoto')) return source(value.landmark_photo ?? value.landmarkPhoto);
    if (mediaUrl(value.url)) return value.url;
    const id = value.id ?? value._id;
    return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id) ? `/api/media/${id}` : null;
  }
  function status(message) { if (el('landmark-upload-status')) el('landmark-upload-status').textContent = message; }
  function preview() {
    const image = el('landmark-preview');
    if (!image) return;
    image.hidden = !draft;
    if (draft) image.src = draft; else image.removeAttribute('src');
    if (el('remove-landmark')) el('remove-landmark').hidden = !draft;
  }
  window.Landmarks = {
    begin(customer) {
      revision++; busy = false;
      original = draft = source(customer);
      if (el('landmark-file')) el('landmark-file').value = '';
      status(draft ? 'Saved photo. Choose another image to replace it.' : 'Add a photo of the gate, building or nearby landmark.');
      preview();
    },
    value() {
      if (busy) throw Error('Wait for the landmark photo to finish processing.');
      return draft;
    },
    changed() { return draft !== original; },
    view(value) {
      const src = source(value) || (dataUrl(value) ? value : null);
      if (!src) {
        if (typeof window.showDemoNotice === 'function') window.showDemoNotice('No landmark photo has been saved yet.');
        return;
      }
      el('landmark-full').src = src;
      el('landmark-viewer').showModal();
    }
  };
  if (!el('landmark-file')) return;
  el('landmark-preview').onerror = () => status('Photo could not be loaded. Check your session and connection; the saved photo has not been removed.');
  el('landmark-file').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    const version = ++revision;
    busy = true;
    let bitmap;
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) throw Error('Choose a JPG, PNG or WebP image up to 12 MB.');
      bitmap = await createImageBitmap(file);
      if (version !== revision) return;
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16000000) throw Error('Choose an image with at most 16 million pixels.');
      const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw Error('Photo processing is unavailable in this browser.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL('image/jpeg', .75);
      if (!dataUrl(result)) throw Error('Photo is too detailed. Choose a smaller image.');
      draft = result; preview();
      status('Photo ready. Save customer & location to upload it.');
    } catch (error) {
      if (version === revision) status(error.message);
    } finally {
      bitmap?.close();
      if (version === revision) busy = false;
    }
  };
  el('remove-landmark').onclick = () => {
    revision++; busy = false; draft = null; preview();
    el('landmark-file').value = '';
    status('Photo removed from this draft. Save to apply.');
  };
  el('landmark-view-close').onclick = () => {
    el('landmark-viewer').close();
    el('landmark-full').removeAttribute('src');
  };
})();

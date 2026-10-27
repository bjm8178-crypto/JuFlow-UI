// Juki Rider App - Jobs
// The rider sees the customer's address and sets only two things: On the way, then Delivered.

(function() {
  'use strict';

  const { state, api, outbox, location, router } = window.JuFlowRider;

  let activeJobs = [];

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const peso = (c) => (Number.isFinite(c) ? '₱' + (c / 100).toFixed(2) : 'N/A');
  const LABEL = { preparing: 'Preparing', on_the_way: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' };
  const COLOR = { preparing: 'info', on_the_way: 'warning', delivered: 'success', cancelled: 'muted' };

  async function loadJobs() {
    const key = `juflow:rider:jobs:${state.user && (state.user._id || state.user.id)}`;
    try {
      const rows = await api.get('/orders?filter=active');
      activeJobs = Array.isArray(rows) ? rows : [];
      try { localStorage.setItem(key, JSON.stringify(activeJobs)); } catch (_) { /* storage may be denied */ }
      return activeJobs;
    } catch (err) {
      if (err.offline || err.network) {
        try {
          const cached = localStorage.getItem(key);
          if (cached) { activeJobs = JSON.parse(cached); return activeJobs; }
        } catch (_) { /* ignore */ }
      }
      throw err;
    }
  }

  function openLandmarkViewer(c) {
    const dlg = document.getElementById('rider-landmark-dialog');
    const img = document.getElementById('rider-landmark-img');
    const caption = document.getElementById('rider-landmark-caption');
    if (!dlg || !img) {
      if (c?.landmark_photo) window.open(c.landmark_photo, '_blank');
      return;
    }
    img.src = c.landmark_photo || '';
    if (caption) {
      const parts = [c.address, c.landmark ? `Landmark: ${c.landmark}` : null].filter(Boolean);
      caption.textContent = parts.join(' • ') || 'No landmark description provided.';
    }
    dlg.showModal();
  }

  function customerHtml(c) {
    c = c || {};
    const hasPin = Number.isFinite(c.lat) && Number.isFinite(c.lng);
    const hasLandmark = Boolean(c.landmark && c.landmark.trim());
    const hasPhoto = Boolean(c.landmark_photo);
    const isCompleted = Boolean(c.address && hasPin && hasLandmark);
    return `
      <strong>${esc(c.name || 'Customer')}</strong>
      ${c.phone ? `<br><a href="tel:${esc(c.phone)}" class="tel-link">${esc(c.phone)}</a>` : ''}
      ${c.address ? `<br><small>📍 ${esc(c.address)}</small>` : ''}
      ${c.landmark ? `<br><small style="color:var(--text-muted);">Landmark: ${esc(c.landmark)}</small>` : ''}
      <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
        ${isCompleted
          ? '<span class="badge badge-success" style="font-size:11px;padding:3px 8px;">✓ Address Completed &amp; Pinned</span>'
          : hasPin
            ? '<span class="badge badge-info" style="font-size:11px;padding:3px 8px;">📍 Pinned (No landmark)</span>'
            : '<span class="badge badge-warning" style="font-size:11px;padding:3px 8px;white-space:normal;line-height:1.3;display:inline-block;">⚠️ Wala pang pin location - coordinate kay cashier/admin</span>'
        }
        ${hasPhoto
          ? '<span class="badge badge-info" style="font-size:11px;padding:3px 8px;">📷 Has photo</span>'
          : '<span class="badge" style="font-size:11px;padding:3px 8px;opacity:0.65;background:#ecefe9;">📷 No photo</span>'
        }
      </div>`;
  }

  function paymentHtml(job) {
    const total = peso(job.total_centavos);
    if (job.payment_method === 'gcash') return `<strong>Paid via GCash</strong> (${total})`;
    return `<strong>Collect: ${total}</strong> (cash)`;
  }

  function nextAction(status) {
    return { preparing: { to: 'on_the_way', label: 'Start delivery (On the way)' }, on_the_way: { to: 'delivered', label: 'Mark as delivered' } }[status] || null;
  }

  function renderJobCard(job) {
    const card = document.createElement('div');
    card.className = 'job-card';
    card.dataset.jobId = job._id;
    card.innerHTML = `
      <div class="job-header"><strong>Order #${esc(job.order_number || 'N/A')}</strong>
        <span class="badge badge-${COLOR[job.status] || 'default'}">${esc(LABEL[job.status] || job.status)}</span></div>
      <div class="job-customer">${customerHtml(job.customer)}</div>
      <div class="job-payment">${paymentHtml(job)}</div>`;
    const btn = document.createElement('button');
    btn.className = 'app-btn primary full';
    btn.textContent = 'View details';
    btn.onclick = () => showJobDetail(job);
    card.appendChild(btn);
    return card;
  }

  function showJobDetail(job) {
    const main = document.getElementById('app-main');
    main.innerHTML = '';
    document.getElementById('header-title').textContent = `Order #${job.order_number || 'N/A'}`;

    const back = document.createElement('button');
    back.className = 'link-btn';
    back.textContent = '← Back to jobs';
    back.onclick = () => renderJobs();
    main.appendChild(back);

    const add = (html, cls = 'app-card') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; main.appendChild(d); return d; };

    add(`<h3>Status</h3><p class="status-display">${esc(LABEL[job.status] || job.status)}</p>`);
    add(`<h3>Customer</h3><p>${customerHtml(job.customer)}</p>`);
    if (job.notes) add(`<h3>Notes</h3><p>${esc(job.notes)}</p>`);
    if (Array.isArray(job.items) && job.items.length) {
      add(`<h3>Items</h3><ul style="list-style:none;padding:0;margin:8px 0 0;">${job.items.map((i) => `<li style="padding:4px 0;">${esc(i.quantity)}× ${esc(i.name)}</li>`).join('')}</ul>`);
    }
    add(`<h3>Payment</h3><p>${paymentHtml(job)}</p>`);

    // Navigation to the customer's address
    const c = job.customer || {};
    const nav = add('<h3>Navigation</h3>');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:12px;';
    const hasPin = Number.isFinite(c.lat) && Number.isFinite(c.lng);
    const dest = hasPin ? `${c.lat},${c.lng}` : c.address || '';
    const link = (label, href) => {
      const a = document.createElement('a');
      a.className = 'app-btn secondary';
      a.textContent = label;
      a.target = '_blank';
      a.rel = 'noopener';
      if (dest) a.href = href; else { a.classList.add('disabled'); a.onclick = (e) => { e.preventDefault(); alert('No address available'); }; }
      row.appendChild(a);
    };
    link('📍 Google Maps', `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`);
    link('🚗 Waze', hasPin ? `https://waze.com/ul?ll=${encodeURIComponent(dest)}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(dest)}&navigate=yes`);
    nav.appendChild(row);

    // Landmark & Photo section
    const landmarkCard = add('<h3>Landmark & Photo</h3>');
    if (c.landmark) {
      const p = document.createElement('p');
      p.style.cssText = 'margin:6px 0 10px;font-size:14px;';
      p.innerHTML = `<strong>Landmark:</strong> ${esc(c.landmark)}`;
      landmarkCard.appendChild(p);
    } else {
      const p = document.createElement('p');
      p.style.cssText = 'margin:6px 0 10px;font-size:13px;color:var(--text-muted);';
      p.textContent = 'No landmark description saved.';
      landmarkCard.appendChild(p);
    }
    const photoRow = document.createElement('div');
    photoRow.style.cssText = 'margin-top:10px;';
    if (c.landmark_photo) {
      const photoBtn = document.createElement('button');
      photoBtn.type = 'button';
      photoBtn.className = 'app-btn secondary full';
      photoBtn.innerHTML = '📷 View landmark photo';
      photoBtn.onclick = () => openLandmarkViewer(c);
      photoRow.appendChild(photoBtn);
    } else {
      const noPhotoBtn = document.createElement('button');
      noPhotoBtn.type = 'button';
      noPhotoBtn.className = 'app-btn secondary full';
      noPhotoBtn.disabled = true;
      noPhotoBtn.style.cssText = 'opacity:0.55;cursor:not-allowed;';
      noPhotoBtn.innerHTML = '📷 No landmark photo available';
      photoRow.appendChild(noPhotoBtn);
    }
    landmarkCard.appendChild(photoRow);

    const loc = add(`<h3>Location sharing</h3>
      <p style="color:var(--text-muted);font-size:14px;margin:8px 0;">Share your location while delivering so the admin can follow along.</p>
      <button class="app-btn ${state.locationSharing ? 'success' : 'secondary'}" id="location-toggle">${state.locationSharing ? '✓ Sharing location' : 'Start sharing'}</button>`);
    loc.querySelector('#location-toggle').onclick = () => {
      if (state.locationSharing) location.stopSharing(); else location.startSharing();
      showJobDetail(job);
    };

    if (window.JuFlowPin && job.status !== 'cancelled') main.appendChild(window.JuFlowPin.card(job));

    if (job.status === 'on_the_way') main.appendChild(proofCard(job));

    const next = nextAction(job.status);
    const actionCard = add('');
    if (next) {
      const b = document.createElement('button');
      b.className = 'app-btn primary full large';
      b.textContent = next.label;
      b.onclick = () => performAction(job, next.to, b);
      actionCard.appendChild(b);
    }
  }

  // ---- Proof of delivery (photo) -------------------------------------------------------------
  const proofCounts = {};
  const MAX_DATA_URL = 560000; // the server accepts at most 600000 characters

  // Shrinks any phone photo to a small JPEG (max 1000px) so it uploads fast on mobile data.
  function photoToJpegDataUrl(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          let quality = 0.78;
          let out = canvas.toDataURL('image/jpeg', quality);
          while (out.length > MAX_DATA_URL && quality > 0.35) { quality -= 0.1; out = canvas.toDataURL('image/jpeg', quality); }
          URL.revokeObjectURL(url);
          if (out.length > MAX_DATA_URL) reject(new Error('Photo is too large. Please take it again.'));
          else resolve(out);
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cannot read this photo. Please use a JPG or PNG picture.')); };
      img.src = url;
    });
  }

  function proofCard(job) {
    const card = document.createElement('div');
    card.className = 'app-card';
    card.innerHTML = `<h3>Proof of delivery</h3>
      <p style="color:var(--text-muted);font-size:14px;margin:8px 0;">Take a photo of the delivered order, or choose one from your files.</p>
      <div id="proof-sent" style="display:flex;flex-wrap:wrap;gap:8px;margin:8px 0;"></div>
      <div id="proof-preview" style="display:none;margin:8px 0;"><img alt="Selected proof photo" style="max-width:100%;max-height:260px;border-radius:8px;display:block;"></div>
      <div id="proof-pick" style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="app-btn secondary" id="proof-camera-btn" style="flex:1;">📷 Take photo</button>
        <button type="button" class="app-btn secondary" id="proof-file-btn" style="flex:1;">🖼️ Choose from files</button>
      </div>
      <button type="button" class="app-btn primary full" id="proof-send-btn" style="display:none;margin-top:8px;">Send proof</button>
      <p id="proof-msg" role="status" style="font-size:13px;margin:8px 0 0;"></p>
      <input type="file" id="proof-camera" accept="image/*" capture="environment" hidden>
      <input type="file" id="proof-file" accept="image/*" hidden>`;

    const $ = (sel) => card.querySelector(sel);
    const msg = (text, bad) => { const m = $('#proof-msg'); m.textContent = text || ''; m.style.color = bad ? 'var(--danger,#b42318)' : 'var(--text-muted,#555)'; };
    let pending = null; // data URL waiting to be sent

    async function refreshSent() {
      try {
        const list = await api.get(`/orders/${job._id}/proof`);
        proofCounts[job._id] = Array.isArray(list) ? list.length : 0;
        const box = $('#proof-sent');
        box.innerHTML = '';
        (list || []).forEach((p) => {
          const a = document.createElement('a');
          a.href = p.url; a.target = '_blank'; a.rel = 'noopener';
          a.innerHTML = `<img src="${esc(p.url)}" alt="Sent proof" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:2px solid #39735b;">`;
          box.appendChild(a);
        });
        if (list && list.length) msg(`✓ ${list.length} proof photo${list.length > 1 ? 's' : ''} sent`);
      } catch (_) { /* offline: the list is optional */ }
    }

    async function onPicked(input) {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      msg('Preparing photo…');
      try {
        pending = await photoToJpegDataUrl(file);
        const prev = $('#proof-preview');
        prev.querySelector('img').src = pending;
        prev.style.display = 'block';
        $('#proof-send-btn').style.display = 'block';
        $('#proof-send-btn').disabled = false;
        msg('Check the photo, then tap Send proof.');
      } catch (err) {
        pending = null;
        msg(err.message || 'Cannot use this photo.', true);
      }
    }

    $('#proof-camera-btn').onclick = () => $('#proof-camera').click();
    $('#proof-file-btn').onclick = () => $('#proof-file').click();
    $('#proof-camera').onchange = (e) => onPicked(e.target);
    $('#proof-file').onchange = (e) => onPicked(e.target);

    $('#proof-send-btn').onclick = async () => {
      if (!pending) return;
      const btn = $('#proof-send-btn');
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        await api.post(`/orders/${job._id}/proof`, { image: pending });
        pending = null;
        $('#proof-preview').style.display = 'none';
        btn.style.display = 'none';
        if (navigator.vibrate) navigator.vibrate(50);
        await refreshSent();
      } catch (err) {
        msg(err.offline || err.network || !navigator.onLine
          ? 'No internet. Your photo is still here, tap Send proof again when you are online.'
          : `Could not send the photo: ${err.message || 'please try again'}`, true);
      } finally {
        btn.disabled = false; btn.textContent = 'Send proof';
      }
    };

    refreshSent();
    return card;
  }

  async function performAction(job, to, btn) {
    if (to === 'delivered') {
      const noProof = !proofCounts[job._id];
      const ask = noProof
        ? `No proof photo sent yet for order #${job.order_number}.\n\nMark as delivered anyway?`
        : `Mark order #${job.order_number} as delivered?`;
      if (!confirm(ask)) return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Updating...'; }
    try {
      await api.post(`/orders/${job._id}/status`, { status: to });
      if (navigator.vibrate) navigator.vibrate(50);
      await renderJobs();
    } catch (err) {
      if (err.offline || err.network || err.status >= 500) {
        await outbox.add({ order_id: job._id, status: to });
        alert('⚠️ Offline\n\nUpdate saved and will be sent when you are back online.');
        await renderJobs();
      } else {
        alert(`Failed to update: ${err.message || 'Please try again'}`);
        if (btn) { btn.disabled = false; btn.textContent = nextAction(job.status)?.label || 'Try again'; }
      }
    }
  }

  async function renderJobs() {
    const main = document.getElementById('app-main');
    main.innerHTML = '';
    main.className = 'app-main';
    document.getElementById('header-title').textContent = 'Deliveries';
    document.getElementById('header-subtitle').textContent = state.user?.full_name || state.user?.username || 'Rider';
    main.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading deliveries...</p></div>';

    try {
      await loadJobs();
      main.innerHTML = '';
      if (!activeJobs.length) {
        main.innerHTML = '<div class="empty-state"><p>No active deliveries</p><p style="color:var(--text-muted);margin-top:8px;">New orders will appear here.</p></div>';
      } else {
        const list = document.createElement('div');
        list.className = 'job-list';
        activeJobs.forEach((job) => list.appendChild(renderJobCard(job)));
        main.appendChild(list);
      }
    } catch (err) {
      main.innerHTML = `<div class="error-state"><p>Failed to load deliveries</p>
        <p style="color:var(--text-muted);font-size:14px;">${esc(err.message || 'Please try again')}</p>
        <button class="app-btn" onclick="window.JuFlowRider.router.navigate('#/jobs')">Retry</button></div>`;
    }
  }

  router.register('/jobs', renderJobs);
})();

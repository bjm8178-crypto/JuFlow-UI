// JuFlow Rider App - Jobs
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

  function customerHtml(c) {
    c = c || {};
    return `
      <strong>${esc(c.name || 'Customer')}</strong>
      ${c.phone ? `<br><a href="tel:${esc(c.phone)}" class="tel-link">${esc(c.phone)}</a>` : ''}
      ${c.address ? `<br><small>📍 ${esc(c.address)}</small>` : ''}
      ${c.landmark ? `<br><small style="color:var(--text-muted);">Landmark: ${esc(c.landmark)}</small>` : ''}`;
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

    const loc = add(`<h3>Location sharing</h3>
      <p style="color:var(--text-muted);font-size:14px;margin:8px 0;">Share your location while delivering so the admin can follow along.</p>
      <button class="app-btn ${state.locationSharing ? 'success' : 'secondary'}" id="location-toggle">${state.locationSharing ? '✓ Sharing location' : 'Start sharing'}</button>`);
    loc.querySelector('#location-toggle').onclick = () => {
      if (state.locationSharing) location.stopSharing(); else location.startSharing();
      showJobDetail(job);
    };

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

  async function performAction(job, to, btn) {
    if (to === 'delivered' && !confirm(`Mark order #${job.order_number} as delivered?`)) return;
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

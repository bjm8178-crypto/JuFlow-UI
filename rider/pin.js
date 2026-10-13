// Juki Rider App - Customer pin file
// First delivery to a new customer: stand at the door, capture the GPS position, and save a small
// file. The admin uploads that file on the Customers page to save the pin on the customer.

(function () {
  'use strict';

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const round6 = (n) => Math.round(n * 1e6) / 1e6;
  const GOOD_ACCURACY_M = 30;

  function fileFor(job, fix) {
    const c = job.customer || {};
    const payload = {
      app: 'juflow',
      type: 'customer-pin',
      version: 1,
      captured_at: new Date(fix.time).toISOString(),
      order_number: job.order_number || null,
      customer: {
        id: job.customer_id ? String(job.customer_id) : null,
        name: c.name || null,
        phone: c.phone || null,
        address: c.address || null
      },
      lat: round6(fix.lat),
      lng: round6(fix.lng),
      accuracy_m: Math.round(fix.accuracy)
    };
    const safe = String(job.order_number || 'order').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'order';
    return new File([JSON.stringify(payload, null, 2)], `juflow-pin-${safe}.json`, { type: 'application/json' });
  }

  function download(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function card(job) {
    const c = job.customer || {};
    const hadPin = Number.isFinite(c.lat) && Number.isFinite(c.lng);
    let fix = null;
    let busy = false;

    const el = document.createElement('div');
    el.className = 'app-card pin-card';
    el.innerHTML = `
      <h3>Pin this customer’s door</h3>
      <p class="muted small">${hadPin
        ? 'This customer already has a saved pin. Capture a new one only if it was wrong.'
        : 'No pin saved yet. Stand at the customer’s door, capture your location, then save the file for the admin.'}</p>
      <div class="pin-readout" role="status" aria-live="polite">No location captured yet.</div>
      <div class="pin-actions">
        <button type="button" class="app-btn secondary full" data-capture>Capture my location</button>
        <button type="button" class="app-btn primary full" data-save disabled>Save pin file</button>
        <button type="button" class="app-btn secondary full" data-share hidden>Send file…</button>
      </div>`;

    const readout = el.querySelector('.pin-readout');
    const capture = el.querySelector('[data-capture]');
    const save = el.querySelector('[data-save]');
    const share = el.querySelector('[data-share]');

    function show(html, tone) {
      readout.className = 'pin-readout' + (tone ? ' ' + tone : '');
      readout.innerHTML = html;
    }

    capture.onclick = () => {
      if (busy) return;
      if (!navigator.geolocation) { show('This phone does not support location.', 'bad'); return; }
      busy = true;
      capture.disabled = true;
      save.disabled = true;
      share.hidden = true;
      show('Getting your location… keep the phone still, in the open.');
      navigator.geolocation.getCurrentPosition((pos) => {
        busy = false;
        capture.disabled = false;
        capture.textContent = 'Capture again';
        fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, time: pos.timestamp || Date.now() };
        const good = fix.accuracy <= GOOD_ACCURACY_M;
        show(`<strong>${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)}</strong><br>Accuracy about ${Math.round(fix.accuracy)} m. ` +
          (good ? 'Good enough to save.' : 'Weak signal. Move to open sky and capture again for a better pin.'), good ? 'good' : 'warn');
        save.disabled = false;
      }, (err) => {
        busy = false;
        capture.disabled = false;
        const why = err && err.code === 1 ? 'Location is blocked. Allow location for this app in your phone settings.'
          : err && err.code === 3 ? 'Took too long to find you. Move to open sky and try again.'
          : 'Could not get your location. Try again.';
        show(esc(why), 'bad');
      }, { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
    };

    save.onclick = () => {
      if (!fix) return;
      const file = fileFor(job, fix);
      download(file);
      show(`Saved <strong>${esc(file.name)}</strong> to this phone. Send it to the admin.`, 'good');
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        share.hidden = false;
        share.onclick = async () => {
          try { await navigator.share({ files: [file], title: 'Customer pin', text: `Pin for ${c.name || 'customer'}` }); }
          catch (e) { /* cancelled */ }
        };
      }
    };

    return el;
  }

  window.JuFlowPin = { card };
})();

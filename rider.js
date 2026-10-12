(async function () {
  'use strict';
  const user = await window.JUFLOW_AUTH_READY.catch(() => null);
  if (!user) return;
  const O = JuOutbox, status = document.getElementById('status');
  if (user.role_name !== 'rider') { status.textContent = 'This workspace is for assigned riders only.'; return; }
  const owner = user.id || user._id;
  if (!owner) { status.textContent = 'Account identity unavailable.'; return; }
  const cacheKey = 'juflow:rider:jobs:' + owner, outbox = O.create(localStorage, 'juflow:rider:outbox:' + owner);
  let jobs = [], shop = null, stale = true, sending = false, watch = null, latest = null, lastLocationSent = 0;
  const tracking = document.getElementById('tracking'), locationStatus = document.getElementById('location-status');
  function element(tag, text) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
  function pendingFor(job) { return outbox.list().some(item => item.endpoint === '/deliveries/' + encodeURIComponent(O.id(job)) + '/events'); }
  function render() {
    const list = document.getElementById('jobs'); list.replaceChildren();
    for (const job of jobs) {
      const order = job.order || {}, customer = order.customer || {}, node = element('article'); node.className = 'job-card';
      node.append(element('h2', 'Order ' + (order.order_number || O.id(job))), element('p', (stale ? 'STALE cached job | ' : '') + job.status), element('p', customer.name || customer.full_name || ''), element('p', customer.address || ''), element('p', customer.landmark || ''), element('p', customer.phone || ''));
      for (const item of order.items || []) node.append(element('p', String(item.quantity) + ' x ' + item.name));
      const photo = customer.landmark_photo;
      if (typeof photo === 'string' && /^\/api\/media\/[a-f0-9]{24}$/i.test(photo)) { const img = element('img'); img.src = photo; img.alt = 'Customer landmark'; img.loading = 'lazy'; img.onerror = () => { img.remove(); node.append(element('p', 'Landmark photo unavailable.')); }; node.append(img); }
      const destination = JuMapConfig.coordinates(customer.lat, customer.lng);
      const directions = JuMapConfig.googleDirections(shop, destination);
      if (directions) { const link = element('a', 'Google directions from shop'); link.href = directions; link.target = '_blank'; link.rel = 'noopener noreferrer'; node.append(link); }
      else node.append(element('p', 'Directions unavailable: configured shop origin and customer coordinates are required.'));
      const next = O.nextEvent[job.status];
      if (next) { const button = element('button', next.replaceAll('_', ' ')); button.disabled = sending || pendingFor(job); button.onclick = () => enqueueEvent(job); node.append(button); }
      if (job.status === 'awaiting_cashier_confirmation') node.append(element('p', 'Reported delivered. Waiting for cashier payment verification; not yet completed.'));
      list.append(node);
    }
    if (!jobs.length) list.append(element('p', stale ? 'No cached jobs available.' : 'No assigned active deliveries.'));
    const pending = document.getElementById('pending'); pending.replaceChildren();
    for (const item of outbox.list()) {
      const node = element('article'); node.className = 'job-card'; node.append(element('p', (item.payload.event || 'location') + ' | ' + item.state), element('p', item.error || 'Awaiting server acceptance.'));
      const discard = element('button', 'Discard saved submission'); discard.disabled = sending; discard.onclick = () => { if (window.confirm('Discard this unconfirmed submission? Refresh the job before recording a replacement.')) { outbox.discard(item.payload.event_id); render(); } }; node.append(discard); pending.append(node);
    }
    document.getElementById('retry').disabled = sending || !navigator.onLine;
  }
  async function send() {
    if (sending || !navigator.onLine) { render(); return; }
    sending = true; render();
    try { await outbox.flush((endpoint, payload) => JuAPI.request(endpoint, { method: 'POST', body: JSON.stringify(payload) })); status.textContent = 'Pending submissions accepted by server.'; await load(); }
    catch (error) { status.textContent = O.errorMessage(error); }
    finally { sending = false; render(); }
  }
  function enqueueEvent(job) {
    if (sending || pendingFor(job)) return;
    try { outbox.enqueue('/deliveries/' + encodeURIComponent(O.id(job)) + '/events', O.event(job)); status.textContent = 'Event saved locally, not yet confirmed by server.'; render(); if (navigator.onLine) send(); }
    catch (error) { status.textContent = error.message; }
  }
  async function load() {
    if (!navigator.onLine) throw Object.assign(new Error('Offline'), { status: 0 });
    const fresh = await JuAPI.request('/riders/me/deliveries');
    jobs = fresh; stale = false;
    try { localStorage.setItem(cacheKey, JSON.stringify({ saved_at: new Date().toISOString(), jobs })); } catch (_) { status.textContent = 'Live jobs loaded, but offline cache could not be saved.'; }
    try { shop = await JuMapConfig.loadShop(); } catch (_) { shop = null; }
    render(); status.textContent = 'Live assigned queue updated ' + new Date().toLocaleTimeString();
  }
  function stopTracking(message) {
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null; latest = null; tracking.checked = false; document.getElementById('send-location').disabled = true; locationStatus.textContent = message;
  }
  function sendLocation() {
    if (!latest || !tracking.checked || !navigator.onLine || document.hidden || sending) return;
    try { outbox.enqueue('/riders/me/location', { ...latest, event_id: O.uuid() }); lastLocationSent = Date.now(); locationStatus.textContent = 'Location saved for submission; not yet confirmed.'; send(); }
    catch (error) { locationStatus.textContent = error.message; }
  }
  tracking.onchange = () => {
    if (!tracking.checked) { stopTracking('Location sharing is off.'); return; }
    if (!navigator.onLine || document.hidden || !navigator.geolocation) { stopTracking('Location sharing requires an online visible page and geolocation support.'); return; }
    locationStatus.textContent = 'Requesting location permission...';
    watch = navigator.geolocation.watchPosition(position => {
      if (!tracking.checked || !navigator.onLine || document.hidden) return;
      latest = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, occurred_at: new Date(position.timestamp).toISOString() };
      document.getElementById('send-location').disabled = false; locationStatus.textContent = 'Location available; accuracy ' + Math.round(latest.accuracy) + ' metres.';
      if (Date.now() - lastLocationSent >= 15000 && !outbox.list().some(item => item.endpoint === '/riders/me/location')) sendLocation();
    }, error => stopTracking(error.code === 1 ? 'Location permission denied. Sharing is off.' : 'Location unavailable. Sharing is off.'), { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  };
  document.getElementById('send-location').onclick = sendLocation;
  window.addEventListener('offline', () => { stale = true; stopTracking('Offline. Location sharing stopped.'); status.textContent = 'Offline: cached jobs are stale. Events can be explicitly saved for later.'; render(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopTracking('Page hidden. Location sharing stopped; turn it on again to resume.'); });
  window.addEventListener('pagehide', () => stopTracking('Location sharing stopped.'));
  try { const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); if (Array.isArray(cached?.jobs)) jobs = cached.jobs; render(); } catch (error) { status.textContent = 'Local saved data unavailable: ' + error.message; }
  const poll = O.poll(load, error => { stale = true; status.textContent = O.errorMessage(error) + ' Cached jobs are stale.'; render(); });
  document.getElementById('refresh').onclick = poll; document.getElementById('retry').onclick = send;
  window.addEventListener('online', poll);
  document.getElementById('signout').onclick = () => { stopTracking('Location sharing stopped.'); window.juflowLogout().catch(() => {}); };
  poll();
})();

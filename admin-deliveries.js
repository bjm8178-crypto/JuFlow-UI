(async () => {
 const D = window.DeliveryState, el = id => document.getElementById(id);
 let map, layer, active = [], selected = null, points = [], shop = null, timer, busy = false, failures = 0, lastSuccess = null, mapError = '';
 const text = (tag, value, parent) => { const n = document.createElement(tag); n.textContent = String(value ?? ''); if (parent) parent.append(n); return n; };
 const customer = d => d.order?.customer_snapshot || d.order?.customer || {};
 const id = d => String(d.id || d._id);
 const riderName = d => d.rider?.full_name || d.rider?.name || 'Unassigned';
 const locationOf = d => d.latest_location || d.rider?.last_location || null;
 function details(key) {
  const d = active.find(d => id(d) === key); if (!d) return;
  selected = key; const c = customer(d), box = el('selected-delivery'); box.replaceChildren();
  text('h2', c.name || c.full_name || 'Customer name unavailable', box);
  text('p', D.label(d), box);
  const list = text('dl', '', box);
  for (const [label, value] of [['Order',d.order?.order_number || 'Unavailable'],['Address',c.address || 'Unavailable'],['Landmark',c.landmark || 'None supplied'],['Rider location',D.locationLabel(locationOf(d))]]) { text('dt',label,list); text('dd',value,list); }
  text('p','Shown on the map until the order is Delivered.',box);
  if (D.validPoint(c)) { const a = text('a','Open destination in Google Maps',box); a.className = 'secondary'; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.href = 'https://www.google.com/maps/search/?' + new URLSearchParams({api:'1',query:c.lat + ',' + c.lng}); }
  const photo = D.mediaURL(c.landmark_photo || c.landmark_photo_url);
  if (photo) { const b = text('button','View landmark photo',box); b.className = 'secondary'; b.onclick = () => { const image = el('delivery-landmark-image'); image.src = photo; image.onerror = () => { image.removeAttribute('src'); el('landmark-status').textContent = 'Landmark photo unavailable or access denied.'; }; el('landmark-status').textContent = ''; el('delivery-landmark-dialog').showModal(); }; }
 }
  const DEFAULT_VIEW = { center: [14.763649, 120.956218], zoom: 14 }; // Marilao, Bulacan; used when there are no pins to fit
  function fit() {
   if (!map) return;
   map.invalidateSize();
   if (points.length) map.fitBounds(points,{padding:[35,35],maxZoom:16});
   else map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
  }

 function render() {
  el('delivery-count').textContent = active.length + ' active deliveries';
  const list = el('delivery-list'); list.replaceChildren(); text('h2','Active destinations',list);
  if (!active.length) text('p',lastSuccess ? 'No active deliveries.' : 'Waiting for server deliveries.',list);
  points = []; let missing = 0;
  if (layer) layer.clearLayers();
  function marker(p, label, rider = false) { points.push([p.lat,p.lng]); if (!layer) return; const popup = text('span',label); const m = rider ? L.circleMarker([p.lat,p.lng],{radius:8,color:'#477da8'}) : L.marker([p.lat,p.lng],{title:label}); m.addTo(layer).bindPopup(popup); return m; }
  if (shop) marker(shop,'Confirmed shop location');
  for (const d of active) {
   const c = customer(d), key = id(d), b = text('button','',list); b.className = 'customer-choice';
   text('strong',c.name || c.full_name || 'Customer name unavailable',b); text('small',(d.order?.order_number || 'Order unavailable') + ' | ' + D.label(d),b); b.onclick = () => details(key);
   if (D.validPoint(c)) { const m = marker(c,(c.name || c.full_name || 'Customer') + ' | ' + D.label(d)); if (m) m.on('click',() => details(key)); } else missing++;
   const l = locationOf(d); if (D.validPoint(l)) marker(l,riderName(d) + ' | ' + D.locationLabel(l),true);
  }
  const requested = new URLSearchParams(window.location.search).get('order');
  const chosen = active.find(d => id(d) === selected || String(d.order_id) === requested);
  if (chosen) details(id(chosen)); else el('selected-delivery').replaceChildren();
  el('map-status').textContent = [mapError, !shop ? 'Shop coordinates not confirmed; shop pin hidden.' : '', missing ? missing + ' destinations have missing or invalid coordinates.' : '', 'Rider positions are reported, never simulated.'].filter(Boolean).join(' ');
 }
 function schedule() { clearTimeout(timer); if (!document.hidden) timer = setTimeout(refresh,Math.min(60000,10000 * 2 ** failures)); }
 async function refresh() {
  if (busy || document.hidden) return; busy = true; clearTimeout(timer);
  el('poll-status').textContent = 'Refreshing server deliveries...';
  try {
   const [deliveries, settings] = await Promise.all([JuAPI.request('/deliveries?filter=active'),JuAPI.request('/settings')]);
   if (!Array.isArray(deliveries) || !Array.isArray(settings)) throw new Error('Unexpected server response');
   active = deliveries.filter(d => d && D.active(d)); shop = D.shopPoint(settings); failures = 0; lastSuccess = Date.now(); render();
   el('poll-status').textContent = 'Updated ' + new Date(lastSuccess).toLocaleString() + '. Refreshes every 10 seconds while visible.';
  } catch (error) {
   failures = Math.min(failures + 1,3); render();
   el('poll-status').textContent = 'Refresh failed: ' + error.message + '. ' + (lastSuccess ? 'STALE data retained from ' + new Date(lastSuccess).toLocaleString() + '. ' : 'No server data available. ') + 'Retry in ' + Math.min(60,10 * 2 ** failures) + ' seconds.';
  } finally { busy = false; schedule(); }
 }
 el('fit-deliveries').onclick = fit; el('refresh-deliveries').onclick = refresh;
 window.addEventListener('focus',refresh);
 document.addEventListener('visibilitychange',() => { clearTimeout(timer); if (!document.hidden) refresh(); });
 try {
  const user = await window.JUFLOW_AUTH_READY; if (!user) return;
   if (window.L && window.location.protocol !== 'file:') {
    map = L.map('delivery-map').setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).addTo(map).on('tileerror',() => { mapError = 'Map imagery unavailable; delivery list remains available.'; render(); });
    layer = L.layerGroup().addTo(map);
    // The container can be measured before layout settles; re-measure so tiles fill it.
    setTimeout(() => map.invalidateSize(), 0);
    window.addEventListener('load', () => map.invalidateSize());
    window.addEventListener('resize', () => map.invalidateSize());
   }

  else mapError = 'Map library unavailable; delivery list remains available.';
  await refresh(); fit();
 } catch (error) { el('poll-status').textContent = 'Authentication unavailable: ' + error.message; }
})();

/* Customer and order API controller. Business records are never browser-stored. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const E = JuStore.escape;
  const money = JuStore.money;
  const state = { customers: [], orders: [], riders: [], selected: null, history: [], historyError: '', profileGeneration: 0 };
  const labels = { preparing: 'Preparing', pending: 'Preparing', on_the_way: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' };
  const statusLabel = order => labels[order.status] || order.status || 'Unknown state';
  const endpointId = id => encodeURIComponent(id);
  const hasPin = c => typeof c.lat === 'number' && typeof c.lng === 'number' && Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180;
  let orderAttempt = null;
  async function request(endpoint, options) {
    if (!window.JUFLOW_AUTH_READY) throw Error('Authentication is unavailable. Reload or sign in again.');
    const user = await window.JUFLOW_AUTH_READY;
    if (!user || !['admin', 'cashier'].includes(user.role_name)) throw Error('An administrator or cashier session is required.');
    return JuAPI.request(endpoint, options);
  }
  const send = (endpoint, method, body) => request(endpoint, { method, body: JSON.stringify(body) });
  function notice(message) { $('#workflow-status').textContent = message; }
  function report(form, error) { form.querySelector('.form-error').textContent = error.message || 'Request failed. Please retry.'; }
  async function submit(form, work) {
    if (form.dataset.busy === 'true') return;
    form.dataset.busy = 'true';
    const controls = [...form.querySelectorAll('button, input, select, textarea')];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    form.querySelector('.form-error').textContent = '';
    try { await work(); } catch (error) { report(form, error); }
    finally { controls.forEach((control, i) => { control.disabled = disabled[i]; }); delete form.dataset.busy; }
  }
  function payment(order) {
    const method = order.payment_method;
    return `${money(order.total_centavos)} total · ${method === 'gcash' ? 'GCash' : method === 'exact' ? 'Cash exact' : 'Cash'} · ${order.payment_status === 'paid' ? 'Paid' : 'Payment pending'}`;
  }
  function customerList() {
    const query = $('#customer-search').value.toLowerCase();
    $('#customer-list').innerHTML = state.customers.filter(c => [c.name, c.messenger, c.phone].join(' ').toLowerCase().includes(query)).map(c => `<button class="customer-choice ${state.selected === c._id ? 'selected' : ''}" data-customer="${E(c._id)}"><span class="avatar">${E(c.name.slice(0, 2).toUpperCase())}</span><span><strong>${E(c.name)}</strong><small>${E(c.phone)}</small></span></button>`).join('') || '<p class="empty">No matching customers.</p>';
  }
  function profile(loading = false) {
    const c = state.customers.find(c => c._id === state.selected);
    if (!c) { $('#customer-profile').innerHTML = '<div class="empty"><h2>A familiar face, a saved address.</h2><p>Select a customer or add a new one.</p></div>'; return; }
    const pin = hasPin(c);
    $('#customer-profile').innerHTML = `<div class="profile-heading"><div><span class="eyebrow">CUSTOMER PROFILE</span><h2>${E(c.name)}</h2><p>${E(c.messenger || 'No Messenger display name')}</p></div><button class="secondary" id="edit-customer">Edit details &amp; location</button></div><div class="profile-details"><div><small>CONTACT NUMBER</small><strong>${E(c.phone)}</strong></div><div><small>DELIVERY ADDRESS</small><strong>${E(c.address)}</strong></div><div><small>LANDMARK</small><strong>${E(c.landmark || 'No landmark added')}</strong></div><div><small>DESTINATION PIN</small><strong>${pin ? E(c.lat + ', ' + c.lng) : 'No pin saved'}</strong></div></div><div class="profile-location-actions"><button class="secondary" id="show-landmark">View landmark photo</button>${pin ? `<a class="secondary" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(c.lat + ',' + c.lng)}">Open pin in Google Maps</a>` : ''}</div><button class="primary" id="create-order">+ Create order for this customer</button><button class="secondary danger" id="delete-customer">Delete customer</button><div class="history"><h2>Order history</h2>${loading ? '<p>Loading history...</p>' : state.historyError ? `<p class="form-error" role="alert">${E(state.historyError)}</p><button class="secondary" id="retry-history">Retry history</button>` : state.history.map(o => `<div class="history-row"><div><strong>${E(o.order_number)}</strong><small>${E(new Date(o.created_at).toLocaleString())} · ${E(statusLabel(o))}</small></div><div>${money(o.total_centavos)}<small>${E(payment(o))}</small></div></div>`).join('') || '<p class="empty">No orders yet.</p>'}</div>`;
    $('#edit-customer').onclick = () => editCustomer(c);
    $('#create-order').onclick = () => newOrder(c);
    $('#delete-customer').onclick = () => deleteCustomer(c);
    $('#show-landmark').onclick = () => {
      if (!c.landmark_photo) { notice('No landmark photo has been saved.'); return; }
      const url = new URL(c.landmark_photo, window.location.origin);
      if (!['https:', 'http:'].includes(url.protocol) || url.origin !== window.location.origin) { notice('The landmark photo URL is unavailable.'); return; }
      $('#landmark-full').src = url.href; $('#landmark-viewer').showModal();
    };
    if ($('#retry-history')) $('#retry-history').onclick = loadHistory;
  }
  async function loadHistory() {
    const generation = ++state.profileGeneration, id = state.selected;
    state.historyError = ''; state.history = []; profile(true);
    try {
      const history = await request(`/customers/${endpointId(id)}/orders`);
      if (generation !== state.profileGeneration) return;
      state.history = history;
    } catch (error) { if (generation !== state.profileGeneration) return; state.historyError = 'Could not load history: ' + error.message; }
    profile();
  }
  function editCustomer(c) {
    const form = $('#customer-form'); form.reset(); report(form, { message: '' });
    $('#customer-form-title').textContent = c ? 'Edit customer' : 'New customer';
    for (const [field, key] of Object.entries({ 'customer-id': '_id', 'customer-name': 'name', messenger: 'messenger', phone: 'phone', address: 'address', landmark: 'landmark', lat: 'lat', lng: 'lng' })) $('#' + field).value = c?.[key] ?? '';
    $('#customer-dialog').showModal(); window.Landmarks.begin(c);
    // The existing map editor assumes every supplied customer has numeric coordinates.
    window.openCustomerPin(c && hasPin(c) ? c : null);
  }
  function addItem() {
    const row = document.createElement('div'); row.className = 'item-row';
    row.innerHTML = '<input aria-label="Food item" placeholder="Food item" required maxlength="120"><input aria-label="Quantity" type="number" min="1" max="999" step="1" value="1" required><input aria-label="Unit price in pesos" type="number" min=".01" max="100000" step=".01" placeholder="Pesos each" required><button type="button" class="text-button" aria-label="Remove item">Remove</button>';
    row.querySelector('button').onclick = () => { row.remove(); totals(); };
    $('#item-rows').append(row);
  }
  function orderValues() {
    const items = [...document.querySelectorAll('.item-row')].map(row => { const inputs = row.querySelectorAll('input'); return { name: inputs[0].value.trim(), quantity: Number(inputs[1].value), price_centavos: Math.round(Number(inputs[2].value) * 100) }; });
    const fee = Math.round(Number($('#delivery-fee').value) * 100);
    const total = items.reduce((sum, item) => sum + item.quantity * item.price_centavos, fee);
    const method = $('#payment-method').value;
    return { items, fee_centavos: fee, total, payment_method: method, cash_tendered_centavos: method === 'cash' ? Math.round(Number($('#cash-tendered').value) * 100) : method === 'exact' ? total : null, payment_reference: method === 'gcash' ? $('#payment-reference').value.trim() : null };
  }
  function totals() {
    const order = orderValues();
    $('#cash-field').hidden = order.payment_method !== 'cash'; $('#cash-tendered').required = order.payment_method === 'cash';
    $('#reference-field').hidden = order.payment_method !== 'gcash'; $('#payment-reference').required = order.payment_method === 'gcash';
    $('#payment-summary').textContent = 'Estimated total ' + money(order.total) + '. The server confirms the final total.';
  }
  function newOrder(c) {
    const form = $('#order-form'); form.reset(); report(form, { message: '' }); orderAttempt = null;
    form.dataset.customer = c._id; $('#order-customer-name').textContent = c.name;
    $('#order-address').textContent = c.address + ' · ' + (c.landmark || 'No landmark') + (hasPin(c) ? '' : ' · No pin saved');
    $('#item-rows').innerHTML = ''; addItem(); totals(); $('#order-dialog').showModal();
  }
  async function saveOrder(form) {
    const value = orderValues();
    if (!$('#address-confirm').checked) throw Error('Confirm the delivery address.');
    if (!value.items.length || value.items.some(item => !item.name || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999 || !Number.isSafeInteger(item.price_centavos) || item.price_centavos <= 0) || !Number.isSafeInteger(value.fee_centavos) || value.fee_centavos < 0 || !Number.isSafeInteger(value.total) || value.total <= 0) throw Error('Add valid items, quantities, prices and delivery fee.');
    if (value.payment_method === 'cash' && (!Number.isSafeInteger(value.cash_tendered_centavos) || value.cash_tendered_centavos < value.total)) throw Error('Customer cash must cover the total.');
    if (value.payment_method === 'gcash' && !value.payment_reference) throw Error('Enter the GCash payment reference.');
    const { total, ...fields } = value;
    const payload = { customer_id: form.dataset.customer, ...fields, notes: $('#order-notes').value.trim() };
    const fingerprint = JSON.stringify(payload);
    if (orderAttempt && orderAttempt.fingerprint !== fingerprint) throw Error('A previous attempt has an uncertain result. Restore its values and retry, or close and verify Orders before creating another order.');
    if (!orderAttempt) orderAttempt = { fingerprint, payload: { ...payload, idempotency_key: crypto.randomUUID() } };
    const saved = await send('/orders', 'POST', orderAttempt.payload);
    if (!saved?._id || !saved.order_number || !Number.isSafeInteger(saved.total_centavos)) throw Error('The server did not return a confirmed order. Retry with the same values.');
    orderAttempt = null; $('#order-dialog').close(); notice(`Order ${saved.order_number} saved. Confirmed total ${money(saved.total_centavos)}.`); await loadHistory();
  }
  function progress(order) {
    if (order.status === 'cancelled') return '<span class="badge amber">Cancelled</span>';
    const steps = [['preparing', 'Preparing'], ['on_the_way', 'On the way'], ['delivered', 'Delivered']];
    const at = steps.findIndex(s => s[0] === order.status);
    return '<p class="map-help">' + steps.map((s, i) => (i <= at ? '● ' : '○ ') + s[1]).join(' &rarr; ') + '</p>';
  }
  function renderOrders() {
    const filter = $('#order-filter').value;
    const terminal = order => ['delivered', 'cancelled'].includes(order.status);
    const orders = state.orders.filter(order => filter === 'all' || (filter === 'delivered' ? terminal(order) : !terminal(order)));
    $('#order-list').innerHTML = orders.map(order => `<article class="panel order-card"><div class="profile-heading"><div><span class="eyebrow">${E(order.order_number)}</span><h2>${E(order.customer?.name || 'Customer unavailable')}</h2></div><span class="badge amber">${E(statusLabel(order))}</span></div><p class="map-help">${E(order.customer?.address || 'No saved address')}<br>${E(order.customer?.landmark || '')}</p><ul class="food-list">${order.items.map(item => `<li><span>${item.quantity} x ${E(item.name)}</span><strong>${money(item.quantity * item.price_centavos)}</strong></li>`).join('')}<li><span>Delivery fee</span><strong>${money(order.fee_centavos)}</strong></li></ul><p class="payment-summary">${E(payment(order))}</p><p class="map-help">${E(order.notes || 'No preparation notes')}</p><div class="order-actions">${progress(order)}</div><p class="form-error" data-order-error="${E(order._id)}" role="alert"></p></article>`).join('') || '<div class="panel empty"><h2>No orders in this view.</h2><a href="customers.html">Open Customers</a></div>';
  }
  async function deleteCustomer(c) {
    if (!confirm(`Delete ${c.name}?\n\nThey will no longer appear in Customers or when creating orders. Past orders and sales are kept.`)) return;
    const button = $('#delete-customer'); if (button) button.disabled = true;
    try {
      await request(`/customers/${endpointId(c._id)}`, { method: 'DELETE' });
      state.customers = state.customers.filter(x => x._id !== c._id);
      state.selected = state.customers[0]?._id || null;
      customerList(); if (state.selected) await loadHistory(); else profile();
      notice(`${c.name} was deleted.`);
    } catch (error) { if (button) button.disabled = false; notice('Could not delete customer: ' + error.message); }
  }

  /* Rider pin file: { app:'juflow', type:'customer-pin', version:1, lat, lng, accuracy_m, customer:{id,name,phone,address} } */
  const digits = value => String(value || '').replace(/\D/g, '').slice(-10);
  const pinImport = { customer: null, lat: null, lng: null };
  async function readPinFile(file) {
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw Error('That file is not a JuFlow pin file.'); }
    const ok = data && data.app === 'juflow' && data.type === 'customer-pin' && data.version === 1;
    const lat = data?.lat, lng = data?.lng;
    if (!ok || typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw Error('That file is not a valid JuFlow pin file.');
    const ref = data.customer || {};
    let match = ref.id && state.customers.find(c => c._id === ref.id);
    if (!match && digits(ref.phone).length >= 7) { const same = state.customers.filter(c => digits(c.phone) === digits(ref.phone)); if (same.length === 1) match = same[0]; }
    const fallback = !match; if (fallback) match = state.customers.find(c => c._id === state.selected);
    if (!match) throw Error('Could not tell which customer this pin is for. Select the customer first, then import again.');
    Object.assign(pinImport, { customer: match, lat, lng });
    const when = data.captured_at && !Number.isNaN(Date.parse(data.captured_at)) ? new Date(data.captured_at).toLocaleString() : 'unknown time';
    const accuracy = Number.isFinite(data.accuracy_m) ? `about ${Math.round(data.accuracy_m)} m` : 'not reported';
    $('#pin-summary').innerHTML = `${fallback ? `<p class="notice-warn">The file is for <strong>${E(ref.name || 'an unknown customer')}</strong>, but no matching customer was found. It will be saved to the customer you selected.</p>` : ''}<div class="profile-details"><div><small>SAVE TO</small><strong>${E(match.name)}</strong></div><div><small>ADDRESS</small><strong>${E(match.address)}</strong></div><div><small>NEW PIN</small><strong>${E(lat + ', ' + lng)}</strong></div><div><small>GPS ACCURACY</small><strong>${E(accuracy)}</strong></div><div><small>CAPTURED</small><strong>${E(when)}</strong></div><div><small>CURRENT PIN</small><strong>${hasPin(match) ? E(match.lat + ', ' + match.lng) : 'No pin saved'}</strong></div></div><a class="secondary" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(lat + ',' + lng)}">Check this pin in Google Maps</a>`;
    $('#pin-form .form-error').textContent = '';
    $('#pin-dialog').showModal();
  }
  async function savePin() {
    const { customer, lat, lng } = pinImport;
    const saved = await send(`/customers/${endpointId(customer._id)}`, 'PATCH', { lat, lng });
    if (!saved?._id) throw Error('The server did not confirm the pin.');
    const index = state.customers.findIndex(c => c._id === saved._id); if (index >= 0) state.customers[index] = saved;
    state.selected = saved._id; $('#pin-dialog').close(); customerList(); notice(`Pin saved for ${saved.name}.`); await loadHistory();
  }
  async function refresh(quiet) {
    if (quiet !== true) notice('Loading saved records...');
    try {
      if ($('#customer-list')) {
        state.customers = await request('/customers'); state.selected = state.customers.find(c => c._id === state.selected)?._id || state.customers[0]?._id;
        customerList(); if (state.selected) await loadHistory(); else profile();
      } else {
        state.orders = await request('/orders?filter=all'); renderOrders();
      }
      if (quiet !== true) notice('Saved records loaded.');
    } catch (error) { notice('Could not load records: ' + error.message); }
  }
  if ($('#customer-list')) {
    $('#customer-search').oninput = customerList; $('#new-customer').onclick = () => editCustomer();
    $('#import-pin').onclick = () => { $('#pin-file').value = ''; $('#pin-file').click(); };
    $('#pin-file').onchange = event => { readPinFile(event.target.files[0]).catch(error => notice(error.message)); };
    $('#pin-form').onsubmit = event => { event.preventDefault(); submit(event.currentTarget, savePin); };
    $('#customer-list').onclick = event => { const button = event.target.closest('[data-customer]'); if (button) { state.selected = button.dataset.customer; customerList(); loadHistory(); } };
    document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => { if (button.closest('form')?.dataset.busy !== 'true') button.closest('dialog').close(); }; });
    $('#customer-form').onsubmit = event => { event.preventDefault(); const form = event.currentTarget; submit(form, async () => {
      const id = $('#customer-id').value;
      const lat = $('#lat').value.trim(), lng = $('#lng').value.trim();
      const payload = { name: $('#customer-name').value.trim(), messenger: $('#messenger').value.trim(), phone: $('#phone').value.trim(), address: $('#address').value.trim(), landmark: $('#landmark').value.trim(), lat: lat ? Number(lat) : null, lng: lng ? Number(lng) : null };
      if (!payload.name || !payload.phone || !payload.address || !!lat !== !!lng || (lat && (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng) || Math.abs(payload.lat) > 90 || Math.abs(payload.lng) > 180))) throw Error('Complete customer details and select a valid pin, or leave both coordinates empty.');
      const photo = window.Landmarks.value();
      const previous = state.customers.find(customer => customer._id === id);
      const saved = await send(id ? `/customers/${endpointId(id)}` : '/customers', id ? 'PATCH' : 'POST', payload);
      if (!saved?._id) throw Error('The server did not return a confirmed customer.');
      // Keep the confirmed ID even if the separate photo operation fails.
      $('#customer-id').value = saved._id;
      const index = state.customers.findIndex(c => c._id === saved._id); if (index < 0) state.customers.push(saved); else state.customers[index] = saved;
      try {
        if (typeof photo === 'string' && photo.startsWith('data:')) {
          const uploaded = await send(`/customers/${endpointId(saved._id)}/landmark`, 'POST', { image: photo });
          if (!uploaded?.landmark_photo) throw Error('The server did not confirm the photo upload.');
          saved.landmark_photo = uploaded.landmark_photo;
        } else if (photo === null && previous?.landmark_photo) {
          await request(`/customers/${endpointId(saved._id)}/landmark`, { method: 'DELETE' });
          saved.landmark_photo = null;
        }
      } catch (error) { throw Error('Customer details saved, but the landmark photo was not confirmed: ' + error.message + '. Retry Save to finish.'); }
      state.selected = saved._id; $('#customer-dialog').close(); customerList(); notice('Customer saved.'); await loadHistory();
    }); };
    $('#add-item').onclick = addItem; $('#order-form').oninput = totals; $('#order-form').onchange = totals;
    $('#order-form').onsubmit = event => { event.preventDefault(); const form = event.currentTarget; submit(form, () => saveOrder(form)); };
    ['customer-dialog', 'order-dialog'].forEach(id => $('#' + id).addEventListener('cancel', event => { if ($('#' + id).querySelector('form').dataset.busy === 'true') event.preventDefault(); }));
  } else if ($('#order-list')) {
    $('#order-filter').onchange = renderOrders;
    setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) refresh(true); }, 10000);
  }
  $('#refresh-records').onclick = refresh;
  refresh();
})();

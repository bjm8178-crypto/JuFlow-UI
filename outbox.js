(function (root) {
  'use strict';
  const nextEvent = { assigned: 'picked_up', picked_up: 'on_the_way', on_the_way: 'arrived', arrived: 'report_delivered' };
  const id = record => record.id || record._id;
  function uuid() { return root.crypto.randomUUID(); }
  function version(record) {
    if (!Number.isSafeInteger(record.version) || record.version < 0) throw new Error('Missing server version. Refresh before submitting.');
    return record.version;
  }
  function action(record, name, riderId) {
    if (!['set_preparing', 'set_ready', 'assign'].includes(name)) throw new Error('Invalid action');
    if (name === 'assign' && !riderId) throw new Error('Select a rider');
    return { action: name, version: version(record), event_id: uuid(), ...(name === 'assign' ? { rider_id: riderId } : {}) };
  }
  function event(record) {
    const name = nextEvent[record.status];
    if (!name) throw new Error('No next delivery event');
    return { event: name, version: version(record), event_id: uuid() };
  }
  function confirmation(delivery, verified, reference, tendered) {
    const order = delivery.order;
    if (!verified) throw new Error('Record payment verification before confirming.');
    if (!Number.isSafeInteger(order?.total_centavos) || order.total_centavos < 0) throw new Error('Exact order total unavailable.');
    const reconciliation = { amount_centavos: order.total_centavos, verified: true };
    if (order.payment_method === 'gcash') {
      if (!reference?.trim()) throw new Error('Enter the verified GCash reference.');
      reconciliation.payment_reference = reference.trim();
    } else if (order.payment_method === 'cash') {
      if (!Number.isSafeInteger(tendered) || tendered < order.total_centavos) throw new Error('Record sufficient cash received in centavos.');
      reconciliation.cash_tendered_centavos = tendered;
    } else if (order.payment_method !== 'exact') throw new Error('Unknown payment method.');
    return { version: version(delivery), event_id: uuid(), reconciliation };
  }
  function errorMessage(error) {
    return ({ 0: 'Network unavailable. No success has been recorded.', 400: 'Invalid submission.', 401: 'Session expired. Sign in again.', 403: 'You are not authorized for this action.', 404: 'This job is no longer available.', 409: 'Stale version or conflicting event. Refresh and review; the saved payload has not been changed.', 429: 'Too many requests. Wait before retrying.' })[error.status] || (error.status >= 500 ? 'Server unavailable. Retry later.' : error.message);
  }
  function create(storage, key) {
    let flushing = false;
    function read() { const data = JSON.parse(storage.getItem(key) || '[]'); if (!Array.isArray(data)) throw new Error('Invalid outbox storage'); return data; }
    function save(items) { storage.setItem(key, JSON.stringify(items)); }
    return {
      list: read,
      enqueue(endpoint, payload) {
        if (!/^\/deliveries\/[^/]+\/events$|^\/riders\/me\/location$/.test(endpoint)) throw new Error('Endpoint cannot be queued');
        if (!payload.event_id) throw new Error('Event UUID required');
        const items = read();
        if (items.some(item => item.payload.event_id === payload.event_id)) return;
        items.push({ endpoint, payload: JSON.parse(JSON.stringify(payload)), state: 'pending', created_at: new Date().toISOString() });
        save(items);
      },
      discard(eventId) { save(read().filter(item => item.payload.event_id !== eventId)); },
      async flush(send) {
        if (flushing) return;
        flushing = true;
        try {
          for (const item of read()) {
            if (item.state !== 'pending') continue;
            try {
              await send(item.endpoint, item.payload);
              save(read().filter(entry => entry.payload.event_id !== item.payload.event_id));
            } catch (error) {
              const items = read();
              const entry = items.find(entry => entry.payload.event_id === item.payload.event_id);
              if (entry) { entry.error = errorMessage(error); if ([400, 401, 403, 404, 409, 422].includes(error.status)) entry.state = 'blocked'; }
              save(items);
              throw error;
            }
          }
        } finally { flushing = false; }
      }
    };
  }
  function poll(load, onError) {
    let busy = false, delay = 15000, timer;
    async function run() {
      clearTimeout(timer);
      if (busy || root.document.hidden) return;
      busy = true;
      try { await load(); delay = 15000; } catch (error) { delay = Math.min(delay * 2, 120000); onError(error); }
      finally { busy = false; timer = setTimeout(run, delay); }
    }
    root.document.addEventListener('visibilitychange', () => { if (root.document.hidden) clearTimeout(timer); else run(); });
    return run;
  }
  const api = { create, uuid, id, action, event, confirmation, nextEvent, errorMessage, poll };
  root.JuOutbox = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

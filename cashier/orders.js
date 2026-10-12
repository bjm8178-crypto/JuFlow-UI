/* JuKi Cashier — Orders
 * Delivery orders with three statuses only: Preparing -> On the way -> Delivered.
 * The cashier sets the status (the admin sees it live) and can see the customer's address.
 * Uses GET /api/orders and POST /api/orders/:id/status.
 */
(function () {
  'use strict';

  const C = window.JuFlowCashier;
  const { api, ui, router } = C;
  const { h } = ui;
  const { peso, manilaDay, ago } = C.fmt;

  const STEPS = [['preparing', 'Preparing'], ['on_the_way', 'On the way'], ['delivered', 'Delivered']];
  const LABEL = { preparing: 'Preparing', on_the_way: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' };
  const TONE = { preparing: 'accent', on_the_way: 'info', delivered: 'ok', cancelled: 'muted' };

  const data = { active: [], done: [], tab: 'active', loadedAt: 0 };
  const view = { list: null, tabActive: null, tabDone: null };

  const explain = (err) => (err.network ? 'No connection. Try again in a moment.' : err.message || 'Something went wrong.');

  function payText(o) {
    if (o.payment_method === 'gcash') return 'GCash' + (o.payment_reference ? ' · ref ' + o.payment_reference : '');
    if (o.payment_method === 'exact') return 'Cash · exact amount';
    return 'Cash · pays ' + peso(o.cash_tendered_centavos) + (o.change_centavos ? ' · change ' + peso(o.change_centavos) : '');
  }

  async function loadActive() {
    const rows = await api.get('/orders?filter=active');
    data.active = Array.isArray(rows) ? rows : [];
    data.loadedAt = Date.now();
    ui.badge('orders', data.active.length);
  }

  async function loadDone() {
    const rows = await api.get('/orders?filter=delivered');
    const today = manilaDay(Date.now());
    data.done = (Array.isArray(rows) ? rows : []).filter((o) => manilaDay(o.updated_at || o.created_at) === today);
  }

  async function reload() {
    try { await loadActive(); if (data.tab === 'done') await loadDone(); } catch { /* keep what is on screen */ }
    paint();
  }

  async function setStatus(o, status) {
    if (o.status === status) return;
    try {
      await api.post('/orders/' + o._id + '/status', { status });
      ui.toast('Order ' + (o.order_number || '') + ' → ' + LABEL[status], 'success');
    } catch (err) {
      ui.toast(explain(err), 'error');
    }
    await reload();
  }

  async function cancelOrder(o) {
    const ok = await ui.confirm({
      title: 'Cancel ' + (o.order_number || 'order'),
      message: 'Cancel this order? Nothing will be counted as a sale.',
      confirmText: 'Cancel order', danger: true
    });
    if (ok) await setStatus(o, 'cancelled');
  }

  function stepButtons(o) {
    return h('div', { class: 'status-steps', role: 'group', 'aria-label': 'Order status' },
      STEPS.map(([key, label]) => h('button', {
        type: 'button', class: o.status === key ? 'on' : '', 'aria-pressed': String(o.status === key), text: label,
        onclick: (e) => { e.currentTarget.disabled = true; setStatus(o, key); }
      })));
  }

  function orderCard(o) {
    const c = o.customer || {};
    const items = (o.items || []).map((i) => i.quantity + '× ' + i.name).join(', ');
    return h('article', { class: 'order-card' },
      h('header', { class: 'order-head' },
        h('strong', { text: o.order_number || 'Order' }),
        h('span', { class: 'chip-tag tone-' + (TONE[o.status] || 'muted'), text: LABEL[o.status] || o.status }),
        h('span', { class: 'muted small order-ago', text: ago(o.created_at) })),
      h('div', { class: 'order-cust' },
        h('strong', { text: c.name || 'Customer' }),
        c.phone && h('a', { class: 'tel', href: 'tel:' + String(c.phone).replace(/[^\d+]/g, ''), text: c.phone }),
        c.address && h('div', { class: 'small', text: '📍 ' + c.address }),
        c.landmark && h('div', { class: 'muted small', text: 'Landmark: ' + c.landmark })),
      h('div', { class: 'order-items small', text: items }),
      o.notes && h('div', { class: 'order-notes small', text: 'Note: ' + o.notes }),
      h('div', { class: 'order-pay' }, h('span', { text: payText(o) }), h('strong', { text: peso(o.total_centavos) })),
      h('div', { class: 'order-actions' },
        stepButtons(o),
        h('button', { type: 'button', class: 'link-btn danger', text: 'Cancel order', onclick: () => cancelOrder(o) })));
  }

  function doneCard(o) {
    const cancelled = o.status === 'cancelled';
    const c = o.customer || {};
    return h('article', { class: 'order-card compact' },
      h('header', { class: 'order-head' },
        h('strong', { text: o.order_number || 'Order' }),
        h('span', { class: 'chip-tag tone-' + (cancelled ? 'muted' : 'ok'), text: cancelled ? 'Cancelled' : 'Delivered' }),
        h('span', { class: 'muted small order-ago', text: ago(o.updated_at || o.created_at) })),
      c.address && h('div', { class: 'muted small', text: c.address }),
      h('div', { class: 'order-pay' }, h('span', { text: (c.name || 'Customer') + ' · ' + payText(o) }), h('strong', { text: peso(o.total_centavos) })),
      !cancelled && h('div', { class: 'order-actions' },
        h('button', { type: 'button', class: 'link-btn', text: 'Wrong status? Back to On the way', onclick: () => setStatus(o, 'on_the_way') })));
  }

  function paint() {
    if (!view.list) return;
    view.tabActive.textContent = 'Active (' + data.active.length + ')';
    view.tabDone.textContent = 'Done today';
    view.tabActive.classList.toggle('on', data.tab === 'active');
    view.tabDone.classList.toggle('on', data.tab === 'done');
    view.tabActive.setAttribute('aria-checked', String(data.tab === 'active'));
    view.tabDone.setAttribute('aria-checked', String(data.tab === 'done'));
    if (data.tab === 'done') {
      view.list.replaceChildren(...(data.done.length ? data.done.map(doneCard) : [ui.state('empty', 'Nothing delivered yet today', 'Delivered and cancelled orders show up here.')]));
      return;
    }
    const rows = [...data.active].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    view.list.replaceChildren(...(rows.length ? rows.map(orderCard) : [ui.state('empty', 'No active orders', 'New delivery orders appear here.')]));
  }

  async function setTab(tab) {
    data.tab = tab;
    if (tab === 'done') {
      view.list.replaceChildren(ui.spinner());
      try { await loadDone(); } catch (err) { ui.toast(explain(err), 'error'); }
    }
    paint();
  }

  async function render(ctx) {
    view.list = null;
    let staleSince = 0;
    try { await loadActive(); } catch (err) { if (!data.loadedAt) throw err; staleSince = data.loadedAt; }
    const root = h('div', { class: 'orders' });
    if (staleSince) root.append(h('div', { class: 'notice warn', text: 'Can’t reach the server — showing orders from ' + ago(staleSince) + '.' }));
    view.tabActive = h('button', { type: 'button', role: 'radio', onclick: () => setTab('active') });
    view.tabDone = h('button', { type: 'button', role: 'radio', onclick: () => setTab('done') });
    root.append(h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Order list' }, view.tabActive, view.tabDone));
    view.list = h('div', { class: 'order-list' });
    root.append(view.list);
    ctx.onLeave(() => { view.list = null; });
    if (data.tab === 'done') { try { await loadDone(); } catch { /* shown empty */ } }
    paint();
    return root;
  }

  async function tick() {
    if (!navigator.onLine) return;
    try { await loadActive(); if (router.current === '/orders' && view.list && data.tab === 'active') paint(); } catch { /* keep the last list */ }
  }
  ui.onTick(tick);
  ui.onReady(tick);

  router.register('/orders', { title: 'Orders', subtitle: () => 'Preparing · On the way · Delivered', render });
})();

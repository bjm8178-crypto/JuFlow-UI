/* JuKi Cashier — Sell
 * Today's dishes (picked by the admin). Each dish has a + and a − button:
 *   +  records one sale right away  -> shows up in the admin's analytics and notifications
 *   −  undoes the latest sale of that dish today (returned food / cancelled delivery)
 * The number on each dish is how many were sold today.
 */
(function () {
  'use strict';

  const C = window.JuFlowCashier;
  const { api, ui, router } = C;
  const { h } = ui;
  const { peso, uuid } = C.fmt;

  const sell = { menu: [], counts: {}, date: null, method: 'cash', busy: new Set(), query: '' };
  const view = { grid: null, total: null };

  const explain = (err) => (err.network ? 'No connection. Try again in a moment.' : err.message || 'Something went wrong.');
  const soldUnits = () => Object.values(sell.counts).reduce((s, n) => s + n, 0);
  const soldPesos = () => sell.menu.reduce((s, d) => s + (sell.counts[d._id] || 0) * d.price_centavos, 0);

  async function load() {
    const [menu, counts] = await Promise.all([api.get('/menu/today'), api.get('/sales/counts')]);
    sell.menu = (menu.dishes || []).filter((d) => d && d._id);
    sell.date = menu.date;
    sell.counts = counts.counts || {};
  }

  async function change(dish, delta) {
    if (sell.busy.has(dish._id)) return;
    if (delta < 0 && !(sell.counts[dish._id] > 0)) return;
    sell.busy.add(dish._id);
    paint();
    try {
      if (delta > 0) {
        await api.post('/sales/tap', { product_id: dish._id, tap_id: uuid(), payment_method: sell.method });
        sell.counts[dish._id] = (sell.counts[dish._id] || 0) + 1;
      } else {
        await api.post('/sales/untap', { product_id: dish._id, undo_id: uuid() });
        sell.counts[dish._id] = Math.max(0, (sell.counts[dish._id] || 0) - 1);
      }
      if (navigator.vibrate) navigator.vibrate(20);
    } catch (err) {
      ui.toast(explain(err), 'error');
      try { await load(); } catch { /* keep what is on screen */ }
    } finally {
      sell.busy.delete(dish._id);
      paint();
    }
  }

  function dishCard(d) {
    const n = sell.counts[d._id] || 0;
    const busy = sell.busy.has(d._id);
    const media = d.photo_path
      ? h('img', { class: 'dish-img', src: d.photo_path, alt: '', loading: 'lazy' })
      : h('div', { class: 'dish-img dish-ph', 'aria-hidden': 'true', text: (d.name || '?').trim().charAt(0).toUpperCase() });
    return h('article', { class: 'dish' + (n ? ' on' : '') },
      media,
      h('div', { class: 'dish-info' },
        h('div', { class: 'dish-name', text: d.name }),
        h('div', { class: 'dish-price', text: peso(d.price_centavos) })),
      h('div', { class: 'qty' },
        h('button', { type: 'button', class: 'qty-btn', disabled: busy || n === 0, 'aria-label': 'Remove one ' + d.name, onclick: () => change(d, -1), text: '−' }),
        h('strong', { text: String(n), 'aria-label': n + ' sold today' }),
        h('button', { type: 'button', class: 'qty-btn plus', disabled: busy, 'aria-label': 'Add one ' + d.name, onclick: () => change(d, +1), text: '+' })));
  }

  function paint() {
    if (!view.grid) return;
    const q = sell.query.trim().toLowerCase();
    const dishes = q ? sell.menu.filter((d) => (d.name || '').toLowerCase().includes(q)) : sell.menu;
    view.grid.replaceChildren(...(dishes.length ? dishes.map(dishCard) : [h('p', { class: 'muted', text: 'No dishes match “' + sell.query + '”.' })]));
    if (view.total) view.total.textContent = soldUnits() + ' sold today · ' + peso(soldPesos());
  }

  function methodToggle() {
    const btn = (m, label) => h('button', {
      type: 'button', role: 'radio', class: sell.method === m ? 'on' : '', 'aria-checked': String(sell.method === m), text: label,
      onclick: () => { sell.method = m; box.replaceChildren(btn('cash', 'Cash'), btn('gcash', 'GCash')); }
    });
    const box = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Payment for the next sale' }, btn('cash', 'Cash'), btn('gcash', 'GCash'));
    return box;
  }

  async function render(ctx) {
    view.grid = null;
    await load();
    const root = h('div', { class: 'sell' });
    if (!sell.menu.length) {
      root.append(ui.state('empty', 'No dishes for today yet', 'Ask the admin to pick today’s dishes (Dishes page).'));
      return root;
    }
    view.total = h('div', { class: 'sell-total', role: 'status' });
    const search = h('input', {
      type: 'search', placeholder: 'Search dishes', 'aria-label': 'Search dishes',
      oninput: (e) => { sell.query = e.target.value; paint(); }
    });
    view.grid = h('div', { class: 'dish-grid' });
    root.append(view.total, h('p', { class: 'muted small', text: 'Tap + for each sale. Tap − to undo one (returned or cancelled).' }), methodToggle(), search, view.grid);
    ctx.onLeave(() => { view.grid = null; view.total = null; });
    paint();
    return root;
  }

  ui.onTick(async () => {
    if (!navigator.onLine || !view.grid || sell.busy.size) return;
    try { await load(); paint(); } catch { /* keep the last known counts */ }
  });

  router.register('/sell', { title: 'Sell', subtitle: () => 'Today’s menu', render });
})();

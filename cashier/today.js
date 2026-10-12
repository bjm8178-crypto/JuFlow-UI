/* JuKi Cashier — Today
 * Totals for today, straight from the same sales the + / − buttons record.
 */
(function () {
  'use strict';

  const C = window.JuFlowCashier;
  const { api, ui, router } = C;
  const { h } = ui;
  const { peso } = C.fmt;

  const card = (title, value, sub) => h('div', { class: 'summary-card' },
    h('h3', { text: title }), h('div', { class: 'summary-value', text: String(value) }), sub && h('small', { text: sub }));

  async function render() {
    const [today, counts, menu] = await Promise.all([api.get('/sales/today'), api.get('/sales/counts'), api.get('/menu/today')]);
    const grid = h('div', { class: 'summary-grid' },
      card('Sales today', peso(today.total_centavos), (today.transaction_count || 0) + ' sales'),
      card('Items sold', today.units_sold || 0, 'after returns'),
      (today.by_payment || []).map((p) => card(p._id === 'gcash' ? 'GCash' : 'Cash', peso(p.total_centavos), (p.transaction_count || 0) + ' sales')));
    const rows = (menu.dishes || []).map((d) => ({ d, n: (counts.counts || {})[d._id] || 0 })).sort((a, b) => b.n - a.n);
    const list = h('div', { class: 'sales-list' }, rows.length
      ? rows.map(({ d, n }) => h('div', { class: 'order-pay' }, h('span', { text: d.name }), h('strong', { text: n + ' sold' })))
      : [h('p', { class: 'muted', text: 'No dishes picked for today yet.' })]);
    return h('div', {}, grid, h('div', { class: 'stage-title' }, h('h2', { text: 'By dish' })), list);
  }

  router.register('/today', {
    title: 'Today',
    subtitle: () => new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' }),
    render
  });
})();

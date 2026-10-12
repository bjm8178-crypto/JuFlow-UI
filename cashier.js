(async function () {
  'use strict';
  const user = await window.JUFLOW_AUTH_READY.catch(() => null);
  if (!user) return;
  const O = JuOutbox, status = document.getElementById('status');
  if (!['cashier', 'admin'].includes(user.role_name)) { status.textContent = 'Cashier access required.'; return; }
  let orders = [], deliveries = [], riders = [], mutating = false;
  function element(tag, text) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
  function button(card, text, handler) { const node = element('button', text); node.disabled = mutating; node.onclick = handler; card.append(node); }
  async function submit(endpoint, payload) {
    if (mutating) return;
    mutating = true; document.querySelectorAll('.job-card button').forEach(node => node.disabled = true);
    try { await JuAPI.request(endpoint, { method: 'POST', body: JSON.stringify(payload) }); status.textContent = 'Server accepted the action.'; await refresh(); }
    catch (error) { status.textContent = O.errorMessage(error); }
    finally { mutating = false; render(); }
  }
  function attempt(callback) { try { callback(); } catch (error) { status.textContent = error.message; } }
  function card(record) { const node = element('article'); node.className = 'job-card'; node.append(element('h2', 'Order ' + (record.order_number || O.id(record))), element('p', record.preparation_status || record.status)); return node; }
  function render() {
    const list = document.getElementById('orders'); list.replaceChildren();
    for (const order of orders) {
      const node = card(order); node.append(element('p', JuAPI.money(order.total_centavos)));
      const prep = order.preparation_status;
      if (prep === 'received') button(node, 'Start preparing', () => attempt(() => submit('/orders/' + encodeURIComponent(O.id(order)) + '/actions', O.action(order, 'set_preparing'))));
      if (prep === 'preparing') button(node, 'Mark ready', () => attempt(() => submit('/orders/' + encodeURIComponent(O.id(order)) + '/actions', O.action(order, 'set_ready'))));
      if (prep === 'ready' && ['pending', 'assigned'].includes(order.delivery_status)) {
        const select = element('select'); select.setAttribute('aria-label', 'Assign rider'); select.append(new Option('Select rider', ''));
        for (const rider of riders.filter(r => r.is_active === true && r.is_available === true && r.user_id)) select.append(new Option(rider.full_name || rider.name || O.id(rider), O.id(rider)));
        node.append(select); button(node, 'Assign rider', () => attempt(() => submit('/orders/' + encodeURIComponent(O.id(order)) + '/actions', O.action(order, 'assign', select.value))));
      }
      list.append(node);
    }
    if (!orders.length) list.append(element('p', 'No active orders.'));
    const confirmations = document.getElementById('confirmations'); confirmations.replaceChildren();
    for (const delivery of deliveries.filter(d => d.status === 'awaiting_cashier_confirmation')) {
      const order = delivery.order || {}, node = card(order);
      node.append(element('p', 'Exact total: ' + JuAPI.money(order.total_centavos) + ' | ' + (order.payment_method || 'Unknown method')));
      if (user.role_name === 'cashier') {
        const field = element('input'); field.type = order.payment_method === 'gcash' ? 'text' : 'number'; field.min = '0'; field.step = '1';
        const fieldLabel = element('label', order.payment_method === 'gcash' ? 'Verified GCash reference ' : 'Cash received (integer centavos) '); fieldLabel.append(field);
        const verify = element('input'); verify.type = 'checkbox'; const label = element('label', 'I personally verified receipt and the exact amount of this payment. '); label.append(verify);
        node.append(fieldLabel, label); button(node, 'Record final confirmation', () => attempt(() => submit('/deliveries/' + encodeURIComponent(O.id(delivery)) + '/confirm', O.confirmation(delivery, verify.checked, field.value, field.value === '' ? NaN : Number(field.value)))));
      } else node.append(element('p', 'Only a cashier can record final payment confirmation.'));
      confirmations.append(node);
    }
    if (!confirmations.children.length) confirmations.append(element('p', 'No deliveries awaiting confirmation.'));
  }
  async function refresh() {
    if (!navigator.onLine) throw Object.assign(new Error('Offline'), { status: 0 });
    [orders, deliveries, riders] = await Promise.all([JuAPI.request('/orders?filter=active'), JuAPI.request('/deliveries?filter=active'), JuAPI.request('/riders')]);
    render(); status.textContent = 'Live queue updated ' + new Date().toLocaleTimeString();
  }
  const poll = O.poll(refresh, error => { status.textContent = O.errorMessage(error); });
  document.getElementById('refresh').onclick = poll;
  document.getElementById('signout').onclick = () => window.juflowLogout().catch(() => {});
  poll();
})();

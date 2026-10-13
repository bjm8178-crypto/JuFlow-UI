/* Juki Cashier — New order
 * Phone / Messenger delivery orders: pick a customer, add dishes (priced by the server), choose a delivery fee + payment.
 * Needs a connection. Retrying an unchanged form reuses one idempotency key, so an order can never be created twice.
 */
(function () {
  'use strict';

  const C = window.JuFlowCashier;
  const { api, ui, router, isRetryable } = C;
  const { h } = ui;
  const { peso, toCentavos, uuid } = C.fmt;

  const data = { menu: [], customers: [] };
  const blank = () => ({ customer: null, qty: {}, feeKey: 'free', payMode: 'exact', tender: '', ref: '', notes: '', key: uuid(), busy: false, done: null, query: '' });
  let draft = blank();
  const dirty = () => { draft.key = uuid(); };

  const lines = () => data.menu.filter((d) => draft.qty[d._id] > 0).map((d) => ({ dish: d, qty: draft.qty[d._id] }));
  const subtotal = () => lines().reduce((s, l) => s + l.qty * l.dish.price_centavos, 0);
  // Delivery fee is one of three fixed choices.
  const FEES = [['free', 'Free', 0], ['within', 'Within Saog', 2000], ['outside', 'Outside of Saog', 5000]];
  const fee = () => (FEES.find((f) => f[0] === draft.feeKey) || FEES[0])[2];
  // replaceChildren turns null/false into the text "null"/"false", so drop empty values first.
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false && k !== ''));
  const total = () => subtotal() + (Number.isFinite(fee()) ? fee() : 0);

  function problem() {
    if (!draft.customer) return 'Choose a customer.';
    if (!lines().length) return 'Add at least one dish.';
    if (!Number.isFinite(fee())) return 'Enter a valid delivery fee.';
    if (draft.payMode === 'change') {
      const c = toCentavos(draft.tender);
      if (!Number.isFinite(c) || c < total()) return 'Enter the amount the customer will pay (at least the total).';
    }
    if (draft.payMode === 'gcash' && !draft.ref.trim()) return 'Enter the GCash reference number.';
    return '';
  }

  const explain = (err) => (err.network ? 'No connection. Try again in a moment.' : err.message || 'Something went wrong.');

  async function loadAll() {
    const [menu, customers] = await Promise.all([
      api.get('/menu/today'),
      api.get('/customers?limit=8')
    ]);
    data.menu = (menu.dishes || []).filter((d) => d && d._id);
    data.customers = Array.isArray(customers) ? customers : [];
    for (const id of Object.keys(draft.qty)) if (!data.menu.some((d) => d._id === id)) delete draft.qty[id];
  }

  /* ------------------------------------------------------------ add customer */

  function addCustomerSheet(onCreated) {
    const field = (id, label, attrs) => [h('label', { for: id, text: label }), h('input', { id, autocomplete: 'off', ...attrs })];
    const name = field('nc-name', 'Full name *', { type: 'text', maxlength: '200' });
    const phone = field('nc-phone', 'Phone *', { type: 'tel', inputmode: 'tel', maxlength: '40' });
    const address = h('textarea', { id: 'nc-address', rows: '3', maxlength: '1000', placeholder: 'House no., street, barangay' });
    const messenger = field('nc-messenger', 'Messenger (optional)', { type: 'text', maxlength: '200' });
    const landmark = field('nc-landmark', 'Landmark (optional)', { type: 'text', maxlength: '500' });
    const saveBtn = h('button', { type: 'button', class: 'app-btn primary full large', text: 'Save customer' });
    const sheet = ui.sheet({
      title: 'New customer',
      content: h('div', {}, name, phone, h('label', { for: 'nc-address', text: 'Delivery address *' }), address, messenger, landmark, saveBtn)
    });
    saveBtn.addEventListener('click', async () => {
      const body = { name: name[1].value.trim(), phone: phone[1].value.trim(), address: address.value.trim() };
      if (!body.name || !body.phone || !body.address) { ui.toast('Name, phone and address are required.', 'error'); return; }
      if (messenger[1].value.trim()) body.messenger = messenger[1].value.trim();
      if (landmark[1].value.trim()) body.landmark = landmark[1].value.trim();
      saveBtn.disabled = true;
      try {
        const customer = await api.post('/customers', body);
        sheet.close();
        ui.toast('Customer saved.', 'success');
        onCreated(customer);
      } catch (err) {
        ui.toast(explain(err), 'error');
        saveBtn.disabled = false;
      }
    });
  }

  /* ----------------------------------------------------------------- screens */

  function successView(ctx) {
    const o = draft.done;
    return h('div', { class: 'form-card success-card' },
      h('div', { class: 'success-mark', 'aria-hidden': 'true', text: '✓' }),
      h('h2', { text: (o.order_number || 'Order') + ' created' }),
      h('p', { class: 'muted', text: ((o.customer && o.customer.name) || 'Customer') + ' · ' + peso(o.total_centavos) }),
      h('p', { class: 'small', text: 'It is now in the kitchen queue.' }),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'app-btn', text: 'Create another', onclick: () => { draft.done = null; ctx.refresh(); } }),
        h('button', { type: 'button', class: 'app-btn primary', text: 'View orders', onclick: () => { draft.done = null; location.hash = '#/orders'; } })));
  }

  async function render(ctx) {
    if (!navigator.onLine) {
      return ui.state('error', 'You are offline', 'Creating delivery orders needs a connection.', { label: 'Try again', run: ctx.refresh });
    }
    await loadAll();
    if (draft.done) return successView(ctx);

    const root = h('div', { class: 'new-order' });
    const customerBox = h('section', { class: 'form-card' });
    const itemsBox = h('section', { class: 'form-card' });
    const feeBox = h('section', { class: 'form-card' });
    const payBox = h('section', { class: 'form-card' });
    const notesBox = h('section', { class: 'form-card' });
    const summaryBox = h('section', { class: 'form-card summary' });
    root.append(customerBox, itemsBox, feeBox, payBox, notesBox, summaryBox);

    /* customer */
    let searchSeq = 0;
    let searchTimer = null;
    const resultsEl = h('div', { class: 'row-list' });

    function paintResults() {
      fill(resultsEl, ...(data.customers.length
        ? data.customers.map((c) => h('button', {
          type: 'button', class: 'customer-row',
          onclick: () => { draft.customer = c; dirty(); paintCustomer(); paintSummary(); }
        }, h('strong', { text: c.name }), h('small', { text: [c.phone, c.address].filter(Boolean).join(' · ') })))
        : [h('p', { class: 'muted small', text: 'No customers found.' })]));
    }

    async function runSearch() {
      const seq = ++searchSeq;
      const q = draft.query.trim();
      try {
        const rows = await api.get('/customers?limit=8' + (q ? '&search=' + encodeURIComponent(q) : ''));
        if (seq !== searchSeq) return;
        data.customers = Array.isArray(rows) ? rows : [];
        paintResults();
      } catch (err) {
        if (seq === searchSeq) ui.toast(explain(err), 'error');
      }
    }

    function paintCustomer() {
      if (draft.customer) {
        const c = draft.customer;
        fill(customerBox, 
          h('h3', { text: 'Customer' }),
          h('div', { class: 'customer-picked' },
            h('div', {}, h('strong', { text: c.name }), c.phone && h('div', { class: 'small', text: c.phone }), c.address && h('div', { class: 'muted small', text: c.address })),
            h('button', { type: 'button', class: 'link-btn', text: 'Change', onclick: () => { draft.customer = null; dirty(); paintCustomer(); paintSummary(); } })));
        return;
      }
      fill(customerBox, 
        h('h3', { text: 'Customer' }),
        h('input', {
          type: 'search', placeholder: 'Search name or phone', 'aria-label': 'Search customers', value: draft.query,
          oninput: (e) => { draft.query = e.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 300); }
        }),
        resultsEl,
        h('button', {
          type: 'button', class: 'app-btn secondary full', text: '+ New customer',
          onclick: () => addCustomerSheet((c) => { draft.customer = c; dirty(); paintCustomer(); paintSummary(); })
        }));
      paintResults();
    }

    /* items */
    function paintItems() {
      if (!data.menu.length) {
        fill(itemsBox, h('h3', { text: 'Dishes' }), ui.state('empty', 'No dishes for today', 'Ask the admin to choose today’s menu.', { label: 'Refresh', run: ctx.refresh }));
        return;
      }
      const set = (id, q) => {
        q = Math.max(0, Math.min(99, q));
        if (q) draft.qty[id] = q; else delete draft.qty[id];
        dirty(); paintItems(); paintSummary();
      };
      fill(itemsBox, h('h3', { text: 'Dishes' }), ...data.menu.map((d) => {
        const q = draft.qty[d._id] || 0;
        return h('div', { class: 'item-row' },
          h('div', { class: 'item-main' }, h('strong', { text: d.name }), h('small', { text: peso(d.price_centavos) })),
          h('div', { class: 'qty' },
            h('button', { type: 'button', class: 'qty-btn', 'aria-label': 'Remove one ' + d.name, disabled: q === 0, onclick: () => set(d._id, q - 1), text: '−' }),
            h('strong', { text: String(q) }),
            h('button', { type: 'button', class: 'qty-btn', 'aria-label': 'Add one ' + d.name, onclick: () => set(d._id, q + 1), text: '+' })));
      }));
    }

    /* delivery fee */
    function paintFee() {
      const seg = h('div', { class: 'segmented fee', role: 'radiogroup', 'aria-label': 'Delivery fee' },
        ...FEES.map(([id, label, cents]) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(draft.feeKey === id), class: draft.feeKey === id ? 'on' : '',
          onclick: () => { draft.feeKey = id; dirty(); paintFee(); paintSummary(); }
        }, h('span', { text: label }), h('span', { class: 'fee-amt', text: peso(cents) }))));
      fill(feeBox, h('h3', { text: 'Delivery fee' }), seg);
    }

    /* payment */
    function paintPay() {
      const modes = [['exact', 'Cash · exact'], ['change', 'Cash · change'], ['gcash', 'GCash']];
      const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Payment method' },
        ...modes.map(([id, label]) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(draft.payMode === id), class: draft.payMode === id ? 'on' : '',
          onclick: () => { draft.payMode = id; dirty(); paintPay(); paintSummary(); }, text: label
        })));
      let extra = null;
      if (draft.payMode === 'change') {
        extra = h('div', {}, h('label', { for: 'no-tender', text: 'Customer will pay with (₱)' }), h('input', {
          id: 'no-tender', type: 'number', inputmode: 'decimal', step: '0.01', min: '0', placeholder: 'e.g. 500', value: draft.tender,
          oninput: (e) => { draft.tender = e.target.value; dirty(); paintSummary(); }
        }));
      } else if (draft.payMode === 'gcash') {
        extra = h('div', {}, h('label', { for: 'no-ref', text: 'GCash reference number' }), h('input', {
          id: 'no-ref', type: 'text', maxlength: '100', autocomplete: 'off', value: draft.ref,
          oninput: (e) => { draft.ref = e.target.value; dirty(); paintSummary(); }
        }));
      }
      fill(payBox, h('h3', { text: 'Payment' }), seg, extra);
    }

    fill(notesBox, 
      h('h3', { text: 'Notes (optional)' }),
      h('textarea', {
        rows: '3', maxlength: '500', placeholder: 'Delivery instructions, special requests…', 'aria-label': 'Order notes', value: draft.notes,
        oninput: (e) => { draft.notes = e.target.value; dirty(); }
      }));

    /* summary */
    function paintSummary() {
      const sub = subtotal();
      const f = Number.isFinite(fee()) ? fee() : 0;
      const t = sub + f;
      const p = problem();
      const rows = [
        h('div', { class: 'totals-row' }, h('span', { text: 'Dishes' }), h('span', { text: peso(sub) })),
        h('div', { class: 'totals-row' }, h('span', { text: 'Delivery fee' }), h('span', { text: peso(f) }))
      ];
      if (draft.payMode === 'change') {
        const c = toCentavos(draft.tender);
        if (Number.isFinite(c) && c >= t && t > 0) rows.push(h('div', { class: 'totals-row' }, h('span', { text: 'Change to prepare' }), h('span', { text: peso(c - t) })));
      }
      rows.push(h('div', { class: 'totals' }, h('span', { text: 'Total' }), h('strong', { text: peso(t) })));
      fill(summaryBox, 
        ...rows,
        p && h('p', { class: 'muted small', text: p }),
        h('button', {
          type: 'button', class: 'app-btn primary full large', disabled: draft.busy || !!p,
          text: draft.busy ? 'Creating…' : 'Create order · ' + peso(t), onclick: () => submit(ctx)
        }));
    }

    paintCustomer();
    paintItems();
    paintFee();
    paintPay();
    paintSummary();
    return root;
  }

  async function submit(ctx) {
    if (draft.busy || problem()) return;
    const body = {
      customer_id: draft.customer._id,
      items: lines().map((l) => ({ product_id: l.dish._id, quantity: l.qty })),
      fee_centavos: fee(),
      total_centavos: total(),
      payment_method: draft.payMode === 'gcash' ? 'gcash' : draft.payMode === 'change' ? 'cash' : 'exact',
      idempotency_key: draft.key
    };
    if (draft.payMode === 'change') body.cash_tendered_centavos = toCentavos(draft.tender);
    if (draft.payMode === 'gcash') body.payment_reference = draft.ref.trim();
    const notes = draft.notes.trim();
    if (notes) body.notes = notes;

    draft.busy = true;
    ctx.refresh();
    try {
      const order = await api.post('/orders', body);
      draft = Object.assign(blank(), { done: order });
      ui.toast((order.order_number || 'Order') + ' created.', 'success');
    } catch (err) {
      draft.busy = false;
      if (err.status === 400 && /total_centavos|product/i.test(err.message || '')) {
        ui.toast('Menu or prices changed. The menu was refreshed — please review the order.', 'error', { duration: 6000 });
      } else if (isRetryable(err)) {
        ui.toast('Not sure the order went through. Tap Create order again — it will not be duplicated.', 'error', { duration: 7000 });
      } else {
        ui.toast(explain(err), 'error', { duration: 6000 });
      }
    }
    ctx.refresh();
  }

  router.register('/new-order', { title: 'New order', subtitle: () => 'Delivery', render });
})();

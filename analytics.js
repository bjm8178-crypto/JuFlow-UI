(() => {
  const el = id => document.getElementById(id);
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = cents => '₱' + ((cents || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function today() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }

  if (el('sales-date')) el('sales-date').value = today();

  let controller, sequence = 0, hadData = false, inFlight = false;

  function chart(byHour) {
    // byHour: array of { _id: hour (0-23), total: centavos }
    const values = Array(24).fill(0);
    (byHour || []).forEach(h => { values[h._id] = h.total || 0; });
    const max = Math.max(...values, 1);
    el('sales-chart').innerHTML =
      '<div class="hour-bars" aria-label="Hourly sales">' +
      values.map((v, h) =>
        `<div class="hour-column"><div title="${h}:00 · ${money(v)}" class="hour-bar" style="height:${Math.max(2, v / max * 140)}px"><span class="sr-only">${h}:00 ${money(v)}</span></div><small>${h % 4 === 0 ? h : ''}</small></div>`
      ).join('') +
      `</div><p class="map-help">Peak hourly sales: ${money(Math.max(...values))}</p>`;
  }

  async function refresh() {
    inFlight = true;
    const request = ++sequence;
    if (controller) controller.abort();
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    const date = el('sales-date')?.value || today();
    const token = localStorage.getItem('juflow_token');

    try {
      const r = await fetch('/api/sales/summary?' + new URLSearchParams({ date }), {
        cache: 'no-store',
        signal: controller.signal,
        headers: token ? { 'Authorization': 'Bearer ' + token } : {}
      });

      if (!r.ok) throw new Error('Sales API unavailable');
      const d = await r.json();
      if (request !== sequence) return;

      // Update stat cards
      if (el('[data-stat="total_centavos"]') || document.querySelector('[data-stat="total_centavos"]')) {
        document.querySelectorAll('[data-stat]').forEach(node => {
          const k = node.dataset.stat;
          const val = d[k];
          if (val === undefined) return;
          node.textContent = k.endsWith('centavos') ? money(val) : (val || 0).toLocaleString();
        });
      }

      // Chart
      chart(d.by_hour);

      // Top products
      const topList = d.top_products || [];
      el('top-products').innerHTML = topList.slice(0, 6).map((p, i) =>
        `<div class="product-row"><span>${i + 1}</span><div><strong>${E(p._id)}</strong><small>${p.units} sold</small></div><strong>${money(p.revenue)}</strong></div>`
      ).join('') || '<p class="empty">No food sales recorded for today.</p>';

      if (el('sales-connection')) {
        el('sales-connection').textContent = 'Live · 3s refresh';
        el('sales-connection').className = 'badge blue';
      }
      if (el('sales-message')) {
        el('sales-message').textContent = d.transaction_count > 0
          ? `${d.transaction_count} sale${d.transaction_count !== 1 ? 's' : ''} recorded today.`
          : 'No sales recorded yet for today. Sales submitted by the cashier app will appear here.';
      }
      if (el('sales-updated')) {
        el('sales-updated').textContent = 'Last updated ' + new Date().toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' }) + ' · Philippine time';
      }

      hadData = true;
    } catch (e) {
      if (request !== sequence) return;
      if (el('sales-connection')) {
        el('sales-connection').textContent = 'Disconnected';
        el('sales-connection').className = 'badge amber';
      }
      if (el('sales-message')) {
        el('sales-message').textContent = (hadData ? 'Showing last received values. ' : '') +
          'Make sure the backend server is running (npm run dev in server/).';
      }
    } finally {
      clearTimeout(timeout);
      if (request === sequence) inFlight = false;
    }
  }

  if (el('sales-date')) el('sales-date').onchange = () => { hadData = false; refresh(); };
  if (el('refresh-sales')) el('refresh-sales').onclick = refresh;

  refresh();
  const timer = setInterval(() => {
    if (!document.hidden && !inFlight) refresh();
  }, 3000);
  window.addEventListener('focus', refresh);
  window.addEventListener('pagehide', () => { clearInterval(timer); controller?.abort(); });
})();

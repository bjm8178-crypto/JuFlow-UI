(async () => {
  try { if (!await window.JUFLOW_AUTH_READY) return; } catch (_) { return; }
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

  let page = 1;
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.innerHTML = '<h2>Transaction reporting</h2><label>From <input id="report-from" type="date"></label> <label>Through <input id="report-to" type="date"></label> <label>Data <select id="report-test"><option value="false">Real sales</option><option value="true">Test sales</option><option value="all">All sales</option></select></label> <label>Source <select id="report-source"><option value="">All sources</option><option value="order">Orders</option><option value="walk_in">Walk-in</option><option value="device">Device</option></select></label> <a id="report-export" class="btn" href="#">Export CSV</a><p id="report-breakdown"></p><div id="report-week"></div><div style="overflow:auto"><table><thead><tr><th>Transaction</th><th>Occurred (Manila)</th><th>Source</th><th>Payment</th><th>Food</th><th>Fee</th><th>Total</th><th>Actor</th></tr></thead><tbody id="report-feed"></tbody></table></div><button id="report-prev" type="button">Previous</button> <span id="report-page"></span> <button id="report-next" type="button">Next</button>';
  (document.querySelector('main') || document.body).appendChild(panel);
  const query = () => new URLSearchParams({ date: el('sales-date')?.value || today(), ...(el('report-from').value ? { from: el('report-from').value } : {}), ...(el('report-to').value ? { to: el('report-to').value } : {}), is_test: el('report-test').value, ...(el('report-source').value ? { source: el('report-source').value } : {}) });

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

    try {
      const params = query();
      const [d, feed] = await Promise.all([JuAPI.request('/sales/summary?' + params, {
        cache: 'no-store',
        signal: controller.signal
      }), JuAPI.request('/sales?' + params + '&page=' + page, { signal: controller.signal })]);
      if (request !== sequence) return;
      el('report-export').href = '/api/sales/export.csv?' + params;
      const cash = (d.by_payment || []).filter(p => ['cash', 'exact'].includes(p._id)).reduce((sum, p) => sum + p.total_centavos, 0);
      const gcash = (d.by_payment || []).find(p => p._id === 'gcash')?.total_centavos || 0;
      if (el('cash-sales')) el('cash-sales').textContent = money(cash);
      if (el('gcash-sales')) el('gcash-sales').textContent = money(gcash);
      el('report-breakdown').textContent = `Food ${money(d.food_centavos)} | Fees ${money(d.fee_centavos)} | Cash / exact ${money(cash)} | GCash ${money(gcash)}. GCash verification is a cashier record, not provider proof.`;
      const days = new Map((d.last_seven_days || []).map(day => [day._id, day.total_centavos]));
      const selected = new Date((el('sales-date')?.value || today()) + 'T00:00:00Z');
      document.querySelectorAll('[data-stat="last_7_days_centavos"]').forEach(n => { n.textContent = money((d.last_seven_days || []).reduce((s, x) => s + (x.total_centavos || 0), 0)); });
      el('report-week').textContent = 'Last seven days: ' + Array.from({ length: 7 }, (_, i) => { const date = new Date(selected.getTime() - (6 - i) * 86400000).toISOString().slice(0, 10); return date + ' ' + money(days.get(date)); }).join(' | ');
      el('report-feed').innerHTML = (feed.items || []).map(s => '<tr>' + [s.transaction_id, new Date(s.sale_time).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }), s.source || 'legacy', s.payment_method, money(s.food_centavos ?? s.total_centavos), money(s.fee_centavos), money(s.total_centavos), s.recorded_by].map(value => '<td>' + E(value) + '</td>').join('') + '</tr>').join('');
      el('report-page').textContent = `Page ${page} | ${feed.total} transactions`;
      el('report-prev').disabled = page === 1;
      el('report-next').disabled = page * feed.limit >= feed.total;

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
        el('sales-connection').textContent = 'Live · 10s refresh';
        el('sales-connection').className = 'badge blue';
      }
      if (el('sales-message')) {
        el('sales-message').textContent = d.transaction_count > 0
          ? `${d.transaction_count} sale${d.transaction_count !== 1 ? 's' : ''} in the selected period.`
          : 'No sales in the selected period.';
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
          e.message;
      }
    } finally {
      clearTimeout(timeout);
      if (request === sequence) inFlight = false;
    }
  }

  if (el('sales-date')) el('sales-date').onchange = () => { page = 1; hadData = false; refresh(); };
  ['report-from', 'report-to', 'report-test', 'report-source'].forEach(id => { el(id).onchange = () => { page = 1; refresh(); }; });
  el('report-prev').onclick = () => { if (page > 1) { page--; refresh(); } };
  el('report-next').onclick = () => { page++; refresh(); };
  if (el('refresh-sales')) el('refresh-sales').onclick = refresh;

  refresh();
  const timer = setInterval(() => {
    if (!document.hidden && !inFlight) refresh();
  }, 10000);
  window.addEventListener('focus', refresh);
  window.addEventListener('pagehide', () => { clearInterval(timer); controller?.abort(); });
})();

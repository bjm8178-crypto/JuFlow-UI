(async () => {
  try { if (!await window.JUFLOW_AUTH_READY) return; } catch (_) { return; }
  const el = id => document.getElementById(id);
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = cents => '₱' + ((cents || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const isSalesPage = document.body.classList.contains('sales-page');
  let currentTab = isSalesPage ? 'monthly' : 'monthly'; // Dashboard is monthly, sales page defaults to monthly with tabs

  function today() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }

  if (el('sales-date')) el('sales-date').value = today();

  let page = 1;
  const panel = document.createElement('section');
  panel.className = 'panel report-panel';
  panel.innerHTML = `
    <div class="panel-heading report-heading">
      <div><h2>Transaction reporting</h2><p>Filter, review and export completed transactions (10 per page)</p></div>
      <a id="report-export" class="export-btn" href="#"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>Export CSV</a>
    </div>
    <div class="report-filters">
      <div class="field range-field" role="group" aria-label="Date range">
        <span>Date range</span>
        <div class="range-box">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4"/></svg>
          <label class="range-part"><small>From</small><input id="report-from" type="date"></label>
          <span class="range-arrow" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></span>
          <label class="range-part"><small>Through</small><input id="report-to" type="date"></label>
        </div>
        <div class="range-presets">
          <button type="button" data-range="today">Today</button>
          <button type="button" data-range="7">Last 7 days</button>
          <button type="button" data-range="month">This month</button>
          <button type="button" data-range="clear">Clear dates</button>
        </div>
      </div>
      
      <label class="field"><span>Source</span><select id="report-source"><option value="">All sources</option><option value="order">Orders</option><option value="walk_in">Walk-in</option><option value="device">Device</option></select></label>
    </div>
    <div id="report-breakdown" class="report-breakdown"></div>
    <div class="report-week-wrap"><h3>Last seven days</h3><div id="report-week" class="week-bars"></div></div>
    <div class="table-scroll"><table class="report-table"><thead><tr><th>Transaction</th><th>Occurred (Manila)</th><th>Source</th><th>Payment</th><th class="num">Food</th><th class="num">Fee</th><th class="num">Total</th><th>Actor</th></tr></thead><tbody id="report-feed"></tbody></table></div>
    <div class="report-pager"><span id="report-page" role="status">Page 1</span><div class="pager-buttons"><button id="report-prev" type="button" class="pager-btn-nav">&lt; Previous Page</button><button id="report-next" type="button" class="pager-btn-nav">Next Page &gt;</button></div></div>`;
  (document.querySelector('main') || document.body).appendChild(panel);
  const query = () => new URLSearchParams({ date: el('sales-date')?.value || today(), ...(el('report-from').value ? { from: el('report-from').value } : {}), ...(el('report-to').value ? { to: el('report-to').value } : {}), ...(el('report-source').value ? { source: el('report-source').value } : {}) });

  let controller, sequence = 0, hadData = false, inFlight = false, lastData = null;

  function hourLabel(h) {
    const suffix = h < 12 ? 'AM' : 'PM';
    return (h % 12 || 12) + ' ' + suffix;
  }

  function monthName(ym) {
    if (!ym) return '';
    const parts = ym.split('-');
    if (parts.length < 2) return ym;
    const date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, 1));
    return date.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function renderMonthlyChart(byMonth) {
    const months = byMonth || [];
    const values = months.map(m => m.total_centavos || 0);
    const peak = Math.max(...values, 0);
    const max = Math.max(peak, 1);
    const peakIdx = peak > 0 ? values.indexOf(peak) : -1;
    el('sales-chart').innerHTML =
      '<div class="month-bars" role="img" aria-label="Monthly sales">' +
      months.map((m, i) =>
        `<div class="month-column${i === peakIdx ? ' peak' : ''}" title="${monthName(m._id)} · ${money(m.total_centavos || 0)}"><div class="month-bar${m.total_centavos ? '' : ' zero'}" style="height:${m.total_centavos ? Math.max(6, (m.total_centavos || 0) / max * 100) : 0}%"><span class="sr-only">${monthName(m._id)} ${money(m.total_centavos || 0)}</span></div><small>${monthName(m._id)}</small></div>`
      ).join('') +
      '</div>' +
      `<p class="chart-peak">${peakIdx >= 0 ? `Peak month: <strong>${monthName(months[peakIdx]._id)}</strong> · ${money(peak)}` : 'No monthly sales recorded yet.'}</p>`;
  }

  function renderWeeklyChart(sevenDays) {
    const days = sevenDays || [];
    const values = days.map(d => d.total_centavos || 0);
    const peak = Math.max(...values, 0);
    const max = Math.max(peak, 1);
    const peakIdx = peak > 0 ? values.indexOf(peak) : -1;
    el('sales-chart').innerHTML =
      '<div class="month-bars" role="img" aria-label="Weekly sales">' +
      days.map((d, i) => {
        const dateObj = new Date(d._id + 'T00:00:00Z');
        const dayLabel = dateObj.toLocaleDateString('en-PH', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
        return `<div class="month-column${i === peakIdx ? ' peak' : ''}" title="${d._id} · ${money(d.total_centavos || 0)}"><div class="month-bar${d.total_centavos ? '' : ' zero'}" style="height:${d.total_centavos ? Math.max(6, (d.total_centavos || 0) / max * 100) : 0}%"><span class="sr-only">${dayLabel} ${money(d.total_centavos || 0)}</span></div><small>${dayLabel}</small></div>`;
      }).join('') +
      '</div>' +
      `<p class="chart-peak">${peakIdx >= 0 ? `Peak day: <strong>${days[peakIdx]._id}</strong> · ${money(peak)}` : 'No sales recorded this week.'}</p>`;
  }

  function renderDailyChart(byHour) {
    const values = Array(24).fill(0);
    (byHour || []).forEach(h => { values[h._id] = h.total || 0; });
    const peak = Math.max(...values);
    const max = Math.max(peak, 1);
    const peakHour = peak > 0 ? values.indexOf(peak) : -1;
    el('sales-chart').innerHTML =
      '<div class="hour-bars" role="img" aria-label="Hourly sales">' +
      values.map((v, h) =>
        `<div class="hour-column${h === peakHour ? ' peak' : ''}" title="${hourLabel(h)} · ${money(v)}"><div class="hour-bar${v ? '' : ' zero'}" style="height:${v ? Math.max(4, v / max * 100) : 0}%"><span class="sr-only">${hourLabel(h)} ${money(v)}</span></div><small>${h % 4 === 0 ? (h % 12 || 12) + (h < 12 ? 'a' : 'p') : ''}</small></div>`
      ).join('') +
      '</div>' +
      `<p class="chart-peak">${peakHour >= 0 ? `Peak hour: <strong>${hourLabel(peakHour)}</strong> · ${money(peak)}` : 'No sales recorded for this day yet.'}</p>`;
  }

  function renderTopProducts(list, periodName) {
    const topList = list || [];
    const topMax = Math.max(...topList.map(p => p.units || 0), 1);
    el('top-products').innerHTML = topList.slice(0, 6).map((p, i) =>
      `<div class="product-row"><span class="rank">${i + 1}</span><div class="product-info"><strong>${E(p._id)}</strong><small>${p.units} sold</small><div class="meter" aria-hidden="true"><i style="width:${Math.max(4, (p.units || 0) / topMax * 100)}%"></i></div></div><strong class="product-revenue">${money(p.revenue)}</strong></div>`
    ).join('') || `<div class="empty-state"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13h16a8 8 0 0 0-16 0Zm-1 4h18M12 5V3"/></svg><strong>No food sales yet</strong><span>${periodName ? 'No top products for ' + periodName + '.' : 'Items will rank here as soon as sales come in.'}</span></div>`;
  }

  function updateView(d) {
    if (!d) return;
    if (!isSalesPage) {
      // Main dashboard: Monthly sales graph and monthly top-selling food
      renderMonthlyChart(d.by_month);
      renderTopProducts(d.top_products_monthly || d.top_products, 'this month');
      return;
    }

    // Full Analytics page: Check active tab [Monthly | Weekly | Daily]
    if (currentTab === 'monthly') {
      if (el('chart-title')) el('chart-title').textContent = 'Monthly sales overview';
      if (el('chart-sub')) el('chart-sub').textContent = 'Past 6 months · Philippine time';
      if (el('top-title')) el('top-title').textContent = 'Top-selling food (Monthly)';
      if (el('top-sub')) el('top-sub').textContent = 'Ranked by units sold in the active month';
      renderMonthlyChart(d.by_month);
      renderTopProducts(d.top_products_monthly || d.top_products, 'this month');
    } else if (currentTab === 'weekly') {
      if (el('chart-title')) el('chart-title').textContent = 'Weekly sales overview';
      if (el('chart-sub')) el('chart-sub').textContent = 'Past 7 days · Philippine time';
      if (el('top-title')) el('top-title').textContent = 'Top-selling food (Weekly)';
      if (el('top-sub')) el('top-sub').textContent = 'Ranked by units sold this week';
      renderWeeklyChart(d.last_seven_days);
      renderTopProducts(d.top_products_weekly || d.top_products, 'this week');
    } else {
      if (el('chart-title')) el('chart-title').textContent = 'Daily sales by hour';
      if (el('chart-sub')) el('chart-sub').textContent = '12 AM to 11 PM · Philippine time';
      if (el('top-title')) el('top-title').textContent = 'Top-selling food (Daily)';
      if (el('top-sub')) el('top-sub').textContent = 'Ranked by quantity on the selected day';
      renderDailyChart(d.by_hour);
      renderTopProducts(d.top_products_daily || d.top_products, 'today');
    }
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
      }), JuAPI.request('/sales?' + params + '&limit=10&page=' + page, { signal: controller.signal })]);
      if (request !== sequence) return;
      lastData = d;
      el('report-export').href = '/api/sales/export.csv?' + params;
      const cash = (d.by_payment || []).filter(p => ['cash', 'exact'].includes(p._id)).reduce((sum, p) => sum + p.total_centavos, 0);
      const gcash = (d.by_payment || []).find(p => p._id === 'gcash')?.total_centavos || 0;
      if (el('cash-sales')) el('cash-sales').textContent = money(cash);
      if (el('gcash-sales')) el('gcash-sales').textContent = money(gcash);
      el('report-breakdown').innerHTML = [
        ['Food', money(d.food_centavos)],
        ['Fees', money(d.fee_centavos)],
        ['Cash / exact', money(cash)],
        ['GCash', money(gcash)]
      ].map(([label, value]) => `<div class="breakdown-item"><span>${label}</span><strong>${value}</strong></div>`).join('') +
        '<p class="breakdown-note">GCash verification is a cashier record, not provider proof.</p>';
      const days = new Map((d.last_seven_days || []).map(day => [day._id, day.total_centavos]));
      const selected = new Date((el('sales-date')?.value || today()) + 'T00:00:00Z');
      document.querySelectorAll('[data-stat="last_7_days_centavos"]').forEach(n => { n.textContent = money((d.last_seven_days || []).reduce((s, x) => s + (x.total_centavos || 0), 0)); });
      const week = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(selected.getTime() - (6 - i) * 86400000);
        const key = date.toISOString().slice(0, 10);
        return { key, label: date.toLocaleDateString('en-PH', { weekday: 'short', timeZone: 'UTC' }), day: date.getUTCDate(), total: days.get(key) || 0 };
      });
      const weekMax = Math.max(...week.map(w => w.total), 1);
      el('report-week').innerHTML = week.map((w, i) =>
        `<div class="week-day${i === 6 ? ' current' : ''}" title="${w.key} · ${money(w.total)}"><div class="week-track"><i style="height:${w.total ? Math.max(6, w.total / weekMax * 100) : 0}%"></i></div><strong>${money(w.total)}</strong><span>${w.label} ${w.day}</span></div>`
      ).join('');
      const paymentLabel = { cash: 'Cash', exact: 'Cash (exact)', gcash: 'GCash' };
      const rows = feed.items || [];
      el('report-feed').innerHTML = rows.length ? rows.map(s => {
        const method = String(s.payment_method || '').toLowerCase();
        const when = new Date(s.sale_time).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        return '<tr>' +
          '<td data-label="Transaction"><code>' + E(s.transaction_id) + '</code></td>' +
          '<td data-label="Occurred (Manila)">' + E(when) + '</td>' +
          '<td data-label="Source"><span class="chip">' + E(String(s.source || 'legacy').replace('_', ' ')) + '</span></td>' +
          '<td data-label="Payment"><span class="chip pay-' + E(method) + '">' + E(paymentLabel[method] || s.payment_method || '—') + '</span></td>' +
          '<td class="num" data-label="Food">' + E(money(s.food_centavos ?? s.total_centavos)) + '</td>' +
          '<td class="num" data-label="Fee">' + E(money(s.fee_centavos)) + '</td>' +
          '<td class="num total" data-label="Total">' + E(money(s.total_centavos)) + '</td>' +
          '<td data-label="Actor">' + E(s.recorded_by || '—') + '</td></tr>';
      }).join('') : '<tr class="empty-row"><td colspan="8"><div class="empty-state"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3v18h17M8 16v-4m5 4V8m5 8V5"/></svg><strong>No transactions found</strong><span>Try a different date range or source.</span></div></td></tr>';
      const limit = feed.limit || 10;
      const lastPage = Math.max(1, Math.ceil((feed.total || 0) / limit));
      el('report-page').textContent = `Page ${page} of ${lastPage} · ${feed.total} transaction${feed.total === 1 ? '' : 's'}`;
      el('report-prev').disabled = page <= 1;
      el('report-next').disabled = page >= lastPage;

      // Update stat cards
      if (el('[data-stat="total_centavos"]') || document.querySelector('[data-stat="total_centavos"]')) {
        document.querySelectorAll('[data-stat]').forEach(node => {
          const k = node.dataset.stat;
          const val = d[k];
          if (val === undefined) return;
          node.textContent = k.endsWith('centavos') ? money(val) : (val || 0).toLocaleString();
        });
      }

      // Render chart and top products based on active view
      updateView(d);

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

  // Tab listeners in sales.html
  document.querySelectorAll('[data-analytics-tab]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-analytics-tab]').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      currentTab = btn.dataset.analyticsTab;
      if (lastData) updateView(lastData);
    };
  });

  if (el('sales-date')) el('sales-date').onchange = () => { page = 1; hadData = false; refresh(); };
  const fromEl = el('report-from'), toEl = el('report-to');
  const ymd = d => d.toISOString().slice(0, 10);
  const shift = (iso, days) => ymd(new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000));
  function syncRange() {
    toEl.min = fromEl.value || ''; fromEl.max = toEl.value || '';
    const t = today(), f = fromEl.value, e = toEl.value;
    const active = !f && !e ? 'clear' : f === t && e === t ? 'today' : f === shift(t, -6) && e === t ? '7' : f === t.slice(0, 8) + '01' && e === t ? 'month' : '';
    panel.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('on', b.dataset.range === active));
  }
  function setRange(kind) {
    const t = today();
    const [f, e] = kind === 'today' ? [t, t] : kind === '7' ? [shift(t, -6), t] : kind === 'month' ? [t.slice(0, 8) + '01', t] : ['', ''];
    fromEl.value = f; toEl.value = e; syncRange(); page = 1; refresh();
  }
  panel.querySelectorAll('[data-range]').forEach(b => { b.onclick = () => setRange(b.dataset.range); });
  ['report-from', 'report-to', 'report-source'].forEach(id => { el(id).onchange = () => { syncRange(); page = 1; refresh(); }; });
  syncRange();
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

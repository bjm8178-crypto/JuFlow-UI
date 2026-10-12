// JuKi Rider App - History Module
// Completed delivery history (last 30 days)

(function() {
  'use strict';

  const { state, api, router } = window.JuFlowRider;

  let historyDeliveries = [];

  // Load delivery history
  async function loadHistory() {
    try {
      const response = await api.get('/orders?filter=delivered');
      historyDeliveries = Array.isArray(response) ? response : [];
      return historyDeliveries;
    } catch (err) {
      throw err;
    }
  }

  // Render history item
  function renderHistoryItem(delivery) {
    const item = document.createElement('div');
    item.className = 'history-item';
    
    // Format date
    const date = new Date(delivery.delivered_at || delivery.updated_at || delivery.created_at);
    const dateStr = date.toLocaleDateString('en-PH', { 
      month: 'short', 
      day: 'numeric' 
    });
    const timeStr = date.toLocaleTimeString('en-PH', { 
      hour: 'numeric', 
      minute: '2-digit' 
    });

    // Status badge
    const statusMap = {
      'delivered': { label: 'Delivered', color: 'success' },
      'cancelled': { label: 'Cancelled', color: 'error' }
    };
    
    const status = statusMap[delivery.status] || { label: delivery.status, color: 'muted' };

    item.innerHTML = `
      <div class="history-header">
        <div>
          <strong>Order #${delivery.order_number || 'N/A'}</strong>
          <span class="badge badge-${status.color}">${status.label}</span>
        </div>
        <small style="color:var(--text-muted);">${dateStr} ${timeStr}</small>
      </div>
      <div class="history-body">
        <p><strong>${delivery.customer?.name || 'Customer'}</strong></p>
        ${delivery.customer?.address ? `<p style="color:var(--text-muted);font-size:14px;">${delivery.customer.address}</p>` : ''}
        <p style="margin-top:4px;">
          <strong>₱${delivery.total_centavos ? (delivery.total_centavos / 100).toFixed(2) : '0.00'}</strong>
          <small style="color:var(--text-muted);"> • ${delivery.payment_method || 'unknown'}</small>
        </p>
      </div>
    `;

    return item;
  }

  // Group deliveries by date
  function groupByDate(deliveries) {
    const groups = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    deliveries.forEach(delivery => {
      const date = new Date(delivery.delivered_at || delivery.updated_at || delivery.created_at);
      date.setHours(0, 0, 0, 0);
      
      let key;
      if (date.getTime() === today.getTime()) {
        key = 'Today';
      } else if (date.getTime() === yesterday.getTime()) {
        key = 'Yesterday';
      } else {
        key = date.toLocaleDateString('en-PH', { 
          weekday: 'long', 
          month: 'short', 
          day: 'numeric' 
        });
      }

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(delivery);
    });

    return groups;
  }

  // Main history render
  async function renderHistory() {
    const main = document.getElementById('app-main');
    main.innerHTML = '';
    main.className = 'app-main';

    document.getElementById('header-title').textContent = 'History';
    document.getElementById('header-subtitle').textContent = 'Last 30 days';

    // Loading state
    const loading = document.createElement('div');
    loading.className = 'loading-state';
    loading.innerHTML = '<div class="spinner"></div><p>Loading history...</p>';
    main.appendChild(loading);

    try {
      await loadHistory();
      main.innerHTML = '';

      if (historyDeliveries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = `
          <p>No delivery history</p>
          <p style="color:var(--text-muted);margin-top:8px;">
            Completed deliveries will appear here.
          </p>
        `;
        main.appendChild(empty);
        return;
      }

      // Group by date
      const grouped = groupByDate(historyDeliveries);

      // Render groups
      Object.keys(grouped).forEach(dateLabel => {
        const section = document.createElement('div');
        section.className = 'app-section';
        section.innerHTML = `<h2>${dateLabel}</h2>`;
        main.appendChild(section);

        const list = document.createElement('div');
        list.className = 'history-list';

        grouped[dateLabel].forEach(delivery => {
          list.appendChild(renderHistoryItem(delivery));
        });

        main.appendChild(list);
      });

      // Stats summary
      const stats = document.createElement('div');
      stats.className = 'app-card';
      stats.style.marginTop = '24px';
      
      const totalDeliveries = historyDeliveries.length;
      const totalEarnings = historyDeliveries.reduce((sum, d) => 
        sum + (d.fee_centavos || 0), 0
      );

      stats.innerHTML = `
        <h3>Summary</h3>
        <div class="stats-grid">
          <div class="stat-item">
            <strong>${totalDeliveries}</strong>
            <small>deliveries</small>
          </div>
          <div class="stat-item">
            <strong>₱${(totalEarnings / 100).toFixed(2)}</strong>
            <small>total fees</small>
          </div>
        </div>
      `;
      main.appendChild(stats);

    } catch (err) {
      main.innerHTML = `
        <div class="error-state">
          <p>Failed to load history</p>
          <p style="color:var(--text-muted);font-size:14px;">${err.message || 'Please try again'}</p>
          <button class="app-btn" onclick="window.JuFlowRider.router.navigate('#/history')">Retry</button>
        </div>
      `;
    }
  }

  // Register route
  router.register('/history', renderHistory);

})();

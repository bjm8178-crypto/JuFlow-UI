// UI presentation helpers and topbar user profile hydration.
let toastTimer;
function showDemoNotice(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
}
document.querySelectorAll('[data-demo]:not([aria-label="Notifications"])').forEach(button => {
  button.addEventListener('click', () => showDemoNotice('This feature is not available yet.'));
});
document.querySelectorAll('[data-password]').forEach(button => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.password);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} password`);
    button.setAttribute('aria-pressed', String(show));
  });
});
const menuToggle = document.querySelector('.mobile-toggle');
if (menuToggle) {
  menuToggle.addEventListener('click', () => {
    const isOpen = document.getElementById('sidebar').classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      document.getElementById('sidebar').classList.remove('open');
      menuToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

// Populate topbar profile from the authenticated user
if (window.JUFLOW_AUTH_READY) {
  window.JUFLOW_AUTH_READY.then(user => {
    if (!user) return;
    const nameEl = document.querySelector('.profile strong');
    const roleEl = document.querySelector('.profile small');
    const avatarEl = document.querySelector('.avatar');
    if (nameEl) nameEl.textContent = user.full_name || user.username || 'User';
    if (roleEl) roleEl.textContent = user.role_name || 'Staff';
    if (avatarEl) {
      const name = user.full_name || user.username || 'U';
      avatarEl.textContent = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    }
  });
}


// Admin notifications: "something sold" (and returned) alerts, polled every 10 seconds.
(function adminNotifications() {
  const bell = document.querySelector('button[aria-label="Notifications"]');
  if (!bell || !window.JUFLOW_AUTH_READY) return;
  const dot = bell.querySelector('.notification-dot');
  const panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Notifications');
  panel.hidden = true;
  panel.style.cssText = 'position:fixed;top:64px;right:16px;width:min(340px,calc(100vw - 32px));max-height:70vh;overflow:auto;background:#fff;color:#222;border:1px solid #e3e5dd;border-radius:14px;box-shadow:0 12px 32px #0003;padding:8px;z-index:1000';
  document.body.appendChild(panel);
  let known = null, timer;
  const peso = c => '₱' + (Math.abs(c || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 });
  const when = iso => new Date(iso).toLocaleString('en-PH', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
  function draw(data) {
    if (dot) dot.style.display = data.unread ? '' : 'none';
    bell.setAttribute('aria-label', 'Notifications');
    bell.title = data.unread ? data.unread + ' new' : 'No new notifications';
    panel.replaceChildren();
    if (!data.items.length) {
      const empty = document.createElement('p');
      empty.style.cssText = 'padding:14px;color:#667164';
      empty.textContent = 'Nothing sold yet.';
      panel.append(empty);
    }
    for (const n of data.items) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:10px 12px;border-bottom:1px solid #eef0ea;' + (n.read ? '' : 'background:#fcf0e7;border-radius:8px;');
      const title = document.createElement('strong');
      title.textContent = (n.type === 'refund' ? '↩ ' : '🛎 ') + n.title;
      const body = document.createElement('div');
      body.textContent = n.body;
      const time = document.createElement('small');
      time.style.color = '#667164';
      time.textContent = when(n.created_at);
      row.append(title, body, time);
      panel.append(row);
    }
  }
  async function poll() {
    clearTimeout(timer);
    try {
      const res = await fetch('/api/notifications', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        const newest = data.items[0]?._id;
        if (known !== null && newest && newest !== known && data.unread && typeof showDemoNotice === 'function' && document.getElementById('toast')) {
          showDemoNotice(data.items[0].title + ' · ' + data.items[0].body);
        }
        known = newest || '';
        draw(data);
      }
    } catch (_) { /* try again next tick */ }
    if (!document.hidden) timer = setTimeout(poll, 10000);
  }
  bell.addEventListener('click', async () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      try { await fetch('/api/notifications/read', { method: 'POST', credentials: 'same-origin' }); } catch (_) { /* ignore */ }
      setTimeout(poll, 1500);
    }
  });
  document.addEventListener('click', e => { if (!panel.hidden && !panel.contains(e.target) && !bell.contains(e.target)) panel.hidden = true; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  window.JUFLOW_AUTH_READY.then(user => { if (user?.role_name === 'admin') poll(); });
})();

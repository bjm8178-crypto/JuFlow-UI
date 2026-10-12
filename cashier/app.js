/* JuFlow Cashier — core
 * State, API client, auth, offline outbox + ledger (IndexedDB), UI helpers and the hash router.
 * Screens (pos.js, orders.js, new-order.js, today.js, me.js) register themselves on window.JuFlowCashier.
 */
(function () {
  'use strict';

  const APP_VERSION = '1.1.0';
  const ROLES = ['cashier', 'admin'];
  const USER_KEY = 'juflow:cashier:user';

  const state = { user: null, online: navigator.onLine, installEvent: null, offlineStart: false };
  const $ = (id) => document.getElementById(id);

  /* ---------------------------------------------------------------- helpers */

  const uuid = () => (crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));

  const peso = (c) => '₱' + (Number(c || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const toCentavos = (v) => Math.round(parseFloat(String(v).replace(/[₱,\s]/g, '')) * 100); // NaN when invalid
  const manilaDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); // YYYY-MM-DD
  const clockTime = (d) => new Date(d).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
  const ago = (d) => {
    if (!d) return '';
    const min = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + ' min ago';
    if (min < 1440) return Math.floor(min / 60) + ' h ago';
    return new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  };
  const isRetryable = (err) => !!(err && (err.network || err.status >= 500 || err.status === 429 || err.status === 408));

  const store = {
    get(key, fallback = null) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } }
  };

  /* Tiny DOM builder: h('div', { class: 'x', onclick: fn }, child, 'text') — never parses HTML, so data is always escaped. */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (kid) => {
      if (kid === undefined || kid === null || kid === false) return;
      if (Array.isArray(kid)) kid.forEach(add);
      else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    };
    kids.forEach(add);
    return el;
  }

  /* -------------------------------------------------------------------- API */

  async function call(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
      res = await fetch('/api' + path, {
        method,
        credentials: 'same-origin',
        signal: controller.signal,
        headers: body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (e) {
      const err = new Error(e.name === 'AbortError' ? 'The server took too long to respond.' : 'No connection to the server.');
      err.network = true;
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 160) }; }
    if (!res.ok) {
      const err = new Error((data && (data.message || data.error)) || 'Request failed (' + res.status + ')');
      err.status = res.status;
      err.code = data && data.error;
      err.data = data;
      if (res.status === 401 && state.user && !path.startsWith('/auth/')) sessionExpired();
      throw err;
    }
    return data;
  }

  const api = {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body === undefined ? {} : body),
    patch: (path, body) => call('PATCH', path, body)
  };

  /* ---------------------------------------------------------------- storage */

  const idb = {
    promise: null,
    open() {
      if (!this.promise) {
        this.promise = new Promise((resolve, reject) => {
          const req = indexedDB.open('juflow-cashier', 2);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'transaction_id' });
            if (!db.objectStoreNames.contains('ledger')) db.createObjectStore('ledger', { keyPath: 'transaction_id' }).createIndex('day', 'day');
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      return this.promise;
    },
    async run(storeName, mode, fn) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        let out;
        const req = fn(tx.objectStore(storeName));
        if (req) req.onsuccess = () => { out = req.result; };
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
  };

  /* Sales waiting to reach the server. status: 'queued' (will retry) | 'review' (server rejected it; needs a person). */
  const outbox = {
    async add(payload) {
      const rec = { transaction_id: payload.transaction_id, user_id: state.user.id, payload, queued_at: Date.now(), attempts: 0, status: 'queued', error: null };
      await idb.run('outbox', 'readwrite', (os) => os.put(rec));
      return rec;
    },
    async all() { return (await idb.run('outbox', 'readonly', (os) => os.getAll())) || []; },
    async mine() {
      const uid = state.user && state.user.id;
      return (await this.all()).filter((r) => r.user_id === uid).sort((a, b) => a.queued_at - b.queued_at);
    },
    put(rec) { return idb.run('outbox', 'readwrite', (os) => os.put(rec)); },
    remove(id) { return idb.run('outbox', 'readwrite', (os) => os.delete(id)); }
  };

  /* Local record of walk-in sales made on this phone (feeds the Today tab). Kept for a week. */
  const ledger = {
    put(rec) { return idb.run('ledger', 'readwrite', (os) => os.put(rec)); },
    remove(id) { return idb.run('ledger', 'readwrite', (os) => os.delete(id)); },
    get(id) { return idb.run('ledger', 'readonly', (os) => os.get(id)); },
    async markSynced(id) {
      const rec = await this.get(id);
      if (rec) { rec.synced = true; await this.put(rec); }
    },
    async forDay(day) { return (await idb.run('ledger', 'readonly', (os) => os.index('day').getAll(day))) || []; },
    async prune() {
      const cutoff = manilaDay(Date.now() - 8 * 86400000);
      const all = (await idb.run('ledger', 'readonly', (os) => os.getAll())) || [];
      for (const rec of all) if (rec.day < cutoff) await this.remove(rec.transaction_id);
    }
  };

  let flushing = false;
  async function flush() {
    const result = { synced: 0, failed: 0, review: 0 };
    if (flushing || !state.user || !navigator.onLine) return result;
    flushing = true;
    try {
      const pending = (await outbox.mine()).filter((r) => r.status !== 'review');
      for (const rec of pending) {
        try {
          await api.post('/sales', rec.payload);
          await outbox.remove(rec.transaction_id);
          await ledger.markSynced(rec.transaction_id).catch(() => {});
          result.synced++;
        } catch (err) {
          if (err.status === 401) break; // session handling already took over; keep everything
          if (isRetryable(err)) {
            result.failed++;
            if (err.network) break;
            continue;
          }
          // The server rejected this sale for good (e.g. timestamp too old). Never delete it silently.
          rec.status = 'review';
          rec.error = err.message;
          rec.attempts = (rec.attempts || 0) + 1;
          await outbox.put(rec);
          result.review++;
        }
      }
    } catch (e) {
      console.warn('Outbox flush failed', e);
    } finally {
      flushing = false;
      refreshStatus();
    }
    return result;
  }

  async function refreshStatus() {
    const pill = $('connectivity-status');
    if (!pill) return;
    let queued = 0;
    let review = 0;
    try {
      const mine = await outbox.mine();
      review = mine.filter((r) => r.status === 'review').length;
      queued = mine.length - review;
    } catch { /* storage unavailable */ }
    if (review) { pill.textContent = review + ' need review'; pill.className = 'pill error'; }
    else if (queued) { pill.textContent = queued + ' unsent'; pill.className = 'pill warning'; }
    else if (state.online) { pill.textContent = '● online'; pill.className = 'pill success'; }
    else { pill.textContent = 'offline'; pill.className = 'pill error'; }
    ui.badge('me', review);
  }

  /* --------------------------------------------------------------------- UI */

  let openSheets = 0;
  const ticks = [];
  const readyHooks = [];

  const ui = {
    h,

    toast(message, type = 'info', opts = {}) {
      const root = $('toasts');
      if (!root) return;
      const el = h('div', { class: 'toast toast-' + type, role: 'status' }, h('span', { text: message }));
      if (opts.action) {
        el.append(h('button', { type: 'button', class: 'toast-action', text: opts.action.label, onclick: () => { opts.action.run(); el.remove(); } }));
      }
      root.append(el);
      setTimeout(() => el.remove(), opts.duration || 3500);
      if (type === 'error' && navigator.vibrate) navigator.vibrate([40, 60, 40]);
    },

    /* Bottom sheet. Returns { close }. */
    sheet({ title, content, onClose }) {
      const previous = document.activeElement;
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } },
        h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('header', { class: 'sheet-head' },
            h('h3', { text: title }),
            h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close', onclick: () => close(), text: '✕' })),
          h('div', { class: 'sheet-body' }, content)));
      let closed = false;
      function close() {
        if (closed) return;
        closed = true;
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        openSheets = Math.max(0, openSheets - 1);
        if (!openSheets) document.body.classList.remove('sheet-open');
        if (onClose) onClose();
        if (previous && previous.focus) previous.focus();
      }
      openSheets++;
      document.body.classList.add('sheet-open');
      document.addEventListener('keydown', onKey);
      document.body.append(overlay);
      return { close };
    },

    confirm({ title, message, confirmText = 'Confirm', danger = false }) {
      return new Promise((resolve) => {
        let done = false;
        const finish = (value) => { if (done) return; done = true; sheet.close(); resolve(value); };
        const sheet = ui.sheet({
          title,
          onClose: () => { if (!done) { done = true; resolve(false); } },
          content: h('div', {},
            h('p', { class: 'sheet-text', text: message }),
            h('div', { class: 'btn-row' },
              h('button', { type: 'button', class: 'app-btn', text: 'Cancel', onclick: () => finish(false) }),
              h('button', { type: 'button', class: 'app-btn ' + (danger ? 'danger' : 'primary'), text: confirmText, onclick: () => finish(true) })))
        });
      });
    },

    spinner: (text) => h('div', { class: 'loading-state' }, h('div', { class: 'spinner' }), h('p', { text: text || 'Loading…' })),

    state(kind, title, message, action) {
      return h('div', { class: kind + '-state' },
        h('p', { text: title }),
        message && h('p', { class: 'muted', text: message }),
        action && h('button', { type: 'button', class: 'app-btn', text: action.label, onclick: action.run }));
    },

    badge(route, count) {
      const el = document.querySelector('.tabbar a[data-route="' + route + '"] .tab-badge');
      if (!el) return;
      el.textContent = count > 99 ? '99+' : String(count);
      el.hidden = !(count > 0);
    },

    /* Runs fn on the periodic tick (every 20s while the app is open and visible). */
    onTick(fn) { ticks.push(fn); },

    /* Runs fn once each time the signed-in app opens. */
    onReady(fn) { readyHooks.push(fn); }
  };

  /* ----------------------------------------------------------------- router */

  const routes = Object.create(null);
  let leaveHooks = [];
  let navToken = 0;

  const router = {
    current: null,
    register(path, def) { routes[path] = def; },
    async go(hash) {
      let path = (hash || '').replace(/^#/, '');
      if (!routes[path]) {
        path = '/sell';
        if (location.hash !== '#/sell') history.replaceState(null, '', '#/sell');
      }
      const def = routes[path];
      const token = ++navToken;
      leaveHooks.splice(0).forEach((fn) => { try { fn(); } catch { /* ignore */ } });
      router.current = path;

      document.querySelectorAll('.tabbar a').forEach((a) => {
        const on = a.dataset.route === path.slice(1);
        a.classList.toggle('active', on);
        if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
      $('header-title').textContent = def.title;
      $('header-subtitle').textContent = typeof def.subtitle === 'function' ? def.subtitle() : (def.subtitle || 'JuFlow');

      const main = $('app-main');
      main.scrollTop = 0;
      main.replaceChildren(ui.spinner());
      const ctx = {
        alive: () => token === navToken,
        onLeave: (fn) => leaveHooks.push(fn),
        refresh: () => router.go('#' + path)
      };
      try {
        const node = await def.render(ctx);
        if (token !== navToken) return;
        main.replaceChildren(...(node ? [node] : []));
      } catch (err) {
        if (token !== navToken) return;
        main.replaceChildren(ui.state('error', 'Something went wrong', err.message || 'Please try again.', { label: 'Try again', run: ctx.refresh }));
      }
    }
  };

  window.addEventListener('hashchange', () => { if (state.user) router.go(location.hash); });

  /* ------------------------------------------------------------------- auth */

  const auth = {
    accept(user) {
      const role = user && (user.role_name || user.role);
      if (!user || !ROLES.includes(role)) throw new Error('This account cannot use the cashier app.');
      state.user = { ...user, id: String(user.id || user._id), role_name: role };
      store.set(USER_KEY, { id: state.user.id, name: user.full_name || user.username, role });
    },
    async check() {
      const res = await api.get('/auth/me');
      this.accept(res.user || res);
    },
    async login(username, password) {
      const res = await api.post('/auth/login', { username, password });
      try {
        this.accept(res.user);
      } catch (e) {
        await api.post('/auth/logout', {}).catch(() => {});
        throw e;
      }
    },
    async logout() {
      const mine = await outbox.mine().catch(() => []);
      const message = mine.length
        ? mine.length + (mine.length === 1 ? ' sale is' : ' sales are') + ' still waiting to send. They stay on this phone and send after you sign in again. Sign out now?'
        : 'Sign out of JuFlow Cashier?';
      const ok = await ui.confirm({ title: 'Sign out', message, confirmText: 'Sign out', danger: true });
      if (!ok) return false;
      try { await api.post('/auth/logout', {}); } catch { /* the cookie is cleared server-side when reachable */ }
      store.remove(USER_KEY);
      store.remove('juflow:cashier:cart');
      location.hash = '#/sell';
      location.reload();
      return true;
    }
  };

  function sessionExpired() {
    if (!state.user) return;
    state.user = null;
    showLogin('Your session expired. Sign in again — unsent sales are kept on this phone.');
  }

  /* ----------------------------------------------------------------- screens */

  function show(which) {
    $('connecting-screen').hidden = which !== 'connecting';
    $('login-screen').hidden = which !== 'login';
    $('app-shell').hidden = which !== 'app';
    $('checkout-bar').hidden = true;
  }

  function showLogin(message) {
    show('login');
    $('login-error').textContent = message || '';
    $('login-submit').disabled = false;
    const cached = store.get(USER_KEY);
    $('login-username').placeholder = cached && cached.name ? 'Username (last: ' + cached.name + ')' : 'Username';
  }

  function enterApp() {
    show('app');
    $('header-subtitle').textContent = state.user.full_name || state.user.username || 'JuFlow';
    refreshStatus();
    router.go(location.hash);
    flush();
    readyHooks.forEach((fn) => Promise.resolve().then(fn).catch(() => {}));
  }

  /* ------------------------------------------------------------------ start */

  function bindShell() {
    $('login-screen').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('login-username').value.trim();
      const password = $('login-password').value;
      if (!username || !password) { $('login-error').textContent = 'Enter your username and password.'; return; }
      $('login-error').textContent = '';
      $('login-submit').disabled = true;
      try {
        await auth.login(username, password);
        $('login-password').value = '';
        enterApp();
      } catch (err) {
        $('login-error').textContent = err.network ? 'Cannot reach the server. Check your connection.' : (err.message || 'Sign in failed.');
        $('login-submit').disabled = false;
      }
    });

    $('refresh-btn').addEventListener('click', () => router.go(location.hash));

    window.addEventListener('online', () => { state.online = true; refreshStatus(); flush(); });
    window.addEventListener('offline', () => { state.online = false; refreshStatus(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.user) flush(); });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.installEvent = e;
      $('install-prompt-btn').hidden = false;
    });
    $('install-prompt-btn').addEventListener('click', () => ui.install());
    window.addEventListener('appinstalled', () => { state.installEvent = null; $('install-prompt-btn').hidden = true; });

    setInterval(() => {
      if (!state.user || document.visibilityState !== 'visible') return;
      flush();
      ticks.forEach((fn) => Promise.resolve().then(fn).catch(() => {}));
    }, 20000);
  }

  ui.install = async function () {
    if (!state.installEvent) return false;
    state.installEvent.prompt();
    const choice = await state.installEvent.userChoice;
    state.installEvent = null;
    $('install-prompt-btn').hidden = true;
    return choice.outcome === 'accepted';
  };

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) ui.toast('App updated.', 'info', { duration: 10000, action: { label: 'Reload', run: () => location.reload() } });
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/cashier/sw.js', { scope: '/cashier/' }).catch((e) => console.warn('Service worker not registered', e));
    });
  }

  async function start() {
    bindShell();
    registerServiceWorker();
    show('connecting');
    ledger.prune().catch(() => {});
    try {
      await auth.check();
      enterApp();
    } catch (err) {
      if (err.network) {
        // Offline at launch: trust the last signed-in cashier so sales can still be taken from the saved menu.
        const cached = store.get(USER_KEY);
        if (cached && ROLES.includes(cached.role)) {
          state.user = { id: cached.id, full_name: cached.name, username: cached.name, role_name: cached.role };
          state.offlineStart = true;
          enterApp();
          return;
        }
        showLogin('You are offline. Connect once to sign in.');
        return;
      }
      showLogin(err.status === 401 ? '' : err.message);
    }
  }

  window.JuFlowCashier = {
    version: APP_VERSION,
    state, api, auth, outbox, ledger, router, ui, store,
    fmt: { peso, toCentavos, manilaDay, clockTime, ago, uuid },
    isRetryable, flush, refreshStatus, start
  };
})();

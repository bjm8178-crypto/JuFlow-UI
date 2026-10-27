// Admin AI assistant widget: a floating chat on every admin page.
// Messages are rendered with textContent only (never innerHTML). History lives in sessionStorage
// for this browser tab, so it follows the owner between admin pages and disappears when the tab closes.
(function () {
  'use strict';

  const STORAGE_KEY = 'juki_assistant_history';
  const MAX_KEPT = 10;
  const SUGGESTIONS = [
    'Magkano ang benta ngayon?',
    'Ano ang best-selling dish this month?',
    'Anong oras at araw pinakamataas ang benta?',
    'Ilang orders ang bukas pa ngayon?'
  ];

  let history = [];
  let busy = false;
  let els = null;

  function load() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(raw)) {
        history = raw.filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').slice(-MAX_KEPT);
      }
    } catch (_) { history = []; }
  }

  function save() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_KEPT))); } catch (_) { /* Storage may be denied. */ }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function addBubble(role, text) {
    const bubble = el('div', 'ai-msg ai-' + role, text);
    els.log.appendChild(bubble);
    els.log.scrollTop = els.log.scrollHeight;
    return bubble;
  }

  function setBusy(value) {
    busy = value;
    els.input.disabled = value;
    els.send.disabled = value;
    els.panel.classList.toggle('ai-busy', value);
  }

  async function request(messages) {
    const body = JSON.stringify({ messages });
    if (window.JuAPI && typeof window.JuAPI.request === 'function') {
      return window.JuAPI.request('/assistant/chat', { method: 'POST', body });
    }
    const response = await fetch('/api/assistant/chat', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || 'The assistant is unavailable right now.');
    return data;
  }

  async function ask(question) {
    const text = String(question || '').trim().slice(0, 1000);
    if (!text || busy) return;
    els.suggest.hidden = true;
    addBubble('user', text);
    history.push({ role: 'user', content: text });
    history = history.slice(-MAX_KEPT);
    setBusy(true);
    const thinking = addBubble('assistant', 'Nag-iisip…');
    thinking.classList.add('ai-thinking');
    try {
      const data = await request(history);
      const reply = String(data?.reply || '').trim() || 'Walang sagot na natanggap.';
      thinking.classList.remove('ai-thinking');
      thinking.textContent = reply;
      history.push({ role: 'assistant', content: reply });
    } catch (error) {
      thinking.classList.remove('ai-thinking');
      thinking.classList.add('ai-error');
      thinking.textContent = error.message || 'The assistant is unavailable right now.';
      // A failed question should not stay in the history, or every retry would resend it twice.
      history.pop();
    } finally {
      history = history.slice(-MAX_KEPT);
      save();
      setBusy(false);
      els.input.focus();
    }
  }

  function toggle(open) {
    const show = open === undefined ? els.panel.hidden : open;
    els.panel.hidden = !show;
    els.toggle.setAttribute('aria-expanded', String(show));
    if (show) { els.input.focus(); els.log.scrollTop = els.log.scrollHeight; }
  }

  function clearChat() {
    history = [];
    save();
    els.log.replaceChildren();
    greet();
    els.suggest.hidden = false;
  }

  function greet() {
    addBubble('assistant', 'Hi! Ako ang JuKi Assistant. Maitatanong mo sa akin ang benta, orders, deliveries, riders, menu at customers ng JuKi.');
  }

  function build() {
    const root = el('div', 'ai-root');

    const toggleBtn = el('button', 'ai-toggle', 'Ask AI');
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-label', 'Open the JuKi AI assistant');
    toggleBtn.setAttribute('aria-expanded', 'false');

    const panel = el('section', 'ai-panel');
    panel.hidden = true;
    panel.setAttribute('aria-label', 'JuKi AI assistant');

    const head = el('header', 'ai-head');
    const title = el('strong', null, 'JuKi Assistant');
    const clear = el('button', 'ai-link', 'Clear');
    clear.type = 'button';
    const close = el('button', 'ai-link', 'Close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close the assistant');
    const headActions = el('div', 'ai-head-actions');
    headActions.append(clear, close);
    head.append(title, headActions);

    const log = el('div', 'ai-log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');

    const suggest = el('div', 'ai-suggest');
    SUGGESTIONS.forEach(s => {
      const chip = el('button', 'ai-chip', s);
      chip.type = 'button';
      chip.addEventListener('click', () => ask(s));
      suggest.appendChild(chip);
    });

    const form = el('div', 'ai-form');
    const input = el('textarea', 'ai-input');
    input.rows = 1;
    input.maxLength = 1000;
    input.placeholder = 'Magtanong tungkol sa business…';
    input.setAttribute('aria-label', 'Your question');
    const send = el('button', 'ai-send', 'Send');
    send.type = 'button';
    form.append(input, send);

    const note = el('p', 'ai-note', 'Business questions only. Read-only: hindi ito nagbabago ng data.');

    panel.append(head, log, suggest, form, note);
    root.append(toggleBtn, panel);
    document.body.appendChild(root);

    els = { root, toggle: toggleBtn, panel, log, suggest, input, send };

    toggleBtn.addEventListener('click', () => toggle());
    close.addEventListener('click', () => toggle(false));
    clear.addEventListener('click', clearChat);
    send.addEventListener('click', () => { const q = input.value; input.value = ''; ask(q); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const q = input.value;
        input.value = '';
        ask(q);
      }
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !els.panel.hidden) toggle(false); });
  }

  async function init() {
    try {
      const user = window.JUFLOW_AUTH_READY ? await window.JUFLOW_AUTH_READY : window.JUFLOW_USER;
      if (!user || user.role_name !== 'admin') return; // admin pages only
    } catch (_) { return; }
    load();
    build();
    if (history.length) {
      history.forEach(m => addBubble(m.role, m.content));
      els.suggest.hidden = true;
    } else {
      greet();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

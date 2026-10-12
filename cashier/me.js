/* JuFlow Cashier — Me */
(function () {
  'use strict';

  const C = window.JuFlowCashier;
  const { state, auth, ui, router } = C;
  const { h } = ui;

  async function render() {
    const name = (state.user && (state.user.full_name || state.user.username)) || 'Cashier';
    return h('div', {},
      h('div', { class: 'app-card', style: 'text-align:center;padding:16px' },
        h('h2', { text: name }),
        h('p', { class: 'muted', text: 'Cashier' })),
      h('div', { class: 'app-card' },
        h('button', { type: 'button', class: 'app-btn danger full', text: 'Sign out', onclick: () => auth.logout() }),
        h('p', { class: 'muted small', style: 'text-align:center;margin-top:8px', text: 'JuFlow Cashier' })));
  }

  router.register('/me', { title: 'Me', subtitle: () => 'Account', render });
})();

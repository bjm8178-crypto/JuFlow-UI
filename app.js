// UI presentation helpers and topbar user profile hydration.
let toastTimer;
function showDemoNotice(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
}
document.querySelectorAll('[data-demo]').forEach(button => {
  button.addEventListener('click', () => showDemoNotice('This feature is part of the UI preview and is not connected yet.'));
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

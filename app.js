// Presentation-only interactions. No authentication, API, or stored data.
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
document.querySelectorAll('[data-demo-form]').forEach(form => {
  form.addEventListener('submit', event => {
    event.preventDefault();
    showDemoNotice('Demo only — no account is created or verified. Use “Explore the dashboard” below.');
  });
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

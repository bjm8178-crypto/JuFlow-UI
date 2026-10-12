// Auth guard: runs before page content, redirects to login if not authenticated.
// Uses cookie-based sessions (Python server sets cookies via HttpOnly).
window.JUFLOW_AUTH_READY = (async () => {
  document.documentElement.style.visibility = 'hidden';
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('unauth');
    const data = await r.json();
    window.JUFLOW_USER = data.user || data;
    document.documentElement.style.visibility = '';
    return window.JUFLOW_USER;
  } catch (e) {
    location.replace('/login.html?next=' + encodeURIComponent(location.pathname));
    return null;
  }
})();

window.juflowLogout = async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  location.replace('/login.html');
};

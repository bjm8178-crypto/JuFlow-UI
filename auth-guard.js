// Consumers must await JUFLOW_AUTH_READY before loading protected data.
try { localStorage.removeItem('juflow_token'); } catch (_) { /* Storage may be denied. */ }

window.juflowDefaultRoute = user => ({
  admin: '/dashboard.html', cashier: '/cashier.html', rider: '/rider.html'
}[user?.role_name] || '/login.html');

async function juflowSessionRequest(endpoint, options = {}) {
  let response;
  try {
    response = await fetch('/api/auth/' + endpoint, { ...options, credentials: 'same-origin' });
  } catch (cause) {
    throw Object.assign(new Error('Network unavailable. Please try again.'), { status: 0, code: 'network_unavailable', cause });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(data?.message || data?.error || `HTTP ${response.status}`), {
    status: response.status, code: data?.code || data?.error || `http_${response.status}`
  });
  return data;
}

function juflowAuthError(error) {
  const show = () => {
    let panel = document.getElementById('juflowAuthError');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'juflowAuthError';
      panel.setAttribute('role', 'alert');
      panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:white;color:#222;padding:48px';
      document.body.appendChild(panel);
    }
    panel.replaceChildren();
    const message = document.createElement('p');
    message.textContent = error.status === 403 ? 'Access denied. Your account is not allowed to open this page.' : error.message;
    const retry = document.createElement('button');
    retry.textContent = 'Retry';
    retry.onclick = () => location.reload();
    panel.append(message, retry);
    document.documentElement.style.visibility = '';
  };
  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show, { once: true });
}

window.JUFLOW_AUTH_READY = (async () => {
  document.documentElement.style.visibility = 'hidden';
  try {
    const data = await juflowSessionRequest('me');
    const user = data?.user || data;
    if (!['admin', 'cashier', 'rider'].includes(user?.role_name)) {
      throw Object.assign(new Error('Access denied.'), { status: 403, code: 'forbidden' });
    }
    const route = window.juflowDefaultRoute(user);
    if (user.role_name !== 'admin' && !['/', '/index.html', route].includes(location.pathname)) {
      location.replace(route);
      return null;
    }
    window.JUFLOW_USER = user;
    document.documentElement.style.visibility = '';
    return user;
  } catch (error) {
    if (error.status === 401) {
      location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search + (location.hash || '')));
    } else juflowAuthError(error);
    throw error;
  }
})();
// Mark handled for pages without a consumer; the original promise still rejects.
window.JUFLOW_AUTH_READY.catch(() => {});

window.juflowLogout = async () => {
  try {
    await juflowSessionRequest('logout', { method: 'POST' });
    window.JUFLOW_USER = null;
    location.replace('/login.html');
  } catch (error) {
    juflowAuthError(error);
    throw error;
  }
};

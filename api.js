// JuFlow API client: browser-managed HttpOnly cookie sessions.
const JuAPI = (() => {
  const API_URL = '/api';

  try { localStorage.removeItem('juflow_token'); } catch (_) { /* Storage may be denied. */ }

  function defaultRoute(user) {
    return { admin: '/dashboard.html', cashier: '/cashier.html', rider: '/rider.html' }[user?.role_name] || '/login.html';
  }

  function canAccess(pathname, user) {
    if (!['admin', 'cashier', 'rider'].includes(user?.role_name)) return false;
    return user.role_name === 'admin' || ['/', '/index.html', defaultRoute(user)].includes(pathname);
  }

  // Make authenticated API request
  async function request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const config = {
      ...options,
      headers,
      credentials: 'same-origin'
    };

    let response;
    try {
      response = await fetch(`${API_URL}${endpoint}`, config);
    } catch (cause) {
      throw Object.assign(new Error('Network unavailable. Please try again.'), { status: 0, code: 'network_unavailable', cause });
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      throw Object.assign(new Error(data?.message || data?.error || `HTTP ${response.status}`), {
        status: response.status,
        code: data?.code || data?.error || `http_${response.status}`
      });
    }
    return data;
  }

  // Authentication
  async function login(username, password) {
    const result = await request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    window.JUFLOW_USER = result.user || result;
    return result;
  }

  async function logout() {
    await request('/auth/logout', { method: 'POST' });
    window.JUFLOW_USER = null;
  }

  async function getCurrentUser() {
    const data = await request('/auth/me');
    window.JUFLOW_USER = data.user || data;
    return window.JUFLOW_USER;
  }

  async function changePassword(currentPassword, newPassword) {
    return await request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword
      })
    });
  }

  // Users
  async function getUsers() {
    return await request('/users');
  }

  async function createUser(userData) {
    return await request('/users', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
  }

  async function updateUser(id, userData) {
    return await request(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(userData)
    });
  }

  async function resetUserPassword(id, newPassword) {
    return await request(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: newPassword })
    });
  }

  // Products
  async function getProducts() {
    return await request('/products');
  }

  async function getProduct(id) {
    return await request(`/products/${id}`);
  }

  async function createProduct(data) {
    return await request('/products', { method: 'POST', body: JSON.stringify(data) });
  }

  async function updateProduct(id, data) {
    return await request(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  async function deleteProduct(id) {
    return await request(`/products/${id}`, { method: 'DELETE' });
  }

  // Categories
  async function getCategories() {
    return await request('/categories');
  }

  async function createCategory(data) {
    return await request('/categories', { method: 'POST', body: JSON.stringify(data) });
  }

  async function updateCategory(id, data) {
    return await request(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  async function deleteCategory(id) {
    return await request(`/categories/${id}`, { method: 'DELETE' });
  }

  // Customers
  async function getCustomers(search = '') {
    const url = search ? `/customers?search=${encodeURIComponent(search)}` : '/customers';
    return await request(url);
  }

  async function getCustomer(id) {
    return await request(`/customers/${id}`);
  }

  async function createCustomer(data) {
    return await request('/customers', { method: 'POST', body: JSON.stringify(data) });
  }

  async function updateCustomer(id, data) {
    return await request(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  // Orders
  async function getOrders(filter = 'active') {
    return await request(`/orders?filter=${filter}`);
  }

  async function getOrder(id) {
    return await request(`/orders/${id}`);
  }

  async function createOrder(data) {
    return await request('/orders', { method: 'POST', body: JSON.stringify(data) });
  }

  async function updateOrder(id, data) {
    return await request(`/orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  // Riders
  async function getRiders() {
    return await request('/riders');
  }

  async function getRider(id) {
    return await request(`/riders/${id}`);
  }

  async function createRider(riderData) {
    return await request('/riders', {
      method: 'POST',
      body: JSON.stringify(riderData)
    });
  }

  async function updateRider(id, riderData) {
    return await request(`/riders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(riderData)
    });
  }

  async function deleteRider(id) {
    return await request(`/riders/${id}`, { method: 'DELETE' });
  }

  // Deliveries
  async function getDeliveries(filter = 'active') {
    return await request(`/deliveries?filter=${filter}`);
  }

  async function updateDelivery(id, data) {
    return await request(`/deliveries/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  // Delivery Zones
  async function getDeliveryZones() {
    return await request('/delivery-zones');
  }

  async function getDeliveryZone(id) {
    return await request(`/delivery-zones/${id}`);
  }

  async function createDeliveryZone(zoneData) {
    return await request('/delivery-zones', {
      method: 'POST',
      body: JSON.stringify(zoneData)
    });
  }

  async function updateDeliveryZone(id, zoneData) {
    return await request(`/delivery-zones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(zoneData)
    });
  }

  async function deleteDeliveryZone(id) {
    return await request(`/delivery-zones/${id}`, { method: 'DELETE' });
  }

  // Sales
  async function getSales(date = null) {
    const url = date ? `/sales?date=${date}` : '/sales';
    return await request(url);
  }

  async function createSale(data) {
    return await request('/sales', { method: 'POST', body: JSON.stringify(data) });
  }

  // Settings
  async function getSettings(group = null) {
    const url = group ? `/settings?group=${group}` : '/settings';
    return await request(url);
  }

  async function getSetting(key) {
    return await request(`/settings/${key}`);
  }

  async function updateSetting(key, value, description = null, groupName = null) {
    return await request(`/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value, description, group_name: groupName })
    });
  }

  async function deleteSetting(key) {
    return await request(`/settings/${key}`, { method: 'DELETE' });
  }

  function getCachedUser() {
    return window.JUFLOW_USER || null;
  }

  // Helper: format money
  function money(cents) {
    return '₱' + (cents / 100).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  // Helper: escape HTML
  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  return {
    // Auth
    request,
    defaultRoute,
    canAccess,
    login,
    logout,
    getCurrentUser,
    changePassword,
    getCachedUser,

    // Users
    getUsers,
    createUser,
    updateUser,
    resetUserPassword,

    // Products
    getProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,

    // Categories
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory,

    // Customers
    getCustomers,
    getCustomer,
    getCustomerOrders: id => request(`/customers/${encodeURIComponent(id)}/orders`),
    createCustomer,
    updateCustomer,

    // Orders
    getOrders,
    getOrder,
    createOrder,
    updateOrder,
    orderAction: (id, data) => request(`/orders/${encodeURIComponent(id)}/actions`, { method: 'POST', body: JSON.stringify(data) }),

    // Riders
    getRiders,
    getRider,
    createRider,
    updateRider,
    deleteRider,

    // Deliveries
    getDeliveries,
    updateDelivery,
    createDelivery: data => request('/deliveries', { method: 'POST', body: JSON.stringify(data) }),
    deliveryEvent: (id, data) => request(`/deliveries/${encodeURIComponent(id)}/events`, { method: 'POST', body: JSON.stringify(data) }),
    confirmDelivery: (id, data) => request(`/deliveries/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: JSON.stringify(data) }),

    // Delivery Zones
    getDeliveryZones,
    getDeliveryZone,
    createDeliveryZone,
    updateDeliveryZone,
    deleteDeliveryZone,

    // Sales
    getSales,
    createSale,

    // Settings
    getSettings,
    getSetting,
    updateSetting,
    deleteSetting,

    // Helpers
    money,
    escape
  };
})();

// JuFlow API Client — Bearer token auth (token stored in localStorage)
const JuAPI = (() => {
  const API_URL = '/api';

  function getToken() {
    return localStorage.getItem('juflow_token');
  }

  function isAuthenticated() {
    return !!getToken();
  }

  // Make authenticated API request
  async function request(endpoint, options = {}) {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
      ...options.headers
    };

    const config = {
      ...options,
      headers
    };

    try {
      const response = await fetch(`${API_URL}${endpoint}`, config);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(error.error || error.message || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // Authentication
  async function login(username, password) {
    const data = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!data.ok) {
      const err = await data.json().catch(() => ({}));
      throw new Error(err.error || err.message || 'Login failed');
    }
    const result = await data.json();
    if (result.token) {
      localStorage.setItem('juflow_token', result.token);
      window.JUFLOW_USER = result.user;
    }
    return result;
  }

  async function logout() {
    await request('/auth/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('juflow_token');
    window.JUFLOW_USER = null;
  }

  async function getCurrentUser() {
    const data = await request('/auth/me');
    window.JUFLOW_USER = data;
    return data;
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
    isAuthenticated,
    getToken,
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
    createCustomer,
    updateCustomer,

    // Orders
    getOrders,
    getOrder,
    createOrder,
    updateOrder,

    // Riders
    getRiders,
    getRider,
    createRider,
    updateRider,
    deleteRider,

    // Deliveries
    getDeliveries,
    updateDelivery,

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

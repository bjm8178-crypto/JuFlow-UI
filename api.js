// JuFlow API integration. Authentication uses the Python cookie session.
const JuAPI = (() => {
  const API_URL = '/api';
  // Session cookies are HttpOnly; no bearer token is exposed to JavaScript.
  function getToken() { return null; }
  function isAuthenticated() { return !!window.JUFLOW_USER; }

  // Make API request
  async function request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    
    const config = {
      ...options,
      credentials: 'same-origin',
      headers
    };
    
    try {
      const response = await fetch(`${API_URL}${endpoint}`, config);
      
      // Unavailable legacy APIs must not invalidate the cookie session.
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
  async function login(email, password) {
    return await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  }

  async function logout() {
    await request('/auth/logout', { method: 'POST' });
    window.JUFLOW_USER = null;
  }

  async function getCurrentUser() {
    const data = await request('/auth/me');
    window.JUFLOW_USER = data.user;
    return data.user;
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
    return await request(`/riders/${id}`, {
      method: 'DELETE'
    });
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
    return await request(`/delivery-zones/${id}`, {
      method: 'DELETE'
    });
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
    return await request(`/settings/${key}`, {
      method: 'DELETE'
    });
  }
  
  // User confirmed by the server for this page load
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
  
  // Public API
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
    
    // Riders
    getRiders,
    getRider,
    createRider,
    updateRider,
    deleteRider,
    
    // Delivery Zones
    getDeliveryZones,
    getDeliveryZone,
    createDeliveryZone,
    updateDeliveryZone,
    deleteDeliveryZone,
    
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

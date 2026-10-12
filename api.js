// JuFlow API Integration - Connects frontend to MongoDB backend
const JuAPI = (() => {
  const API_URL = 'http://localhost:3000/api';
  let authToken = localStorage.getItem('juflow_auth_token');
  
  // Get auth token
  function getToken() {
    return authToken;
  }
  
  // Check if user is logged in
  function isAuthenticated() {
    return !!authToken;
  }
  
  // Make API request
  async function request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const config = {
      ...options,
      headers
    };
    
    try {
      const response = await fetch(`${API_URL}${endpoint}`, config);
      
      // Handle 401 - token expired
      if (response.status === 401) {
        logout();
        window.location.href = 'index.html';
        throw new Error('Session expired. Please login again.');
      }
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(error.message || `HTTP ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }
  
  // Authentication
  async function login(username, password) {
    const data = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    
    authToken = data.token;
    localStorage.setItem('juflow_auth_token', authToken);
    localStorage.setItem('juflow_user', JSON.stringify(data.user));
    
    return data;
  }
  
  async function logout() {
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch (e) {
      // Ignore errors on logout
    }
    
    authToken = null;
    localStorage.removeItem('juflow_auth_token');
    localStorage.removeItem('juflow_user');
  }
  
  async function getCurrentUser() {
    return await request('/auth/me');
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
  
  // Helper to get current user from localStorage
  function getCachedUser() {
    const user = localStorage.getItem('juflow_user');
    return user ? JSON.parse(user) : null;
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

// Protect dashboard pages - redirect to login if not authenticated
if (window.location.pathname.includes('dashboard.html') || 
    window.location.pathname.includes('orders.html') ||
    window.location.pathname.includes('delivery-map.html') ||
    window.location.pathname.includes('customers.html') ||
    window.location.pathname.includes('sales.html')) {
  
  if (!JuAPI.isAuthenticated()) {
    window.location.href = 'index.html';
  }
}

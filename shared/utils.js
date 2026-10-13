// Juki Mobile Apps - Shared Utilities
// Common functions and helpers for both Cashier and Rider apps

(function(window) {
  'use strict';

  const JuFlowShared = {};

  // ============================================
  // CURRENCY FORMATTING
  // ============================================
  
  /**
   * Format centavos to Philippine peso string
   * @param {number} centavos - Amount in centavos (1 peso = 100 centavos)
   * @returns {string} Formatted peso string (e.g., "₱125.50")
   */
  JuFlowShared.formatPeso = function(centavos) {
    if (centavos == null || isNaN(centavos)) return '₱0.00';
    const pesos = centavos / 100;
    return '₱' + pesos.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  /**
   * Parse peso string to centavos
   * @param {string} pesoString - Peso string (e.g., "125.50" or "₱125.50")
   * @returns {number} Amount in centavos
   */
  JuFlowShared.parsePeso = function(pesoString) {
    if (!pesoString) return 0;
    const cleaned = pesoString.toString().replace(/[₱,\s]/g, '');
    const pesos = parseFloat(cleaned) || 0;
    return Math.round(pesos * 100);
  };

  // ============================================
  // DATE & TIME FORMATTING
  // ============================================

  /**
   * Format date to Philippine locale
   * @param {Date|string} date - Date object or ISO string
   * @param {object} options - Intl.DateTimeFormat options
   * @returns {string} Formatted date string
   */
  JuFlowShared.formatDate = function(date, options = {}) {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';
    
    const defaults = {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    };
    
    return d.toLocaleDateString('en-PH', { ...defaults, ...options });
  };

  /**
   * Format time to Philippine locale
   * @param {Date|string} date - Date object or ISO string
   * @param {object} options - Intl.DateTimeFormat options
   * @returns {string} Formatted time string
   */
  JuFlowShared.formatTime = function(date, options = {}) {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';
    
    const defaults = {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    };
    
    return d.toLocaleTimeString('en-PH', { ...defaults, ...options });
  };

  /**
   * Format date and time together
   * @param {Date|string} date - Date object or ISO string
   * @returns {string} Formatted datetime string
   */
  JuFlowShared.formatDateTime = function(date) {
    return JuFlowShared.formatDate(date) + ' ' + JuFlowShared.formatTime(date);
  };

  /**
   * Get relative time string (e.g., "2 hours ago")
   * @param {Date|string} date - Date object or ISO string
   * @returns {string} Relative time string
   */
  JuFlowShared.relativeTime = function(date) {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';
    
    const now = new Date();
    const diffMs = now - d;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    
    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return diffMin + ' min ago';
    if (diffHr < 24) return diffHr + ' hr ago';
    if (diffDay < 7) return diffDay + ' day' + (diffDay !== 1 ? 's' : '') + ' ago';
    
    return JuFlowShared.formatDate(d);
  };

  // ============================================
  // UUID GENERATION
  // ============================================

  /**
   * Generate RFC4122 v4 UUID
   * @returns {string} UUID string
   */
  JuFlowShared.uuid = function() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  // ============================================
  // STORAGE HELPERS
  // ============================================

  /**
   * Safe localStorage getItem with JSON parsing
   * @param {string} key - Storage key
   * @param {*} defaultValue - Default value if key doesn't exist
   * @returns {*} Parsed value or default
   */
  JuFlowShared.getStorage = function(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (err) {
      console.warn('Storage get error:', err);
      return defaultValue;
    }
  };

  /**
   * Safe localStorage setItem with JSON stringification
   * @param {string} key - Storage key
   * @param {*} value - Value to store
   * @returns {boolean} Success status
   */
  JuFlowShared.setStorage = function(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn('Storage set error:', err);
      return false;
    }
  };

  /**
   * Remove item from localStorage
   * @param {string} key - Storage key
   */
  JuFlowShared.removeStorage = function(key) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.warn('Storage remove error:', err);
    }
  };

  /**
   * Clear all localStorage items with given prefix
   * @param {string} prefix - Key prefix to match
   */
  JuFlowShared.clearStoragePrefix = function(prefix) {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach((key) => {
        if (key.startsWith(prefix)) {
          localStorage.removeItem(key);
        }
      });
    } catch (err) {
      console.warn('Storage clear error:', err);
    }
  };

  // ============================================
  // NETWORK UTILITIES
  // ============================================

  /**
   * Check if device is online
   * @returns {boolean} Online status
   */
  JuFlowShared.isOnline = function() {
    return navigator.onLine;
  };

  /**
   * Exponential backoff delay calculator
   * @param {number} attempt - Attempt number (0-based)
   * @param {number} baseDelay - Base delay in ms (default 1000)
   * @returns {number} Delay in milliseconds
   */
  JuFlowShared.backoffDelay = function(attempt, baseDelay = 1000) {
    const maxDelay = 30000; // 30 seconds max
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    const jitter = Math.random() * 0.3 * delay; // 0-30% jitter
    return Math.floor(delay + jitter);
  };

  /**
   * Retry a promise-returning function with exponential backoff
   * @param {Function} fn - Promise-returning function
   * @param {number} maxRetries - Maximum retry attempts
   * @param {number} baseDelay - Base delay in ms
   * @returns {Promise} Result of fn
   */
  JuFlowShared.retry = async function(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        
        if (attempt < maxRetries) {
          const delay = JuFlowShared.backoffDelay(attempt, baseDelay);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  };

  // ============================================
  // VALIDATION
  // ============================================

  /**
   * Validate Philippine mobile number
   * @param {string} phone - Phone number
   * @returns {boolean} Valid status
   */
  JuFlowShared.isValidPhone = function(phone) {
    if (!phone) return false;
    // Philippine mobile: 09XX-XXX-XXXX or +639XX-XXX-XXXX
    const cleaned = phone.replace(/[\s-]/g, '');
    return /^(09|\+639)\d{9}$/.test(cleaned);
  };

  /**
   * Validate email address
   * @param {string} email - Email address
   * @returns {boolean} Valid status
   */
  JuFlowShared.isValidEmail = function(email) {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  // ============================================
  // DOM UTILITIES
  // ============================================

  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} Escaped HTML
   */
  JuFlowShared.escapeHtml = function(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  /**
   * Debounce function calls
   * @param {Function} fn - Function to debounce
   * @param {number} delay - Delay in milliseconds
   * @returns {Function} Debounced function
   */
  JuFlowShared.debounce = function(fn, delay = 300) {
    let timeoutId;
    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
  };

  /**
   * Throttle function calls
   * @param {Function} fn - Function to throttle
   * @param {number} limit - Minimum time between calls
   * @returns {Function} Throttled function
   */
  JuFlowShared.throttle = function(fn, limit = 300) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        fn.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  };

  // ============================================
  // DEVICE UTILITIES
  // ============================================

  /**
   * Check if running as installed PWA
   * @returns {boolean} Installed status
   */
  JuFlowShared.isInstalled = function() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  };

  /**
   * Check if device is iOS
   * @returns {boolean} iOS status
   */
  JuFlowShared.isIOS = function() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
  };

  /**
   * Check if device is Android
   * @returns {boolean} Android status
   */
  JuFlowShared.isAndroid = function() {
    return /Android/.test(navigator.userAgent);
  };

  /**
   * Trigger haptic feedback (if available)
   * @param {string} type - 'light', 'medium', 'heavy'
   */
  JuFlowShared.haptic = function(type = 'medium') {
    if (!navigator.vibrate) return;
    
    const patterns = {
      light: [10],
      medium: [30],
      heavy: [50],
      success: [10, 50, 10],
      error: [50, 100, 50]
    };
    
    navigator.vibrate(patterns[type] || patterns.medium);
  };

  // ============================================
  // TOAST NOTIFICATIONS
  // ============================================

  /**
   * Show toast notification
   * @param {string} message - Toast message
   * @param {string} type - 'info', 'success', 'warning', 'error'
   * @param {number} duration - Duration in ms (default 3000)
   */
  JuFlowShared.toast = function(message, type = 'info', duration = 3000) {
    const toastContainer = document.getElementById('toast-container') || createToastContainer();
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      background: ${getToastColor(type)};
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      margin-top: 8px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.2);
      animation: slideIn 0.3s ease-out;
    `;
    
    toastContainer.appendChild(toast);
    
    // Haptic feedback
    if (type === 'success') JuFlowShared.haptic('success');
    if (type === 'error') JuFlowShared.haptic('error');
    
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  };

  function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position: fixed;
      top: calc(env(safe-area-inset-top) + 16px);
      right: 16px;
      left: 16px;
      z-index: 9999;
      pointer-events: none;
    `;
    document.body.appendChild(container);
    
    // Add animations
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateY(-100px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateY(0); opacity: 1; }
        to { transform: translateY(-100px); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
    
    return container;
  }

  function getToastColor(type) {
    const colors = {
      info: '#1976d2',
      success: '#2e7d32',
      warning: '#f57c00',
      error: '#c62828'
    };
    return colors[type] || colors.info;
  }

  // ============================================
  // EXPORT
  // ============================================

  window.JuFlowShared = JuFlowShared;

})(window);

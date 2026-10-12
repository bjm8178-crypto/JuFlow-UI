// JuFlow Mobile Apps - Network Manager
// Handles API calls with offline queuing, retry logic, and conflict detection

(function(window) {
  'use strict';

  const API_BASE = '/api';
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [1000, 3000, 5000]; // Exponential backoff
  const REQUEST_TIMEOUT = 15000; // 15 seconds

  class NetworkManager {
    constructor() {
      this.online = navigator.onLine;
      this.listeners = [];
      this.setupEventListeners();
    }

    setupEventListeners() {
      window.addEventListener('online', () => {
        console.log('[Network] Connection restored');
        this.online = true;
        this.notifyListeners('online');
      });

      window.addEventListener('offline', () => {
        console.log('[Network] Connection lost');
        this.online = false;
        this.notifyListeners('offline');
      });
    }

    /**
     * Register connection status listener
     * @param {Function} callback - Called with 'online' or 'offline'
     */
    onConnectionChange(callback) {
      this.listeners.push(callback);
      return () => {
        this.listeners = this.listeners.filter(cb => cb !== callback);
      };
    }

    notifyListeners(status) {
      this.listeners.forEach(cb => {
        try {
          cb(status);
        } catch (err) {
          console.error('[Network] Listener error:', err);
        }
      });
    }

    /**
     * Check if online
     * @returns {boolean}
     */
    isOnline() {
      return this.online;
    }

    /**
     * Make API request with timeout and retry
     * @param {string} endpoint - API endpoint (e.g., '/sales')
     * @param {object} options - Fetch options
     * @param {number} retries - Retry attempts remaining
     * @returns {Promise<Response>}
     */
    async fetchWithRetry(endpoint, options = {}, retries = MAX_RETRIES) {
      const url = `${API_BASE}${endpoint}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const fetchOptions = {
        ...options,
        credentials: 'include',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      };

      try {
        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);
        return response;
      } catch (err) {
        clearTimeout(timeoutId);

        // Don't retry aborted requests or when offline
        if (err.name === 'AbortError') {
          throw new Error('Request timeout');
        }

        if (!this.online) {
          throw new Error('Network unavailable');
        }

        // Retry on network errors
        if (retries > 0) {
          const delay = RETRY_DELAYS[MAX_RETRIES - retries] || 5000;
          console.log(`[Network] Retrying in ${delay}ms... (${retries} left)`);
          await this.sleep(delay);
          return this.fetchWithRetry(endpoint, options, retries - 1);
        }

        throw err;
      }
    }

    /**
     * Parse response with error handling
     * @param {Response} response - Fetch response
     * @returns {Promise<object>}
     */
    async parseResponse(response) {
      const contentType = response.headers.get('content-type');
      
      if (contentType?.includes('application/json')) {
        return await response.json();
      }

      const text = await response.text();
      return { text };
    }

    /**
     * Handle API errors
     * @param {Response} response - Fetch response
     * @returns {Promise<never>}
     */
    async handleError(response) {
      const data = await this.parseResponse(response);
      
      const error = new Error(data.message || data.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;

      switch (response.status) {
        case 400:
          error.message = data.message || 'Invalid request';
          break;
        case 401:
          error.message = 'Authentication required';
          error.authError = true;
          break;
        case 403:
          error.message = 'Access denied';
          break;
        case 404:
          error.message = 'Not found';
          break;
        case 409:
          error.message = data.message || 'Conflict detected';
          error.conflict = true;
          break;
        case 422:
          error.message = data.message || 'Validation failed';
          error.validationErrors = data.errors || [];
          break;
        case 429:
          error.message = 'Too many requests';
          error.retryAfter = response.headers.get('Retry-After');
          break;
        case 500:
        case 502:
        case 503:
        case 504:
          error.message = 'Server error - please try again';
          error.serverError = true;
          break;
      }

      throw error;
    }

    /**
     * GET request
     * @param {string} endpoint - API endpoint
     * @param {object} options - Additional options
     * @returns {Promise<object>}
     */
    async get(endpoint, options = {}) {
      const response = await this.fetchWithRetry(endpoint, {
        method: 'GET',
        ...options
      });

      if (!response.ok) {
        return this.handleError(response);
      }

      return this.parseResponse(response);
    }

    /**
     * POST request
     * @param {string} endpoint - API endpoint
     * @param {object} body - Request body
     * @param {object} options - Additional options
     * @returns {Promise<object>}
     */
    async post(endpoint, body, options = {}) {
      const response = await this.fetchWithRetry(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
        ...options
      });

      if (!response.ok) {
        return this.handleError(response);
      }

      return this.parseResponse(response);
    }

    /**
     * PATCH request
     * @param {string} endpoint - API endpoint
     * @param {object} body - Request body
     * @param {object} options - Additional options
     * @returns {Promise<object>}
     */
    async patch(endpoint, body, options = {}) {
      const response = await this.fetchWithRetry(endpoint, {
        method: 'PATCH',
        body: JSON.stringify(body),
        ...options
      });

      if (!response.ok) {
        return this.handleError(response);
      }

      return this.parseResponse(response);
    }

    /**
     * DELETE request
     * @param {string} endpoint - API endpoint
     * @param {object} options - Additional options
     * @returns {Promise<object>}
     */
    async delete(endpoint, options = {}) {
      const response = await this.fetchWithRetry(endpoint, {
        method: 'DELETE',
        ...options
      });

      if (!response.ok) {
        return this.handleError(response);
      }

      return this.parseResponse(response);
    }

    /**
     * Upload file with multipart/form-data
     * @param {string} endpoint - API endpoint
     * @param {FormData} formData - Form data
     * @returns {Promise<object>}
     */
    async upload(endpoint, formData) {
      const url = `${API_BASE}${endpoint}`;

      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        body: formData
        // Don't set Content-Type - browser will set it with boundary
      });

      if (!response.ok) {
        return this.handleError(response);
      }

      return this.parseResponse(response);
    }

    /**
     * Sleep utility
     * @param {number} ms - Milliseconds
     * @returns {Promise<void>}
     */
    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  }

  // Outbox sync manager
  class OutboxManager {
    constructor(networkManager, db) {
      this.network = networkManager;
      this.db = db;
      this.syncing = false;
      this.syncListeners = [];

      // Auto-sync when connection restored
      this.network.onConnectionChange((status) => {
        if (status === 'online' && !this.syncing) {
          setTimeout(() => this.syncAll(), 2000);
        }
      });
    }

    /**
     * Register sync status listener
     * @param {Function} callback - Called with sync status
     */
    onSyncStatus(callback) {
      this.syncListeners.push(callback);
      return () => {
        this.syncListeners = this.syncListeners.filter(cb => cb !== callback);
      };
    }

    notifySyncListeners(status) {
      this.syncListeners.forEach(cb => {
        try {
          cb(status);
        } catch (err) {
          console.error('[Outbox] Listener error:', err);
        }
      });
    }

    /**
     * Sync all queued items
     * @param {string} userId - User ID
     * @returns {Promise<object>} Sync results
     */
    async syncAll(userId) {
      if (this.syncing) {
        console.log('[Outbox] Sync already in progress');
        return { skipped: true };
      }

      if (!this.network.isOnline()) {
        console.log('[Outbox] Offline - skipping sync');
        return { skipped: true };
      }

      this.syncing = true;
      this.notifySyncListeners({ status: 'syncing' });

      const results = {
        salesSynced: 0,
        salesFailed: 0,
        eventsSynced: 0,
        eventsFailed: 0,
        errors: []
      };

      try {
        // Sync sales
        const sales = await this.db.getQueuedSales(userId);
        console.log(`[Outbox] Syncing ${sales.length} queued sales...`);

        for (const sale of sales) {
          try {
            await this.network.post('/sales', sale.data);
            await this.db.removeSale(sale.id);
            results.salesSynced++;
          } catch (err) {
            console.error('[Outbox] Failed to sync sale:', err);
            results.salesFailed++;
            results.errors.push({ type: 'sale', id: sale.id, error: err.message });

            // Remove if conflict or validation error (not retryable)
            if (err.status === 409 || err.status === 422) {
              await this.db.removeSale(sale.id);
            }
          }
        }

        // Sync delivery events
        const events = await this.db.getQueuedDeliveryEvents(userId);
        console.log(`[Outbox] Syncing ${events.length} queued delivery events...`);

        for (const event of events) {
          try {
            await this.network.post(
              `/deliveries/${event.deliveryId}/events`,
              event.data
            );
            await this.db.removeDeliveryEvent(event.id);
            results.eventsSynced++;
          } catch (err) {
            console.error('[Outbox] Failed to sync event:', err);
            results.eventsFailed++;
            results.errors.push({ type: 'event', id: event.id, error: err.message });

            // Remove if conflict or validation error
            if (err.status === 409 || err.status === 422) {
              await this.db.removeDeliveryEvent(event.id);
            }
          }
        }

        this.notifySyncListeners({ status: 'complete', results });
        return results;

      } catch (err) {
        console.error('[Outbox] Sync error:', err);
        this.notifySyncListeners({ status: 'error', error: err.message });
        throw err;
      } finally {
        this.syncing = false;
      }
    }

    /**
     * Get sync status
     * @param {string} userId - User ID
     * @returns {Promise<object>}
     */
    async getStatus(userId) {
      const stats = await this.db.getStats();
      return {
        queuedSales: stats.queuedSales,
        queuedEvents: stats.queuedEvents,
        syncing: this.syncing,
        online: this.network.isOnline()
      };
    }

    /**
     * Clear all queued items for user
     * @param {string} userId - User ID
     * @returns {Promise<object>}
     */
    async clearQueue(userId) {
      const salesCleared = await this.db.clearSales(userId);
      const eventsCleared = await this.db.clearDeliveryEvents(userId);
      
      return {
        salesCleared,
        eventsCleared,
        total: salesCleared + eventsCleared
      };
    }
  }

  // Create singleton instances
  const networkManager = new NetworkManager();
  const outboxManager = new OutboxManager(networkManager, window.JuFlowDB);

  // Export to window
  window.JuFlowNetwork = {
    // Network manager
    network: networkManager,
    
    // Outbox manager
    outbox: outboxManager,

    // Convenience methods
    isOnline: () => networkManager.isOnline(),
    
    onConnectionChange: (callback) => networkManager.onConnectionChange(callback),
    
    onSyncStatus: (callback) => outboxManager.onSyncStatus(callback),

    // API shortcuts
    get: (endpoint, options) => networkManager.get(endpoint, options),
    post: (endpoint, body, options) => networkManager.post(endpoint, body, options),
    patch: (endpoint, body, options) => networkManager.patch(endpoint, body, options),
    delete: (endpoint, options) => networkManager.delete(endpoint, options),
    upload: (endpoint, formData) => networkManager.upload(endpoint, formData),

    // Sync shortcuts
    syncAll: (userId) => outboxManager.syncAll(userId),
    getSyncStatus: (userId) => outboxManager.getStatus(userId),
    clearQueue: (userId) => outboxManager.clearQueue(userId)
  };

  console.log('[Network] Network manager loaded');

})(window);

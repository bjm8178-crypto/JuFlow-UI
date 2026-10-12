// JuFlow Rider App - Main Application Logic
// Hash-based routing with delivery management

(function() {
  'use strict';

  // State management
  const state = {
    user: null,
    isOnline: navigator.onLine,
    currentRoute: null,
    deliveries: [],
    isAvailable: true,
    locationSharing: false,
    lastLocation: null,
    watchId: null,
    installPromptEvent: null,
    wakeLock: null
  };

  // DOM references
  const $$ = {
    connectingScreen: document.getElementById('connecting-screen'),
    loginScreen: document.getElementById('login-screen'),
    appShell: document.getElementById('app-shell'),
    appMain: document.getElementById('app-main'),
    bottomNav: document.getElementById('bottom-nav'),
    headerTitle: document.getElementById('header-title'),
    headerSubtitle: document.getElementById('header-subtitle'),
    connectivityStatus: document.getElementById('connectivity-status'),
    refreshBtn: document.getElementById('refresh-btn'),
    loginUsername: document.getElementById('login-username'),
    loginPassword: document.getElementById('login-password'),
    loginError: document.getElementById('login-error'),
    installPromptBtn: document.getElementById('install-prompt-btn')
  };

  // API wrapper
  const api = {
    async call(endpoint, options = {}) {
      const url = `/api${endpoint}`;
      const config = {
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        ...options
      };

      try {
        const response = await fetch(url, config);
        const data = await response.json().catch(() => ({}));
        
        if (!response.ok) {
          const error = new Error(data.message || `HTTP ${response.status}`);
          error.status = response.status;
          error.data = data;
          throw error;
        }
        
        return data;
      } catch (err) {
        if (!navigator.onLine) {
          err.offline = true;
        }
        throw err;
      }
    },

    async get(endpoint) {
      return this.call(endpoint, { method: 'GET' });
    },

    async post(endpoint, body) {
      return this.call(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
      });
    },

    async patch(endpoint, body) {
      return this.call(endpoint, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
    }
  };

  // Authentication
  const auth = {
    async checkSession() {
      try {
        const response = await api.get('/auth/me');
        state.user = response.user;
        
        // Check if user has rider role
        if (state.user.role_name !== 'rider') {
          throw new Error('This account cannot access the rider app');
        }
        
        // Store user info for offline display
        localStorage.setItem('juflow:rider:user', JSON.stringify({
          name: state.user.full_name || state.user.username,
          id: state.user._id
        }));
        
        return state.user;
      } catch (err) {
        state.user = null;
        throw err;
      }
    },

    async login(username, password) {
      const response = await api.post('/auth/login', { username, password });
      state.user = response.user;
      
      if (state.user.role_name !== 'rider') {
        await this.logout();
        throw new Error('This account cannot access the rider app');
      }
      
      localStorage.setItem('juflow:rider:user', JSON.stringify({
        name: state.user.full_name || state.user.username,
        id: state.user._id
      }));
      
      return state.user;
    },

    async logout() {
      try {
        await api.post('/auth/logout', {});
      } catch (err) {
        console.warn('Logout request failed:', err);
      }
      
      state.user = null;
      
      // Check if there are unsent items
      const queueSize = await outbox.getCount();
      
      if (queueSize > 0) {
        const keep = confirm(
          `You have ${queueSize} unsent delivery events.\n\n` +
          `Keep them? (Cancel to discard)`
        );
        
        if (!keep) {
          await outbox.clear();
        }
      }
      
      // Clear cached jobs (contains customer data)
      localStorage.removeItem(`juflow:rider:jobs:${state.user?._id || 'unknown'}`);
      localStorage.removeItem('juflow:rider:user');
      
      // Stop location sharing
      if (state.locationSharing) {
        location.stopSharing();
      }
      
      showLogin();
      return true;
    }
  };

  // Outbox/Queue management using IndexedDB
  const outbox = {
    db: null,

    async init() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('juflow-rider', 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          this.db = request.result;
          resolve();
        };
        
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          
          if (!db.objectStoreNames.contains('events')) {
            const store = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
            store.createIndex('user_id', 'user_id', { unique: false });
            store.createIndex('delivery_id', 'delivery_id', { unique: false });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };
      });
    },

    async add(event) {
      if (!this.db) await this.init();
      
      const tx = this.db.transaction(['events'], 'readwrite');
      const store = tx.objectStore('events');
      
      const record = {
        ...event,
        user_id: state.user?._id || 'unknown',
        timestamp: Date.now(),
        retries: 0
      };
      
      return new Promise((resolve, reject) => {
        const request = store.add(record);
        request.onsuccess = () => resolve(record);
        request.onerror = () => reject(request.error);
      });
    },

    async getAll() {
      if (!this.db) await this.init();
      
      const tx = this.db.transaction(['events'], 'readonly');
      const store = tx.objectStore('events');
      
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    },

    async remove(id) {
      if (!this.db) await this.init();
      
      const tx = this.db.transaction(['events'], 'readwrite');
      const store = tx.objectStore('events');
      
      return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    },

    async getCount() {
      if (!this.db) await this.init();
      
      const tx = this.db.transaction(['events'], 'readonly');
      const store = tx.objectStore('events');
      
      return new Promise((resolve, reject) => {
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    },

    async clear() {
      if (!this.db) await this.init();
      
      const tx = this.db.transaction(['events'], 'readwrite');
      const store = tx.objectStore('events');
      
      return new Promise((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    },

    async flush() {
      const pending = await this.getAll();
      const results = { synced: 0, failed: 0, blocked: [], errors: [] };
      
      for (const item of pending) {
        try {
          await api.post(`/orders/${item.order_id}/status`, { status: item.status });
          await this.remove(item.id);
          results.synced++;
        } catch (err) {
          // Version conflict or validation error - mark as blocked
          if (err.status === 409) {
            results.blocked.push({ item, error: err.message });
            results.failed++;
          }
          // Don't retry client errors (except auth and rate limits)
          else if (err.status >= 400 && err.status < 500 && 
              err.status !== 401 && err.status !== 429) {
            await this.remove(item.id);
            results.errors.push({ item, error: err.message });
          } else {
            results.failed++;
          }
        }
      }
      
      updateConnectivityStatus();
      return results;
    }
  };

  // Location tracking
  const location = {
    startSharing() {
      if (!navigator.geolocation) {
        alert('Location services not available on this device');
        return false;
      }

      if (state.watchId) return true; // Already watching

      state.watchId = navigator.geolocation.watchPosition(
        (position) => {
          state.lastLocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: new Date().toISOString()
          };
          
          // Auto-send location update for active deliveries
          this.sendLocationUpdate();
        },
        (error) => {
          console.error('Location error:', error);
          state.lastLocation = null;
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 5000
        }
      );

      state.locationSharing = true;
      localStorage.setItem('juflow:rider:location-sharing', 'true');
      
      // Request wake lock for active deliveries
      this.requestWakeLock();
      
      return true;
    },

    stopSharing() {
      if (state.watchId) {
        navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
      }
      
      state.locationSharing = false;
      state.lastLocation = null;
      localStorage.removeItem('juflow:rider:location-sharing');
      
      // Release wake lock
      this.releaseWakeLock();
    },

    async sendLocationUpdate() {
      if (!state.lastLocation || !state.user) return;

      try {
        await api.post('/riders/me/location', {
          latitude: state.lastLocation.latitude,
          longitude: state.lastLocation.longitude,
          accuracy: state.lastLocation.accuracy,
          timestamp: state.lastLocation.timestamp
        });
      } catch (err) {
        console.warn('Failed to send location update:', err);
      }
    },

    async requestWakeLock() {
      if ('wakeLock' in navigator) {
        try {
          state.wakeLock = await navigator.wakeLock.request('screen');
          console.log('Wake lock acquired');
        } catch (err) {
          console.warn('Wake lock failed:', err);
        }
      }
    },

    releaseWakeLock() {
      if (state.wakeLock) {
        state.wakeLock.release();
        state.wakeLock = null;
        console.log('Wake lock released');
      }
    }
  };

  // Connectivity management
  function updateConnectivityStatus() {
    outbox.getCount().then(count => {
      if (count > 0) {
        $$.connectivityStatus.textContent = `${count} unsent`;
        $$.connectivityStatus.className = 'pill warning';
      } else if (state.isOnline) {
        $$.connectivityStatus.textContent = '● online';
        $$.connectivityStatus.className = 'pill success';
      } else {
        $$.connectivityStatus.textContent = 'offline';
        $$.connectivityStatus.className = 'pill error';
      }
    });
  }

  window.addEventListener('online', () => {
    state.isOnline = true;
    updateConnectivityStatus();
    outbox.flush();
  });

  window.addEventListener('offline', () => {
    state.isOnline = false;
    updateConnectivityStatus();
  });

  // Periodic sync
  setInterval(() => {
    if (state.isOnline && state.user) {
      outbox.flush();
    }
  }, 15000);

  // Screen management
  function showConnecting() {
    $$.connectingScreen.style.display = 'block';
    $$.loginScreen.style.display = 'none';
    $$.appShell.style.display = 'none';
  }

  function showLogin() {
    $$.connectingScreen.style.display = 'none';
    $$.loginScreen.style.display = 'block';
    $$.appShell.style.display = 'none';
    
    // Show cached user name if available
    const cached = localStorage.getItem('juflow:rider:user');
    if (cached) {
      try {
        const data = JSON.parse(cached);
        $$.loginUsername.placeholder = `Welcome back, ${data.name}`;
      } catch (e) {}
    }
  }

  function showApp() {
    $$.connectingScreen.style.display = 'none';
    $$.loginScreen.style.display = 'none';
    $$.appShell.style.display = 'flex';
    
    // Update header with user info
    if (state.user) {
      $$.headerSubtitle.textContent = state.user.full_name || state.user.username;
    }
    
    updateConnectivityStatus();
    
    // Restore location sharing preference
    const locationPref = localStorage.getItem('juflow:rider:location-sharing');
    if (locationPref === 'true') {
      location.startSharing();
    }
    
    router.navigate(window.location.hash || '#/jobs');
  }

  // Login form handler
  $$.loginScreen.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = $$.loginUsername.value.trim();
    const password = $$.loginPassword.value;
    
    if (!username || !password) {
      $$.loginError.textContent = 'Please enter username and password';
      return;
    }
    
    $$.loginError.textContent = '';
    $$.loginScreen.querySelector('button[type="submit"]').disabled = true;
    
    try {
      await auth.login(username, password);
      $$.loginPassword.value = '';
      await outbox.init();
      showApp();
    } catch (err) {
      $$.loginError.textContent = err.message || 'Login failed';
      $$.loginScreen.querySelector('button[type="submit"]').disabled = false;
    }
  });

  // Refresh button
  $$.refreshBtn.addEventListener('click', () => {
    router.navigate(window.location.hash || state.currentRoute || '#/jobs');
  });

  // PWA Install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPromptEvent = e;
    $$.installPromptBtn.style.display = 'block';
  });

  $$.installPromptBtn.addEventListener('click', async () => {
    if (!state.installPromptEvent) return;
    
    state.installPromptEvent.prompt();
    const result = await state.installPromptEvent.userChoice;
    
    if (result.outcome === 'accepted') {
      $$.installPromptBtn.style.display = 'none';
    }
    
    state.installPromptEvent = null;
  });

  // Router
  const router = {
    routes: {},
    
    register(path, handler) {
      this.routes[path] = handler;
    },
    
    navigate(hash) {
      const path = hash.replace('#', '') || '/jobs';
      const handler = this.routes[path];
      
      if (handler) {
        state.currentRoute = path;
        
        // Update active tab
        document.querySelectorAll('.tabbar a').forEach(a => {
          a.classList.toggle('active', a.getAttribute('href') === `#${path}`);
        });
        
        // Render route
        handler();
      } else {
        this.navigate('#/jobs');
      }
    }
  };

  window.addEventListener('hashchange', () => {
    router.navigate(window.location.hash);
  });

  // Route modules are loaded by index.html as deferred scripts.
  // Do not dynamically import them again; duplicate listeners can send duplicate updates.

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const appRoot = window.location.pathname.startsWith('/rider/') ? '/rider/' : '/';
    navigator.serviceWorker.register(appRoot + 'sw.js', { scope: appRoot })
      .catch(error => console.warn('Rider service worker registration failed', error));
  }

  // App initialization
  async function init() {
    showConnecting();
    registerServiceWorker();
    
    try {
      await outbox.init();
      await auth.checkSession();
      showApp();
    } catch (err) {
      console.warn('Session check failed:', err);
      showLogin();
    }
  }

  // Start app when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose global API
  window.JuFlowRider = {
    state,
    api,
    auth,
    outbox,
    location,
    router,
    showLogin,
    showApp,
    updateConnectivityStatus
  };

})();

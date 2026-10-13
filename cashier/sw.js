// Juki Cashier App - Service Worker
// Offline-first caching strategy for PWA

const CACHE_VERSION = 'v6-juki';
const CACHE_NAME = `juflow-cashier-${CACHE_VERSION}`;

// Files to precache (app shell)
const PRECACHE_FILES = [
  '/cashier/',
  '/cashier/index.html',
  '/cashier/app.js',
  '/cashier/boot.js',
  '/cashier/cashier.css',
  '/cashier/pos.js',
  '/cashier/orders.js',
  '/cashier/new-order.js',
  '/cashier/today.js',
  '/cashier/me.js',
  '/cashier/manifest.webmanifest',
  '/shared/styles.css',

  '/icons/cashier-192.png',
  '/icons/cashier-512.png',
  '/icons/cashier-maskable-512.png'
];

// Install event - precache app shell
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Precaching app shell');
        return cache.addAll(PRECACHE_FILES);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating new service worker...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith('juflow-cashier-') && name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - network-first for navigations, cache strategies for resources
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API requests (except specific exceptions)
  if (url.pathname.startsWith('/api/')) {
    // Exception: Cache menu for offline display
    if (url.pathname === '/api/menu/today' && request.method === 'GET') {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, clone);
              });
            }
            return response;
          })
          .catch(() => {
            return caches.match(request).then((cached) => {
              if (cached) {
                return cached;
              }
              return new Response(
                JSON.stringify({ error: 'Offline', dishes: [] }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
              );
            });
          })
      );
      return;
    }

    // All other API requests: network only
    event.respondWith(fetch(request));
    return;
  }

  // Navigation requests: network-first with timeout, fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      Promise.race([
        fetch(request),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Network timeout')), 3000)
        )
      ])
        .then((response) => {
          // Update cache with fresh response
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cached shell
          return caches.match('/cashier/index.html').then((cached) => {
            if (cached) {
              return cached;
            }
            return new Response(
              '<html><body><h1>Offline</h1><p>Please check your connection.</p></body></html>',
              { status: 503, headers: { 'Content-Type': 'text/html' } }
            );
          });
        })
    );
    return;
  }

  // Static assets: stale-while-revalidate
  if (request.destination === 'script' || 
      request.destination === 'style' || 
      request.destination === 'image') {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        });

        return cached || fetchPromise;
      })
    );
    return;
  }

  // Default: network-first
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Message event - handle update notifications
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Periodic background sync (if available)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-sales') {
    event.waitUntil(
      // Trigger outbox flush via broadcast
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'BACKGROUND_SYNC',
            action: 'flush-outbox'
          });
        });
      })
    );
  }
});

// Push notification (for Phase 4)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  
  const options = {
    body: data.body || 'New notification',
    icon: '/icons/cashier-192.png',
    badge: '/icons/cashier-192.png',
    tag: data.tag || 'juflow-cashier',
    data: data.url ? { url: data.url } : undefined,
    requireInteraction: data.requireInteraction || false,
    vibrate: [200, 100, 200]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Juki Cashier', options)
  );
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/cashier/#/orders';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing window if available
        for (const client of clientList) {
          if (client.url.includes('/cashier/') && 'focus' in client) {
            return client.focus().then(() => {
              if ('navigate' in client) {
                return client.navigate(urlToOpen);
              }
            });
          }
        }
        
        // Open new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
  );
});

console.log('[SW] Service worker script loaded');

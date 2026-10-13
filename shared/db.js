// Juki Mobile Apps - IndexedDB Wrapper
// Simplified IndexedDB operations for outbox queuing

(function(window) {
  'use strict';

  const DB_NAME = 'juflow-mobile';
  const DB_VERSION = 1;
  
  // Store names
  const STORES = {
    SALES_OUTBOX: 'sales-outbox',
    DELIVERY_EVENTS_OUTBOX: 'delivery-events-outbox',
    CACHED_MENU: 'cached-menu',
    CACHED_DELIVERIES: 'cached-deliveries',
    CACHED_CUSTOMERS: 'cached-customers',
    APP_STATE: 'app-state'
  };

  class JuFlowDB {
    constructor() {
      this.db = null;
      this.ready = false;
    }

    /**
     * Initialize database connection
     * @returns {Promise<IDBDatabase>}
     */
    async init() {
      if (this.db && this.ready) {
        return this.db;
      }

      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          console.error('[DB] Failed to open database:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          this.db = request.result;
          this.ready = true;
          console.log('[DB] Database opened successfully');
          resolve(this.db);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          console.log('[DB] Upgrading database schema...');

          // Sales outbox: queued sales transactions
          if (!db.objectStoreNames.contains(STORES.SALES_OUTBOX)) {
            const store = db.createObjectStore(STORES.SALES_OUTBOX, { 
              keyPath: 'id', 
              autoIncrement: true 
            });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('userId', 'userId', { unique: false });
            store.createIndex('transactionId', 'transactionId', { unique: true });
          }

          // Delivery events outbox: queued delivery status updates
          if (!db.objectStoreNames.contains(STORES.DELIVERY_EVENTS_OUTBOX)) {
            const store = db.createObjectStore(STORES.DELIVERY_EVENTS_OUTBOX, { 
              keyPath: 'id', 
              autoIncrement: true 
            });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('userId', 'userId', { unique: false });
            store.createIndex('eventId', 'eventId', { unique: true });
            store.createIndex('deliveryId', 'deliveryId', { unique: false });
          }

          // Cached menu data
          if (!db.objectStoreNames.contains(STORES.CACHED_MENU)) {
            const store = db.createObjectStore(STORES.CACHED_MENU, { 
              keyPath: 'dishId' 
            });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }

          // Cached deliveries
          if (!db.objectStoreNames.contains(STORES.CACHED_DELIVERIES)) {
            const store = db.createObjectStore(STORES.CACHED_DELIVERIES, { 
              keyPath: 'deliveryId' 
            });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('status', 'status', { unique: false });
          }

          // Cached customers
          if (!db.objectStoreNames.contains(STORES.CACHED_CUSTOMERS)) {
            const store = db.createObjectStore(STORES.CACHED_CUSTOMERS, { 
              keyPath: 'customerId' 
            });
            store.createIndex('name', 'name', { unique: false });
          }

          // App state (generic key-value store)
          if (!db.objectStoreNames.contains(STORES.APP_STATE)) {
            db.createObjectStore(STORES.APP_STATE, { keyPath: 'key' });
          }
        };
      });
    }

    /**
     * Add item to store
     * @param {string} storeName - Store name
     * @param {object} data - Data to add
     * @returns {Promise<number>} Key of added item
     */
    async add(storeName, data) {
      await this.init();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.add(data);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    /**
     * Put (add or update) item in store
     * @param {string} storeName - Store name
     * @param {object} data - Data to put
     * @returns {Promise<any>} Key of item
     */
    async put(storeName, data) {
      await this.init();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.put(data);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    /**
     * Get item by key
     * @param {string} storeName - Store name
     * @param {any} key - Item key
     * @returns {Promise<object|undefined>} Item or undefined
     */
    async get(storeName, key) {
      await this.init();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    /**
     * Get all items from store
     * @param {string} storeName - Store name
     * @param {string} indexName - Optional index name
     * @param {any} query - Optional query value
     * @returns {Promise<Array>} Array of items
     */
    async getAll(storeName, indexName = null, query = null) {
      await this.init();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        
        let request;
        if (indexName) {
          const index = store.index(indexName);
          request = query ? index.getAll(query) : index.getAll();
        } else {
          request = store.getAll();
        }

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    }

    /**
     * Delete item by key
     * @param {string} storeName - Store name
     * @param {any} key - Item key
     * @returns {Promise<void>}
     */
    async delete(storeName, key) {
      await this.init();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    /**
     * Clear all items from store
     * @param {string} storeName - Store name
     * @returns {Promise<void>}
     */
    async clear(storeName) {
      await this.init();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    /**
     * Count items in store
     * @param {string} storeName - Store name
     * @returns {Promise<number>} Count
     */
    async count(storeName) {
      await this.init();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.count();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    /**
     * Execute multiple operations in a single transaction
     * @param {string} storeName - Store name
     * @param {Function} callback - Callback receives (store, tx)
     * @returns {Promise<any>} Result from callback
     */
    async transaction(storeName, callback) {
      await this.init();
      
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);

        try {
          callback(store, tx);
        } catch (err) {
          tx.abort();
          reject(err);
        }
      });
    }

    /**
     * Close database connection
     */
    close() {
      if (this.db) {
        this.db.close();
        this.db = null;
        this.ready = false;
        console.log('[DB] Database closed');
      }
    }
  }

  // Create singleton instance
  const db = new JuFlowDB();

  // Export to window
  window.JuFlowDB = {
    // Direct database access
    instance: db,
    
    // Store names
    STORES,

    // Convenience methods for common operations
    
    /**
     * Add sale to outbox
     * @param {object} sale - Sale data
     * @returns {Promise<number>}
     */
    async queueSale(sale) {
      return db.add(STORES.SALES_OUTBOX, {
        ...sale,
        timestamp: Date.now(),
        retries: 0
      });
    },

    /**
     * Get all queued sales for user
     * @param {string} userId - User ID
     * @returns {Promise<Array>}
     */
    async getQueuedSales(userId) {
      const allSales = await db.getAll(STORES.SALES_OUTBOX, 'userId', userId);
      return allSales.sort((a, b) => a.timestamp - b.timestamp);
    },

    /**
     * Remove sale from outbox
     * @param {number} id - Sale outbox ID
     * @returns {Promise<void>}
     */
    async removeSale(id) {
      return db.delete(STORES.SALES_OUTBOX, id);
    },

    /**
     * Clear all sales for user
     * @param {string} userId - User ID
     * @returns {Promise<number>} Number of sales cleared
     */
    async clearSales(userId) {
      const sales = await db.getAll(STORES.SALES_OUTBOX, 'userId', userId);
      for (const sale of sales) {
        await db.delete(STORES.SALES_OUTBOX, sale.id);
      }
      return sales.length;
    },

    /**
     * Add delivery event to outbox
     * @param {object} event - Event data
     * @returns {Promise<number>}
     */
    async queueDeliveryEvent(event) {
      return db.add(STORES.DELIVERY_EVENTS_OUTBOX, {
        ...event,
        timestamp: Date.now(),
        retries: 0
      });
    },

    /**
     * Get all queued delivery events for user
     * @param {string} userId - User ID
     * @returns {Promise<Array>}
     */
    async getQueuedDeliveryEvents(userId) {
      const allEvents = await db.getAll(STORES.DELIVERY_EVENTS_OUTBOX, 'userId', userId);
      return allEvents.sort((a, b) => a.timestamp - b.timestamp);
    },

    /**
     * Remove delivery event from outbox
     * @param {number} id - Event outbox ID
     * @returns {Promise<void>}
     */
    async removeDeliveryEvent(id) {
      return db.delete(STORES.DELIVERY_EVENTS_OUTBOX, id);
    },

    /**
     * Clear all delivery events for user
     * @param {string} userId - User ID
     * @returns {Promise<number>} Number of events cleared
     */
    async clearDeliveryEvents(userId) {
      const events = await db.getAll(STORES.DELIVERY_EVENTS_OUTBOX, 'userId', userId);
      for (const event of events) {
        await db.delete(STORES.DELIVERY_EVENTS_OUTBOX, event.id);
      }
      return events.length;
    },

    /**
     * Cache menu data
     * @param {Array} dishes - Dish array
     * @returns {Promise<void>}
     */
    async cacheMenu(dishes) {
      await db.clear(STORES.CACHED_MENU);
      const timestamp = Date.now();
      
      for (const dish of dishes) {
        await db.put(STORES.CACHED_MENU, {
          dishId: dish._id || dish.id,
          dish,
          timestamp
        });
      }
    },

    /**
     * Get cached menu
     * @returns {Promise<Array>} Dishes array
     */
    async getCachedMenu() {
      const items = await db.getAll(STORES.CACHED_MENU);
      return items.map(item => item.dish);
    },

    /**
     * Cache deliveries
     * @param {Array} deliveries - Delivery array
     * @returns {Promise<void>}
     */
    async cacheDeliveries(deliveries) {
      const timestamp = Date.now();
      
      for (const delivery of deliveries) {
        await db.put(STORES.CACHED_DELIVERIES, {
          deliveryId: delivery._id || delivery.id,
          delivery,
          status: delivery.status,
          timestamp
        });
      }
    },

    /**
     * Get cached deliveries
     * @param {string} status - Optional status filter
     * @returns {Promise<Array>} Deliveries array
     */
    async getCachedDeliveries(status = null) {
      const items = status 
        ? await db.getAll(STORES.CACHED_DELIVERIES, 'status', status)
        : await db.getAll(STORES.CACHED_DELIVERIES);
      return items.map(item => item.delivery);
    },

    /**
     * Cache customers
     * @param {Array} customers - Customer array
     * @returns {Promise<void>}
     */
    async cacheCustomers(customers) {
      for (const customer of customers) {
        await db.put(STORES.CACHED_CUSTOMERS, {
          customerId: customer._id || customer.id,
          customer,
          name: customer.name
        });
      }
    },

    /**
     * Get cached customers
     * @returns {Promise<Array>} Customers array
     */
    async getCachedCustomers() {
      const items = await db.getAll(STORES.CACHED_CUSTOMERS);
      return items.map(item => item.customer);
    },

    /**
     * Save app state
     * @param {string} key - State key
     * @param {any} value - State value
     * @returns {Promise<void>}
     */
    async saveState(key, value) {
      return db.put(STORES.APP_STATE, { key, value });
    },

    /**
     * Load app state
     * @param {string} key - State key
     * @returns {Promise<any>} State value or undefined
     */
    async loadState(key) {
      const item = await db.get(STORES.APP_STATE, key);
      return item?.value;
    },

    /**
     * Clear all data (logout)
     * @returns {Promise<void>}
     */
    async clearAll() {
      await db.clear(STORES.SALES_OUTBOX);
      await db.clear(STORES.DELIVERY_EVENTS_OUTBOX);
      await db.clear(STORES.CACHED_MENU);
      await db.clear(STORES.CACHED_DELIVERIES);
      await db.clear(STORES.CACHED_CUSTOMERS);
      await db.clear(STORES.APP_STATE);
      console.log('[DB] All stores cleared');
    },

    /**
     * Get database statistics
     * @returns {Promise<object>} Statistics
     */
    async getStats() {
      return {
        queuedSales: await db.count(STORES.SALES_OUTBOX),
        queuedEvents: await db.count(STORES.DELIVERY_EVENTS_OUTBOX),
        cachedDishes: await db.count(STORES.CACHED_MENU),
        cachedDeliveries: await db.count(STORES.CACHED_DELIVERIES),
        cachedCustomers: await db.count(STORES.CACHED_CUSTOMERS)
      };
    }
  };

  console.log('[DB] IndexedDB wrapper loaded');

})(window);

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'juflow';

let client;
let db;

/**
 * Connect to MongoDB
 */
export async function connect() {
  try {
    if (db) {
      return db;
    }

    console.log('🔄 Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 20,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
    });

    await client.connect();
    db = client.db(DB_NAME);

    console.log('✅ MongoDB connected successfully');
    console.log(`   Database: ${DB_NAME}`);

    // Create indexes
    await createIndexes();

    return db;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    await close();
    throw error;
  }
}

/**
 * Get database instance
 */
export function getDb() {
  if (!db) {
    throw new Error('Database not connected. Call connect() first.');
  }
  return db;
}

export async function withTransaction(work) {
  const database = getDb();
  const session = client.startSession();
  try {
    return await session.withTransaction(() => work(database, session), {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' }
    });
  } finally {
    await session.endSession();
  }
}

export async function readiness() {
  const database = getDb();
  await database.command({ ping: 1 }, { maxTimeMS: 2000 });
  await verifyRequiredIndexes(database);
  return true;
}

/**
 * Close MongoDB connection
 */
export async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('MongoDB connection closed');
  }
}

/**
 * Create database indexes
 */
export async function createIndexes(database = getDb()) {
  const db = database;
  try {
    // Users collection
    await db.collection('users').createIndex({ username: 1 }, { unique: true });
    // Legacy index replacement belongs to the explicit integrity migration.
    await db.collection('users').createIndex(
      { email: 1 },
      { name: 'email_unique_partial', unique: true, partialFilterExpression: { email: { $type: 'string' } } }
    );
    await db.collection('users').createIndex({ role_id: 1 });

    // Auth sessions with TTL expiration index
    await db.collection('auth_sessions').createIndex({ token_hash: 1 }, { unique: true });
    await db.collection('auth_sessions').createIndex({ user_id: 1 });
    await db.collection('auth_sessions').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

    // Riders
    await db.collection('riders').createIndex({ phone: 1 });
    await db.collection('riders').createIndex({ is_active: 1 });
    await db.collection('riders').createIndex(
      { user_id: 1 },
      { name: 'rider_user_id_unique', unique: true, partialFilterExpression: { user_id: { $type: 'objectId' } } }
    );

    // Customers
    await db.collection('customers').createIndex({ phone: 1 });
    await db.collection('customers').createIndex({ is_active: 1 });

    // Orders
    await db.collection('orders').createIndex({ order_number: 1 }, { unique: true });
    await db.collection('orders').createIndex({ customer_id: 1 });
    await db.collection('orders').createIndex({ status: 1 });
    await db.collection('orders').createIndex({ created_at: -1 });
    await db.collection('orders').createIndex(
      { idempotency_key: 1 },
      { name: 'order_idempotency_unique', unique: true, partialFilterExpression: { idempotency_key: { $type: 'string' } } }
    );

    // Categories
    await db.collection('categories').createIndex({ name: 1 }, { unique: true });

    // Products
    await db.collection('products').createIndex({ category_id: 1 });
    await db.collection('products').createIndex({ name_key: 1 });
    await db.collection('products').createIndex({ is_available: 1 });
    await db.collection('products').createIndex({ is_active: 1 });

    // Daily menu
    await db.collection('daily_menu').createIndex({ date: 1 }, { unique: true });

    // Deliveries
    await db.collection('deliveries').createIndex({ order_id: 1 }, { unique: true, sparse: true });
    await db.collection('deliveries').createIndex({ rider_id: 1 });
    await db.collection('deliveries').createIndex({ status: 1 });

    // Counters for atomic sequences
    // MongoDB already provides the unique _id index for counters.

    // Audit events
    await db.collection('audit_events').createIndex({ entity_type: 1, entity_id: 1, created_at: -1 });
    await db.collection('audit_events').createIndex({ event_id: 1 }, {
      name: 'audit_event_unique', unique: true,
      partialFilterExpression: { event_id: { $type: 'string' } }
    });

    // Delivery zones
    await db.collection('delivery_zones').createIndex({ sort_order: 1 });

    // Settings
    await db.collection('settings').createIndex({ key: 1 }, { unique: true });

    // Sales
    // Older databases have a sparse index that treats transaction_id:null as a value
    // (second sale without an id -> duplicate key). Replace it with a partial index.
    await db.collection('sales').createIndex(
      { transaction_id: 1 },
      { name: 'transaction_id_unique', unique: true, partialFilterExpression: { transaction_id: { $type: 'string' } } }
    );
    await db.collection('sales').createIndex({ void_id: 1 }, { unique: true, sparse: true });
    await db.collection('sales').createIndex({ sale_time: -1 });
    await db.collection('sales').createIndex({ received_at: -1 });
    await db.collection('sales').createIndex({ is_test_sale: 1 });
    await db.collection('sales').createIndex({ order_id: 1 }, {
      name: 'order_settlement_unique', unique: true,
      partialFilterExpression: { order_id: { $type: 'objectId' } }
    });
    await db.collection('deliveries').createIndex({ rider_id: 1, status: 1, updated_at: -1 });
    await db.collection('orders').createIndex({ customer_id: 1, created_at: -1 });
    await db.collection('sales').createIndex({ is_test_sale: 1, sale_time: -1 });

    // Admin notifications expire after 30 days
    await db.collection('notifications').createIndex({ created_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

    await verifyRequiredIndexes(db);
    console.log('✅ Database indexes created');
  } catch (error) {
    throw new Error(`Required database indexes failed; run the integrity migration on an isolated, backed-up database: ${error.message}`, { cause: error });
  }
}

export const REQUIRED_INDEXES = [
  ['users', 'username_1', { username: 1 }],
  ['users', 'email_unique_partial', { email: 1 }, { email: { $type: 'string' } }],
  ['auth_sessions', 'token_hash_1', { token_hash: 1 }],
  ['riders', 'rider_user_id_unique', { user_id: 1 }, { user_id: { $type: 'objectId' } }],
  ['orders', 'order_number_1', { order_number: 1 }],
  ['orders', 'order_idempotency_unique', { idempotency_key: 1 }, { idempotency_key: { $type: 'string' } }],
  ['deliveries', 'order_id_1', { order_id: 1 }],
  ['sales', 'transaction_id_unique', { transaction_id: 1 }, { transaction_id: { $type: 'string' } }],
  ['sales', 'void_id_1', { void_id: 1 }],
  ['sales', 'order_settlement_unique', { order_id: 1 }, { order_id: { $type: 'objectId' } }],
  ['audit_events', 'audit_event_unique', { event_id: 1 }, { event_id: { $type: 'string' } }]
];

export async function verifyRequiredIndexes(database) {
  for (const [collection, name, key, partial] of REQUIRED_INDEXES) {
    const indexes = await database.collection(collection).listIndexes().toArray();
    const index = indexes.find(i => i.name === name);
    if (!index || index.unique !== true || JSON.stringify(index.key) !== JSON.stringify(key) ||
        (partial && JSON.stringify(index.partialFilterExpression) !== JSON.stringify(partial))) {
      throw new Error(`Missing or incompatible integrity index ${collection}.${name}`);
    }
  }
}

/**
 * Helper to convert string ID to ObjectId
 */
export function toObjectId(id) {
  try {
    if (id instanceof ObjectId) return id;
    if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) return null;
    return new ObjectId(id);
  } catch (error) {
    return null;
  }
}

/**
 * Helper to generate timestamps
 */
export function timestamps() {
  const now = new Date();
  return {
    created_at: now,
    updated_at: now
  };
}

/**
 * Helper to update timestamp
 */
export function updateTimestamp() {
  return {
    updated_at: new Date()
  };
}

export { ObjectId };

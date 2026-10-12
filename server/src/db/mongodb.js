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
    if (client) {
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
    process.exit(1);
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
async function createIndexes() {
  try {
    // Users collection
    await db.collection('users').createIndex({ username: 1 }, { unique: true });
    await db.collection('users').createIndex({ email: 1 }, { unique: true, sparse: true });
    await db.collection('users').createIndex({ role_id: 1 });

    // Auth sessions with TTL expiration index
    await db.collection('auth_sessions').createIndex({ token_hash: 1 }, { unique: true });
    await db.collection('auth_sessions').createIndex({ user_id: 1 });
    await db.collection('auth_sessions').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

    // Riders
    await db.collection('riders').createIndex({ phone: 1 });
    await db.collection('riders').createIndex({ is_active: 1 });

    // Customers
    await db.collection('customers').createIndex({ phone: 1 });
    await db.collection('customers').createIndex({ is_active: 1 });

    // Orders
    await db.collection('orders').createIndex({ order_number: 1 }, { unique: true });
    await db.collection('orders').createIndex({ customer_id: 1 });
    await db.collection('orders').createIndex({ status: 1 });
    await db.collection('orders').createIndex({ created_at: -1 });

    // Categories
    await db.collection('categories').createIndex({ name: 1 }, { unique: true });

    // Products
    await db.collection('products').createIndex({ category_id: 1 });
    await db.collection('products').createIndex({ is_available: 1 });
    await db.collection('products').createIndex({ is_active: 1 });

    // Deliveries
    await db.collection('deliveries').createIndex({ order_id: 1 }, { unique: true, sparse: true });
    await db.collection('deliveries').createIndex({ status: 1 });

    // Delivery zones
    await db.collection('delivery_zones').createIndex({ sort_order: 1 });

    // Settings
    await db.collection('settings').createIndex({ key: 1 }, { unique: true });

    // Sales
    // Older databases have a sparse index that treats transaction_id:null as a value
    // (second sale without an id -> duplicate key). Replace it with a partial index.
    await db.collection('sales').dropIndex('transaction_id_1').catch(() => {});
    await db.collection('sales').createIndex(
      { transaction_id: 1 },
      { name: 'transaction_id_unique', unique: true, partialFilterExpression: { transaction_id: { $type: 'string' } } }
    );
    await db.collection('sales').createIndex({ sale_time: -1 });
    await db.collection('sales').createIndex({ is_test_sale: 1 });

    console.log('✅ Database indexes created');
  } catch (error) {
    console.error('⚠️  Index creation warning:', error.message);
  }
}

/**
 * Helper to convert string ID to ObjectId
 */
export function toObjectId(id) {
  try {
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

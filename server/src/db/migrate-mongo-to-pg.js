import { MongoClient } from 'mongodb';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  const mongoUri = process.env.MONGODB_URI;
  const pgUri = process.env.DATABASE_URL || process.env.POSTGRES_URI || process.env.PG_URL;

  if (!mongoUri) {
    console.error('❌ MONGODB_URI is required in .env');
    process.exit(1);
  }
  if (!pgUri) {
    console.error('❌ DATABASE_URL is required in .env');
    console.error('   Example: DATABASE_URL=postgresql://user:password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres');
    process.exit(1);
  }

  console.log('🚀 Starting MongoDB to PostgreSQL Data Migration...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Source (MongoDB): ${mongoUri.replace(/:([^@]+)@/, ':****@')}`);
  console.log(`Target (PostgreSQL): ${pgUri.replace(/:([^@]+)@/, ':****@')}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1. Connect to MongoDB
  console.log('🔄 Connecting to MongoDB Atlas...');
  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  const dbName = process.env.DB_NAME || 'juflow';
  const mongoDb = mongoClient.db(dbName);
  console.log(`✅ Connected to MongoDB database: ${dbName}`);

  // 2. Connect to PostgreSQL
  console.log('🔄 Connecting to PostgreSQL...');
  const isRemote = !/localhost|127\.0\.0\.1/.test(pgUri);
  const pgPool = new Pool({
    connectionString: pgUri,
    ssl: isRemote ? { rejectUnauthorized: false } : false
  });
  const pgClient = await pgPool.connect();
  console.log('✅ Connected to PostgreSQL');

  try {
    // 3. Initialize PostgreSQL Schema
    console.log('📋 Ensuring PostgreSQL tables and schema exist...');
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pgClient.query(schemaSql);
    console.log('✅ Schema verified.\n');

    // Ordered list of collections to migrate
    const collectionsToMigrate = [
      'roles',
      'users',
      'auth_sessions',
      'categories',
      'products',
      'customers',
      'delivery_zones',
      'riders',
      'orders',
      'deliveries',
      'sales',
      'settings',
      'daily_menu',
      'notifications',
      'counters',
      'audit_events',
      'integrity_guards'
    ];

    const results = {};

    for (const collName of collectionsToMigrate) {
      process.stdout.write(`⏳ Migrating collection: ${collName}... `);
      const docs = await mongoDb.collection(collName).find().toArray();
      let migrated = 0;

      for (const doc of docs) {
        const id = String(doc._id);
        const cleanDoc = { ...doc };
        delete cleanDoc._id;
        cleanDoc.id = id;

        // Ensure dates are parsed properly
        const createdAt = doc.created_at ? new Date(doc.created_at) : new Date();
        const updatedAt = doc.updated_at ? new Date(doc.updated_at) : new Date();

        // Base insert into data JSONB
        const baseSql = `
          INSERT INTO ${collName} (id, data, created_at, updated_at)
          VALUES ($1, $2::jsonb, $3, $4)
          ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
        `;
        await pgClient.query(baseSql, [id, JSON.stringify(cleanDoc), createdAt, updatedAt]);

        // Populate known relational columns
        const colUpdates = [];
        const colParams = [id];
        for (const [key, val] of Object.entries(cleanDoc)) {
          if (['id', 'data', 'created_at', 'updated_at'].includes(key)) continue;
          let formattedVal = val;
          if (val && typeof val === 'object' && !(val instanceof Date)) {
            formattedVal = JSON.stringify(val);
          }
          colParams.push(formattedVal);
          colUpdates.push(`${key} = $${colParams.length}`);
        }

        if (colUpdates.length) {
          try {
            await pgClient.query(`UPDATE ${collName} SET ${colUpdates.join(', ')} WHERE id = $1`, colParams);
          } catch (e) {
            // Column might not exist in dedicated columns, which is fine since data JSONB has the whole doc
          }
        }

        migrated++;
      }

      console.log(`✅ ${migrated} records migrated`);
      results[collName] = migrated;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Migration Completed Successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const [coll, count] of Object.entries(results)) {
      console.log(` - ${coll.padEnd(20)}: ${count} rows`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } finally {
    pgClient.release();
    await pgPool.end();
    await mongoClient.close();
  }
}

runMigration().catch((err) => {
  console.error('\n❌ Migration failed:', err);
  process.exit(1);
});

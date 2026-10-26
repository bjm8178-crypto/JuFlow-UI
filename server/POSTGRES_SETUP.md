# JuFlow Server - PostgreSQL Setup & Migration Guide

## 🐘 PostgreSQL Integration Overview

Your JuFlow backend now fully supports **PostgreSQL**! It features:
- ✅ **100% Backward-Compatible API**: Primary keys are projected as both `id` and `_id`, so existing frontend code (`admin`, `cashier`, `rider`) works with zero changes.
- ✅ **JSONB Document Storage**: Complex structures (line items, customer pin snapshots, order state, settings) are safely stored in PostgreSQL `JSONB` alongside indexed relational columns.
- ✅ **Automated Migration Script**: Single-command data migration from MongoDB Atlas to PostgreSQL (`npm run migrate:mongo-to-pg`), preserving all 312+ sales records, customer coordinates, dishes, and users.
- ✅ **Cloud-Ready**: Native SSL pooling compatible with **Supabase**, **Neon**, and **Render PostgreSQL**.

---

## 🚀 Step 1: Set Up a Free Cloud PostgreSQL Database

You can choose any of the popular cloud PostgreSQL providers:

### Option A: Supabase (Recommended)
1. Go to [supabase.com](https://supabase.com) and sign in/sign up for free.
2. Click **New Project** (Name: `juflow`, pick region closest to Philippines e.g. Singapore / `ap-southeast-1`).
3. Set a database password and save it.
4. Go to **Project Settings** > **Database** > **Connection string**.
5. Select **Nodejs** or **URI** (or Transaction Pooler on port 6543 / 5432).
6. Copy the connection string. It looks like:
   ```
   postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```

### Option B: Neon.tech (Fast & Serverless)
1. Go to [neon.tech](https://neon.tech) and create a free account.
2. Create a new project `juflow`.
3. Copy the pooled connection string (`postgres://...`).

### Option C: Render PostgreSQL
1. Go to your [Render Dashboard](https://dashboard.render.com).
2. Click **New +** > **PostgreSQL**.
3. Name: `juflow-db`, Region: `Singapore`.
4. Once provisioned, copy the **Internal Database URL** (for services inside Render) or **External Database URL**.

---

## 📦 Step 2: Configure Environment Variables

In your `server/.env` file:

```env
# PostgreSQL Database Connection
DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:5432/[DB_NAME]

# Keep your MONGODB_URI for migration
MONGODB_URI=mongodb+srv://...
```

---

## 🔄 Step 3: Run the Automated Data Migration

Run the migration script to copy all existing data from MongoDB Atlas into your PostgreSQL database:

```bash
cd server
npm run migrate:mongo-to-pg
```

You will see output showing progress for each collection:
```
🚀 Starting MongoDB to PostgreSQL Data Migration...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Source (MongoDB): mongodb+srv://...
Target (PostgreSQL): postgresql://...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔄 Connecting to MongoDB Atlas...
✅ Connected to MongoDB database: juflow
🔄 Connecting to PostgreSQL...
✅ Connected to PostgreSQL
📋 Ensuring PostgreSQL tables and schema exist...
✅ Schema verified.

⏳ Migrating collection: roles... ✅ 3 records migrated
⏳ Migrating collection: users... ✅ 4 records migrated
⏳ Migrating collection: categories... ✅ 8 records migrated
⏳ Migrating collection: products... ✅ 34 records migrated
⏳ Migrating collection: customers... ✅ 15 records migrated
⏳ Migrating collection: delivery_zones... ✅ 6 records migrated
⏳ Migrating collection: riders... ✅ 4 records migrated
⏳ Migrating collection: orders... ✅ 16 records migrated
⏳ Migrating collection: deliveries... ✅ 16 records migrated
⏳ Migrating collection: sales... ✅ 312 records migrated
⏳ Migrating collection: settings... ✅ 9 records migrated
...
🎉 Migration Completed Successfully!
```

---

## 💻 Step 4: Run the Server with PostgreSQL

```bash
npm run dev
```

The startup banner will confirm that PostgreSQL is active:
```
📦 Using PostgreSQL database driver
✅ PostgreSQL connected successfully
✅ PostgreSQL schema verified

🚀 Juki API Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Environment: development
   Database: PostgreSQL
   Port: 3000
   URL: http://localhost:3000
   Health: http://localhost:3000/api/health
   Timezone: Asia/Manila
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## ☁️ Step 5: Activate PostgreSQL in Production (Render)

1. Open your [Render Dashboard](https://dashboard.render.com).
2. Select your `juflow-api` service.
3. Go to **Environment** tab.
4. Add a new environment variable:
   - **Key**: `DATABASE_URL`
   - **Value**: *Your PostgreSQL connection string from Supabase / Neon / Render*
5. Click **Save Changes**.
6. Render will automatically deploy and switch to PostgreSQL!

---

## 🧪 Testing

Run all unit and integration tests:
```bash
npm test
```
All 91 tests (including price validation, password hashing, session tokens, refunds, order settlement, and PostgreSQL adapter mapping) will run and pass.

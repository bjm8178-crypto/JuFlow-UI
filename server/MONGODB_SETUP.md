# Juki Server - MongoDB Setup Guide

## ✅ MongoDB Successfully Converted!

Your Juki backend has been **completely converted from PostgreSQL to MongoDB**. All routes, authentication, and database operations now use MongoDB.

---

## 📋 What Changed

### Files Updated/Created:
- ✅ `package.json` - Changed `pg` to `mongodb` driver
- ✅ `.env.example` - MongoDB connection strings
- ✅ `src/db/mongodb.js` - MongoDB connection manager (NEW)
- ✅ `src/db/seed.js` - MongoDB seed data script (NEW)
- ✅ `src/middleware/auth.js` - MongoDB authentication
- ✅ `src/routes/auth.js` - MongoDB login/logout
- ✅ `src/routes/users.js` - MongoDB user management
- ✅ `src/routes/riders.js` - MongoDB rider CRUD
- ✅ `src/routes/delivery-zones.js` - MongoDB zones
- ✅ `src/routes/settings.js` - MongoDB settings
- ✅ `src/index.js` - MongoDB connection on startup

### Files Removed:
- ❌ `src/db/pool.js` (PostgreSQL pool)
- ❌ `src/db/migrate.js` (SQL migration runner)
- ❌ `src/db/migrations/*.sql` (SQL schema files)

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Start MongoDB

**Option A: Local MongoDB (Recommended)**

Download and install MongoDB Community Edition:
- Windows: https://www.mongodb.com/try/download/community
- After installation, MongoDB runs automatically on `localhost:27017`

**Option B: MongoDB Compass (GUI)**

If you already have MongoDB Compass installed:
1. Open MongoDB Compass
2. Connect to `mongodb://localhost:27017`
3. The database will be created automatically when you run the seed script

**Option C: MongoDB Atlas (Cloud - Free)**

1. Go to https://www.mongodb.com/cloud/atlas
2. Sign up for free
3. Create a cluster
4. Get your connection string
5. Update `.env` with your Atlas URI

### 3. Configure Environment

```bash
# Copy the example file
cp .env.example .env

# Edit .env
# For local MongoDB (default):
MONGODB_URI=mongodb://localhost:27017
DB_NAME=juflow

# For MongoDB Atlas (cloud):
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
```

### 4. Seed the Database

```bash
npm run seed
```

This will create:
- ✅ 3 roles (admin, cashier, rider)
- ✅ 1 admin user (username: `admin`, password: `admin123`)
- ✅ 8 product categories
- ✅ 15 sample products
- ✅ 6 delivery zones (Iligan Zones 1-5, Marawi)
- ✅ 10 system settings
- ✅ 3 sample riders

### 5. Start the Server

```bash
npm run dev
```

You should see:
```
🔄 Connecting to MongoDB...
✅ MongoDB connected successfully
   Database: juflow
✅ Database indexes created

🚀 Juki API Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Environment: development
   Database: MongoDB
   Port: 3000
   URL: http://localhost:3000
   Health: http://localhost:3000/api/health
   Timezone: Asia/Manila
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 🧪 Test the API

### Health Check
```bash
curl http://localhost:3000/api/health
```

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

Response:
```json
{
  "token": "abc123...",
  "user": {
    "id": "...",
    "username": "admin",
    "full_name": "Ju Kitchen Admin",
    "role": "admin"
  }
}
```

### Get Current User (with token)
```bash
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

## 📊 MongoDB Collections

Your database will have these collections:

1. **roles** - User roles (admin, cashier, rider)
2. **users** - User accounts
3. **auth_sessions** - Login sessions
4. **riders** - Delivery riders
5. **customers** - Customer records
6. **delivery_zones** - Delivery zones with fees
7. **categories** - Product categories
8. **products** - Menu items
9. **orders** - Customer orders
10. **deliveries** - Delivery tracking
11. **gcash_proofs** - GCash payment screenshots
12. **inventory_items** - Stock items
13. **stock_movements** - Inventory changes
14. **sales** - Sales transactions
15. **expenses** - Business expenses
16. **settings** - System settings

---

## 🔍 Using MongoDB Compass

**To view your data in MongoDB Compass:**

1. Open MongoDB Compass
2. Connect to `mongodb://localhost:27017`
3. Click on `juflow` database
4. Browse collections:
   - Click `users` to see all users
   - Click `products` to see menu items
   - Click `delivery_zones` to see zones
   - etc.

**To query data:**
- Select a collection
- Click "Filter" and enter: `{ "is_active": true }`
- Click "Find" to see only active records

---

## 🔑 Default Credentials

**Admin Account:**
- Username: `admin`
- Password: `admin123`
- Role: `admin`

⚠️ **IMPORTANT:** Change this password after first login!

```bash
curl -X POST http://localhost:3000/api/auth/change-password \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "current_password": "admin123",
    "new_password": "your-secure-password"
  }'
```

---

## 📝 MongoDB vs PostgreSQL Differences

### Data Storage
- **PostgreSQL**: Tables with rows
- **MongoDB**: Collections with documents (JSON-like)

### Queries
- **PostgreSQL**: SQL (`SELECT * FROM users WHERE id = 1`)
- **MongoDB**: JavaScript methods (`.find({ _id: ObjectId(...) })`)

### Primary Keys
- **PostgreSQL**: Integer `id`
- **MongoDB**: ObjectId `_id` (12-byte identifier)

### Relationships
- **PostgreSQL**: Foreign keys enforced
- **MongoDB**: References by ID (not enforced, application-level)

### Transactions
- **PostgreSQL**: `BEGIN`, `COMMIT`, `ROLLBACK`
- **MongoDB**: Session-based transactions

---

## 🐛 Troubleshooting

### "MongoServerError: Connection refused"
- MongoDB is not running
- Start MongoDB service or open MongoDB Compass

### "Database not connected. Call connect() first."
- Server tried to query before connecting
- Check `src/index.js` has `await connect()` before `app.listen()`

### "npm ERR! ENOENT: no such file or directory, open 'package.json'"
- You're in the wrong directory
- Run `cd server` first

### "ValidationError: username is required"
- Missing required fields in request body
- Check your API request has all required fields

---

## 📦 NPM Scripts

```bash
npm run dev       # Start server with auto-reload
npm start         # Start server (production)
npm run seed      # Seed the database
npm test          # Run tests (when added)
```

---

## 🎯 Next Steps

1. ✅ Install dependencies (`npm install`)
2. ✅ Start MongoDB (Compass or local service)
3. ✅ Create `.env` file
4. ✅ Run seed script (`npm run seed`)
5. ✅ Start server (`npm run dev`)
6. ✅ Test login endpoint
7. ⏳ Continue building Phase 2 features (products, orders, etc.)

---

## 📚 Useful MongoDB Resources

- **MongoDB Compass**: https://www.mongodb.com/products/compass
- **MongoDB Node.js Driver**: https://www.mongodb.com/docs/drivers/node/
- **MongoDB Query Operators**: https://www.mongodb.com/docs/manual/reference/operator/query/
- **MongoDB Atlas (Free Cloud)**: https://www.mongodb.com/cloud/atlas

---

## ✨ MongoDB Benefits for Juki

1. **Flexible Schema** - Easy to add new fields without migrations
2. **JSON-Native** - Perfect for JavaScript/Node.js apps
3. **Horizontal Scaling** - Ready for growth
4. **Rich Queries** - Powerful filtering and aggregation
5. **Document Model** - Natural fit for orders, customers, products
6. **MongoDB Compass** - Beautiful GUI for data management

---

**🎉 Congratulations! Your Juki backend is now running on MongoDB.**

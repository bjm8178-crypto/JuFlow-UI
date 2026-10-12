# JuFlow Setup Checklist

**Date:** October 6, 2026  
**Phase:** 0 → 1 Transition

Complete these steps to get your JuFlow Admin backend running.

---

## ✅ Phase 0: Foundation (COMPLETE)

- [x] Project structure created (`server/src/`, `uploads/`, etc.)
- [x] Database schema designed (29 tables)
- [x] Migration files created (`001_init.sql`, `002_seed_data.sql`)
- [x] Express server scaffolded (`src/index.js`)
- [x] Database pool configured (`src/db/pool.js`)
- [x] Auth middleware ready (`src/middleware/auth.js`)
- [x] Package.json with dependencies
- [x] Environment template (`.env.example`)
- [x] README with full documentation

---

## 🔨 Phase 1: Getting It Running (DO THIS NOW)

### Step 1: Install Node.js Dependencies

```bash
cd server
npm install
```

**Expected packages:**
- express@4.18.2
- pg@8.11.3
- bcrypt@5.1.1
- dotenv@16.3.1
- multer@1.4.5-lts.1
- cors@2.8.5

### Step 2: Install & Configure PostgreSQL

**Option A: Local PostgreSQL (Recommended for development)**

1. Download: https://www.postgresql.org/download/windows/
2. Install with default settings
3. Remember the password you set for `postgres` user
4. Verify installation:

```bash
psql --version
# Should show: psql (PostgreSQL) 14.x or higher
```

**Option B: Cloud PostgreSQL (For production-like testing)**

- Railway: https://railway.app/ (Free tier available)
- Heroku Postgres: https://www.heroku.com/postgres
- DigitalOcean: https://www.digitalocean.com/products/managed-databases

### Step 3: Create Database

**Using psql:**

```bash
psql -U postgres
```

Then in the psql prompt:

```sql
CREATE DATABASE juflow
  WITH OWNER = postgres
  ENCODING = 'UTF8';

\c juflow

-- Test connection
SELECT 'Database ready!' AS status;

\q
```

**Using pgAdmin (GUI):**

1. Open pgAdmin
2. Right-click "Databases" → Create → Database
3. Name: `juflow`
4. Owner: `postgres`
5. Save

### Step 4: Configure Environment

```bash
cd server
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=juflow
DATABASE_USER=postgres
DATABASE_PASSWORD=YOUR_ACTUAL_PASSWORD_HERE

PORT=3000
NODE_ENV=development
TZ=Asia/Manila
```

**Generate secrets:**

```bash
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

Copy those values into `.env`.

### Step 5: Run Migrations

```bash
npm run migrate
```

**Expected output:**

```
🔄 Running database migrations...

Found 2 migration file(s):

⏳ Running: 001_init.sql...
✅ Success: 001_init.sql

⏳ Running: 002_seed_data.sql...
✅ Success: 002_seed_data.sql

✅ All migrations completed successfully!

📊 Database now has 29 tables.
```

**If you see errors:**
- Check PostgreSQL is running: `pg_isready`
- Verify database exists: `psql -U postgres -l | grep juflow`
- Check credentials in `.env`

### Step 6: Fix Admin Password Hash

The seed data has a placeholder password. Let's generate a proper hash:

```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('admin123', 10).then(hash => console.log(hash));"
```

Copy the output (starts with `$2b$10$...`), then update the database:

```bash
psql -U postgres -d juflow
```

```sql
UPDATE users 
SET password_hash = '$2b$10$YOUR_GENERATED_HASH_HERE'
WHERE username = 'admin';

-- Verify
SELECT username, substring(password_hash, 1, 20) AS hash_preview FROM users;

\q
```

### Step 7: Start the Server

```bash
npm run dev
```

**Expected output:**

```
🚀 JuFlow API Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Environment: development
   Port: 3000
   URL: http://localhost:3000
   Health: http://localhost:3000/api/health
   Timezone: Asia/Manila
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 8: Test Health Endpoint

Open browser or use curl:

```bash
curl http://localhost:3000/api/health
```

**Expected:**

```json
{
  "status": "ok",
  "mode": "juflow-api-v1",
  "timestamp": "2026-10-06T01:01:26.582Z",
  "timezone": "Asia/Manila"
}
```

✅ **If you see this, Phase 0 is complete!**

---

## 🎯 What You Have Now

### Database (PostgreSQL)
- ✅ 29 tables created and indexed
- ✅ 3 roles (admin, cashier, rider)
- ✅ 1 admin user (username: `admin`, password: `admin123`)
- ✅ 4 categories (Ulam, Rice, Drinks, Add-ons)
- ✅ 4 sample products (Pork Paksiw, Plain Rice, etc.)
- ✅ 3 delivery zones (placeholders)
- ✅ 11 inventory items (placeholders)
- ✅ 3 suppliers (placeholders)
- ✅ Shop settings configured

### Backend API
- ✅ Express server running on port 3000
- ✅ PostgreSQL connection pool
- ✅ CORS enabled for development
- ✅ Authentication middleware ready
- ✅ File upload directory (`uploads/`)
- ✅ Error handling middleware

### What's NOT Built Yet
- ❌ Authentication routes (login/logout)
- ❌ User management endpoints
- ❌ Menu/product endpoints
- ❌ Customer management
- ❌ Order creation
- ❌ Sales recording
- ❌ All other business logic

**This is expected.** We just finished Phase 0 (Setup).

---

## 📋 Next Steps: Phase 1 Implementation

### Week 2-3 Goals: Authentication & Foundation

**You need to build:**

1. **Auth Routes** (`src/routes/auth.js`)
   - `POST /api/auth/login` - Username/password → session token
   - `POST /api/auth/logout` - Revoke session
   - `GET /api/auth/me` - Get current user info
   - `POST /api/auth/change-password` - Update password

2. **User Management** (`src/routes/users.js`)
   - `GET /api/users` - List all users (admin only)
   - `POST /api/users` - Create new admin/cashier account
   - `PATCH /api/users/:id` - Update user details
   - `POST /api/users/:id/reset-password` - Admin resets password

3. **Riders Management** (`src/routes/riders.js`)
   - `GET /api/riders` - List riders
   - `POST /api/riders` - Add rider
   - `PATCH /api/riders/:id` - Update rider

4. **Settings** (`src/routes/settings.js`)
   - `GET /api/settings` - Get all settings
   - `PUT /api/settings/:key` - Update one setting

5. **Delivery Zones** (`src/routes/delivery-zones.js`)
   - `GET /api/delivery-zones` - List zones
   - `POST /api/delivery-zones` - Add zone
   - `PATCH /api/delivery-zones/:id` - Update zone

### How to Implement

1. Create route file in `src/routes/`
2. Import required middleware (authenticate, requireRole)
3. Write endpoint handlers with proper error handling
4. Use parameterized queries (`await query('SELECT ...', [param])`)
5. Return consistent JSON: `{ error, message, data }`
6. Import route in `src/index.js`
7. Test with Postman

### Testing Strategy

1. Install Postman or Thunder Client (VS Code extension)
2. Create a collection: "JuFlow API"
3. Add requests for each endpoint
4. Test happy path (valid data)
5. Test error cases (invalid auth, missing fields, etc.)
6. Save successful token for authenticated requests

---

## 🔍 Verification Commands

### Check Database Tables

```bash
psql -U postgres -d juflow -c "\dt"
```

Should show 29 tables.

### Count Records

```bash
psql -U postgres -d juflow -c "
SELECT 
  (SELECT COUNT(*) FROM roles) AS roles,
  (SELECT COUNT(*) FROM users) AS users,
  (SELECT COUNT(*) FROM categories) AS categories,
  (SELECT COUNT(*) FROM products) AS products,
  (SELECT COUNT(*) FROM delivery_zones) AS zones,
  (SELECT COUNT(*) FROM inventory_items) AS inventory,
  (SELECT COUNT(*) FROM suppliers) AS suppliers;
"
```

Expected: roles=3, users=1, categories=4, products=4, zones=3, inventory=11, suppliers=3

### View Sample Data

```sql
-- Products with prices
SELECT sku, name, price_centavos / 100.0 AS price_php 
FROM products;

-- Delivery zones with fees
SELECT name, fee_centavos / 100.0 AS fee_php 
FROM delivery_zones;
```

---

## 🐛 Common Issues & Fixes

### "Cannot find module 'bcrypt'"

```bash
npm install bcrypt --save
```

If build fails on Windows:
```bash
npm install --global windows-build-tools
npm install bcrypt
```

### "password authentication failed for user postgres"

Fix: Edit `.env` with correct password, or reset PostgreSQL password

### "relation does not exist"

Fix: Migrations didn't run. Check `npm run migrate` output for errors.

### "Port 3000 already in use"

Fix: Kill process or change PORT in `.env`:

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <process_id> /F

# Change port
echo PORT=3001 >> .env
```

### Server starts but health check fails

Check:
1. Server actually started (no error in console)
2. URL is correct: `http://localhost:3000/api/health`
3. Firewall not blocking port 3000

---

## 📚 Resources

### Documentation
- **Express.js:** https://expressjs.com/en/guide/routing.html
- **PostgreSQL:** https://www.postgresql.org/docs/
- **pg (node-postgres):** https://node-postgres.com/
- **bcrypt:** https://www.npmjs.com/package/bcrypt

### Tools
- **Postman:** https://www.postman.com/downloads/
- **pgAdmin:** https://www.pgadmin.org/download/
- **VS Code Extensions:**
  - Thunder Client (API testing)
  - PostgreSQL (database browser)
  - REST Client (HTTP requests in files)

---

## ✅ Final Checklist

Before moving to Phase 1 implementation:

- [ ] Node.js installed (`node --version` shows 18+)
- [ ] PostgreSQL installed (`psql --version`)
- [ ] Database `juflow` created
- [ ] Dependencies installed (`npm install` successful)
- [ ] `.env` file configured with real values
- [ ] Migrations ran successfully (29 tables)
- [ ] Admin password hash updated
- [ ] Server starts without errors
- [ ] Health endpoint responds correctly
- [ ] Postman/Thunder Client installed

**If all boxes are checked, you're ready for Phase 1!**

---

## 🎓 Your Capstone Progress

**Completed:** Phase 0 (Week 1) ✅  
**Current:** Ready to start Phase 1 (Weeks 2-3)  
**Next Milestone:** Working login system

**Estimated Timeline:**
- Phase 1 (Foundation): 2-3 weeks
- Phase 2 (Menu/Customers/Orders): 4-5 weeks
- Phase 3 (Sales/Deliveries): 2-3 weeks
- Phase 4 (Inventory/Finance): 2-3 weeks
- Phase 5 (Analytics): 1 week
- Phase 6 (Hardening/Deploy): 2 weeks

**Total: 12-15 weeks**

---

**Questions?** Re-read README.md for detailed explanations.

**Ready to code?** Start with `src/routes/auth.js` — that's the foundation for everything else.

Good luck! 🚀

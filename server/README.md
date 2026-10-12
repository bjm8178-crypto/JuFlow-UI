# JuFlow Admin Backend API

**Ju Kitchen Capstone Project — Node.js + Express + PostgreSQL**

Complete backend API for the JuFlow Kitchen Operations Management System.

---

## 🎯 Project Status

**Phase 0: Setup** ✅ Complete (Week 1)
- [x] Project structure created
- [x] PostgreSQL schema designed (29 tables)
- [x] Database migrations ready
- [x] Seed data prepared
- [x] Express server scaffolded
- [x] Authentication middleware ready

**Next: Phase 1 - Foundation** (Weeks 2-3)
- [ ] Install dependencies
- [ ] Setup PostgreSQL database
- [ ] Run migrations
- [ ] Implement auth routes (login/logout)
- [ ] Test with Postman

---

## 📋 Prerequisites

Before you start, ensure you have:

- **Node.js 18+** — [Download](https://nodejs.org/)
- **PostgreSQL 12+** — [Download](https://www.postgresql.org/download/)
- **Git** (optional, for version control)
- **Postman** or similar API testing tool

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd server
npm install
```

This installs:
- `express` - Web framework
- `pg` - PostgreSQL client
- `bcrypt` - Password hashing
- `dotenv` - Environment variables
- `multer` - File uploads
- `cors` - Cross-origin requests

### 2. Setup PostgreSQL Database

**Option A: Local PostgreSQL**

1. Open pgAdmin or psql
2. Create a new database:

```sql
CREATE DATABASE juflow
  WITH OWNER = postgres
  ENCODING = 'UTF8';
```

3. Verify connection:

```bash
psql -U postgres -d juflow -c "SELECT version();"
```

**Option B: Cloud PostgreSQL (Railway, Heroku, etc.)**

Get your connection string and use it in the next step.

### 3. Configure Environment Variables

Copy the example file:

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

```env
# Database (replace with your actual credentials)
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=juflow
DATABASE_USER=postgres
DATABASE_PASSWORD=your_actual_password

# Server
PORT=3000
NODE_ENV=development

# Generate random secrets (use: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
SESSION_SECRET=your-generated-secret-here-min-32-chars
JWT_SECRET=your-generated-jwt-secret-here-min-32-chars

# File Upload
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=5242880

# Google Maps (optional for now)
GOOGLE_MAPS_API_KEY=

# Timezone
TZ=Asia/Manila
```

**Generate secure secrets:**

```bash
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Run Database Migrations

This creates all 29 tables and loads seed data:

```bash
npm run migrate
```

Expected output:

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

### 5. Start the Server

**Development mode (with auto-reload):**

```bash
npm run dev
```

**Production mode:**

```bash
npm start
```

Expected output:

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

### 6. Test the API

Open your browser or use curl:

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{
  "status": "ok",
  "mode": "juflow-api-v1",
  "timestamp": "2026-10-06T01:00:00.000Z",
  "timezone": "Asia/Manila"
}
```

---

## 📊 Database Schema

The system has **29 tables** organized into 9 modules:

### 1. Users & Settings (7 tables)
- `roles` - Admin, cashier, rider roles
- `users` - User accounts with bcrypt passwords
- `riders` - Rider list (not linked to users yet)
- `auth_sessions` - Active login sessions
- `settings` - Key-value configuration
- `delivery_zones` - Delivery areas with fees

### 2. Customers (2 tables)
- `customers` - Customer profiles
- `customer_addresses` - Multiple addresses per customer with GPS pins

### 3. Menu (3 tables)
- `categories` - Ulam, Rice, Drinks, Add-ons
- `products` - Menu items with SKU and prices
- `daily_menu` - Daily cooking plan with sold-out flags

### 4. Orders (3 tables)
- `orders` - Customer orders (dine-in, takeout, delivery)
- `order_items` - Line items with snapshots
- `order_status_history` - Status change audit trail

### 5. Sales & Payments (4 tables)
- `sales` - Completed cashier transactions
- `sale_items` - Sale line items
- `payments` - GCash payment tracking
- `refunds` - Void and refund requests

### 6. Delivery (1 table)
- `deliveries` - Delivery tracking per order

### 7. Inventory (6 tables)
- `suppliers` - Supplier directory
- `inventory_items` - Ingredients, packaging, supplies
- `stock_movements` - All stock changes (stock-in, usage, waste)
- `purchases` - Purchase records
- `purchase_items` - Purchase line items
- `recipes` - Optional product-to-ingredient mapping

### 8. Finance (2 tables)
- `expenses` - Daily expense tracking
- `daily_closing` - End-of-day cash reconciliation

### 9. Audit (2 tables)
- `notifications` - In-app alerts
- `audit_logs` - Change history

**Deferred tables (Phase 3):**
- `devices` - Cashier/rider device registry
- `rider_locations` - GPS tracking history

---

## 🗺️ Implementation Roadmap

### ✅ Phase 0: Setup (Week 1) — **COMPLETE**
- Project structure
- Database schema
- Migrations & seeds
- Express scaffolding

### 🔨 Phase 1: Foundation (Weeks 2-3) — **NEXT**
**What to build:**
- Auth routes (`POST /api/auth/login`, `/logout`, `GET /api/auth/me`)
- User management (`GET/POST /api/users`, `PATCH /api/users/:id`)
- Riders list (`GET/POST /api/riders`)
- Settings API (`GET/PUT /api/settings`)
- File upload helper (multer)

**Acceptance criteria:**
- Admin can log in with username/password
- Session token works with protected routes
- Can create new admin users
- Can add riders to the list
- Can update shop settings

### Phase 2: Menu, Customers, Orders (Weeks 4-8)
- Products & categories
- Customer management with addresses
- GPS pin handling
- Order creation & status flow
- Landmark photo uploads

### Phase 3: Sales & Deliveries (Weeks 9-10)
- Admin sales entry
- Cashier API endpoint (POST /api/cashier/sales)
- Live sales polling
- GCash verification
- Rider assignment
- Delivery status tracking

### Phase 4: Inventory & Money (Weeks 11-12)
- Inventory items & suppliers
- Purchase tracking
- Stock movements
- Expenses
- Daily closing

### Phase 5: Analytics (Week 13)
- Dashboard metrics
- Reports (date ranges, best sellers, profit)
- CSV export

### Phase 6: Hardening (Week 14-15)
- Security audit
- Rate limiting
- Input validation
- HTTPS deployment
- Backup scripts

---

## 🔒 Security Notes

### Current Status (Phase 0)

⚠️ **This is a development setup. NOT production-ready.**

**What's missing:**
- [ ] Password hashing implementation (bcrypt setup ready)
- [ ] Rate limiting on login endpoint
- [ ] Input validation middleware
- [ ] HTTPS/SSL certificates
- [ ] CORS restrictions for production domains
- [ ] SQL injection protection (pg library handles this, but validate inputs)
- [ ] File upload validation (size, type, malware scan)
- [ ] Session expiry enforcement
- [ ] Audit logging implementation

**Before deploying to production:**
1. Change the default admin password in seed data
2. Generate strong SESSION_SECRET and JWT_SECRET
3. Enable HTTPS (required for GPS and GCash)
4. Restrict CORS to your frontend domain
5. Set up database backups (pg_dump daily)
6. Add rate limiting (express-rate-limit)
7. Implement proper input validation (joi or zod)

---

## 🧪 Testing the Database

**Check table count:**

```bash
psql -U postgres -d juflow -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"
```

**View seed data:**

```sql
-- Roles
SELECT * FROM roles;

-- Default admin user (password needs to be hashed properly)
SELECT id, username, full_name, role_id, is_active FROM users;

-- Categories
SELECT * FROM categories;

-- Products
SELECT sku, name, price_centavos / 100.0 AS price_php FROM products;

-- Delivery zones
SELECT name, fee_centavos / 100.0 AS fee_php FROM delivery_zones;
```

**Test relationships:**

```sql
-- Products with their categories
SELECT p.sku, p.name, c.name AS category, p.price_centavos
FROM products p
JOIN categories c ON p.category_id = c.id;
```

---

## 📝 API Documentation

### Current Endpoints

#### Health Check
```
GET /api/health
```

**Response:**
```json
{
  "status": "ok",
  "mode": "juflow-api-v1",
  "timestamp": "2026-10-06T01:00:00.000Z",
  "timezone": "Asia/Manila"
}
```

### Coming in Phase 1

#### Authentication
```
POST /api/auth/login
POST /api/auth/logout
GET /api/auth/me
POST /api/auth/change-password
```

#### Users
```
GET /api/users           - List users
POST /api/users          - Create user
PATCH /api/users/:id     - Update user
POST /api/users/:id/reset-password
```

#### Riders
```
GET /api/riders          - List riders
POST /api/riders         - Add rider
PATCH /api/riders/:id    - Update rider
```

---

## 🐛 Troubleshooting

### Database Connection Failed

**Error:** `ECONNREFUSED` or `password authentication failed`

**Fix:**
1. Check PostgreSQL is running: `pg_isready`
2. Verify credentials in `.env`
3. Test connection: `psql -U postgres -d juflow`

### Migration Failed

**Error:** `relation "xyz" already exists`

**Fix:**
```sql
-- Drop and recreate database
DROP DATABASE juflow;
CREATE DATABASE juflow;
```

Then run migrations again: `npm run migrate`

### Port Already in Use

**Error:** `EADDRINUSE: address already in use :::3000`

**Fix:**
```bash
# Find process using port 3000
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Kill the process or change PORT in .env
```

### bcrypt Installation Failed

**Error:** `node-pre-gyp install --fallback-to-build --module_name=bcrypt_lib`

**Fix:**
```bash
# Windows: Install Visual Studio Build Tools
npm install --global windows-build-tools

# macOS: Install Xcode Command Line Tools
xcode-select --install

# Try again
npm install bcrypt
```

---

## 📂 Project Structure

```
server/
├── src/
│   ├── db/
│   │   ├── migrations/
│   │   │   ├── 001_init.sql         ✅ 29 tables
│   │   │   └── 002_seed_data.sql    ✅ Initial data
│   │   ├── pool.js                  ✅ Database connection
│   │   └── migrate.js               ✅ Migration runner
│   ├── middleware/
│   │   └── auth.js                  ✅ Authentication
│   ├── routes/                      🔨 Phase 1
│   │   ├── auth.js
│   │   ├── users.js
│   │   ├── riders.js
│   │   └── ... (more in later phases)
│   └── index.js                     ✅ Express server
├── uploads/                         📁 File storage
├── .env                             🔒 Configuration
├── .env.example                     ✅ Template
├── .gitignore                       ✅ Git rules
├── package.json                     ✅ Dependencies
└── README.md                        📖 This file
```

---

## 🤝 Contributing

This is a capstone project for Ju Kitchen. Development follows the 12-week implementation plan.

**Before coding:**
1. Check the phase/week in the roadmap
2. Read the corresponding section in `JuFlow Admin Completion Plan.md`
3. Follow the database design (no schema changes without updating migrations)
4. Test with Postman before integrating with frontend

---

## 📞 Support

**Database issues:** Check PostgreSQL logs  
**API errors:** Check server console output  
**Migration problems:** Drop database and re-run migrations

**Deployment questions:** Wait until Phase 6 (Week 14-15)

---

## 📜 License

Capstone project — Ju Kitchen © 2026

---

**Last Updated:** October 6, 2026  
**Phase:** 0 (Setup Complete)  
**Next Milestone:** Phase 1 — Authentication & User Management

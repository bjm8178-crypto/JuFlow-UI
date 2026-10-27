# JuKi Admin Backend API

**JuKi Kitchen Operations Management System — Node.js + Express**

Complete backend API for JuKi Kitchen Operations.

---

## 🎯 Architecture Overview

- **Runtime:** Node.js 20+ (ES Modules)
- **Framework:** Express 4
- **Database:** PostgreSQL (production via `DATABASE_URL`). MongoDB support is legacy and being phased out.
- **Authentication:** HttpOnly cookie sessions with hashed tokens (`auth_sessions`), bcrypt password hashing, and role-based access control (RBAC).
- **Service Area:** Saog, Marilao, Bulacan (Coordinates: `14.763649, 120.956218`)
- **Port:** `3000` (API backend)

---

## 📦 Implemented API Modules

| Route Endpoint | Description | Auth / Role |
|---|---|---|
| `POST /api/auth/login` | Staff / Admin authentication | Public |
| `POST /api/auth/logout` | Session invalidation | Authenticated |
| `GET /api/auth/me` | Current profile information | Authenticated |
| `POST /api/auth/change-password` | Password change & session revocation | Authenticated |
| `GET/POST /api/users` | Staff user management | Admin |
| `PATCH /api/users/:id` | Update staff details / active status | Admin |
| `POST /api/users/:id/reset-password` | Admin reset with session revocation | Admin |
| `GET/POST/PUT/DELETE /api/categories` | Product category taxonomy | Admin (write) |
| `GET/POST/PUT/DELETE /api/products` | Menu catalog & pricing (centavos) | Admin (write) |
| `GET/POST/PUT/DELETE /api/customers` | Customer directory & doorstep GPS coordinates | Authenticated |
| `GET/POST/PATCH /api/orders` | Customer order lifecycle management | Authenticated |
| `GET/POST /api/sales` | Sales ledger with SHA-256 idempotency | Cashier / Admin |
| `GET /api/sales/summary` | Analytics & reporting aggregations | Authenticated |
| `GET/POST/PATCH /api/deliveries` | Rider delivery assignments & tracking | Authenticated / Rider |
| `GET/POST/PUT /api/riders` | Fleet riders management | Admin |
| `GET/PUT /api/delivery-zones` | Delivery zone pricing and coverage | Admin (write) |
| `GET/PUT /api/settings` | Key-value system configuration | Admin (write) |
| `GET /api/health` | Service health status check | Public |

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

**Production (PostgreSQL — recommended):**

```env
DATABASE_URL=postgres://user:password@host:5432/juflow
PORT=3000
NODE_ENV=production
TZ=Asia/Manila
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<a-strong-password>
CORS_ORIGINS=https://your-domain.vercel.app
TRUST_PROXY=1
```

> ⚠️ **Never use a default password in production.** The first admin account is created from `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables on Render (or your hosting provider). There is no seed script or hard-coded `admin123` login.

**Local development (MongoDB):**

```env
MONGODB_URI=mongodb://localhost:27017
DB_NAME=juflow_dev
PORT=3000
NODE_ENV=development
TZ=Asia/Manila
```

### 3. Run Server

```bash
npm run dev      # Development with watch mode
# or
npm start        # Production start
```

### 4. Run Test Suite

```bash
npm test
```

Executes native unit tests for all route modules, password verification, price validations, and sales idempotency hashing.

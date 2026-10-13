# 🎉 Juki Architecture & Backend Foundation Summary

**Ju Kitchen Operations Management System**  
**Stack:** Node.js (Express) + MongoDB & Python Admin Server (SQLite)

---

## 📦 System Architecture

The Juki system provides complete kitchen and operations management for Ju Kitchen in Saog, Marilao, Bulacan:

```
server/                                  ← REST API BACKEND (Node.js + MongoDB)
├── src/
│   ├── db/
│   │   ├── mongodb.js                  ✅ MongoDB client, auto-indexes & connection pool
│   │   └── seed.js                     ✅ Initial roles, admin, menu, zones & settings
│   ├── middleware/
│   │   └── auth.js                     ✅ Token session authentication & RBAC
│   ├── routes/
│   │   ├── auth.js                     ✅ Login, logout, me, password change
│   │   ├── users.js                    ✅ Staff management, role enforcement, security guards
│   │   ├── riders.js                   ✅ Rider fleet management
│   │   ├── products.js                 ✅ Menu items, centavos pricing, soft-delete filtering
│   │   ├── categories.js               ✅ Product categories & category deletion guards
│   │   ├── customers.js                ✅ Customer profiles & doorstep GPS coordinates
│   │   ├── orders.js                   ✅ Kitchen order lifecycle & address snapshots
│   │   ├── sales.js                    ✅ Sales transaction ledger & reporting summary
│   │   ├── deliveries.js               ✅ Rider dispatch & status synchronization
│   │   ├── settings.js                 ✅ Key-value operational configuration
│   │   └── delivery-zones.js           ✅ Fee schedules & delivery coverage
│   └── index.js                        ✅ Express application setup & middleware
├── test/
│   └── api.test.js                     ✅ Native test suite (12 tests)
└── package.json                        ✅ Configured scripts (start, dev, seed, test)
```

---

## 🔒 Security Hardening Implemented

1. **Password Hash Stripping**: `password_hash` is completely omitted from all user endpoints (`GET /api/users`, `PATCH /api/users/:id`, `POST /api/users`, `POST /:id/reset-password`).
2. **Account Protection**:
   - Admins cannot deactivate their own accounts.
   - The system prevents deactivating or demoting the last active administrator.
   - Changing or resetting a password revokes all active sessions for that user.
3. **Seed Guard**: Destructive seeding is prevented in `NODE_ENV=production` unless `ALLOW_SEED_IN_PRODUCTION=true` is explicitly provided.
4. **Data Integrity**:
   - Soft-deleted menu items (`is_active: false`) are filtered from the public catalog.
   - Strict price validation accepts `0` (free/promotional) and rejects negative or `NaN` values.
   - TTL index on `auth_sessions` automatically purges expired sessions in MongoDB.

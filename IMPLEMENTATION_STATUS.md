# JuFlow Implementation Status

**Last updated:** 2026-10-12
**How this was checked:** by reading the code. Nothing here has been run against a real MongoDB, Render or Vercel yet, and `npm test` was not run for this update. Treat "done" as "present in code".

## Modules

| Module | Where | State |
|---|---|---|
| Login, cookie sessions, roles (admin / cashier / rider) | `server/src/routes/auth.js`, `api.js`, `auth-guard.js`, `login.html` | In code |
| Users page (create cashier / admin / rider, reset password, enable / disable) | `users.html`, `server/src/routes/users.js` | In code. Choosing Rider also creates the rider profile |
| Dishes: add, edit, delete, name, picture, price, "Serve today" | `dishes.html`, `server/src/routes/products.js`, `menu.js` | In code |
| Cashier sales (+ / − then Apply, offline retry) | `cashier/index.html`, `server/src/routes/sales.js` | In code |
| Business analytics (hourly, top dishes by `product_id`, cash / GCash split, last 7 days, CSV) | `sales.html`, `dashboard.html`, `analytics.js` | In code. Refresh every 10 s |
| Customers and orders saved on the server | `workflow.js`, `store.js` (display helpers only) | In code. No business records in browser storage |
| Customer landmark photos (GridFS) | `server/src/routes/media.js`, `services/media.js`, `landmarks.js` | Routes were not mounted until now; `/api/customers/:id/landmark` and `/api/media/:id` are mounted in `server/src/index.js` |
| Deliveries, riders, delivery map, rider offline app | `admin-deliveries.js`, `rider.html`, `rider.js`, `outbox.js`, `delivery-map.html` | In code |
| Cashier delivery-confirmation queue | `cashier.html`, `cashier.js` | In code. Linked both ways with `cashier/index.html` |

## Deployment items

| Item | State |
|---|---|
| `/api/health` and `/api/ready` | In code (`server/src/index.js`) |
| Origin check, cookie CSRF defence, `CORS_ORIGINS` and `TRUST_PROXY` required in production | In code (`server/src/lib/config.js`) |
| Seeding blocked in production | In code (`seedAllowed`) |
| Vercel build allowlist (`scripts/build-frontend.mjs`) | Includes cashier, rider and users pages |
| Content-Security-Policy in `vercel.json` | Added. Allows inline scripts and styles because the pages use them (see `DEPLOYMENT.md`) |
| `vercel.json` Render URL | **Still the guessed `https://juflow-api.onrender.com`.** Replace after the first Render deploy and update the pinned URL in `tests/frontend.test.mjs` |

## Not done or not verified

- Two-device test against a real database (customers, orders, deliveries shared across devices).
- One end-to-end run: admin adds a dish and sets today's menu, cashier sells it, the sale appears on `sales.html`.
- `npm test` in the project root and in `server/`.
- Startup failing loudly when index creation fails (F09). The code path was not checked.
- `server/src/routes/customer-imports.js` exists but is not mounted and no page uses it.
- Order, rider-authorization and settlement logic (F03 to F06, F14): present in `server/src/lib` and `services`, but not re-audited for this update.
- Old prototype files still in the repo and not deployed: `server.py`, `auth.py`, the Python tests, `send_demo_sale.py`, `signup.html`, `admin.html`, `dashboard-mongo.html`. `serve.js` is used by the frontend tests, so keep it.
- `server/MONGODB_SETUP.md` is outdated (it describes a seed script and an `admin123` login). Do not follow it for production.
- No cashier "sold out" toggle or dish categories on the cashier screen.

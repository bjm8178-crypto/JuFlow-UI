# Deploying JuFlow: MongoDB Atlas + Render + Vercel

```
Browser ──► Vercel (static pages)
              └─ /api/* rewrite ──► Render (Node API, server/) ──► MongoDB Atlas
```

The browser only ever talks to your Vercel domain. Vercel forwards `/api/*` to Render, so the
login cookie is a normal first-party `HttpOnly` cookie (no cross-site cookie problems, no token in JavaScript).

The Python files (`server.py`, `auth.py`, SQLite) are the old local prototype. They are **not** deployed.

## 1. MongoDB Atlas
1. Create a free **M0** cluster (pick a region near Singapore).
2. Database Access → add a user with a strong password (role: *Read and write to any database*, or scoped to `juflow`).
3. Network Access → allow `0.0.0.0/0` (Render free instances have no fixed IP). The password is the protection; use a long one.
4. Connect → Drivers → copy the `mongodb+srv://…` string. Put the user/password in it (URL-encode special characters).

## 2. Render (API)
1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select the repo. `render.yaml` creates the `juflow-api` web service (root `server/`).
3. Fill the variables Render asks for:
   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | the Atlas string from step 1 |
   | `CORS_ORIGINS` | your Vercel URL, e.g. `https://juflow.vercel.app` (set after step 3, then redeploy) |
   | `ADMIN_USERNAME` / `ADMIN_PASSWORD` | the first admin login (min 8 chars) |
   | `CASHIER_API_TOKEN` | auto-generated, copy it for the cashier device |
4. After the first successful deploy check `https://<service>.onrender.com/api/health` → `{"status":"ok"…}`.
5. **Delete `ADMIN_PASSWORD`** from Render's environment. The admin only gets created when none exists.
6. The service name decides the URL. If Render gives you something other than `juflow-api.onrender.com`, edit the destination in `vercel.json`.

> Free Render instances sleep after ~15 minutes idle; the first request afterwards takes ~30–60 s. Use the *Starter* plan if the shop needs it always on.

## 3. Vercel (frontend)
1. Vercel → **Add New → Project** → import the repo.
2. Framework Preset **Other**, Build Command empty, Install Command empty, Output Directory `.` (these are also set in `vercel.json`).
3. Deploy, then copy the URL into Render's `CORS_ORIGINS` and redeploy the API.
4. Open `https://<your-app>.vercel.app/login.html` and sign in with the admin from step 2.

## 4. Cashier device
`POST https://<service>.onrender.com/api/cashier/sales` with `Authorization: Bearer <CASHIER_API_TOKEN>`
and a JSON body containing a unique `transaction_id`, `items[{name, quantity, price_centavos}]`,
`total_centavos` (must equal the item sum), `payment_method` (`cash`/`exact`/`gcash`; GCash needs `gcash_reference`).
- Retry with the same body → `200` with the stored sale (`duplicate: true`).
- Same `transaction_id` with different content → `409`.

## Environment variables (API)
See `server/.env.example`. In production the server refuses to start without `MONGODB_URI`.

## Known limits (read before going live)
- **Customers, orders and landmark photos in the UI still use browser localStorage** (`store.js`). The API routes exist
  (`/api/customers`, `/api/orders`, …) but the pages are not wired to them yet, so that data is per-browser and not shared.
- Photo uploads are not implemented in the API. Render's disk is ephemeral, so use object storage (S3/Cloudinary/R2) when you add them.
- Rate limiting is per IP and in memory (resets on restart). Accounts also lock for 30 min after 5 bad passwords.
- No automated end-to-end tests against a real MongoDB yet (`npm test` covers the middleware/validation logic with real imports).
- Rotate `CASHIER_API_TOKEN` in Render if a device is lost.

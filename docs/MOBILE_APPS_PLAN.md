# Juki Cashier & Rider Apps: Implementation Plan

**Written:** 2026-10-12
**Basis:** I read the code (frontend, `server/`, `vercel.json`, `render.yaml`, build script, tests, docs). Nothing was run. Where I say "bug" or "gap" it is from reading, so verify before fixing.
**Assumption:** Staff phones are **Android** (typical for the Philippines). iOS is covered only by "Add to Home Screen" in section 4.

---

## 1. The idea in one paragraph

You do not need to build a native app. Make the two existing web screens (cashier, rider) into **installable PWAs**, then wrap each one in a **Trusted Web Activity (TWA)**: a real, signed `.apk` that opens your Vercel site full-screen with no browser bar. It has its own icon, splash screen and app name, looks like an app, and updates whenever you deploy the website (no re-install). Two APKs: `Juki Cashier` and `Juki Rider`.

Roughly 80% of the work is making the web pages behave like apps (offline shell, instant start, in-scope login, push alerts). The APK step itself is about a day.

---

## 2. What you already have

| Piece | Where | State |
|---|---|---|
| Hosting chain | Vercel (`dist/`) → `/api/*` rewrite → Render (`server/`) → MongoDB Atlas | In code, not verified live |
| Auth | HttpOnly cookie `juflow_session`, SameSite=Lax, 24 h, roles `admin` / `cashier` / `rider` | Good for apps (first-party cookie) |
| Cashier POS | `cashier/index.html` (inline JS, own login) | Works, phone-first CSS |
| Cashier queue | `cashier.html` + `cashier.js` + `outbox.js` | Start preparing, mark ready, assign rider, confirm payment |
| Rider | `rider.html` + `rider.js` + `outbox.js` | Jobs, per-user offline outbox, foreground location sharing |
| Phone-first CSS | `styles.css` ("Cashier & Rider apps" block: `.app-bar`, `.tabbar`, 48 px buttons, safe-area insets) | Reusable as is |
| Idempotent writes | `transaction_id` (sales), `idempotency_key` (orders), `event_id` + `version` (deliveries) | Retry-safe, a strong base for offline |

---

## 3. Problems found (these decide the plan)

**Blockers for "installable app"**

1. **No manifest, service worker or icons.** Pages only set `theme-color`. Chrome will not offer install.
2. **CSP blocks service workers.** `vercel.json` has `worker-src blob:` only. A service worker from your own origin is blocked until it is `worker-src 'self' blob:`.
3. **Build allowlist.** New files (manifest, `sw.js`, icons, `.well-known/assetlinks.json`) are dropped unless added in **three** places: `scripts/build-frontend.mjs` (`FRONTEND_FILES` / `FRONTEND_DIRS`, and `checkFrontend` demands an exact match), `serve.js` (`allowed` set; its content-type map only knows html/js/css), and `tests/frontend.test.mjs` (asserts every local link is allowlisted).
4. **Pages sit outside any single scope, and login leaves the app.** `cashier.html` and `rider.html` are at the root; the POS is in `/cashier/`. `auth-guard.js` and `juflowLogout` redirect to `/login.html`. In a TWA, any navigation outside the app's scope shows Chrome's URL bar, which breaks the "looks like an app" goal. Each app needs its **own in-scope login**.
5. **Blank screen while waiting for the server.** `auth-guard.js` sets `visibility:hidden` until `/api/auth/me` answers. On Render's free tier a sleeping API takes 30–60 s, so the app looks frozen. `vercel.json` still points to a *guessed* Render URL (`IMPLEMENTATION_STATUS.md`).

**Functional gaps that matter for real use**

6. **Offline sales get the wrong timestamp.** The POS never sends `occurred_at`. `server/src/routes/sales.js` only allows backdating for admin or the device token (`allowBackdating: admin || cashierDevice`); a cashier account may only be 5 minutes in the past (`lib/sale.js`). A sale made at 2 pm and synced at 5 pm is stamped 5 pm; synced after midnight, it lands on the next business day in `sales.html`.
7. **Cashier cannot create delivery orders in an app.** Order intake lives in `customers.html` / `workflow.js` (admin pages; `auth-guard.js` bounces cashiers to `cashier.html`), although the API allows cashiers on `POST /customers` and `POST /orders`. The intake form also types items manually; the API can price from the menu via `product_id`.
8. **Two cashier pages with duplicated logic.** The POS keeps its offline queue in a global `pending_sales` key (not per user), and the tab bar does full page loads between them.
9. **Cash confirmation asks for "integer centavos"** (`cashier.js`). Easy to mistype on a phone.
10. **Rider list never shrinks.** `GET /api/riders/me/deliveries` has no status filter or limit; `rider.js` renders everything, so history piles up forever.
11. **Rider tracking stops exactly when it is needed.** `rider.js` stops location on `visibilitychange`, and polling (`outbox.poll`) pauses when hidden. Tapping "Google directions" backgrounds the app, so sharing ends while riding, and a locked screen means no new-assignment alert. Browsers/TWAs cannot track in the background.
12. **Rider cannot set own availability.** Only admin can `PATCH /riders/:id`.
13. **Logout leaves customer data on the phone.** The rider's cached jobs and outbox in localStorage are not cleared on sign-out.
14. **Phone numbers are plain text** (no `tel:` link).
15. **Session is a fixed 24 h** (`SESSION_MS` in `routes/auth.js`), not sliding; sign-in needs a network.
16. **Camera is blocked** by `Permissions-Policy: camera=()`. Matters only if you add delivery-proof photos later.

**Not yet verified (from `IMPLEMENTATION_STATUS.md`):** two-device test, one end-to-end sale on the real stack, `npm test` in root and `server/`. Do these first (Phase 0).

---

## 4. Packaging options

| Option | What it is | Verdict |
|---|---|---|
| **PWA only** | Install from Chrome ("Install app") | Required anyway. Good for iPhone ("Add to Home Screen") |
| **TWA APK** (Bubblewrap / PWABuilder) | Signed APK that opens your site full-screen in Chrome's engine | **Recommended for Android.** Shares Chrome cookies, supports push, geolocation, Web Bluetooth. Updates are instant |
| **Capacitor / native shell** | Real native project loading your site | Only if you need background GPS, FCM push, or a printer SDK. Phase 7 (optional) |
| **Plain WebView APK** | Minimal Android WebView | Avoid: weak push, cookie and permission handling |

**TWA rules to design for:**
- Needs `https://<your-domain>/.well-known/assetlinks.json` containing your signing key's SHA-256, or Chrome shows the URL bar.
- Use a **custom domain** you will keep. If the domain changes, installed APKs stop being "trusted" and need rebuilding.
- Pages outside `scope` open with a browser bar, so keep each app (including its login) inside `/cashier/` or `/rider/`.
- Keep the signing keystore **backed up**. Losing it means you can never update the installed app.

---

## 5. Target structure

```
/cashier/                     scope + start_url=/cashier/?source=app
  index.html                  shell + login + bottom tabs (hash routes)
  app.js  pos.js  orders.js  new-order.js  today.js
  manifest.webmanifest
  sw.js                       generated at build time (precache list + hash)
/rider/
  index.html  app.js  jobs.js  history.js
  manifest.webmanifest
  sw.js
/shared/                      (or root) app-shell.js, outbox-idb.js, ui.js
/icons/                       cashier-192/512/maskable, rider-192/512/maskable
/.well-known/assetlinks.json  (one file lists both package names)
```

- **One HTML page per app, hash routing** (`#/sell`, `#/orders`, `#/new-order`, `#/today`, `#/me` for cashier; `#/jobs`, `#/history`, `#/me` for rider). Tab switches are instant and auth runs once.
- **Keep it vanilla JS.** The repo is a static allowlisted build; no framework or bundler is needed.
- **Old URLs keep working** via Vercel redirects (`/cashier.html` → `/cashier/#/orders`, `/rider.html` → `/rider/`), so admin bookmarks do not break. Update `defaultRoute()` in `api.js` and `auth-guard.js`, `canAccess()`, and `safeNext()` in `login.html` to the new paths.
- **Per-app service worker, generated by the build script** from one template, so each app precaches only its own files and cache names stay separate.
- Extract the POS inline script from `cashier/index.html` into files (CSP currently allows inline, but files are easier to test).

---

## 6. Phases

Estimates are focused working days for one developer. **Fast path:** Phase 0 + 1 + 5 gives installable APKs of your *current* screens in about a week; the rest improves them.

### Phase 0: Gate and decisions (1 day)

- [ ] Deploy Render, replace the guessed URL in `vercel.json` **and** the pinned copy in `tests/frontend.test.mjs`.
- [ ] Decide custom domain (e.g. `app.jukitchen.ph`) and attach it in Vercel; update `CORS_ORIGINS` on Render.
- [ ] Render plan: **Starter (always on)** for the shop. Free-tier cold starts will make the apps feel broken. (Stop-gap: an uptime ping every 5 min.)
- [ ] Run `npm test` in root and `server/`; do the two-device test and one end-to-end sale from `DEPLOYMENT.md` section 4.
- [ ] Answer the questions in section 14.

**Done when:** a cashier sale shows on `sales.html`, and a delivery order flows cashier → rider → cashier-confirmed on two real phones.

### Phase 1: Installable PWAs (3 days)

1. Create `/cashier/` and `/rider/` structure; move rider page in; add in-scope login screens (cashier already has one; copy the pattern for rider). 401 → show that app's login, never `/login.html`.
2. Replace `auth-guard.js` blank-screen behavior in the apps: render the shell immediately, show a skeleton/"Connecting…" state, then fill when `/auth/me` returns. Cache the last known user name for instant header text.
3. `manifest.webmanifest` per app: `name`, `short_name`, `id`, `start_url`, `scope`, `display: standalone`, `orientation: portrait`, `theme_color: #bc5125`, `background_color: #f7f8f4`, icons (192, 512, maskable 512), `shortcuts`.
4. Icons: use the existing "J•" brand mark. **Cashier = orange, Rider = green (`#39735b`)** so staff can tell them apart. Maskable icons need the mark inside the central 80% safe zone.
5. Service worker (generated):
   - **Precache** shell: app HTML/JS, `styles.css`, shared JS, icons, an `offline.html`.
   - **Navigations:** network-first with a ~3 s timeout, fall back to cached shell.
   - **Static assets:** stale-while-revalidate.
   - **`/api/*`: network only**, never cached, because it is authenticated and personal, with two exceptions: `GET /api/menu/today` (last-good copy, shown as "menu from HH:MM") and `/api/media/*` dish images (cache-first, size-capped).
   - Update flow: `skipWaiting` + a "New version, tap to refresh" toast. **Never reload mid-sale.**
6. `vercel.json`: add `worker-src 'self' blob:`; headers `Cache-Control: no-cache` on `sw.js`, `application/manifest+json` on manifests, `application/json` on `assetlinks.json`; add the two redirects.
7. Build allowlist: update `FRONTEND_FILES`/`FRONTEND_DIRS` (`cashier`, `rider`, `icons`, `.well-known`, `shared`), `checkFrontend`, `serve.js` allowed set + content types (`.json`, `.webmanifest`, `.png`, `.svg`), and `tests/frontend.test.mjs`.
8. Install UX: capture `beforeinstallprompt`, show an "Install app" button on the login screen and in `#/me`. Connectivity pill (`● online` / `n unsent`) in the app bar.

**Done when:** on an Android phone, Chrome offers install for each app; the installed app opens full-screen with its own icon; in airplane mode it still opens to the shell with a clear "offline" state; Lighthouse "Installable" passes.

### Phase 2: Cashier app v1 (5-6 days)

1. **Shell:** bottom tabs `Sell · Orders · New order · Today · Me`. One shared login/session.
2. **Sell (POS):** reuse the existing menu grid. Changes:
   - Send **`occurred_at`** (UTC ISO) when the sale is recorded; store it in the queued payload so retries are identical.
   - **Server fix:** allow `cashier` role backdating up to 24 h when `occurred_at` is given (`routes/sales.js`, `allowBackdating`), with a test.
   - Move the queue to **IndexedDB, scoped per user**; migrate any legacy `pending_sales`.
   - Cache `/menu/today`; show "using saved menu" when offline.
   - Show **change due** for cash, "Undo last line", clear cart, big total, haptic + sound on success.
   - Nice later: sold-out toggle and categories (listed as missing in `IMPLEMENTATION_STATUS.md`).
3. **Orders:** port `cashier.html`/`cashier.js` into the shell. Fix the cash-confirmation field to take **pesos** and convert to centavos. Keep `version`/`event_id` handling from `outbox.js`.
4. **New order (delivery):** customer search / quick-add (`GET`/`POST /customers`, allowed for cashier), pick items from today's menu (`product_id`, server-priced), delivery fee, payment method, address confirmation, `idempotency_key` per attempt. Port the logic from `workflow.js` (`orderValues`, `saveOrder`, fingerprint check). **Online-only** with a clear message.
5. **Today:** the cashier's day at a glance (sales count, cash vs GCash, recent sales). Needs a small read-only endpoint (see section 7).
6. **Me:** name, role, install button, app version, queue status ("2 sales unsent"), sign out with a warning if anything is unsent.

**Done when:** a cashier can sell offline for an hour, reconnect, and see those sales land in `sales.html` at their **real** hours; and can take a phone order end-to-end without opening any admin page.

### Phase 3: Rider app v1 (4-5 days)

1. **Shell:** tabs `Jobs · History · Me`. In-scope login.
2. **Server:** `GET /riders/me/deliveries?filter=active|history&limit=` (section 7). Jobs shows active only; History shows the last 30 days.
3. **Job card/detail:** big status badge, customer name, address, landmark, landmark photo, items, notes, and payment line ("Collect ₱X cash / Paid via GCash"). Make the phone a **`tel:` link**; add a "Copy address" button.
4. **Navigation:** keep Google Maps directions; add a Waze link. Requires `shop_lat`/`shop_lng` in settings and customer pins (already how `map-config.js` works); show a clear message when missing.
5. **Primary action:** one large button for the next step (`picked_up → on_the_way → arrived → report_delivered`). Use **press-and-hold or confirm sheet** for "Report delivered" to prevent mis-taps. Surface `409`/blocked outbox items as a readable "needs your review" card (the logic exists in `outbox.js`).
6. **On duty toggle** (new endpoint) so a rider can mark themselves unavailable.
7. **Screen Wake Lock** while a delivery is active and sharing is on.
8. **Location policy (decide in section 14):** default = foreground-only, as the code intends. Improve it by **attaching the latest location to each status event** so the admin map still moves at every step even when the app was backgrounded.
9. **Privacy:** on sign-out, clear `juflow:rider:jobs:*` and offer to keep or discard unsent outbox items.

**Done when:** a rider can do a full delivery on one phone with spotty data (events queue and sync), History does not grow the active list, and sign-out leaves no customer data behind.

### Phase 4: Alerts and background sync (3-4 days)

Without this, a rider with the screen off never learns about a new job.

1. **Web Push** (works in installed PWA and TWA on Android Chrome). Server: `web-push` dependency, VAPID keys in Render env, `push_subscriptions` collection, `POST/DELETE /api/push/subscribe`.
2. **Triggers:** assign → that rider; rider `report_delivered` → cashiers ("JU-123 awaiting confirmation"); cancel → that rider. Keep payloads PII-free (order number only). Delete subscriptions on `404`/`410`.
3. **Client:** ask permission from a button tap (not on load); notification click deep-links to `#/jobs/<id>` or `#/orders`; badge count in the tab.
4. **Background Sync** (optional): flush the IndexedDB outbox even if the app is closed. Fallback stays: `online` event + 15 s timer.
5. Polling stays as the safety net.

**Done when:** with the rider's screen locked, assigning an order makes the phone buzz within seconds.

### Phase 5: Package the APKs (1-2 days)

1. Pick package IDs: `ph.jukitchen.cashier`, `ph.jukitchen.rider` (use your real domain; they cannot change later).
2. Generate each app with **PWABuilder** (cloud, no local tooling) or **Bubblewrap CLI** (needs JDK + Android SDK). Point at `https://<domain>/cashier/manifest.webmanifest` and `/rider/manifest.webmanifest`.
3. Create **one keystore**, back it up in two places, record its SHA-256.
4. Publish `/.well-known/assetlinks.json` listing both package names + fingerprint. Verify with Google's Digital Asset Links tester.
5. Install on a phone (`adb install` or direct download); confirm **no URL bar** appears anywhere, including after login and sign-out.
6. Distribution: sideload via a QR/link (fine for a few staff phones). Play Store internal/closed testing is optional (needs a developer account; if you use Play App Signing, add Google's fingerprint to `assetlinks.json` too).

**Done when:** both APKs install on a clean phone, open to their login, and never show browser chrome.

### Phase 6: QA, hardening, pilot (3-4 days)

- Device matrix: one low-end Android (2-3 GB RAM, Android 8-10), one mid-range, Chrome set to throttled "Slow 3G".
- Offline scripts (section 11), two-phone scenarios, session-expiry mid-shift, phone restart with unsent queue, Render restart during a sale.
- Security review (section 10).
- **Pilot:** 1 cashier + 1 rider for one week; the website stays available as fallback. Collect issues, then roll out.

### Phase 7 (optional): Native shell, only if proven necessary

Switch the rider app to Capacitor only if the pilot shows you truly need **continuous background GPS** (foreground service + persistent notification), FCM push, or a thermal-printer SDK. This is a bigger commitment (Play policy review for background location). Try the Phase 3 location approach first.

---

## 7. Backend changes (all small)

| Change | Where | Why |
|---|---|---|
| Cashier may backdate `occurred_at` up to 24 h | `routes/sales.js` (`allowBackdating`), `lib/sale.js` tests | Offline sales keep real time (finding 6) |
| `GET /riders/me/deliveries?filter=&limit=` | `routes/riders.js` | Active vs history, bounded (finding 10) |
| `PATCH /riders/me` `{ is_available }` | `routes/riders.js` (rider role, own profile only) | On-duty toggle (finding 12) |
| `GET /sales/today` (cashier + admin, read-only) | `routes/sales.js` | "Today" tab. **Decide:** shop-wide totals or only the cashier's own sales |
| Optional `location` on delivery events | `services/fulfillment.js`, `riders.js` validation | Position at each step despite background limits |
| Push: subscribe/unsubscribe + triggers | new `routes/push.js`, hooks in `fulfillment.js` | Alerts (Phase 4) |
| Optional: sliding or longer session for rider/cashier devices | `routes/auth.js` | Avoid mid-shift logouts (finding 15) |

Keep all existing idempotency rules (`transaction_id`, `idempotency_key`, `event_id` + `version`); the apps depend on them.

---

## 8. "Feels like an app" checklist

- Standalone display, portrait lock, splash from icon + `background_color`, status-bar color via `theme-color`.
- Instant start from cached shell; skeleton placeholders instead of blank screens or spinners-only.
- Bottom tab bar (already styled), hash routes so the **Android Back button** goes to the previous screen instead of closing the app. Dialogs and sheets push a history entry.
- Touch: 48 px targets (mostly there), `touch-action: manipulation`, no text selection on buttons, `overscroll-behavior: none` + a custom pull-to-refresh, 16 px inputs (avoids iOS/Android zoom).
- Feedback: haptic (`navigator.vibrate`) on success/error, soft sound on new order, toast for sync results.
- Safe-area insets (already in `.app-bar` / `.tabbar`), respect `prefers-reduced-motion` (already global).
- App version and "last synced" shown in `#/me`.
- Copy: keep strings short; consider Filipino labels later.

---

## 9. Offline rules

| Action | Offline? | How |
|---|---|---|
| Open the app | Yes | Cached shell |
| Sign in | No | Needs server; show a clear message |
| Sell at POS | **Yes** | Cached menu + IndexedDB queue, stable `transaction_id`, `occurred_at` |
| Rider status events | **Yes** | Existing outbox; server `version` check may mark conflicts "blocked" |
| Rider location | Latest only | Queue the newest sample; drop older |
| New delivery order | No | Needs server order numbering and customer lookup |
| Mark preparing / ready / assign | No | Needs fresh `version` |
| Confirm payment | No | Safety-critical; needs live data |

Queue storage moves from localStorage to IndexedDB (bigger quota, readable by the service worker for Background Sync), namespaced per user.

---

## 10. Security notes

- **Never cache `/api/*` responses** in the service worker (except the two listed). Purge caches on sign-out.
- Cookies stay `HttpOnly` + `SameSite=Lax` + `Secure` in production. Keep the Origin allow-list (`CORS_ORIGINS`) in sync with the custom domain.
- Lost phone: admin disables the user (`users` page); the API already returns 403 for inactive users. Document this as the procedure.
- Keystore and `CASHIER_API_TOKEN` are secrets; neither belongs in the repo (`.gitignore` already covers `*.keystore`-style names only partly: add `*.jks`, `*.keystore`).
- CSP still allows `'unsafe-inline'`; moving the POS script to a file lets you tighten it later.
- Shared IP: login limiter is 20 per 15 min **per IP**; a shop with several staff on one Wi-Fi is fine, but note it when debugging lockouts.
- Push payloads carry no customer data.

---

## 11. Testing plan

**Automated (`node --test`, add `tests/pwa.test.mjs`):**
- Each manifest is valid JSON; `start_url` is inside `scope`; icons referenced exist in `dist/`.
- Generated `sw.js` precache list ⊆ `dist/` files; cache name changes when content changes.
- `vercel.json` CSP contains `worker-src 'self'`; `assetlinks.json` has both package names.
- Build allowlist test, `serve.js` content types, and redirects updated.
- Server tests: cashier backdating window, `/riders/me/deliveries` filters, availability patch, push subscribe, `sales/today` authorization.
- Outbox tests (existing `outbox.js` logic) extended for IndexedDB storage and per-user scoping.

**Manual / device scripts:**
1. Airplane mode → open app → sell 3 items → reconnect → sales appear with original times.
2. Kill the app mid-sale → reopen → cart or queue intact.
3. Rider: take 4 status events offline → reconnect → delivery reaches `awaiting_cashier_confirmation`; cashier confirms.
4. Two cashier phones open the same order → second action gets a clean "refresh" message (409 path).
5. Session expiry → login screen appears **in-app**, no URL bar, unsent queue preserved.
6. Sign-out as rider → no jobs/outbox left in storage.
7. Update test: deploy a new version → toast appears → refresh works without losing the queue.
8. Render sleeping → app shows shell + "Connecting…" instead of a blank screen.

---

## 12. Release and updates

- **Web changes** (screens, logic, fixes): deploy to Vercel; phones pick up the new version via the service worker (toast → refresh). No APK change.
- **APK changes** are rare: new icon/name, new domain, Android target-SDK bump. Bump `versionCode`, rebuild, re-sign with the **same keystore**.
- Keep a short `RELEASE.md` with: keystore location, SHA-256, package IDs, domain, how to regenerate APKs.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Render free tier sleeps → "broken" app | Starter plan; shell renders without waiting for the API |
| Domain changed later → TWA shows URL bar | Choose the custom domain first (Phase 0) |
| Keystore lost → cannot update APK | Two offline backups; document in `RELEASE.md` |
| Rider expects live tracking while navigating | Set expectations; per-event location; evaluate Phase 7 after pilot |
| Offline queue lost if browser storage cleared | IndexedDB + "n unsent" indicator + warning on sign-out |
| iPhone staff | PWA via Safari "Add to Home Screen" (push works on iOS 16.4+ only when installed); no APK possible |
| Existing admin bookmarks break | Redirects for `/cashier.html` and `/rider.html` |

---

## 14. Decisions I need from you

1. **Android only?** (If any staff use iPhone, they use the PWA install instead of an APK.)
2. **Domain:** do you own one, or should we settle on the `vercel.app` URL for now (and accept a rebuild later)?
3. **Render plan:** are you willing to pay for always-on (Starter)?
4. **Rider tracking:** is "location shared only while the app is open, plus a position at every status step" acceptable, or do you need continuous tracking even with the screen off (that means Phase 7)?
5. **Cashier "Today" totals:** shop-wide, or only that cashier's own sales?
6. **Receipt printing?** If yes, what printer (Bluetooth thermal 58 mm?). Affects Phase 2/7.
7. **Distribution:** sideload (simple) or Google Play internal testing?
8. **Devices:** one shared cashier phone/tablet, or each cashier has their own? (Shared device = stricter sign-out and queue-per-user handling.)
9. **Language:** English only, or add Filipino labels?

---

## 15. Timeline summary

| Phase | Days | Cumulative |
|---|---|---|
| 0 Gate and decisions | 1 | 1 |
| 1 Installable PWAs | 3 | 4 |
| 5 Package APKs (can run right after Phase 1) | 1-2 | ~6 |
| 2 Cashier app v1 | 5-6 | ~12 |
| 3 Rider app v1 | 4-5 | ~17 |
| 4 Alerts and background sync | 3-4 | ~21 |
| 6 QA, hardening, pilot | 3-4 | ~25 |

About **5 working weeks** for everything; about **1 week** for installable APKs of the current screens.

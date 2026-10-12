# JuFlow Mobile Apps - Deployment Checklist

**Last Updated:** 2026-10-12  
**Status:** Pre-deployment - Ready for integration

## Overview

This checklist guides you through deploying the JuFlow Cashier and Rider PWAs to production. Follow each phase in order to ensure a smooth rollout.

---

## Phase 0: Pre-Deployment Verification

### ✅ Code Review
- [ ] Review all 15+ mobile app files
- [ ] Verify service worker logic (caching strategies)
- [ ] Check offline queue implementation (IndexedDB)
- [ ] Validate API endpoints match backend
- [ ] Review security practices (no hardcoded secrets, XSS protection)
- [ ] Ensure proper error handling throughout

### ✅ Dependencies
- [ ] No external dependencies required (vanilla JS)
- [ ] Shared utilities module created (`shared/utils.js`)
- [ ] CSS framework self-contained (`shared/styles.css`)

### ✅ Browser Support
- [ ] Tested on Chrome 90+ (Android)
- [ ] Tested on Safari 14+ (iOS)
- [ ] Verified service worker support
- [ ] Checked geolocation API availability (rider app)
- [ ] Confirmed Wake Lock API support (rider app)

---

## Phase 1: Backend Integration (Critical Path)

### 1.1 New API Endpoints

**Required for functionality:**

```javascript
// Rider availability toggle
PATCH /api/riders/me
Body: { is_available: boolean }
Auth: rider (own profile only)
Returns: { rider: { ...updatedRider } }
```

```javascript
// Rider location updates
POST /api/riders/me/location
Body: { 
  latitude: number,
  longitude: number, 
  accuracy: number,
  timestamp: string (ISO 8601)
}
Auth: rider
Returns: 200 OK
```

```javascript
// Rider deliveries with filters
GET /api/riders/me/deliveries?filter=active|history&limit=30
Auth: rider
Returns: {
  deliveries: [
    { ...delivery, status, customer, items, payment, ... }
  ]
}
// active = assigned|picked_up|on_the_way|arrived|awaiting_cashier_confirmation
// history = delivered|cancelled
```

```javascript
// Cashier daily summary
GET /api/sales/today
Auth: cashier, admin
Returns: {
  total_sales: number,
  cash_total_centavos: number,
  cash_count: number,
  gcash_total_centavos: number,
  gcash_count: number,
  total_revenue_centavos: number,
  recent_sales: [{ ...sale }] // last 10
}
```

**Endpoint modifications:**

```javascript
// Sales backdating support
POST /api/sales
Body: {
  dishes: [{ dish_id, quantity }],
  transaction_id: string (UUID),
  cashier_id: string,
  payment_method: "cash" | "gcash",
  occurred_at: string (ISO 8601, optional, max 24h ago)
}
// Use occurred_at for reports instead of created_at
```

**Testing checklist:**
- [ ] Create endpoint stubs with 501 Not Implemented
- [ ] Implement each endpoint with validation
- [ ] Add auth middleware (cashier/rider role checks)
- [ ] Test with Postman/curl
- [ ] Verify error responses (400, 401, 403, 422)
- [ ] Add integration tests

### 1.2 Existing Endpoint Verification

**Verify these work correctly:**
- [ ] `POST /api/auth/login` (cashier and rider roles)
- [ ] `POST /api/auth/logout`
- [ ] `GET /api/auth/me`
- [ ] `GET /api/menu/today`
- [ ] `POST /api/sales`
- [ ] `GET /api/deliveries`
- [ ] `POST /api/deliveries/:id/actions`
- [ ] `POST /api/deliveries/:id/events`
- [ ] `POST /api/deliveries/:id/assign`
- [ ] `POST /api/deliveries/:id/confirm`
- [ ] `GET /api/customers`
- [ ] `POST /api/customers`
- [ ] `POST /api/orders`
- [ ] `GET /api/riders`

**Test scenarios:**
- [ ] Login as cashier → access cashier endpoints
- [ ] Login as rider → access rider endpoints
- [ ] Cross-role access denied (cashier can't access rider-only endpoints)
- [ ] Session expires after 24h
- [ ] 401 responses include proper CORS headers

---

## Phase 2: Frontend Build Integration

### 2.1 Update Build Script

Edit `scripts/build-frontend.mjs`:

```javascript
const FRONTEND_FILES = [
  // ... existing files ...
  
  // Mobile cashier app
  'cashier/index.html',
  'cashier/app.js',
  'cashier/pos.js',
  'cashier/orders.js',
  'cashier/new-order.js',
  'cashier/today.js',
  'cashier/me.js',
  'cashier/manifest.webmanifest',
  'cashier/sw.js',
  
  // Mobile rider app
  'rider/index.html',
  'rider/app.js',
  'rider/jobs.js',
  'rider/history.js',
  'rider/me.js',
  'rider/manifest.webmanifest',
  'rider/sw.js',
  
  // Shared mobile
  'shared/styles.css',
  'shared/utils.js',
  
  // Icons
  'icons/cashier-192.png',
  'icons/cashier-512.png',
  'icons/cashier-maskable-512.png',
  'icons/rider-192.png',
  'icons/rider-512.png',
  'icons/rider-maskable-512.png',
  
  // TWA support
  '.well-known/assetlinks.json'
];

const FRONTEND_DIRS = [
  // ... existing dirs ...
  'cashier',
  'rider',
  'shared',
  'icons',
  '.well-known'
];
```

**Verify:**
- [ ] All 22+ mobile files added to `FRONTEND_FILES`
- [ ] All 5 directories added to `FRONTEND_DIRS`
- [ ] Build script runs without errors
- [ ] `dist/` contains all mobile files

### 2.2 Update Static Server

Edit `serve.js` (or equivalent):

```javascript
const allowed = new Set([
  // ... existing files ...
  
  // Mobile apps
  '/cashier/', '/cashier/index.html',
  '/cashier/app.js', '/cashier/pos.js', '/cashier/orders.js',
  '/cashier/new-order.js', '/cashier/today.js', '/cashier/me.js',
  '/cashier/manifest.webmanifest', '/cashier/sw.js',
  
  '/rider/', '/rider/index.html',
  '/rider/app.js', '/rider/jobs.js', '/rider/history.js',
  '/rider/me.js', '/rider/manifest.webmanifest', '/rider/sw.js',
  
  '/shared/styles.css', '/shared/utils.js',
  
  '/icons/cashier-192.png', '/icons/cashier-512.png',
  '/icons/cashier-maskable-512.png',
  '/icons/rider-192.png', '/icons/rider-512.png',
  '/icons/rider-maskable-512.png',
  
  '/.well-known/assetlinks.json'
]);

// Content type mapping
const contentTypes = {
  // ... existing types ...
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json'
};
```

**Verify:**
- [ ] All mobile files in allowlist
- [ ] `.webmanifest` MIME type added
- [ ] Server responds with correct `Content-Type` headers

### 2.3 Update Frontend Tests

Edit `tests/frontend.test.mjs`:

```javascript
// Add mobile app links to validation
const expectedLinks = [
  // ... existing ...
  '/cashier/', '/cashier/app.js', '/cashier/manifest.webmanifest',
  '/rider/', '/rider/app.js', '/rider/manifest.webmanifest',
  '/shared/styles.css', '/shared/utils.js',
  '/icons/cashier-192.png', '/icons/rider-192.png'
];
```

**Run tests:**
```bash
npm test
# or
node tests/frontend.test.mjs
```

**Verify:**
- [ ] All tests pass
- [ ] No broken links to mobile assets
- [ ] No 404s in test output

---

## Phase 3: Security Configuration

### 3.1 Update Content Security Policy

Edit `vercel.json` (or equivalent):

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.jukitchen.ph; worker-src 'self' blob:; manifest-src 'self';"
        }
      ]
    }
  ]
}
```

**Critical changes:**
- [ ] `worker-src 'self' blob:` (was `blob:` only)
- [ ] `manifest-src 'self'` (for manifest files)
- [ ] `connect-src` includes API domain

**Test:**
```bash
# Check headers
curl -I https://your-domain.com/cashier/
# Should see CSP header with worker-src 'self'
```

### 3.2 CORS Configuration

Verify CORS on backend allows:
- [ ] `credentials: 'include'` from frontend
- [ ] `Access-Control-Allow-Credentials: true`
- [ ] `Access-Control-Allow-Origin` matches frontend domain (not `*`)
- [ ] Preflight OPTIONS requests handled correctly

### 3.3 Cookie Configuration

Verify session cookies:
- [ ] `HttpOnly: true`
- [ ] `Secure: true` (production only)
- [ ] `SameSite: Lax`
- [ ] `Path: /`
- [ ] `Max-Age: 86400` (24 hours)

---

## Phase 4: PWA Assets

### 4.1 Generate Icons

Follow [ICON_GUIDE.md](./ICON_GUIDE.md) to create:
- [ ] `icons/cashier-192.png`
- [ ] `icons/cashier-512.png`
- [ ] `icons/cashier-maskable-512.png`
- [ ] `icons/rider-192.png`
- [ ] `icons/rider-512.png`
- [ ] `icons/rider-maskable-512.png`

**Validation:**
- [ ] All 6 files present
- [ ] File sizes < 50 KB each
- [ ] Dimensions exactly 192×192 or 512×512
- [ ] Maskable icons: content within 80% safe zone
- [ ] Test at https://maskable.app/editor

### 4.2 Verify Manifests

**Cashier manifest** (`cashier/manifest.webmanifest`):
- [ ] `start_url: "/cashier/?source=pwa"`
- [ ] `scope: "/cashier/"`
- [ ] `id: "/cashier/"`
- [ ] `icons` array references correct files
- [ ] `theme_color: "#bc5125"`
- [ ] All icon paths resolve correctly

**Rider manifest** (`rider/manifest.webmanifest`):
- [ ] `start_url: "/rider/?source=pwa"`
- [ ] `scope: "/rider/"`
- [ ] `id: "/rider/"`
- [ ] `icons` array references correct files
- [ ] `theme_color: "#39735b"`
- [ ] All icon paths resolve correctly

**Test:**
```bash
# Validate JSON
jq . Mobile/cashier/manifest.webmanifest
jq . Mobile/rider/manifest.webmanifest
```

### 4.3 Service Worker Registration

Both apps already register service workers in `app.js`:

```javascript
// Verify this code exists:
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/cashier/sw.js')
    .then(reg => console.log('[SW] Registered'))
    .catch(err => console.error('[SW] Registration failed:', err));
}
```

**No action needed** - already implemented.

---

## Phase 5: Routing & Redirects

### 5.1 Add URL Redirects

Edit `vercel.json`:

```json
{
  "redirects": [
    {
      "source": "/cashier.html",
      "destination": "/cashier/#/orders",
      "permanent": false
    },
    {
      "source": "/rider.html",
      "destination": "/rider/",
      "permanent": false
    }
  ],
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://your-backend.onrender.com/api/:path*"
    }
  ]
}
```

**Verify:**
- [ ] Old desktop URLs redirect to mobile apps
- [ ] `/api/*` proxies to backend
- [ ] No redirect loops

### 5.2 Handle Deep Links

Both apps use hash routing - no server-side routing needed:
- `/cashier/#/sell` → POS
- `/cashier/#/orders` → Orders
- `/rider/#/jobs` → Jobs
- `/rider/#/history` → History

**Test:**
- [ ] Direct URL access works (e.g., `/cashier/#/orders`)
- [ ] Browser back button works
- [ ] Refresh preserves route

---

## Phase 6: Local Testing

### 6.1 Development Server

```bash
# Start local server
npm run serve
# or
python -m http.server 8000 -d dist/

# Open in browser
open http://localhost:8000/cashier/
open http://localhost:8000/rider/
```

**Test checklist:**
- [ ] Cashier app loads and shows login
- [ ] Rider app loads and shows login
- [ ] CSS styles applied correctly
- [ ] No console errors
- [ ] Service worker registers (check DevTools → Application)
- [ ] Manifest detected (check DevTools → Application → Manifest)

### 6.2 Offline Testing

**Chrome DevTools:**
1. Open DevTools → Network tab
2. Check "Offline" checkbox
3. Reload app

**Verify:**
- [ ] App shell loads from cache
- [ ] Login screen shows (or cached session restored)
- [ ] Offline banner appears
- [ ] POS/Jobs cached data displays
- [ ] Transactions queue in outbox

### 6.3 Service Worker Testing

**DevTools → Application → Service Workers:**
- [ ] SW status shows "activated and is running"
- [ ] Update on reload works
- [ ] Unregister and re-register works
- [ ] No SW errors in console

**Cache inspection:**
- [ ] App shell files cached
- [ ] Menu data cached (cashier)
- [ ] Delivery data cached (rider)
- [ ] Old caches cleaned up on update

---

## Phase 7: Staging Deployment

### 7.1 Deploy to Staging

```bash
# Build production bundle
npm run build

# Deploy to Vercel staging
vercel --prod=false

# Or deploy to your staging environment
git push staging main
```

**Post-deployment checks:**
- [ ] All mobile files accessible
- [ ] HTTPS enabled (required for PWA)
- [ ] Service worker registers
- [ ] Icons load correctly
- [ ] API proxy works
- [ ] Login succeeds
- [ ] Session persists across reloads

### 7.2 Mobile Device Testing

**Android (Chrome):**
1. Open https://staging.jukitchen.ph/cashier/
2. Check for "Install app" banner (may take 30s)
3. Install app
4. Verify home screen icon
5. Open from home screen (standalone mode)
6. Test all features

**iOS (Safari):**
1. Open https://staging.jukitchen.ph/cashier/
2. Tap Share → Add to Home Screen
3. Open from home screen
4. Test all features

**Test matrix:**
- [ ] Cashier app on Android low-end (2GB RAM, Android 8)
- [ ] Cashier app on Android mid-range (4GB RAM, Android 11+)
- [ ] Cashier app on iPhone (iOS 14+)
- [ ] Rider app on Android low-end
- [ ] Rider app on Android mid-range
- [ ] Rider app on iPhone

### 7.3 Network Condition Testing

**Chrome DevTools → Network:**
- [ ] Fast 3G (750 Kbps, 100ms RTT)
- [ ] Slow 3G (400 Kbps, 400ms RTT)
- [ ] Offline mode

**Verify:**
- [ ] App loads in < 5s on Fast 3G
- [ ] App remains usable on Slow 3G
- [ ] Offline mode shows cached content
- [ ] Outbox queues operations correctly

---

## Phase 8: User Acceptance Testing

### 8.1 Cashier Workflow Testing

**Scenario 1: Normal operation**
1. Login as cashier
2. Navigate to Sell tab
3. Add 3 dishes to cart
4. Complete sale (cash payment)
5. Verify order appears in Orders tab
6. Mark order as preparing
7. Mark order as ready
8. Assign to rider
9. Confirm payment received
10. Check Today tab shows sale

**Scenario 2: Offline operation**
1. Go offline (airplane mode)
2. Add 2 dishes to cart
3. Complete sale
4. Verify "Offline - Sale queued" message
5. Go back online
6. Verify sale syncs automatically
7. Check sale appears in backend

**Scenario 3: New delivery order**
1. Navigate to Orders → New order
2. Search and select customer
3. Add 2 items
4. Enter delivery address
5. Adjust delivery fee if needed
6. Submit order
7. Verify order appears in queue

### 8.2 Rider Workflow Testing

**Scenario 1: Normal delivery**
1. Login as rider
2. Mark as available
3. Enable location sharing
4. Receive new job (or check Jobs tab)
5. Accept job
6. Mark as picked up
7. Navigate to customer (Google Maps link)
8. Mark as on the way
9. Mark as arrived
10. Collect payment
11. Mark as delivered (long-press confirm)
12. Verify job appears in History

**Scenario 2: Offline operation**
1. Go offline during active delivery
2. Mark delivery events (picked up, on the way)
3. Verify events queued
4. Go back online
5. Verify events sync in correct order
6. Check backend has all events

**Scenario 3: Multiple jobs**
1. Accept 3 jobs
2. Complete them in order
3. Verify earnings accumulate
4. Check history shows all 3
5. Verify backend payment records match

### 8.3 Edge Case Testing

- [ ] Session expires during transaction → redirects to login
- [ ] Network drops mid-API call → retries automatically
- [ ] Conflicting updates (409) → shows error message
- [ ] Invalid data submission (422) → shows validation errors
- [ ] Server error (500) → shows friendly error message
- [ ] Concurrent cashiers same order → conflict detected
- [ ] Rider goes offline during delivery → events queue
- [ ] App killed mid-transaction → cart/state restored on reopen
- [ ] Location permission denied → fallback to manual entry
- [ ] Wake lock not supported → app works without it

---

## Phase 9: Performance Optimization

### 9.1 Lighthouse Audit

Run Lighthouse in Chrome DevTools:

```bash
# Or use CLI
npm install -g lighthouse
lighthouse https://staging.jukitchen.ph/cashier/ --view
lighthouse https://staging.jukitchen.ph/rider/ --view
```

**Target scores:**
- [ ] Performance: 90+
- [ ] Accessibility: 95+
- [ ] Best Practices: 95+
- [ ] SEO: 80+ (not critical for auth-required apps)
- [ ] PWA: 100 (all checks passing)

**PWA checklist must show:**
- ✅ Installable
- ✅ Service worker registered
- ✅ Offline capable
- ✅ HTTPS
- ✅ Responsive
- ✅ Splash screen configured

### 9.2 Bundle Size Optimization

**Current sizes (uncompressed):**
- Cashier app JS: ~45 KB
- Rider app JS: ~50 KB
- Shared CSS: ~17 KB
- Shared utils: ~13 KB

**Optimization opportunities:**
- [ ] Minify JS files (UglifyJS, Terser)
- [ ] Minify CSS (cssnano)
- [ ] Compress images (TinyPNG)
- [ ] Enable gzip/brotli compression
- [ ] Consider code splitting (if needed)

### 9.3 Caching Strategy Review

**Service worker caches:**
- [ ] App shell precached (instant load)
- [ ] Menu cached with 5-min expiry (cashier)
- [ ] Delivery data cached with stale-while-revalidate (rider)
- [ ] API calls never cached (except menu/deliveries)
- [ ] Old caches cleaned up on SW update

---

## Phase 10: Production Deployment

### 10.1 Pre-Production Checklist

**Code:**
- [ ] All tests passing
- [ ] No console.log statements in production code
- [ ] Error tracking configured (Sentry, LogRocket, etc.)
- [ ] Analytics configured (optional)

**Backend:**
- [ ] All new endpoints implemented
- [ ] Database migrations run
- [ ] API rate limiting configured
- [ ] Monitoring alerts configured

**Security:**
- [ ] HTTPS enforced
- [ ] CSP headers correct
- [ ] CORS configured properly
- [ ] Session cookies secure
- [ ] No secrets in client code

**Documentation:**
- [ ] README.md updated
- [ ] API documentation updated
- [ ] Staff training materials prepared
- [ ] Support contact info added

### 10.2 Production Deployment

```bash
# Final build
npm run build

# Deploy to production
vercel --prod
# or
git push production main

# Verify deployment
curl -I https://app.jukitchen.ph/cashier/
curl -I https://app.jukitchen.ph/rider/
```

### 10.3 Post-Deployment Verification

**Within 5 minutes:**
- [ ] Both apps accessible at production URLs
- [ ] Service workers register correctly
- [ ] Install prompts appear (Android Chrome)
- [ ] Login works
- [ ] One successful sale transaction
- [ ] One successful delivery event

**Within 1 hour:**
- [ ] Monitor error logs (no critical errors)
- [ ] Check API response times (< 500ms p95)
- [ ] Verify session persistence
- [ ] Test offline-to-online sync

**Within 24 hours:**
- [ ] Review all user-reported issues
- [ ] Check analytics/usage metrics
- [ ] Verify data integrity in database
- [ ] Confirm no data loss from outbox queue

---

## Phase 11: TWA Packaging (Optional)

### 11.1 Prerequisites

- [ ] PWA fully tested and stable
- [ ] Custom domain configured
- [ ] HTTPS with valid certificate
- [ ] Digital Asset Links prepared

### 11.2 Generate APKs

**Using PWABuilder:**
1. Go to https://www.pwabuilder.com/
2. Enter URL: https://app.jukitchen.ph/cashier/
3. Click "Build My PWA"
4. Select "Android" platform
5. Configure:
   - Package ID: `ph.jukitchen.cashier`
   - App name: "JuFlow Cashier"
   - Launch URL: https://app.jukitchen.ph/cashier/
   - Theme color: #bc5125
6. Generate APK
7. Repeat for Rider app (`ph.jukitchen.rider`)

**Using Bubblewrap CLI:**
```bash
npm install -g @bubblewrap/cli

# Initialize project
bubblewrap init --manifest https://app.jukitchen.ph/cashier/manifest.webmanifest

# Build APK
bubblewrap build

# Sign APK (create keystore first)
bubblewrap build --signingMode release
```

### 11.3 Code Signing

**Generate keystore:**
```bash
keytool -genkey -v -keystore jukitchen.keystore \
  -alias jukitchen \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

**⚠️ CRITICAL:** Backup `jukitchen.keystore` file securely!

**Get SHA-256 fingerprint:**
```bash
keytool -list -v -keystore jukitchen.keystore -alias jukitchen
# Copy SHA256 fingerprint (XX:XX:XX:...)
```

### 11.4 Publish Digital Asset Links

Update `.well-known/assetlinks.json`:
```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "ph.jukitchen.cashier",
      "sha256_cert_fingerprints": ["<YOUR_SHA256_FINGERPRINT>"]
    }
  },
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "ph.jukitchen.rider",
      "sha256_cert_fingerprints": ["<YOUR_SHA256_FINGERPRINT>"]
    }
  }
]
```

**Deploy and verify:**
```bash
# Check file is accessible
curl https://app.jukitchen.ph/.well-known/assetlinks.json

# Validate with Google tool
# https://developers.google.com/digital-asset-links/tools/generator
```

### 11.5 Testing APKs

**Install on test device:**
```bash
adb install app-release-signed.apk
```

**Verify TWA:**
- [ ] App opens full-screen (no URL bar)
- [ ] Browser UI completely hidden
- [ ] Back button works as expected
- [ ] App icon appears on home screen
- [ ] Splash screen shows on launch
- [ ] All app features work
- [ ] No "Open in browser" prompt

### 11.6 Distribution Options

**Option 1: Google Play Store**
- Requires developer account ($25 one-time fee)
- Full review process (3-7 days)
- Automatic updates via Play Store
- Best for public distribution

**Option 2: Sideloading**
- Share APK file directly
- Users must enable "Install from unknown sources"
- Manual updates required
- Best for internal/pilot testing

**Option 3: Enterprise Distribution**
- Google Play Managed Apps
- MDM (Mobile Device Management) push
- Best for company devices

---

## Phase 12: Monitoring & Maintenance

### 12.1 Error Tracking

**Recommended tools:**
- Sentry (real-time error tracking)
- LogRocket (session replay)
- Google Analytics (usage metrics)

**Add to app.js:**
```javascript
// Example: Sentry integration
if (typeof Sentry !== 'undefined') {
  Sentry.init({
    dsn: 'YOUR_SENTRY_DSN',
    environment: 'production',
    release: 'juflow-cashier@1.0.0'
  });
}

// Catch unhandled errors
window.addEventListener('error', (event) => {
  console.error('Unhandled error:', event.error);
  // Send to monitoring service
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  // Send to monitoring service
});
```

### 12.2 Performance Monitoring

**Metrics to track:**
- App load time (target: < 2s on 3G)
- Time to interactive (target: < 3s)
- API response times (target: < 500ms p95)
- Service worker activation time
- Offline queue size
- Sync success rate

### 12.3 User Feedback

**Add feedback mechanism:**
- In-app feedback button
- Support email link
- Bug report form
- Feature request form

### 12.4 Update Strategy

**Service worker updates:**
- Automatic update detection
- Show "New version available" toast
- "Reload to update" button
- Force update on critical security fixes

**APK updates (if using TWA):**
- Google Play auto-updates
- Or notify users of new APK version

---

## Rollback Plan

### If Critical Issues Arise

**Immediate actions:**
1. Revert to previous deployment
2. Disable affected features
3. Display maintenance message
4. Notify affected users

**Rollback commands:**
```bash
# Vercel rollback
vercel rollback

# Or redeploy previous version
git checkout <previous-commit>
vercel --prod

# Or use feature flags
# Set ENABLE_MOBILE_APPS=false in environment
```

---

## Success Criteria

### Launch is successful if:
- [ ] 95%+ uptime in first week
- [ ] < 5% error rate
- [ ] No data loss incidents
- [ ] Positive user feedback
- [ ] Key workflows complete successfully
- [ ] Offline sync works reliably
- [ ] Performance within targets

### Ready for full rollout if:
- [ ] 100+ successful transactions
- [ ] 50+ successful deliveries
- [ ] All critical bugs fixed
- [ ] Staff trained and comfortable
- [ ] Monitoring dashboards green
- [ ] No security issues identified

---

## Support Resources

**Documentation:**
- [README.md](./README.md) - Overview and features
- [ICON_GUIDE.md](./ICON_GUIDE.md) - Icon generation
- [MOBILE_APPS_PLAN.md](../MOBILE_APPS_PLAN.md) - Original specification

**External resources:**
- [PWA Checklist](https://web.dev/pwa-checklist/)
- [Service Worker Cookbook](https://serviceworke.rs/)
- [Workbox](https://developers.google.com/web/tools/workbox) - Advanced SW patterns
- [TWA Quick Start](https://developers.google.com/web/android/trusted-web-activity/quick-start)

**Contact:**
- Technical issues: [your-email]
- Business questions: [manager-email]
- Emergency: [phone-number]

---

**Last updated:** 2026-10-12  
**Next review:** After Phase 1 completion

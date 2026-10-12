# JuFlow Mobile Apps

Progressive Web Apps (PWAs) for JuFlow food ordering system - Cashier and Rider applications.

## Overview

This directory contains two complete mobile applications:
- **Cashier App** (`/cashier/`) - Point of sale, order management, delivery coordination
- **Rider App** (`/rider/`) - Delivery job management, navigation, and status tracking

Both apps are:
- **Installable** as native-looking apps on Android and iOS
- **Offline-capable** with service workers and local queuing
- **Touch-optimized** with mobile-first UI/UX
- **Safe-area aware** for notched displays (iPhone X+, modern Android)

## Directory Structure

```
Mobile/
├── cashier/
│   ├── index.html           # App shell with login & navigation
│   ├── app.js               # Core app logic, routing, auth, API
│   ├── pos.js               # Point of sale / sell module
│   ├── orders.js            # Order queue management
│   ├── new-order.js         # Create delivery orders
│   ├── today.js             # Daily sales summary
│   ├── me.js                # Profile & settings
│   └── manifest.webmanifest # PWA manifest
│
├── rider/
│   ├── index.html           # App shell with login & navigation
│   ├── app.js               # Core app logic, routing, auth, location
│   ├── jobs.js              # Active delivery jobs
│   ├── history.js           # Completed deliveries
│   ├── me.js                # Profile, availability, settings
│   └── manifest.webmanifest # PWA manifest
│
├── shared/
│   └── styles.css           # Complete shared styles for both apps
│
├── icons/                   # App icons (to be created)
│   ├── cashier-192.png
│   ├── cashier-512.png
│   ├── cashier-maskable-512.png
│   ├── rider-192.png
│   ├── rider-512.png
│   └── rider-maskable-512.png
│
├── .well-known/             # For TWA (Trusted Web Activity) support
│   └── assetlinks.json      # Digital Asset Links (Android)
│
└── README.md                # This file
```

## Features

### Cashier App Features

✅ **Point of Sale (POS)**
- Menu grid with dish images and prices
- Shopping cart with quantity controls
- Offline sales queueing with IndexedDB
- Automatic sync when back online
- Records exact sale time (`occurred_at`)

✅ **Order Queue Management**
- Start preparing → Mark ready → Assign rider
- Payment confirmation with cash/GCash handling
- Real-time order status updates

✅ **New Order Creation**
- Customer search and quick-add
- Menu-based item selection with server pricing
- Delivery fee configuration
- Cash or GCash payment methods

✅ **Today's Summary**
- Sales count and revenue breakdown
- Cash vs GCash totals
- Recent sales list

✅ **Profile & Settings**
- Queue status monitoring
- Manual sync retry
- PWA install prompt
- Sign out with unsent data warning

### Rider App Features

✅ **Active Jobs**
- View assigned deliveries
- Customer contact (tel: links)
- Payment collection info (cash/GCash)
- Navigation to Google Maps and Waze

✅ **Delivery Actions**
- Mark as picked up
- Start delivery (on the way)
- Mark as arrived
- Report delivery complete (long-press confirm)
- Offline event queueing with IndexedDB

✅ **Location Sharing**
- Foreground GPS tracking
- Location attached to status events
- Wake lock during active deliveries
- Manual start/stop control

✅ **Delivery History**
- Last 30 days of completed deliveries
- Grouped by date (Today, Yesterday, etc.)
- Earnings summary

✅ **Availability Toggle**
- Mark as available/unavailable
- Prevents new assignments when off-duty

✅ **Profile & Settings**
- Unsent events monitoring
- Location sharing status
- PWA install prompt
- Sign out with data clearing

## Technical Architecture

### Frontend Stack
- **Vanilla JavaScript** - No framework dependencies
- **Hash-based routing** - Client-side navigation (`#/sell`, `#/jobs`, etc.)
- **Progressive enhancement** - Works without JavaScript for initial load
- **Service Workers** - Offline support and caching (to be implemented)

### Data Management
- **IndexedDB** for offline queues (sales, delivery events)
- **localStorage** for user preferences and cached data
- **Per-user namespacing** to prevent data leaks between sessions

### API Integration
- Base endpoint: `/api/*` (proxied to backend)
- Session-based auth with HttpOnly cookies
- Automatic 401 → login screen redirection
- Retry logic with exponential backoff

### Offline Strategy

**What works offline:**
- Opening the app (cached shell)
- Point of sale (cached menu + queued sales)
- Viewing cached delivery jobs
- Recording delivery status events (queued)

**What requires online:**
- Login/logout
- Creating new delivery orders
- Assigning riders to orders
- Confirming payments
- Loading fresh data

**Sync behavior:**
- Automatic flush on `online` event
- 15-second background polling when connected
- Manual retry button in profile
- Conflict detection with 409 handling

## Installation & Deployment

### Prerequisites
1. Backend API running at `/api/*` endpoints
2. Custom domain configured (for TWA support)
3. HTTPS enabled (required for service workers)

### Integration Steps

1. **Copy files to project root:**
   ```bash
   # Copy Mobile directory to your project
   cp -r Mobile/ /path/to/juflow-project/
   ```

2. **Update build configuration:**
   Add Mobile files to your build allowlist:
   - `scripts/build-frontend.mjs` → `FRONTEND_FILES` / `FRONTEND_DIRS`
   - `serve.js` → `allowed` set + content types
   - `tests/frontend.test.mjs` → link validation

3. **Configure CSP headers:**
   Update `vercel.json`:
   ```json
   {
     "headers": [{
       "source": "/(.*)",
       "headers": [{
         "key": "Content-Security-Policy",
         "value": "worker-src 'self' blob:; ..."
       }]
     }]
   }
   ```

4. **Create app icons:**
   Generate icons for both apps:
   - 192×192 px (standard)
   - 512×512 px (high-res)
   - 512×512 px maskable (80% safe zone)
   
   **Cashier:** Orange (#bc5125) with "J•" mark  
   **Rider:** Green (#39735b) with "J•" mark

5. **Generate service workers:**
   Create `cashier/sw.js` and `rider/sw.js` with:
   - Precache list of app files
   - Network-first for navigations
   - Cache-first for static assets
   - Network-only for `/api/*`

6. **Add redirects:**
   Update `vercel.json`:
   ```json
   {
     "redirects": [
       { "source": "/cashier.html", "destination": "/cashier/#/orders" },
       { "source": "/rider.html", "destination": "/rider/" }
     ]
   }
   ```

7. **Deploy and verify:**
   ```bash
   npm run build
   npm test
   # Deploy to Vercel
   # Test install prompt on Android Chrome
   ```

## Backend Requirements

### Existing Endpoints (Already Implemented)
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/menu/today`
- `POST /api/sales` (needs `occurred_at` support)
- `GET /api/deliveries`
- `POST /api/deliveries/:id/actions`
- `POST /api/deliveries/:id/events`
- `POST /api/deliveries/:id/assign`
- `POST /api/deliveries/:id/confirm`
- `GET /api/customers`
- `POST /api/customers`
- `POST /api/orders`
- `GET /api/riders`

### New Endpoints Needed

**Sales summary (for Today tab):**
```
GET /api/sales/today
Auth: cashier, admin
Returns:
{
  total_sales: 45,
  cash_total_centavos: 125000,
  cash_count: 30,
  gcash_total_centavos: 75000,
  gcash_count: 15,
  total_revenue_centavos: 200000,
  recent_sales: [...]  // last 10
}
```

**Rider deliveries with filters:**
```
GET /api/riders/me/deliveries?filter=active|history&limit=30
Auth: rider
Returns:
{
  deliveries: [...]
}
Filter 'active' = assigned|picked_up|on_the_way|arrived|awaiting_cashier_confirmation
Filter 'history' = delivered|cancelled
```

**Rider availability toggle:**
```
PATCH /api/riders/me
Auth: rider (own profile only)
Body: { is_available: true|false }
Returns: { rider: {...} }
```

**Rider location updates:**
```
POST /api/riders/me/location
Auth: rider
Body: {
  latitude: 14.5995,
  longitude: 120.9842,
  accuracy: 10,
  timestamp: "2026-10-12T10:00:00Z"
}
Returns: 200 OK
```

**Cashier backdating support:**
Modify `POST /api/sales`:
- Accept optional `occurred_at` field (ISO 8601 UTC)
- Allow cashier role to backdate up to 24 hours
- Use `occurred_at` for sales reports, not `created_at`

## PWA Manifest Details

### Cashier Manifest
- **Theme:** Orange (#bc5125)
- **Scope:** `/cashier/`
- **Start URL:** `/cashier/?source=pwa`
- **Shortcuts:** Sell, Orders, New order

### Rider Manifest
- **Theme:** Green (#39735b)
- **Scope:** `/rider/`
- **Start URL:** `/rider/?source=pwa`
- **Shortcuts:** Jobs, History

## Testing Checklist

### Offline Testing
- [ ] Airplane mode → open app → shell loads
- [ ] Sell 3 items offline → reconnect → sales sync
- [ ] Rider: 4 events offline → reconnect → delivery completes
- [ ] Session expiry → login appears in-app
- [ ] Kill app mid-sale → reopen → cart intact

### Device Testing
- [ ] Android low-end (2-3 GB RAM, Android 8-10)
- [ ] Android mid-range (4+ GB RAM, Android 11+)
- [ ] iPhone (PWA via "Add to Home Screen")
- [ ] Throttled "Slow 3G" network

### User Flow Testing
- [ ] Cashier: sell dish → order queue → assign → confirm
- [ ] Rider: new job → picked up → navigate → delivered
- [ ] Two cashiers → same order → 409 conflict handled
- [ ] Sign out with unsent data → warning shown

### Installation Testing
- [ ] Chrome "Install app" prompt appears
- [ ] Installed app opens standalone (no browser bar)
- [ ] App icon appears on home screen
- [ ] Splash screen shows on launch
- [ ] Offline → app still launches

## Trusted Web Activity (TWA) Packaging

To distribute as real Android APKs:

1. **Choose package IDs:**
   - `ph.jukitchen.cashier`
   - `ph.jukitchen.rider`

2. **Generate APKs:**
   Use [PWABuilder](https://www.pwabuilder.com/) or Bubblewrap CLI:
   ```bash
   npm install -g @bubblewrap/cli
   bubblewrap init --manifest https://app.jukitchen.ph/cashier/manifest.webmanifest
   bubblewrap build
   ```

3. **Create signing keystore:**
   ```bash
   keytool -genkey -v -keystore jukitchen.keystore \
     -alias jukitchen -keyalg RSA -keysize 2048 -validity 10000
   ```
   ⚠️ **Backup this keystore!** Losing it means you can never update the installed app.

4. **Get SHA-256 fingerprint:**
   ```bash
   keytool -list -v -keystore jukitchen.keystore -alias jukitchen
   ```

5. **Publish Digital Asset Links:**
   Create `/.well-known/assetlinks.json`:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "ph.jukitchen.cashier",
       "sha256_cert_fingerprints": ["XX:XX:XX:..."]
     }
   }, {
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "ph.jukitchen.rider",
       "sha256_cert_fingerprints": ["XX:XX:XX:..."]
     }
   }]
   ```

6. **Verify TWA:**
   - Install APK: `adb install app-release-signed.apk`
   - Open app → **no URL bar** should appear
   - Test with [Digital Asset Links Tester](https://developers.google.com/digital-asset-links/tools/generator)

## Known Limitations

1. **iOS has no real APK** - Use PWA install ("Add to Home Screen")
2. **Background GPS limited** - Location only shared when app is foreground
3. **Push notifications** - Not implemented (Phase 4 in plan)
4. **Camera blocked** - CSP needs updating if photo proof is added
5. **Print receipts** - Requires native bridge (Capacitor) for thermal printers

## Security Notes

- **Never cache `/api/*` responses** in service worker
- **Clear caches on sign out** to prevent data leaks
- **Session cookies** remain HttpOnly + Secure + SameSite
- **Lost phone:** Admin disables user account (returns 403)
- **Unsent queues** scoped per user ID to prevent cross-contamination

## Performance

- **First load:** < 3s on 3G
- **Return visit:** < 500ms (cached shell)
- **TTI:** < 2s on mid-range device
- **Lighthouse PWA:** Should score 90+

## Browser Support

- **Android Chrome 90+** ✅ Full support
- **iOS Safari 14+** ✅ PWA install, limited push
- **Samsung Internet 14+** ✅ Full support
- **Firefox Android** ⚠️ No install prompt, works as website

## Troubleshooting

### Install prompt doesn't appear
- Check HTTPS is enabled
- Verify `manifest.webmanifest` is valid JSON
- Ensure `worker-src 'self'` is in CSP
- Look for manifest errors in Chrome DevTools → Application

### Service worker not updating
- Hard refresh (Ctrl+Shift+R)
- Unregister in DevTools → Application → Service Workers
- Check `sw.js` has `Cache-Control: no-cache` header

### API calls return 401
- Check cookie `SameSite` attribute
- Verify `/api/*` CORS allows credentials
- Confirm session hasn't expired (24h default)

### Location not working
- Check HTTPS (required for geolocation)
- User must grant permission
- Wake lock only works when page is visible

### Offline sales not syncing
- Check `online` event listener is attached
- Verify IndexedDB not blocked by browser
- Look for 409/422 errors (conflicts/validation)

## Development Workflow

1. **Local testing:**
   ```bash
   npm run serve  # or python -m http.server
   # Open https://localhost:3000/cashier/
   ```

2. **Device testing:**
   - Use `ngrok` or `localtunnel` for HTTPS
   - Or deploy to staging environment
   - Install on real device

3. **Debugging:**
   - Chrome DevTools → Remote debugging
   - `chrome://inspect` on desktop
   - Look at Console, Network, Application tabs

4. **Iterate:**
   - Make changes
   - Deploy or refresh
   - Service worker updates automatically (shows toast)

## Credits

Built for JuFlow food ordering system.  
Architecture based on MOBILE_APPS_PLAN.md implementation spec.

**Tech Stack:**
- Vanilla JS (no frameworks)
- Progressive Web App APIs
- IndexedDB for offline storage
- Geolocation API for rider tracking
- Wake Lock API for screen management

## License

Proprietary - Part of JuFlow system.

---

**Questions?** Refer to `MOBILE_APPS_PLAN.md` for detailed implementation phases and decision points.

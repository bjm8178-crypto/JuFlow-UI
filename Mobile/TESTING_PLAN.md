# JuFlow Mobile Apps - Phase 2 Testing Plan

**Document Version:** 1.0  
**Created:** October 12, 2026  
**Purpose:** Complete testing checklist for Phase 2 (Backend Integration)  
**Status:** Ready for use once backend APIs are deployed  

---

## 📋 Overview

This document provides a comprehensive testing plan for validating the JuFlow Mobile PWAs after backend API integration is complete.

**Prerequisites:**
- ✅ Phase 1 complete (54 files, 6 icons generated)
- ⏳ Backend APIs implemented (4 new endpoints, 3 modifications)
- ⏳ APIs deployed to staging environment

---

## 🎯 Testing Phases

### Phase 2A: API Contract Validation
### Phase 2B: Feature Testing (Cashier App)
### Phase 2C: Feature Testing (Rider App)
### Phase 2D: Offline Functionality
### Phase 2E: Cross-Device Testing
### Phase 2F: Performance & Security

---

## Phase 2A: API Contract Validation

**Goal:** Verify all backend endpoints match specifications

### Test 1: Rider Availability Toggle

```bash
# Setup
RIDER_TOKEN="<valid_rider_session_cookie>"
BASE_URL="https://staging.jukitchen.ph"

# Test: Set available to true
curl -X PATCH "$BASE_URL/api/riders/me" \
  -H "Content-Type: application/json" \
  -b "juflow_session=$RIDER_TOKEN" \
  -d '{"is_available": true}'

# Expected: 200 OK
# Response should contain: {"rider": {"is_available": true, ...}}
```

**Checklist:**
- [ ] Returns 200 OK with valid rider session
- [ ] Returns 401 Unauthorized without session
- [ ] Returns 403 Forbidden for non-rider roles
- [ ] Response includes updated `is_available` field
- [ ] Database persists the change
- [ ] Idempotent (same result on repeated calls)

---

### Test 2: Rider Location Updates

```bash
# Test: Send GPS location
curl -X POST "$BASE_URL/api/riders/me/location" \
  -H "Content-Type: application/json" \
  -b "juflow_session=$RIDER_TOKEN" \
  -d '{
    "latitude": 14.5995,
    "longitude": 120.9842,
    "accuracy": 10.5,
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }'

# Expected: 200 OK
# Response: {"status": "ok"}
```

**Checklist:**
- [ ] Accepts valid GPS coordinates
- [ ] Returns 200 OK
- [ ] Validates latitude range (-90 to 90)
- [ ] Validates longitude range (-180 to 180)
- [ ] Validates timestamp is recent (within 60 seconds)
- [ ] Returns 400 Bad Request for invalid data
- [ ] Rate limit enforced (60 requests/minute)
- [ ] Returns 429 Too Many Requests when exceeded

---

### Test 3: Rider Deliveries List

```bash
# Test: Get active deliveries
curl "$BASE_URL/api/riders/me/deliveries?filter=active&limit=10" \
  -b "juflow_session=$RIDER_TOKEN"

# Expected: 200 OK
# Response: {"deliveries": [...]}

# Test: Get delivery history
curl "$BASE_URL/api/riders/me/deliveries?filter=history&limit=30" \
  -b "juflow_session=$RIDER_TOKEN"
```

**Checklist:**
- [ ] Returns 200 OK with valid session
- [ ] `filter=active` returns only active deliveries
- [ ] `filter=history` returns completed/cancelled (last 30 days)
- [ ] Returns 400 Bad Request for invalid filter
- [ ] Respects `limit` parameter (1-100)
- [ ] Includes all required fields (customer, items, totals)
- [ ] Prices in centavos (integers)
- [ ] Dates in ISO 8601 format

---

### Test 4: Cashier Daily Summary

```bash
# Setup
CASHIER_TOKEN="<valid_cashier_session_cookie>"

# Test: Get today's summary
curl "$BASE_URL/api/sales/today" \
  -b "juflow_session=$CASHIER_TOKEN"

# Expected: 200 OK
# Response: {
#   "date": "2026-10-12",
#   "total_sales": 45,
#   "cash_total_centavos": 1250000,
#   ...
# }
```

**Checklist:**
- [ ] Returns 200 OK for cashier role
- [ ] Returns 200 OK for admin role
- [ ] Returns 403 Forbidden for rider role
- [ ] Returns 401 Unauthorized without session
- [ ] All totals are in centavos (integers)
- [ ] `recent_sales` includes last 10 transactions
- [ ] Timezone correct (Philippines, UTC+8)

---

### Test 5: Sales Creation with Backdating

```bash
# Test: Create backdated sale
curl -X POST "$BASE_URL/api/sales" \
  -H "Content-Type: application/json" \
  -b "juflow_session=$CASHIER_TOKEN" \
  -d '{
    "dishes": [{"dish_id": "uuid-here", "quantity": 2}],
    "transaction_id": "TXN-TEST-001",
    "cashier_id": "uuid-here",
    "payment_method": "cash",
    "created_at_override": "'$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)'"
  }'
```

**Checklist:**
- [ ] Accepts `created_at_override` field
- [ ] Uses override timestamp if provided
- [ ] Validates within last 24 hours
- [ ] Returns 400 Bad Request if future date
- [ ] Returns 400 Bad Request if > 24 hours old
- [ ] Sale appears in correct date bucket in dashboard

---

### Test 6: Delivery Status Updates (Idempotency)

```bash
# Test: Update with event_id
curl -X PATCH "$BASE_URL/api/deliveries/uuid-here" \
  -H "Content-Type: application/json" \
  -b "juflow_session=$RIDER_TOKEN" \
  -d '{
    "status": "picked_up",
    "event_id": "evt_test_001",
    "version": 0
  }'

# Expected: 200 OK, version incremented

# Test: Replay same event_id
curl -X PATCH "$BASE_URL/api/deliveries/uuid-here" \
  -H "Content-Type: application/json" \
  -b "juflow_session=$RIDER_TOKEN" \
  -d '{
    "status": "picked_up",
    "event_id": "evt_test_001",
    "version": 0
  }'

# Expected: 200 OK, no change (idempotent)
```

**Checklist:**
- [ ] First call updates status and increments version
- [ ] Duplicate `event_id` returns 200 but doesn't change state
- [ ] Version mismatch returns 409 Conflict
- [ ] Event recorded in `delivery_events` table

---

## Phase 2B: Cashier App Feature Testing

**Environment:** Staging server running  
**User:** Valid cashier account  

### Feature 1: Point of Sale

**Test Steps:**
1. Open `http://localhost:8080/cashier/` (or staging URL)
2. Click "Point of Sale" tab
3. Verify menu items load from API
4. Add items to cart
5. Select payment method (Cash/GCash)
6. Complete sale
7. Verify transaction appears in order queue

**Checklist:**
- [ ] Menu items load correctly
- [ ] Prices display in pesos (centavos / 100)
- [ ] Cart totals calculate correctly
- [ ] Can add/remove items
- [ ] Can change quantities
- [ ] Payment method selection works
- [ ] Transaction ID generated (format: TXN-YYYYMMDD-NNN)
- [ ] Sale submitted successfully
- [ ] Toast notification shows success
- [ ] Cart clears after successful sale

---

### Feature 2: Order Queue

**Test Steps:**
1. Click "Orders" tab
2. Verify orders load in 3 columns: Placed / Preparing / Ready
3. Move order from Placed → Preparing
4. Move order from Preparing → Ready
5. Assign rider to Ready order
6. Verify order moves to "Out for Delivery"

**Checklist:**
- [ ] Orders load and display correctly
- [ ] Columns show correct statuses
- [ ] Can drag/drop or click to change status
- [ ] Status updates immediately
- [ ] Rider assignment modal opens
- [ ] Available riders list loads
- [ ] Can select and assign rider
- [ ] Order disappears from Ready after assignment

---

### Feature 3: New Delivery Order

**Test Steps:**
1. Click "New Order" tab
2. Search for customer
3. Select customer or create new
4. Add items to order
5. Enter delivery details
6. Submit order
7. Verify appears in order queue

**Checklist:**
- [ ] Customer search works
- [ ] Can select existing customer
- [ ] Can create new customer
- [ ] Menu items searchable
- [ ] Can add multiple items
- [ ] Subtotal calculates correctly
- [ ] Delivery fee applies
- [ ] Total calculates correctly
- [ ] Can enter delivery notes
- [ ] Order submits successfully
- [ ] Appears in "Placed" queue

---

### Feature 4: Today's Dashboard

**Test Steps:**
1. Click "Today" tab
2. Verify summary cards show correct data
3. Check cash vs GCash breakdown
4. Verify recent sales list
5. Create new sale via POS
6. Verify dashboard updates in real-time

**Checklist:**
- [ ] Total sales count correct
- [ ] Cash total correct (in pesos)
- [ ] GCash total correct (in pesos)
- [ ] Total revenue correct
- [ ] Recent sales list shows last 10
- [ ] Updates immediately after new sale
- [ ] Timezone correct (shows today in Philippines time)

---

### Feature 5: Profile & Settings

**Test Steps:**
1. Click "Me" tab
2. Verify user info displays correctly
3. Test logout
4. Log back in
5. Session persists across page refresh

**Checklist:**
- [ ] Name displays correctly
- [ ] Role shows "Cashier"
- [ ] Logout button works
- [ ] Redirects to login on logout
- [ ] Can log back in
- [ ] Session cookie persists (HttpOnly, Secure)

---

## Phase 2C: Rider App Feature Testing

**Environment:** Staging server running  
**User:** Valid rider account  

### Feature 1: Active Jobs

**Test Steps:**
1. Open `http://localhost:8080/rider/`
2. Click "Jobs" tab
3. Verify assigned deliveries load
4. Accept a delivery
5. Mark as "Picked Up"
6. Update GPS location
7. Mark as "Delivered"
8. Verify delivery moves to history

**Checklist:**
- [ ] Assigned deliveries load correctly
- [ ] Customer name, address, phone visible
- [ ] Order items list displays
- [ ] Total amount shows correctly
- [ ] Can accept delivery
- [ ] Can reject delivery
- [ ] Status updates to "Picked Up"
- [ ] GPS location updates (see browser console for latitude/longitude)
- [ ] Can navigate to customer (Google Maps/Waze links)
- [ ] Can mark as "Delivered"
- [ ] Delivery disappears from active jobs

---

### Feature 2: GPS Tracking

**Test Steps:**
1. Grant location permissions in browser
2. Verify location icon in status bar turns green
3. Check browser console for location updates
4. Move device/computer (if on mobile)
5. Verify location updates sent every 30 seconds

**Checklist:**
- [ ] Browser requests location permission
- [ ] Permission granted successfully
- [ ] Location icon shows green when active
- [ ] Latitude/longitude logged in console
- [ ] Updates sent every 30 seconds
- [ ] API returns 200 OK
- [ ] Accuracy value included
- [ ] Works in background (screen on via Wake Lock API)

---

### Feature 3: Availability Toggle

**Test Steps:**
1. Click availability toggle in top bar
2. Verify status changes to "Available"
3. Check if new deliveries can be assigned
4. Toggle to "Unavailable"
5. Verify no new deliveries assigned

**Checklist:**
- [ ] Toggle switch works
- [ ] API called on toggle
- [ ] Visual feedback (color change)
- [ ] Status persists on page refresh
- [ ] Backend correctly filters available riders

---

### Feature 4: Delivery History

**Test Steps:**
1. Click "History" tab
2. Verify completed deliveries load (last 30 days)
3. Check cancelled deliveries appear
4. Verify sorting (newest first)

**Checklist:**
- [ ] Completed deliveries load
- [ ] Cancelled deliveries load
- [ ] Shows last 30 days only
- [ ] Sorted by date descending (newest first)
- [ ] Customer info visible
- [ ] Total amount displayed
- [ ] Completion timestamp shown

---

### Feature 5: Navigation Integration

**Test Steps:**
1. Open active delivery
2. Click "Navigate" button
3. Verify options: Google Maps, Waze
4. Select one
5. Verify opens in respective app/browser

**Checklist:**
- [ ] Navigate button visible
- [ ] Modal shows Google Maps and Waze options
- [ ] Google Maps link correct format
- [ ] Waze link correct format
- [ ] Opens in external app (mobile)
- [ ] Opens in web (desktop)

---

## Phase 2D: Offline Functionality Testing

**Goal:** Verify queue-and-sync works correctly

### Offline Test 1: Cashier - Create Sale Offline

**Test Steps:**
1. Open cashier app online
2. Open browser DevTools → Network tab
3. Enable "Offline" mode
4. Create a sale via POS
5. Verify success toast shows
6. Check IndexedDB for queued transaction
7. Disable offline mode
8. Wait 5 seconds
9. Verify sale syncs to backend
10. Check backend database for sale record

**Checklist:**
- [ ] Sale creation succeeds while offline
- [ ] Transaction queued in IndexedDB (`outbox` store)
- [ ] Toast shows "Saved (will sync when online)"
- [ ] When back online, auto-sync begins
- [ ] Toast shows "Synced successfully"
- [ ] Sale appears in backend database
- [ ] Transaction removed from IndexedDB outbox
- [ ] No duplicate submissions

---

### Offline Test 2: Rider - Update Status Offline

**Test Steps:**
1. Open rider app online
2. Accept a delivery
3. Go offline (DevTools → Network → Offline)
4. Mark as "Picked Up"
5. Verify event queued
6. Go back online
7. Verify event syncs
8. Check backend for updated status

**Checklist:**
- [ ] Status update succeeds while offline
- [ ] Event queued in IndexedDB
- [ ] Visual feedback (status shown as updated locally)
- [ ] When online, event syncs
- [ ] Backend receives event
- [ ] Idempotency key (`event_id`) prevents duplicates
- [ ] Status updates correctly in backend

---

### Offline Test 3: Service Worker Caching

**Test Steps:**
1. Open cashier app online
2. Load all pages (POS, Orders, Today, Me)
3. Go offline
4. Navigate between pages
5. Verify all static content loads from cache

**Checklist:**
- [ ] HTML loads from cache
- [ ] CSS loads from cache
- [ ] JavaScript loads from cache
- [ ] Images load from cache
- [ ] App shell displays correctly
- [ ] No broken assets
- [ ] Navigation between pages works
- [ ] Only API calls fail gracefully

---

## Phase 2E: Cross-Device Testing

**Goal:** Verify both apps work on different devices and browsers

### Desktop Testing

**Browsers to test:**
- [ ] Chrome 90+ (Windows)
- [ ] Chrome 90+ (macOS)
- [ ] Firefox 88+ (Windows)
- [ ] Edge 90+ (Windows)
- [ ] Safari 14+ (macOS)

**Test each browser:**
- [ ] PWA installation works
- [ ] All features functional
- [ ] No console errors
- [ ] CSS renders correctly
- [ ] Touch targets work with mouse

---

### Mobile Testing (Android)

**Devices to test:**
- [ ] Chrome on Android 10+
- [ ] Samsung Internet (if available)

**Test checklist:**
- [ ] PWA installation to home screen
- [ ] Standalone mode (no browser chrome)
- [ ] Icons display correctly (192px, 512px)
- [ ] Maskable icons display correctly
- [ ] Touch targets 48px minimum
- [ ] Safe area insets respected (notched devices)
- [ ] GPS location works (rider app)
- [ ] Wake Lock keeps screen on (rider app)
- [ ] Haptic feedback works (vibration on actions)
- [ ] Orientation lock works
- [ ] Offline functionality works

---

### Mobile Testing (iOS)

**Devices to test:**
- [ ] Safari on iOS 14+
- [ ] iPhone (standard notch)
- [ ] iPhone (newer notch)

**Test checklist:**
- [ ] Add to Home Screen works
- [ ] Standalone mode works
- [ ] Icons display correctly
- [ ] Safe area insets respected
- [ ] GPS location works (rider app)
- [ ] Screen wake works (rider app - may have limitations)
- [ ] Touch targets adequate
- [ ] Scroll behavior smooth
- [ ] No rubber-banding issues
- [ ] Offline functionality works

**Note:** iOS limitations:
- Wake Lock API not supported (use Screen Wake Lock alternative)
- Push notifications require native wrapper (Phase 4)
- Background sync limited

---

## Phase 2F: Performance & Security Testing

### Performance Tests

**Metrics to measure:**
- [ ] First Contentful Paint < 1.5s
- [ ] Time to Interactive < 3s
- [ ] Largest Contentful Paint < 2.5s
- [ ] Cumulative Layout Shift < 0.1
- [ ] Service worker install time < 1s
- [ ] IndexedDB write time < 100ms
- [ ] API response time < 500ms (staging)

**Tools:**
- Lighthouse audit (target score 90+)
- Chrome DevTools Performance tab
- Network throttling (Fast 3G simulation)

**Checklist:**
- [ ] Lighthouse Performance score 90+
- [ ] Lighthouse Accessibility score 100
- [ ] Lighthouse Best Practices score 90+
- [ ] Lighthouse SEO score 90+
- [ ] Lighthouse PWA score 100
- [ ] Works on Fast 3G (throttled network)
- [ ] Loads under 3 seconds on 3G

---

### Security Tests

**Authentication:**
- [ ] Session cookie is HttpOnly
- [ ] Session cookie is Secure (HTTPS only)
- [ ] Session cookie is SameSite=Lax
- [ ] Session expires after 24 hours
- [ ] Logout clears session
- [ ] Cannot access rider endpoints as cashier
- [ ] Cannot access cashier endpoints as rider
- [ ] Expired session redirects to login

**Authorization:**
- [ ] Cashier cannot access rider endpoints
- [ ] Rider cannot access cashier endpoints
- [ ] Non-authenticated users redirected to login
- [ ] Each user can only see own data

**Input Validation:**
- [ ] XSS protection (no script injection)
- [ ] SQL injection protection (parameterized queries)
- [ ] CSRF protection (SameSite cookies)
- [ ] Rate limiting enforced
- [ ] Large payloads rejected
- [ ] Invalid coordinates rejected

**Content Security Policy:**
- [ ] CSP header present
- [ ] `worker-src 'self' blob:` allowed (for service worker)
- [ ] No inline scripts (use external .js files)
- [ ] No eval() or unsafe inline styles

---

## 📊 Testing Completion Criteria

### Phase 2 Complete When:

✅ **API Validation (100%):**
- All 4 new endpoints working
- All 3 modified endpoints working
- All response formats match specs

✅ **Feature Testing (100%):**
- All cashier app features working
- All rider app features working
- No blocking bugs

✅ **Offline Testing (100%):**
- Queue-and-sync verified
- Service worker caching verified
- No data loss scenarios

✅ **Cross-Device (80%+):**
- Works on Chrome Android
- Works on Safari iOS
- Works on desktop browsers
- Icons display correctly

✅ **Performance (90%+):**
- Lighthouse score 90+
- Loads under 3s on 3G

✅ **Security (100%):**
- All auth/authz working
- No vulnerabilities found
- CSP enforced

---

## 🐛 Bug Tracking Template

When issues are found, document them:

```
Bug ID: BUG-001
Title: [Brief description]
Severity: Critical / Major / Minor
Found in: Phase 2B / Feature 1 / Step 3
Device: Chrome 91 / Android 12 / Pixel 5
Steps to Reproduce:
  1. ...
  2. ...
Expected: ...
Actual: ...
Screenshots: [attach]
Logs: [paste console output]
Status: Open / In Progress / Fixed / Won't Fix
```

---

## 📝 Testing Sign-off

Once all testing is complete, sign off:

```
Phase 2A (API Validation):        [ ] Complete
Phase 2B (Cashier App):           [ ] Complete
Phase 2C (Rider App):             [ ] Complete
Phase 2D (Offline):               [ ] Complete
Phase 2E (Cross-Device):          [ ] Complete
Phase 2F (Performance & Security):[ ] Complete

Critical Bugs: 0
Major Bugs: 0
Minor Bugs: [list]

Tested by: _________________
Date: _________________
Approved for Phase 3: [ ] Yes [ ] No
```

---

## 🚀 Next Phase

After Phase 2 testing complete:
- **Phase 3:** Production deployment preparation
- **Phase 4:** Push notifications & background sync
- **Phase 5:** TWA packaging for Play Store

---

**Document Status:** ✅ Ready for use  
**Created:** October 12, 2026  
**Version:** 1.0  
**Next Review:** After Phase 2 backend completion  

---

*This testing plan ensures both JuFlow Mobile PWAs are thoroughly validated before production deployment.*

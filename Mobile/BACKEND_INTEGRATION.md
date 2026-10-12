# JuFlow Mobile Apps - Backend Integration Specification

**Document Version:** 1.0  
**Created:** October 12, 2026  
**Status:** Ready for Backend Implementation  
**Target:** Phase 2 - Backend API Integration  

---

## 📋 Executive Summary

The JuFlow Mobile PWAs (Cashier and Rider apps) are **complete and ready for backend integration**. This document specifies the exact API endpoints and modifications needed to make both apps fully functional.

**Timeline Estimate:** 1-2 days for backend implementation  
**Priority:** HIGH - Blocks mobile app deployment  

---

## 🎯 Required Backend Changes

### Summary of Changes

| Change Type | Count | Priority | Effort |
|-------------|-------|----------|--------|
| **New Endpoints** | 4 | 🔴 Critical | 4-6 hours |
| **Modified Endpoints** | 3 | 🟡 Medium | 2-3 hours |
| **Database Changes** | 2 | 🟡 Medium | 1-2 hours |
| **Total Effort** | - | - | **1-2 days** |

---

## 🆕 New API Endpoints (4 Total)

### 1. Rider Availability Toggle

**Purpose:** Allow riders to mark themselves available/unavailable for deliveries

```http
PATCH /api/riders/me
Content-Type: application/json
Cookie: juflow_session=<session_token>
```

**Request Body:**
```json
{
  "is_available": true
}
```

**Response (200 OK):**
```json
{
  "rider": {
    "rider_id": "uuid",
    "name": "Juan Dela Cruz",
    "phone": "+63 912 345 6789",
    "is_available": true,
    "total_deliveries": 156,
    "rating": 4.8,
    "updated_at": "2026-10-12T11:00:00Z"
  }
}
```

**Authorization:** `rider` role only (own profile)  
**Idempotency:** Safe to call multiple times with same value  

**Database:**
```sql
ALTER TABLE riders ADD COLUMN is_available BOOLEAN DEFAULT false;
CREATE INDEX idx_riders_available ON riders(is_available) WHERE is_available = true;
```

---

### 2. Rider Location Updates

**Purpose:** GPS tracking for active deliveries

```http
POST /api/riders/me/location
Content-Type: application/json
Cookie: juflow_session=<session_token>
```

**Request Body:**
```json
{
  "latitude": 14.5995,
  "longitude": 120.9842,
  "accuracy": 10.5,
  "timestamp": "2026-10-12T11:00:00Z"
}
```

**Response (200 OK):**
```json
{
  "status": "ok"
}
```

**Authorization:** `rider` role only  
**Rate Limit:** 60 requests/minute (one update per second)  
**Validation:**
- `latitude`: -90 to 90
- `longitude`: -180 to 180
- `accuracy`: >= 0 (meters)
- `timestamp`: ISO 8601, within last 60 seconds

**Database (optional - for tracking history):**
```sql
CREATE TABLE rider_location_history (
  id SERIAL PRIMARY KEY,
  rider_id UUID NOT NULL REFERENCES riders(rider_id),
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  accuracy DECIMAL(6, 2),
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_rider_location_rider ON rider_location_history(rider_id, recorded_at DESC);
```

**Note:** If not storing history, just update `riders.last_location_lat`, `riders.last_location_lng`, `riders.last_location_updated_at`

---

### 3. Rider Deliveries List with Filters

**Purpose:** Get active jobs or delivery history

```http
GET /api/riders/me/deliveries?filter=active&limit=30
Cookie: juflow_session=<session_token>
```

**Query Parameters:**
- `filter`: `active` | `history` (required)
- `limit`: 1-100 (default: 30)

**Response (200 OK):**
```json
{
  "deliveries": [
    {
      "delivery_id": "uuid",
      "order_id": "uuid",
      "status": "assigned",
      "customer": {
        "name": "Maria Santos",
        "phone": "+63 917 123 4567",
        "address": "123 Rizal St, Barangay Central, Manila",
        "landmark": "Near 7-Eleven"
      },
      "restaurant_address": "456 Mabini St, Ermita, Manila",
      "items": [
        {
          "name": "Chicken Inasal",
          "quantity": 2,
          "price_centavos": 15000
        }
      ],
      "subtotal_centavos": 30000,
      "delivery_fee_centavos": 5000,
      "total_centavos": 35000,
      "payment_method": "cash",
      "notes": "Extra rice please",
      "assigned_at": "2026-10-12T10:45:00Z",
      "estimated_delivery": "2026-10-12T11:30:00Z"
    }
  ]
}
```

**Authorization:** `rider` role (own deliveries only)

**Filter Logic:**
- `active`: status IN ('assigned', 'picked_up', 'on_the_way', 'arrived', 'awaiting_cashier_confirmation')
- `history`: status IN ('delivered', 'cancelled') AND updated_at > NOW() - INTERVAL '30 days'

**SQL Example:**
```sql
SELECT 
  d.delivery_id,
  d.order_id,
  d.status,
  c.name AS customer_name,
  c.phone AS customer_phone,
  o.delivery_address,
  o.delivery_landmark,
  o.subtotal_centavos,
  o.delivery_fee_centavos,
  o.total_centavos,
  o.payment_method,
  o.notes,
  d.assigned_at,
  d.estimated_delivery_time
FROM deliveries d
JOIN orders o ON d.order_id = o.order_id
JOIN customers c ON o.customer_id = c.customer_id
WHERE d.rider_id = $1
  AND (
    ($2 = 'active' AND d.status IN ('assigned', 'picked_up', 'on_the_way', 'arrived', 'awaiting_cashier_confirmation'))
    OR 
    ($2 = 'history' AND d.status IN ('delivered', 'cancelled') AND d.updated_at > NOW() - INTERVAL '30 days')
  )
ORDER BY d.updated_at DESC
LIMIT $3;
```

---

### 4. Cashier Daily Summary

**Purpose:** Dashboard showing today's sales totals

```http
GET /api/sales/today
Cookie: juflow_session=<session_token>
```

**Response (200 OK):**
```json
{
  "date": "2026-10-12",
  "total_sales": 45,
  "cash_count": 28,
  "cash_total_centavos": 1250000,
  "gcash_count": 17,
  "gcash_total_centavos": 980000,
  "total_revenue_centavos": 2230000,
  "recent_sales": [
    {
      "sale_id": "uuid",
      "transaction_id": "TXN-20261012-001",
      "items_count": 3,
      "total_centavos": 45000,
      "payment_method": "cash",
      "cashier_name": "Ana Cruz",
      "created_at": "2026-10-12T10:55:00Z"
    }
  ]
}
```

**Authorization:** `cashier` or `admin` roles  
**Timezone:** Server timezone (Philippines, UTC+8)  
**Recent Sales:** Last 10 transactions, descending by created_at  

**SQL Example:**
```sql
-- Summary
SELECT 
  COUNT(*) AS total_sales,
  SUM(CASE WHEN payment_method = 'cash' THEN 1 ELSE 0 END) AS cash_count,
  SUM(CASE WHEN payment_method = 'cash' THEN total_centavos ELSE 0 END) AS cash_total_centavos,
  SUM(CASE WHEN payment_method = 'gcash' THEN 1 ELSE 0 END) AS gcash_count,
  SUM(CASE WHEN payment_method = 'gcash' THEN total_centavos ELSE 0 END) AS gcash_total_centavos,
  SUM(total_centavos) AS total_revenue_centavos
FROM sales
WHERE DATE(created_at AT TIME ZONE 'Asia/Manila') = CURRENT_DATE;

-- Recent sales
SELECT 
  s.sale_id,
  s.transaction_id,
  (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.sale_id) AS items_count,
  s.total_centavos,
  s.payment_method,
  u.name AS cashier_name,
  s.created_at
FROM sales s
JOIN users u ON s.cashier_id = u.user_id
WHERE DATE(s.created_at AT TIME ZONE 'Asia/Manila') = CURRENT_DATE
ORDER BY s.created_at DESC
LIMIT 10;
```

---

## 🔄 Modified Endpoints (3 Total)

### 1. Sales Creation - Add Backdating Support

**Modification:** Allow cashiers to backdate sales when created offline

```http
POST /api/sales
Content-Type: application/json
```

**Request Body (NEW FIELD):**
```json
{
  "dishes": [
    { "dish_id": "uuid", "quantity": 2 }
  ],
  "transaction_id": "TXN-20261012-001",
  "cashier_id": "uuid",
  "payment_method": "cash",
  "created_at_override": "2026-10-12T09:30:00Z"
}
```

**Change:**
- Add optional `created_at_override` field
- If provided and within last 24 hours, use it as `created_at` instead of NOW()
- Validation: must be within last 24 hours, cannot be future

**SQL Change:**
```sql
INSERT INTO sales (
  sale_id, transaction_id, cashier_id, payment_method, 
  total_centavos, created_at
)
VALUES (
  $1, $2, $3, $4, $5,
  COALESCE($6, NOW()) -- Use override if provided, otherwise NOW()
);
```

---

### 2. Orders List - Add Cashier Filtering

**Modification:** Allow cashiers to see only their own orders

```http
GET /api/orders?status=placed,preparing,ready&cashier_id=me&limit=50
```

**New Query Parameter:**
- `cashier_id`: UUID or "me" (for current user)

**Authorization Logic:**
- `admin`: Can filter by any cashier_id or see all
- `cashier`: Can only use "me" or their own UUID

**SQL Change:**
```sql
WHERE status = ANY($1::text[])
  AND ($2 IS NULL OR cashier_id = $2) -- New condition
ORDER BY created_at DESC
LIMIT $3;
```

---

### 3. Delivery Status Updates - Add Event Version

**Modification:** Support idempotent delivery status updates

```http
PATCH /api/deliveries/:delivery_id
Content-Type: application/json
```

**Request Body (NEW FIELD):**
```json
{
  "status": "picked_up",
  "event_id": "evt_abc123",
  "version": 1
}
```

**Change:**
- Add optional `event_id` (string, max 64 chars) for idempotency
- Add optional `version` (integer) for optimistic locking
- If `event_id` provided and already processed, return 200 with existing state (no change)
- If `version` provided and doesn't match current version, return 409 Conflict

**Database:**
```sql
ALTER TABLE deliveries ADD COLUMN version INTEGER DEFAULT 0;
CREATE TABLE delivery_events (
  event_id VARCHAR(64) PRIMARY KEY,
  delivery_id UUID NOT NULL REFERENCES deliveries(delivery_id),
  status TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_delivery_events_delivery ON delivery_events(delivery_id);
```

**Logic:**
```sql
-- Check if event already processed
SELECT 1 FROM delivery_events WHERE event_id = $1;
-- If exists, return current delivery state (no update)

-- Otherwise, update with optimistic locking
UPDATE deliveries
SET status = $2, version = version + 1, updated_at = NOW()
WHERE delivery_id = $3 
  AND ($4 IS NULL OR version = $4); -- Optimistic lock check

-- Record event
INSERT INTO delivery_events (event_id, delivery_id, status)
VALUES ($1, $3, $2);
```

---

## 🗄️ Database Schema Changes

### 1. Riders Table

```sql
ALTER TABLE riders 
ADD COLUMN is_available BOOLEAN DEFAULT false,
ADD COLUMN last_location_lat DECIMAL(10, 7),
ADD COLUMN last_location_lng DECIMAL(10, 7),
ADD COLUMN last_location_updated_at TIMESTAMPTZ;

CREATE INDEX idx_riders_available ON riders(is_available) WHERE is_available = true;
CREATE INDEX idx_riders_location_updated ON riders(last_location_updated_at DESC);
```

### 2. Deliveries Table

```sql
ALTER TABLE deliveries 
ADD COLUMN version INTEGER DEFAULT 0;

CREATE TABLE delivery_events (
  event_id VARCHAR(64) PRIMARY KEY,
  delivery_id UUID NOT NULL REFERENCES deliveries(delivery_id),
  status TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_delivery_events_delivery ON delivery_events(delivery_id);
CREATE INDEX idx_delivery_events_processed ON delivery_events(processed_at DESC);
```

### 3. Optional: Location History

```sql
CREATE TABLE rider_location_history (
  id SERIAL PRIMARY KEY,
  rider_id UUID NOT NULL REFERENCES riders(rider_id),
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  accuracy DECIMAL(6, 2),
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rider_location_rider ON rider_location_history(rider_id, recorded_at DESC);

-- Retention policy (optional)
-- DELETE FROM rider_location_history WHERE created_at < NOW() - INTERVAL '7 days';
```

---

## 🔐 Security Considerations

### Authentication

All endpoints require valid `juflow_session` cookie:
- HttpOnly, Secure, SameSite=Lax
- 24-hour expiration
- Role-based access control

### Authorization Matrix

| Endpoint | Admin | Cashier | Rider |
|----------|-------|---------|-------|
| `PATCH /api/riders/me` | ❌ | ❌ | ✅ (own) |
| `POST /api/riders/me/location` | ❌ | ❌ | ✅ |
| `GET /api/riders/me/deliveries` | ❌ | ❌ | ✅ (own) |
| `GET /api/sales/today` | ✅ | ✅ | ❌ |
| `POST /api/sales` (backdated) | ✅ | ✅ (24h limit) | ❌ |

### Rate Limiting

```javascript
// Rider location updates
POST /api/riders/me/location: 60/minute per rider

// Other endpoints
All others: 100/minute per user
```

### Input Validation

```javascript
// Rider location
latitude: -90 to 90
longitude: -180 to 180
accuracy: >= 0
timestamp: within last 60 seconds

// Sales backdating
created_at_override: within last 24 hours, not future

// Deliveries filter
filter: enum('active', 'history')
limit: 1-100
```

---

## 📝 Implementation Checklist

### Backend Developer Tasks

**Database Migrations:**
- [ ] Create migration for `riders` table changes
- [ ] Create migration for `deliveries` version column
- [ ] Create `delivery_events` table
- [ ] (Optional) Create `rider_location_history` table
- [ ] Test migrations on staging database

**API Implementation:**
- [ ] Implement `PATCH /api/riders/me`
- [ ] Implement `POST /api/riders/me/location`
- [ ] Implement `GET /api/riders/me/deliveries`
- [ ] Implement `GET /api/sales/today`
- [ ] Modify `POST /api/sales` (backdating)
- [ ] Modify `GET /api/orders` (cashier filtering)
- [ ] Modify `PATCH /api/deliveries/:id` (idempotency)

**Testing:**
- [ ] Unit tests for each new endpoint
- [ ] Integration tests for modified endpoints
- [ ] Test authorization rules
- [ ] Test rate limiting
- [ ] Test idempotency (delivery events)
- [ ] Test optimistic locking (delivery version)

**Documentation:**
- [ ] Update API documentation
- [ ] Update database schema docs
- [ ] Add migration instructions

**Deployment:**
- [ ] Deploy migrations to staging
- [ ] Deploy code to staging
- [ ] Smoke test all endpoints
- [ ] Load test location updates (60/min)
- [ ] Deploy to production

---

## 🧪 Testing Endpoints

### Manual Testing with curl

```bash
# 1. Rider availability
curl -X PATCH http://localhost:3000/api/riders/me \
  -H "Content-Type: application/json" \
  -b "juflow_session=<token>" \
  -d '{"is_available": true}'

# 2. Rider location
curl -X POST http://localhost:3000/api/riders/me/location \
  -H "Content-Type: application/json" \
  -b "juflow_session=<token>" \
  -d '{
    "latitude": 14.5995,
    "longitude": 120.9842,
    "accuracy": 10.5,
    "timestamp": "2026-10-12T11:00:00Z"
  }'

# 3. Rider deliveries (active)
curl http://localhost:3000/api/riders/me/deliveries?filter=active&limit=10 \
  -b "juflow_session=<token>"

# 4. Cashier today summary
curl http://localhost:3000/api/sales/today \
  -b "juflow_session=<token>"

# 5. Backdated sale
curl -X POST http://localhost:3000/api/sales \
  -H "Content-Type: application/json" \
  -b "juflow_session=<token>" \
  -d '{
    "dishes": [{"dish_id": "uuid", "quantity": 2}],
    "transaction_id": "TXN-TEST-001",
    "cashier_id": "uuid",
    "payment_method": "cash",
    "created_at_override": "2026-10-12T09:00:00Z"
  }'
```

---

## 📊 Success Metrics

### Phase 2 Complete When:

✅ All 4 new endpoints deployed and tested  
✅ All 3 endpoint modifications deployed and tested  
✅ Database migrations successful  
✅ Mobile apps can connect and function  
✅ Rider GPS updates working (60/min)  
✅ Cashier dashboard showing live data  
✅ Offline sync working (idempotency verified)  
✅ No authorization bypasses  
✅ Rate limits enforced  

---

## 🚀 Timeline Estimate

| Task | Effort | Timeline |
|------|--------|----------|
| Database migrations | 2 hours | Day 1 morning |
| New endpoints (4) | 4 hours | Day 1 afternoon |
| Modified endpoints (3) | 2 hours | Day 1 evening |
| Testing | 3 hours | Day 2 morning |
| Staging deployment | 1 hour | Day 2 afternoon |
| **Total** | **12 hours** | **1.5 days** |

---

## 📞 Questions or Issues?

Contact frontend team with:
- Mobile app repository location
- API contract document (`docs/api-contract.md`)
- This integration specification

---

**Document Status:** ✅ Ready for Backend Team  
**Created:** October 12, 2026  
**Version:** 1.0  
**Next Review:** After Phase 2 completion  

---

*This specification is complete and ready to be shared with the backend team.*

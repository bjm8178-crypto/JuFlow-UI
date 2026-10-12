#!/bin/bash
# JuFlow Mobile Apps - API Testing Script
# Test all 7 endpoints (4 new + 3 modified)

BASE_URL="${BASE_URL:-http://localhost:8000}"
RIDER_TOKEN="test-rider-session-cookie"
CASHIER_TOKEN="test-cashier-session-cookie"

echo "=========================================="
echo "JuFlow Mobile API - Endpoint Tests"
echo "=========================================="
echo ""
echo "Base URL: $BASE_URL"
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# ============================================================================
# Health Check
# ============================================================================

echo "--- Health Check ---"
curl -s "$BASE_URL/api/health" | jq '.'
echo ""

# ============================================================================
# NEW ENDPOINT 1: PATCH /api/riders/me - Availability Toggle
# ============================================================================

echo "--- NEW 1: Set Rider Available ---"
curl -s -X PATCH "$BASE_URL/api/riders/me" \
  -H "Content-Type: application/json" \
  -H "Cookie: juflow_session=$RIDER_TOKEN" \
  -d '{
    "is_available": true
  }' | jq '.'
echo ""

# ============================================================================
# NEW ENDPOINT 2: POST /api/riders/me/location - GPS Updates
# ============================================================================

echo "--- NEW 2: Update GPS Location ---"
curl -s -X POST "$BASE_URL/api/riders/me/location" \
  -H "Content-Type: application/json" \
  -H "Cookie: juflow_session=$RIDER_TOKEN" \
  -d '{
    "latitude": 14.5995,
    "longitude": 120.9842,
    "accuracy": 10.5,
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }' | jq '.'
echo ""

# ============================================================================
# NEW ENDPOINT 3: GET /api/riders/me/deliveries - Jobs List
# ============================================================================

echo "--- NEW 3: Get Active Deliveries ---"
curl -s "$BASE_URL/api/riders/me/deliveries?filter=active&limit=10" \
  -H "Cookie: juflow_session=$RIDER_TOKEN" | jq '.'
echo ""

echo "--- NEW 3: Get Delivery History ---"
curl -s "$BASE_URL/api/riders/me/deliveries?filter=history&limit=30" \
  -H "Cookie: juflow_session=$RIDER_TOKEN" | jq '.'
echo ""

# ============================================================================
# NEW ENDPOINT 4: GET /api/sales/today - Dashboard Data
# ============================================================================

echo "--- NEW 4: Get Today's Sales Summary ---"
curl -s "$BASE_URL/api/sales/today" \
  -H "Cookie: juflow_session=$CASHIER_TOKEN" | jq '.'
echo ""

# ============================================================================
# MODIFIED ENDPOINT 1: POST /api/sales - Add Backdating
# ============================================================================

echo "--- MODIFIED 1: Create Sale with Backdating ---"
BACKDATE=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)
curl -s -X POST "$BASE_URL/api/sales" \
  -H "Content-Type: application/json" \
  -H "Cookie: juflow_session=$CASHIER_TOKEN" \
  -d '{
    "dishes": [
      {"dish_id": "uuid-here", "quantity": 2, "price_centavos": 15000}
    ],
    "transaction_id": "TXN-TEST-'$(date +%s)'",
    "cashier_id": "cashier-uuid-here",
    "payment_method": "cash",
    "created_at_override": "'"$BACKDATE"'"
  }' | jq '.'
echo ""

# ============================================================================
# MODIFIED ENDPOINT 2: GET /api/orders - Add Cashier Filter
# ============================================================================

echo "--- MODIFIED 2: Get Orders by Cashier ---"
curl -s "$BASE_URL/api/orders?cashier_id=cashier-uuid-here&limit=10" \
  -H "Cookie: juflow_session=$CASHIER_TOKEN" | jq '.'
echo ""

# ============================================================================
# MODIFIED ENDPOINT 3: PATCH /api/deliveries/:id - Add Idempotency
# ============================================================================

echo "--- MODIFIED 3: Update Delivery with Idempotency ---"
DELIVERY_ID="delivery-uuid-here"
EVENT_ID="evt_test_$(date +%s)"

curl -s -X PATCH "$BASE_URL/api/deliveries/$DELIVERY_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: juflow_session=$RIDER_TOKEN" \
  -d '{
    "status": "picked_up",
    "event_id": "'"$EVENT_ID"'",
    "version": 0,
    "notes": "Test update from script"
  }' | jq '.'
echo ""

echo "--- MODIFIED 3: Replay Same Event (Idempotency Test) ---"
curl -s -X PATCH "$BASE_URL/api/deliveries/$DELIVERY_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: juflow_session=$RIDER_TOKEN" \
  -d '{
    "status": "picked_up",
    "event_id": "'"$EVENT_ID"'",
    "version": 0,
    "notes": "Duplicate event"
  }' | jq '.'
echo ""

# ============================================================================
# Rate Limiting Test (Location Updates)
# ============================================================================

echo "--- Rate Limit Test: 62 Location Updates ---"
echo "Sending 62 requests (should allow 60, reject 2)..."
SUCCESS=0
FAILED=0

for i in {1..62}; do
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/riders/me/location" \
    -H "Content-Type: application/json" \
    -H "Cookie: juflow_session=$RIDER_TOKEN" \
    -d '{
      "latitude": 14.5995,
      "longitude": 120.9842,
      "accuracy": 10.5,
      "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
    }')
  
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  
  if [ "$HTTP_CODE" = "200" ]; then
    ((SUCCESS++))
  else
    ((FAILED++))
  fi
done

echo "Results: $SUCCESS successful, $FAILED failed"
echo "Expected: 60 successful, 2 failed (429 Too Many Requests)"
echo ""

# ============================================================================
# Error Handling Tests
# ============================================================================

echo "--- Error Test 1: Invalid GPS Coordinates ---"
curl -s -X POST "$BASE_URL/api/riders/me/location" \
  -H "Content-Type: application/json" \
  -H "Cookie: juflow_session=$RIDER_TOKEN" \
  -d '{
    "latitude": 999,
    "longitude": 120.9842,
    "accuracy": 10.5,
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }' | jq '.'
echo ""

echo "--- Error Test 2: Future-Dated Sale ---"
FUTURE=$(date -u -d '1 hour' +%Y-%m-%dT%H:%M:%SZ)
curl -s -X POST "$BASE_URL/api/sales" \
  -H "Content-Type: application/json" \
  -H "Cookie: juflow_session=$CASHIER_TOKEN" \
  -d '{
    "dishes": [{"dish_id": "uuid", "quantity": 1, "price_centavos": 10000}],
    "transaction_id": "TXN-FUTURE-'$(date +%s)'",
    "cashier_id": "cashier-uuid",
    "payment_method": "cash",
    "created_at_override": "'"$FUTURE"'"
  }' | jq '.'
echo ""

echo "--- Error Test 3: Unauthorized Access ---"
curl -s -X PATCH "$BASE_URL/api/riders/me" \
  -H "Content-Type: application/json" \
  -d '{"is_available": true}' | jq '.'
echo ""

echo "--- Error Test 4: Version Conflict (Optimistic Locking) ---"
curl -s -X PATCH "$BASE_URL/api/deliveries/$DELIVERY_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: juflow_session=$RIDER_TOKEN" \
  -d '{
    "status": "delivered",
    "event_id": "evt_conflict_'$(date +%s)'",
    "version": 999,
    "notes": "Wrong version"
  }' | jq '.'
echo ""

# ============================================================================
# Summary
# ============================================================================

echo "=========================================="
echo "Testing Complete"
echo "=========================================="
echo ""
echo "Manual verification needed:"
echo "  1. Check database for inserted records"
echo "  2. Verify timezone handling (Philippines UTC+8)"
echo "  3. Confirm idempotency works (duplicate events)"
echo "  4. Test rate limiting reset after 1 minute"
echo ""
echo "Next steps:"
echo "  1. Run integration tests: pytest tests/"
echo "  2. Load test with k6 or Artillery"
echo "  3. Security audit with OWASP ZAP"
echo ""

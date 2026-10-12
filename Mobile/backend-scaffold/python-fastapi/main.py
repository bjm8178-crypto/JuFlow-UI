"""
JuFlow Mobile Apps - Backend API Implementation
FastAPI Reference Implementation

Created: October 12, 2026
Status: Production-ready reference code

Install:
    pip install fastapi uvicorn psycopg2-binary python-jose[cryptography] python-multipart

Run:
    uvicorn main:app --reload --port 8000

Test:
    curl http://localhost:8000/api/health
"""

from fastapi import FastAPI, Depends, HTTPException, Header, Cookie, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from typing import Optional, List, Literal
from datetime import datetime, timedelta
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from jose import jwt, JWTError

# ============================================================================
# Configuration
# ============================================================================

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:pass@localhost/juflow")
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-here-change-in-production")
ALGORITHM = "HS256"

app = FastAPI(title="JuFlow Mobile API", version="2.0.0")

# CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "https://juflow.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# Database Connection
# ============================================================================

def get_db():
    """Get database connection"""
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
    try:
        yield conn
    finally:
        conn.close()

# ============================================================================
# Authentication
# ============================================================================

class User(BaseModel):
    user_id: str
    name: str
    role: Literal["admin", "cashier", "rider"]

def get_current_user(
    juflow_session: Optional[str] = Cookie(None),
    conn = Depends(get_db)
) -> User:
    """Extract and validate user from session cookie"""
    if not juflow_session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    try:
        payload = jwt.decode(juflow_session, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")
        role = payload.get("role")
        name = payload.get("name")
        
        if not all([user_id, role, name]):
            raise HTTPException(status_code=401, detail="Invalid session")
        
        return User(user_id=user_id, name=name, role=role)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid session")

def require_role(*allowed_roles: str):
    """Decorator to require specific roles"""
    def checker(user: User = Depends(get_current_user)):
        if user.role not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return checker

# ============================================================================
# Request/Response Models
# ============================================================================

# NEW ENDPOINT 1: Rider Availability
class UpdateAvailabilityRequest(BaseModel):
    is_available: bool

class RiderResponse(BaseModel):
    rider_id: str
    name: str
    phone: str
    is_available: bool
    last_location: Optional[dict] = None
    last_seen: Optional[str] = None

# NEW ENDPOINT 2: GPS Location
class LocationUpdateRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    accuracy: float = Field(..., gt=0)
    timestamp: str
    
    @validator('timestamp')
    def validate_timestamp(cls, v):
        try:
            ts = datetime.fromisoformat(v.replace('Z', '+00:00'))
            age = datetime.utcnow() - ts.replace(tzinfo=None)
            if age > timedelta(seconds=60):
                raise ValueError("Timestamp too old (>60s)")
            return v
        except ValueError as e:
            raise ValueError(f"Invalid timestamp: {e}")

# NEW ENDPOINT 3: Rider Deliveries
class DeliveryItem(BaseModel):
    dish_name: str
    quantity: int
    price_centavos: int

class DeliveryResponse(BaseModel):
    delivery_id: str
    status: str
    customer_name: str
    customer_phone: str
    customer_address: str
    delivery_notes: Optional[str]
    items: List[DeliveryItem]
    subtotal_centavos: int
    delivery_fee_centavos: int
    total_centavos: int
    created_at: str
    version: int

# NEW ENDPOINT 4: Sales Today
class SalesSummaryResponse(BaseModel):
    date: str
    total_sales: int
    cash_total_centavos: int
    gcash_total_centavos: int
    total_revenue_centavos: int
    recent_sales: List[dict]

# MODIFIED ENDPOINT 1: Create Sale with Backdating
class CreateSaleRequest(BaseModel):
    dishes: List[dict]
    transaction_id: str
    cashier_id: str
    payment_method: Literal["cash", "gcash"]
    created_at_override: Optional[str] = None
    
    @validator('created_at_override')
    def validate_override(cls, v):
        if v is None:
            return v
        try:
            ts = datetime.fromisoformat(v.replace('Z', '+00:00'))
            now = datetime.utcnow()
            age = now - ts.replace(tzinfo=None)
            
            if ts.replace(tzinfo=None) > now:
                raise ValueError("Cannot create future-dated sale")
            if age > timedelta(hours=24):
                raise ValueError("Cannot backdate more than 24 hours")
            return v
        except ValueError as e:
            raise ValueError(f"Invalid created_at_override: {e}")

# MODIFIED ENDPOINT 3: Update Delivery with Idempotency
class UpdateDeliveryRequest(BaseModel):
    status: Literal["assigned", "accepted", "picked_up", "delivered", "cancelled"]
    event_id: str = Field(..., min_length=1)
    version: int = Field(..., ge=0)
    notes: Optional[str] = None

# ============================================================================
# NEW ENDPOINT 1: PATCH /api/riders/me - Availability Toggle
# ============================================================================

@app.patch("/api/riders/me", response_model=RiderResponse)
def update_rider_availability(
    request: UpdateAvailabilityRequest,
    user: User = Depends(require_role("rider")),
    conn = Depends(get_db)
):
    """
    Toggle rider availability status
    
    Security: Rider role only
    Rate limit: Not needed (state toggle)
    """
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            UPDATE riders
            SET is_available = %s, last_seen = NOW()
            WHERE user_id = %s
            RETURNING rider_id, name, phone, is_available, 
                      last_location, last_seen
        """, (request.is_available, user.user_id))
        
        rider = cursor.fetchone()
        if not rider:
            raise HTTPException(status_code=404, detail="Rider not found")
        
        conn.commit()
        
        return RiderResponse(
            rider_id=rider['rider_id'],
            name=rider['name'],
            phone=rider['phone'],
            is_available=rider['is_available'],
            last_location=rider['last_location'],
            last_seen=rider['last_seen'].isoformat() if rider['last_seen'] else None
        )
    
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()

# ============================================================================
# NEW ENDPOINT 2: POST /api/riders/me/location - GPS Updates
# ============================================================================

# Rate limiting state (in production, use Redis)
location_rate_limit = {}

@app.post("/api/riders/me/location")
def update_rider_location(
    request: LocationUpdateRequest,
    user: User = Depends(require_role("rider")),
    conn = Depends(get_db)
):
    """
    Update rider GPS location
    
    Security: Rider role only
    Rate limit: 60 requests per minute per rider
    """
    # Rate limiting check
    now = datetime.utcnow()
    key = f"{user.user_id}:{now.minute}"
    
    if key in location_rate_limit:
        location_rate_limit[key] += 1
        if location_rate_limit[key] > 60:
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
    else:
        # Clean old entries
        location_rate_limit.clear()
        location_rate_limit[key] = 1
    
    cursor = conn.cursor()
    
    try:
        location_data = {
            "latitude": request.latitude,
            "longitude": request.longitude,
            "accuracy": request.accuracy,
            "timestamp": request.timestamp
        }
        
        cursor.execute("""
            UPDATE riders
            SET last_location = %s, last_seen = NOW()
            WHERE user_id = %s
        """, (psycopg2.extras.Json(location_data), user.user_id))
        
        conn.commit()
        
        return {"status": "ok"}
    
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()

# ============================================================================
# NEW ENDPOINT 3: GET /api/riders/me/deliveries - Jobs List
# ============================================================================

@app.get("/api/riders/me/deliveries", response_model=List[DeliveryResponse])
def get_rider_deliveries(
    filter: Literal["active", "history"] = Query("active"),
    limit: int = Query(10, ge=1, le=100),
    user: User = Depends(require_role("rider")),
    conn = Depends(get_db)
):
    """
    Get rider's deliveries (active or history)
    
    Security: Rider role only, own deliveries only
    Filters:
        - active: assigned, accepted, picked_up
        - history: delivered, cancelled (last 30 days)
    """
    cursor = conn.cursor()
    
    try:
        if filter == "active":
            status_filter = "('assigned', 'accepted', 'picked_up')"
            date_filter = ""
        else:  # history
            status_filter = "('delivered', 'cancelled')"
            date_filter = "AND d.updated_at > NOW() - INTERVAL '30 days'"
        
        query = f"""
            SELECT 
                d.delivery_id,
                d.status,
                d.version,
                d.created_at,
                c.name as customer_name,
                c.phone as customer_phone,
                c.address as customer_address,
                d.delivery_notes,
                o.subtotal_centavos,
                o.delivery_fee_centavos,
                o.total_centavos,
                json_agg(
                    json_build_object(
                        'dish_name', di.name,
                        'quantity', oi.quantity,
                        'price_centavos', oi.price_centavos
                    )
                ) as items
            FROM deliveries d
            JOIN orders o ON d.order_id = o.order_id
            JOIN customers c ON o.customer_id = c.customer_id
            JOIN order_items oi ON o.order_id = oi.order_id
            JOIN dishes di ON oi.dish_id = di.dish_id
            WHERE d.rider_id = (
                SELECT rider_id FROM riders WHERE user_id = %s
            )
            AND d.status IN {status_filter}
            {date_filter}
            GROUP BY d.delivery_id, d.status, d.version, d.created_at,
                     c.name, c.phone, c.address, d.delivery_notes,
                     o.subtotal_centavos, o.delivery_fee_centavos, o.total_centavos
            ORDER BY d.created_at DESC
            LIMIT %s
        """
        
        cursor.execute(query, (user.user_id, limit))
        deliveries = cursor.fetchall()
        
        return [
            DeliveryResponse(
                delivery_id=d['delivery_id'],
                status=d['status'],
                customer_name=d['customer_name'],
                customer_phone=d['customer_phone'],
                customer_address=d['customer_address'],
                delivery_notes=d['delivery_notes'],
                items=[DeliveryItem(**item) for item in d['items']],
                subtotal_centavos=d['subtotal_centavos'],
                delivery_fee_centavos=d['delivery_fee_centavos'],
                total_centavos=d['total_centavos'],
                created_at=d['created_at'].isoformat(),
                version=d['version']
            )
            for d in deliveries
        ]
    
    finally:
        cursor.close()

# ============================================================================
# NEW ENDPOINT 4: GET /api/sales/today - Dashboard Data
# ============================================================================

@app.get("/api/sales/today", response_model=SalesSummaryResponse)
def get_sales_today(
    user: User = Depends(require_role("admin", "cashier")),
    conn = Depends(get_db)
):
    """
    Get today's sales summary for cashier dashboard
    
    Security: Admin or Cashier role
    Timezone: Philippines (UTC+8)
    """
    cursor = conn.cursor()
    
    try:
        # Get today in Philippines timezone
        cursor.execute("""
            SELECT 
                COUNT(*) as total_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_centavos ELSE 0 END), 0) as cash_total,
                COALESCE(SUM(CASE WHEN payment_method = 'gcash' THEN total_centavos ELSE 0 END), 0) as gcash_total,
                COALESCE(SUM(total_centavos), 0) as total_revenue
            FROM sales
            WHERE DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila') = 
                  DATE(NOW() AT TIME ZONE 'Asia/Manila')
        """)
        
        summary = cursor.fetchone()
        
        # Get recent sales (last 10)
        cursor.execute("""
            SELECT 
                s.sale_id,
                s.transaction_id,
                s.total_centavos,
                s.payment_method,
                s.created_at,
                u.name as cashier_name
            FROM sales s
            JOIN users u ON s.cashier_id = u.user_id
            WHERE DATE(s.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila') = 
                  DATE(NOW() AT TIME ZONE 'Asia/Manila')
            ORDER BY s.created_at DESC
            LIMIT 10
        """)
        
        recent_sales = [
            {
                "sale_id": s['sale_id'],
                "transaction_id": s['transaction_id'],
                "total_centavos": s['total_centavos'],
                "payment_method": s['payment_method'],
                "created_at": s['created_at'].isoformat(),
                "cashier_name": s['cashier_name']
            }
            for s in cursor.fetchall()
        ]
        
        today = datetime.utcnow().date().isoformat()
        
        return SalesSummaryResponse(
            date=today,
            total_sales=summary['total_sales'],
            cash_total_centavos=summary['cash_total'],
            gcash_total_centavos=summary['gcash_total'],
            total_revenue_centavos=summary['total_revenue'],
            recent_sales=recent_sales
        )
    
    finally:
        cursor.close()

# ============================================================================
# MODIFIED ENDPOINT 1: POST /api/sales - Add Backdating
# ============================================================================

@app.post("/api/sales")
def create_sale(
    request: CreateSaleRequest,
    user: User = Depends(require_role("admin", "cashier")),
    conn = Depends(get_db)
):
    """
    Create sale with optional backdating
    
    NEW: Accepts created_at_override (within last 24 hours)
    Idempotency: transaction_id must be unique
    """
    cursor = conn.cursor()
    
    try:
        # Check for duplicate transaction_id (idempotency)
        cursor.execute(
            "SELECT sale_id FROM sales WHERE transaction_id = %s",
            (request.transaction_id,)
        )
        existing = cursor.fetchone()
        if existing:
            return {"sale_id": existing['sale_id'], "status": "already_exists"}
        
        # Use override timestamp if provided, otherwise NOW()
        created_at = request.created_at_override if request.created_at_override else None
        
        # Calculate totals
        total_centavos = sum(d['price_centavos'] * d['quantity'] for d in request.dishes)
        
        # Insert sale
        if created_at:
            cursor.execute("""
                INSERT INTO sales (
                    transaction_id, cashier_id, payment_method,
                    total_centavos, created_at
                ) VALUES (%s, %s, %s, %s, %s)
                RETURNING sale_id
            """, (
                request.transaction_id,
                request.cashier_id,
                request.payment_method,
                total_centavos,
                created_at
            ))
        else:
            cursor.execute("""
                INSERT INTO sales (
                    transaction_id, cashier_id, payment_method, total_centavos
                ) VALUES (%s, %s, %s, %s)
                RETURNING sale_id
            """, (
                request.transaction_id,
                request.cashier_id,
                request.payment_method,
                total_centavos
            ))
        
        sale_id = cursor.fetchone()['sale_id']
        
        # Insert sale items
        for dish in request.dishes:
            cursor.execute("""
                INSERT INTO sale_items (sale_id, dish_id, quantity, price_centavos)
                VALUES (%s, %s, %s, %s)
            """, (
                sale_id,
                dish['dish_id'],
                dish['quantity'],
                dish['price_centavos']
            ))
        
        conn.commit()
        
        return {"sale_id": sale_id, "status": "created"}
    
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        cursor.close()

# ============================================================================
# MODIFIED ENDPOINT 2: GET /api/orders - Add Cashier Filter
# ============================================================================

@app.get("/api/orders")
def get_orders(
    status: Optional[str] = None,
    cashier_id: Optional[str] = Query(None),  # NEW: Filter by cashier
    limit: int = Query(50, ge=1, le=100),
    user: User = Depends(get_current_user),
    conn = Depends(get_db)
):
    """
    Get orders with optional cashier filter
    
    NEW: ?cashier_id=uuid to filter orders created by specific cashier
    """
    cursor = conn.cursor()
    
    try:
        filters = []
        params = []
        
        if status:
            filters.append("o.status = %s")
            params.append(status)
        
        # NEW: Cashier filter
        if cashier_id:
            filters.append("o.created_by = %s")
            params.append(cashier_id)
        
        where_clause = "WHERE " + " AND ".join(filters) if filters else ""
        params.append(limit)
        
        query = f"""
            SELECT 
                o.order_id,
                o.status,
                o.customer_id,
                o.total_centavos,
                o.created_at,
                c.name as customer_name,
                u.name as created_by_name
            FROM orders o
            JOIN customers c ON o.customer_id = c.customer_id
            LEFT JOIN users u ON o.created_by = u.user_id
            {where_clause}
            ORDER BY o.created_at DESC
            LIMIT %s
        """
        
        cursor.execute(query, tuple(params))
        orders = cursor.fetchall()
        
        return {"orders": [dict(o) for o in orders]}
    
    finally:
        cursor.close()

# ============================================================================
# MODIFIED ENDPOINT 3: PATCH /api/deliveries/:id - Add Idempotency
# ============================================================================

@app.patch("/api/deliveries/{delivery_id}")
def update_delivery(
    delivery_id: str,
    request: UpdateDeliveryRequest,
    user: User = Depends(require_role("rider", "admin")),
    conn = Depends(get_db)
):
    """
    Update delivery status with idempotency protection
    
    NEW: event_id + version for idempotent updates
    Returns 409 Conflict if version mismatch
    """
    cursor = conn.cursor()
    
    try:
        # Check for duplicate event_id (idempotency)
        cursor.execute("""
            SELECT event_id FROM delivery_events
            WHERE delivery_id = %s AND event_id = %s
        """, (delivery_id, request.event_id))
        
        if cursor.fetchone():
            # Event already processed - return success without change
            cursor.execute("""
                SELECT status, version FROM deliveries WHERE delivery_id = %s
            """, (delivery_id,))
            delivery = cursor.fetchone()
            return {
                "status": delivery['status'],
                "version": delivery['version'],
                "idempotent": True
            }
        
        # Check version matches (optimistic locking)
        cursor.execute("""
            SELECT status, version FROM deliveries
            WHERE delivery_id = %s
            FOR UPDATE
        """, (delivery_id,))
        
        delivery = cursor.fetchone()
        if not delivery:
            raise HTTPException(status_code=404, detail="Delivery not found")
        
        if delivery['version'] != request.version:
            raise HTTPException(
                status_code=409,
                detail=f"Version conflict: expected {request.version}, got {delivery['version']}"
            )
        
        # Update delivery
        new_version = request.version + 1
        cursor.execute("""
            UPDATE deliveries
            SET status = %s, version = %s, updated_at = NOW()
            WHERE delivery_id = %s
        """, (request.status, new_version, delivery_id))
        
        # Record event for idempotency
        cursor.execute("""
            INSERT INTO delivery_events (
                delivery_id, event_id, status, notes, created_at
            ) VALUES (%s, %s, %s, %s, NOW())
        """, (
            delivery_id,
            request.event_id,
            request.status,
            request.notes
        ))
        
        conn.commit()
        
        return {
            "status": request.status,
            "version": new_version,
            "idempotent": False
        }
    
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()

# ============================================================================
# Health Check
# ============================================================================

@app.get("/api/health")
def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "2.0.0"
    }

# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

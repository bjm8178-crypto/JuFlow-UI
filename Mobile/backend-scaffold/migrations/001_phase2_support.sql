-- JuFlow Mobile Apps - Database Migrations
-- Phase 2: Backend API Support
-- Run this migration to add required fields and tables

-- ============================================================================
-- Migration 1: Add rider availability and location tracking
-- ============================================================================

ALTER TABLE riders 
ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_location JSONB,
ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_riders_available 
ON riders(is_available) WHERE is_available = true;

CREATE INDEX IF NOT EXISTS idx_riders_last_seen 
ON riders(last_seen DESC);

COMMENT ON COLUMN riders.is_available IS 'Whether rider is currently accepting deliveries';
COMMENT ON COLUMN riders.last_location IS 'Last GPS location: {latitude, longitude, accuracy, timestamp}';
COMMENT ON COLUMN riders.last_seen IS 'Last time rider was active (updated on location ping)';

-- ============================================================================
-- Migration 2: Add delivery versioning for optimistic locking
-- ============================================================================

ALTER TABLE deliveries
ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 0;

COMMENT ON COLUMN deliveries.version IS 'Optimistic locking version, incremented on each status change';

-- ============================================================================
-- Migration 3: Create delivery events table for idempotency
-- ============================================================================

CREATE TABLE IF NOT EXISTS delivery_events (
    event_id VARCHAR(255) PRIMARY KEY,
    delivery_id UUID NOT NULL REFERENCES deliveries(delivery_id),
    status VARCHAR(50) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_delivery_events_delivery 
        FOREIGN KEY (delivery_id) 
        REFERENCES deliveries(delivery_id) 
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_delivery_events_delivery 
ON delivery_events(delivery_id, created_at DESC);

COMMENT ON TABLE delivery_events IS 'Event log for delivery status changes, provides idempotency protection';
COMMENT ON COLUMN delivery_events.event_id IS 'Client-generated unique event ID for idempotency';

-- ============================================================================
-- Migration 4: Add created_by to orders for cashier filtering
-- ============================================================================

-- If not already present from original schema
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(user_id);

CREATE INDEX IF NOT EXISTS idx_orders_created_by 
ON orders(created_by);

COMMENT ON COLUMN orders.created_by IS 'User ID of cashier who created the order';

-- ============================================================================
-- Migration 5: Update sales table to support backdating
-- ============================================================================

-- Ensure created_at can be set explicitly (should already allow this)
-- Add constraint to prevent future dates and excessive backdating

ALTER TABLE sales
DROP CONSTRAINT IF EXISTS check_sales_created_at_not_future;

ALTER TABLE sales
ADD CONSTRAINT check_sales_created_at_not_future
CHECK (created_at <= CURRENT_TIMESTAMP);

ALTER TABLE sales
DROP CONSTRAINT IF EXISTS check_sales_created_at_reasonable;

ALTER TABLE sales
ADD CONSTRAINT check_sales_created_at_reasonable
CHECK (created_at > CURRENT_TIMESTAMP - INTERVAL '30 days');

COMMENT ON CONSTRAINT check_sales_created_at_not_future ON sales IS 'Prevents future-dated sales';
COMMENT ON CONSTRAINT check_sales_created_at_reasonable ON sales IS 'Prevents excessive backdating (max 30 days)';

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Check riders table columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'riders'
AND column_name IN ('is_available', 'last_location', 'last_seen')
ORDER BY column_name;

-- Check deliveries version column
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'deliveries'
AND column_name = 'version';

-- Check delivery_events table exists
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_name = 'delivery_events';

-- Count existing delivery events
SELECT COUNT(*) as event_count FROM delivery_events;

-- Check orders created_by column
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'orders'
AND column_name = 'created_by';

-- Verify sales constraints
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name LIKE '%sales%created_at%';

-- ============================================================================
-- Rollback (if needed)
-- ============================================================================

-- Uncomment to rollback migrations

-- DROP INDEX IF EXISTS idx_riders_available;
-- DROP INDEX IF EXISTS idx_riders_last_seen;
-- DROP INDEX IF EXISTS idx_delivery_events_delivery;
-- DROP INDEX IF EXISTS idx_orders_created_by;

-- ALTER TABLE riders DROP COLUMN IF EXISTS is_available;
-- ALTER TABLE riders DROP COLUMN IF EXISTS last_location;
-- ALTER TABLE riders DROP COLUMN IF EXISTS last_seen;

-- ALTER TABLE deliveries DROP COLUMN IF EXISTS version;

-- DROP TABLE IF EXISTS delivery_events CASCADE;

-- ALTER TABLE sales DROP CONSTRAINT IF EXISTS check_sales_created_at_not_future;
-- ALTER TABLE sales DROP CONSTRAINT IF EXISTS check_sales_created_at_reasonable;

-- ============================================================================
-- Sample Data (for testing)
-- ============================================================================

-- Mark a test rider as available
-- UPDATE riders SET is_available = true WHERE rider_id = '<test-rider-id>';

-- ============================================================================
-- Performance Notes
-- ============================================================================

-- The following indexes support efficient queries:
-- - idx_riders_available: Quick lookup of available riders
-- - idx_riders_last_seen: Sort riders by recent activity
-- - idx_delivery_events_delivery: Fast event lookup per delivery
-- - idx_orders_created_by: Filter orders by cashier

-- Consider adding these if query volume is high:
-- CREATE INDEX IF NOT EXISTS idx_deliveries_rider_status ON deliveries(rider_id, status);
-- CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at DESC);

-- ============================================================================
-- End of Migration
-- ============================================================================

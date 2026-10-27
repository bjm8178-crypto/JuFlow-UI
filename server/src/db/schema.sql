-- PostgreSQL Schema for JuFlow / Juki Kitchen Operations

CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(50) UNIQUE,
  description TEXT,
  permissions JSONB DEFAULT '[]'::jsonb,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(100) UNIQUE,
  email VARCHAR(150),
  phone VARCHAR(50),
  role_id VARCHAR(64),
  password_hash VARCHAR(255),
  full_name VARCHAR(150),
  is_active BOOLEAN DEFAULT TRUE,
  failed_attempts INT DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_partial ON users(email) WHERE email IS NOT NULL AND email != '';

CREATE TABLE IF NOT EXISTS auth_sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  token_hash VARCHAR(64) UNIQUE,
  ip_address VARCHAR(100),
  user_agent TEXT,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(100) UNIQUE,
  slug VARCHAR(100),
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(64) PRIMARY KEY,
  category_id VARCHAR(64),
  name VARCHAR(150),
  name_key VARCHAR(150),
  description TEXT,
  price_centavos INT DEFAULT 0,
  cost_centavos INT DEFAULT 0,
  is_available BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  image_url TEXT,
  image_id VARCHAR(64),
  options JSONB DEFAULT '[]'::jsonb,
  tags JSONB DEFAULT '[]'::jsonb,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_name_key ON products(name_key);
CREATE INDEX IF NOT EXISTS idx_products_available_active ON products(is_available, is_active);

CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(150),
  phone VARCHAR(50),
  messenger VARCHAR(100),
  address TEXT,
  landmark TEXT,
  landmark_photo TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_is_active ON customers(is_active);

CREATE TABLE IF NOT EXISTS delivery_zones (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(100),
  fee_centavos INT DEFAULT 0,
  estimated_minutes INT DEFAULT 30,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS riders (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  name VARCHAR(150),
  phone VARCHAR(50),
  vehicle_type VARCHAR(50),
  vehicle_plate VARCHAR(50),
  status VARCHAR(50) DEFAULT 'offline',
  is_active BOOLEAN DEFAULT TRUE,
  last_lat DOUBLE PRECISION,
  last_lng DOUBLE PRECISION,
  last_location_at TIMESTAMPTZ,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_riders_user_id_unique ON riders(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_riders_phone ON riders(phone);

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(64) PRIMARY KEY,
  order_number VARCHAR(50) UNIQUE,
  order_seq INT,
  idempotency_key VARCHAR(100),
  customer_id VARCHAR(64),
  customer JSONB DEFAULT '{}'::jsonb,
  items JSONB DEFAULT '[]'::jsonb,
  subtotal_centavos INT DEFAULT 0,
  fee_centavos INT DEFAULT 0,
  total_centavos INT DEFAULT 0,
  cash_tendered_centavos INT,
  change_centavos INT,
  payment_method VARCHAR(50),
  payment_reference VARCHAR(100),
  payment_status VARCHAR(50) DEFAULT 'pending',
  payment_verified BOOLEAN DEFAULT FALSE,
  preparation_status VARCHAR(50) DEFAULT 'pending',
  delivery_status VARCHAR(50) DEFAULT 'pending',
  status VARCHAR(50) DEFAULT 'received',
  rider_id VARCHAR(64),
  rider TEXT,
  delivery_id VARCHAR(64),
  notes TEXT,
  version INT DEFAULT 1,
  request_digest VARCHAR(100),
  created_by VARCHAR(64),
  recorded_by VARCHAR(100),
  on_the_way_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_unique ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

CREATE TABLE IF NOT EXISTS deliveries (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) UNIQUE,
  customer_id VARCHAR(64),
  rider_id VARCHAR(64),
  status VARCHAR(50) DEFAULT 'pending',
  notes TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deliveries_rider_status ON deliveries(rider_id, status);

CREATE TABLE IF NOT EXISTS sales (
  id VARCHAR(64) PRIMARY KEY,
  transaction_id VARCHAR(100) UNIQUE,
  order_id VARCHAR(64),
  void_id VARCHAR(100),
  event_id VARCHAR(100),
  sale_time TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  source VARCHAR(50),
  payment_method VARCHAR(50),
  items JSONB DEFAULT '[]'::jsonb,
  food_centavos INT DEFAULT 0,
  fee_centavos INT DEFAULT 0,
  total_centavos INT DEFAULT 0,
  cash_tendered_centavos INT,
  gcash_reference VARCHAR(100),
  recorded_by VARCHAR(100),
  recorded_actor VARCHAR(100),
  recorded_role VARCHAR(50),
  is_test_sale BOOLEAN DEFAULT FALSE,
  digest VARCHAR(100),
  verification JSONB,
  voided_at TIMESTAMPTZ,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_transaction_id_unique ON sales(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_void_id_unique ON sales(void_id) WHERE void_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_order_settlement_unique ON sales(order_id) WHERE order_id IS NOT NULL AND order_id != '';
CREATE INDEX IF NOT EXISTS idx_sales_sale_time ON sales(sale_time DESC);
CREATE INDEX IF NOT EXISTS idx_sales_is_test_sale ON sales(is_test_sale);

CREATE TABLE IF NOT EXISTS settings (
  id VARCHAR(64) PRIMARY KEY,
  key VARCHAR(100) UNIQUE,
  value JSONB,
  description TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_menu (
  id VARCHAR(64) PRIMARY KEY,
  date VARCHAR(20) UNIQUE,
  dishes JSONB DEFAULT '[]'::jsonb,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(50),
  title TEXT,
  body TEXT,
  read BOOLEAN DEFAULT FALSE,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

CREATE TABLE IF NOT EXISTS counters (
  id VARCHAR(64) PRIMARY KEY,
  seq BIGINT DEFAULT 1000,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id VARCHAR(64) PRIMARY KEY,
  event_id VARCHAR(100) UNIQUE,
  entity_type VARCHAR(50),
  entity_id VARCHAR(64),
  action VARCHAR(50),
  actor VARCHAR(100),
  details JSONB DEFAULT '{}'::jsonb,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_event_unique ON audit_events(event_id) WHERE event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS media_files (
  id VARCHAR(64) PRIMARY KEY,
  filename VARCHAR(255),
  content_type VARCHAR(100),
  size INT,
  data JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integrity_guards (
  id VARCHAR(64) PRIMARY KEY,
  revision INT DEFAULT 0,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

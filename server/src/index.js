import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { connect, close } from './db/mongodb.js';
import { bootstrap } from './db/bootstrap.js';
import { cashierTokenAuth } from './middleware/cashier.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// MIDDLEWARE
// ============================================================================

const isProd = process.env.NODE_ENV === 'production';

// Render (and Vercel in front of it) are reverse proxies. TRUST_PROXY = number of proxy hops.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
app.disable('x-powered-by');
app.use(helmet());

// CORS_ORIGINS: comma-separated list of allowed browser origins (e.g. your Vercel URL).
// With the Vercel rewrite in vercel.json the browser talks same-origin, so CORS is only
// needed for direct cross-origin clients. Unset in production = no cross-origin access.
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length
  ? { origin: allowedOrigins, credentials: true }
  : isProd ? { origin: false } : { origin: true, credentials: true }));

app.use(express.json({ limit: '1mb' }));

// CSRF defence for cookie-authenticated, state-changing requests: SameSite=Lax cookie
// plus an Origin allow-list check (only enforced when CORS_ORIGINS is configured).
app.use((req, res, next) => {
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const origin = req.headers.origin;
  const usesBearer = (req.headers.authorization || '').startsWith('Bearer ');
  if (unsafe && origin && !usesBearer && allowedOrigins.length && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'bad_origin', message: 'Origin not allowed' });
  }
  next();
});

// Rate limits
const apiLimiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'Too many login attempts. Try again later.' }
});
app.use('/api', apiLimiter);
app.use('/api/auth/login', loginLimiter);

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Request logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: 'juflow-api-v1',
    timestamp: new Date().toISOString(),
    timezone: process.env.TZ || 'Asia/Manila'
  });
});

// ============================================================================
// API ROUTES
// ============================================================================

// Phase 1 routes (Authentication & Foundation)
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import ridersRoutes from './routes/riders.js';
import settingsRoutes from './routes/settings.js';
import deliveryZonesRoutes from './routes/delivery-zones.js';
import productsRoutes from './routes/products.js';

// Phase 2 routes (Menu, Customers, Orders)
import categoriesRoutes from './routes/categories.js';
import customersRoutes from './routes/customers.js';
import ordersRoutes from './routes/orders.js';

// Phase 3 routes (Sales, Deliveries)
import salesRoutes, { cashierRouter as cashierSalesRoutes } from './routes/sales.js';
import deliveriesRoutes from './routes/deliveries.js';

// Auth routes
app.use('/api/auth', authRoutes);

// User & rider management
app.use('/api/users', usersRoutes);
app.use('/api/riders', ridersRoutes);

// Menu
app.use('/api/products', productsRoutes);
app.use('/api/categories', categoriesRoutes);

// Customers
app.use('/api/customers', customersRoutes);

// Orders
app.use('/api/orders', ordersRoutes);

// Sales
app.use('/api/sales', salesRoutes);
app.use('/api/cashier/sales', cashierTokenAuth, cashierSalesRoutes);

// Deliveries
app.use('/api/deliveries', deliveriesRoutes);

// Settings
app.use('/api/settings', settingsRoutes);
app.use('/api/delivery-zones', deliveryZonesRoutes);

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'not_found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);

  const status = err.status || 500;
  const message = status >= 500 && isProd ? 'Internal server error' : (err.message || 'Internal server error');

  res.status(status).json({
    error: err.code || 'server_error',
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ============================================================================
// START SERVER
// ============================================================================

async function startServer() {
  try {
    if (isProd && !process.env.MONGODB_URI) throw new Error('MONGODB_URI is required in production');
    if (isProd && !process.env.CASHIER_API_TOKEN) console.warn('⚠️  CASHIER_API_TOKEN not set: /api/cashier/sales will reject all requests.');

    // Connect to MongoDB first
    const db = await connect();
    await bootstrap(db);

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('\n🚀 JuFlow API Server');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Database: MongoDB`);
      console.log(`   Port: ${PORT}`);
      console.log(`   URL: http://localhost:${PORT}`);
      console.log(`   Network: http://0.0.0.0:${PORT} (all interfaces)`);
      console.log(`   Health: http://localhost:${PORT}/api/health`);
      console.log(`   Timezone: ${process.env.TZ || 'Asia/Manila'}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    });

    const shutdown = async (sig) => {
      console.log(`${sig} received, shutting down...`);
      server.close(async () => { await close(); process.exit(0); });
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Only listen when run directly (`node src/index.js`), so tests can import the app.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}

export default app;

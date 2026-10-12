import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connect } from './db/mongodb.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

// Auth routes
app.use('/api/auth', authRoutes);

// User & rider management
app.use('/api/users', usersRoutes);
app.use('/api/riders', ridersRoutes);

// Menu
app.use('/api/products', productsRoutes);
// app.use('/api/categories', categoriesRoutes);
// app.use('/api/daily-menu', dailyMenuRoutes);

// Customers
// app.use('/api/customers', customersRoutes);

// Orders
// app.use('/api/orders', ordersRoutes);

// Sales
// app.use('/api/sales', salesRoutes);
// app.use('/api/cashier/sales', cashierSalesRoutes);

// Deliveries
// app.use('/api/deliveries', deliveriesRoutes);

// Inventory
// app.use('/api/inventory-items', inventoryRoutes);
// app.use('/api/suppliers', suppliersRoutes);
// app.use('/api/purchases', purchasesRoutes);

// Finance
// app.use('/api/expenses', expensesRoutes);
// app.use('/api/closing', closingRoutes);

// Reports
// app.use('/api/reports', reportsRoutes);

// Settings
app.use('/api/settings', settingsRoutes);
app.use('/api/delivery-zones', deliveryZonesRoutes);

// Notifications & Audit
// app.use('/api/notifications', notificationsRoutes);
// app.use('/api/audit-logs', auditLogsRoutes);

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
  const message = err.message || 'Internal server error';

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
    // Connect to MongoDB first
    await connect();
    
    app.listen(PORT, '0.0.0.0', () => {
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
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

// Import route modules to test that they initialize and export express routers
import categoriesRouter from '../src/routes/categories.js';
import customersRouter from '../src/routes/customers.js';
import ordersRouter from '../src/routes/orders.js';
import salesRouter from '../src/routes/sales.js';
import deliveriesRouter from '../src/routes/deliveries.js';
import productsRouter from '../src/routes/products.js';
import usersRouter from '../src/routes/users.js';
import authRouter from '../src/routes/auth.js';
import ridersRouter from '../src/routes/riders.js';
import settingsRouter from '../src/routes/settings.js';
import zonesRouter from '../src/routes/delivery-zones.js';

describe('Route Modules Initialization', () => {
  it('all routers export valid Express Router functions', () => {
    assert.strictEqual(typeof categoriesRouter, 'function');
    assert.strictEqual(typeof customersRouter, 'function');
    assert.strictEqual(typeof ordersRouter, 'function');
    assert.strictEqual(typeof salesRouter, 'function');
    assert.strictEqual(typeof deliveriesRouter, 'function');
    assert.strictEqual(typeof productsRouter, 'function');
    assert.strictEqual(typeof usersRouter, 'function');
    assert.strictEqual(typeof authRouter, 'function');
    assert.strictEqual(typeof ridersRouter, 'function');
    assert.strictEqual(typeof settingsRouter, 'function');
    assert.strictEqual(typeof zonesRouter, 'function');
  });
});

describe('Price Validation Logic', () => {
  function validatePrice(price_centavos) {
    if (price_centavos === undefined || price_centavos === null) {
      return { valid: false, error: 'Name and price are required' };
    }
    const parsed = parseInt(price_centavos);
    if (isNaN(parsed) || parsed < 0) {
      return { valid: false, error: 'Price must be a non-negative integer (centavos)' };
    }
    return { valid: true, price: parsed };
  }

  it('accepts 0 centavos (free items/promo)', () => {
    const res = validatePrice(0);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.price, 0);
  });

  it('accepts valid positive integer price', () => {
    const res = validatePrice(7500);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.price, 7500);
  });

  it('accepts string number price and parses to integer', () => {
    const res = validatePrice('8000');
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.price, 8000);
  });

  it('rejects negative prices', () => {
    const res = validatePrice(-500);
    assert.strictEqual(res.valid, false);
  });

  it('rejects non-numeric NaN prices', () => {
    const res = validatePrice('invalid_price');
    assert.strictEqual(res.valid, false);
  });

  it('rejects null or undefined price', () => {
    assert.strictEqual(validatePrice(null).valid, false);
    assert.strictEqual(validatePrice(undefined).valid, false);
  });
});

describe('Soft Delete Filter Behavior', () => {
  const products = [
    { name: 'Active Product A', is_active: true },
    { name: 'Active Product B (implicit)', is_active: undefined },
    { name: 'Soft Deleted Product C', is_active: false }
  ];

  it('$ne: false filter retains active and legacy products while excluding soft-deleted', () => {
    // Simulating MongoDB { is_active: { $ne: false } }
    const filtered = products.filter(p => p.is_active !== false);
    assert.strictEqual(filtered.length, 2);
    assert.strictEqual(filtered.some(p => p.name.includes('Soft Deleted')), false);
  });
});

describe('Password Hash Stripping Security', () => {
  it('user object strips password_hash', () => {
    const rawUser = {
      _id: '507f1f77bcf86cd799439011',
      username: 'admin',
      password_hash: '$2b$10$verysecretpasswordhashthatmustneverleak',
      full_name: 'Ju Kitchen Admin',
      role_id: 1
    };

    const { password_hash: _, ...safeUser } = rawUser;
    assert.strictEqual(safeUser.password_hash, undefined);
    assert.strictEqual(safeUser.username, 'admin');
    assert.strictEqual(safeUser.full_name, 'Ju Kitchen Admin');
  });
});

describe('Sales Idempotency Digest Calculation', () => {
  it('deterministic SHA-256 matches identical payload', () => {
    const sale = {
      transaction_id: 'tx_12345',
      device_id: 'pos_01',
      payment_method: 'cash',
      status: 'completed'
    };

    const body1 = JSON.stringify(sale);
    const digest1 = crypto.createHash('sha256').update(body1).digest('hex');

    const body2 = JSON.stringify(sale);
    const digest2 = crypto.createHash('sha256').update(body2).digest('hex');

    assert.strictEqual(digest1, digest2);
    assert.strictEqual(digest1.length, 64);
  });
});

describe('Order Totals Calculation', () => {
  it('computes subtotal and total centavos accurately', () => {
    const items = [
      { product_id: 'prod1', name: 'Adobo Rice', quantity: 2, unit_price_centavos: 7500 },
      { product_id: 'prod2', name: 'Iced Tea', quantity: 3, unit_price_centavos: 2500 }
    ];
    const deliveryFee = 3500;

    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unit_price_centavos), 0);
    const total = subtotal + deliveryFee;

    assert.strictEqual(subtotal, 15000 + 7500); // 22500
    assert.strictEqual(total, 22500 + 3500);    // 26000
  });
});

describe('Authentication Password Verification', () => {
  it('hashes and compares passwords correctly', async () => {
    const password = 'TestSecretPassword123!';
    const hash = await bcrypt.hash(password, 10);

    const isMatch = await bcrypt.compare(password, hash);
    const isFail = await bcrypt.compare('WrongPassword', hash);

    assert.strictEqual(isMatch, true);
    assert.strictEqual(isFail, false);
  });
});

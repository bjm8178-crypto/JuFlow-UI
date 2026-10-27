import express from 'express';
import { getDb, toObjectId, timestamps, updateTimestamp } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validateCustomer, validId, listOptions } from '../lib/customer.js';
import { customersRepo, ordersRepo } from '../db/repositories/index.js';

const router = express.Router();

// GET /api/customers - List customers (optionally search by name/phone/messenger)
router.get('/', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const { search, limit, skip } = listOptions(req.query);
    const db = getDb();

    let query = { is_active: { $ne: false } };
    if (search) {
      const re = { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      query = { ...query, $or: [{ name: re }, { phone: re }, { messenger: re }] };
    }

    const customers = await customersRepo.find(
      query,
      { sort: { name: 1 }, skip, limit },
      db
    );

    res.json(customers);
  } catch (error) {
    next(error);
  }
});

// GET /api/customers/:id - Get customer by ID
router.get('/:id', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    validId(req.params.id);
    const db = getDb();
    const customer = await customersRepo.findById(req.params.id, db);
    if (!customer) {
      return res.status(404).json({ error: 'not_found', message: 'Customer not found' });
    }
    res.json(customer);
  } catch (error) {
    next(error);
  }
});

// GET /api/customers/:id/orders - Get orders for a customer
router.get('/:id/orders', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    validId(req.params.id);
    const { limit, skip } = listOptions(req.query);
    const db = getDb();
    const orders = await ordersRepo.find(
      { customer_id: req.params.id },
      { sort: { created_at: -1 }, skip, limit },
      db
    );
    res.json(orders);
  } catch (error) {
    next(error);
  }
});

// POST /api/customers - Create customer
router.post('/', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const updates = validateCustomer(req.body);
    const db = getDb();

    const digits = String(updates.phone || '').replace(/\D/g, '');
    if (digits.length >= 7 && req.query.allow_duplicate !== '1') {
      const same = await customersRepo.findDuplicatePhone(digits, db);
      if (same) return res.status(409).json({ error: 'duplicate_customer', message: `This phone number is already saved for ${same.name}.`, customer_id: String(same._id || same.id) });
    }
    const customer = await customersRepo.create(updates, db);
    res.status(201).json(customer);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/customers/:id - Update customer
router.patch('/:id', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    validId(req.params.id);
    const updates = validateCustomer(req.body, true);
    const db = getDb();

    const result = await customersRepo.update(req.params.id, updates, db);
    if (!result) {
      return res.status(404).json({ error: 'not_found', message: 'Customer not found' });
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/customers/:id - Admin only
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    validId(req.params.id);
    const db = getDb();
    const result = await customersRepo.delete(req.params.id, db, req.user.id);
    if (!result) {
      return res.status(404).json({ error: 'not_found', message: 'Customer not found' });
    }
    res.json({ deleted: true, _id: String(result._id || result.id) });
  } catch (error) {
    next(error);
  }
});

router.use((error, req, res, next) => {
  if (error.status === 400) return res.status(400).json({ error: error.code, message: error.message });
  next(error);
});

export default router;

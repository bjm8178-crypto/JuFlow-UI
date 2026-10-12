import express from 'express';
import { getDb, toObjectId } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// ============================================================================
// GET /api/products - List all products
// ============================================================================
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const products = await db.collection('products')
      .find({ is_active: { $ne: false } })
      .sort({ name: 1 })
      .toArray();

    res.json(products);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /api/products/:id - Get product by ID
// ============================================================================
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const product = await db.collection('products').findOne({
      _id: toObjectId(req.params.id)
    });

    if (!product) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Product not found'
      });
    }

    res.json(product);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /api/products - Create new product (admin only)
// ============================================================================
router.post('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    const {
      category_id,
      name,
      description,
      price_centavos,
      is_available,
      photo_path
    } = req.body;

    // Validation
    if (!name || price_centavos === undefined || price_centavos === null) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Name and price are required'
      });
    }

    const parsedPrice = parseInt(price_centavos);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Price must be a non-negative integer (centavos)'
      });
    }

    const product = {
      category_id: category_id || null,
      name: name.trim(),
      description: description?.trim() || null,
      price_centavos: parsedPrice,
      is_available: is_available !== false,
      is_active: true,
      photo_path: photo_path || null,
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('products').insertOne(product);
    product._id = result.insertedId;

    res.status(201).json(product);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PATCH /api/products/:id - Update product (admin only)
// ============================================================================
router.patch('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    const updates = {};

    const allowedFields = [
      'category_id',
      'name',
      'description',
      'price_centavos',
      'is_available',
      'photo_path'
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === 'price_centavos') {
          const price = parseInt(req.body[field]);
          if (isNaN(price) || price < 0) {
            return res.status(400).json({
              error: 'validation_error',
              message: 'Price must be a non-negative integer (centavos)'
            });
          }
          updates[field] = price;
        } else if (field === 'name' && req.body[field]) {
          updates[field] = req.body[field].trim();
        } else {
          updates[field] = req.body[field];
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'No valid fields to update'
      });
    }

    updates.updated_at = new Date();

    const result = await db.collection('products').findOneAndUpdate(
      { _id: toObjectId(req.params.id) },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Product not found'
      });
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// DELETE /api/products/:id - Soft delete product (admin only)
// ============================================================================
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    
    const result = await db.collection('products').findOneAndUpdate(
      { _id: toObjectId(req.params.id) },
      { 
        $set: { 
          is_active: false,
          updated_at: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Product not found'
      });
    }

    res.json({ message: 'Product deactivated', product: result });
  } catch (error) {
    next(error);
  }
});

export default router;

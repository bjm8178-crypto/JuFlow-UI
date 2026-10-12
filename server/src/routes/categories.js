import express from 'express';
import { getDb, toObjectId, timestamps, updateTimestamp } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/categories - List all categories
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const categories = await db.collection('categories')
      .find({})
      .sort({ name: 1 })
      .toArray();
    res.json(categories);
  } catch (error) {
    next(error);
  }
});

// GET /api/categories/:id - Get category by ID
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const category = await db.collection('categories').findOne({
      _id: toObjectId(req.params.id)
    });
    if (!category) {
      return res.status(404).json({ error: 'not_found', message: 'Category not found' });
    }
    res.json(category);
  } catch (error) {
    next(error);
  }
});

// POST /api/categories - Create category (admin only)
router.post('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'validation_error', message: 'Category name is required' });
    }

    const db = getDb();
    const existing = await db.collection('categories').findOne({ name: name.trim() });
    if (existing) {
      return res.status(409).json({ error: 'name_exists', message: 'A category with this name already exists' });
    }

    const result = await db.collection('categories').insertOne({
      name: name.trim(),
      description: description?.trim() || null,
      ...timestamps()
    });

    const category = await db.collection('categories').findOne({ _id: result.insertedId });
    res.status(201).json(category);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/categories/:id - Update category (admin only)
router.patch('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no_updates', message: 'No fields to update' });
    }

    const db = getDb();
    const result = await db.collection('categories').findOneAndUpdate(
      { _id: toObjectId(req.params.id) },
      { $set: { ...updates, ...updateTimestamp() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: 'not_found', message: 'Category not found' });
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/categories/:id - Delete category (admin only)
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const db = getDb();

    // Check if any products use this category
    const productCount = await db.collection('products').countDocuments({
      category_id: toObjectId(req.params.id)
    });
    if (productCount > 0) {
      return res.status(409).json({
        error: 'category_in_use',
        message: `Cannot delete: ${productCount} product(s) use this category`
      });
    }

    const result = await db.collection('categories').deleteOne({
      _id: toObjectId(req.params.id)
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'not_found', message: 'Category not found' });
    }
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;

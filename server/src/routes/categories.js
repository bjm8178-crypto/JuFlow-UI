import express from 'express';
import { getDb, toObjectId, timestamps, updateTimestamp, withTransaction } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export function createCategoriesRouter({ database = getDb, transaction = withTransaction, auth = authenticate, admin = requireRole('admin') } = {}) {
  const router = express.Router();
  router.get('/', auth, async (req, res, next) => {
    try { res.json(await database().collection('categories').find({}).sort({ name: 1 }).toArray()); }
    catch (error) { next(error); }
  });
  router.get('/:id', auth, async (req, res, next) => {
    try {
      const id = toObjectId(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalid_id' });
      const category = await database().collection('categories').findOne({ _id: id });
      if (!category) return res.status(404).json({ error: 'not_found' });
      res.json(category);
    } catch (error) { next(error); }
  });
  for (const method of ['post', 'patch', 'delete']) router[method](method === 'post' ? '/' : '/:id', auth, admin, async (req, res, next) => {
    try {
      const id = method === 'post' ? null : toObjectId(req.params.id);
      if (method !== 'post' && !id) return res.status(400).json({ error: 'invalid_id' });
      const updates = {};
      if (method !== 'delete') {
        if (req.body.name !== undefined || method === 'post') {
          if (typeof req.body.name !== 'string' || !req.body.name.trim()) return res.status(400).json({ error: 'validation_error', message: 'Category name required' });
          updates.name = req.body.name.trim();
        }
        if (req.body.description !== undefined) {
          if (req.body.description !== null && typeof req.body.description !== 'string') return res.status(400).json({ error: 'validation_error' });
          updates.description = req.body.description?.trim() || null;
        }
        if (!Object.keys(updates).length) return res.status(400).json({ error: 'no_updates' });
      }
      const result = await transaction(async (db, session) => {
        if (method === 'post') {
          const doc = { description: null, ...updates, ...timestamps() };
          const inserted = await db.collection('categories').insertOne(doc, { session });
          return { ...doc, _id: inserted.insertedId };
        }
        // Product writes acquire this same document before changing a reference.
        const category = await db.collection('categories').findOneAndUpdate({ _id: id }, { $inc: { integrity_revision: 1 } }, { session, returnDocument: 'after' });
        if (!category) throw Object.assign(new Error('Category not found'), { status: 404, code: 'not_found' });
        if (method === 'delete') {
          const count = await db.collection('products').countDocuments({ category_id: { $in: [id, String(id)] } }, { session });
          if (count) throw Object.assign(new Error('Products use this category'), { status: 409, code: 'category_in_use' });
          await db.collection('categories').deleteOne({ _id: id }, { session });
          return { message: 'Category deleted successfully' };
        }
        return db.collection('categories').findOneAndUpdate({ _id: id }, { $set: { ...updates, ...updateTimestamp() } }, { session, returnDocument: 'after' });
      });
      res.status(method === 'post' ? 201 : 200).json(result);
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: 'name_exists', message: 'Category name already exists' });
      if (error.status) return res.status(error.status).json({ error: error.code, message: error.message });
      next(error);
    }
  });
  return router;
}

export default createCategoriesRouter();

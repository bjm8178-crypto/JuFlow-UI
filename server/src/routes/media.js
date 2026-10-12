import express from 'express';
import { pipeline } from 'node:stream/promises';
import { authenticate, requireRole } from '../middleware/auth.js';
import { shape, validId } from '../lib/customer.js';
import { authorizedMedia, decodeLandmark, replaceLandmark } from '../services/media.js';

export const mediaRoutes = express.Router();
export const customerLandmarkRouter = express.Router({ mergeParams: true });

mediaRoutes.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { file, stream } = await authorizedMedia(req.params.id, req.user);
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'image/jpeg', 'Content-Length': String(file.length) });
    await pipeline(stream, res);
  } catch (error) {
    if (res.headersSent || res.destroyed) return res.destroy();
    next(error);
  }
});

customerLandmarkRouter.post('/', authenticate, requireRole('admin', 'cashier'), express.json({ limit: '1mb' }), async (req, res, next) => {
  try {
    validId(req.params.customerId);
    const image = await decodeLandmark(req.body);
    const result = await replaceLandmark(req.params.customerId, req.user, image);
    res.status(201).json(result);
  } catch (error) { next(error); }
});

customerLandmarkRouter.delete('/', authenticate, requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    validId(req.params.customerId);
    if (req.body !== undefined) shape(req.body, []);
    res.json(await replaceLandmark(req.params.customerId, req.user, null));
  } catch (error) { next(error); }
});

function errors(error, req, res, next) {
  if (error.status === 400 || error.status === 403 || error.status === 404 || error.status === 409 || error.status === 413 || error.status === 503) {
    return res.status(error.status).json({ error: error.code || 'validation_error', message: error.message });
  }
  next(error);
}
mediaRoutes.use(errors);
customerLandmarkRouter.use(errors);

export default mediaRoutes;

import { ObjectId } from 'mongodb';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import * as mongodb from '../db/mongodb.js';
import { shape, validId, invalid } from '../lib/customer.js';
import { getPool } from '../db/postgres.js';

export const MEDIA_BUCKET = 'landmark_media';
export const MAX_IMAGE_CHARS = 600000;
const MAX_INPUT_PIXELS = 16000000;
const formats = { jpeg: 'jpeg', png: 'png', webp: 'webp' };

function fail(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}

export function mediaIdFromUrl(value) {
  const match = typeof value === 'string' && /^\/api\/media\/([a-f\d]{24}|[a-zA-Z0-9_-]{12,64})$/i.exec(value);
  return match ? match[1] : null;
}

export function parseImageBody(body) {
  shape(body, ['image']);
  if (typeof body.image !== 'string' || body.image.length > MAX_IMAGE_CHARS) invalid('image must be a data URL of at most 600000 characters');
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.image);
  if (!match || match[2].length % 4 !== 0) invalid('Expected a JPEG, PNG or WebP base64 data URL');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.toString('base64') !== match[2]) invalid('Invalid base64 image');
  return { bytes, format: formats[match[1]] };
}

export async function decodeLandmark(body) {
  const { bytes, format } = parseImageBody(body);
  const { default: sharp } = await import('sharp');
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS, animated: false });
    const metadata = await image.metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height || (metadata.pages || 1) !== 1 || metadata.width * metadata.height > MAX_INPUT_PIXELS) invalid('Invalid image type or dimensions');
    const { data, info } = await image.rotate().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 75, progressive: true }).toBuffer({ resolveWithObject: true });
    if (data.length > 450000 || info.width > 1000 || info.height > 1000) invalid('Image is too detailed; choose a smaller image');
    return { bytes: data, width: info.width, height: info.height, contentType: 'image/jpeg' };
  } catch (error) {
    if (error.status === 400) throw error;
    invalid('Image cannot be safely decoded');
  }
}

function actorId(user) {
  if (!['admin', 'cashier'].includes(user?.role_name)) fail(403, 'forbidden', 'Only admin or cashier may change landmark media');
  return String(validId(user.id));
}

async function cleanup(db, id) {
  if (!id) return false;
  try {
    const referenced = await db.collection('customers').findOne({ landmark_photo: `/api/media/${id}` }, { projection: { _id: 1 } });
    if (referenced) return false;
    await db.collection('media_files').deleteOne({ id: String(id) });
    return false;
  } catch (error) {
    console.warn('Landmark media cleanup deferred', { media_id: String(id), code: error.code || 'cleanup_failed' });
    return true;
  }
}

export async function replaceLandmark(customerId, user, image, options = {}) {
  const customer_id = String(validId(customerId));
  const uploaded_by = actorId(user);
  const db = options.db || mongodb.getDb();
  const transact = options.transact || mongodb.withTransaction;
  if (typeof transact !== 'function') fail(503, 'transactions_required', 'Transactional media replacement is unavailable');

  const customer = await db.collection('customers').findOne({ _id: customer_id });
  if (!customer) fail(404, 'customer_not_found', 'Customer not found');

  let newId = null;
  if (image) {
    newId = crypto.randomBytes(12).toString('hex');
    const meta = { customer_id, uploaded_by, content_type: 'image/jpeg', width: image.width, height: image.height, state: 'pending' };
    const pool = options.client || (db.client ? db.client : getPool());
    try {
      await pool.query(`
        INSERT INTO media_files (id, filename, content_type, size, bytes, metadata, data, created_at, updated_at)
        VALUES ($1, 'landmark.jpg', 'image/jpeg', $2, $3, $4::jsonb, $4::jsonb, NOW(), NOW())
      `, [newId, image.bytes.length, image.bytes, JSON.stringify(meta)]);
    } catch (error) {
      await cleanup(db, newId);
      throw error;
    }
  }

  const landmark_photo = newId ? `/api/media/${newId}` : null;
  let previous;
  try {
    await transact(async (transactionDb, session) => {
      previous = await transactionDb.collection('customers').findOneAndUpdate(
        { _id: customer_id }, { $set: { landmark_photo, updated_at: new Date() } }, { session, returnDocument: 'before' }
      );
      if (!previous) fail(404, 'customer_not_found', 'Customer not found');
      if (newId) {
        const pool = transactionDb.client || getPool();
        const res = await pool.query(`
          UPDATE media_files
          SET metadata = jsonb_set(metadata, '{state}', '"ready"'),
              updated_at = NOW()
          WHERE id = $1 AND metadata->>'customer_id' = $2 AND metadata->>'state' = 'pending'
        `, [newId, customer_id]);
        if (res.rowCount !== 1) fail(409, 'media_conflict', 'Media upload is no longer available');
      }
    });
  } catch (error) {
    if (newId) await cleanup(db, newId);
    throw error;
  }
  const cleanup_pending = await cleanup(db, mediaIdFromUrl(previous.landmark_photo));
  return { landmark_photo, cleanup_pending };
}

export async function authorizedMedia(id, user, options = {}) {
  const mediaId = String(validId(id));
  const db = options.db || mongodb.getDb();
  if (!['admin', 'cashier', 'rider'].includes(user?.role_name)) fail(403, 'forbidden', 'Media access denied');

  const pool = options.client || (db.client ? db.client : getPool());
  const fileRes = await pool.query(`
    SELECT id, filename, content_type, size, bytes, metadata
    FROM media_files
    WHERE id = $1 AND metadata->>'state' = 'ready'
  `, [mediaId]);
  const row = fileRes.rows[0];
  if (!row || !row.metadata?.customer_id || row.metadata.content_type !== 'image/jpeg') {
    fail(404, 'media_not_found', 'Media not found');
  }

  const customerId = String(row.metadata.customer_id);

  if (user.role_name === 'rider') {
    const rider = await db.collection('riders').findOne({ user_id: validId(user.id), is_active: { $ne: false } });
    if (!rider) fail(403, 'forbidden', 'Media access denied');
    const riderId = String(rider.id || rider._id);

    // Bug 3 fix: Rewrite rider media-access check as a real SQL join
    const assignedRes = await pool.query(`
      SELECT d.id
      FROM deliveries d
      JOIN orders o ON (d.order_id = o.id OR d.order_id = o.order_number)
      WHERE d.rider_id = $1
        AND d.status NOT IN ('completed', 'cancelled')
        AND (o.customer_id = $2 OR o.customer->>'id' = $2)
      LIMIT 1
    `, [riderId, customerId]);

    if (!assignedRes.rows.length) {
      fail(403, 'forbidden', 'Media access denied');
    }
  }

  const current = await db.collection('customers').findOne({ _id: customerId, landmark_photo: `/api/media/${mediaId}` }, { projection: { _id: 1 } });
  if (!current) fail(404, 'media_not_found', 'Media not found');

  const file = {
    _id: row.id,
    id: row.id,
    length: row.bytes ? row.bytes.length : Number(row.size || 0),
    metadata: row.metadata
  };
  const stream = Readable.from([row.bytes]);
  return { file, stream };
}

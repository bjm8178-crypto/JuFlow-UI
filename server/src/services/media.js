import { GridFSBucket, ObjectId } from 'mongodb';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import * as mongodb from '../db/mongodb.js';
import { shape, validId, invalid } from '../lib/customer.js';

export const MEDIA_BUCKET = 'landmark_media';
export const MAX_IMAGE_CHARS = 600000;
const MAX_INPUT_PIXELS = 16000000;
const formats = { jpeg: 'jpeg', png: 'png', webp: 'webp' };

function fail(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}

export function mediaIdFromUrl(value) {
  const match = typeof value === 'string' && /^\/api\/media\/([a-f\d]{24})$/i.exec(value);
  return match ? new ObjectId(match[1]) : null;
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
  // Decode, enforce pixel limits, and re-encode without retaining EXIF/XMP/ICC.
  // A matching MIME header alone is not sufficient evidence of a valid image.
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
  return new ObjectId(validId(user.id));
}

async function cleanup(db, bucket, id) {
  if (!id) return false;
  try {
    // Never remove bytes while any committed customer still references them,
    // including an uncertain commit result after a transient network error.
    const referenced = await db.collection('customers').findOne({ landmark_photo: `/api/media/${id}` }, { projection: { _id: 1 } });
    if (referenced) return false;
    await bucket.delete(id);
    return false;
  } catch (error) {
    console.warn('Landmark media cleanup deferred', { media_id: id.toString(), code: error.code || 'cleanup_failed' });
    return true;
  }
}

export async function replaceLandmark(customerId, user, image, options = {}) {
  const customer_id = new ObjectId(validId(customerId));
  const uploaded_by = actorId(user);
  const db = options.db || mongodb.getDb();
  const transact = options.transact || mongodb.withTransaction;
  if (typeof transact !== 'function') fail(503, 'transactions_required', 'Transactional media replacement is unavailable');
  const bucket = options.bucket || new GridFSBucket(db, { bucketName: MEDIA_BUCKET });
  const customer = await db.collection('customers').findOne({ _id: customer_id });
  if (!customer) fail(404, 'customer_not_found', 'Customer not found');
  let newId = null;
  if (image) {
    const upload = bucket.openUploadStream('landmark.jpg', {
      metadata: { customer_id, uploaded_by, content_type: 'image/jpeg', width: image.width, height: image.height, state: 'pending' }
    });
    newId = upload.id;
    try {
      await pipeline(Readable.from([image.bytes]), upload);
    } catch (error) {
      await cleanup(db, bucket, newId);
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
        const ready = await transactionDb.collection(`${MEDIA_BUCKET}.files`).updateOne(
          { _id: newId, 'metadata.customer_id': customer_id, 'metadata.state': 'pending' },
          { $set: { 'metadata.state': 'ready' } }, { session }
        );
        if (ready.matchedCount !== 1) fail(409, 'media_conflict', 'Media upload is no longer available');
      }
    });
  } catch (error) {
    await cleanup(db, bucket, newId);
    throw error;
  }
  const cleanup_pending = await cleanup(db, bucket, mediaIdFromUrl(previous.landmark_photo));
  return { landmark_photo, cleanup_pending };
}

export async function authorizedMedia(id, user, options = {}) {
  const _id = new ObjectId(validId(id));
  const db = options.db || mongodb.getDb();
  if (!['admin', 'cashier', 'rider'].includes(user?.role_name)) fail(403, 'forbidden', 'Media access denied');
  const file = await db.collection(`${MEDIA_BUCKET}.files`).findOne({ _id, 'metadata.state': 'ready' });
  if (!file?.metadata?.customer_id || file.metadata.content_type !== 'image/jpeg') fail(404, 'media_not_found', 'Media not found');
  if (user.role_name === 'rider') {
    const rider = await db.collection('riders').findOne({ user_id: new ObjectId(validId(user.id)), is_active: { $ne: false } });
    if (!rider) fail(403, 'forbidden', 'Media access denied');
    const assigned = await db.collection('deliveries').aggregate([
      { $match: { rider_id: rider._id, status: { $nin: ['completed', 'cancelled'] } } },
      { $lookup: { from: 'orders', localField: 'order_id', foreignField: '_id', as: 'order' } },
      { $match: { 'order.customer_id': file.metadata.customer_id } },
      { $limit: 1 }, { $project: { _id: 1 } }
    ]).toArray();
    if (!assigned.length) fail(403, 'forbidden', 'Media access denied');
  }
  const current = await db.collection('customers').findOne({ _id: file.metadata.customer_id, landmark_photo: `/api/media/${_id}` }, { projection: { _id: 1 } });
  if (!current) fail(404, 'media_not_found', 'Media not found');
  const bucket = options.bucket || new GridFSBucket(db, { bucketName: MEDIA_BUCKET });
  return { file, stream: bucket.openDownloadStream(_id) };
}

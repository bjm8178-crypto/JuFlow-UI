import crypto from 'node:crypto';
import { getPool } from '../db/postgres.js';
import { objectIdString, orderError } from '../lib/order.js';
import { ordersRepo } from '../db/repositories/index.js';
import { decodeLandmark } from './media.js';

// Proof-of-delivery photos live in the same media_files table as landmark photos.
// metadata.kind = 'delivery_proof' keeps them apart; metadata.order_id links them to the order.
export const PROOF_KIND = 'delivery_proof';
export const MAX_PROOFS_PER_ORDER = 5;
const PROOF_STATUSES = ['on_the_way', 'delivered'];

async function loadOrder(orderId) {
  const id = objectIdString(orderId, 'id');
  const order = await ordersRepo.findById(id);
  if (!order) throw orderError('Order not found', 404, 'not_found');
  return { id, order };
}

export async function listProofs(orderId, options = {}) {
  const { id } = await loadOrder(orderId);
  const pool = options.pool || getPool();
  const res = await pool.query(`
    SELECT id, metadata, created_at
    FROM media_files
    WHERE metadata->>'kind' = $1 AND metadata->>'order_id' = $2 AND metadata->>'state' = 'ready'
    ORDER BY created_at DESC
    LIMIT 20
  `, [PROOF_KIND, id]);
  return res.rows.map(row => ({
    id: row.id,
    url: `/api/media/${row.id}`,
    uploaded_at: row.created_at,
    uploaded_role: row.metadata?.uploaded_role || null
  }));
}

export async function saveProof(orderId, user, body, options = {}) {
  if (!['admin', 'cashier', 'rider'].includes(user?.role_name)) throw orderError('Role is not authorized', 403, 'forbidden');
  const { id, order } = await loadOrder(orderId);
  if (!PROOF_STATUSES.includes(order.status)) {
    throw orderError('Proof of delivery can be sent once the order is On the way or Delivered', 409, 'conflict');
  }
  const pool = options.pool || getPool();
  const existing = await pool.query(`
    SELECT COUNT(*)::int AS n FROM media_files
    WHERE metadata->>'kind' = $1 AND metadata->>'order_id' = $2
  `, [PROOF_KIND, id]);
  if ((existing.rows[0]?.n || 0) >= MAX_PROOFS_PER_ORDER) {
    throw orderError(`An order can have at most ${MAX_PROOFS_PER_ORDER} proof photos`, 409, 'conflict');
  }

  // Same safe pipeline as landmark photos: type check, decode, rotate, resize, re-encode as JPEG.
  const image = await decodeLandmark(body);
  const mediaId = crypto.randomBytes(12).toString('hex');
  const metadata = {
    kind: PROOF_KIND,
    order_id: id,
    uploaded_by: String(user.id),
    uploaded_role: user.role_name,
    content_type: 'image/jpeg',
    width: image.width,
    height: image.height,
    state: 'ready'
  };
  await pool.query(`
    INSERT INTO media_files (id, filename, content_type, size, bytes, metadata, data, created_at, updated_at)
    VALUES ($1, 'proof.jpg', 'image/jpeg', $2, $3, $4::jsonb, $4::jsonb, NOW(), NOW())
  `, [mediaId, image.bytes.length, image.bytes, JSON.stringify(metadata)]);
  return { id: mediaId, url: `/api/media/${mediaId}`, uploaded_at: new Date().toISOString(), uploaded_role: user.role_name };
}

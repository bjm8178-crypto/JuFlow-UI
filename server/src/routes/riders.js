import express from 'express';
import { getDb, toObjectId, timestamps, updateTimestamp, withTransaction } from '../db/mongodb.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { lockAccountIntegrity } from './users.js';

export const RIDER_PROFILE_FIELDS = ['_id', 'full_name', 'phone', 'vehicle_type', 'plate_no', 'is_available', 'is_active', 'last_location', 'created_at', 'updated_at'];
export function riderProfile(rider) {
  return Object.fromEntries(RIDER_PROFILE_FIELDS.filter(key => rider[key] !== undefined).map(key => [key, rider[key]]));
}

export function validatedLocation(body, now = new Date()) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400, code: 'validation_error' }); };
  if (typeof body.lat !== 'number' || !Number.isFinite(body.lat) || Math.abs(body.lat) > 90) fail('lat must be finite and between -90 and 90');
  if (typeof body.lng !== 'number' || !Number.isFinite(body.lng) || Math.abs(body.lng) > 180) fail('lng must be finite and between -180 and 180');
  if (typeof body.accuracy !== 'number' || !Number.isFinite(body.accuracy) || body.accuracy < 0 || body.accuracy > 10000) fail('accuracy must be between 0 and 10000 meters');
  if (typeof body.occurred_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(body.occurred_at)) fail('occurred_at must be an ISO timestamp with timezone');
  const occurred = new Date(body.occurred_at);
  if (!Number.isFinite(occurred.getTime()) || occurred.getTime() > now.getTime() + 60000 || occurred.getTime() < now.getTime() - 86400000) fail('occurred_at must be within the last day and not in the future');
  // Date.parse rolls invalid dates (e.g. February 30) forward; reject that too.
  const datePart = body.occurred_at.slice(0, 10);
  const [year, month, day] = datePart.split('-').map(Number);
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== datePart) fail('Invalid calendar date');
  return { lat: body.lat, lng: body.lng, accuracy: body.accuracy, occurred_at: occurred, received_at: now };
}

export async function validateRiderLink(db, session, userId, riderId = null) {
  if (!userId) throw Object.assign(new Error('Invalid user_id'), { status: 400, code: 'validation_error' });
  await lockAccountIntegrity(db, session);
  const user = await db.collection('users').findOne({ _id: userId, is_active: true }, { session });
  const role = user && await db.collection('roles').findOne({ _id: user.role_id }, { session });
  if (!user || role?.name !== 'rider') throw Object.assign(new Error('Linked user must be an active rider account'), { status: 400, code: 'invalid_rider_user' });
  const filter = { user_id: userId };
  if (riderId) filter._id = { $ne: riderId };
  if (await db.collection('riders').findOne(filter, { session })) throw Object.assign(new Error('User is already linked to a rider'), { status: 409, code: 'rider_user_in_use' });
}

export function createRidersRouter({ database = getDb, transaction = withTransaction, auth = authenticate } = {}) {
  const router = express.Router();
  const ownRider = async (db, userId, session) => {
    const rider = await db.collection('riders').findOne({ user_id: toObjectId(userId), is_active: true }, { session });
    if (!rider) throw Object.assign(new Error('No active rider profile associated with this account'), { status: 404, code: 'rider_profile_not_found' });
    return rider;
  };
  const failure = (error, res) => {
    if (error.code === 11000) return res.status(409).json({ error: 'rider_user_in_use', message: 'Rider user link already exists' });
    res.status(error.status || 500).json({ error: error.status ? error.code : 'request_failed', message: error.status ? error.message : 'Rider request failed' });
  };
  router.get('/me', auth, requireRole('rider'), async (req, res) => {
    try { res.json(riderProfile(await ownRider(database(), req.user.id))); }
    catch (error) { failure(error, res); }
  });
  router.post('/me/location', auth, requireRole('rider'), async (req, res) => {
    try {
      const location = validatedLocation(req.body);
      const result = await transaction(async (db, session) => {
        const rider = await ownRider(db, req.user.id, session);
        if (rider.last_location?.occurred_at && new Date(rider.last_location.occurred_at) > location.occurred_at) {
          throw Object.assign(new Error('Location is older than the latest observation'), { status: 409, code: 'stale_location' });
        }
        await db.collection('rider_locations').insertOne({ ...location, rider_id: rider._id, user_id: toObjectId(req.user.id) }, { session });
        await db.collection('riders').updateOne({ _id: rider._id }, { $set: { last_location: location, ...updateTimestamp() } }, { session });
        return location;
      });
      res.status(201).json(result);
    } catch (error) { failure(error, res); }
  });
  router.get('/', auth, requireRole('admin', 'cashier', 'rider'), async (req, res) => {
    try {
      const db = database();
      if (req.user.role_name === 'rider') return res.json([riderProfile(await ownRider(db, req.user.id))]);
      const riders = await db.collection('riders').find({}).sort({ full_name: 1 }).toArray();
      res.json(req.user.role_name === 'admin' ? riders : riders.map(riderProfile));
    } catch (error) { failure(error, res); }
  });
  router.get('/:id', auth, requireRole('admin', 'cashier', 'rider'), async (req, res) => {
    try {
      const id = toObjectId(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalid_id' });
      const filter = { _id: id };
      if (req.user.role_name === 'rider') filter.user_id = toObjectId(req.user.id);
      const rider = await database().collection('riders').findOne(filter);
      if (!rider) return res.status(404).json({ error: 'rider_not_found' });
      res.json(req.user.role_name === 'admin' ? rider : riderProfile(rider));
    } catch (error) { failure(error, res); }
  });
  router.post('/', auth, requireRole('admin'), (req, res) => {
    res.status(409).json({ error: 'single_rider', message: 'The single rider is managed through bootstrap' });
  });
  for (const method of ['post', 'patch', 'delete']) router[method](method === 'post' ? '/' : '/:id', auth, requireRole('admin'), async (req, res) => {
    try {
      const id = method === 'post' ? null : toObjectId(req.params.id);
      if (method !== 'post' && !id) return res.status(400).json({ error: 'invalid_id' });
      const values = {};
      if (method === 'delete') { values.is_active = false; values.is_available = false; }
      else {
        for (const key of ['full_name', 'phone', 'vehicle_type', 'plate_no', 'notes', 'is_available', 'is_active']) {
          if (req.body[key] === undefined) continue;
          const value = req.body[key];
          if (key === 'is_available' || key === 'is_active') {
            if (typeof value !== 'boolean') return res.status(400).json({ error: 'validation_error', message: `${key} must be a boolean` });
            values[key] = value;
          } else {
            if (value !== null && typeof value !== 'string') return res.status(400).json({ error: 'validation_error', message: `${key} must be text` });
            values[key] = value?.trim() || null;
            if ((key === 'full_name' || key === 'phone') && !values[key]) return res.status(400).json({ error: 'validation_error', message: `${key} required` });
          }
        }
        if (method === 'post' && (!values.full_name || !values.phone)) return res.status(400).json({ error: 'missing_fields' });
        if (method === 'patch' && !Object.keys(values).length && req.body.user_id === undefined) return res.status(400).json({ error: 'no_updates' });
      }
      const rider = await transaction(async (db, session) => {
        // Serialize link writes/unlinks with account role/deactivation changes.
        await lockAccountIntegrity(db, session);
        const existing = id && await db.collection('riders').findOne({ _id: id }, { session });
        if (id && !existing) throw Object.assign(new Error('Rider not found'), { status: 404, code: 'rider_not_found' });
        const unsets = {};
        if (method !== 'delete' && req.body.user_id !== undefined) {
          if (req.body.user_id === null || req.body.user_id === '') unsets.user_id = '';
          else {
            const userId = toObjectId(req.body.user_id);
            await validateRiderLink(db, session, userId, id);
            values.user_id = userId;
          }
        } else if (existing?.user_id) await validateRiderLink(db, session, existing.user_id, id);
        if (method === 'post') {
          const doc = { vehicle_type: null, plate_no: null, notes: null, is_active: true, is_available: true, ...values, ...timestamps() };
          const result = await db.collection('riders').insertOne(doc, { session });
          return { ...doc, _id: result.insertedId };
        }
        const ops = { $set: { ...values, ...updateTimestamp() } };
        if (Object.keys(unsets).length) ops.$unset = unsets;
        return db.collection('riders').findOneAndUpdate({ _id: id }, ops, { session, returnDocument: 'after' });
      });
      res.status(method === 'post' ? 201 : 200).json(method === 'delete' ? { message: 'Rider deactivated', rider } : rider);
    } catch (error) { failure(error, res); }
  });
  return router;
}

export default createRidersRouter();

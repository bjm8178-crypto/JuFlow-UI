export function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'validation_error';
  throw error;
}

export function plainObject(value) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('Expected a plain object');
}

export function shape(value, keys) {
  plainObject(value);
  if (Object.keys(value).some(key => !keys.includes(key))) invalid('Unknown field');
}

export function text(value, key, max, optional = false) {
  if (optional && value === null) return null;
  if (typeof value !== 'string' || value.length > max) invalid(`${key} must be a string of at most ${max} characters`);
  const trimmed = value.trim();
  if (!trimmed && !optional) invalid(`${key} is required`);
  return trimmed || null;
}

export function validId(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) invalid('Invalid ID');
  return value;
}

export function coordinate(value, key, max) {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > max)) invalid(`Invalid ${key}`);
  return value;
}

export function validateCustomer(body, partial = false) {
  shape(body, ['name', 'phone', 'messenger', 'address', 'landmark', 'landmark_photo', 'lat', 'lng', 'is_active']);
  const updates = {};
  for (const [key, max, optional] of [['name', 200, false], ['phone', 40, false], ['address', 1000, false], ['messenger', 200, true], ['landmark', 500, true]]) {
    if (Object.hasOwn(body, key)) updates[key] = text(body[key], key, max, optional);
    else if (!partial) updates[key] = optional ? null : text(undefined, key, max);
  }
  if (Object.hasOwn(body, 'landmark_photo')) {
    if (body.landmark_photo !== null && body.landmark_photo !== '') invalid('landmark_photo is reserved for authenticated media');
    updates.landmark_photo = null;
  } else if (!partial) updates.landmark_photo = null;
  const hasLat = Object.hasOwn(body, 'lat'), hasLng = Object.hasOwn(body, 'lng');
  if (hasLat !== hasLng) invalid('lat and lng must be provided together');
  if (hasLat) {
    updates.lat = coordinate(body.lat, 'latitude', 90);
    updates.lng = coordinate(body.lng, 'longitude', 180);
    if ((updates.lat === null) !== (updates.lng === null)) invalid('Coordinates must both be null or both numbers');
  } else if (!partial) Object.assign(updates, { lat: null, lng: null });
  if (Object.hasOwn(body, 'is_active')) {
    if (typeof body.is_active !== 'boolean') invalid('is_active must be a boolean');
    updates.is_active = body.is_active;
  } else if (!partial) updates.is_active = true;
  if (!Object.keys(updates).length) invalid('No fields to update');
  return updates;
}

export function listOptions(query) {
  plainObject(query);
  const number = (key, fallback, max) => {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== 'string' || !/^\d{1,7}$/.test(query[key])) invalid(`Invalid ${key}`);
    const value = Number(query[key]);
    if (value < (key === 'limit' || key === 'page' ? 1 : 0) || value > max) invalid(`Invalid ${key}`);
    return value;
  };
  const limit = number('limit', 100, 200);
  const page = number('page', 1, 10001);
  const skip = number('offset', (page - 1) * limit, 1000000);
  if (skip > 1000000) invalid('Pagination offset too large');
  const search = query.search === undefined ? null : text(query.search, 'search', 200, true);
  return { limit, skip, search: search?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || null };
}

export function validateZone(body, partial = false) {
  shape(body, ['name', 'fee_centavos', 'min_order_centavos', 'estimated_minutes', 'sort_order', 'is_active']);
  const updates = {};
  if (!partial || Object.hasOwn(body, 'name')) updates.name = text(body.name, 'name', 200);
  for (const [key, fallback] of [['fee_centavos', undefined], ['min_order_centavos', 0], ['estimated_minutes', 30], ['sort_order', 999]]) {
    if (!partial || Object.hasOwn(body, key)) {
      const value = Object.hasOwn(body, key) ? body[key] : fallback;
      if (!Number.isSafeInteger(value) || value < 0) invalid(`${key} must be a nonnegative safe integer`);
      updates[key] = value;
    }
  }
  if (!partial || Object.hasOwn(body, 'is_active')) {
    const value = Object.hasOwn(body, 'is_active') ? body.is_active : true;
    if (typeof value !== 'boolean') invalid('is_active must be a boolean');
    updates.is_active = value;
  }
  if (!Object.keys(updates).length) invalid('No fields to update');
  return updates;
}

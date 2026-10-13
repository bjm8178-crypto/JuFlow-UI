import { shape, text, coordinate, invalid } from './customer.js';

const strings = { shop_name: 200, shop_phone: 40, business_name: 200, business_phone: 40, business_address: 1000 };
const coordinates = { shop_lat: 90, shop_lng: 180, shop_latitude: 90, shop_longitude: 180 };
const keys = [...Object.keys(strings), ...Object.keys(coordinates), 'payment_methods', 'business_timezone', 'timezone', 'tax_rate', 'currency', 'require_gcash_proof'];

export function validateSettingKey(key) {
  if (!keys.includes(key)) invalid('Unsupported setting key');
  return key;
}

export function validateSetting(key, body) {
  validateSettingKey(key);
  shape(body, ['value', 'description', 'group_name']);
  if (!Object.hasOwn(body, 'value')) invalid('Value is required');
  let value = body.value;
  if (Object.hasOwn(strings, key)) value = text(value, key, strings[key]);
  else if (Object.hasOwn(coordinates, key)) value = coordinate(value, key, coordinates[key]);
  else if (key === 'business_timezone' || key === 'timezone') {
    value = text(value, key, 64);
    if (value !== 'Asia/Manila') invalid('Timezone must be Asia/Manila');
  } else if (key === 'payment_methods') {
    if (!Array.isArray(value) || !value.length || value.length > 3) invalid('payment_methods must be a bounded nonempty array');
    value = value.map(method => text(method, 'payment method', 40));
    if (value.some(method => !['cash', 'exact', 'gcash'].includes(method))) invalid('Unsupported payment method');
    if (new Set(value).size !== value.length) invalid('Duplicate payment methods');
  } else if (key === 'tax_rate') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) invalid('Invalid tax rate');
  } else if (key === 'currency') {
    if (value !== 'PHP') invalid('Currency must be PHP');
  } else if (typeof value !== 'boolean') invalid(`${key} must be a boolean`);
  const updates = { value };
  if (Object.hasOwn(body, 'description')) updates.description = text(body.description, 'description', 500, true);
  if (Object.hasOwn(body, 'group_name')) updates.group_name = text(body.group_name, 'group_name', 64);
  return updates;
}

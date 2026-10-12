import crypto from 'crypto';

const METHODS = ['cash', 'exact', 'gcash'];

/**
 * Validates and normalises a sale payload. Pure function (no DB) so it can be unit-tested.
 * Returns { sale, digest } or throws Error with .status = 400.
 */
export function validateSale(body) {
  const fail = (message) => { const e = new Error(message); e.status = 400; e.code = 'validation_error'; throw e; };
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('JSON object required');

  const { transaction_id, items, total_centavos, payment_method, cash_tendered_centavos, gcash_reference, is_test_sale } = body;

  if (transaction_id !== undefined && transaction_id !== null &&
      (typeof transaction_id !== 'string' || !transaction_id.trim() || transaction_id.length > 120)) fail('Invalid transaction_id');
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) fail('Provide 1 to 100 items');

  const clean = items.map((i) => {
    if (!i || typeof i !== 'object') fail('Invalid item');
    const name = typeof i.name === 'string' ? i.name.trim() : '';
    if (!name || name.length > 120) fail('Each item needs a name');
    const quantity = i.quantity, price = i.price_centavos;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) fail('Invalid item quantity');
    if (!Number.isInteger(price) || price < 1 || price > 10_000_000) fail('Invalid item price');
    return { name, quantity, price_centavos: price };
  });

  const computed = clean.reduce((s, i) => s + i.quantity * i.price_centavos, 0);
  if (!Number.isInteger(total_centavos) || total_centavos !== computed) fail('total_centavos must equal the sum of the items');

  const method = payment_method ?? 'cash';
  if (!METHODS.includes(method)) fail('payment_method must be cash, exact or gcash');
  if (is_test_sale !== undefined && typeof is_test_sale !== 'boolean') fail('is_test_sale must be boolean');

  let tendered = null;
  if (method === 'cash') {
    tendered = cash_tendered_centavos === undefined || cash_tendered_centavos === null ? computed : cash_tendered_centavos;
    if (!Number.isInteger(tendered) || tendered < computed) fail('cash_tendered_centavos must cover the total');
  }
  if (method === 'gcash' && (typeof gcash_reference !== 'string' || !gcash_reference.trim() || gcash_reference.length > 80)) {
    fail('gcash_reference is required for GCash payments');
  }

  const sale = {
    transaction_id: transaction_id ? transaction_id.trim() : null,
    items: clean,
    total_centavos: computed,
    payment_method: method,
    cash_tendered_centavos: tendered,
    gcash_reference: method === 'gcash' ? gcash_reference.trim() : null,
    is_test_sale: is_test_sale === true,
  };
  const digest = crypto.createHash('sha256').update(JSON.stringify(sale)).digest('hex');
  return { sale, digest };
}

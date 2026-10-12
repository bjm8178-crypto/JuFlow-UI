import crypto from 'node:crypto';

export function orderError(message, status = 400, code = 'validation_error') {
  return Object.assign(new Error(message), { status, code });
}

export function text(value, field, max = 120, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw orderError(`${field} must be a nonempty string of at most ${max} characters`);
  }
  return value.trim();
}

export function integer(value, field, min = 0, max = 10_000_000) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw orderError(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function objectIdString(value, field) {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw orderError(`${field} must be a valid ObjectId`);
  return value.toLowerCase();
}

export function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Validate the request independently of mutable catalog/customer data so a retry
// remains replayable even if those records have since changed or been archived.
export function validateOrder(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw orderError('Order payload must be an object');
  const customer_id = objectIdString(raw.customer_id, 'customer_id');
  const idempotency_key = text(raw.idempotency_key, 'idempotency_key', 120);
  if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 100) throw orderError('Provide 1 to 100 items');
  const items = raw.items.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw orderError(`Invalid item ${i}`);
    const quantity = integer(item.quantity, 'quantity', 1, 1000);
    if (item.product_id !== undefined && item.product_id !== null) {
      return { product_id: objectIdString(item.product_id, 'product_id'), quantity };
    }
    return {
      product_id: null, name: text(item.name, 'item name'), quantity,
      unit_price_centavos: integer(item.unit_price_centavos ?? item.price_centavos, 'unit_price_centavos')
    };
  });
  const payment_method = raw.payment_method;
  if (!['cash', 'exact', 'gcash'].includes(payment_method)) throw orderError('payment_method must be cash, exact or gcash');
  const payment_reference = payment_method === 'gcash' ? text(raw.payment_reference, 'payment_reference', 100) : null;
  const input = {
    customer_id, items, fee_centavos: integer(raw.fee_centavos ?? 0, 'fee_centavos'),
    payment_method, payment_reference,
    cash_tendered_centavos: payment_method === 'cash' ? integer(raw.cash_tendered_centavos, 'cash_tendered_centavos', 0, Number.MAX_SAFE_INTEGER) : null,
    notes: text(raw.notes, 'notes', 500, true), idempotency_key
  };
  if (raw.total_centavos !== undefined) input.submitted_total_centavos = integer(raw.total_centavos, 'total_centavos', 0, Number.MAX_SAFE_INTEGER);
  return input;
}

export function calculateOrder(input, items) {
  const subtotal_centavos = items.reduce((total, item) => {
    const line = item.quantity * item.unit_price_centavos;
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(total + line)) throw orderError('Order subtotal exceeds safe integer range');
    item.subtotal_centavos = line;
    item.price_centavos = item.unit_price_centavos;
    return total + line;
  }, 0);
  const total_centavos = subtotal_centavos + input.fee_centavos;
  if (!Number.isSafeInteger(total_centavos) || total_centavos <= 0) throw orderError('Order total must be a positive safe integer');
  if (input.submitted_total_centavos !== undefined && input.submitted_total_centavos !== total_centavos) throw orderError('total_centavos does not match authoritative total');
  const cash_tendered_centavos = input.payment_method === 'cash' ? input.cash_tendered_centavos : input.payment_method === 'exact' ? total_centavos : null;
  if (input.payment_method === 'cash' && cash_tendered_centavos < total_centavos) throw orderError('Cash tender must cover total');
  return { items, subtotal_centavos, total_centavos, cash_tendered_centavos, change_centavos: input.payment_method === 'cash' ? cash_tendered_centavos - total_centavos : 0 };
}

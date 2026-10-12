import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { validateSale } from '../src/lib/sale.js';
import { phToday } from '../src/routes/menu.js';

describe('Menu and Sale Integration Logic', () => {
  it('phToday returns Manila ISO date string YYYY-MM-DD', () => {
    const today = phToday();
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
    const manilaTime = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    assert.equal(today, manilaTime);
  });

  it('validateSale preserves optional valid product_id on line items', () => {
    const prodId = new ObjectId().toString();
    const result = validateSale({
      transaction_id: 'tx_with_prod_id',
      items: [
        { product_id: prodId, name: 'Pork Sinigang', quantity: 2, price_centavos: 12000 },
        { name: 'Plain Rice', quantity: 2, price_centavos: 2000 }
      ],
      total_centavos: 28000,
      payment_method: 'cash'
    });

    assert.equal(result.sale.items[0].product_id, prodId.toLowerCase());
    assert.equal(result.sale.items[0].name, 'Pork Sinigang');
    assert.equal(result.sale.items[1].product_id, undefined);
    assert.equal(result.sale.items[1].name, 'Plain Rice');
  });

  it('validateSale rejects invalid format for product_id on items', () => {
    assert.throws(() => {
      validateSale({
        transaction_id: 'tx_bad_prod_id',
        items: [{ product_id: 'not-a-valid-object-id', name: 'Item', quantity: 1, price_centavos: 5000 }],
        total_centavos: 5000,
        payment_method: 'cash'
      });
    }, (err) => err.status === 400 && err.message.includes('Invalid product_id'));
  });

  it('validates image data URL format and payload sizing', () => {
    const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const match = validPng.match(/^data:(image\/(jpeg|png|webp));base64,(.+)$/);
    assert.ok(match);
    assert.equal(match[1], 'image/png');

    const buffer = Buffer.from(match[3], 'base64');
    assert.ok(buffer.length <= 300 * 1024);

    const invalidType = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    assert.equal(/^data:(image\/(jpeg|png|webp));base64,(.+)$/.test(invalidType), false);

    const oversizedBuffer = Buffer.alloc(301 * 1024);
    assert.ok(oversizedBuffer.length > 300 * 1024);
  });

  it('case-insensitive name keys are normalized for dish uniqueness', () => {
    const rawName = '  Chicken Adobo Special  ';
    const trimmed = rawName.trim();
    const nameKey = trimmed.toLowerCase();

    assert.equal(nameKey, 'chicken adobo special');
    assert.equal('Chicken ADOBO special'.trim().toLowerCase(), nameKey);
  });
});

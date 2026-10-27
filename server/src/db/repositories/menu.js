import { query, queryOne, execute, normalizeRow, getExecutor, newId, extractId } from './base.js';

export const menuRepo = {
  async findByDate(date, clientOrDb = null) {
    if (!date) return null;
    return await queryOne(clientOrDb, `SELECT * FROM daily_menu WHERE date = $1`, [date]);
  },

  async getTodayDishes(date, clientOrDb = null) {
    const menu = await this.findByDate(date, clientOrDb);
    if (!menu) return { date, dishes: [] };

    let ids = [];
    if (Array.isArray(menu.product_ids)) {
      ids = menu.product_ids.map(extractId).filter(Boolean);
    } else if (Array.isArray(menu.dishes)) {
      ids = menu.dishes.map(d => extractId(typeof d === 'object' ? (d.dish_id || d.product_id || d.id || d._id) : d)).filter(Boolean);
    }

    if (!ids.length) return { date, dishes: [] };

    const sql = `
      SELECT id, name, price_centavos, image_url AS photo_path, data
      FROM products
      WHERE id = ANY($1::varchar[])
        AND COALESCE(is_active, true) IS NOT FALSE
        AND COALESCE(is_available, true) IS NOT FALSE
      ORDER BY name ASC
    `;
    const dishes = await query(clientOrDb, sql, [ids]);
    return { date, dishes };
  },

  async upsertToday(date, productIds, updatedBy, clientOrDb = null) {
    const rawIds = productIds.map(extractId).filter(Boolean);
    const id = newId();
    const dataJson = JSON.stringify({ product_ids: rawIds, updated_by: updatedBy });
    const dishesJson = JSON.stringify(rawIds.map(dish_id => ({ dish_id })));

    const sql = `
      INSERT INTO daily_menu (id, date, dishes, data, created_at, updated_at)
      VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW(), NOW())
      ON CONFLICT (date) DO UPDATE
      SET dishes = EXCLUDED.dishes,
          data = EXCLUDED.data,
          updated_at = NOW()
      RETURNING *
    `;
    return await queryOne(clientOrDb, sql, [id, date, dishesJson, dataJson]);
  }
};

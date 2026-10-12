// Fixed JuFlow delivery areas. Prices are stored in centavos (₱20 and ₱50).
// Legacy delivery_zones database records are retained for historical reference.
export const DELIVERY_AREAS = Object.freeze([
  Object.freeze({ _id: 'within_saog', name: 'Within Saog', fee_centavos: 2000, min_order_centavos: 0, sort_order: 1, is_active: true }),
  Object.freeze({ _id: 'outside_saog', name: 'Outside Saog', fee_centavos: 5000, min_order_centavos: 0, sort_order: 2, is_active: true })
]);

export const getDeliveryArea = (id) => DELIVERY_AREAS.find((area) => area._id === id) || null;

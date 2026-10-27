// Simple flow: preparing -> on_the_way -> delivered.  "cancelled" is the exception path.
export const ORDER_STATUSES = ['preparing', 'on_the_way', 'delivered', 'cancelled'];

// The deliveries collection keeps the old vocabulary so the admin delivery map keeps working.
export const DELIVERY_STATUS_FOR = {
  preparing: 'pending',
  on_the_way: 'on_the_way',
  delivered: 'completed',
  cancelled: 'cancelled'
};

const FORWARD = { preparing: ['on_the_way', 'cancelled'], on_the_way: ['delivered', 'cancelled'] };
const BACK = { on_the_way: ['preparing'] }; // cashier only: fix a mistake

// The admin may correct any order that is still open: Preparing, Done (delivered) or Cancelled,
// even skipping "On the way". Delivered and cancelled orders stay final: "delivered" has already
// created a sale, so reopening it would leave the sales report wrong.
const ADMIN_OPEN = ['preparing', 'on_the_way'];

export function canChangeStatus(from, to, role) {
  if (!['admin', 'cashier', 'rider'].includes(role)) return { allowed: false, reason: 'Only the admin, cashier or rider can change an order status' };
  if (from === to) return { allowed: true, noop: true }; // a retried request is harmless
  if (role === 'admin') {
    if (!ADMIN_OPEN.includes(from)) return { allowed: false, reason: `Cannot change an order from ${from} to ${to}` };
    return { allowed: true };
  }
  const forward = (FORWARD[from] || []).includes(to);
  const backward = role === 'cashier' && (BACK[from] || []).includes(to);
  if (!forward && !backward) return { allowed: false, reason: `Cannot change an order from ${from} to ${to}` };
  if (to === 'cancelled' && role !== 'cashier') return { allowed: false, reason: 'Only the cashier can cancel an order' };
  return { allowed: true };
}

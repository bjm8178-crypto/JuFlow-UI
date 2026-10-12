export const PREPARATION_STATUSES = ['received', 'preparing', 'ready', 'cancelled'];
export const DELIVERY_STATUSES = ['pending', 'assigned', 'picked_up', 'on_the_way', 'arrived', 'awaiting_cashier_confirmation', 'completed', 'cancelled'];
export const ORDER_STATUSES = ['received', 'preparing', 'ready', 'assigned', 'picked_up', 'on_the_way', 'arrived', 'awaiting_cashier_confirmation', 'delivered', 'cancelled'];

const nextDelivery = {
  assigned: 'picked_up', picked_up: 'on_the_way', on_the_way: 'arrived',
  arrived: 'awaiting_cashier_confirmation', awaiting_cashier_confirmation: 'completed'
};

export function canTransitionDelivery(from, to, role) {
  if (!['admin', 'cashier', 'rider'].includes(role)) return { allowed: false, reason: 'Role is not authorized' };
  if (nextDelivery[from] !== to) return { allowed: false, reason: `Illegal delivery transition from ${from} to ${to}` };
  if (to === 'completed' && role !== 'cashier') return { allowed: false, reason: 'Only a cashier can confirm completion' };
  return { allowed: true };
}

export function getOrderNextStatusForAction(from, action, role) {
  if (!['admin', 'cashier'].includes(role)) return { allowed: false, reason: 'Role is not authorized' };
  const targets = { set_preparing: ['received', 'preparing'], set_ready: ['preparing', 'ready'] };
  const rule = targets[action];
  if (!rule || rule[0] !== from) return { allowed: false, reason: `Cannot perform ${action} from ${from}` };
  return { allowed: true, nextStatus: rule[1] };
}

export function displayOrderStatus(preparation, delivery) {
  if (preparation === 'cancelled' || delivery === 'cancelled') return 'cancelled';
  if (delivery === 'completed') return 'delivered';
  return delivery === 'pending' ? preparation : delivery;
}

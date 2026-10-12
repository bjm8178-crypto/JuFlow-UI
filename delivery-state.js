// Only server-issued cashier reconciliation can complete a delivery.
window.DeliveryState = {
 status(o) { return o.delivery_status || o.status; },
 completed(o) {
  const c = o.cashier_confirmation || o.order?.cashier_confirmation;
  return this.status(o) === 'completed' && !!c && c.role_name === 'cashier' && c.source === 'cashier' &&
   typeof c.confirmed_by === 'string' && !!c.confirmed_by &&
   Number.isFinite(Date.parse(c.confirmed_at));
 },
 active(o) { return !this.completed(o) && ['assigned','picked_up','on_the_way','arrived','awaiting_cashier_confirmation','completed'].includes(this.status(o)); },
 label(o) {
  if (this.completed(o)) return 'Completed - cashier confirmed';
  return ({assigned:'Assigned',picked_up:'Picked up',on_the_way:'On the way',arrived:'Arrived',awaiting_cashier_confirmation:'Awaiting cashier confirmation',completed:'Completion confirmation unavailable',cancelled:'Cancelled',failed:'Failed'})[this.status(o)] || 'Unknown delivery status';
 },
 validPoint(p) { return !!p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180; },
 locationLabel(l, now = Date.now()) {
  if (!l) return 'No rider location received';
  const received = Date.parse(l.received_at), occurred = Date.parse(l.occurred_at);
  const stale = !Number.isFinite(received) || !Number.isFinite(occurred) || now - Math.min(received, occurred) > 30000 || occurred > now + 30000;
  const stamp = t => Number.isFinite(t) ? new Date(t).toLocaleString() : 'unavailable';
  const accuracy = typeof l.accuracy === 'number' && Number.isFinite(l.accuracy) && l.accuracy >= 0 ? l.accuracy + ' m' : 'unavailable';
  return (stale ? 'Stale last known location' : 'Recent reported location') + ' | Received: ' + stamp(received) + ' | Observed: ' + stamp(occurred) + ' | Accuracy: ' + accuracy;
 },
 mediaURL(value) { return typeof value === 'string' && /^\/api\/media\/[a-f\d]{24}$/i.test(value) ? value : null; },
 shopPoint(settings) {
  const values = Object.fromEntries(settings.map(s => [s.key, s.value]));
  const p = {lat:values.shop_lat, lng:values.shop_lng};
  return this.validPoint(p) ? p : null;
 }
};

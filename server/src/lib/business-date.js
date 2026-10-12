const DAY = 86400000;
const OFFSET = 8 * 3600000;
export function businessDate(now = new Date()) { return new Date(now.getTime() + OFFSET).toISOString().slice(0, 10); }
export function dateStart(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Object.assign(new Error('date must be YYYY-MM-DD'), { status: 400 });
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw Object.assign(new Error('Invalid calendar date'), { status: 400 });
  return new Date(parsed.getTime() - OFFSET);
}
export function reportRange(query = {}, now = new Date()) {
  const date = query.date || businessDate(now);
  const start = dateStart(query.from || date);
  const end = new Date(dateStart(query.to || date).getTime() + DAY);
  if (end <= start || end - start > 366 * DAY) throw Object.assign(new Error('Range must be ordered and at most 366 days'), { status: 400 });
  const monthStart = dateStart(date.slice(0, 7) + '-01');
  const selected = dateStart(date);
  return { start, end, monthStart, monthEnd: new Date(selected.getTime() + DAY), weekStart: new Date(selected.getTime() - 6 * DAY), weekEnd: new Date(selected.getTime() + DAY) };
}

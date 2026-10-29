// Accounting maths. Revenue is recognised on the day an order is PAID (paid_at, in the business timezone).
import { dateKey, hourOf, monthRange, eachDay, addDays, daysBetween, monthOf } from './dates.js';
import { isPaid, owesContainers, customerKey, isAnonymous } from './orders.js';
import { sum } from './money.js';

export const paidOrders = (orders) => [...orders].filter(isPaid);
const liveExpenses = (expenses) => [...expenses].filter((e) => !e.voided_at);
const methodOf = (o) => o.payment_method || 'cash';

export function periodRange(period, anchorKey) {
  if (period === 'day') return { from: anchorKey, to: anchorKey };
  if (period === 'month') return monthRange(anchorKey.slice(0, 7) + '-01');
  return { from: `${anchorKey.slice(0, 4)}-01-01`, to: `${anchorKey.slice(0, 4)}-12-31` };
}

/** Totals for an inclusive date range. */
export function summarize(orders, expenses, tz, from, to) {
  const paid = paidOrders(orders).filter((o) => {
    const k = dateKey(o.paid_at, tz);
    return k >= from && k <= to;
  });
  const exp = liveExpenses(expenses).filter((e) => e.date >= from && e.date <= to);
  const revenue = sum(paid, (o) => o.total_price);
  const expenseTotal = sum(exp, (e) => e.amount);
  const byMethod = { cash: 0, gcash: 0, other: 0 };
  for (const o of paid) byMethod[methodOf(o)] += o.total_price;
  const byCategory = {};
  for (const e of exp) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  return {
    from, to,
    revenue,
    orders: paid.length,
    units: sum(paid, (o) => o.quantity),
    avgOrder: paid.length ? Math.round(revenue / paid.length) : 0,
    byMethod,
    expenses: expenseTotal,
    byCategory,
    net: revenue - expenseTotal
  };
}

/** Chart buckets: day -> 24 hours, month -> each day, year -> 12 months. */
export function series(orders, expenses, tz, period, anchorKey) {
  const { from, to } = periodRange(period, anchorKey);
  const paid = paidOrders(orders);
  const exp = liveExpenses(expenses);
  if (period === 'day') {
    const rows = Array.from({ length: 24 }, (_, h) => ({ key: String(h), revenue: 0, expenses: 0, orders: 0 }));
    for (const o of paid) if (dateKey(o.paid_at, tz) === from) { const r = rows[hourOf(o.paid_at, tz)]; r.revenue += o.total_price; r.orders++; }
    return rows;
  }
  if (period === 'month') {
    const rows = eachDay(from, to).map((k) => ({ key: k, revenue: 0, expenses: 0, orders: 0 }));
    const idx = new Map(rows.map((r, i) => [r.key, i]));
    for (const o of paid) { const i = idx.get(dateKey(o.paid_at, tz)); if (i != null) { rows[i].revenue += o.total_price; rows[i].orders++; } }
    for (const e of exp) { const i = idx.get(e.date); if (i != null) rows[i].expenses += e.amount; }
    return rows;
  }
  const year = anchorKey.slice(0, 4);
  const rows = Array.from({ length: 12 }, (_, m) => ({ key: `${year}-${String(m + 1).padStart(2, '0')}`, revenue: 0, expenses: 0, orders: 0 }));
  for (const o of paid) { const k = monthOf(dateKey(o.paid_at, tz)); const r = rows.find((x) => x.key === k); if (r) { r.revenue += o.total_price; r.orders++; } }
  for (const e of exp) { const r = rows.find((x) => x.key === monthOf(e.date)); if (r) r.expenses += e.amount; }
  return rows;
}

/** What should be in the cash drawer at close. */
export function expectedCash(orders, expenses, tz, day, openingFloat) {
  const cashSales = sum(paidOrders(orders).filter((o) => dateKey(o.paid_at, tz) === day && methodOf(o) === 'cash'), (o) => o.total_price);
  const drawerExpenses = sum(liveExpenses(expenses).filter((e) => e.date === day && e.paid_from === 'drawer'), (e) => e.amount);
  return { openingFloat, cashSales, drawerExpenses, expected: openingFloat + cashSales - drawerExpenses };
}

/** Delivered but not paid (utang), grouped by customer. */
export function receivables(orders, todayKey, tz) {
  const rows = [...orders].filter((o) => !o.voided_at && o.status === 'delivered');
  const groups = new Map();
  for (const o of rows) {
    const k = customerKey(o) || `o:${o.order_id}`;
    if (!groups.has(k)) groups.set(k, { key: k, name: o.customer_name, amount: 0, orders: [], oldestDays: 0 });
    const g = groups.get(k);
    g.amount += o.total_price;
    g.orders.push(o);
    const since = dateKey(o.delivered_at || o.created_at, tz);
    g.oldestDays = Math.max(g.oldestDays, daysBetween(since, todayKey));
  }
  return [...groups.values()].sort((a, b) => b.oldestDays - a.oldestDays || b.amount - a.amount);
}

/** Empty containers still out, grouped by customer. */
export function containersOwed(orders, todayKey, tz) {
  const groups = new Map();
  for (const o of orders) {
    if (!owesContainers(o)) continue;
    const k = customerKey(o) || `o:${o.order_id}`;
    if (!groups.has(k)) groups.set(k, { key: k, name: o.customer_name, out: 0, orders: [], oldestDays: 0 });
    const g = groups.get(k);
    g.out += o.container_out_count;
    g.orders.push(o);
    g.oldestDays = Math.max(g.oldestDays, daysBetween(dateKey(o.created_at, tz), todayKey));
  }
  return [...groups.values()].sort((a, b) => b.oldestDays - a.oldestDays || b.out - a.out);
}

export function topCustomers(orders, tz, from, to, limit = 8) {
  const map = new Map();
  for (const o of paidOrders(orders)) {
    const k = dateKey(o.paid_at, tz);
    if (k < from || k > to || isAnonymous(o.customer_name)) continue;
    const key = customerKey(o);
    if (!map.has(key)) map.set(key, { key, name: o.customer_name, revenue: 0, orders: 0, units: 0 });
    const g = map.get(key);
    g.revenue += o.total_price; g.orders++; g.units += o.quantity;
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

export { addDays };

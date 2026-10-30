// Accounting maths (v4). Money is recognised on the day an order is PAID (paid_at, business timezone).
// The notebook PAGE lists orders on the day they were TAKEN. Both views are provided and clearly separated.
import { dateKey, hourOf, monthRange, eachDay, addDays, daysBetween, monthOf } from './dates.js';
import { isPaid, owesContainers, customerKey, isAnonymous, isCounted, isUnfinished, incentiveOf, sumObj } from './orders.js';
import { sum } from './money.js';

export const EXPENSE_KINDS = Object.freeze(['expense', 'incentive_payout', 'advance', 'advance_repayment']);
export const INCENTIVE_CATEGORY = 'incentive';
const kindOf = (e) => e.kind || 'expense';
export const paidOrders = (orders) => [...orders].filter(isPaid);
export const liveExpenses = (expenses) => [...expenses].filter((e) => !e.voided_at);
/** Counts against profit: normal expenses and incentive payouts. Advances are lent money, not expenses. */
const isCost = (e) => ['expense', 'incentive_payout'].includes(kindOf(e));
const methodOf = (o) => o.payment_method || 'cash';
/** Cash that left (-) or entered (+) the drawer because of this record. */
export function drawerEffect(e) {
  if (e.voided_at || e.paid_from !== 'drawer') return 0;
  return kindOf(e) === 'advance_repayment' ? e.amount : -e.amount;
}

export function periodRange(period, anchorKey) {
  if (period === 'day') return { from: anchorKey, to: anchorKey };
  if (period === 'month') return monthRange(anchorKey.slice(0, 7) + '-01');
  return { from: `${anchorKey.slice(0, 4)}-01-01`, to: `${anchorKey.slice(0, 4)}-12-31` };
}

/** Totals for an inclusive date range (money view). */
export function summarize(orders, expenses, tz, from, to) {
  const paid = paidOrders(orders).filter((o) => { const k = dateKey(o.paid_at, tz); return k >= from && k <= to; });
  const exp = liveExpenses(expenses).filter((e) => e.date >= from && e.date <= to);
  const costs = exp.filter(isCost);
  const revenue = sum(paid, (o) => o.total_price);
  const expenseTotal = sum(costs, (e) => e.amount);
  const byMethod = { cash: 0, gcash: 0, other: 0 };
  for (const o of paid) byMethod[methodOf(o)] += o.total_price;
  const byCategory = {};
  for (const e of costs) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  return {
    from, to, revenue, orders: paid.length, units: sum(paid, (o) => o.quantity),
    avgOrder: paid.length ? Math.round(revenue / paid.length) : 0,
    byMethod, expenses: expenseTotal, byCategory, net: revenue - expenseTotal,
    advancesGiven: sum(exp.filter((e) => kindOf(e) === 'advance'), (e) => e.amount)
  };
}

/** Chart buckets: day -> 24 hours, month -> each day, year -> 12 months. */
export function series(orders, expenses, tz, period, anchorKey) {
  const { from, to } = periodRange(period, anchorKey);
  const paid = paidOrders(orders);
  const exp = liveExpenses(expenses).filter(isCost);
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
  for (const o of paid) { const r = rows.find((x) => x.key === monthOf(dateKey(o.paid_at, tz))); if (r) { r.revenue += o.total_price; r.orders++; } }
  for (const e of exp) { const r = rows.find((x) => x.key === monthOf(e.date)); if (r) r.expenses += e.amount; }
  return rows;
}

/** What should be in the cash drawer at close. */
export function expectedCash(orders, expenses, tz, day, openingFloat) {
  const cashSales = sum(paidOrders(orders).filter((o) => dateKey(o.paid_at, tz) === day && methodOf(o) === 'cash'), (o) => o.total_price);
  const drawerNet = sum(liveExpenses(expenses).filter((e) => e.date === day), drawerEffect); // negative = cash out
  return { openingFloat, cashSales, drawerNet, drawerExpenses: -drawerNet, expected: openingFloat + cashSales + drawerNet };
}

/** Delivered/served but not paid (utang), grouped by customer. */
export function receivables(orders, todayKey, tz) {
  const groups = new Map();
  for (const o of orders) {
    if (o.voided_at || o.status !== 'delivered') continue;
    const k = customerKey(o) || `o:${o.order_id}`;
    if (!groups.has(k)) groups.set(k, { key: k, name: o.customer_name, amount: 0, orders: [], oldestDays: 0 });
    const g = groups.get(k);
    g.amount += o.total_price; g.orders.push(o);
    g.oldestDays = Math.max(g.oldestDays, daysBetween(dateKey(o.delivered_at || o.created_at, tz), todayKey));
  }
  return [...groups.values()].sort((a, b) => b.oldestDays - a.oldestDays || b.amount - a.amount);
}

/** Empty containers still out, grouped by customer, with per-type counts. */
export function containersOwed(orders, todayKey, tz) {
  const groups = new Map();
  for (const o of orders) {
    if (!owesContainers(o)) continue;
    const k = customerKey(o) || `o:${o.order_id}`;
    if (!groups.has(k)) groups.set(k, { key: k, name: o.customer_name, out: 0, byType: {}, orders: [], oldestDays: 0 });
    const g = groups.get(k);
    for (const [t, n] of Object.entries(o.empties_owed)) if (n > 0) g.byType[t] = (g.byType[t] || 0) + n;
    g.out += sumObj(o.empties_owed);
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

/* ------------------------------------------------------------ notebook page */

export const byTaken = (a, b) => new Date(a.created_at) - new Date(b.created_at) || a.order_id.localeCompare(b.order_id);

/** Orders listed on a given day's page, numbered 1..n by time taken (across all devices). */
export function pageRows(orders, tz, day) {
  return orders.filter((o) => dateKey(o.created_at, tz) === day).sort(byTaken).map((o, i) => ({ n: i + 1, order: o }));
}

/** Unfinished orders from days BEFORE `day` (shown at the top of today's page). */
export function carriedOver(orders, tz, day) {
  return orders.filter((o) => isUnfinished(o) && dateKey(o.created_at, tz) < day).sort(byTaken);
}

/** Everything the notebook page footer needs. */
export function dayTotals(orders, expenses, closes, tz, day) {
  const rows = pageRows(orders, tz, day);
  const live = rows.filter((r) => isCounted(r.order)).map((r) => r.order);
  const paidThatDay = paidOrders(orders).filter((o) => dateKey(o.paid_at, tz) === day);
  const exp = liveExpenses(expenses).filter((e) => e.date === day);
  const costs = exp.filter(isCost);
  const collected = { cash: 0, gcash: 0, other: 0 };
  for (const o of paidThatDay) collected[methodOf(o)] += o.total_price;
  const close = [...closes].filter((c) => c.date === day).sort((a, b) => b.closed_at.localeCompare(a.closed_at))[0] || null;
  const affected = new Set([...rows.map((r) => r.order), ...paidThatDay]);
  const changedAfterClose = close ? [...affected].filter((o) => o.updated_at > close.closed_at) : [];
  const byType = {};
  for (const o of live) for (const [t, n] of Object.entries(o.containers || {})) byType[t] = (byType[t] || 0) + n;
  const emptiesOut = {};
  for (const o of live) for (const [t, n] of Object.entries(o.empties_owed || {})) if (n > 0) emptiesOut[t] = (emptiesOut[t] || 0) + n;
  return {
    day, rows, count: live.length,
    containers: sum(live, (o) => o.quantity), byType, emptiesOut, emptiesOutTotal: sumObj(emptiesOut),
    salesTaken: sum(live, (o) => o.total_price),
    collected, collectedTotal: collected.cash + collected.gcash + collected.other,
    unpaid: sum(live.filter((o) => o.status === 'delivered'), (o) => o.total_price),
    expenses: exp.sort((a, b) => a.created_at.localeCompare(b.created_at)),
    costTotal: sum(costs, (e) => e.amount),
    incentivesPaid: sum(exp.filter((e) => kindOf(e) === 'incentive_payout'), (e) => e.amount),
    advancesGiven: sum(exp.filter((e) => kindOf(e) === 'advance'), (e) => e.amount),
    net: collected.cash + collected.gcash + collected.other - sum(costs, (e) => e.amount),
    close, changedAfterClose
  };
}

/** One summary row per day that has any activity, for the Day book. */
export function dayList(orders, expenses, closes, tz, monthKey) {
  const days = new Set();
  for (const o of orders) { for (const d of [dateKey(o.created_at, tz), o.paid_at ? dateKey(o.paid_at, tz) : null]) if (d && monthOf(d) === monthKey) days.add(d); }
  for (const e of expenses) if (!e.voided_at && monthOf(e.date) === monthKey) days.add(e.date);
  for (const c of closes) if (monthOf(c.date) === monthKey) days.add(c.date);
  return [...days].sort().reverse().map((d) => {
    const t = dayTotals(orders, expenses, closes, tz, d);
    return { day: d, orders: t.count, salesTaken: t.salesTaken, collected: t.collectedTotal, costs: t.costTotal, closed: !!t.close, variance: t.close ? t.close.variance : null, changed: t.changedAfterClose.length };
  });
}

/* --------------------------------------------------------------- staff pay */

/** Per staff member: incentive earned vs paid out, and advance balance. */
export function staffBalances(orders, expenses, staff, tz, day = null) {
  const exp = liveExpenses(expenses);
  return staff.map((s) => {
    const mine = orders.filter((o) => o.staff === s.key);
    const earned = sum(mine, incentiveOf);
    const earnedToday = day ? sum(mine.filter((o) => o.delivered_at && dateKey(o.delivered_at, tz) === day), incentiveOf) : 0;
    const containersToday = day ? sum(mine.filter((o) => incentiveOf(o) >= 0 && o.delivered_at && !o.voided_at && o.status !== 'cancelled' && dateKey(o.delivered_at, tz) === day), (o) => o.quantity) : 0;
    const mineExp = exp.filter((e) => e.staff === s.key);
    const paid = sum(mineExp.filter((e) => kindOf(e) === 'incentive_payout'), (e) => e.amount);
    const adv = sum(mineExp.filter((e) => kindOf(e) === 'advance'), (e) => e.amount);
    const rep = sum(mineExp.filter((e) => kindOf(e) === 'advance_repayment'), (e) => e.amount);
    return { key: s.key, name: s.name, active: s.active, earned, earnedToday, containersToday, paid, balance: earned - paid, advances: adv, repaid: rep, advanceBalance: adv - rep };
  });
}

export { addDays };

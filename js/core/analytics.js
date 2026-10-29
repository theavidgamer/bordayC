// Business analytics: rider performance, reorder prediction, demand forecast, plain-language insights.
// Principle: never claim more than the data supports. Small samples return "not enough data".
import { dateKey, hourOf, weekdayOf, addDays, daysBetween, mondayOf, eachDay, minutesBetween } from './dates.js';
import { isCounted, customerKey, isAnonymous } from './orders.js';

export const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const percentile = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const mad = (arr, med) => median(arr.map((x) => Math.abs(x - med)));

/* ---------------------------------------------------------------- riders */

function lastOtwAt(o) {
  const h = (o.status_history || []).filter((x) => x.status === 'otw');
  return h.length ? h[h.length - 1].at : null;
}

/** One row per rider. Judges against the team and against an absolute late-minutes target. */
export function riderStats(orders, { riders = [], lateMinutes = 45, minSample = 10 } = {}) {
  const label = new Map(riders.map((r) => [r.key, r.name]));
  const byRider = new Map();
  const ensure = (k) => { if (!byRider.has(k)) byRider.set(k, { key: k, name: label.get(k) || k, totals: [], transits: [], owed: 0, cancelled: 0, weeks: new Map() }); return byRider.get(k); };

  for (const o of orders) {
    if (o.voided_at || o.fulfillment !== 'delivery' || !o.rider) continue;
    const r = ensure(o.rider);
    if (o.status === 'cancelled') { r.cancelled++; continue; }
    if (!o.delivered_at) continue;
    const total = minutesBetween(o.created_at, o.delivered_at);
    if (!(total >= 0) || total > 24 * 60) continue; // ignore nonsense / next-day forgotten updates
    r.totals.push(total);
    const otw = lastOtwAt(o);
    if (otw) { const t = minutesBetween(otw, o.delivered_at); if (t >= 0) r.transits.push(t); }
    if (o.container_status === 'owed') r.owed++;
    const wk = mondayOf(o.delivered_at.slice(0, 10));
    const w = r.weeks.get(wk) || { n: 0, late: 0 };
    w.n++; if (total > lateMinutes) w.late++;
    r.weeks.set(wk, w);
  }

  const all = [...byRider.values()];
  const rows = all.map((r) => {
    const n = r.totals.length;
    const late = r.totals.filter((t) => t > lateMinutes).length;
    const others = all.filter((x) => x !== r);
    const otherTotals = others.flatMap((x) => x.totals);
    const otherLate = otherTotals.length ? otherTotals.filter((t) => t > lateMinutes).length / otherTotals.length : null;
    const row = {
      key: r.key, name: r.name, deliveries: n, cancelled: r.cancelled,
      avgMinutes: mean(r.totals), medianMinutes: median(r.totals), p90Minutes: percentile(r.totals, 90),
      avgTransit: mean(r.transits),
      lateRate: n ? late / n : null,
      owedRate: n ? r.owed / n : null,
      weekly: [...r.weeks.entries()].sort().slice(-8).map(([week, v]) => ({ week, n: v.n, lateRate: v.late / v.n })),
      level: 'insufficient', reasons: []
    };
    if (n < minSample) { row.reasons.push(`Only ${n} delivery record${n === 1 ? '' : 's'} – need ${minSample} to judge fairly.`); return row; }
    const reasons = [];
    let level = 'good';
    const pct = (x) => `${Math.round(x * 100)}%`;
    if (row.lateRate >= 0.35) { level = 'poor'; reasons.push(`${pct(row.lateRate)} of deliveries took longer than ${lateMinutes} min.`); }
    else if (row.lateRate >= 0.2) { level = 'watch'; reasons.push(`${pct(row.lateRate)} of deliveries took longer than ${lateMinutes} min.`); }
    if (otherLate != null && row.lateRate - otherLate >= 0.2) {
      if (level !== 'poor') level = 'watch';
      reasons.push(`Late ${pct(row.lateRate)} vs ${pct(otherLate)} for the other rider${others.length > 1 ? 's' : ''}.`);
    }
    if (row.owedRate >= 0.3) { level = level === 'good' ? 'watch' : level; reasons.push(`Empties not collected on ${pct(row.owedRate)} of deliveries.`); }
    if (!reasons.length) reasons.push('On target.');
    row.level = level; row.reasons = reasons;
    return row;
  });
  return rows.sort((a, b) => (b.deliveries - a.deliveries));
}

/* ------------------------------------------------------- reorder prediction */

/**
 * For each named customer with >= minOrders distinct order days, predict the next order from the
 * typical gap (median) between orders. Confidence reflects how regular the gaps are.
 */
export function reorderPredictions(orders, todayKey, tz, { minOrders = 3, customers = new Map() } = {}) {
  const byCust = new Map();
  for (const o of orders) {
    if (!isCounted(o) || isAnonymous(o.customer_name)) continue;
    const key = customerKey(o);
    if (!byCust.has(key)) byCust.set(key, { name: o.customer_name, days: new Set(), qtyByDay: new Map() });
    const g = byCust.get(key);
    const d = dateKey(o.created_at, tz);
    g.days.add(d);
    g.qtyByDay.set(d, (g.qtyByDay.get(d) || 0) + o.quantity);
    g.name = o.customer_name;
  }
  const out = [];
  for (const [key, g] of byCust) {
    const days = [...g.days].sort();
    if (days.length < minOrders) continue;
    const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d));
    const med = Math.max(1, median(gaps));
    const spread = mad(gaps, med) ?? 0;
    const last = days[days.length - 1];
    const predicted = addDays(last, Math.round(med));
    const daysLate = daysBetween(predicted, todayKey); // >0 = past the expected date
    const tolerance = Math.max(1, Math.round(Math.max(spread * 1.5, med * 0.25)));
    const sinceLast = daysBetween(last, todayKey);
    let state = 'upcoming';
    if (sinceLast > Math.max(med * 4, 21)) state = 'lapsed';
    else if (daysLate > tolerance) state = 'overdue';
    else if (daysLate >= -1) state = 'due';
    const ratio = spread / med;
    const confidence = gaps.length >= 5 && ratio < 0.25 ? 'high' : gaps.length >= 3 && ratio < 0.5 ? 'medium' : 'low';
    const c = customers.get?.(key.startsWith('n:') ? key : key) || null;
    out.push({
      key, name: g.name, orders: days.length, typicalGapDays: Math.round(med), lastOrder: last, predictedDate: predicted,
      daysLate, state, confidence, typicalQty: Math.round(median([...g.qtyByDay.values()])),
      phone: c?.phone || '', address: c?.address || ''
    });
  }
  const order = { overdue: 0, due: 1, upcoming: 2, lapsed: 3 };
  return out.sort((a, b) => order[a.state] - order[b.state] || (a.state === 'upcoming' ? -a.daysLate - -b.daysLate : b.daysLate - a.daysLate));
}

/* --------------------------------------------------------- demand forecast */

/** Expected units per upcoming day = average of the same weekday over recent weeks. */
export function demandForecast(orders, todayKey, tz, { horizon = 7, weeks = 8, minHistoryDays = 14 } = {}) {
  const live = orders.filter(isCounted);
  if (!live.length) return null;
  const perDay = new Map();
  let first = todayKey;
  for (const o of live) {
    const d = dateKey(o.created_at, tz);
    perDay.set(d, (perDay.get(d) || 0) + o.quantity);
    if (d < first) first = d;
  }
  if (daysBetween(first, todayKey) < minHistoryDays) return null;
  const start = [addDays(todayKey, -weeks * 7), first].sort().pop();
  const end = addDays(todayKey, -1); // today is incomplete
  const sums = Array(7).fill(0), counts = Array(7).fill(0);
  for (const d of eachDay(start, end)) { const wd = weekdayOf(d); sums[wd] += perDay.get(d) || 0; counts[wd]++; }
  return Array.from({ length: horizon }, (_, i) => {
    const date = addDays(todayKey, i + 1);
    const wd = weekdayOf(date);
    return { date, weekday: wd, expected: counts[wd] ? Math.round(sums[wd] / counts[wd]) : 0, samples: counts[wd] };
  });
}

/** 7 x 24 grid of order counts (created_at), for "busiest hours". */
export function busyHours(orders, tz) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const o of orders) if (isCounted(o)) grid[weekdayOf(dateKey(o.created_at, tz))][hourOf(o.created_at, tz)]++;
  return grid;
}

/* ---------------------------------------------------------------- insights */

/** Short, plain-language cards for the top of the Insights screen. */
export function buildInsights({ riders = [], reorders = [], receivables = [], containers = [], forecast = null }) {
  const cards = [];
  for (const r of riders) {
    if (r.level === 'poor') cards.push({ level: 'warn', title: `${r.name} needs attention`, detail: r.reasons.join(' ') });
    else if (r.level === 'watch') cards.push({ level: 'info', title: `Keep an eye on ${r.name}`, detail: r.reasons.join(' ') });
  }
  const due = reorders.filter((x) => x.state === 'due' || x.state === 'overdue');
  if (due.length) cards.push({ level: 'info', title: `${due.length} customer${due.length === 1 ? ' is' : 's are'} due to reorder`, detail: due.slice(0, 4).map((x) => x.name).join(', ') + (due.length > 4 ? '…' : '') });
  const owed = receivables.reduce((s, g) => s + g.amount, 0);
  if (owed > 0) cards.push({ level: 'warn', title: `${receivables.length} customer${receivables.length === 1 ? '' : 's'} still owe money`, detail: `Oldest balance is ${Math.max(...receivables.map((g) => g.oldestDays))} day(s) old.`, amount: owed });
  const outN = containers.reduce((s, g) => s + g.out, 0);
  if (outN > 0) cards.push({ level: 'info', title: `${outN} empty container${outN === 1 ? '' : 's'} still out`, detail: `With ${containers.length} customer${containers.length === 1 ? '' : 's'}.` });
  if (forecast) {
    const best = [...forecast].sort((a, b) => b.expected - a.expected)[0];
    if (best && best.expected > 0) cards.push({ level: 'good', title: `Busiest coming day: ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][best.weekday]}`, detail: `About ${best.expected} container${best.expected === 1 ? '' : 's'} expected.` });
  }
  return cards;
}

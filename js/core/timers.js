// The single "time" cell shown per order: what stage it is in, how long, and a colour level.
import { prettyTime } from './dates.js';

export const DEFAULT_TIMERS = Object.freeze({
  waitingWarn: 5, waitingLate: 10,      // minutes: order taken, work not started
  preparingWarn: 10, preparingLate: 20, // minutes
  outWarn: 20, outLate: 40,             // minutes: rider has left
  unpaidWarnHours: 24, unpaidLateHours: 72 // hours: delivered but not paid
});

export function duration(mins) {
  const m = Math.max(0, Math.floor(mins));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

function lastAt(order, status) {
  const h = (order.status_history || []).filter((x) => x.status === status);
  return h.length ? h[h.length - 1].at : null;
}
const level = (mins, warn, late) => (mins >= late ? 'late' : mins >= warn ? 'warn' : 'ok');

/** -> { text, level:'ok'|'warn'|'late'|'done'|'none', minutes } */
export function stage(order, nowMs, tz, limits = DEFAULT_TIMERS) {
  const L = { ...DEFAULT_TIMERS, ...(limits || {}) };
  const since = (iso) => (nowMs - new Date(iso).getTime()) / 60000;
  if (order.voided_at) return { text: 'Voided', level: 'none', minutes: 0 };
  switch (order.status) {
    case 'not_started': { const m = since(order.created_at); return { text: `Taken ${duration(m)}${m < 1 ? '' : ' ago'}`, level: level(m, L.waitingWarn, L.waitingLate), minutes: m }; }
    case 'preparing': { const m = since(lastAt(order, 'preparing') || order.created_at); return { text: `Preparing ${duration(m)}`, level: level(m, L.preparingWarn, L.preparingLate), minutes: m }; }
    case 'otw': { const m = since(lastAt(order, 'otw') || order.created_at); return { text: `Rider out ${duration(m)}`, level: level(m, L.outWarn, L.outLate), minutes: m }; }
    case 'delivered': { const m = since(order.delivered_at || order.created_at); return { text: `Unpaid ${duration(m)}`, level: level(m, L.unpaidWarnHours * 60, L.unpaidLateHours * 60), minutes: m }; }
    case 'paid': return { text: `Paid ${prettyTime(order.paid_at, tz)}`, level: 'done', minutes: 0 };
    case 'cancelled': return { text: 'Cancelled', level: 'none', minutes: 0 };
    default: return { text: '', level: 'none', minutes: 0 };
  }
}

/** Full timeline for the order window: [{label, at}] */
export function timeline(order) {
  const rows = [{ label: 'Order taken', at: order.created_at }];
  const pick = (status, label) => { const a = lastAt(order, status); if (a) rows.push({ label, at: a }); };
  pick('preparing', 'Started preparing');
  pick('otw', 'Rider went out');
  if (order.delivered_at) rows.push({ label: order.fulfillment === 'delivery' ? 'Delivered' : 'Handed over', at: order.delivered_at });
  if (order.paid_at) rows.push({ label: 'Paid', at: order.paid_at });
  for (const h of order.empties_history || []) rows.push({ label: 'Empties came back', at: h.at });
  return rows.sort((a, b) => new Date(a.at) - new Date(b.at));
}

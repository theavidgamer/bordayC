// Pure order logic (v4). Every function returns a NEW order object; nothing touches storage or the DOM.
import { dateKey } from './dates.js';

export const STATUSES = Object.freeze(['not_started', 'preparing', 'otw', 'delivered', 'paid', 'cancelled', 'voided']);
export const FLOW = Object.freeze(['not_started', 'preparing', 'otw', 'delivered', 'paid']);
export const STATUS_LABEL = Object.freeze({
  not_started: 'Waiting', preparing: 'Preparing', otw: 'Rider out', delivered: 'Delivered – unpaid',
  paid: 'Paid', cancelled: 'Cancelled', voided: 'Voided'
});
export const PAYMENT_METHODS = Object.freeze(['cash', 'gcash', 'other']);
export const METHOD_LABEL = Object.freeze({ cash: 'Cash', gcash: 'GCash', other: 'Other' });
export const FULFILLMENTS = Object.freeze(['pickup', 'delivery']);

export class OrderError extends Error {}

const clone = (o) => JSON.parse(JSON.stringify(o));
const isInt = (n) => Number.isInteger(n);
export const sumObj = (o) => Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0);

export const isVoided = (o) => !!o.voided_at;
export const isPaid = (o) => o.status === 'paid' && !o.voided_at;
export const isCounted = (o) => !o.voided_at && o.status !== 'cancelled'; // real demand
export const isServed = (o) => !!o.delivered_at;
export const owesContainers = (o) => !o.voided_at && o.status !== 'cancelled' && sumObj(o.empties_owed) > 0;
export const isOpenStatus = (o) => ['not_started', 'preparing', 'otw', 'delivered'].includes(o.status);
/** "Unfinished": not completed, or paid but empties still out. */
export const isUnfinished = (o) => !o.voided_at && o.status !== 'cancelled' && (isOpenStatus(o) || owesContainers(o));

/** Incentive this order earns for the staff who handled it (centavos). Voided / cancelled / not yet served -> 0. */
export function incentiveOf(o) {
  if (!o.staff || o.voided_at || o.status === 'cancelled' || !o.delivered_at) return 0;
  return (o.quantity || 0) * (o.incentive_rate || 0);
}

export const normalizeName = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const isAnonymous = (name) => { const n = normalizeName(name); return n === '' || n === 'no name' || n === 'pick up' || n === 'pickup'; };
/** Stable identity for grouping a customer's orders. */
export function customerKey(o) {
  if (o.customer_id) return o.customer_id;
  if (isAnonymous(o.customer_name)) return null;
  return `n:${normalizeName(o.customer_name)}`;
}

/** Work out totals from the deal lines + regular containers. */
export function computeTotals({ deals = [], regular_qty = 0, unit_price = 0 }) {
  let quantity = regular_qty, total = regular_qty * unit_price;
  for (const d of deals) {
    if (!isInt(d.count) || d.count < 1) continue;
    quantity += d.count * d.containers;
    total += d.count * d.total;
  }
  return { quantity, total };
}

function cleanDeals(deals) {
  return (deals || []).filter((d) => d && isInt(d.count) && d.count > 0).map((d) => ({
    key: String(d.key || 'deal'), name: String(d.name || 'Special').slice(0, 60), containers: d.containers | 0, total: d.total | 0, count: d.count | 0
  }));
}

function checkTypes(containers, quantity) {
  for (const [k, v] of Object.entries(containers)) if (!isInt(v) || v < 0) throw new OrderError(`Container count for ${k} is not valid.`);
  if (sumObj(containers) !== quantity) throw new OrderError(`Container types add up to ${sumObj(containers)} but the order has ${quantity}.`);
}

/**
 * input: { customer_name, customer_id, fulfillment, staff, deals:[{key,name,containers,total,count}], regular_qty, unit_price,
 *          containers:{type:n}, empties_owed:{type:n}, pay:{method,tendered,ref}|'later'|null, note, priority }
 * ctx:   { id, orderNo, now, rates:{pickup,delivery} }  rates = incentive centavos per container
 */
export function createOrder(input, ctx) {
  const fulfillment = input.fulfillment === 'delivery' ? 'delivery' : 'pickup';
  const deals = cleanDeals(input.deals);
  const regular = input.regular_qty | 0;
  const unitPrice = input.unit_price;
  if (!isInt(unitPrice) || unitPrice < 0) throw new OrderError('Price must be zero or more.');
  if (regular < 0) throw new OrderError('Quantity cannot be negative.');
  const { quantity, total } = computeTotals({ deals, regular_qty: regular, unit_price: unitPrice });
  if (quantity < 1) throw new OrderError('Add at least one container.');
  if (quantity > 9999) throw new OrderError('That is too many containers for one order.');
  const containers = { ...(input.containers || {}) };
  checkTypes(containers, quantity);
  const owed = fulfillment === 'delivery' ? { ...(input.empties_owed || {}) } : {};
  for (const [k, v] of Object.entries(owed)) {
    if (!isInt(v) || v < 0 || v > (containers[k] || 0)) throw new OrderError('Empties owed cannot be more than the containers delivered.');
  }
  const now = ctx.now;
  const name = String(input.customer_name || '').trim().slice(0, 120) || 'no name';
  const rate = fulfillment === 'delivery' ? ctx.rates?.delivery || 0 : ctx.rates?.pickup || 0;

  const o = {
    order_id: ctx.id, order_no: ctx.orderNo || null,
    created_at: now, updated_at: now, delivered_at: null, paid_at: null, voided_at: null,
    status: 'not_started', fulfillment, priority: !!input.priority,
    customer_name: name, customer_id: input.customer_id || null,
    staff: input.staff || null,
    deals, regular_qty: regular, unit_price: unitPrice, quantity, total_price: total,
    containers, empties_owed: owed, empties_short: sumObj(owed), empties_history: [],
    incentive_rate: 0,
    payment_method: null, payment_ref: null, amount_tendered: null,
    note: String(input.note || '').trim().slice(0, 300),
    custom: {}, status_history: [{ status: 'not_started', at: now }], edits: []
  };

  const serveNow = () => { o.delivered_at = now; o.incentive_rate = rate; };
  if (fulfillment === 'pickup') {
    if (input.pay === 'later') { serveNow(); o.status = 'delivered'; o.status_history.push({ status: 'delivered', at: now }); }
    else if (input.pay && typeof input.pay === 'object') { serveNow(); applyPayment(o, input.pay, now); }
  }
  return o;
}

function applyPayment(o, pay, now) {
  const method = PAYMENT_METHODS.includes(pay.method) ? pay.method : 'cash';
  if (method === 'cash' && pay.tendered != null) {
    if (!isInt(pay.tendered) || pay.tendered < o.total_price) throw new OrderError('Cash received is less than the total.');
    o.amount_tendered = pay.tendered;
  } else o.amount_tendered = null;
  o.payment_method = method;
  o.payment_ref = pay.ref ? String(pay.ref).trim().slice(0, 60) : null;
  o.status = 'paid';
  o.paid_at = now;
  o.status_history.push({ status: 'paid', at: now });
}

const rank = (s) => FLOW.indexOf(s);

/** Move an order to another status. Going backwards from Paid needs a reason and is logged. opts.rates = incentive rates. */
export function setStatus(order, to, now, opts = {}) {
  if (order.voided_at) throw new OrderError('This order is voided.');
  if (!STATUSES.includes(to) || to === 'voided') throw new OrderError('Unknown status.');
  if (to === order.status) return order;
  const from = order.status;
  const o = clone(order);
  const wasPaid = from === 'paid';
  if (from === 'cancelled' && to !== 'not_started') throw new OrderError('A cancelled order can only be re-opened.');

  const serve = () => {
    if (!o.delivered_at) {
      o.delivered_at = now;
      o.incentive_rate = o.fulfillment === 'delivery' ? opts.rates?.delivery || 0 : opts.rates?.pickup || 0;
    }
  };
  if (to === 'paid') {
    if (!opts.pay) throw new OrderError('Payment details are required.');
    serve();
    applyPayment(o, opts.pay, now);
    o.updated_at = now;
    return o;
  }
  if (wasPaid) {
    if (!opts.reason || !String(opts.reason).trim()) throw new OrderError('Please give a reason for un-paying.');
    o.paid_at = null; o.payment_method = null; o.payment_ref = null; o.amount_tendered = null;
  }
  if (to === 'delivered') serve();
  if (rank(to) >= 0 && rank(to) < rank('delivered')) { o.delivered_at = null; o.incentive_rate = 0; }
  if (to === 'cancelled') { o.priority = false; }
  o.status = to;
  o.status_history.push({ status: to, at: now });
  if (wasPaid || order.paid_at) o.edits.push({ at: now, changes: { status: [from, to] }, reason: String(opts.reason || '').slice(0, 200) });
  o.updated_at = now;
  return o;
}

export function nextStatus(order) {
  if (order.status === 'cancelled' || order.voided_at) return null;
  if (order.fulfillment === 'pickup') return order.status === 'delivered' ? 'paid' : order.status === 'paid' ? null : 'paid';
  const i = rank(order.status);
  return i >= 0 && i < FLOW.length - 1 ? FLOW[i + 1] : null;
}

export function setPriority(order, on, now) {
  if (!!order.priority === !!on) return order;
  const o = clone(order);
  o.priority = !!on; o.updated_at = now;
  return o;
}

export function voidOrder(order, now, reason = '') {
  if (order.voided_at) return order;
  const o = clone(order);
  o.voided_at = now; o.updated_at = now; o.priority = false;
  o.edits.push({ at: now, changes: { voided: [false, true] }, reason: String(reason).slice(0, 200) });
  return o;
}
export function unvoidOrder(order, now) {
  if (!order.voided_at) return order;
  const o = clone(order);
  o.voided_at = null;
  o.updated_at = now; // must be NEWER than the voided copy so imports accept the undo
  o.edits.push({ at: now, changes: { voided: [true, false] }, reason: 'restored' });
  return o;
}

const AMENDABLE = ['customer_name', 'customer_id', 'staff', 'deals', 'regular_qty', 'unit_price', 'quantity', 'total_price', 'containers', 'empties_owed', 'payment_method', 'payment_ref', 'note'];

/** Edit fields. Changes to anything already paid are written to `edits` (audit trail). total_price in the patch = manual override. */
export function amendOrder(order, patch, now, reason = '') {
  if (order.voided_at) throw new OrderError('This order is voided.');
  const next = { ...order };
  for (const k of Object.keys(patch)) if (AMENDABLE.includes(k)) next[k] = patch[k];
  next.customer_name = String(next.customer_name || '').trim().slice(0, 120) || 'no name';
  next.deals = cleanDeals(next.deals);
  next.regular_qty = next.regular_qty | 0;
  if (!isInt(next.unit_price) || next.unit_price < 0) throw new OrderError('Price must be zero or more.');
  const t = computeTotals(next);
  if (t.quantity < 1) throw new OrderError('Add at least one container.');
  next.quantity = t.quantity;
  next.total_price = patch.total_price !== undefined ? patch.total_price : t.total;
  if (!isInt(next.total_price) || next.total_price < 0) throw new OrderError('Total is not valid.');
  if (patch.containers === undefined && sumObj(next.containers) !== next.quantity) {
    // quantity changed but types were not given: put the difference on the first type
    const keys = Object.keys(next.containers || {});
    const first = keys[0] || 'bilog';
    next.containers = { ...(next.containers || {}) };
    next.containers[first] = Math.max(0, (next.containers[first] || 0) + (next.quantity - sumObj(next.containers)));
  }
  checkTypes(next.containers, next.quantity);
  if (next.fulfillment === 'pickup') next.empties_owed = {};
  for (const [k, v] of Object.entries(next.empties_owed || {})) {
    if (!isInt(v) || v < 0 || v > (next.containers[k] || 0)) throw new OrderError('Empties owed cannot be more than the containers delivered.');
  }
  if (next.payment_method && !PAYMENT_METHODS.includes(next.payment_method)) throw new OrderError('Unknown payment method.');

  const changes = {};
  for (const k of AMENDABLE) if (JSON.stringify(order[k]) !== JSON.stringify(next[k])) changes[k] = [order[k] ?? null, next[k] ?? null];
  if (!Object.keys(changes).length) return order;
  const o = clone(next);
  o.updated_at = now;
  if (order.paid_at) o.edits = [...(order.edits || []), { at: now, changes, reason: String(reason).slice(0, 200) }];
  return o;
}

/** Customer handed back empties. returned = { type: n } */
export function returnEmpties(order, returned, now) {
  if (!owesContainers(order)) throw new OrderError('No empties are owed on this order.');
  const o = clone(order);
  const done = {};
  for (const [k, n] of Object.entries(returned)) {
    if (!isInt(n) || n < 0) throw new OrderError('Enter how many came back.');
    const take = Math.min(n, o.empties_owed[k] || 0);
    if (take > 0) { o.empties_owed[k] -= take; done[k] = take; }
  }
  if (!Object.keys(done).length) throw new OrderError('Enter how many came back.');
  o.empties_history = [...(order.empties_history || []), { returned: done, at: now }];
  o.updated_at = now;
  return o;
}

/** The business day an order is listed under on the notebook page (the day it was taken). */
export const pageDay = (o, tz) => dateKey(o.created_at, tz);
/** The business day its money counts (the day it was paid). */
export const revenueDay = (o, tz) => (isPaid(o) && o.paid_at ? dateKey(o.paid_at, tz) : null);

/** Newest updated_at wins. Equal -> keep what we have. */
export function mergeById(existingMap, incoming, idField) {
  const toPut = [];
  let added = 0, updated = 0, skipped = 0;
  for (const row of incoming) {
    const cur = existingMap.get(row[idField]);
    if (!cur) { toPut.push(row); added++; continue; }
    if (new Date(row.updated_at) > new Date(cur.updated_at)) { toPut.push(row); updated++; } else skipped++;
  }
  return { toPut, added, updated, skipped };
}

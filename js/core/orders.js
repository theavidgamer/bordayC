// Pure order logic. Every function returns a NEW order object; nothing touches storage or the DOM.
import { dateKey } from './dates.js';

export const STATUSES = Object.freeze(['not_started', 'preparing', 'otw', 'delivered', 'paid', 'cancelled', 'voided']);
export const FLOW = Object.freeze(['not_started', 'preparing', 'otw', 'delivered', 'paid']);
export const STATUS_LABEL = Object.freeze({
  not_started: 'Not started', preparing: 'Preparing', otw: 'On the way', delivered: 'Delivered – unpaid',
  paid: 'Paid', cancelled: 'Cancelled', voided: 'Voided'
});
export const CONTAINER_STATUSES = Object.freeze(['swapped', 'owed', 'kept']);
export const PAYMENT_METHODS = Object.freeze(['cash', 'gcash', 'other']);
export const METHOD_LABEL = Object.freeze({ cash: 'Cash', gcash: 'GCash', other: 'Other' });

export class OrderError extends Error {}

const clone = (o) => JSON.parse(JSON.stringify(o));
const isInt = (n) => Number.isInteger(n);

export const isVoided = (o) => !!o.voided_at;
export const isPaid = (o) => o.status === 'paid' && !o.voided_at;
export const isCounted = (o) => !o.voided_at && o.status !== 'cancelled'; // real demand
export const owesContainers = (o) => !o.voided_at && o.container_status === 'owed' && (o.container_out_count || 0) > 0;
export const isOpenStatus = (o) => ['not_started', 'preparing', 'otw', 'delivered'].includes(o.status);
/** Orders that belong on the Board: not finished, or paid but empties still out. */
export const onBoard = (o) => !o.voided_at && o.status !== 'cancelled' && (isOpenStatus(o) || owesContainers(o));

export function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
export function isAnonymous(name) {
  const n = normalizeName(name);
  return n === '' || n === 'no name';
}
/** Stable identity for grouping a customer's orders. */
export function customerKey(o) {
  if (o.customer_id) return o.customer_id;
  if (isAnonymous(o.customer_name)) return null;
  return `n:${normalizeName(o.customer_name)}`;
}

function checkQtyPrice(quantity, unitPrice) {
  if (!isInt(quantity) || quantity < 1 || quantity > 9999) throw new OrderError('Quantity must be a whole number from 1 to 9999.');
  if (!isInt(unitPrice) || unitPrice < 0) throw new OrderError('Price must be zero or more.');
}

function containerFields({ type = null, status = null, count = null, owed = null }, quantity) {
  if (!type) return { container_type: null, container_status: null, container_count: 0, container_out_count: 0 };
  const st = CONTAINER_STATUSES.includes(status) ? status : 'swapped';
  const cnt = isInt(count) && count > 0 ? count : quantity;
  let out = 0;
  if (st === 'owed') out = isInt(owed) && owed > 0 ? owed : cnt;
  return { container_type: type, container_status: st, container_count: cnt, container_out_count: out };
}

/**
 * input: { customer_name, customer_id, quantity, unit_price, special:{name,total}|null,
 *          fulfillment:'walkin'|'delivery', rider, container:{type,status,count,owed},
 *          pay: {method, tendered?, ref?} | 'later' | null, note }
 * ctx:   { id, orderNo, now (ISO string) }
 */
export function createOrder(input, ctx) {
  const quantity = input.quantity;
  const unitPrice = input.unit_price;
  checkQtyPrice(quantity, unitPrice);
  const fulfillment = input.fulfillment === 'delivery' ? 'delivery' : 'walkin';
  const special = input.special || null;
  const total = special ? special.total : unitPrice * quantity;
  if (!isInt(total) || total < 0) throw new OrderError('Total is not valid.');
  const now = ctx.now;
  const name = String(input.customer_name || '').trim().slice(0, 120) || 'no name';

  const o = {
    order_id: ctx.id,
    order_no: ctx.orderNo || null,
    created_at: now,
    updated_at: now,
    delivered_at: null,
    paid_at: null,
    voided_at: null,
    status: 'not_started',
    fulfillment,
    customer_name: name,
    customer_id: input.customer_id || null,
    is_special: !!special,
    special_name: special ? String(special.name || 'Special') : null,
    quantity,
    unit_price: unitPrice,
    total_price: total,
    rider: fulfillment === 'delivery' ? input.rider || null : null,
    ...containerFields(input.container || {}, quantity),
    container_history: [],
    payment_method: null,
    payment_ref: null,
    amount_tendered: null,
    note: String(input.note || '').trim().slice(0, 300),
    custom: {},
    status_history: [{ status: 'not_started', at: now }],
    edits: []
  };

  if (input.pay === 'later' && fulfillment === 'walkin') {
    o.status = 'delivered';
    o.delivered_at = now;
    o.status_history.push({ status: 'delivered', at: now });
  } else if (input.pay && typeof input.pay === 'object') {
    applyPayment(o, input.pay, now);
    if (fulfillment === 'walkin') o.delivered_at = now;
  }
  return o;
}

function applyPayment(o, pay, now) {
  const method = PAYMENT_METHODS.includes(pay.method) ? pay.method : 'cash';
  if (method === 'cash' && pay.tendered != null) {
    if (!isInt(pay.tendered) || pay.tendered < o.total_price) throw new OrderError('Cash received is less than the total.');
    o.amount_tendered = pay.tendered;
  } else {
    o.amount_tendered = null;
  }
  o.payment_method = method;
  o.payment_ref = pay.ref ? String(pay.ref).trim().slice(0, 60) : null;
  o.status = 'paid';
  o.paid_at = now;
  o.status_history.push({ status: 'paid', at: now });
}

const rank = (s) => FLOW.indexOf(s);

/** Move an order to another status. Going backwards from Paid needs a reason and is logged. */
export function setStatus(order, to, now, opts = {}) {
  if (order.voided_at) throw new OrderError('This order is voided.');
  if (!STATUSES.includes(to) || to === 'voided') throw new OrderError('Unknown status.');
  if (to === order.status) return order;
  const from = order.status;
  const o = clone(order);
  const wasPaid = from === 'paid';
  if (from === 'cancelled' && to !== 'not_started') throw new OrderError('A cancelled order can only be re-opened.');

  if (to === 'paid') {
    if (!opts.pay) throw new OrderError('Payment details are required.');
    if (o.fulfillment === 'delivery' && !o.delivered_at) o.delivered_at = now;
    applyPayment(o, opts.pay, now);
    // applyPayment pushed history already
    o.updated_at = now;
    return o;
  }

  if (wasPaid) {
    if (!opts.reason || !String(opts.reason).trim()) throw new OrderError('Please give a reason for un-paying.');
    o.paid_at = null;
    o.payment_method = null;
    o.payment_ref = null;
    o.amount_tendered = null;
  }
  if (to === 'delivered') o.delivered_at = o.delivered_at || now;
  if (rank(to) >= 0 && rank(to) < rank('delivered')) o.delivered_at = null;
  o.status = to;
  o.status_history.push({ status: to, at: now });
  if (wasPaid || order.paid_at) {
    o.edits.push({ at: now, changes: { status: [from, to] }, reason: String(opts.reason || '').slice(0, 200) });
  }
  o.updated_at = now;
  return o;
}

export function nextStatus(order) {
  if (order.fulfillment === 'walkin') return order.status === 'delivered' ? 'paid' : null;
  const i = rank(order.status);
  return i >= 0 && i < FLOW.length - 1 ? FLOW[i + 1] : null;
}

export function voidOrder(order, now, reason = '') {
  if (order.voided_at) return order;
  const o = clone(order);
  o.voided_at = now;
  o.updated_at = now;
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

const AMENDABLE = ['customer_name', 'customer_id', 'quantity', 'unit_price', 'total_price', 'rider', 'container_type',
  'container_status', 'container_count', 'container_out_count', 'payment_method', 'payment_ref', 'note', 'special_name', 'is_special'];

/** Edit fields. Changes to anything already paid are written to `edits` (audit trail). */
export function amendOrder(order, patch, now, reason = '') {
  if (order.voided_at) throw new OrderError('This order is voided.');
  const next = { ...order };
  for (const k of Object.keys(patch)) if (AMENDABLE.includes(k)) next[k] = patch[k];

  if (patch.customer_name !== undefined) next.customer_name = String(patch.customer_name || '').trim().slice(0, 120) || 'no name';
  const qtyOrPriceChanged = patch.quantity !== undefined || patch.unit_price !== undefined;
  if (qtyOrPriceChanged && patch.total_price === undefined && !next.is_special) next.total_price = next.unit_price * next.quantity;
  checkQtyPrice(next.quantity, next.unit_price);
  if (!isInt(next.total_price) || next.total_price < 0) throw new OrderError('Total is not valid.');
  if (!next.container_type) {
    next.container_status = null; next.container_count = 0; next.container_out_count = 0;
  } else {
    if (!CONTAINER_STATUSES.includes(next.container_status)) next.container_status = 'swapped';
    if (next.container_status !== 'owed') next.container_out_count = 0;
    next.container_out_count = Math.max(0, Math.min(isInt(next.container_out_count) ? next.container_out_count : 0, 9999));
    if (next.container_out_count > next.container_count) next.container_count = next.container_out_count;
  }
  if (next.payment_method && !PAYMENT_METHODS.includes(next.payment_method)) throw new OrderError('Unknown payment method.');

  const changes = {};
  for (const k of AMENDABLE) {
    if (JSON.stringify(order[k]) !== JSON.stringify(next[k])) changes[k] = [order[k] ?? null, next[k] ?? null];
  }
  if (Object.keys(changes).length === 0) return order;
  const o = clone(next);
  o.updated_at = now;
  if (order.paid_at) o.edits = [...(order.edits || []), { at: now, changes, reason: String(reason).slice(0, 200) }];
  return o;
}

/** Customer handed back `n` empty containers. */
export function returnContainers(order, n, now) {
  if (!isInt(n) || n < 1) throw new OrderError('Enter how many came back.');
  if (!owesContainers(order)) throw new OrderError('No containers are owed on this order.');
  const take = Math.min(n, order.container_out_count);
  const o = clone(order);
  o.container_out_count = order.container_out_count - take;
  o.container_history = [...(order.container_history || []), { returned: take, at: now }];
  o.updated_at = now;
  return o;
}

/** The business day an order belongs to for revenue: the day it was PAID. */
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

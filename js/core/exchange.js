// Import / export. Everything that comes from a file is treated as untrusted and re-validated.
import { STATUSES, CONTAINER_STATUSES, PAYMENT_METHODS, METHOD_LABEL } from './orders.js';
import { isSafeId } from './ids.js';
import { dateKey, prettyTime } from './dates.js';
import { pesoPlain } from './money.js';

export const SCHEMA_VERSION = 4;
export const APP_NAME = 'water-station-ledger';

const isoOrNull = (v) => { if (v == null || v === '') return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); };
const str = (v, max) => String(v ?? '').slice(0, max);
const int = (v) => (Number.isInteger(v) ? v : Number.isFinite(v) ? Math.round(v) : NaN);

/** Returns { ok:true, order } or { ok:false, error }. Unknown fields are dropped. */
export function sanitizeOrder(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  if (!isSafeId(raw.order_id)) return { ok: false, error: 'bad order_id' };
  const created = isoOrNull(raw.created_at);
  if (!created) return { ok: false, error: `${raw.order_id}: bad created_at` };
  const updated = isoOrNull(raw.updated_at) || created;
  if (!STATUSES.includes(raw.status)) return { ok: false, error: `${raw.order_id}: bad status` };
  const quantity = int(raw.quantity), unit = int(raw.unit_price), total = int(raw.total_price);
  if (!(quantity >= 1 && quantity <= 99999) || !(unit >= 0) || !(total >= 0)) return { ok: false, error: `${raw.order_id}: bad quantity/price` };
  const dates = {};
  for (const k of ['delivered_at', 'paid_at', 'voided_at']) { const v = isoOrNull(raw[k]); if (v === undefined) return { ok: false, error: `${raw.order_id}: bad ${k}` }; dates[k] = v; }
  const ctype = raw.container_type ? str(raw.container_type, 40).replace(/[^A-Za-z0-9_-]/g, '') || null : null;
  const hist = Array.isArray(raw.status_history) ? raw.status_history.filter((h) => h && STATUSES.includes(h.status) && isoOrNull(h.at)).slice(0, 50).map((h) => ({ status: h.status, at: new Date(h.at).toISOString() })) : [];
  const edits = Array.isArray(raw.edits) ? raw.edits.slice(0, 100).map((e) => ({ at: isoOrNull(e?.at) || updated, changes: JSON.parse(JSON.stringify(e?.changes ?? {}).slice(0, 4000) || '{}'), reason: str(e?.reason, 200) })) : [];
  const chist = Array.isArray(raw.container_history) ? raw.container_history.slice(0, 100).filter((c) => c && Number.isInteger(c.returned) && isoOrNull(c.at)).map((c) => ({ returned: c.returned, at: new Date(c.at).toISOString() })) : [];
  return {
    ok: true,
    order: {
      order_id: raw.order_id,
      order_no: raw.order_no ? str(raw.order_no, 20) : null,
      created_at: created, updated_at: updated, ...dates,
      status: raw.status,
      fulfillment: raw.fulfillment === 'delivery' ? 'delivery' : 'walkin',
      customer_name: str(raw.customer_name, 120).trim() || 'no name',
      customer_id: isSafeId(raw.customer_id) ? raw.customer_id : null,
      is_special: !!raw.is_special,
      special_name: raw.special_name ? str(raw.special_name, 80) : null,
      quantity, unit_price: unit, total_price: total,
      rider: raw.rider ? str(raw.rider, 40).replace(/[^A-Za-z0-9_-]/g, '') || null : null,
      container_type: ctype,
      container_status: ctype && CONTAINER_STATUSES.includes(raw.container_status) ? raw.container_status : null,
      container_count: ctype ? Math.max(0, int(raw.container_count) || 0) : 0,
      container_out_count: ctype ? Math.max(0, int(raw.container_out_count) || 0) : 0,
      container_history: chist,
      payment_method: PAYMENT_METHODS.includes(raw.payment_method) ? raw.payment_method : null,
      payment_ref: raw.payment_ref ? str(raw.payment_ref, 60) : null,
      amount_tendered: Number.isInteger(raw.amount_tendered) ? raw.amount_tendered : null,
      note: str(raw.note, 300),
      custom: raw.custom && typeof raw.custom === 'object' && JSON.stringify(raw.custom).length < 5000 ? raw.custom : {},
      status_history: hist.length ? hist : [{ status: raw.status, at: updated }],
      edits
    }
  };
}

export function sanitizeExpense(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  if (!isSafeId(raw.expense_id)) return { ok: false, error: 'bad expense_id' };
  const amount = int(raw.amount);
  if (!(amount >= 0)) return { ok: false, error: `${raw.expense_id}: bad amount` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.date))) return { ok: false, error: `${raw.expense_id}: bad date` };
  const created = isoOrNull(raw.created_at) || new Date().toISOString();
  return {
    ok: true,
    expense: {
      expense_id: raw.expense_id, date: raw.date, amount,
      category: str(raw.category, 40).replace(/[^A-Za-z0-9_-]/g, '') || 'other',
      note: str(raw.note, 200),
      paid_from: raw.paid_from === 'drawer' ? 'drawer' : 'owner',
      created_at: created, updated_at: isoOrNull(raw.updated_at) || created, voided_at: isoOrNull(raw.voided_at) || null
    }
  };
}

export function sanitizeCustomer(raw) {
  if (!raw || !isSafeId(raw.customer_id)) return null;
  const created = isoOrNull(raw.created_at) || new Date().toISOString();
  return { customer_id: raw.customer_id, name: str(raw.name, 120).trim() || 'no name', phone: str(raw.phone, 40), address: str(raw.address, 200), note: str(raw.note, 300), created_at: created, updated_at: isoOrNull(raw.updated_at) || created };
}

export function sanitizeClose(raw) {
  if (!raw || !isSafeId(raw.close_id) || !/^\d{4}-\d{2}-\d{2}$/.test(String(raw.date))) return null;
  const n = (v) => (Number.isFinite(v) ? Math.round(v) : 0);
  return {
    close_id: raw.close_id, date: raw.date, closed_at: isoOrNull(raw.closed_at) || new Date().toISOString(),
    opening_float: n(raw.opening_float), cash_sales: n(raw.cash_sales), drawer_expenses: n(raw.drawer_expenses),
    expected_cash: n(raw.expected_cash), counted_cash: n(raw.counted_cash), variance: n(raw.variance), float_next: n(raw.float_next),
    revenue: n(raw.revenue), orders_paid: n(raw.orders_paid), open_orders: n(raw.open_orders), note: str(raw.note, 300),
    denominations: raw.denominations && typeof raw.denominations === 'object' ? JSON.parse(JSON.stringify(raw.denominations).slice(0, 1000) || '{}') : {}
  };
}

/* ------------------------------------------------------------------ build */

export function fileHeader(settings, exportType, now, extra = {}) {
  return {
    schema_version: SCHEMA_VERSION, export_type: exportType, exported_at: now,
    app: { name: APP_NAME, version: extra.appVersion || '3.0.0' },
    currency: 'PHP', money_unit: 'centavo', timezone: settings.timezone,
    device: settings.deviceCode,
    container_types: Object.fromEntries((settings.containerTypes || []).map((c) => [c.key, c.name])),
    riders: Object.fromEntries((settings.riders || []).map((r) => [r.key, r.name]))
  };
}

/** mode: 'incremental' (End Day) | 'full' (recovery) */
export function buildOrdersExport({ settings, orders, expenses, close = null, mode, now, appVersion }) {
  const covered = [...new Set(orders.filter((o) => o.paid_at).map((o) => dateKey(o.paid_at, settings.timezone)))].sort();
  return {
    ...fileHeader(settings, 'orders', now, { appVersion }),
    export_mode: mode,
    include_archive: mode === 'full',
    is_final: mode === 'incremental',
    closed_on: close ? close.date : null,
    covered_dates: covered,
    day_close: close,
    orders,
    expenses
  };
}

export function buildBackup({ settings, orders, expenses, customers, closes, meta, now, appVersion }) {
  const safeSettings = { ...settings, discordWebhook: '' }; // never write secrets into a file people might email
  return { ...fileHeader(settings, 'app_backup', now, { appVersion }), settings: safeSettings, meta, orders, expenses, customers, closes };
}

/* ------------------------------------------------------------------ parse */

/** Parse text from a user-chosen file. Returns { kind, orders, expenses, customers, closes, settings, errors } */
export function parseFile(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { kind: 'invalid', errors: ['This is not a valid JSON file.'] }; }
  if (!data || typeof data !== 'object' || !['orders', 'app_backup'].includes(data.export_type)) {
    return { kind: 'invalid', errors: ['This file was not made by this app.'] };
  }
  if (!(data.schema_version >= 3 && data.schema_version <= SCHEMA_VERSION)) {
    return { kind: 'invalid', errors: [`Unsupported file version (${data.schema_version}).`] };
  }
  const errors = [];
  const orders = [], expenses = [], customers = [], closes = [];
  const seen = new Set();
  for (const raw of Array.isArray(data.orders) ? data.orders : []) {
    const r = sanitizeOrder(raw);
    if (!r.ok) { errors.push(r.error); continue; }
    if (seen.has(r.order.order_id)) { errors.push(`${r.order.order_id}: duplicate in file`); continue; }
    seen.add(r.order.order_id); orders.push(r.order);
  }
  for (const raw of Array.isArray(data.expenses) ? data.expenses : []) { const r = sanitizeExpense(raw); if (r.ok) expenses.push(r.expense); else errors.push(r.error); }
  for (const raw of Array.isArray(data.customers) ? data.customers : []) { const c = sanitizeCustomer(raw); if (c) customers.push(c); }
  const rawCloses = Array.isArray(data.closes) ? data.closes : data.day_close ? [data.day_close] : [];
  for (const raw of rawCloses) { const c = sanitizeClose(raw); if (c) closes.push(c); }
  return {
    kind: data.export_type === 'app_backup' ? 'backup' : data.export_mode === 'full' ? 'full' : 'orders',
    orders, expenses, customers, closes,
    settings: data.export_type === 'app_backup' && data.settings && typeof data.settings === 'object' ? data.settings : null,
    meta: data.meta && typeof data.meta === 'object' ? data.meta : {},
    exportedAt: data.exported_at || null, device: data.device || null, errors
  };
}

/* -------------------------------------------------------------------- csv */

const guard = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; }; // spreadsheet formula injection
const cell = (v) => { const s = guard(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function salesCsv(orders, settings) {
  const tz = settings.timezone;
  const riderName = new Map((settings.riders || []).map((r) => [r.key, r.name]));
  const head = ['Date paid', 'Time paid', 'Order no', 'Customer', 'Qty', 'Unit price', 'Total', 'Payment', 'Type', 'Rider', 'Empties still out', 'Note'];
  const lines = [head.map(cell).join(',')];
  for (const o of [...orders].sort((a, b) => new Date(a.paid_at) - new Date(b.paid_at))) {
    lines.push([
      dateKey(o.paid_at, tz), prettyTime(o.paid_at, tz), o.order_no || o.order_id, o.customer_name, o.quantity,
      pesoPlain(o.unit_price), pesoPlain(o.total_price), METHOD_LABEL[o.payment_method || 'cash'],
      o.fulfillment === 'delivery' ? 'Delivery' : 'Walk-in', riderName.get(o.rider) || o.rider || '', o.container_out_count || 0, o.note
    ].map(cell).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

export function expensesCsv(expenses, settings) {
  const cats = new Map((settings.expenseCategories || []).map((c) => [c.key, c.name]));
  const lines = [['Date', 'Category', 'Amount', 'Paid from', 'Note'].map(cell).join(',')];
  for (const e of [...expenses].filter((x) => !x.voided_at).sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push([e.date, cats.get(e.category) || e.category, pesoPlain(e.amount), e.paid_from === 'drawer' ? 'Cash drawer' : 'Owner', e.note].map(cell).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

// Import / export. Everything that comes from a file is treated as untrusted and re-validated.
import { STATUSES, PAYMENT_METHODS, METHOD_LABEL, computeTotals, sumObj, STATUS_LABEL } from './orders.js';
import { EXPENSE_KINDS } from './reports.js';
import { isSafeId } from './ids.js';
import { dateKey, prettyTime } from './dates.js';
import { pesoPlain } from './money.js';

export const SCHEMA_VERSION = 5;
export const APP_NAME = 'water-station-ledger';

const isoOrNull = (v) => { if (v == null || v === '') return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); };
const str = (v, max) => String(v ?? '').slice(0, max);
const int = (v) => (Number.isInteger(v) ? v : Number.isFinite(v) ? Math.round(v) : NaN);

const key = (v, max = 40) => str(v, max).replace(/[^A-Za-z0-9_-]/g, '');
const countMap = (raw) => {
  const out = {};
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw).slice(0, 12)) { const kk = key(k); const n = int(v); if (kk && n >= 0 && n <= 99999) out[kk] = n; }
  return out;
};

/** Returns { ok:true, order } or { ok:false, error }. Unknown fields are dropped. */
export function sanitizeOrder(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  if (!isSafeId(raw.order_id)) return { ok: false, error: 'bad order_id' };
  const id = raw.order_id;
  const created = isoOrNull(raw.created_at);
  if (!created) return { ok: false, error: `${id}: bad created_at` };
  const updated = isoOrNull(raw.updated_at) || created;
  if (!STATUSES.includes(raw.status)) return { ok: false, error: `${id}: bad status` };
  const dates = {};
  for (const k of ['delivered_at', 'paid_at', 'voided_at']) { const v = isoOrNull(raw[k]); if (v === undefined) return { ok: false, error: `${id}: bad ${k}` }; dates[k] = v; }
  const deals = (Array.isArray(raw.deals) ? raw.deals : []).slice(0, 20).map((d) => ({ key: key(d?.key) || 'deal', name: str(d?.name, 60) || 'Special', containers: int(d?.containers), total: int(d?.total), count: int(d?.count) }));
  if (deals.some((d) => !(d.containers >= 1) || !(d.total >= 0) || !(d.count >= 1))) return { ok: false, error: `${id}: bad deal` };
  const regular = int(raw.regular_qty ?? 0), unit = int(raw.unit_price), total = int(raw.total_price);
  if (!(regular >= 0) || !(unit >= 0) || !(total >= 0)) return { ok: false, error: `${id}: bad quantity/price` };
  const t = computeTotals({ deals, regular_qty: regular, unit_price: unit });
  const quantity = int(raw.quantity);
  if (quantity !== t.quantity || !(quantity >= 1)) return { ok: false, error: `${id}: quantity does not match its lines` };
  const containers = countMap(raw.containers);
  if (sumObj(containers) !== quantity) return { ok: false, error: `${id}: container types do not add up` };
  const hist = Array.isArray(raw.status_history) ? raw.status_history.filter((h) => h && STATUSES.includes(h.status) && isoOrNull(h.at)).slice(0, 50).map((h) => ({ status: h.status, at: new Date(h.at).toISOString() })) : [];
  const edits = Array.isArray(raw.edits) ? raw.edits.slice(0, 100).map((e) => ({ at: isoOrNull(e?.at) || updated, changes: JSON.parse(JSON.stringify(e?.changes ?? {}).slice(0, 4000) || '{}'), reason: str(e?.reason, 200) })) : [];
  const eh = Array.isArray(raw.empties_history) ? raw.empties_history.slice(0, 100).filter((c) => c && isoOrNull(c.at)).map((c) => ({ returned: countMap(c.returned), at: new Date(c.at).toISOString() })) : [];
  const fulfillment = raw.fulfillment === 'delivery' ? 'delivery' : 'pickup';
  return {
    ok: true,
    order: {
      order_id: id, order_no: raw.order_no ? str(raw.order_no, 20) : null,
      created_at: created, updated_at: updated, ...dates,
      status: raw.status, fulfillment, priority: !!raw.priority,
      customer_name: str(raw.customer_name, 120).trim() || 'no name',
      customer_id: isSafeId(raw.customer_id) ? raw.customer_id : null,
      staff: raw.staff ? key(raw.staff) || null : null,
      deals, regular_qty: regular, unit_price: unit, price_label: raw.price_label ? str(raw.price_label, 40) : null, quantity, total_price: total,
      containers, empties_owed: fulfillment === 'delivery' ? countMap(raw.empties_owed) : {},
      empties_short: Math.max(0, int(raw.empties_short) || 0), empties_history: eh,
      incentive_rate: Math.max(0, int(raw.incentive_rate) || 0),
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
  const kind = EXPENSE_KINDS.includes(raw.kind) ? raw.kind : 'expense';
  return {
    ok: true,
    expense: {
      expense_id: raw.expense_id, kind, date: raw.date, amount,
      category: key(raw.category) || 'other', staff: raw.staff ? key(raw.staff) || null : null,
      note: str(raw.note, 200), paid_from: ['drawer', 'salary'].includes(raw.paid_from) ? raw.paid_from : 'owner',
      created_at: created, updated_at: isoOrNull(raw.updated_at) || created, voided_at: isoOrNull(raw.voided_at) || null
    }
  };
}

export function sanitizeCustomer(raw) {
  if (!raw || !isSafeId(raw.customer_id)) return null;
  const created = isoOrNull(raw.created_at) || new Date().toISOString();
  return { customer_id: raw.customer_id, name: str(raw.name, 120).trim() || 'no name', phone: str(raw.phone, 40), address: str(raw.address, 200), note: str(raw.note, 300), lat: Number.isFinite(raw.lat) ? raw.lat : null, lng: Number.isFinite(raw.lng) ? raw.lng : null, created_at: created, updated_at: isoOrNull(raw.updated_at) || created };
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
    staff: Object.fromEntries((settings.staff || []).map((r) => [r.key, r.name]))
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
  if (data.schema_version !== SCHEMA_VERSION) {
    return { kind: 'invalid', errors: [`This file is version ${data.schema_version}; this app reads version ${SCHEMA_VERSION}.`] };
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

export function ordersCsv(orders, settings) {
  const tz = settings.timezone;
  const staff = new Map((settings.staff || []).map((r) => [r.key, r.name]));
  const types = settings.containerTypes || [];
  const head = ['Date taken', 'Time', 'No.', 'Customer', 'Type', 'Handled by', 'Containers', ...types.map((t) => t.name), 'Total (PHP)', 'Payment', 'Status', 'Date paid', 'Empties still out', 'Note'];
  const lines = [head.map(cell).join(',')];
  for (const o of [...orders].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))) {
    lines.push([
      dateKey(o.created_at, tz), prettyTime(o.created_at, tz), o.order_no || o.order_id, o.customer_name, o.fulfillment === 'delivery' ? 'Delivery' : 'Pick-up',
      staff.get(o.staff) || o.staff || '', o.quantity, ...types.map((t) => o.containers?.[t.key] || 0), pesoPlain(o.total_price),
      o.payment_method ? METHOD_LABEL[o.payment_method] : '', o.voided_at ? 'Voided' : STATUS_LABEL[o.status], o.paid_at ? dateKey(o.paid_at, tz) : '', sumObj(o.empties_owed), o.note
    ].map(cell).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

export function expensesCsv(expenses, settings) {
  const cats = new Map((settings.expenseCategories || []).map((c) => [c.key, c.name]));
  const staff = new Map((settings.staff || []).map((r) => [r.key, r.name]));
  const KIND = { expense: 'Expense', incentive_payout: 'Incentive payout', advance: 'Advance', advance_repayment: 'Advance repaid' };
  const lines = [['Date', 'Type', 'Category', 'Staff', 'Amount (PHP)', 'From', 'Note'].map(cell).join(',')];
  for (const e of [...expenses].filter((x) => !x.voided_at).sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push([e.date, KIND[e.kind || 'expense'], cats.get(e.category) || e.category, staff.get(e.staff) || '', pesoPlain(e.amount), { drawer: 'Cash drawer', owner: 'Owner', salary: 'Salary' }[e.paid_from] || '', e.note].map(cell).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

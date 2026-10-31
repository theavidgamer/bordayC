// In-memory state backed by IndexedDB. Memory is only updated AFTER the database confirms the write,
// so what is on screen is always what is saved.
import * as db from './db.js';
import { dateKey } from '../core/dates.js';
import { sanitizeDeviceCode } from '../core/ids.js';

export const APP_VERSION = '4.3.0';

export const DEFAULT_SETTINGS = Object.freeze({
  stationName: 'Water Station',
  timezone: 'Asia/Manila',
  deviceCode: 'D',
  deviceName: '',
  pricePickup: 2000,
  priceDelivery: 2500,
  specials: [],            // [{key, name, containers(=quantity per deal), total}]  e.g. name "11 @ 200": 11 quantity for ₱200
  pricePresets: [{ key: 'family', name: 'Family', price: 1800 }], // alternative price per quantity, shown at the Counter for pick-up and delivery
  staff: [{ key: 'staff_a', name: 'Staff A', active: true }, { key: 'staff_b', name: 'Staff B', active: true }],
  containerTypes: [{ key: 'bilog', name: 'Bilog', short: 'R', icon: '⭕' }, { key: 'faucet', name: 'Faucet', short: 'S', icon: '⬛' }],
  defaultContainerType: 'bilog',
  incentive: { pickup: 0, delivery: 0 },   // centavos per container, owner sets
  timers: { waitingWarn: 5, waitingLate: 10, preparingWarn: 10, preparingLate: 20, outWarn: 20, outLate: 40, unpaidWarnHours: 24, unpaidLateHours: 72 },
  expenseCategories: [
    { key: 'refill_source', name: 'Water / refill source' }, { key: 'supplies', name: 'Supplies & food' }, { key: 'load', name: 'Load / phone' },
    { key: 'electricity', name: 'Electricity' }, { key: 'fuel', name: 'Fuel / transport' }, { key: 'repairs', name: 'Repairs' }, { key: 'other', name: 'Other' }
  ],
  stationLat: null, stationLng: null, // where the station is (set on the map in Settings)
  speedKmh: 20, detour: 1.4,         // for travel-time estimates: average speed, and road distance ÷ straight-line distance
  dailyGoal: 0,
  acceptOtherPayments: false,
  openingFloat: 0,
  textScale: 1,
  booksPin: null,
  riderPayLocked: false,
  discordWebhook: '',
  onboarded: false
});

export const state = {
  ready: false,
  orders: new Map(), expenses: new Map(), customers: new Map(), closes: new Map(),
  settings: { ...DEFAULT_SETTINGS }, meta: {}
};

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

let channel = null;
function ping() { try { channel?.postMessage({ t: Date.now() }); } catch { /* ignore */ } }

/** Default name of a deal, e.g. "11 @ 200" (quantity @ total pesos). */
export const dealName = (containers, totalCentavos) => `${containers} @ ${totalCentavos % 100 ? (totalCentavos / 100).toFixed(2) : totalCentavos / 100}`;
/** Older saved settings used `qty` instead of `containers`, and some had no name. Repair them instead of breaking the Counter. */
export function cleanSpecials(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const d of list) {
    const containers = Math.round(Number(d?.containers ?? d?.qty));
    const total = Math.round(Number(d?.total));
    if (!(containers >= 1) || !(total >= 0)) continue;
    out.push({ key: String(d.key || `deal_${containers}_${total}`), name: String(d.name || '').trim() || dealName(containers, total), containers, total });
  }
  return out;
}
function cleanPresets(list) {
  if (!Array.isArray(list)) return DEFAULT_SETTINGS.pricePresets.map((x) => ({ ...x }));
  return list.map((p) => ({ key: String(p?.key || ''), name: String(p?.name || '').trim(), price: Math.round(Number(p?.price)) })).filter((p) => p.key && p.name && p.price >= 0);
}

function mergeSettings(saved) {
  const base = { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
  base.incentive = { ...DEFAULT_SETTINGS.incentive, ...(base.incentive || {}) };
  base.timers = { ...DEFAULT_SETTINGS.timers, ...(base.timers || {}) };
  base.specials = cleanSpecials(base.specials);
  base.pricePresets = cleanPresets(base.pricePresets);
  return base;
}

async function loadAll() {
  const [orders, expenses, customers, closes, meta] = await Promise.all(['orders', 'expenses', 'customers', 'closes', 'meta'].map(db.getAll));
  state.orders = new Map(orders.map((o) => [o.order_id, o]));
  state.expenses = new Map(expenses.map((o) => [o.expense_id, o]));
  state.customers = new Map(customers.map((o) => [o.customer_id, o]));
  state.closes = new Map(closes.map((o) => [o.close_id, o]));
  state.meta = Object.fromEntries(meta.map((m) => [m.key, m.value]));
  const saved = state.meta.settings;
  state.settings = mergeSettings(saved);
  state.settings.deviceCode = sanitizeDeviceCode(state.settings.deviceCode);
}

export async function init() {
  await loadAll();
  state.ready = true;
  try {
    channel = new BroadcastChannel('water-station-ledger');
    channel.onmessage = async () => { await loadAll(); notify(); };
  } catch { /* BroadcastChannel not available: fine */ }
  try { await navigator.storage?.persist?.(); } catch { /* optional */ }
  await dailySnapshot();
  notify();
}

/** One call = one atomic transaction across stores. Memory changes only after success. */
export async function save({ orders = [], expenses = [], customers = [], closes = [], meta = {}, settings = null, deleteCustomers = [] } = {}) {
  const metaRows = Object.entries(meta).map(([key, value]) => ({ key, value }));
  let nextSettings = null;
  if (settings) { nextSettings = mergeSettings({ ...state.settings, ...settings }); metaRows.push({ key: 'settings', value: nextSettings }); }
  await db.commit({ orders, expenses, customers, closes, meta: metaRows, deleteKeys: deleteCustomers.length ? { customers: deleteCustomers } : undefined });
  for (const id of deleteCustomers) state.customers.delete(id);
  for (const o of orders) state.orders.set(o.order_id, o);
  for (const e of expenses) state.expenses.set(e.expense_id, e);
  for (const c of customers) state.customers.set(c.customer_id, c);
  for (const z of closes) state.closes.set(z.close_id, z);
  for (const [k, v] of Object.entries(meta)) state.meta[k] = v;
  if (nextSettings) state.settings = nextSettings;
  notify();
  ping();
}

/** Business date (YYYY-MM-DD) right now. */
export const today = () => dateKey(Date.now(), state.settings.timezone);

export function nextOrderNo() {
  const day = today();
  const seq = (state.meta[`seq:${day}`] || 0) + 1;
  return { seq, day, orderNo: `${state.settings.deviceCode}${String(seq).padStart(3, '0')}` };
}

/* ------------------------------------------------------------ snapshots */

export function snapshotPayload() {
  return {
    taken_at: new Date().toISOString(),
    orders: [...state.orders.values()], expenses: [...state.expenses.values()],
    customers: [...state.customers.values()], closes: [...state.closes.values()],
    settings: { ...state.settings, discordWebhook: '' }
  };
}

/** Keeps the last 7 daily copies inside the app. Not a substitute for a file backup, but saves you from "oops". */
export async function dailySnapshot(force = false, label = null) {
  const day = label || today();
  if (!force && state.meta.lastSnapshotDay === day) return;
  if (!state.orders.size && !state.expenses.size) return;
  const snap = { date: label ? `${day}` : day, ...snapshotPayload() };
  await db.commit({ snapshots: [snap], meta: [{ key: 'lastSnapshotDay', value: day }] });
  state.meta.lastSnapshotDay = day;
  const all = (await db.getAll('snapshots')).map((s) => s.date).sort();
  const daily = all.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, -7);
  const labelled = all.filter((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d)).sort((a, b) => (a.match(/\d+$/)?.[0] || 0) - (b.match(/\d+$/)?.[0] || 0)).slice(0, -5);
  const old = [...daily, ...labelled];
  if (old.length) await db.commit({ deleteKeys: { snapshots: old } });
}
export const listSnapshots = async () => (await db.getAll('snapshots')).sort((a, b) => b.date.localeCompare(a.date));

/** Replace everything (restore). A safety snapshot is taken first. */
export async function replaceEverything({ orders, expenses, customers, closes, settings, meta }) {
  await dailySnapshot(true, `before-restore-${Date.now()}`);
  const metaRows = Object.entries(meta || {}).filter(([k]) => k !== 'settings').map(([key, value]) => ({ key, value }));
  metaRows.push({ key: 'settings', value: { ...DEFAULT_SETTINGS, ...(settings || state.settings), discordWebhook: state.settings.discordWebhook } });
  await db.replaceAll({ orders, expenses, customers, closes, meta: metaRows });
  await loadAll();
  notify(); ping();
}

export async function eraseEverything() {
  await dailySnapshot(true, `before-erase-${Date.now()}`);
  await db.clearAll(['snapshots']);
  await loadAll();
  notify(); ping();
}

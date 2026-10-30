import { h, clear } from './ui/dom.js';
import { toast, openModal, choice, field } from './ui/components.js';
import * as S from './data/store.js';
import { renderCounter } from './ui/counter.js';
import { renderOrders, setOrdersDay } from './ui/orders.js';
import { renderCustomers } from './ui/customers.js';
import { renderExpenses } from './ui/expenses.js';
import { renderBooks } from './ui/books.js';
import { renderInsights } from './ui/insights.js';
import { renderSettings } from './ui/settings.js';
import { unclosedDays, openEndDay } from './ui/endday.js';
import { hooks } from './ui/bus.js';
import { isUnlocked, hasPin, pinCard, touch } from './ui/lock.js';
import * as O from './core/orders.js';
import { prettyDate, shortDate } from './core/dates.js';
import { toCentavos, pesoInput } from './core/money.js';
import { sanitizeDeviceCode } from './core/ids.js';

let current = 'orders';
let lastSettingsRef = null;
const els = {};

const TABS = [
  { id: 'counter', label: 'Counter', ico: '➕' }, { id: 'orders', label: 'Orders', ico: '📋' }, { id: 'customers', label: 'Customers', ico: '👥' },
  { id: 'expenses', label: 'Expenses', ico: '🧾' }, { id: 'books', label: 'Books', ico: '📖' }
];

function buildShell() {
  const app = document.getElementById('app');
  clear(app);
  els.brand = h('span', { class: 'brand' });
  els.dev = h('span', { class: 'dev' });
  els.date = h('span', { class: 'date' });
  els.settingsBtn = h('button', { class: 'btn small settings-btn', type: 'button', onclick: () => go('settings') }, '⚙️ Settings');
  els.banner = h('div', { class: 'banner', hidden: true });
  els.main = h('main', { id: 'main', tabIndex: -1 });
  els.nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, TABS.map((t) => h('button', { type: 'button', dataset: { tab: t.id }, onclick: () => go(t.id) }, h('span', { class: 'ico', 'aria-hidden': 'true' }, t.ico), t.label)));
  app.append(h('header', { class: 'topbar' }, els.brand, els.dev, els.date, els.settingsBtn), els.banner, els.nav, els.main);
}

export function go(tab) {
  current = tab;
  window.scrollTo(0, 0);
  render();
}
hooks.goTo = go;

function paintChrome() {
  const s = S.state.settings;
  els.brand.textContent = `💧 ${s.stationName}`;
  els.dev.textContent = s.deviceName || s.deviceCode;
  els.date.textContent = prettyDate(S.today());
  els.settingsBtn.setAttribute('aria-current', current === 'settings' ? 'page' : 'false');
  document.documentElement.style.setProperty('--scale', String(s.textScale || 1));
  const open = [...S.state.orders.values()].filter(O.isUnfinished).length;
  for (const b of els.nav.children) {
    const on = b.dataset.tab === current;
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    b.querySelector('.count')?.remove();
    if (b.dataset.tab === 'orders' && open) b.append(h('span', { class: 'count', 'aria-label': `${open} open orders` }, String(open)));
  }
}

function render() {
  if (!S.state.ready) return;
  paintChrome();
  const root = els.main;
  if (current === 'counter') return renderCounter(root); // the Counter clears itself so its draft survives
  clear(root);
  if (current === 'orders') { staleBanner(root); renderOrders(root); }
  else if (current === 'customers') renderCustomers(root);
  else if (current === 'expenses') renderExpenses(root);
  else if (current === 'settings') renderSettings(root);
  else if (current === 'books') {
    if (hasPin() && !isUnlocked()) root.append(pinCard('Books are locked', render));
    else { touch(); renderBooks(root, { renderInsights }); }
  }
}

function staleBanner(root) {
  const stale = unclosedDays();
  if (!stale.length) return;
  root.append(h('div', { class: 'insight warn', style: { marginBottom: '.9rem' } }, h('div', { class: 't' }, `${stale.length === 1 ? shortDate(stale[0]) : stale.length + ' earlier days'} not closed yet`),
    h('p', { class: 'hint' }, 'Close each day so the cash count and file are saved.'), h('button', { class: 'btn small', onclick: () => { setOrdersDay(stale[0]); openEndDay(stale[0]); } }, `Close ${shortDate(stale[0])}`)));
}

/* -------------------------------------------------------------- onboarding */
function onboarding() {
  const s = S.state.settings;
  const name = h('input', { type: 'text', value: s.stationName === 'Water Station' ? '' : s.stationName, maxLength: 60, placeholder: 'e.g. Aqua Fresh Refilling' });
  const pick = h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(s.pricePickup) });
  const del = h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(s.priceDelivery) });
  const dev = choice({ label: 'This device is', value: 'T', options: [{ value: 'T', label: '📱 Tablet (main)' }, { value: 'P', label: '📱 Phone' }, { value: 'X', label: 'Other' }] });
  openModal({
    title: 'Welcome! Quick setup', wide: false,
    body: h('div', null, h('p', null, 'A few questions, then you can start taking orders. You can change all of this later in ⚙️ Settings.'), field('Shop name', name), field('Pick-up price per container (₱)', pick), field('Delivery price per container (₱)', del),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'This device is'), dev.el), h('p', { class: 'hint' }, 'Each device keeps its own records. The device type makes order numbers different on each device.')),
    actions: [{ label: 'Start', kind: 'primary', onClick: async ({ setError }) => {
      const a = toCentavos(pick.value), b = toCentavos(del.value);
      if (Number.isNaN(a) || a <= 0 || Number.isNaN(b) || b <= 0) { setError('Enter both prices.'); return false; }
      const v = dev.get() || 'T';
      await S.save({ settings: { stationName: name.value.trim() || 'Water Station', pricePickup: a, priceDelivery: b, deviceCode: sanitizeDeviceCode(v), deviceName: { T: 'Tablet', P: 'Phone', X: 'Device' }[v], onboarded: true } });
      go('counter');
    } }]
  });
}

/* ------------------------------------------------------- service worker */
function registerSW() {
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost')) return;
  navigator.serviceWorker.register('./service-worker.js').then((reg) => {
    const offer = (worker) => {
      els.banner.hidden = false; clear(els.banner);
      els.banner.append(h('span', null, '✨ A new version is ready.'), h('button', { class: 'btn small', onclick: () => worker.postMessage('SKIP_WAITING') }, 'Update now'));
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {});
  // Reload only when an OLD version is being replaced (the person tapped "Update now"), never on the very first install.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController || reloading) return; reloading = true; location.reload(); });
}

/* -------------------------------------------------------------------- boot */
async function boot() {
  const app = document.getElementById('app');
  window.addEventListener('error', (e) => toast(`Something went wrong: ${e.message}`, { kind: 'error', ms: 8000 }));
  window.addEventListener('unhandledrejection', (e) => toast(`Could not finish: ${e.reason?.message || e.reason}`, { kind: 'error', ms: 8000 }));
  try { await S.init(); }
  catch (e) {
    clear(app);
    app.append(h('div', { class: 'boot' }, h('div', null, h('h1', null, 'Cannot open storage'), h('p', null, e.message), h('p', { class: 'hint' }, 'If you are in a private/incognito window, open the app in a normal window. Otherwise close other tabs of this app and reload.'))));
    return;
  }
  buildShell();
  lastSettingsRef = S.state.settings;
  current = 'orders';
  S.subscribe(() => {
    const settingsChanged = lastSettingsRef !== S.state.settings;
    lastSettingsRef = S.state.settings;
    if (current === 'counter' && !settingsChanged) { paintChrome(); return; } // don't disturb an order being typed
    render();
  });
  render();
  if (!S.state.settings.onboarded) onboarding();
  registerSW();
  setInterval(() => { if (current === 'orders') render(); }, 60000); // keep "35 min ago" fresh
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { paintChrome(); if (current !== 'counter') render(); } });
}
boot();

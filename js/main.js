import { h, clear } from './ui/dom.js';
import { toast, openModal, choice, field, hideToast } from './ui/components.js';
import * as S from './data/store.js';
import { verifyPin } from './core/pin.js';
import { renderCounter } from './ui/counter.js';
import { renderBoard, boardOrders } from './ui/board.js';
import { renderToday } from './ui/today.js';
import { renderOverview, renderSales, renderExpenses, getBooksTab, setBooksTab } from './ui/books.js';
import { renderInsights } from './ui/insights.js';
import { renderMore } from './ui/settings.js';
import { prettyDate } from './core/dates.js';
import { toCentavos, pesoInput } from './core/money.js';
import { sanitizeDeviceCode } from './core/ids.js';

let current = 'home';
let unlockedAt = 0;
let lastSettingsRef = null;
let failures = 0, lockedUntil = 0;
const UNLOCK_MS = 10 * 60 * 1000;
const els = {};

const TABS = [
  { id: 'home', label: 'Home', ico: '🏠' }, { id: 'counter', label: 'Counter', ico: '➕' },
  { id: 'board', label: 'Board', ico: '📋' }, { id: 'books', label: 'Books', ico: '📊' }, { id: 'more', label: 'More', ico: '⚙️' }
];

function buildShell() {
  const app = document.getElementById('app');
  clear(app);
  els.brand = h('span', { class: 'brand' });
  els.dev = h('span', { class: 'dev' });
  els.date = h('span', { class: 'date' });
  els.banner = h('div', { class: 'banner', hidden: true });
  els.main = h('main', { id: 'main', tabIndex: -1 });
  els.nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, TABS.map((t) => h('button', { type: 'button', dataset: { tab: t.id }, onclick: () => go(t.id) }, h('span', { class: 'ico', 'aria-hidden': 'true' }, t.ico), t.label)));
  app.append(h('header', { class: 'topbar' }, els.brand, els.dev, els.date), els.banner, els.nav, els.main);
}

export function go(tab) {
  current = tab;
  window.scrollTo(0, 0);
  render();
}

function paintChrome() {
  const s = S.state.settings;
  els.brand.textContent = `💧 ${s.stationName}`;
  els.dev.textContent = s.deviceName || s.deviceCode;
  els.date.textContent = prettyDate(S.today());
  document.documentElement.style.setProperty('--scale', String(s.textScale || 1));
  const open = boardOrders().length;
  for (const b of els.nav.children) {
    const on = b.dataset.tab === current;
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    b.querySelector('.count')?.remove();
    if (b.dataset.tab === 'board' && open) b.append(h('span', { class: 'count', 'aria-label': `${open} open orders` }, String(open)));
  }
}

const booksLocked = () => !!S.state.settings.booksPin && Date.now() - unlockedAt > UNLOCK_MS;
export function lockBooks() { unlockedAt = 0; if (current === 'books') render(); toast('Books locked'); }

function render() {
  if (!S.state.ready) return;
  paintChrome();
  const root = els.main;
  if (current === 'counter') return renderCounter(clearKeep(root));
  clear(root);
  if (current === 'home') renderToday(root, { goTo: go });
  else if (current === 'board') renderBoard(root);
  else if (current === 'more') renderMore(root, { lockBooks });
  else if (current === 'books') renderBooks(root);
}
const clearKeep = (el) => el; // the Counter clears itself so its draft survives re-renders

function renderBooks(root) {
  if (booksLocked()) return renderPin(root);
  if (S.state.settings.booksPin) unlockedAt = Date.now();
  const tabs = [['overview', 'Overview'], ['sales', 'Sales'], ['expenses', 'Expenses'], ['insights', 'Insights']];
  const t = getBooksTab();
  const bar = choice({ label: 'Books section', value: t, options: tabs.map(([value, label]) => ({ value, label })), onChange: (v) => { if (v) { setBooksTab(v); render(); } } });
  bar.el.classList.add('tabs');
  const body = h('div', null);
  root.append(h('div', { class: 'page-title' }, h('h1', null, 'Books')), bar.el, body);
  ({ overview: renderOverview, sales: renderSales, expenses: renderExpenses, insights: renderInsights }[t] || renderOverview)(body);
}

function renderPin(root) {
  let pin = '';
  const dots = h('div', { class: 'pin-dots', 'aria-live': 'polite' }, '');
  const msg = h('p', { class: 'form-error', role: 'alert' });
  const paint = () => { dots.textContent = '●'.repeat(pin.length) || ' '; };
  const submit = async () => {
    if (Date.now() < lockedUntil) { msg.textContent = `Too many tries. Wait ${Math.ceil((lockedUntil - Date.now()) / 1000)} seconds.`; return; }
    if (await verifyPin(pin, S.state.settings.booksPin)) { failures = 0; unlockedAt = Date.now(); render(); return; }
    failures++; pin = ''; paint();
    if (failures >= 5) { lockedUntil = Date.now() + 30000; failures = 0; msg.textContent = 'Too many wrong tries. Wait 30 seconds.'; } else msg.textContent = 'Wrong PIN. Try again.';
  };
  const key = (d) => h('button', { class: 'btn', type: 'button', onclick: () => { if (pin.length < 8) { pin += d; paint(); } } }, d);
  root.append(h('div', { class: 'card', style: { maxWidth: '380px', margin: '2rem auto' } }, h('h2', { style: { textAlign: 'center' } }, '🔒 Books are locked'), h('p', { class: 'hint', style: { textAlign: 'center' } }, 'Enter your PIN'), dots, msg,
    h('div', { class: 'keypad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key), h('button', { class: 'btn', type: 'button', onclick: () => { pin = pin.slice(0, -1); paint(); }, 'aria-label': 'Delete' }, '⌫'), key('0'), h('button', { class: 'btn primary', type: 'button', onclick: submit }, 'OK'))));
  paint();
}

/* -------------------------------------------------------------- onboarding */
function onboarding() {
  const s = S.state.settings;
  const name = h('input', { type: 'text', value: s.stationName === 'Water Station' ? '' : s.stationName, maxLength: 60, placeholder: 'e.g. Aqua Fresh Refilling' });
  const price = h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(s.unitPrice) });
  const dev = choice({ label: 'This device is', value: 'T', options: [{ value: 'T', label: '📱 Tablet (main)' }, { value: 'P', label: '📱 Phone' }, { value: 'X', label: 'Other' }] });
  openModal({
    title: 'Welcome! Quick setup', wide: false,
    body: h('div', null, h('p', null, 'Three questions, then you can start taking orders. You can change all of this later in More.'), field('Shop name', name), field('Price per container (₱)', price),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'This device is'), dev.el), h('p', { class: 'hint' }, 'Each device keeps its own records. The device type makes order numbers different on each (T001 on the tablet, P001 on the phone).')),
    actions: [{ label: 'Start', kind: 'primary', onClick: async ({ setError }) => {
      const p = toCentavos(price.value);
      if (Number.isNaN(p) || p <= 0) { setError('Enter the price per container.'); return false; }
      const v = dev.get() || 'T';
      await S.save({ settings: { stationName: name.value.trim() || 'Water Station', unitPrice: p, deviceCode: sanitizeDeviceCode(v), deviceName: { T: 'Tablet', P: 'Phone', X: 'Device' }[v], onboarded: true } });
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
  const today = S.today();
  current = S.state.meta.lastHomeDay === today ? 'counter' : 'home';
  if (S.state.meta.lastHomeDay !== today) S.save({ meta: { lastHomeDay: today } }).catch(() => {});
  S.subscribe(() => {
    const settingsChanged = lastSettingsRef !== S.state.settings;
    lastSettingsRef = S.state.settings;
    if (current === 'counter' && !settingsChanged) { paintChrome(); return; } // don't disturb an order being typed
    render();
  });
  render();
  if (!S.state.settings.onboarded) onboarding();
  registerSW();
  setInterval(() => { if (current === 'board' || current === 'home') render(); }, 60000); // keep "35 min ago" fresh
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { paintChrome(); if (current !== 'counter') render(); } });
}
boot();

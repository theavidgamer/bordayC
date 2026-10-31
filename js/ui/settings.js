// Settings: prices, deals, staff, timers, backup, backup / restore, import (merge devices), safety tools.
import { h, clear } from './dom.js';
import { toast, openModal, confirmModal, choice, field, stepper } from './components.js';
import * as S from '../data/store.js';
import { dealName } from '../data/store.js';
import * as X from '../core/exchange.js';
import * as O from '../core/orders.js';
import { newSalt, hashPin } from '../core/pin.js';
import { sanitizeDeviceCode } from '../core/ids.js';
import { peso, toCentavos, pesoInput } from '../core/money.js';
import { lockNow } from './lock.js';
import { openPinPicker, stationPoint } from './map.js';
import { openRoadEditor } from './roadedit.js';
import { fmtKm } from '../core/geo.js';
import { deliverFile, readTextFile, isDiscordWebhook, postToDiscord } from './files.js';

const slug = (name) => `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'item'}_${Math.random().toString(36).slice(2, 6)}`;
const saveSettings = async (patch, msg = 'Saved') => { try { await S.save({ settings: patch }); toast(msg, { kind: 'ok', ms: 2000 }); } catch (e) { toast(e.message, { kind: 'error' }); } };

export function renderSettings(root) {
  clear(root);
  const s = S.state.settings;
  root.append(h('div', { class: 'page-title' }, h('h1', null, '⚙️ Settings'), h('span', { class: 'muted' }, `v${S.APP_VERSION} · ${s.stationName}`)));
  const stack = h('div', { class: 'stack' });
  const money = (v, ph = '0') => h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(v), placeholder: ph });
  const bad = (m) => toast(m, { kind: 'error' });

  /* -------- prices */
  const pPick = money(s.pricePickup), pDel = money(s.priceDelivery), goal = money(s.dailyGoal, '0 = no goal');
  stack.append(h('div', { class: 'card' }, h('h2', null, '💧 Prices'), h('p', { class: 'hint' }, 'Price for ONE quantity (one refill).'),
    field('Pick-up price (₱)', pPick), field('Delivery price (₱)', pDel), field('Daily sales goal (₱, optional)', goal),
    h('div', { style: { marginTop: '.8rem' } }, h('button', { class: 'btn primary', onclick: async () => {
      const a = toCentavos(pPick.value), b = toCentavos(pDel.value), g = toCentavos(goal.value || '0');
      if ([a, b, g].some((x) => Number.isNaN(x) || x < 0)) return bad('One of the prices is not valid');
      await saveSettings({ pricePickup: a, priceDelivery: b, dailyGoal: g }, 'Prices saved');
    } }, 'Save prices'))));

  /* -------- special deals */
  stack.append(listCard('⭐ Special deals', 'A fixed price for a set quantity, e.g. 11 for ₱200 (named “11 @ 200” automatically). The Counter locks the price when a deal is used.', s.specials, (x) => `${x.name} · quantity ${x.containers} for ${peso(x.total)}`, async (list) => saveSettings({ specials: list }), () => addSpecial()));

  stack.append(listCard('🏷 Price presets', 'Other prices the Counter can pick quickly for both pick-up and delivery, e.g. Family ₱18. “Regular” is the price set above.', s.pricePresets, (x) => `${x.name} · ${peso(x.price)} each`, async (list) => saveSettings({ pricePresets: list }), () => addPreset()));

  /* -------- staff + incentive */
  stack.append(namedListCard('👥 Staff', s.staff, 'staff', true));
  const iPick = money(s.incentive.pickup), iDel = money(s.incentive.delivery);
  stack.append(h('div', { class: 'card' }, h('h2', null, '🎁 Incentive per quantity'), h('p', { class: 'hint' }, 'Paid to the staff who handled the order, once it is served. ₱0 means no incentive. Changes apply to NEW orders only.'),
    field('Pick-up (₱ per quantity)', iPick), field('Delivery (₱ per quantity)', iDel),
    h('div', { style: { marginTop: '.8rem' } }, h('button', { class: 'btn primary', onclick: async () => {
      const a = toCentavos(iPick.value || '0'), b = toCentavos(iDel.value || '0');
      if ([a, b].some((x) => Number.isNaN(x) || x < 0)) return bad('Not a valid amount');
      await saveSettings({ incentive: { pickup: a, delivery: b } }, 'Incentive saved');
    } }, 'Save incentive'))));

  /* -------- timers */
  const T = s.timers;
  const tw = (label, key, max, unit) => ({ key, label, unit, st: stepper({ value: T[key], min: 1, max, size: 'sm', label }) });
  const rows = [['Waiting (not started)', tw('Amber after', 'waitingWarn', 240, 'min'), tw('Red after', 'waitingLate', 240, 'min')], ['Preparing', tw('Amber after', 'preparingWarn', 240, 'min'), tw('Red after', 'preparingLate', 240, 'min')],
    ['Rider out', tw('Amber after', 'outWarn', 480, 'min'), tw('Red after', 'outLate', 480, 'min')], ['Unpaid (utang)', tw('Amber after', 'unpaidWarnHours', 999, 'hours'), tw('Red after', 'unpaidLateHours', 999, 'hours')]];
  stack.append(h('div', { class: 'card' }, h('h2', null, '⏱ Timers'), h('p', { class: 'hint' }, 'When an order stays too long in a stage, its time turns amber, then red.'),
    ...rows.map(([name, a, b]) => h('div', { class: 'field' }, h('span', { class: 'label' }, name), h('div', { class: 'row' }, h('span', null, `Amber after (${a.unit})`), a.st.el, h('span', null, `Red after (${b.unit})`), b.st.el))),
    h('div', { style: { marginTop: '.8rem' } }, h('button', { class: 'btn primary', onclick: async () => {
      const t = {}; for (const [, a, b] of rows) { t[a.key] = a.st.get(); t[b.key] = b.st.get(); }
      for (const [, a, b] of rows) if (t[b.key] < t[a.key]) return bad('“Red” must be later than “Amber”.');
      await saveSettings({ timers: t }, 'Timers saved');
    } }, 'Save timers'))));

  /* -------- map */
  const sp = stationPoint();
  const speed = stepper({ value: s.speedKmh || 20, min: 5, max: 80, size: 'sm', label: 'Average speed km/h' });
  const detour = choice({ label: 'Roads', value: String(s.detour || 1.4), options: [{ value: '1.2', label: 'Straight' }, { value: '1.4', label: 'Normal' }, { value: '1.7', label: 'Winding' }] });
  stack.append(h('div', { class: 'card' }, h('h2', null, '🗺 Map'), h('p', { class: 'hint' }, 'Deliveries are measured from the station along the roads in the app’s map (works offline). Where a road is missing, draw it below.'),
    h('p', null, sp ? `📍 Station saved (${sp.lat.toFixed(4)}, ${sp.lng.toFixed(4)})` : '⚠️ Station location not set yet.'),
    h('button', { class: 'btn', onclick: () => openPinPicker({ title: 'Where is the station?', start: sp, onSave: async (lat, lng) => { await saveSettings({ stationLat: lat, stationLng: lng }, 'Station location saved'); } }) }, sp ? 'Move the station pin' : '📍 Set the station location'),
    h('button', { class: 'btn', style: { marginLeft: '.5rem' }, onclick: openRoadEditor }, '✏️ Draw a missing road'),
    h('div', { class: 'field', style: { marginTop: '.8rem' } }, h('span', { class: 'label' }, 'Average riding / driving speed (km/h)'), speed.el),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Off-road leftovers (where no road is mapped): how winding?'), detour.el),
    h('div', { style: { marginTop: '.8rem' } }, h('button', { class: 'btn primary', onclick: () => saveSettings({ speedKmh: speed.get(), detour: Number(detour.get() || 1.4) }, 'Map settings saved') }, 'Save map settings'))));

  /* -------- containers + categories */
  stack.append(namedListCard('🫙 Container types', s.containerTypes, 'containerTypes'));
  stack.append(namedListCard('🧾 Expense categories', s.expenseCategories, 'expenseCategories'));

  /* -------- shop, display, payments */
  const name = h('input', { type: 'text', value: s.stationName, maxLength: 60 }), tz = h('input', { type: 'text', value: s.timezone });
  const textSize = choice({ label: 'Text size', value: String(s.textScale), options: [{ value: '1', label: 'Normal' }, { value: '1.15', label: 'Large' }, { value: '1.3', label: 'Extra large' }], onChange: (v) => v && saveSettings({ textScale: Number(v) }, 'Text size changed') });
  const other = choice({ label: 'GCash', value: s.acceptOtherPayments ? 'on' : 'off', options: [{ value: 'off', label: 'Cash only' }, { value: 'on', label: 'Also GCash / other' }], onChange: (v) => v && saveSettings({ acceptOtherPayments: v === 'on' }) });
  const opening = money(s.openingFloat);
  stack.append(h('div', { class: 'card' }, h('h2', null, '🏪 Shop & display'), field('Shop name', name), field('Cash kept in the drawer at opening (₱)', opening, 'Used when End Day checks the cash. End Day also remembers what you leave for tomorrow.'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Text size'), textSize.el), h('div', { class: 'field' }, h('span', { class: 'label' }, 'Payment types'), other.el),
    field('Timezone', tz, 'Example: Asia/Manila. All daily totals follow this timezone.'),
    h('div', { style: { marginTop: '.8rem' } }, h('button', { class: 'btn primary', onclick: async () => {
      const o = toCentavos(opening.value || '0');
      if (Number.isNaN(o) || o < 0) return bad('Opening cash is not valid');
      try { new Intl.DateTimeFormat('en', { timeZone: tz.value.trim() }); } catch { return bad('Unknown timezone'); }
      await saveSettings({ stationName: name.value.trim() || 'Water Station', openingFloat: o, timezone: tz.value.trim() });
    } }, 'Save'))));

  /* -------- device + pin */
  const dev = h('input', { type: 'text', value: s.deviceName, maxLength: 30, placeholder: 'e.g. Tablet' });
  const code = h('input', { type: 'text', value: s.deviceCode, maxLength: 3, 'aria-label': 'Device code' });
  stack.append(h('div', { class: 'card' }, h('h2', null, 'This device'), h('p', { class: 'hint' }, 'Each phone/tablet has its own data. The short code makes sure order numbers never clash when you combine devices.'),
    field('Name', dev), field('Code (1–3 letters, different on every device)', code),
    h('div', { style: { marginTop: '.8rem' } }, h('button', { class: 'btn', onclick: () => saveSettings({ deviceName: dev.value.trim(), deviceCode: sanitizeDeviceCode(code.value) }) }, 'Save'))));

  const pinCard = h('div', { class: 'card' }, h('h2', null, '🔒 PIN lock'), h('p', { class: 'hint' }, 'Keeps other cashiers out of Books (and Rider pay, if you turn that on). It is a simple lock, not bank-level security.'));
  pinCard.append(h('div', { class: 'row', style: { marginTop: '.6rem' } },
    h('button', { class: 'btn', onclick: () => setPin(root) }, s.booksPin ? 'Change PIN' : 'Set a PIN'),
    s.booksPin ? h('button', { class: 'btn', onclick: () => confirmModal({ title: 'Remove the PIN?', message: 'Anyone using this device will be able to open Books and Rider pay.', okLabel: 'Remove PIN', kind: 'danger', onConfirm: async () => { await saveSettings({ booksPin: null, riderPayLocked: false }, 'PIN removed'); renderSettings(root); } }) }, 'Remove PIN') : null,
    s.booksPin ? h('button', { class: 'btn', onclick: () => { lockNow(); toast('Locked'); } }, '🔒 Lock now') : null));
  pinCard.append(h('div', { class: 'field', style: { marginTop: '.8rem' } }, h('span', { class: 'label' }, 'Rider pay (incentives & advances)'),
    choice({ label: 'Rider pay lock', value: s.riderPayLocked ? 'locked' : 'open', options: [{ value: 'open', label: '👁 Visible to everyone' }, { value: 'locked', label: '🔒 Needs the PIN' }], onChange: (v) => { if (!v) return; if (v === 'locked' && !S.state.settings.booksPin) { toast('Set a PIN first.', { kind: 'error' }); renderSettings(root); return; } saveSettings({ riderPayLocked: v === 'locked' }); } }).el));
  stack.append(pinCard);

  /* -------- backup */
  const hook = h('input', { type: 'url', value: s.discordWebhook, placeholder: 'https://discord.com/api/webhooks/…', autocomplete: 'off' });
  const bk = h('div', { class: 'card' }, h('h2', null, 'Backup & restore'),
    h('p', null, 'Your data lives only on this device. ', h('strong', null, 'A backup file is your insurance.')),
    h('p', { class: 'hint' }, S.state.meta.lastBackupAt ? `Last backup: ${new Date(S.state.meta.lastBackupAt).toLocaleString('en-PH', { timeZone: s.timezone })}` : 'No backup made yet.'),
    h('div', { class: 'stack', style: { marginTop: '.6rem' } },
      h('button', { class: 'btn primary block', onclick: downloadBackup }, '💾 Save a backup file'),
      h('button', { class: 'btn block', onclick: fullExport }, '📦 Full export for accounting (all orders)'),
      h('button', { class: 'btn block', onclick: () => pickFile(handleImport) }, '📥 Import a file (combine devices / restore)'),
      h('button', { class: 'btn block', onclick: openSnapshots }, '🕘 Automatic copies on this device')),
    h('div', { class: 'field' }, h('label', { for: 'hook' }, 'Discord backup (optional)'), hook,
      h('p', { class: 'hint' }, 'Paste a private channel’s webhook link and every End Day file is also posted there. Anyone with this link can post to the channel, and files contain customer names – keep the channel private.'),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: async () => { const v = hook.value.trim(); if (v && !isDiscordWebhook(v)) return toast('That is not a Discord webhook link', { kind: 'error' }); await saveSettings({ discordWebhook: v }); } }, 'Save link'),
        h('button', { class: 'btn small', onclick: async () => { const ok = await postToDiscord(hook.value, 'test.json', '{"test":true}', `${s.stationName}: test message`); toast(ok ? 'Test sent ✔' : 'Could not send (wrong link or no internet)', { kind: ok ? 'ok' : 'error' }); } }, 'Send test'))));
  bk.querySelector('input').id = 'hook';
  stack.append(bk);

  /* -------- storage + danger */
  const usage = h('p', { class: 'hint' }, 'Checking storage…');
  (async () => {
    try {
      const est = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      usage.textContent = `${est ? `Using ${(est.usage / 1048576).toFixed(1)} MB. ` : ''}${persisted ? 'Protected from automatic clean-up ✔' : 'The browser may clear this data if the phone runs very low on space – keep backups.'}`;
    } catch { usage.textContent = ''; }
  })();
  stack.append(h('div', { class: 'card' }, h('h2', null, 'Storage'), usage,
    h('p', { class: 'hint' }, `${S.state.orders.size} orders · ${S.state.expenses.size} expenses · ${S.state.customers.size} customers`)));
  stack.append(h('div', { class: 'card danger-zone' }, h('h2', null, 'Danger zone'), h('p', { class: 'hint' }, 'Erases everything on this device. A safety copy is kept inside the app for a while, but save a backup file first.'),
    h('button', { class: 'btn danger', onclick: eraseAll }, 'Erase all data')));
  root.append(stack);
}

/* ------------------------------------------------------------ list editors */
function listCard(title, hint, items, fmt, onSave, onAdd) {
  const card = h('div', { class: 'card' }, h('h2', null, title), h('p', { class: 'hint' }, hint));
  card.append(items.length ? h('div', { class: 'list' }, items.map((x, i) => h('div', { class: 'item' }, h('span', null, fmt(x)), h('button', { class: 'btn small', onclick: () => onSave(items.filter((_, j) => j !== i)) }, 'Remove')))) : h('p', { class: 'muted' }, 'None yet.'));
  card.append(h('div', { style: { marginTop: '.6rem' } }, h('button', { class: 'btn small', onclick: onAdd }, '＋ Add')));
  return card;
}
function addSpecial() {
  const qty = stepper({ value: 11, min: 1, max: 99, size: 'sm', label: 'Quantity' });
  const total = h('input', { type: 'text', inputMode: 'decimal', placeholder: 'Total price (₱), e.g. 200' });
  const name = h('input', { type: 'text', maxLength: 40, placeholder: 'Leave empty to name it “11 @ 200”' });
  openModal({ title: 'New special deal', body: h('div', null, h('div', { class: 'field' }, h('span', { class: 'label' }, 'Quantity in one deal'), qty.el), field('Total price (₱)', total), field('Name (optional)', name)),
    actions: [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', onClick: async ({ setError }) => {
      const t = toCentavos(total.value);
      if (Number.isNaN(t) || t <= 0) { setError('Enter the total price.'); return false; }
      const nm = name.value.trim() || dealName(qty.get(), t);
      await saveSettings({ specials: [...S.state.settings.specials, { key: slug(nm), name: nm, containers: qty.get(), total: t }] });
    } }] });
}
function addPreset() {
  const name = h('input', { type: 'text', maxLength: 30, placeholder: 'e.g. Family' });
  const price = h('input', { type: 'text', inputMode: 'decimal', placeholder: 'Price each (₱), e.g. 18' });
  openModal({ title: 'New price preset', body: h('div', null, field('Name', name), field('Price each (₱)', price)),
    actions: [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', onClick: async ({ setError }) => {
      const p = toCentavos(price.value);
      if (!name.value.trim() || Number.isNaN(p) || p <= 0) { setError('Enter a name and a price.'); return false; }
      await saveSettings({ pricePresets: [...S.state.settings.pricePresets, { key: slug(name.value), name: name.value.trim(), price: p }] });
    } }] });
}
function namedListCard(title, items, field_, withActive = false) {
  const card = h('div', { class: 'card' }, h('h2', null, title));
  card.append(h('div', { class: 'list' }, items.map((x, i) => {
    const inp = h('input', { type: 'text', value: x.name, maxLength: 40, 'aria-label': `${title} name` });
    inp.addEventListener('change', async () => { const v = inp.value.trim(); if (!v) { inp.value = x.name; return; } const list = S.state.settings[field_].map((y, j) => (j === i ? { ...y, name: v } : y)); await saveSettings({ [field_]: list }); });
    return h('div', { class: 'item' }, inp, withActive ? h('button', { class: 'btn small', onclick: () => saveSettings({ [field_]: S.state.settings[field_].map((y, j) => (j === i ? { ...y, active: !y.active } : y)) }) }, x.active ? 'Active' : 'Inactive') : null);
  })));
  const add = h('input', { type: 'text', maxLength: 40, placeholder: 'Add new…', 'aria-label': `Add to ${title}` });
  card.append(h('div', { class: 'row', style: { marginTop: '.6rem' } }, add, h('button', { class: 'btn small', onclick: async () => { const v = add.value.trim(); if (!v) return; await saveSettings({ [field_]: [...S.state.settings[field_], withActive ? { key: slug(v), name: v, active: true } : { key: slug(v), name: v }] }); add.value = ''; } }, 'Add')));
  if (withActive) card.append(h('p', { class: 'hint' }, 'People are never deleted – set them Inactive so old orders keep their name.'));
  return card;
}

/* --------------------------------------------------------------------- pin */
function setPin(root) {
  const a = h('input', { type: 'password', inputMode: 'numeric', maxLength: 8, placeholder: 'New PIN (4–8 digits)', autocomplete: 'off' });
  const b = h('input', { type: 'password', inputMode: 'numeric', maxLength: 8, placeholder: 'Type it again', autocomplete: 'off' });
  openModal({ title: 'Set Books PIN', body: h('div', null, field('PIN', a), field('Confirm', b)), actions: [{ label: 'Cancel' }, { label: 'Save PIN', kind: 'primary', onClick: async ({ setError }) => {
    if (!/^\d{4,8}$/.test(a.value)) { setError('Use 4 to 8 digits.'); return false; }
    if (a.value !== b.value) { setError('The two PINs are different.'); return false; }
    const salt = newSalt();
    await saveSettings({ booksPin: { salt, hash: await hashPin(a.value, salt) } }, 'PIN saved');
    renderSettings(root);
  } }] });
}

/* ------------------------------------------------------------------ backup */
async function downloadBackup() {
  const now = new Date().toISOString();
  const file = X.buildBackup({ settings: S.state.settings, orders: [...S.state.orders.values()], expenses: [...S.state.expenses.values()], customers: [...S.state.customers.values()], closes: [...S.state.closes.values()], meta: { customRoads: S.state.meta.customRoads ?? [], floatNext: S.state.meta.floatNext ?? null, lastExportAt: S.state.meta.lastExportAt ?? null, lastCloseDate: S.state.meta.lastCloseDate ?? null }, now, appVersion: S.APP_VERSION });
  const r = await deliverFile(`ledger_backup_${now.slice(0, 10)}.json`, JSON.stringify(file));
  if (r === 'cancelled') return;
  await S.save({ meta: { lastBackupAt: now } });
  toast('Backup file ready. Keep it somewhere safe (email / Drive).', { kind: 'ok', ms: 6000 });
}
async function fullExport() {
  const now = new Date().toISOString();
  const file = X.buildOrdersExport({ settings: S.state.settings, orders: [...S.state.orders.values()], expenses: [...S.state.expenses.values()], close: null, mode: 'full', now, appVersion: S.APP_VERSION });
  const r = await deliverFile(`orders_${S.today()}_recovery.json`, JSON.stringify(file));
  if (r !== 'cancelled') toast('Export ready', { kind: 'ok' });
}
function pickFile(handler) {
  const inp = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  inp.addEventListener('change', async () => { const f = inp.files?.[0]; inp.remove(); if (f) { try { await handler(await readTextFile(f), f.name); } catch (e) { toast(e.message, { kind: 'error' }); } } });
  document.body.append(inp); inp.click();
}

function handleImport(text, fileName) {
  const p = X.parseFile(text);
  if (p.kind === 'invalid') return toast(p.errors[0], { kind: 'error', ms: 7000 });
  const mo = O.mergeById(S.state.orders, p.orders, 'order_id');
  const me = O.mergeById(S.state.expenses, p.expenses, 'expense_id');
  const mc = O.mergeById(S.state.customers, p.customers, 'customer_id');
  const closesNew = p.closes.filter((c) => !S.state.closes.has(c.close_id));
  const lines = [`${mo.added} new order${mo.added === 1 ? '' : 's'}, ${mo.updated} updated, ${mo.skipped} already up to date`, `${me.added + me.updated} expense change${me.added + me.updated === 1 ? '' : 's'}`, `${closesNew.length} day-close record${closesNew.length === 1 ? '' : 's'}`];
  const body = h('div', null, h('p', null, h('strong', null, fileName)), ...lines.map((l) => h('p', null, '• ' + l)), p.errors.length ? h('p', { class: 'form-error' }, `${p.errors.length} record(s) were skipped because they looked invalid.`) : null,
    p.kind === 'backup' ? h('p', { class: 'hint' }, 'This is a full backup. You can combine it with what is on this device, or replace everything on this device with it.') : h('p', { class: 'hint' }, 'Importing is safe to repeat: newer versions of an order replace older ones, nothing is duplicated.'));
  const actions = [{ label: 'Cancel' }, { label: 'Combine (safe)', kind: 'primary', onClick: async () => {
    await S.dailySnapshot(true, `before-import-${Date.now()}`);
    await S.save({ orders: mo.toPut, expenses: me.toPut, customers: mc.toPut, closes: closesNew });
    toast('Imported ✔', { kind: 'ok' });
  } }];
  if (p.kind === 'backup') actions.splice(1, 0, { label: 'Replace everything', kind: 'danger', onClick: () => {
    confirmModal({ title: 'Replace ALL data on this device?', message: `Everything now on this device will be replaced by this backup.\nA safety copy is kept automatically.`, okLabel: 'Yes, replace', kind: 'danger', onConfirm: async () => { await S.replaceEverything({ orders: p.orders, expenses: p.expenses, customers: p.customers, closes: p.closes, settings: p.settings ? { ...S.state.settings, ...p.settings, deviceCode: S.state.settings.deviceCode, booksPin: S.state.settings.booksPin } : null, meta: p.meta }); toast('Restored ✔', { kind: 'ok' }); } });
  } });
  openModal({ title: 'Import file', body, actions, wide: true });
}

async function openSnapshots() {
  const snaps = await S.listSnapshots();
  const body = snaps.length ? h('div', { class: 'list' }, snaps.map((sn) => h('div', { class: 'item' }, h('div', null, h('div', { class: 't' }, sn.date.startsWith('before-') ? sn.date.replace(/-\d{10,}$/, '') : sn.date), h('div', { class: 's' }, `${sn.orders.length} orders · saved ${new Date(sn.taken_at).toLocaleString('en-PH', { timeZone: S.state.settings.timezone })}`)),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: async () => { await deliverFile(`snapshot_${sn.date}.json`, JSON.stringify(X.buildBackup({ settings: sn.settings, orders: sn.orders, expenses: sn.expenses, customers: sn.customers, closes: sn.closes, meta: {}, now: sn.taken_at, appVersion: S.APP_VERSION }))); } }, 'Save as file'),
      h('button', { class: 'btn small', onclick: () => confirmModal({ title: 'Go back to this copy?', message: `Everything now on this device will be replaced by the copy from ${sn.date}.\nA safety copy of now is kept.`, okLabel: 'Restore', kind: 'danger', onConfirm: async () => { await S.replaceEverything({ orders: sn.orders, expenses: sn.expenses, customers: sn.customers, closes: sn.closes, settings: { ...sn.settings, booksPin: S.state.settings.booksPin }, meta: {} }); toast('Restored ✔', { kind: 'ok' }); } }) }, 'Restore'))))) : h('p', { class: 'muted' }, 'No copies yet. One is made automatically each day you use the app.');
  openModal({ title: 'Automatic copies', body: h('div', null, h('p', { class: 'hint' }, 'The app keeps the last 7 days on this device. These do not protect you if the device is lost – use a backup file for that.'), body), wide: true, actions: [{ label: 'Close', kind: 'primary' }] });
}

function eraseAll() {
  const t = h('input', { type: 'text', placeholder: 'Type ERASE', autocomplete: 'off' });
  openModal({ title: 'Erase everything?', body: h('div', null, h('p', null, 'This deletes all orders, expenses and settings on this device.'), field('To confirm, type ERASE', t)), actions: [{ label: 'Cancel' }, { label: 'Erase all', kind: 'danger', onClick: async ({ setError }) => { if (t.value.trim() !== 'ERASE') { setError('Type ERASE exactly to continue.'); return false; } await S.eraseEverything(); toast('All data erased'); } }] });
}

// More: settings, backup / restore, import (merge devices), safety tools.
import { h, clear } from './dom.js';
import { toast, openModal, confirmModal, choice, field, stepper } from './components.js';
import * as S from '../data/store.js';
import * as X from '../core/exchange.js';
import * as O from '../core/orders.js';
import { newSalt, hashPin } from '../core/pin.js';
import { sanitizeDeviceCode } from '../core/ids.js';
import { peso, toCentavos, pesoInput } from '../core/money.js';
import { deliverFile, readTextFile, isDiscordWebhook, postToDiscord } from './files.js';

const slug = (name) => `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'item'}_${Math.random().toString(36).slice(2, 6)}`;
const saveSettings = async (patch, msg = 'Saved') => { try { await S.save({ settings: patch }); toast(msg, { kind: 'ok', ms: 2000 }); } catch (e) { toast(e.message, { kind: 'error' }); } };

export function renderMore(root, { lockBooks }) {
  clear(root);
  const s = S.state.settings;
  root.append(h('div', { class: 'page-title' }, h('h1', null, 'More'), h('span', { class: 'muted' }, `v${S.APP_VERSION} · ${s.stationName}`)));
  const stack = h('div', { class: 'stack' });

  /* -------- shop basics */
  const name = h('input', { type: 'text', value: s.stationName, maxLength: 60 });
  const price = h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(s.unitPrice) });
  const goal = h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(s.dailyGoal), placeholder: '0 = no goal' });
  const late = stepper({ value: s.lateMinutes, min: 5, max: 240, size: 'sm', label: 'Late after minutes' });
  const tz = h('input', { type: 'text', value: s.timezone });
  const textSize = choice({ label: 'Text size', value: String(s.textScale), options: [{ value: '1', label: 'Normal' }, { value: '1.15', label: 'Large' }, { value: '1.3', label: 'Extra large' }], onChange: (v) => v && saveSettings({ textScale: Number(v) }, 'Text size changed') });
  const other = choice({ label: 'GCash', value: s.acceptOtherPayments ? 'on' : 'off', options: [{ value: 'off', label: 'Cash only' }, { value: 'on', label: 'Also GCash / other' }], onChange: (v) => v && saveSettings({ acceptOtherPayments: v === 'on' }) });
  stack.append(h('div', { class: 'card' }, h('h2', null, 'Shop'), field('Shop name', name), field('Price per container (₱)', price), field('Daily sales goal (₱, optional)', goal),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Delivery is “late” after (minutes)'), late.el), h('div', { class: 'field' }, h('span', { class: 'label' }, 'Text size'), textSize.el), h('div', { class: 'field' }, h('span', { class: 'label' }, 'Payment types'), other.el),
    field('Timezone', tz, 'Example: Asia/Manila. All daily totals follow this timezone.'),
    h('div', { style: { marginTop: '.8rem' } }, h('button', { class: 'btn primary', onclick: async () => {
      const p = toCentavos(price.value), g = toCentavos(goal.value || '0');
      if (Number.isNaN(p) || p < 0) return toast('Price is not valid', { kind: 'error' });
      if (Number.isNaN(g) || g < 0) return toast('Goal is not valid', { kind: 'error' });
      try { new Intl.DateTimeFormat('en', { timeZone: tz.value.trim() }); } catch { return toast('Unknown timezone', { kind: 'error' }); }
      await saveSettings({ stationName: name.value.trim() || 'Water Station', unitPrice: p, dailyGoal: g, lateMinutes: late.get(), timezone: tz.value.trim() });
    } }, 'Save shop settings'))));

  /* -------- lists */
  stack.append(listCard('Special deals', 'e.g. “Buy 5 get 1” = 6 containers for ₱100', s.specials, ['name', 'qty', 'total'], (x) => `${x.name} · ${x.qty} for ${peso(x.total)}`, async (list) => saveSettings({ specials: list }), () => addSpecial(s)));
  stack.append(namedListCard('Riders', s.riders, 'riders', true));
  stack.append(namedListCard('Container types', s.containerTypes, 'containerTypes'));
  stack.append(namedListCard('Expense categories', s.expenseCategories, 'expenseCategories'));

  /* -------- device + pin */
  const dev = h('input', { type: 'text', value: s.deviceName, maxLength: 30, placeholder: 'e.g. Tablet' });
  const code = h('input', { type: 'text', value: s.deviceCode, maxLength: 3, 'aria-label': 'Device code' });
  stack.append(h('div', { class: 'card' }, h('h2', null, 'This device'), h('p', { class: 'hint' }, 'Each phone/tablet has its own data. The short code makes sure order numbers never clash when you combine devices.'),
    field('Name', dev), field('Code (1–3 letters, different on every device)', code),
    h('div', { style: { marginTop: '.8rem' } }, h('button', { class: 'btn', onclick: () => saveSettings({ deviceName: dev.value.trim(), deviceCode: sanitizeDeviceCode(code.value) }) }, 'Save'))));

  const pinCard = h('div', { class: 'card' }, h('h2', null, 'Books lock (PIN)'), h('p', { class: 'hint' }, 'Keeps cashiers out of profit and reports. It is a simple lock, not bank-level security.'));
  pinCard.append(h('div', { class: 'row', style: { marginTop: '.6rem' } },
    h('button', { class: 'btn', onclick: () => setPin() }, s.booksPin ? 'Change PIN' : 'Set a PIN'),
    s.booksPin ? h('button', { class: 'btn', onclick: () => confirmModal({ title: 'Remove the PIN?', message: 'Anyone using this device will be able to open Books.', okLabel: 'Remove PIN', kind: 'danger', onConfirm: async () => { await saveSettings({ booksPin: null }, 'PIN removed'); renderMore(root, { lockBooks }); } }) }, 'Remove PIN') : null,
    s.booksPin ? h('button', { class: 'btn', onclick: lockBooks }, '🔒 Lock Books now') : null));
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
function listCard(title, hint, items, _f, fmt, onSave, onAdd) {
  const card = h('div', { class: 'card' }, h('h2', null, title), h('p', { class: 'hint' }, hint));
  card.append(items.length ? h('div', { class: 'list' }, items.map((x, i) => h('div', { class: 'item' }, h('span', null, fmt(x)), h('button', { class: 'btn small', onclick: () => onSave(items.filter((_, j) => j !== i)) }, 'Remove')))) : h('p', { class: 'muted' }, 'None yet.'));
  card.append(h('div', { style: { marginTop: '.6rem' } }, h('button', { class: 'btn small', onclick: onAdd }, '＋ Add')));
  return card;
}
function addSpecial(s) {
  const name = h('input', { type: 'text', maxLength: 40, placeholder: 'Name, e.g. Buy 5 get 1' });
  const qty = stepper({ value: 6, min: 1, max: 99, size: 'sm', label: 'Containers' });
  const total = h('input', { type: 'text', inputMode: 'decimal', placeholder: 'Total price (₱)' });
  openModal({ title: 'New special deal', body: h('div', null, field('Name', name), h('div', { class: 'field' }, h('span', { class: 'label' }, 'Containers you get'), qty.el), field('Total price (₱)', total)),
    actions: [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', onClick: async ({ setError }) => { const t = toCentavos(total.value); if (!name.value.trim() || Number.isNaN(t) || t <= 0) { setError('Enter a name and a price.'); return false; } await saveSettings({ specials: [...S.state.settings.specials, { key: slug(name.value), name: name.value.trim(), qty: qty.get(), total: t }] }); } }] });
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
  if (withActive) card.append(h('p', { class: 'hint' }, 'Riders are never deleted – set them Inactive so old orders keep their name.'));
  return card;
}

/* --------------------------------------------------------------------- pin */
function setPin() {
  const a = h('input', { type: 'password', inputMode: 'numeric', maxLength: 8, placeholder: 'New PIN (4–8 digits)', autocomplete: 'off' });
  const b = h('input', { type: 'password', inputMode: 'numeric', maxLength: 8, placeholder: 'Type it again', autocomplete: 'off' });
  openModal({ title: 'Set Books PIN', body: h('div', null, field('PIN', a), field('Confirm', b)), actions: [{ label: 'Cancel' }, { label: 'Save PIN', kind: 'primary', onClick: async ({ setError }) => {
    if (!/^\d{4,8}$/.test(a.value)) { setError('Use 4 to 8 digits.'); return false; }
    if (a.value !== b.value) { setError('The two PINs are different.'); return false; }
    const salt = newSalt();
    await saveSettings({ booksPin: { salt, hash: await hashPin(a.value, salt) } }, 'PIN saved');
  } }] });
}

/* ------------------------------------------------------------------ backup */
async function downloadBackup() {
  const now = new Date().toISOString();
  const file = X.buildBackup({ settings: S.state.settings, orders: [...S.state.orders.values()], expenses: [...S.state.expenses.values()], customers: [...S.state.customers.values()], closes: [...S.state.closes.values()], meta: { floatNext: S.state.meta.floatNext ?? null, lastExportAt: S.state.meta.lastExportAt ?? null, lastCloseDate: S.state.meta.lastCloseDate ?? null }, now, appVersion: S.APP_VERSION });
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

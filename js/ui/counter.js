// The Counter: take a new order. Built for speed and big fingers.
import { h, clear } from './dom.js';
import { toast, stepper, choice, field } from './components.js';
import * as S from '../data/store.js';
import * as O from '../core/orders.js';
import { newOrderId, newCustomerId } from '../core/ids.js';
import { peso, toCentavos, pesoInput } from '../core/money.js';

let draft = null;
let lastRider = null;

function freshDraft(keep = {}) {
  const s = S.state.settings;
  const fulfillment = keep.fulfillment || 'walkin';
  return {
    fulfillment, qty: 1, special: null, unitPrice: s.unitPrice, customer: '', customerId: null,
    rider: fulfillment === 'delivery' ? lastRider : null,
    ctype: fulfillment === 'delivery' ? s.defaultContainerType || null : null, cstat: 'swapped', owed: 1,
    payNow: true, method: 'cash', tendered: '', ref: '', note: '', editPrice: false, error: ''
  };
}

const total = () => (draft.special ? draft.special.total : draft.unitPrice * draft.qty);

function customerNames() {
  const counts = new Map();
  for (const c of S.state.customers.values()) counts.set(c.name, counts.get(c.name) || 0);
  for (const o of S.state.orders.values()) if (!O.isAnonymous(o.customer_name)) counts.set(o.customer_name, (counts.get(o.customer_name) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

export function renderCounter(root) {
  if (!draft) draft = freshDraft();
  const s = S.state.settings;
  const rerender = () => { const y = window.scrollY; renderCounter(root); window.scrollTo(0, y); };
  clear(root);

  /* ---- left: what is being sold */
  const walkin = draft.fulfillment === 'walkin';
  const seg = choice({
    label: 'Order type', value: draft.fulfillment,
    options: [{ value: 'walkin', label: '🏪 Walk-in' }, { value: 'delivery', label: '🛵 Delivery' }],
    onChange: (v) => { if (!v) return; draft = { ...freshDraft({ fulfillment: v }), customer: draft.customer, customerId: draft.customerId, qty: draft.qty, special: draft.special, note: draft.note }; rerender(); }
  });
  seg.el.classList.add('seg-big');

  const totalAmt = h('div', { class: 'amt num' }, peso(total()));
  const totalSub = h('div', { class: 'muted' });
  const changeBox = h('div', { class: 'change-box', hidden: true });
  const submit = h('button', { class: 'btn primary big block', type: 'button' });
  const errEl = h('p', { class: 'form-error', role: 'alert' }, draft.error);

  const refreshTotals = () => {
    totalAmt.textContent = peso(total());
    totalSub.textContent = draft.special ? `${draft.special.name} · special price` : `${draft.qty} × ${peso(draft.unitPrice)}`;
    const t = toCentavos(draft.tendered);
    if (walkin && draft.payNow && draft.method === 'cash' && draft.tendered.trim() && !Number.isNaN(t)) {
      changeBox.hidden = false;
      changeBox.textContent = t >= total() ? `Change: ${peso(t - total())}` : `Short by ${peso(total() - t)}`;
      changeBox.classList.toggle('short', t < total());
    } else changeBox.hidden = true;
    submit.textContent = walkin ? (draft.payNow ? `Paid · ${peso(total())}` : `Save as unpaid · ${peso(total())}`) : `Add delivery · ${peso(total())}`;
  };

  const qty = stepper({ value: draft.qty, min: 1, max: 999, label: 'Quantity', onChange: (v) => { draft.qty = v; if (draft.special) { draft.special = null; } refreshTotals(); } });
  const quick = h('div', { class: 'suggest' }, [1, 2, 3, 4, 5, 10].map((n) => h('button', { type: 'button', class: 'chip', onclick: () => { draft.qty = n; draft.special = null; qty.set(n); refreshTotals(); } }, String(n))));
  const specials = s.specials.length ? h('div', { class: 'suggest' }, s.specials.map((sp) => h('button', {
    type: 'button', class: `chip ${draft.special?.key === sp.key ? 'on' : ''}`,
    onclick: () => { draft.special = draft.special?.key === sp.key ? null : sp; if (draft.special) { draft.qty = sp.qty; qty.set(sp.qty); } rerender(); }
  }, `⭐ ${sp.name} (${sp.qty} · ${peso(sp.total)})`))) : null;

  const priceInput = h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(draft.unitPrice), 'aria-label': 'Price each' });
  priceInput.addEventListener('input', () => { const c = toCentavos(priceInput.value); if (!Number.isNaN(c) && c >= 0) { draft.unitPrice = c; refreshTotals(); } });
  const priceRow = draft.editPrice
    ? h('div', { class: 'field' }, h('label', { for: 'price' }, 'Price each (₱)'), priceInput)
    : h('p', { class: 'hint' }, `Price each: ${peso(draft.unitPrice)} `, h('button', { class: 'btn small', type: 'button', onclick: () => { draft.editPrice = true; draft.special = null; rerender(); } }, 'Change price'));
  priceInput.id = 'price';

  /* customer */
  const nameInput = h('input', { type: 'text', value: draft.customer, maxLength: 120, placeholder: walkin ? 'Name (optional)' : 'Customer name', autocomplete: 'off', 'aria-label': 'Customer name' });
  const suggest = h('div', { class: 'suggest' });
  const names = customerNames();
  const paintSuggest = () => {
    clear(suggest);
    const q = O.normalizeName(nameInput.value);
    const list = (q ? names.filter((n) => O.normalizeName(n).includes(q) && O.normalizeName(n) !== q) : names).slice(0, 6);
    list.forEach((n) => suggest.append(h('button', { type: 'button', class: 'chip', onclick: () => { nameInput.value = n; draft.customer = n; const c = [...S.state.customers.values()].find((x) => O.normalizeName(x.name) === O.normalizeName(n)); draft.customerId = c?.customer_id || null; paintSuggest(); } }, n)));
  };
  nameInput.addEventListener('input', () => { draft.customer = nameInput.value; draft.customerId = null; paintSuggest(); });
  paintSuggest();

  const left = h('div', { class: 'card' },
    h('h2', null, 'New order'), seg.el,
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'How many containers?'), qty.el, quick, specials), priceRow,
    field(walkin ? 'Customer' : 'Customer *', nameInput), suggest);

  /* delivery bits */
  if (!walkin) {
    const riders = s.riders.filter((r) => r.active);
    const rc = choice({ label: 'Rider', allowNone: true, value: draft.rider, options: riders.map((r) => ({ value: r.key, label: r.name })), onChange: (v) => { draft.rider = v; lastRider = v; } });
    left.append(h('div', { class: 'field' }, h('span', { class: 'label' }, 'Rider'), rc.el));
  }

  /* containers */
  const ctypes = choice({ label: 'Container type', allowNone: true, value: draft.ctype, options: s.containerTypes.map((c) => ({ value: c.key, label: c.name })), onChange: (v) => { draft.ctype = v; rerender(); } });
  const cbox = h('div', { class: 'field' }, h('span', { class: 'label' }, 'Container'), ctypes.el);
  if (draft.ctype) {
    const cs = choice({ label: 'Container handling', value: draft.cstat, options: [{ value: 'swapped', label: '🔁 Swapped (empties taken)' }, { value: 'owed', label: '⚠️ Empties NOT taken' }, { value: 'kept', label: '🆕 New container sold' }], onChange: (v) => { draft.cstat = v || 'swapped'; rerender(); } });
    cbox.append(h('div', { style: { marginTop: '.5rem' } }, cs.el));
    if (draft.cstat === 'owed') {
      const ow = stepper({ value: Math.min(draft.owed, 999), min: 1, max: 999, size: 'sm', label: 'Empties owed', onChange: (v) => { draft.owed = v; } });
      cbox.append(h('div', { class: 'row', style: { marginTop: '.5rem' } }, h('span', null, 'Empties still with customer:'), ow.el));
    }
  }
  left.append(walkin ? h('details', { open: !!draft.ctype }, h('summary', { class: 'label', style: { marginTop: '.85rem', cursor: 'pointer' } }, 'Container options'), cbox) : cbox);

  /* ---- right: payment + submit */
  const right = h('div', { class: 'stack sticky' });
  right.append(h('div', { class: 'total-box' }, h('div', { class: 'muted' }, 'Total'), totalAmt, totalSub));

  const payCard = h('div', { class: 'card' });
  if (walkin) {
    const pn = choice({ label: 'Payment', value: draft.payNow ? 'now' : 'later', options: [{ value: 'now', label: '💵 Paid now' }, { value: 'later', label: '📒 Pay later' }], onChange: (v) => { draft.payNow = v !== 'later'; rerender(); } });
    pn.el.classList.add('seg-big');
    payCard.append(pn.el);
    if (draft.payNow) {
      if (s.acceptOtherPayments) {
        const m = choice({ label: 'Paid by', value: draft.method, options: [{ value: 'cash', label: 'Cash' }, { value: 'gcash', label: 'GCash' }, { value: 'other', label: 'Other' }], onChange: (v) => { draft.method = v || 'cash'; rerender(); } });
        payCard.append(h('div', { class: 'field' }, m.el));
      }
      if (draft.method === 'cash') {
        const t = h('input', { type: 'text', inputMode: 'decimal', value: draft.tendered, placeholder: 'Cash received (optional)', 'aria-label': 'Cash received' });
        t.addEventListener('input', () => { draft.tendered = t.value; refreshTotals(); });
        const q = h('div', { class: 'suggest' }, [null, 50, 100, 200, 500, 1000].map((v) => h('button', { type: 'button', class: 'chip', onclick: () => { draft.tendered = pesoInput(v == null ? total() : v * 100); t.value = draft.tendered; refreshTotals(); } }, v == null ? 'Exact' : `₱${v}`)));
        payCard.append(h('div', { class: 'field' }, t, q, changeBox));
      } else {
        const r = h('input', { type: 'text', value: draft.ref, placeholder: 'Reference no. (optional)', maxLength: 60 });
        r.addEventListener('input', () => { draft.ref = r.value; });
        payCard.append(field('Reference', r));
      }
    } else payCard.append(h('p', { class: 'hint' }, 'The customer owes this amount. It will show under “Money owed” until you collect it.'));
  } else payCard.append(h('p', null, '💡 Payment is collected when the order is delivered.'));
  const note = h('input', { type: 'text', value: draft.note, maxLength: 300, placeholder: 'Note (optional)' });
  note.addEventListener('input', () => { draft.note = note.value; });
  payCard.append(field('Note', note));
  right.append(payCard, errEl, submit);

  submit.addEventListener('click', async () => {
    errEl.textContent = '';
    submit.disabled = true;
    try { await place(); rerenderAfter(); } catch (e) { errEl.textContent = e.message; draft.error = e.message; } finally { submit.disabled = false; }
  });
  const rerenderAfter = () => { draft = freshDraft({ fulfillment: draft.fulfillment }); renderCounter(root); window.scrollTo(0, 0); };

  refreshTotals();
  root.append(h('div', { class: 'counter-grid' }, left, right));
}

async function place() {
  const s = S.state.settings;
  const walkin = draft.fulfillment === 'walkin';
  const name = draft.customer.trim();
  if (!walkin && !name) throw new Error('Please enter the customer name for a delivery.');
  if (!walkin && s.riders.some((r) => r.active) && !draft.rider) throw new Error('Please choose a rider.');
  let pay = null;
  if (walkin) {
    if (!draft.payNow) pay = 'later';
    else {
      pay = { method: draft.method, ref: draft.ref };
      if (draft.method === 'cash' && draft.tendered.trim()) {
        const t = toCentavos(draft.tendered);
        if (Number.isNaN(t)) throw new Error('Cash received is not a valid amount.');
        pay.tendered = t;
      }
    }
  }
  // find or create the customer record so analytics can group their orders
  let customerId = draft.customerId;
  const newCustomers = [];
  if (name && !O.isAnonymous(name)) {
    const existing = [...S.state.customers.values()].find((c) => O.normalizeName(c.name) === O.normalizeName(name));
    if (existing) customerId = existing.customer_id;
    else {
      const now = new Date().toISOString();
      customerId = newCustomerId(s.deviceCode);
      newCustomers.push({ customer_id: customerId, name, phone: '', address: '', note: '', created_at: now, updated_at: now });
    }
  }
  const { seq, day, orderNo } = S.nextOrderNo();
  const now = new Date().toISOString();
  const order = O.createOrder({
    customer_name: name, customer_id: customerId, quantity: draft.qty, unit_price: draft.unitPrice, special: draft.special,
    fulfillment: draft.fulfillment, rider: draft.rider,
    container: draft.ctype ? { type: draft.ctype, status: draft.cstat, owed: draft.owed } : {}, pay, note: draft.note
  }, { id: newOrderId(s.deviceCode, day), orderNo, now });
  await S.save({ orders: [order], customers: newCustomers, meta: { [`seq:${day}`]: seq } });
  const undo = { label: 'Undo', onClick: async () => { try { await S.save({ orders: [O.voidOrder(S.state.orders.get(order.order_id), new Date().toISOString(), 'undone right after entry')] }); toast('Order removed.'); } catch (e) { toast(e.message, { kind: 'error' }); } } };
  const change = order.amount_tendered != null ? ` · change ${peso(order.amount_tendered - order.total_price)}` : '';
  toast(`Saved #${orderNo} · ${peso(order.total_price)}${change}`, { action: undo, ms: 7000, kind: 'ok' });
}

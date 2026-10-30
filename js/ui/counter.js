// The Counter: take a new order. Built for speed and big fingers.
import { h, clear } from './dom.js';
import { toast, choice, field } from './components.js';
import * as S from '../data/store.js';
import * as O from '../core/orders.js';
import { newOrderId, newCustomerId } from '../core/ids.js';
import { peso, toCentavos, pesoInput } from '../core/money.js';
import { linesEditor } from './lines.js';
import { rates, unitPriceFor } from './view.js';
import { hooks } from './bus.js';

let draft = null;
let lastStaff = null;
try { lastStaff = localStorage.getItem('ledger.lastStaff'); } catch { /* storage may be blocked */ }

function freshDraft(keep = {}) {
  return {
    fulfillment: keep.fulfillment || 'pickup', customer: keep.customer || '', customerId: keep.customerId || null,
    staff: keep.staff || lastStaff, priority: false, payNow: true, method: 'cash', tendered: '', ref: '', note: '', lines: keep.lines || null, error: ''
  };
}

function customerNames() {
  const counts = new Map();
  for (const c of S.state.customers.values()) counts.set(c.name, counts.get(c.name) || 0);
  for (const o of S.state.orders.values()) if (!O.isAnonymous(o.customer_name)) counts.set(o.customer_name, (counts.get(o.customer_name) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

/** Open the Counter with a customer already filled in (used by "Order again" in profiles). */
export function prefillCounter(customer) { draft = freshDraft({ customer: customer?.name || '', customerId: customer?.customer_id || null }); }

export function renderCounter(root) {
  if (!draft) draft = freshDraft();
  const s = S.state.settings;
  const rerender = () => { const y = window.scrollY; renderCounter(root); window.scrollTo(0, y); };
  clear(root);
  const delivery = draft.fulfillment === 'delivery';
  const editorInit = draft.lines || { deals: [], regular_qty: 1, unit_price: unitPriceFor(draft.fulfillment), containers: {}, empties_owed: {} };
  root.append(h('div', { class: 'page-title' }, h('h1', null, 'New order')));

  const seg = choice({
    label: 'Order type', value: draft.fulfillment,
    options: [{ value: 'pickup', label: '🏪 Pick-up (walk-in)' }, { value: 'delivery', label: '🛵 Delivery' }],
    onChange: (v) => {
      if (!v) return;
      const g = ed.get();
      // keep what was typed; the price goes back to the default price of the new order type
      draft.lines = { deals: g.deals, regular_qty: g.regular_qty, unit_price: unitPriceFor(v), containers: g.containers, empties_owed: {} };
      draft.fulfillment = v; draft.payNow = true; rerender();
    }
  });
  seg.el.classList.add('seg-big');

  const totalBox = h('div', { class: 'total-box' });
  const changeBox = h('div', { class: 'change-box', hidden: true });
  const submit = h('button', { class: 'btn primary big block', type: 'button' });
  const errEl = h('p', { class: 'form-error', role: 'alert' }, draft.error);

  const paintTotal = () => {
    const tot = ed.total(), qn = ed.quantity(), rows = ed.breakdown();
    clear(totalBox);
    totalBox.append(h('div', { class: 'muted' }, 'Total'), h('div', { class: 'amt num' }, peso(tot)));
    if (rows.some((r) => r.deal)) {
      totalBox.append(h('table', { class: 'calc' },
        h('thead', null, h('tr', null, h('th', null, 'Item'), h('th', { class: 'r' }, 'Qty'), h('th', { class: 'r' }, 'Price'), h('th', { class: 'r' }, 'Subtotal'))),
        h('tbody', null, rows.map((r) => h('tr', null, h('td', null, r.name), h('td', { class: 'r num' }, String(r.qty)), h('td', { class: 'r num' }, peso(r.unit)), h('td', { class: 'r num' }, peso(r.subtotal)))))));
      totalBox.append(h('div', { class: 'muted' }, `Total quantity: ${qn}`));
    } else {
      const r = rows[0];
      totalBox.append(h('div', { class: 'muted' }, r ? `${r.qty} × ${peso(r.unit)} (${r.name})` : 'Nothing added yet'));
    }
  };
  const refresh = () => {
    const tot = ed.total();
    paintTotal();
    const t = toCentavos(draft.tendered);
    if (!delivery && draft.payNow && draft.method === 'cash' && draft.tendered.trim() && !Number.isNaN(t)) {
      changeBox.hidden = false;
      changeBox.textContent = t >= tot ? `Change: ${peso(t - tot)}` : `Short by ${peso(tot - t)}`;
      changeBox.classList.toggle('short', t < tot);
    } else changeBox.hidden = true;
    submit.textContent = delivery ? `Add delivery · ${peso(tot)}` : draft.payNow ? `Paid · ${peso(tot)}` : `Save as unpaid · ${peso(tot)}`;
  };
  const ed = linesEditor(editorInit, { fulfillment: draft.fulfillment, onChange: () => { draft.lines = ed.get(); refresh(); } });
  draft.lines = ed.get();

  /* customer */
  const nameInput = h('input', { type: 'text', value: draft.customer, maxLength: 120, placeholder: delivery ? 'Customer name' : 'Name (optional)', autocomplete: 'off', 'aria-label': 'Customer name' });
  const suggest = h('div', { class: 'suggest' });
  const names = customerNames();
  const paintSuggest = () => {
    clear(suggest);
    const q = O.normalizeName(nameInput.value);
    const list = (q ? names.filter((n) => O.normalizeName(n).includes(q) && O.normalizeName(n) !== q) : names).slice(0, 6);
    list.forEach((n) => suggest.append(h('button', { type: 'button', class: 'chip', onclick: () => {
      nameInput.value = n; draft.customer = n;
      const c = [...S.state.customers.values()].find((x) => O.normalizeName(x.name) === O.normalizeName(n));
      draft.customerId = c?.customer_id || null; paintSuggest();
    } }, n)));
  };
  nameInput.addEventListener('input', () => { draft.customer = nameInput.value; draft.customerId = null; paintSuggest(); });
  paintSuggest();

  /* handled by */
  const staff = s.staff.filter((x) => x.active !== false);
  const sc = choice({ label: 'Handled by', value: draft.staff, options: staff.map((x) => ({ value: x.key, label: x.name })), onChange: (v) => { draft.staff = v; if (v) { lastStaff = v; try { localStorage.setItem('ledger.lastStaff', v); } catch { /* ignore */ } } } });
  sc.el.classList.add('seg-big');

  const rush = h('label', { class: 'row rush-toggle' }, h('input', { type: 'checkbox', checked: draft.priority, onchange: (e) => { draft.priority = e.target.checked; } }), h('span', null, '🔥 Rush – do this one first'));

  const box = (title, ...kids) => h('section', { class: 'card box' }, h('h2', null, title), ...kids);
  const left = h('div', { class: 'stack' },
    box('1 · Order', seg.el, field(delivery ? 'Customer *' : 'Customer', nameInput), suggest, h('div', { class: 'field' }, h('span', { class: 'label' }, 'Handled by *'), sc.el), rush),
    box('2 · Quantity', ed.parts.quantity),
    box('3 · Specials & price', ed.parts.deals),
    box('4 · Container type', ed.parts.types),
    delivery ? box('5 · Containers from the customer', ed.parts.swap) : null);

  /* payment + submit */
  const right = h('div', { class: 'stack sticky' });
  right.append(totalBox);
  const payCard = h('div', { class: 'card' });
  if (!delivery) {
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
        t.addEventListener('input', () => { draft.tendered = t.value; refresh(); });
        const q = h('div', { class: 'suggest' }, [null, 50, 100, 200, 500, 1000].map((v) => h('button', { type: 'button', class: 'chip', onclick: () => { draft.tendered = pesoInput(v == null ? ed.total() : v * 100); t.value = draft.tendered; refresh(); } }, v == null ? 'Exact' : `₱${v}`)));
        payCard.append(h('div', { class: 'field' }, h('p', { class: 'hint', style: { marginTop: 0 } }, 'Type the cash received and the change will show here. You can skip this.'), t, q, changeBox));
      } else {
        const r = h('input', { type: 'text', value: draft.ref, placeholder: 'Reference no. (optional)', maxLength: 60 });
        r.addEventListener('input', () => { draft.ref = r.value; });
        payCard.append(field('Reference', r));
      }
    } else payCard.append(h('p', { class: 'hint' }, 'The customer owes this amount. It shows under “Money owed” until collected.'));
  } else payCard.append(h('p', null, '💡 Payment is collected when the order is delivered.'));
  const note = h('input', { type: 'text', value: draft.note, maxLength: 300, placeholder: 'Note (optional)' });
  note.addEventListener('input', () => { draft.note = note.value; });
  payCard.append(field('Note', note));
  right.append(payCard, errEl, submit);

  submit.addEventListener('click', async () => {
    errEl.textContent = ''; submit.disabled = true;
    try { await place(ed); draft = freshDraft({ fulfillment: draft.fulfillment, staff: draft.staff }); hooks.goTo('orders'); }
    catch (e) { errEl.textContent = e.message; draft.error = e.message; } finally { submit.disabled = false; }
  });
  refresh();
  root.append(h('div', { class: 'counter-grid' }, left, right));
}

async function place(ed) {
  const s = S.state.settings;
  const delivery = draft.fulfillment === 'delivery';
  const name = draft.customer.trim();
  const g = ed.get();
  if (delivery && !name) throw new Error('Please enter the customer name for a delivery.');
  if (s.staff.some((x) => x.active !== false) && !draft.staff) throw new Error('Please choose who is handling this order.');
  let pay = null;
  if (!delivery) {
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
  let customerId = draft.customerId;
  const newCustomers = [];
  if (name && !O.isAnonymous(name)) {
    const existing = [...S.state.customers.values()].find((c) => O.normalizeName(c.name) === O.normalizeName(name));
    if (existing) customerId = existing.customer_id;
    else {
      const t = new Date().toISOString();
      customerId = newCustomerId(s.deviceCode);
      newCustomers.push({ customer_id: customerId, name, phone: '', address: '', note: '', lat: null, lng: null, created_at: t, updated_at: t });
    }
  }
  const { seq, day, orderNo } = S.nextOrderNo();
  const now = new Date().toISOString();
  const order = O.createOrder({
    customer_name: name, customer_id: customerId, fulfillment: draft.fulfillment, staff: draft.staff,
    deals: g.deals, regular_qty: g.regular_qty, unit_price: g.unit_price, price_label: g.price_label, containers: g.containers, empties_owed: g.empties_owed,
    pay, note: draft.note, priority: draft.priority
  }, { id: newOrderId(s.deviceCode, day), orderNo, now, rates: rates() });
  await S.save({ orders: [order], customers: newCustomers, meta: { [`seq:${day}`]: seq } });
  const undo = { label: 'Undo', onClick: async () => { try { await S.save({ orders: [O.voidOrder(S.state.orders.get(order.order_id), new Date().toISOString(), 'undone right after entry')] }); toast('Order removed.'); } catch (e) { toast(e.message, { kind: 'error' }); } } };
  const change = order.amount_tendered != null ? ` · change ${peso(order.amount_tendered - order.total_price)}` : '';
  toast(`Saved #${orderNo} · ${peso(order.total_price)}${change}`, { action: undo, ms: 7000, kind: 'ok' });
}

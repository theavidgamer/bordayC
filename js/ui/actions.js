// Everything a person can DO to an order, with the confirmation dialogs. Used by Board, Today and Books.
import { h } from './dom.js';
import { openModal, confirmModal, toast, stepper, choice, field } from './components.js';
import * as S from '../data/store.js';
import * as O from '../core/orders.js';
import { peso, toCentavos, pesoInput } from '../core/money.js';

const nowIso = () => new Date().toISOString();

export async function persist(order, okMsg) {
  try { await S.save({ orders: [order] }); if (okMsg) toast(okMsg, { kind: 'ok' }); return true; }
  catch (e) { toast(`Could not save: ${e.message}`, { kind: 'error', ms: 9000 }); return false; }
}

const label = (o) => `${o.customer_name} · ${peso(o.total_price)}`;

export async function advance(order) {
  const next = O.nextStatus(order);
  if (!next) return;
  if (next === 'paid') return openPayModal(order);
  try { await persist(O.setStatus(order, next, nowIso())); } catch (e) { toast(e.message, { kind: 'error' }); }
}

export function openPayModal(order) {
  const s = S.state.settings;
  const methods = [{ value: 'cash', label: 'Cash' }];
  if (s.acceptOtherPayments) methods.push({ value: 'gcash', label: 'GCash' }, { value: 'other', label: 'Other' });
  let method = 'cash';
  const tendered = h('input', { type: 'text', inputMode: 'decimal', placeholder: 'Cash received (optional)', 'aria-label': 'Cash received' });
  const ref = h('input', { type: 'text', placeholder: 'Reference no. (optional)', maxLength: 60 });
  const change = h('div', { class: 'change-box', hidden: true });
  const cashBox = h('div', null);
  const refBox = h('div', { hidden: true }, field('Reference', ref));
  const upd = () => {
    const t = toCentavos(tendered.value);
    if (!tendered.value.trim() || Number.isNaN(t)) { change.hidden = true; return; }
    change.hidden = false;
    const diff = t - order.total_price;
    change.textContent = diff >= 0 ? `Change: ${peso(diff)}` : `Short by ${peso(-diff)}`;
    change.classList.toggle('short', diff < 0);
  };
  tendered.addEventListener('input', upd);
  const quick = h('div', { class: 'suggest' }, [null, 50, 100, 200, 500, 1000].map((v) => h('button', {
    type: 'button', class: 'chip', onclick: () => { tendered.value = pesoInput(v == null ? order.total_price : v * 100); upd(); }
  }, v == null ? 'Exact' : `₱${v}`)));
  cashBox.append(tendered, quick, change);
  const mc = choice({ options: methods, value: 'cash', label: 'Payment method', onChange: (v) => { method = v || 'cash'; cashBox.hidden = method !== 'cash'; refBox.hidden = method === 'cash'; } });
  const body = h('div', null,
    h('div', { class: 'total-box' }, h('div', { class: 'muted' }, order.customer_name), h('div', { class: 'amt' }, peso(order.total_price))),
    methods.length > 1 ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Paid by'), mc.el) : null,
    h('div', { class: 'field' }, cashBox, refBox));
  openModal({
    title: 'Collect payment', body,
    actions: [{ label: 'Cancel' }, {
      label: 'Confirm paid', kind: 'primary',
      onClick: async ({ setError }) => {
        try {
          const pay = { method, ref: ref.value };
          if (method === 'cash' && tendered.value.trim()) {
            const t = toCentavos(tendered.value);
            if (Number.isNaN(t)) throw new Error('Cash received is not a valid amount.');
            pay.tendered = t;
          }
          const ok = await persist(O.setStatus(order, 'paid', nowIso(), { pay }), `Paid · ${label(order)}`);
          return ok;
        } catch (e) { setError(e.message); return false; }
      }
    }]
  });
}

export function openReturnModal(order) {
  const out = order.container_out_count;
  const st = stepper({ value: out, min: 1, max: out, label: 'Empties returned' });
  openModal({
    title: 'Empties came back', body: h('div', null, h('p', null, `${order.customer_name} still has ${out} empty container${out === 1 ? '' : 's'}.`), h('div', { class: 'field' }, h('span', { class: 'label' }, 'How many did they give back now?'), st.el)),
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async ({ setError }) => { try { return await persist(O.returnContainers(order, st.get(), nowIso()), 'Saved'); } catch (e) { setError(e.message); return false; } } }]
  });
}

export function openAmendModal(order) {
  const s = S.state.settings;
  const paid = !!order.paid_at;
  const name = h('input', { type: 'text', value: order.customer_name === 'no name' ? '' : order.customer_name, maxLength: 120, placeholder: 'Customer name' });
  const qty = stepper({ value: order.quantity, min: 1, max: 9999, onChange: () => recalc() });
  const total = h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(order.total_price) });
  let totalTouched = false;
  total.addEventListener('input', () => { totalTouched = true; });
  function recalc() { if (!totalTouched && !order.is_special) total.value = pesoInput(order.unit_price * qty.get()); }
  const riders = choice({ label: 'Rider', allowNone: true, value: order.rider, options: s.riders.filter((r) => r.active || r.key === order.rider).map((r) => ({ value: r.key, label: r.name })) });
  const ctypes = choice({ label: 'Container', allowNone: true, value: order.container_type, options: s.containerTypes.map((c) => ({ value: c.key, label: c.name })) });
  const cstat = choice({ label: 'Container status', value: order.container_status || 'swapped', options: [{ value: 'swapped', label: 'Swapped' }, { value: 'owed', label: 'Empties owed' }, { value: 'kept', label: 'Customer kept' }] });
  const owed = stepper({ value: order.container_out_count, min: 0, max: 9999, size: 'sm', label: 'Empties owed' });
  const method = choice({ label: 'Payment method', value: order.payment_method || 'cash', options: [{ value: 'cash', label: 'Cash' }, { value: 'gcash', label: 'GCash' }, { value: 'other', label: 'Other' }] });
  const note = h('input', { type: 'text', value: order.note || '', maxLength: 300, placeholder: 'Note' });
  const reason = h('input', { type: 'text', maxLength: 200, placeholder: 'Why are you changing this?' });
  const body = h('div', null,
    field('Customer', name), h('div', { class: 'field' }, h('span', { class: 'label' }, 'Quantity'), qty.el),
    field(order.is_special ? 'Total (special price)' : 'Total (₱)', total),
    order.fulfillment === 'delivery' ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Rider'), riders.el) : null,
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Container'), ctypes.el, h('div', { style: { marginTop: '.5rem' } }, cstat.el), h('div', { class: 'row', style: { marginTop: '.5rem' } }, h('span', { class: 'muted' }, 'Empties owed:'), owed.el)),
    paid ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Paid by'), method.el) : null,
    field('Note', note),
    paid ? field('Reason for change', reason, 'Changes to paid orders are recorded in the order history.') : null);
  openModal({
    title: `Edit order ${order.order_no || ''}`, body, wide: true,
    actions: [{ label: 'Cancel' }, {
      label: 'Save changes', kind: 'primary',
      onClick: async ({ setError }) => {
        try {
          const t = toCentavos(total.value);
          if (Number.isNaN(t)) throw new Error('Total is not a valid amount.');
          const patch = { customer_name: name.value, quantity: qty.get(), total_price: t, rider: order.fulfillment === 'delivery' ? riders.get() : null, container_type: ctypes.get(), container_status: cstat.get(), container_out_count: owed.get(), note: note.value };
          if (ctypes.get() && !order.container_type) patch.container_count = qty.get();
          if (paid) patch.payment_method = method.get();
          const next = O.amendOrder(order, patch, nowIso(), reason.value);
          if (next === order) return true;
          return await persist(next, 'Order updated');
        } catch (e) { setError(e.message); return false; }
      }
    }]
  });
}

export function cancelOrder(order) {
  confirmModal({
    title: 'Cancel this order?', message: `${label(order)}\nThe customer decided not to take it. It stays in your records as cancelled.`, okLabel: 'Yes, cancel order', kind: 'danger',
    onConfirm: async () => { try { return await persist(O.setStatus(order, 'cancelled', nowIso(), { reason: 'cancelled' }), 'Order cancelled'); } catch (e) { toast(e.message, { kind: 'error' }); return false; } }
  });
}

export function voidWithUndo(order) {
  const reason = h('input', { type: 'text', maxLength: 200, placeholder: 'Reason (e.g. typed wrong)' });
  openModal({
    title: 'Void this order?',
    body: h('div', null, h('p', null, label(order)), h('p', { class: 'hint' }, 'Use this for mistakes. It leaves the totals but stays in your records.'), field('Reason', reason)),
    actions: [{ label: 'Keep order' }, {
      label: 'Void order', kind: 'danger',
      onClick: async () => {
        const voided = O.voidOrder(order, nowIso(), reason.value);
        const ok = await persist(voided);
        if (ok) toast(`Voided ${label(order)}`, { action: { label: 'Undo', onClick: () => persist(O.unvoidOrder(S.state.orders.get(order.order_id) || voided, nowIso()), 'Restored') }, ms: 8000 });
        return ok;
      }
    }]
  });
}

export function openUnpayModal(order) {
  const reason = h('input', { type: 'text', maxLength: 200, placeholder: 'Reason' });
  openModal({
    title: 'Mark as NOT paid?',
    body: h('div', null, h('p', null, `${label(order)} will be removed from sales and become unpaid again.`), field('Reason (required)', reason)),
    actions: [{ label: 'Keep as paid' }, { label: 'Mark unpaid', kind: 'danger', onClick: async ({ setError }) => { try { return await persist(O.setStatus(order, 'delivered', nowIso(), { reason: reason.value }), 'Now unpaid'); } catch (e) { setError(e.message); return false; } } }]
  });
}

/** The "…" menu with the less common actions. */
export function openOrderMenu(order) {
  const items = [];
  const btn = (text, fn, kind = '') => h('button', { class: `btn block ${kind}`, style: { marginTop: '.5rem', justifyContent: 'flex-start' }, onclick: () => { m.close(); fn(); } }, text);
  if (!order.voided_at) {
    items.push(btn('✏️ Edit order', () => openAmendModal(order)));
    if (O.owesContainers(order)) items.push(btn('🫙 Empties came back', () => openReturnModal(order)));
    if (order.status === 'paid') items.push(btn('↩️ Mark as not paid', () => openUnpayModal(order)));
    else if (order.status === 'cancelled') items.push(btn('♻️ Re-open order', async () => persist(O.setStatus(order, 'not_started', nowIso()), 'Re-opened')));
    else {
      const prev = O.FLOW[O.FLOW.indexOf(order.status) - 1];
      if (prev && order.fulfillment === 'delivery') items.push(btn(`⬅️ Back to “${O.STATUS_LABEL[prev]}”`, async () => persist(O.setStatus(order, prev, nowIso()))));
      items.push(btn('🚫 Cancel order', () => cancelOrder(order)));
    }
    items.push(btn('🗑️ Void (mistake)', () => voidWithUndo(order), 'danger'));
  } else items.push(btn('♻️ Restore voided order', () => persist(O.unvoidOrder(order, nowIso()), 'Restored')));
  const m = openModal({ title: `${order.customer_name} · ${peso(order.total_price)}`, body: h('div', null, h('p', { class: 'muted' }, `${order.quantity} × container · ${O.STATUS_LABEL[order.status]}${order.order_no ? ' · #' + order.order_no : ''}`), ...items) });
}

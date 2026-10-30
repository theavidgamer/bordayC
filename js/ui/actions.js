// Everything a person can DO to an order, with confirmation dialogs. Used by Orders, Customers, Books.
import { h } from './dom.js';
import { openModal, confirmModal, toast, stepper, choice, field } from './components.js';
import * as S from '../data/store.js';
import * as O from '../core/orders.js';
import * as T from '../core/timers.js';
import { peso, toCentavos, pesoInput } from '../core/money.js';
import { prettyTime, shortDate, dateKey } from '../core/dates.js';
import { linesEditor } from './lines.js';
import { hooks } from './bus.js';
import { rates, staffName, typeTags, lineSummary, typeInfo, fulfillLabel } from './view.js';

const nowIso = () => new Date().toISOString();
const label = (o) => `${o.customer_name} · ${peso(o.total_price)}`;

export async function persist(order, okMsg) {
  try { await S.save({ orders: [order] }); if (okMsg) toast(okMsg, { kind: 'ok' }); return true; }
  catch (e) { toast(`Could not save: ${e.message}`, { kind: 'error', ms: 9000 }); return false; }
}

/** Short label for the one big button on a row. null = nothing left to do. */
export function nextAction(o) {
  if (o.voided_at || o.status === 'cancelled') return null;
  if (O.owesContainers(o) && o.status === 'paid') return { id: 'empties', label: '🫙 Containers' };
  const next = O.nextStatus(o);
  if (!next) return null;
  return { id: next, label: { preparing: '👨‍🍳 Start', otw: '🛵 Out', delivered: '📦 Delivered', paid: '💵 Collect' }[next] || 'Next' };
}

export async function doNext(order) {
  const a = nextAction(order);
  if (!a) return;
  if (a.id === 'empties') return openEmptiesModal(order);
  if (a.id === 'paid') return openPayModal(order);
  try { await persist(O.setStatus(order, a.id, nowIso(), { rates: rates() })); } catch (e) { toast(e.message, { kind: 'error' }); }
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
  const quick = h('div', { class: 'suggest' }, [null, 50, 100, 200, 500, 1000].map((v) => h('button', { type: 'button', class: 'chip', onclick: () => { tendered.value = pesoInput(v == null ? order.total_price : v * 100); upd(); } }, v == null ? 'Exact' : `₱${v}`)));
  cashBox.append(tendered, quick, change);
  const mc = choice({ options: methods, value: 'cash', label: 'Payment method', onChange: (v) => { method = v || 'cash'; cashBox.hidden = method !== 'cash'; refBox.hidden = method === 'cash'; } });
  openModal({
    title: 'Collect payment',
    body: h('div', null, h('div', { class: 'total-box' }, h('div', { class: 'muted' }, order.customer_name), h('div', { class: 'amt' }, peso(order.total_price))),
      methods.length > 1 ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Paid by'), mc.el) : null, h('div', { class: 'field' }, cashBox, refBox)),
    actions: [{ label: 'Cancel' }, {
      label: 'Confirm paid', kind: 'primary',
      onClick: async ({ setError }) => {
        try {
          const pay = { method, ref: ref.value };
          if (method === 'cash' && tendered.value.trim()) { const t = toCentavos(tendered.value); if (Number.isNaN(t)) throw new Error('Cash received is not a valid amount.'); pay.tendered = t; }
          return await persist(O.setStatus(order, 'paid', nowIso(), { pay, rates: rates() }), `Paid · ${label(order)}`);
        } catch (e) { setError(e.message); return false; }
      }
    }]
  });
}

export function openEmptiesModal(order) {
  const steps = {};
  const rows = Object.entries(order.empties_owed).filter(([, n]) => n > 0).map(([k, n]) => {
    const sp = stepper({ value: n, min: 0, max: n, size: 'sm', label: `${typeInfo(k).name} containers returned` });
    steps[k] = sp;
    return h('div', { class: 'row', style: { marginTop: '.5rem' } }, h('span', { class: 'type-label' }, `${typeInfo(k).icon} ${typeInfo(k).name} (still out: ${n})`), sp.el);
  });
  openModal({
    title: 'Containers came back',
    body: h('div', null, h('p', null, `${order.customer_name} still has ${O.sumObj(order.empties_owed)} of our container(s).`), h('p', { class: 'hint' }, 'How many did they give back now?'), ...rows),
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async ({ setError }) => {
      try { const ret = Object.fromEntries(Object.entries(steps).map(([k, sp]) => [k, sp.get()])); return await persist(O.returnEmpties(order, ret, nowIso()), 'Saved'); } catch (e) { setError(e.message); return false; }
    } }]
  });
}

export function openAmendModal(order) {
  const s = S.state.settings;
  const paid = !!order.paid_at;
  const name = h('input', { type: 'text', value: O.isAnonymous(order.customer_name) ? '' : order.customer_name, maxLength: 120, placeholder: 'Customer name' });
  const staff = choice({ label: 'Handled by', value: order.staff, options: s.staff.filter((x) => x.active || x.key === order.staff).map((x) => ({ value: x.key, label: x.name })) });
  const totalInput = h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(order.total_price) });
  let totalTouched = false;
  totalInput.addEventListener('input', () => { totalTouched = true; });
  const ed = linesEditor({ deals: order.deals, regular_qty: order.regular_qty, unit_price: order.unit_price, containers: order.containers, empties_owed: order.empties_owed }, {
    fulfillment: order.fulfillment, onChange: () => { if (!totalTouched) totalInput.value = pesoInput(ed.total()); }
  });
  const method = choice({ label: 'Paid by', value: order.payment_method || 'cash', options: [{ value: 'cash', label: 'Cash' }, { value: 'gcash', label: 'GCash' }, { value: 'other', label: 'Other' }] });
  const note = h('input', { type: 'text', value: order.note || '', maxLength: 300, placeholder: 'Note' });
  const reason = h('input', { type: 'text', maxLength: 200, placeholder: 'Why are you changing this?' });
  openModal({
    title: `Edit order ${order.order_no || ''}`, wide: true,
    body: h('div', null, field('Customer', name), h('div', { class: 'field' }, h('span', { class: 'label' }, 'Handled by'), staff.el), ed.el,
      field('Total (₱) — change only if the price was different', totalInput),
      paid ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Paid by'), method.el) : null, field('Note', note),
      paid ? field('Reason for change', reason, 'Changes to paid orders are recorded in the order history.') : null),
    actions: [{ label: 'Cancel' }, { label: 'Save changes', kind: 'primary', onClick: async ({ setError }) => {
      try {
        const t = toCentavos(totalInput.value);
        if (Number.isNaN(t)) throw new Error('Total is not a valid amount.');
        const g = ed.get();
        const patch = { customer_name: name.value, staff: staff.get(), ...g, note: note.value };
        if (totalTouched || t !== ed.total()) patch.total_price = t;
        if (paid) patch.payment_method = method.get();
        const next = O.amendOrder(order, patch, nowIso(), reason.value);
        if (next === order) return true;
        return await persist(next, 'Order updated');
      } catch (e) { setError(e.message); return false; }
    } }]
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
    body: h('div', null, h('p', null, label(order)), h('p', { class: 'hint' }, 'Use this for mistakes. It leaves the totals (and the staff incentive) but stays in your records.'), field('Reason', reason)),
    actions: [{ label: 'Keep order' }, { label: 'Void order', kind: 'danger', onClick: async () => {
      const voided = O.voidOrder(order, nowIso(), reason.value);
      const ok = await persist(voided);
      if (ok) toast(`Voided ${label(order)}`, { action: { label: 'Undo', onClick: () => persist(O.unvoidOrder(S.state.orders.get(order.order_id) || voided, nowIso()), 'Restored') }, ms: 8000 });
      return ok;
    } }]
  });
}

export function openUnpayModal(order) {
  const reason = h('input', { type: 'text', maxLength: 200, placeholder: 'Reason' });
  openModal({
    title: 'Mark as NOT paid?',
    body: h('div', null, h('p', null, `${label(order)} will be removed from collected money and become unpaid again.`), field('Reason (required)', reason)),
    actions: [{ label: 'Keep as paid' }, { label: 'Mark unpaid', kind: 'danger', onClick: async ({ setError }) => { try { return await persist(O.setStatus(order, 'delivered', nowIso(), { reason: reason.value, rates: rates() }), 'Now unpaid'); } catch (e) { setError(e.message); return false; } } }]
  });
}

export const toggleRush = (order) => persist(O.setPriority(order, !order.priority, nowIso()), order.priority ? 'Rush removed' : '🔥 Marked as RUSH');

/** The window that opens when a row is tapped. */
export function openOrderWindow(orderIn) {
  const order = S.state.orders.get(orderIn.order_id) || orderIn;
  const s = S.state.settings, tz = s.timezone;
  const act = nextAction(order);
  const m = { close: () => {} };
  const btn = (text, fn, kind = '') => h('button', { class: `btn block ${kind}`, style: { marginTop: '.5rem', justifyContent: 'flex-start' }, onclick: () => { m.close(); fn(); } }, text);
  const detail = (k, v) => h('div', { class: 'item' }, h('span', { class: 'muted' }, k), h('span', { style: { textAlign: 'right' } }, v));
  const tl = T.timeline(order);
  const body = h('div', null,
    h('div', { class: 'row between' }, h('button', { class: 'linklike', onclick: () => { m.close(); hooks.openCustomer(order.customer_name, order.customer_id); } }, `👤 ${order.customer_name}`), h('strong', { class: 'num', style: { fontSize: '1.4rem' } }, peso(order.total_price))),
    h('div', { class: 'list', style: { marginTop: '.4rem' } },
      detail('Type', `${fulfillLabel(order.fulfillment)}${order.priority ? ' · 🔥 RUSH' : ''}`), detail('Handled by', staffName(order.staff)),
      detail('Order', lineSummary(order) || '–'), detail('Quantity', h('span', null, `${order.quantity} `, typeTags(order.containers))),
      order.fulfillment === 'delivery' ? detail('Containers', O.sumObj(order.empties_owed) ? h('span', null, 'Still out: ', typeTags(order.empties_owed)) : (order.empties_short ? 'All back' : 'Swapped')) : null,
      order.payment_method ? detail('Paid by', `${O.METHOD_LABEL[order.payment_method]}${order.payment_ref ? ' · ' + order.payment_ref : ''}`) : null,
      order.note ? detail('Note', order.note) : null),
    h('h3', { style: { margin: '.9rem 0 .2rem' } }, 'Times'),
    h('div', { class: 'list' }, tl.map((x) => detail(x.label, `${prettyTime(x.at, tz)}${dateKey(x.at, tz) !== dateKey(order.created_at, tz) ? ' · ' + shortDate(dateKey(x.at, tz)) : ''}`))),
    order.edits?.length ? h('p', { class: 'hint' }, `Edited ${order.edits.length} time(s) after payment.`) : null,
    h('div', { style: { marginTop: '.8rem' } },
      act ? btn(`${act.label}${act.id === 'paid' ? ' · ' + peso(order.total_price) : ''}`, () => doNext(order), 'primary') : null,
      !order.voided_at && order.status !== 'cancelled' && !['paid'].includes(order.status) ? btn(order.priority ? '🔥 Remove RUSH' : '🔥 Mark as RUSH (put on top)', () => toggleRush(order)) : null,
      !order.voided_at && O.owesContainers(order) && act?.id !== 'empties' ? btn('🫙 Containers came back', () => openEmptiesModal(order)) : null,
      !order.voided_at ? btn('✏️ Edit order', () => openAmendModal(order)) : null,
      order.status === 'paid' && !order.voided_at ? btn('↩️ Mark as not paid', () => openUnpayModal(order)) : null,
      order.status === 'cancelled' ? btn('♻️ Re-open order', () => persist(O.setStatus(order, 'not_started', nowIso()), 'Re-opened')) : null,
      !order.voided_at && !['paid', 'cancelled'].includes(order.status) ? btn('⬅️ Go back one step', () => {
        const prev = O.FLOW[O.FLOW.indexOf(order.status) - 1]; if (prev) persist(O.setStatus(order, prev, nowIso(), { rates: rates() }));
      }) : null,
      !order.voided_at && !['paid', 'cancelled'].includes(order.status) ? btn('🚫 Cancel order', () => cancelOrder(order)) : null,
      !order.voided_at ? btn('🗑️ Void (entered by mistake)', () => voidWithUndo(order), 'danger') : btn('♻️ Restore voided order', () => persist(O.unvoidOrder(order, nowIso()), 'Restored'))));
  const handle = openModal({ title: `${order.order_no ? '#' + order.order_no + ' · ' : ''}${O.STATUS_LABEL[order.status]}`, body, wide: false });
  m.close = handle.close;
}
hooks.openOrder = openOrderWindow;

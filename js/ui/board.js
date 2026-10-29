import { h, clear } from './dom.js';
import { choice, emptyState, badge } from './components.js';
import * as S from '../data/store.js';
import * as O from '../core/orders.js';
import * as A from './actions.js';
import { peso } from '../core/money.js';
import { ago, prettyTime } from '../core/dates.js';

let riderFilter = 'all';
const NEXT_LABEL = { not_started: '👨‍🍳 Start preparing', preparing: '🛵 Out for delivery', otw: '📦 Mark delivered', delivered: '💵 Collect payment' };

export function orderCard(o, { showStatus = true } = {}) {
  const s = S.state.settings;
  const riderName = s.riders.find((r) => r.key === o.rider)?.name || (o.rider ? o.rider : null);
  const mins = (Date.now() - new Date(o.created_at).getTime()) / 60000;
  const inTransit = ['not_started', 'preparing', 'otw'].includes(o.status) && o.fulfillment === 'delivery';
  const late = inTransit && mins > s.lateMinutes;
  const owes = O.owesContainers(o);
  const next = O.nextStatus(o);
  const ctype = s.containerTypes.find((c) => c.key === o.container_type)?.name;
  const actions = h('div', { class: 'actions' });
  if (o.status === 'paid' && owes) actions.append(h('button', { class: 'btn primary', onclick: () => A.openReturnModal(o) }, '🫙 Empties came back'));
  else if (next) actions.append(h('button', { class: 'btn primary', onclick: () => A.advance(o) }, o.status === 'delivered' ? `${NEXT_LABEL.delivered} · ${peso(o.total_price)}` : NEXT_LABEL[o.status] || 'Next'));
  actions.append(h('button', { class: 'btn', 'aria-label': 'More actions', onclick: () => A.openOrderMenu(o) }, '⋯'));
  return h('article', { class: `order ${o.status} ${late ? 'late' : ''}` },
    h('div', { class: 'row between' }, h('div', { class: 'name' }, o.customer_name), h('div', { class: 'amt num' }, peso(o.total_price))),
    h('div', { class: 'meta' },
      o.order_no ? h('span', null, `#${o.order_no}`) : null,
      h('span', null, `${o.quantity} × ${o.is_special ? o.special_name : 'refill'}`),
      riderName ? h('span', null, `🛵 ${riderName}`) : o.fulfillment === 'walkin' ? h('span', null, '🏪 Walk-in') : h('span', null, '⚠️ No rider'),
      h('span', null, `🕒 ${prettyTime(o.created_at, s.timezone)} · ${ago(o.created_at)}`)),
    (owes || ctype) ? h('div', { class: 'meta' }, ctype ? h('span', null, `🫙 ${ctype}`) : null, owes ? badge(`${o.container_out_count} empt${o.container_out_count === 1 ? 'y' : 'ies'} owed`, 'warn') : null) : null,
    o.note ? h('div', { class: 'meta' }, h('span', null, `📝 ${o.note}`)) : null,
    h('div', { class: 'row' }, showStatus ? badge(O.STATUS_LABEL[o.status], o.status) : null, late ? badge(`Late · over ${s.lateMinutes} min`, 'bad') : null),
    actions);
}

export function boardOrders() {
  return [...S.state.orders.values()].filter(O.onBoard);
}

export function renderBoard(root) {
  clear(root);
  const s = S.state.settings;
  const all = boardOrders();
  root.append(h('div', { class: 'page-title' }, h('h1', null, 'Order Board'), h('span', { class: 'muted' }, `${all.length} open`)));

  const riders = s.riders.filter((r) => r.active || all.some((o) => o.rider === r.key));
  if (riders.length > 1) {
    const f = choice({ label: 'Filter by rider', value: riderFilter, options: [{ value: 'all', label: 'All' }, ...riders.map((r) => ({ value: r.key, label: r.name })), { value: 'none', label: 'Walk-in' }], onChange: (v) => { riderFilter = v || 'all'; renderBoard(root); } });
    f.el.classList.add('filters');
    root.append(f.el);
  }
  const shown = all.filter((o) => riderFilter === 'all' || (riderFilter === 'none' ? !o.rider : o.rider === riderFilter));
  if (!shown.length) { root.append(emptyState('Nothing waiting 🎉', 'New orders from the Counter will appear here.')); return; }

  const byAge = (a, b) => new Date(a.created_at) - new Date(b.created_at);
  const groups = [
    ['To deliver', shown.filter((o) => ['not_started', 'preparing', 'otw'].includes(o.status)).sort(byAge)],
    ['Delivered – waiting for payment', shown.filter((o) => o.status === 'delivered').sort(byAge)],
    ['Paid – empties still out', shown.filter((o) => o.status === 'paid').sort(byAge)]
  ];
  for (const [title, list] of groups) {
    if (!list.length) continue;
    root.append(h('div', { class: 'section-h' }, h('span', null, title), badge(String(list.length))), h('div', { class: 'cards' }, list.map((o) => orderCard(o))));
  }
}

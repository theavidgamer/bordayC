// Customers tab: list, quick window (from tapping a name anywhere) and the full profile.
import { h, clear } from './dom.js';
import { openModal, toast, field, emptyState, badge, confirmModal } from './components.js';
import * as S from '../data/store.js';
import * as O from '../core/orders.js';
import * as R from '../core/reports.js';
import * as A from '../core/analytics.js';
import { peso } from '../core/money.js';
import { prettyDate, daysBetween, dateKey } from '../core/dates.js';
import { newCustomerId } from '../core/ids.js';
import { orderTable } from './orderTable.js';
import { typeTags } from './view.js';
import { hooks } from './bus.js';
import { prefillCounter } from './counter.js';
import { locationCard, fromStation, distanceText, pinOf } from './place.js';
import { googleMapsUrl } from '../core/geo.js';

let profileId = null, q = '';
export const setProfile = (id) => { profileId = id; };

const sameCustomer = (c) => (o) => o.customer_id === c.customer_id || (!o.customer_id && O.normalizeName(o.customer_name) === O.normalizeName(c.name));
export const customerOrders = (c) => [...S.state.orders.values()].filter(sameCustomer(c)).sort(R.byTaken);
export const findCustomer = (name, id) => (id && S.state.customers.get(id)) || [...S.state.customers.values()].find((c) => O.normalizeName(c.name) === O.normalizeName(name)) || null;

export function customerStats(c) {
  const tz = S.state.settings.timezone, today = S.today();
  const mine = customerOrders(c), counted = mine.filter(O.isCounted);
  const owed = mine.filter((o) => !o.voided_at && o.status === 'delivered');
  const out = {};
  for (const o of mine) if (O.owesContainers(o)) for (const [t, n] of Object.entries(o.empties_owed)) if (n > 0) out[t] = (out[t] || 0) + n;
  const days = [...new Set(counted.map((o) => dateKey(o.created_at, tz)))].sort();
  const pred = A.reorderPredictions(mine, today, tz, { minOrders: 3 })[0] || null;
  return {
    mine, orders: counted.length, containers: counted.reduce((a, o) => a + o.quantity, 0),
    spent: counted.filter(O.isPaid).reduce((a, o) => a + o.total_price, 0),
    owedAmount: owed.reduce((a, o) => a + o.total_price, 0), owedCount: owed.length, out, outTotal: O.sumObj(out),
    last: days.length ? days[days.length - 1] : null, sinceLast: days.length ? daysBetween(days[days.length - 1], today) : null, pred
  };
}

/** Quick window: tap a customer name anywhere. */
export function openCustomerQuick(name, id) {
  const c = findCustomer(name, id);
  if (!c) { // walk-in without a name: nothing to show beyond the order itself
    openModal({ title: name || 'No name', body: h('p', { class: 'muted' }, 'This order has no customer name, so there is no profile. You can add a name by opening the order and tapping Edit.') });
    return;
  }
  const st = customerStats(c);
  const line = (k, v) => h('div', { class: 'item' }, h('span', null, k), h('strong', null, v));
  const body = h('div', { class: 'stack' },
    h('div', { class: 'list' },
      c.phone ? line('📞 Phone', c.phone) : null, c.address ? line('🏠 Address', c.address) : null,
      fromStation(c) ? line('📍 From the station', distanceText(fromStation(c))) : (pinOf(c) ? line('📍 Location', 'Pinned') : null),
      line('Orders', `${st.orders} · quantity ${st.containers}`), line('Last order', st.last ? `${prettyDate(st.last)} (${st.sinceLast === 0 ? 'today' : st.sinceLast + ' d ago'})` : '—'),
      line('Owes money', st.owedAmount ? peso(st.owedAmount) : 'No'), line('Containers out', st.outTotal ? String(st.outTotal) : 'None')),
    st.outTotal ? h('div', null, typeTags(st.out)) : null, c.note ? h('p', { class: 'hint' }, `📝 ${c.note}`) : null);
  const m = openModal({
    title: c.name, body, actions: [
      { label: '＋ New order', kind: 'primary', onClick: () => { prefillCounter(c); hooks.goTo('counter'); } },
      ...(pinOf(c) ? [{ label: '🧭 Map', onClick: () => { window.open(googleMapsUrl(pinOf(c)), '_blank', 'noopener'); return false; } }] : []),
      { label: 'Full profile →', onClick: () => { profileId = c.customer_id; hooks.goTo('customers'); } }
    ]
  });
  return m;
}
hooks.openCustomer = openCustomerQuick;
hooks.openProfile = (id) => { profileId = id; hooks.goTo('customers'); };

function openEditModal(c, after) {
  const name = h('input', { type: 'text', value: c?.name || '', maxLength: 120 }), phone = h('input', { type: 'tel', value: c?.phone || '', maxLength: 40 });
  const address = h('input', { type: 'text', value: c?.address || '', maxLength: 200, placeholder: 'Street, landmark…' }), note = h('input', { type: 'text', value: c?.note || '', maxLength: 300 });
  openModal({
    title: c ? 'Edit customer' : 'Add customer', body: h('div', { class: 'stack' }, field('Name', name), field('Phone', phone), field('Address', address), field('Note', note)),
    actions: [{ label: 'Cancel' }, {
      label: 'Save', kind: 'primary', onClick: async ({ setError }) => {
        const nm = name.value.trim();
        if (!nm || O.isAnonymous(nm)) { setError('Please type a name.'); return false; }
        const dup = [...S.state.customers.values()].find((x) => x.customer_id !== c?.customer_id && O.normalizeName(x.name) === O.normalizeName(nm));
        if (dup) { setError('There is already a customer with that name.'); return false; }
        const now = new Date().toISOString();
        const rec = c ? { ...c, name: nm, phone: phone.value.trim(), address: address.value.trim(), note: note.value.trim(), updated_at: now }
          : { customer_id: newCustomerId(S.state.settings.deviceCode), name: nm, phone: phone.value.trim(), address: address.value.trim(), note: note.value.trim(), lat: null, lng: null, created_at: now, updated_at: now };
        // keep order pages readable if the name changed
        const renamed = c && c.name !== nm ? customerOrders(c).map((o) => ({ ...o, customer_name: nm, customer_id: c.customer_id, updated_at: now })) : [];
        await S.save({ customers: [rec], orders: renamed });
        toast('Saved', { kind: 'ok' }); after?.(rec);
      }
    }]
  });
}

export function renderCustomers(root) {
  clear(root);
  if (profileId && S.state.customers.has(profileId)) return renderProfile(root, S.state.customers.get(profileId));
  profileId = null;
  const tz = S.state.settings.timezone, today = S.today();
  root.append(h('div', { class: 'page-title' }, h('h1', null, 'Customers'), h('button', { class: 'btn primary', onclick: () => openEditModal(null, (c) => { profileId = c.customer_id; renderCustomers(root); }) }, '＋ Add customer')));
  const all = [...S.state.customers.values()];
  const rows = all.map((c) => ({ c, st: customerStats(c) }));
  const filters = { all: 'All', owes: 'Owes money', empties: 'Containers out' };
  let f = 'all';
  const search = h('input', { type: 'search', placeholder: '🔎 Find a customer or phone', value: q, 'aria-label': 'Find a customer' });
  const host = h('div', null);
  const chips = h('div', { class: 'suggest filters' }, Object.entries(filters).map(([k, label]) => h('button', { type: 'button', class: `chip ${k === f ? 'on' : ''}`, onclick: (e) => { f = k; [...chips.children].forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); paint(); } }, label)));
  search.addEventListener('input', () => { q = search.value; paint(); });
  root.append(h('div', { class: 'row between', style: { marginBottom: '.7rem' } }, chips, h('div', { style: { flex: '1 1 220px', maxWidth: '340px' } }, search)), host);
  function paint() {
    clear(host);
    const n = O.normalizeName(q);
    const list = rows.filter(({ c, st }) => (!n || O.normalizeName(c.name).includes(n) || (c.phone || '').includes(q.trim())) && (f === 'all' || (f === 'owes' && st.owedAmount > 0) || (f === 'empties' && st.outTotal > 0)))
      .sort((a, b) => (b.st.last || '').localeCompare(a.st.last || '') || a.c.name.localeCompare(b.c.name));
    if (!list.length) { host.append(emptyState(all.length ? 'Nobody matches' : 'No customers yet', all.length ? '' : 'Customers are added automatically when you type a name on a new order.')); return; }
    const body = h('tbody', null, list.map(({ c, st }) => h('tr', { class: 'orow', tabIndex: 0, onclick: () => { profileId = c.customer_id; renderCustomers(root); window.scrollTo(0, 0); }, onkeydown: (e) => { if (e.key === 'Enter') { profileId = c.customer_id; renderCustomers(root); } } },
      h('td', { class: 'c-cust' }, h('strong', null, c.name, pinOf(c) ? ' 📍' : ''), h('div', { class: 'muted small' }, [c.phone, c.address].filter(Boolean).join(' · ') || '')),
      h('td', { class: 'wide' }, `${st.orders} order${st.orders === 1 ? '' : 's'}`), h('td', { class: 'wide' }, st.last ? (st.sinceLast === 0 ? 'today' : `${st.sinceLast} d ago`) : '—'),
      h('td', null, st.owedAmount ? h('span', { class: 'tag warn' }, `Owes ${peso(st.owedAmount)}`) : h('span', { class: 'muted' }, '–')),
      h('td', null, st.outTotal ? h('span', { class: 'tag warn' }, `⚠ ${st.outTotal} containers`) : h('span', { class: 'muted' }, '–')))));
    host.append(h('div', { class: 'table-wrap book' }, h('table', { class: 'ledger' }, h('thead', null, h('tr', null, h('th', { class: 'c-cust' }, 'Customer'), h('th', { class: 'wide' }, 'Orders'), h('th', { class: 'wide' }, 'Last order'), h('th', null, 'Money owed'), h('th', null, 'Containers out'))), body)));
  }
  paint();
}

function renderProfile(root, c) {
  const st = customerStats(c);
  const tz = S.state.settings.timezone;
  root.append(h('div', { class: 'row', style: { marginBottom: '.6rem' } }, h('button', { class: 'btn', onclick: () => { profileId = null; renderCustomers(root); } }, '← All customers')));
  root.append(h('div', { class: 'page-title' }, h('h1', null, c.name),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => { prefillCounter(c); hooks.goTo('counter'); } }, '＋ New order'), h('button', { class: 'btn', onclick: () => openEditModal(c, () => renderCustomers(root)) }, '✏️ Edit'))));
  root.append(h('div', { class: 'card' }, h('div', { class: 'foot-grid' },
    h('div', null, h('div', { class: 'k' }, 'Phone'), h('div', null, c.phone || '—')), h('div', null, h('div', { class: 'k' }, 'Address'), h('div', null, c.address || '—')), h('div', null, h('div', { class: 'k' }, 'Note'), h('div', null, c.note || '—'))),
    ));
  root.append(locationCard(c, () => renderCustomers(root)));
  const kpi = (k, v, sub) => h('div', { class: 'kpi' }, h('div', { class: 'k' }, k), h('div', { class: 'v num' }, v), sub ? h('div', { class: 'hint' }, sub) : null);
  root.append(h('div', { class: 'kpis stats', style: { marginTop: '.8rem' } },
    kpi('Orders', String(st.orders), `quantity ${st.containers}`), kpi('Total paid', peso(st.spent)), kpi('Money owed', peso(st.owedAmount), st.owedCount ? `${st.owedCount} order(s)` : ''), kpi('Containers out', String(st.outTotal)),
    kpi('Last order', st.last ? (st.sinceLast === 0 ? 'Today' : `${st.sinceLast} d ago`) : '—', st.pred ? `Usually every ~${st.pred.typicalGapDays} days` : '')));
  if (st.outTotal) root.append(h('p', null, 'Containers still with this customer: ', typeTags(st.out)));
  root.append(h('div', { class: 'section-h' }, h('span', null, 'Order history'), badge(String(st.mine.length))));
  if (!st.mine.length) root.append(emptyState('No orders yet', ''));
  else root.append(orderTable(st.mine.slice().reverse().map((o) => ({ n: null, order: o })), { showDate: true }));
  root.append(h('div', { class: 'row noprint', style: { marginTop: '1rem' } }, h('button', { class: 'btn danger', onclick: () => {
    if (st.mine.length) return toast('This customer has orders, so they cannot be deleted.', { kind: 'error' });
    confirmModal({ title: 'Delete customer?', message: `Remove ${c.name}?`, okLabel: 'Delete', kind: 'danger', onConfirm: async () => { await S.save({ deleteCustomers: [c.customer_id] }); profileId = null; renderCustomers(root); } });
  } }, 'Delete customer')));
}

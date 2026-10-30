// Orders tab: the notebook page for a chosen day (default today), as a table.
import { h, clear } from './dom.js';
import { choice, emptyState, badge, toast } from './components.js';
import * as S from '../data/store.js';
import * as O from '../core/orders.js';
import * as R from '../core/reports.js';
import * as X from '../core/exchange.js';
import { peso } from '../core/money.js';
import { addDays, prettyDate } from '../core/dates.js';
import { orderTable } from './orderTable.js';
import { typeTags } from './view.js';
import { hooks } from './bus.js';
import { openEndDay } from './endday.js';
import { deliverFile } from './files.js';

let day = null, filter = 'all', q = '';
export const setOrdersDay = (d) => { day = d; };

export function ordersFor(dayKey) {
  const tz = S.state.settings.timezone;
  const all = [...S.state.orders.values()];
  const t = R.dayTotals(all, [...S.state.expenses.values()], [...S.state.closes.values()], tz, dayKey);
  const carried = dayKey === S.today() ? R.carriedOver(all, tz, dayKey) : [];
  return { all, t, carried };
}

export function renderOrders(root) {
  clear(root);
  const s = S.state.settings, tz = s.timezone, today = S.today();
  if (!day) day = today;
  const { all, t, carried } = ordersFor(day);
  const isToday = day === today;
  const go = (d) => { day = d; renderOrders(root); };

  /* header: date navigator + actions */
  const dateInput = h('input', { type: 'date', value: day, 'aria-label': 'Choose day', onchange: (e) => { if (e.target.value) go(e.target.value); } });
  root.append(h('div', { class: 'page-title' }, h('h1', null, isToday ? 'Today’s order page' : 'Order page'), h('span', { class: 'muted' }, prettyDate(day))));
  root.append(h('div', { class: 'row between', style: { marginBottom: '.7rem' } },
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => go(addDays(day, -1)), 'aria-label': 'Previous day' }, '◀ Back'), dateInput, h('button', { class: 'btn small', onclick: () => go(addDays(day, 1)), 'aria-label': 'Next day' }, 'Next ▶'),
      !isToday ? h('button', { class: 'btn small soft', onclick: () => go(today) }, 'Today') : null),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => hooks.goTo('counter') }, '＋ New order'), h('button', { class: 'btn', onclick: () => window.print() }, '🖨 Print'))));

  /* stats strip */
  const owed = R.receivables(all, today, tz);
  const open = all.filter((o) => O.isUnfinished(o));
  const toDeliver = open.filter((o) => ['not_started', 'preparing', 'otw'].includes(o.status)).length;
  const stat = (k, v, sub, cls = '') => h('div', { class: `kpi ${cls}` }, h('div', { class: 'k' }, k), h('div', { class: 'v num' }, v), sub ? h('div', { class: 'hint' }, sub) : null);
  root.append(h('div', { class: 'kpis stats' },
    stat('Sales taken', peso(t.salesTaken), `${t.count} order${t.count === 1 ? '' : 's'} · ${t.containers} containers`),
    stat('Collected', peso(t.collectedTotal), t.collected.gcash ? `Cash ${peso(t.collected.cash)} · GCash ${peso(t.collected.gcash)}` : 'Money received'),
    stat('To deliver now', String(toDeliver), null, toDeliver ? 'attn' : ''),
    stat('Money owed', peso(owed.reduce((a, g) => a + g.amount, 0)), `${owed.length} customer${owed.length === 1 ? '' : 's'}`),
    stat('Empties out', String(R.containersOwed(all, today, tz).reduce((a, g) => a + g.out, 0)), 'with customers')));

  /* filters */
  const f = choice({ label: 'Show', value: filter, options: [{ value: 'all', label: 'All' }, { value: 'open', label: 'Unfinished' }, { value: 'done', label: 'Done' }], onChange: (v) => { filter = v || 'all'; renderOrders(root); } });
  f.el.classList.add('filters');
  const search = h('input', { type: 'search', placeholder: '🔎 Find a customer', value: q, 'aria-label': 'Find a customer' });
  search.addEventListener('input', () => { q = search.value; paintTable(); });
  root.append(h('div', { class: 'row between', style: { margin: '.9rem 0 .5rem' } }, f.el, h('div', { style: { flex: '1 1 220px', maxWidth: '340px' } }, search)));

  const tableHost = h('div', null);
  root.append(tableHost);

  function keep(o) {
    if (q.trim() && !O.normalizeName(o.customer_name).includes(O.normalizeName(q))) return false;
    if (filter === 'open') return O.isUnfinished(o);
    if (filter === 'done') return !O.isUnfinished(o);
    return true;
  }
  const rushFirst = (a, b) => (b.order.priority && !O.isVoided(b.order) ? 1 : 0) - (a.order.priority && !O.isVoided(a.order) ? 1 : 0);

  function paintTable() {
    clear(tableHost);
    const now = Date.now();
    const rows = t.rows.filter((r) => keep(r.order));
    // unfinished rows with RUSH float to the top; everything else keeps the notebook order (time taken)
    const unfinishedRush = rows.filter((r) => r.order.priority && O.isUnfinished(r.order) && !r.order.voided_at);
    const rest = rows.filter((r) => !unfinishedRush.includes(r));
    const carriedRows = carried.filter(keep).map((o) => ({ n: null, order: o, carried: true }));
    const top = [...carriedRows, ...unfinishedRush].sort(rushFirst);
    if (carriedRows.length || unfinishedRush.length) {
      tableHost.append(h('div', { class: 'section-h' }, h('span', null, carriedRows.length ? '📌 Needs attention (includes earlier days)' : '🔥 Rush orders'), badge(String(top.length))), orderTable(top, { now }));
    }
    if (rest.length) {
      tableHost.append(h('div', { class: 'section-h' }, h('span', null, 'Orders taken this day'), badge(String(rest.length))), orderTable(rest, { now }));
      tableHost.append(footer(t, rest.length === t.rows.length));
    } else if (!top.length) {
      tableHost.append(emptyState(q || filter !== 'all' ? 'Nothing matches' : isToday ? 'No orders yet today' : 'No orders on this day', isToday ? 'Tap “＋ New order” to add the first one.' : ''));
    }
    if (isToday || t.rows.length) tableHost.append(actionsBar());
  }

  function footer(totals) {
    return h('div', { class: 'card page-foot' },
      h('div', { class: 'foot-grid' },
        h('div', null, h('div', { class: 'k' }, 'Containers'), h('div', { class: 'v' }, String(totals.containers)), typeTags(totals.byType)),
        h('div', null, h('div', { class: 'k' }, 'Sales taken'), h('div', { class: 'v num' }, peso(totals.salesTaken))),
        h('div', null, h('div', { class: 'k' }, 'Collected'), h('div', { class: 'v num' }, peso(totals.collectedTotal))),
        h('div', null, h('div', { class: 'k' }, 'Unpaid'), h('div', { class: 'v num' }, peso(totals.unpaid))),
        h('div', null, h('div', { class: 'k' }, 'Empties still out'), h('div', { class: 'v' }, String(totals.emptiesOutTotal)), typeTags(totals.emptiesOut))),
      h('p', { class: 'hint' }, '“Sales taken” is the total of orders taken on this page (like the notebook total). “Collected” is money actually received on this day, including payments for earlier orders.'));
  }

  function actionsBar() {
    const closed = t.close;
    return h('div', { class: 'card noprint', style: { marginTop: '.9rem' } },
      h('div', { class: 'row between' },
        h('div', null, h('strong', null, closed ? `✅ Day closed at ${new Date(closed.closed_at).toLocaleTimeString('en-PH', { timeZone: tz, hour: 'numeric', minute: '2-digit' })}` : '🌙 End of day'),
          h('div', { class: 'hint' }, closed ? `Counted ${peso(closed.counted_cash)} · ${closed.variance === 0 ? 'balanced' : (closed.variance > 0 ? 'over ' : 'short ') + peso(Math.abs(closed.variance))}${t.changedAfterClose.length ? ` · ⚠ ${t.changedAfterClose.length} change(s) after closing` : ''}` : 'Count the cash, pay incentives, save the day.')),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: async () => { const r = await deliverFile(`orders_${day}.csv`, X.ordersCsv(t.rows.map((x) => x.order), s), 'text/csv'); if (r !== 'cancelled') toast('Spreadsheet ready'); } }, '⬇️ Spreadsheet'),
          h('button', { class: 'btn primary', onclick: () => openEndDay(day) }, closed ? 'Close the day again' : '🌙 End Day'))));
  }

  paintTable();
}

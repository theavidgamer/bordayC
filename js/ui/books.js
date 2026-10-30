// Books: Day book (finalized notebook pages), Overview (profit & loss). Insights lives in insights.js.
import { h, clear } from './dom.js';
import { toast, choice, field, barChart, shareBars, emptyState, badge, openModal, confirmModal } from './components.js';
import * as S from '../data/store.js';
import * as O from '../core/orders.js';
import * as R from '../core/reports.js';
import * as X from '../core/exchange.js';
import { orderTable } from './orderTable.js';
import { typeTags, staffName } from './view.js';
import { newExpenseId } from '../core/ids.js';
import { peso, toCentavos } from '../core/money.js';
import { dateKey, addDays, addMonths, prettyDate, prettyTime, shortDate, monthName, dayName } from '../core/dates.js';
import { deliverFile } from './files.js';

let tab = 'daybook', period = 'month', anchor = null, bookMonth = null, openDay = null;
const orders = () => [...S.state.orders.values()];
const expenses = () => [...S.state.expenses.values()];

export function setBooksTab(t) { tab = t; }
export function getBooksTab() { return tab; }

function shift(n) {
  if (period === 'day') anchor = addDays(anchor, n);
  else if (period === 'month') anchor = addMonths(anchor, n);
  else anchor = `${Number(anchor.slice(0, 4)) + n}-01-01`;
}
function periodLabel() {
  const [y, m] = anchor.split('-').map(Number);
  if (period === 'day') return prettyDate(anchor);
  if (period === 'month') return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
  return String(y);
}

export function renderOverview(root) {
  clear(root);
  const s = S.state.settings, tz = s.timezone;
  if (!anchor) anchor = S.today();
  const { from, to } = R.periodRange(period, anchor);
  const sum = R.summarize(orders(), expenses(), tz, from, to);
  const ser = R.series(orders(), expenses(), tz, period, anchor);
  const pc = choice({ label: 'Period', value: period, options: [{ value: 'day', label: 'Day' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }], onChange: (v) => { period = v || 'month'; anchor = S.today(); renderOverview(root); } });
  root.append(h('div', { class: 'row between' }, pc.el,
    h('div', { class: 'row' }, h('button', { class: 'btn small', 'aria-label': 'Previous', onclick: () => { shift(-1); renderOverview(clear(root)); } }, '◀'), h('strong', null, periodLabel()), h('button', { class: 'btn small', 'aria-label': 'Next', onclick: () => { shift(1); renderOverview(clear(root)); } }, '▶'))));
  root.append(h('div', { class: 'kpis', style: { marginTop: '.9rem' } },
    kpi('Revenue', peso(sum.revenue)), kpi('Expenses', peso(sum.expenses)),
    h('div', { class: 'kpi net' }, h('div', { class: 'k' }, 'Net profit'), h('div', { class: `v num ${sum.net < 0 ? 'neg' : 'pos'}` }, peso(sum.net))),
    kpi('Orders', String(sum.orders)), kpi('Quantity sold', String(sum.units)), kpi('Average order', peso(sum.avgOrder))));

  const labels = period === 'day' ? ser.map((r) => (Number(r.key) % 3 === 0 ? `${((Number(r.key) + 11) % 12) + 1}${Number(r.key) < 12 ? 'a' : 'p'}` : ''))
    : period === 'month' ? ser.map((r, i) => (i % 5 === 0 || i === ser.length - 1 ? String(Number(r.key.slice(8))) : ''))
      : ser.map((r) => monthName(Number(r.key.slice(5)) - 1));
  const chartCard = h('div', { class: 'card', style: { marginTop: '.9rem' } }, h('h2', null, period === 'day' ? 'Sales by hour' : 'Revenue vs expenses'));
  if (sum.revenue === 0 && sum.expenses === 0) chartCard.append(emptyState('No sales in this period yet'));
  else {
    chartCard.append(barChart({ data: ser.map((r, i) => ({ label: labels[i], value: r.revenue, value2: period === 'day' ? 0 : r.expenses })), title: `Revenue and expenses, ${periodLabel()}`, color2: period !== 'day' }));
    if (period !== 'day') chartCard.append(h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: 'var(--brand)' } }), 'Revenue'), h('span', null, h('i', { style: { background: 'var(--warn)' } }), 'Expenses')));
  }
  root.append(chartCard);

  const cats = new Map(s.expenseCategories.map((c) => [c.key, c.name]));
  const grid = h('div', { class: 'grid two', style: { marginTop: '.9rem' } });
  const pay = h('div', { class: 'card' }, h('h2', null, 'How customers paid'));
  const payRows = [['Cash', sum.byMethod.cash], ['GCash', sum.byMethod.gcash], ['Other', sum.byMethod.other]].filter(([, v]) => v > 0).map(([label, value]) => ({ label, value }));
  pay.append(payRows.length ? shareBars(payRows) : h('p', { class: 'muted' }, 'No payments yet.'));
  const ex = h('div', { class: 'card' }, h('h2', null, 'Where the money went'));
  const exRows = Object.entries(sum.byCategory).map(([k, value]) => ({ label: cats.get(k) || k, value })).sort((a, b) => b.value - a.value);
  ex.append(exRows.length ? shareBars(exRows) : h('p', { class: 'muted' }, 'No expenses recorded.'));
  const top = h('div', { class: 'card' }, h('h2', null, 'Top customers'));
  const tc = R.topCustomers(orders(), tz, from, to);
  top.append(tc.length ? h('div', { class: 'list' }, tc.map((c, i) => h('div', { class: 'item' }, h('div', null, h('div', { class: 't' }, `${i + 1}. ${c.name}`), h('div', { class: 's' }, `${c.orders} order${c.orders === 1 ? '' : 's'} · ${c.units} container${c.units === 1 ? '' : 's'}`)), h('strong', { class: 'num' }, peso(c.revenue))))) : h('p', { class: 'muted' }, 'No named customers yet.'));
  grid.append(pay, ex, top);
  root.append(grid);
  root.append(h('p', { class: 'hint', style: { marginTop: '.8rem' } }, 'Revenue counts on the day an order is marked paid. Unpaid (utang) orders are not included until collected.'));
}
const kpi = (k, v) => h('div', { class: 'kpi' }, h('div', { class: 'k' }, k), h('div', { class: 'v num' }, v));


/* ---------------------------------------------------------------- day book */
const monthLabel = (k) => `${monthName(Number(k.slice(5)) - 1)} ${k.slice(0, 4)}`;
export const openBookPage = (d) => { openDay = d; tab = 'daybook'; };

export function renderDayBook(root) {
  clear(root);
  const s = S.state.settings, tz = s.timezone;
  if (openDay) return renderPage(root, openDay);
  if (!bookMonth) bookMonth = S.today().slice(0, 7);
  const shiftM = (n) => { bookMonth = addMonths(`${bookMonth}-01`, n).slice(0, 7); renderDayBook(root); };
  const list = R.dayList(orders(), expenses(), [...S.state.closes.values()], tz, bookMonth);
  root.append(h('div', { class: 'row between', style: { marginBottom: '.7rem' } }, h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => shiftM(-1) }, '◀'), h('strong', null, monthLabel(bookMonth)), h('button', { class: 'btn small', onclick: () => shiftM(1) }, '▶')),
    h('p', { class: 'hint' }, 'Each row is one notebook page. Tap a page to open it.')));
  if (!list.length) { root.append(emptyState('No pages this month', 'Pages appear here once orders are taken.')); return; }
  const tot = list.reduce((a, d) => ({ sales: a.sales + d.salesTaken, col: a.col + d.collected, cost: a.cost + d.costs, n: a.n + d.orders }), { sales: 0, col: 0, cost: 0, n: 0 });
  root.append(h('div', { class: 'table-wrap book' }, h('table', { class: 'ledger' },
    h('thead', null, h('tr', null, h('th', null, 'Page'), h('th', { class: 'r wide' }, 'Orders'), h('th', { class: 'r' }, 'Sales taken'), h('th', { class: 'r wide' }, 'Collected'), h('th', { class: 'r wide' }, 'Expenses'), h('th', null, 'Day closed'))),
    h('tbody', null, list.map((d) => h('tr', { class: 'orow', tabIndex: 0, onclick: () => { openDay = d.day; renderDayBook(root); window.scrollTo(0, 0); }, onkeydown: (e) => { if (e.key === 'Enter') { openDay = d.day; renderDayBook(root); } } },
      h('td', null, h('strong', null, shortDate(d.day)), h('div', { class: 'muted small' }, dayName(d.day))), h('td', { class: 'r wide num' }, String(d.orders)), h('td', { class: 'r num' }, peso(d.salesTaken)), h('td', { class: 'r wide num' }, peso(d.collected)), h('td', { class: 'r wide num' }, peso(d.costs)),
      h('td', null, d.closed ? h('span', { class: `tag ${d.variance === 0 ? 'ok' : 'warn'}` }, d.variance === 0 ? '✔ balanced' : `${d.variance > 0 ? 'over' : 'short'} ${peso(Math.abs(d.variance))}`) : h('span', { class: 'muted' }, 'not closed'), d.changed ? h('div', { class: 'tag warn' }, `⚠ ${d.changed} change(s)`) : null)))),
    h('tfoot', null, h('tr', null, h('td', null, h('strong', null, 'Month')), h('td', { class: 'r wide num' }, String(tot.n)), h('td', { class: 'r num' }, h('strong', null, peso(tot.sales))), h('td', { class: 'r wide num' }, peso(tot.col)), h('td', { class: 'r wide num' }, peso(tot.cost)), h('td', null))))));
}

/** One finalized notebook page: the orders, the expenses, the totals and the cash count. */
function renderPage(root, day) {
  const s = S.state.settings, tz = s.timezone;
  const t = R.dayTotals(orders(), expenses(), [...S.state.closes.values()], tz, day);
  const cats = new Map(s.expenseCategories.map((c) => [c.key, c.name]));
  root.append(h('div', { class: 'row between noprint', style: { marginBottom: '.7rem' } }, h('button', { class: 'btn', onclick: () => { openDay = null; renderDayBook(root); } }, '← All pages'),
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => { openDay = addDays(day, -1); renderDayBook(root); } }, '◀ Earlier'), h('button', { class: 'btn small', onclick: () => { openDay = addDays(day, 1); renderDayBook(root); } }, 'Later ▶'), h('button', { class: 'btn', onclick: () => window.print() }, '🖨 Print'))));
  root.append(h('div', { class: 'page-title' }, h('h1', null, `${s.stationName} · ${prettyDate(day)}`), t.close ? badge('Day closed', 'good') : badge('Not closed yet', 'warn')));
  if (t.changedAfterClose.length) root.append(h('div', { class: 'insight warn' }, h('div', { class: 't' }, `${t.changedAfterClose.length} order(s) were changed after this day was closed.`)));
  root.append(t.rows.length ? orderTable(t.rows, { interactive: false }) : emptyState('No orders were taken on this day', ''));
  const ex = t.expenses;
  if (ex.length) root.append(h('div', { class: 'section-h' }, h('span', null, 'Expenses & pay'), badge(String(ex.length))), h('div', { class: 'table-wrap book' }, h('table', { class: 'ledger' },
    h('tbody', null, ex.map((e, i) => h('tr', null, h('td', { class: 'c-n' }, String(i + 1)), h('td', { class: 'c-cust' }, (e.kind && e.kind !== 'expense' ? `${staffName(e.staff)} · ${e.kind.replace(/_/g, ' ')}` : cats.get(e.category) || e.category) + (e.note ? ` – ${e.note}` : '')), h('td', { class: 'wide' }, e.paid_from === 'drawer' ? 'drawer' : 'owner'), h('td', { class: 'r c-amt num' }, peso(e.amount))))))));
  const line = (k, v) => h('div', { class: 'item' }, h('span', null, k), h('strong', { class: 'num' }, v));
  root.append(h('div', { class: 'grid two', style: { marginTop: '.9rem' } },
    h('div', { class: 'card' }, h('h2', null, 'Totals'), h('div', { class: 'list' }, line('Quantity', String(t.containers)), h('div', { class: 'item' }, h('span', null, 'By type'), typeTags(t.byType)), line('Sales taken', peso(t.salesTaken)), line('Collected (cash)', peso(t.collected.cash)),
      t.collected.gcash + t.collected.other ? line('Collected (GCash / other)', peso(t.collected.gcash + t.collected.other)) : null, line('Expenses', peso(t.costTotal)), t.incentivesPaid ? line('…of which incentives', peso(t.incentivesPaid)) : null, t.advancesGiven ? line('Advances given (not an expense)', peso(t.advancesGiven)) : null,
      line('Net for the day', peso(t.net)), line('Still unpaid from this page', peso(t.unpaid)), line('Containers still out', String(t.emptiesOutTotal)))),
    h('div', { class: 'card' }, h('h2', null, 'Cash count'), t.close ? h('div', { class: 'list' }, line('Opening cash', peso(t.close.opening_float)), line('Expected', peso(t.close.expected_cash)), line('Counted', peso(t.close.counted_cash)), line('Difference', t.close.variance === 0 ? 'Balanced ✅' : `${t.close.variance > 0 ? 'Over' : 'Short'} ${peso(Math.abs(t.close.variance))}`), line('Left for next day', peso(t.close.float_next)), t.close.note ? line('Note', t.close.note) : null) : h('p', { class: 'muted' }, 'This day has not been closed. Use End Day in the Orders tab.'))));
}

/* ---------------------------------------------------------------- shell */
export function renderBooks(root, { renderInsights }) {
  clear(root);
  const tabs = [['daybook', '📖 Day book'], ['overview', '📊 Overview'], ['insights', '💡 Insights']];
  const bar = choice({ label: 'Books section', value: tab, options: tabs.map(([value, label]) => ({ value, label })), onChange: (v) => { if (v) { tab = v; if (v !== 'daybook') openDay = null; renderBooks(root, { renderInsights }); } } });
  bar.el.classList.add('book-tabs');
  const body = h('div', { style: { marginTop: '.9rem' } });
  root.append(h('div', { class: 'page-title' }, h('h1', null, 'Books')), bar.el, body);
  ({ daybook: renderDayBook, overview: renderOverview, insights: renderInsights }[tab] || renderDayBook)(body);
}

// Books: Overview (P&L), Sales, Expenses. Insights lives in insights.js.
import { h, clear } from './dom.js';
import { toast, choice, field, barChart, shareBars, emptyState, badge, openModal, confirmModal } from './components.js';
import * as S from '../data/store.js';
import * as O from '../core/orders.js';
import * as R from '../core/reports.js';
import * as X from '../core/exchange.js';
import * as A from './actions.js';
import { newExpenseId } from '../core/ids.js';
import { peso, toCentavos } from '../core/money.js';
import { dateKey, addDays, addMonths, prettyDate, prettyTime, shortDate, monthName, dayName } from '../core/dates.js';
import { deliverFile } from './files.js';

let tab = 'overview', period = 'month', anchor = null, salesDay = null, showVoided = false;
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
    kpi('Orders', String(sum.orders)), kpi('Containers sold', String(sum.units)), kpi('Average order', peso(sum.avgOrder))));

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

/* ------------------------------------------------------------------- sales */
export function renderSales(root) {
  clear(root);
  const s = S.state.settings, tz = s.timezone;
  if (!salesDay) salesDay = S.today();
  const dateIn = h('input', { type: 'date', value: salesDay, 'aria-label': 'Day', onchange: (e) => { if (e.target.value) { salesDay = e.target.value; renderSales(clear(root)); } } });
  root.append(h('div', { class: 'row between' }, h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => { salesDay = addDays(salesDay, -1); renderSales(clear(root)); } }, '◀'), dateIn, h('button', { class: 'btn small', onclick: () => { salesDay = addDays(salesDay, 1); renderSales(clear(root)); } }, '▶')),
    h('button', { class: `chip ${showVoided ? 'on' : ''}`, onclick: () => { showVoided = !showVoided; renderSales(clear(root)); } }, 'Show voided / cancelled')));
  const dayOrders = orders().filter((o) => O.isPaid(o) && dateKey(o.paid_at, tz) === salesDay).sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at));
  const extra = showVoided ? orders().filter((o) => (o.voided_at || o.status === 'cancelled') && dateKey(o.updated_at, tz) === salesDay) : [];
  const total = dayOrders.reduce((a, o) => a + o.total_price, 0);
  root.append(h('div', { class: 'card', style: { marginTop: '.9rem' } },
    h('div', { class: 'row between' }, h('h2', null, `${dayOrders.length} sale${dayOrders.length === 1 ? '' : 's'}`), h('strong', { class: 'num', style: { fontSize: '1.4rem' } }, peso(total))),
    dayOrders.length || extra.length ? h('div', { class: 'list' }, [...dayOrders, ...extra].map((o) => h('div', { class: 'item', style: o.voided_at || o.status === 'cancelled' ? { opacity: .6 } : null },
      h('div', null, h('div', { class: 't' }, `${o.customer_name}`), h('div', { class: 's' }, `${o.order_no ? '#' + o.order_no + ' · ' : ''}${o.paid_at ? prettyTime(o.paid_at, tz) : ''} · ${o.quantity} × · ${O.METHOD_LABEL[o.payment_method || 'cash'] || ''}${o.edits?.length ? ' · edited' : ''}`)),
      h('div', { class: 'row' }, o.voided_at ? badge('voided', 'voided') : o.status === 'cancelled' ? badge('cancelled', 'cancelled') : null, h('strong', { class: 'num' }, peso(o.total_price)), h('button', { class: 'btn small', 'aria-label': 'Order actions', onclick: () => A.openOrderMenu(o) }, '⋯'))))) : emptyState('No sales on this day'),
    h('div', { style: { marginTop: '.8rem' } }, h('button', { class: 'btn small', onclick: async () => { const csv = X.salesCsv(dayOrders, s); const r = await deliverFile(`sales_${salesDay}.csv`, csv, 'text/csv'); if (r !== 'cancelled') toast('Spreadsheet file ready'); } }, '⬇️ Download as spreadsheet (CSV)'))));
}

/* ---------------------------------------------------------------- expenses */
export function renderExpenses(root) {
  clear(root);
  const s = S.state.settings;
  const today = S.today();
  const month = (anchor || today).slice(0, 7);
  const date = h('input', { type: 'date', value: today, max: addDays(today, 1), 'aria-label': 'Date' });
  const amount = h('input', { type: 'text', inputMode: 'decimal', placeholder: '0', 'aria-label': 'Amount' });
  const note = h('input', { type: 'text', maxLength: 200, placeholder: 'Note (optional)' });
  const cat = choice({ label: 'Category', value: s.expenseCategories[0]?.key, options: s.expenseCategories.map((c) => ({ value: c.key, label: c.name })) });
  const from = choice({ label: 'Paid from', value: 'owner', options: [{ value: 'drawer', label: '💵 Cash drawer' }, { value: 'owner', label: '👤 Owner / other' }] });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const add = h('button', { class: 'btn primary block', onclick: async () => {
    err.textContent = '';
    const c = toCentavos(amount.value);
    if (!amount.value.trim() || Number.isNaN(c) || c <= 0) { err.textContent = 'Enter the amount spent.'; return; }
    if (!date.value) { err.textContent = 'Choose the date.'; return; }
    const now = new Date().toISOString();
    try {
      await S.save({ expenses: [{ expense_id: newExpenseId(s.deviceCode), date: date.value, amount: c, category: cat.get() || 'other', note: note.value.trim(), paid_from: from.get() || 'owner', created_at: now, updated_at: now, voided_at: null }] });
      amount.value = ''; note.value = ''; toast('Expense saved', { kind: 'ok' });
    } catch (e) { err.textContent = e.message; }
  } }, 'Add expense');
  root.append(h('div', { class: 'card' }, h('h2', null, 'Add an expense'), field('Amount (₱)', amount), h('div', { class: 'field' }, h('span', { class: 'label' }, 'What for?'), cat.el), h('div', { class: 'field' }, h('span', { class: 'label' }, 'Paid from'), from.el, h('p', { class: 'hint' }, 'Pick “Cash drawer” if the money came out of the till today – it changes the expected cash at End Day.')), field('Date', date), field('Note', note), err, h('div', { style: { marginTop: '.8rem' } }, add)));

  const list = expenses().filter((e) => !e.voided_at && e.date.slice(0, 7) === month).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  const cats = new Map(s.expenseCategories.map((c) => [c.key, c.name]));
  const card = h('div', { class: 'card', style: { marginTop: '.9rem' } }, h('div', { class: 'row between' }, h('h2', null, `This month: ${peso(list.reduce((a, e) => a + e.amount, 0))}`), h('button', { class: 'btn small', onclick: async () => { await deliverFile(`expenses_${month}.csv`, X.expensesCsv(list, s), 'text/csv'); } }, '⬇️ CSV')));
  card.append(list.length ? h('div', { class: 'list' }, list.map((e) => h('div', { class: 'item' }, h('div', null, h('div', { class: 't' }, cats.get(e.category) || e.category), h('div', { class: 's' }, `${shortDate(e.date)}${e.paid_from === 'drawer' ? ' · from drawer' : ''}${e.note ? ' · ' + e.note : ''}`)),
    h('div', { class: 'row' }, h('strong', { class: 'num' }, peso(e.amount)), h('button', { class: 'btn small', 'aria-label': 'Remove expense', onclick: () => confirmModal({ title: 'Remove this expense?', message: `${cats.get(e.category) || e.category} · ${peso(e.amount)}`, okLabel: 'Remove', kind: 'danger', onConfirm: async () => { await S.save({ expenses: [{ ...e, voided_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }); toast('Removed'); } }) }, '🗑️'))))) : emptyState('No expenses this month'));
  root.append(card);
}

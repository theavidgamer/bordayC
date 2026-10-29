// Home ("Today"): the morning brief + End Day.
import { h, clear } from './dom.js';
import { openModal, toast, stepper, field, badge, emptyState } from './components.js';
import * as S from '../data/store.js';
import * as O from '../core/orders.js';
import * as R from '../core/reports.js';
import * as X from '../core/exchange.js';
import * as A from './actions.js';
import { newCloseId } from '../core/ids.js';
import { peso, toCentavos, pesoInput } from '../core/money.js';
import { dateKey, prettyDate, daysBetween, shortDate } from '../core/dates.js';
import { deliverFile, postToDiscord, isDiscordWebhook } from './files.js';
import { orderCard, boardOrders } from './board.js';

const all = () => [...S.state.orders.values()];
const exps = () => [...S.state.expenses.values()];

/** Business days that have paid orders but no End Day record yet (excluding today). */
export function unclosedDays() {
  const tz = S.state.settings.timezone, today = S.today();
  const closed = new Set([...S.state.closes.values()].map((c) => c.date));
  const days = new Set();
  for (const o of all()) if (O.isPaid(o)) { const d = dateKey(o.paid_at, tz); if (d < today && !closed.has(d)) days.add(d); }
  return [...days].sort();
}

export function renderToday(root, { goTo }) {
  clear(root);
  const s = S.state.settings, tz = s.timezone, today = S.today();
  const orders = all();
  const sum = R.summarize(orders, exps(), tz, today, today);
  const open = boardOrders();
  const toDeliver = open.filter((o) => ['not_started', 'preparing', 'otw'].includes(o.status));
  const owedMoney = R.receivables(orders, today, tz);
  const owedBoxes = R.containersOwed(orders, today, tz);
  const closedToday = [...S.state.closes.values()].filter((c) => c.date === today).sort((a, b) => b.closed_at.localeCompare(a.closed_at))[0];
  const stale = unclosedDays();

  root.append(h('div', { class: 'page-title' }, h('h1', null, `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}`), h('span', { class: 'muted' }, prettyDate(today))));

  if (stale.length) {
    root.append(h('div', { class: 'insight warn', style: { marginBottom: '.9rem' } }, h('div', { class: 't' }, `${stale.length === 1 ? shortDate(stale[0]) : stale.length + ' earlier days'} not closed yet`),
      h('p', { class: 'hint' }, 'Close each day so the cash count and export file are saved.'), h('button', { class: 'btn small', onclick: () => openEndDay(stale[0]) }, `Close ${shortDate(stale[0])}`)));
  }

  const goalPct = s.dailyGoal > 0 ? Math.min(100, Math.round((sum.revenue / s.dailyGoal) * 100)) : null;
  root.append(h('div', { class: 'kpis' },
    h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'Paid today'), h('div', { class: 'v num' }, peso(sum.revenue)), goalPct != null ? h('div', { class: 'hint' }, `${goalPct}% of ${peso(s.dailyGoal)} goal`) : null),
    h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'Orders paid'), h('div', { class: 'v' }, String(sum.orders)), h('div', { class: 'hint' }, `${sum.units} container${sum.units === 1 ? '' : 's'}`)),
    h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'To deliver'), h('div', { class: 'v' }, String(toDeliver.length))),
    h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'Money owed to you'), h('div', { class: 'v num' }, peso(owedMoney.reduce((a, g) => a + g.amount, 0)))),
    h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'Empties still out'), h('div', { class: 'v' }, String(owedBoxes.reduce((a, g) => a + g.out, 0))))));

  const grid = h('div', { class: 'grid two', style: { marginTop: '.9rem' } });
  // undelivered
  const c1 = h('div', { class: 'card' }, h('h2', null, `Still to deliver (${toDeliver.length})`));
  if (!toDeliver.length) c1.append(h('p', { class: 'muted' }, 'Nothing waiting. 🎉'));
  else { c1.append(...toDeliver.slice(0, 5).map((o) => h('div', { class: 'item' }, h('div', null, h('div', { class: 't' }, o.customer_name), h('div', { class: 's' }, `${o.quantity} container${o.quantity === 1 ? '' : 's'} · ${O.STATUS_LABEL[o.status]}`)), badge(peso(o.total_price)))));
    c1.append(h('button', { class: 'btn soft block', style: { marginTop: '.6rem' }, onclick: () => goTo('board') }, 'Open the Order Board')); }
  // owed money
  const c2 = h('div', { class: 'card' }, h('h2', null, 'Money owed (utang)'));
  if (!owedMoney.length) c2.append(h('p', { class: 'muted' }, 'Nobody owes money.'));
  else c2.append(...owedMoney.slice(0, 6).map((g) => h('div', { class: 'item' }, h('div', null, h('div', { class: 't' }, g.name), h('div', { class: 's' }, `${g.orders.length} order${g.orders.length === 1 ? '' : 's'} · ${g.oldestDays === 0 ? 'today' : g.oldestDays + ' day(s) old'}`)),
    h('button', { class: 'btn small primary', onclick: () => A.openPayModal(g.orders[0]) }, `Collect ${peso(g.orders[0].total_price)}`))));
  // empties
  const c3 = h('div', { class: 'card' }, h('h2', null, 'Empty containers out'));
  if (!owedBoxes.length) c3.append(h('p', { class: 'muted' }, 'All containers are back.'));
  else c3.append(...owedBoxes.slice(0, 6).map((g) => h('div', { class: 'item' }, h('div', null, h('div', { class: 't' }, g.name), h('div', { class: 's' }, `${g.out} empt${g.out === 1 ? 'y' : 'ies'} · ${g.oldestDays === 0 ? 'since today' : g.oldestDays + ' day(s)'}`)),
    h('button', { class: 'btn small', onclick: () => A.openReturnModal(g.orders[0]) }, 'Came back'))));
  // end day
  const c4 = h('div', { class: 'card' }, h('h2', null, 'End of day'));
  if (closedToday) c4.append(h('p', null, '✅ Closed today at ', new Date(closedToday.closed_at).toLocaleTimeString('en-PH', { timeZone: tz, hour: 'numeric', minute: '2-digit' }), '.'),
    h('p', { class: 'muted' }, `Counted ${peso(closedToday.counted_cash)} · ${closedToday.variance === 0 ? 'balanced' : (closedToday.variance > 0 ? 'over by ' : 'short by ') + peso(Math.abs(closedToday.variance))}`));
  else c4.append(h('p', { class: 'muted' }, 'When the shop closes: count the cash, save the day, and send the file somewhere safe.'));
  c4.append(h('button', { class: 'btn primary block big', style: { marginTop: '.6rem' }, onclick: () => openEndDay(today) }, closedToday ? 'Close the day again' : '🌙 End Day'));
  grid.append(c1, c2, c3, c4);
  root.append(grid);
}

/* ====================================================================== End Day */

const BILLS = [1000, 500, 200, 100, 50, 20];
const COINS = [20, 10, 5, 1];

export function openEndDay(day) {
  const s = S.state.settings, tz = s.timezone;
  let step = 1;
  const orders = all(), expenses = exps();
  const daySum = R.summarize(orders, expenses, tz, day, day);
  const open = orders.filter(O.onBoard);
  const receivable = R.receivables(orders, day, tz);
  const owedBoxes = R.containersOwed(orders, day, tz);
  let opening = S.state.meta.floatNext != null ? S.state.meta.floatNext : s.openingFloat;
  const denoms = {}; // "b1000": count
  let typedTotal = null;
  let floatNext = null;
  let note = '';
  const box = h('div', null);
  const modal = openModal({ title: `End Day · ${prettyDate(day)}`, body: box, wide: true });

  const countedFromDenoms = () => BILLS.reduce((a, b) => a + (denoms[`b${b}`] || 0) * b * 100, 0) + COINS.reduce((a, c) => a + (denoms[`c${c}`] || 0) * c * 100, 0);
  const counted = () => (typedTotal != null ? typedTotal : countedFromDenoms());
  const calc = () => R.expectedCash(orders, expenses, tz, day, opening);

  function paint() {
    clear(box);
    if (step === 1) {
      box.append(
        h('div', { class: 'kpis' },
          h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'Revenue'), h('div', { class: 'v num' }, peso(daySum.revenue))),
          h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'Orders paid'), h('div', { class: 'v' }, String(daySum.orders)))),
        h('div', { class: 'list', style: { marginTop: '.7rem' } },
          row('Cash', peso(daySum.byMethod.cash)),
          s.acceptOtherPayments || daySum.byMethod.gcash + daySum.byMethod.other > 0 ? row('GCash / other', peso(daySum.byMethod.gcash + daySum.byMethod.other)) : null,
          row('Expenses today', peso(daySum.expenses)),
          row('Orders still open (stay on the board)', String(open.length)),
          row('Customers who owe money', `${receivable.length} · ${peso(receivable.reduce((a, g) => a + g.amount, 0))}`),
          row('Empties still out', String(owedBoxes.reduce((a, g) => a + g.out, 0)))),
        open.length ? h('p', { class: 'hint' }, 'Open orders are not lost – they stay on the board for tomorrow.') : null,
        h('div', { class: 'modal-actions', style: { padding: '1rem 0 0', border: 0 } }, h('button', { class: 'btn', onclick: modal.close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { step = 2; paint(); } }, 'Next: count the cash →')));
    } else if (step === 2) {
      const openInput = h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(opening), 'aria-label': 'Cash in drawer at opening' });
      const totalLine = h('div', { class: 'total-box' });
      const varBox = h('div', { class: 'change-box' });
      const expLine = h('p', { class: 'hint' });
      const typed = h('input', { type: 'text', inputMode: 'decimal', placeholder: 'Or type the total counted', value: typedTotal != null ? pesoInput(typedTotal) : '', 'aria-label': 'Total counted' });
      const floatIn = h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(floatNext != null ? floatNext : opening), 'aria-label': 'Cash to leave for tomorrow' });
      const refresh = () => {
        const c = calc(), cnt = counted(), v = cnt - c.expected;
        expLine.textContent = `Expected in drawer: ${peso(c.expected)}  (opening ${peso(c.openingFloat)} + cash sales ${peso(c.cashSales)} − drawer expenses ${peso(c.drawerExpenses)})`;
        clear(totalLine); totalLine.append(h('div', { class: 'muted' }, 'Counted'), h('div', { class: 'amt num' }, peso(cnt)));
        varBox.textContent = v === 0 ? '✅ Balanced' : v > 0 ? `Over by ${peso(v)}` : `Short by ${peso(-v)}`;
        varBox.classList.toggle('short', v < 0);
      };
      openInput.addEventListener('input', () => { const c = toCentavos(openInput.value); if (!Number.isNaN(c)) { opening = c; refresh(); } });
      typed.addEventListener('input', () => { if (!typed.value.trim()) typedTotal = null; else { const c = toCentavos(typed.value); if (!Number.isNaN(c)) typedTotal = c; } refresh(); });
      floatIn.addEventListener('input', () => { const c = toCentavos(floatIn.value); if (!Number.isNaN(c)) floatNext = c; });
      const denomGrid = h('div', { class: 'denoms' }, [...BILLS.map((b) => ['b', b, `₱${b} bill`]), ...COINS.map((c) => ['c', c, `₱${c} coin`])].map(([t, v, lab]) => {
        const st = stepper({ value: denoms[`${t}${v}`] || 0, min: 0, max: 999, size: 'sm', label: lab, onChange: (n) => { denoms[`${t}${v}`] = n; typedTotal = null; typed.value = ''; refresh(); } });
        return h('div', { class: 'denom' }, h('span', null, lab), st.el);
      }));
      box.append(field('Cash in the drawer when you opened (₱)', openInput), expLine, h('div', { class: 'field' }, h('span', { class: 'label' }, 'Count the cash'), denomGrid), field('', typed), totalLine, varBox,
        field('Cash to leave in the drawer for tomorrow (₱)', floatIn, 'This becomes tomorrow’s opening amount.'), field('Note (optional)', h('input', { type: 'text', maxLength: 300, value: note, oninput: (e) => { note = e.target.value; }, placeholder: 'e.g. paid the water delivery from drawer' })),
        h('div', { class: 'modal-actions', style: { padding: '1rem 0 0', border: 0 } }, h('button', { class: 'btn', onclick: () => { step = 1; paint(); } }, '← Back'), h('button', { class: 'btn primary', onclick: () => { step = 3; paint(); } }, 'Next: review →')));
      refresh();
    } else {
      const c = calc(), cnt = counted(), v = cnt - c.expected;
      const err = h('p', { class: 'form-error', role: 'alert' });
      const go = h('button', { class: 'btn primary big', onclick: async () => {
        go.disabled = true; err.textContent = '';
        try { await finish(); } catch (e) { err.textContent = e.message; go.disabled = false; }
      } }, '💾 Save day & send file');
      box.append(h('div', { class: 'list' }, row('Revenue', peso(daySum.revenue)), row('Expected cash', peso(c.expected)), row('Counted cash', peso(cnt)), row('Difference', v === 0 ? 'Balanced ✅' : (v > 0 ? 'Over ' : 'Short ') + peso(Math.abs(v))), row('Left for tomorrow', peso(floatNext != null ? floatNext : opening))),
        h('p', { class: 'hint' }, 'Next, your phone will offer to share the day’s file. Send it to email or Drive so it is safe even if this device is lost.'), err,
        h('div', { class: 'modal-actions', style: { padding: '1rem 0 0', border: 0 } }, h('button', { class: 'btn', onclick: () => { step = 2; paint(); } }, '← Back'), go));
    }
  }

  async function finish() {
    const c = calc(), cnt = counted(), now = new Date().toISOString();
    const close = {
      close_id: newCloseId(s.deviceCode, day), date: day, closed_at: now, opening_float: opening, cash_sales: c.cashSales, drawer_expenses: c.drawerExpenses,
      expected_cash: c.expected, counted_cash: cnt, variance: cnt - c.expected, float_next: floatNext != null ? floatNext : opening,
      revenue: daySum.revenue, orders_paid: daySum.orders, open_orders: open.length, note: note.slice(0, 300), denominations: { ...denoms }
    };
    // Build the file from memory FIRST (no awaiting) so the browser still allows the share sheet.
    const since = S.state.meta.lastExportAt ? new Date(S.state.meta.lastExportAt).getTime() - 2 * 86400000 : 0; // 2-day overlap: a lost file is recovered by the next one
    const changed = orders.filter((o) => new Date(o.updated_at).getTime() >= since);
    const changedExp = expenses.filter((e) => new Date(e.updated_at).getTime() >= since);
    const file = X.buildOrdersExport({ settings: s, orders: changed, expenses: changedExp, close, mode: 'incremental', now, appVersion: S.APP_VERSION });
    const text = JSON.stringify(file);
    const already = [...S.state.closes.values()].some((z) => z.date === day);
    const name = `orders_${day}_final${already ? '_' + now.slice(11, 16).replace(':', '') : ''}.json`;
    const result = await deliverFile(name, text);
    if (result === 'cancelled') throw new Error('The file was not saved. Tap the button again and choose where to send it.');
    await S.save({ closes: [close], meta: { lastExportAt: now, lastCloseDate: day, floatNext: close.float_next } });
    if (isDiscordWebhook(s.discordWebhook)) postToDiscord(s.discordWebhook, name, text, `${s.stationName} · ${day} · revenue ${peso(close.revenue)}`).then((ok) => { if (!ok) toast('Discord backup failed (no internet?). The file is saved on your device.', { kind: 'error', ms: 7000 }); });
    modal.close();
    toast(result === 'shared' ? 'Day closed. File shared ✔' : 'Day closed. File downloaded – move it off this device.', { kind: 'ok', ms: 8000 });
  }
  paint();
}
const row = (a, b) => h('div', { class: 'item' }, h('span', null, a), h('strong', { class: 'num' }, b));

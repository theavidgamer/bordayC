// End Day: summary -> pay staff incentives -> count the cash -> save the day and send the file.
import { h, clear } from './dom.js';
import { openModal, toast, stepper, field, badge } from './components.js';
import * as S from '../data/store.js';
import * as O from '../core/orders.js';
import * as R from '../core/reports.js';
import * as X from '../core/exchange.js';
import { newCloseId, newExpenseId } from '../core/ids.js';
import { peso, toCentavos, pesoInput } from '../core/money.js';
import { dateKey, prettyDate, shortDate } from '../core/dates.js';
import { deliverFile, postToDiscord, isDiscordWebhook } from './files.js';
import { typeTags } from './view.js';

const BILLS = [1000, 500, 200, 100, 50, 20];
const COINS = [20, 10, 5, 1];

/** Earlier days that have sales but no End Day record yet. */
export function unclosedDays() {
  const tz = S.state.settings.timezone, today = S.today();
  const closed = new Set([...S.state.closes.values()].map((c) => c.date));
  const days = new Set();
  for (const o of S.state.orders.values()) if (O.isPaid(o)) { const d = dateKey(o.paid_at, tz); if (d < today && !closed.has(d)) days.add(d); }
  return [...days].sort();
}

export function openEndDay(day) {
  const s = S.state.settings, tz = s.timezone;
  let step = 1;
  const orders = [...S.state.orders.values()], expenses = [...S.state.expenses.values()];
  const totals = R.dayTotals(orders, expenses, [...S.state.closes.values()], tz, day);
  const unfinished = orders.filter(O.isUnfinished);
  const owed = R.receivables(orders, day, tz);
  const balances = R.staffBalances(orders, expenses, s.staff.filter((x) => x.active || true), tz, day);
  const payouts = balances.filter((b) => b.balance > 0 || b.earnedToday > 0 || b.paid > 0).map((b) => ({ staff: b.key, name: b.name, balance: b.balance, earnedToday: b.earnedToday, amount: Math.max(0, b.balance), include: b.balance > 0 }));
  let opening = S.state.meta.floatNext != null ? S.state.meta.floatNext : s.openingFloat;
  const denoms = {};
  let typedTotal = null, floatNext = null, note = '';
  const box = h('div', null);
  const modal = openModal({ title: `End Day · ${prettyDate(day)}`, body: box, wide: true });

  const payoutRecords = (now) => payouts.filter((p) => p.include && p.amount > 0).map((p) => ({
    expense_id: newExpenseId(s.deviceCode), kind: 'incentive_payout', date: day, amount: p.amount, category: 'incentive', staff: p.staff,
    note: 'Paid at End Day', paid_from: 'drawer', created_at: now, updated_at: now, voided_at: null
  }));
  const expensesWithPayouts = () => [...expenses, ...payoutRecords(new Date().toISOString())];
  const calc = () => R.expectedCash(orders, expensesWithPayouts(), tz, day, opening);
  const countedFromDenoms = () => BILLS.reduce((a, b) => a + (denoms[`b${b}`] || 0) * b * 100, 0) + COINS.reduce((a, c) => a + (denoms[`c${c}`] || 0) * c * 100, 0);
  const counted = () => (typedTotal != null ? typedTotal : countedFromDenoms());
  const nav = (back, next, nextLabel) => h('div', { class: 'modal-actions', style: { padding: '1rem 0 0', border: 0 } },
    back ? h('button', { class: 'btn', onclick: back }, '← Back') : h('button', { class: 'btn', onclick: modal.close }, 'Cancel'), next);
  const row = (a, b) => h('div', { class: 'item' }, h('span', null, a), h('strong', { class: 'num' }, b));

  function paint() {
    clear(box);
    if (step === 1) {
      box.append(
        h('div', { class: 'kpis' }, h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'Sales taken'), h('div', { class: 'v num' }, peso(totals.salesTaken))), h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'Collected'), h('div', { class: 'v num' }, peso(totals.collectedTotal)))),
        h('div', { class: 'list', style: { marginTop: '.7rem' } },
          row('Orders on this page', String(totals.count)), row('Cash collected', peso(totals.collected.cash)),
          s.acceptOtherPayments || totals.collected.gcash + totals.collected.other > 0 ? row('GCash / other collected', peso(totals.collected.gcash + totals.collected.other)) : null,
          row('Expenses paid today', peso(totals.costTotal)), row('Unfinished orders (stay on the page)', String(unfinished.length)),
          row('Customers who owe money', `${owed.length} · ${peso(owed.reduce((a, g) => a + g.amount, 0))}`), row('Empties still out', String(totals.emptiesOutTotal))),
        unfinished.length ? h('p', { class: 'hint' }, 'Unfinished orders are not lost – they stay at the top of tomorrow’s page.') : null,
        nav(null, h('button', { class: 'btn primary', onclick: () => { step = 2; paint(); } }, 'Next: staff incentives →')));
    } else if (step === 2) {
      const list = h('div', { class: 'stack' });
      if (!payouts.length) list.append(h('p', { class: 'muted' }, 'No incentives to pay. (Set the incentive rate in ⚙️ Settings if staff should earn one.)'));
      for (const p of payouts) {
        const amt = h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(p.amount), 'aria-label': `${p.name} payout` });
        amt.addEventListener('input', () => { const c = toCentavos(amt.value); if (!Number.isNaN(c) && c >= 0) p.amount = c; });
        const chk = h('input', { type: 'checkbox', checked: p.include, 'aria-label': `Pay ${p.name}`, onchange: (e) => { p.include = e.target.checked; } });
        list.append(h('div', { class: 'card' }, h('label', { class: 'row' }, chk, h('strong', null, `Pay ${p.name}`)), h('div', { class: 'hint' }, `Earned today ${peso(p.earnedToday)} · balance owed ${peso(p.balance)}`), field('Amount to pay now (₱)', amt)));
      }
      box.append(h('p', null, 'Incentives are paid from the drawer and recorded as today’s expense.'), list, nav(() => { step = 1; paint(); }, h('button', { class: 'btn primary', onclick: () => { step = 3; paint(); } }, 'Next: count the cash →')));
    } else if (step === 3) {
      const openInput = h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(opening), 'aria-label': 'Cash in drawer at opening' });
      const totalLine = h('div', { class: 'total-box' }), varBox = h('div', { class: 'change-box' }), expLine = h('p', { class: 'hint' });
      const typed = h('input', { type: 'text', inputMode: 'decimal', placeholder: 'Or type the total counted', value: typedTotal != null ? pesoInput(typedTotal) : '', 'aria-label': 'Total counted' });
      const floatIn = h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(floatNext != null ? floatNext : opening), 'aria-label': 'Cash to leave for tomorrow' });
      const refresh = () => {
        const c = calc(), cnt = counted(), v = cnt - c.expected;
        expLine.textContent = `Expected in drawer: ${peso(c.expected)}  (opening ${peso(c.openingFloat)} + cash collected ${peso(c.cashSales)} − cash paid out ${peso(c.drawerExpenses)})`;
        clear(totalLine); totalLine.append(h('div', { class: 'muted' }, 'Counted'), h('div', { class: 'amt num' }, peso(cnt)));
        varBox.textContent = v === 0 ? '✅ Balanced' : v > 0 ? `Over by ${peso(v)}` : `Short by ${peso(-v)}`;
        varBox.classList.toggle('short', v < 0);
      };
      openInput.addEventListener('input', () => { const c = toCentavos(openInput.value); if (!Number.isNaN(c)) { opening = c; refresh(); } });
      typed.addEventListener('input', () => { if (!typed.value.trim()) typedTotal = null; else { const c = toCentavos(typed.value); if (!Number.isNaN(c)) typedTotal = c; } refresh(); });
      floatIn.addEventListener('input', () => { const c = toCentavos(floatIn.value); if (!Number.isNaN(c)) floatNext = c; });
      const grid = h('div', { class: 'denoms' }, [...BILLS.map((b) => ['b', b, `₱${b} bill`]), ...COINS.map((c) => ['c', c, `₱${c} coin`])].map(([t, v, lab]) => {
        const st = stepper({ value: denoms[`${t}${v}`] || 0, min: 0, max: 999, size: 'sm', label: lab, onChange: (n) => { denoms[`${t}${v}`] = n; typedTotal = null; typed.value = ''; refresh(); } });
        return h('div', { class: 'denom' }, h('span', null, lab), st.el);
      }));
      box.append(field('Cash in the drawer when you opened (₱)', openInput), expLine, h('div', { class: 'field' }, h('span', { class: 'label' }, 'Count the cash'), grid), field('', typed), totalLine, varBox,
        field('Cash to leave in the drawer for tomorrow (₱)', floatIn, 'This becomes tomorrow’s opening amount.'),
        field('Note (optional)', h('input', { type: 'text', maxLength: 300, value: note, oninput: (e) => { note = e.target.value; }, placeholder: 'anything worth remembering' })),
        nav(() => { step = 2; paint(); }, h('button', { class: 'btn primary', onclick: () => { step = 4; paint(); } }, 'Next: review →')));
      refresh();
    } else {
      const c = calc(), cnt = counted(), v = cnt - c.expected;
      const err = h('p', { class: 'form-error', role: 'alert' });
      const go = h('button', { class: 'btn primary big', onclick: async () => { go.disabled = true; err.textContent = ''; try { await finish(); } catch (e) { err.textContent = e.message; go.disabled = false; } } }, '💾 Save day & send file');
      const pay = payouts.filter((p) => p.include && p.amount > 0);
      box.append(h('div', { class: 'list' }, row('Sales taken', peso(totals.salesTaken)), row('Collected', peso(totals.collectedTotal)), row('Incentives paid', peso(pay.reduce((a, p) => a + p.amount, 0))),
        row('Expected cash', peso(c.expected)), row('Counted cash', peso(cnt)), row('Difference', v === 0 ? 'Balanced ✅' : (v > 0 ? 'Over ' : 'Short ') + peso(Math.abs(v))), row('Left for tomorrow', peso(floatNext != null ? floatNext : opening))),
        h('p', { class: 'hint' }, 'Next, your device will offer to share the day’s file. Send it to email, Drive or Discord so it is safe even if this device is lost.'), err,
        nav(() => { step = 3; paint(); }, go));
    }
  }

  async function finish() {
    const now = new Date().toISOString();
    const newExp = payoutRecords(now);
    const allExp = [...expenses, ...newExp];
    const c = R.expectedCash(orders, allExp, tz, day, opening), cnt = counted();
    const dt = R.dayTotals(orders, allExp, [], tz, day);
    const close = {
      close_id: newCloseId(s.deviceCode, day), date: day, closed_at: now, opening_float: opening, cash_sales: c.cashSales, drawer_expenses: c.drawerExpenses,
      expected_cash: c.expected, counted_cash: cnt, variance: cnt - c.expected, float_next: floatNext != null ? floatNext : opening,
      revenue: dt.collectedTotal, orders_paid: orders.filter((o) => O.isPaid(o) && dateKey(o.paid_at, tz) === day).length, open_orders: unfinished.length, note: note.slice(0, 300), denominations: { ...denoms }
    };
    // Build the file from memory FIRST (no awaiting) so the browser still allows the share sheet.
    const since = S.state.meta.lastExportAt ? new Date(S.state.meta.lastExportAt).getTime() - 2 * 86400000 : 0; // 2-day overlap: a lost file is recovered by the next one
    const changed = orders.filter((o) => new Date(o.updated_at).getTime() >= since);
    const changedExp = allExp.filter((e) => new Date(e.updated_at).getTime() >= since);
    const file = X.buildOrdersExport({ settings: s, orders: changed, expenses: changedExp, close, mode: 'incremental', now, appVersion: S.APP_VERSION });
    const text = JSON.stringify(file);
    const already = [...S.state.closes.values()].some((z) => z.date === day);
    const name = `orders_${day}_final${already ? '_' + now.slice(11, 16).replace(':', '') : ''}.json`;
    const result = await deliverFile(name, text);
    if (result === 'cancelled') throw new Error('The file was not saved. Tap the button again and choose where to send it.');
    await S.save({ closes: [close], expenses: newExp, meta: { lastExportAt: now, lastCloseDate: day, floatNext: close.float_next } });
    if (isDiscordWebhook(s.discordWebhook)) postToDiscord(s.discordWebhook, name, text, `${s.stationName} · ${day} · collected ${peso(close.revenue)}`).then((ok) => { if (!ok) toast('Discord backup failed (no internet?). The file is saved on your device.', { kind: 'error', ms: 7000 }); });
    modal.close();
    toast(result === 'shared' ? 'Day closed. File shared ✔' : 'Day closed. File downloaded – move it off this device.', { kind: 'ok', ms: 8000 });
  }
  paint();
}

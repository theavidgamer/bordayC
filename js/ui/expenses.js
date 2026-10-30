// Expenses tab: works like the Orders page (a page per day) with two sections: Expenses and Rider pay.
import { h, clear } from './dom.js';
import { openModal, toast, choice, field, emptyState, badge, confirmModal } from './components.js';
import * as S from '../data/store.js';
import * as R from '../core/reports.js';
import { newExpenseId } from '../core/ids.js';
import { peso, toCentavos } from '../core/money.js';
import { addDays, prettyDate, prettyTime } from '../core/dates.js';
import { staffName } from './view.js';
import { isUnlocked, pinCard, hasPin, touch } from './lock.js';

let day = null, section = 'expenses';
const FROM = { drawer: '💵 From the drawer', owner: '👤 Owner paid' };
const KIND_LABEL = { incentive_payout: 'Incentive paid', advance: 'Advance given', advance_repayment: 'Advance paid back' };

function amountInput() {
  return h('input', { type: 'text', inputMode: 'decimal', placeholder: '0.00', 'aria-label': 'Amount in pesos', style: { fontSize: '1.4rem' } });
}

function addExpenseModal(forDay, after) {
  const s = S.state.settings;
  const amount = amountInput(), note = h('input', { type: 'text', maxLength: 200, placeholder: 'e.g. 5 gallons of purified water' });
  const cat = choice({ label: 'Category', value: s.expenseCategories[0]?.key, options: s.expenseCategories.map((c) => ({ value: c.key, label: c.name })) });
  const from = choice({ label: 'Paid from', value: 'drawer', options: Object.entries(FROM).map(([value, label]) => ({ value, label })) });
  openModal({
    title: `Add expense · ${prettyDate(forDay)}`,
    body: h('div', { class: 'stack' }, field('Amount (₱)', amount), h('div', { class: 'field' }, h('span', { class: 'label' }, 'What for?'), cat.el), field('Note (optional)', note), h('div', { class: 'field' }, h('span', { class: 'label' }, 'Who paid?'), from.el)),
    actions: [{ label: 'Cancel' }, {
      label: 'Save expense', kind: 'primary', onClick: async ({ setError }) => {
        const c = toCentavos(amount.value);
        if (Number.isNaN(c) || c <= 0) { setError('Please type the amount.'); return false; }
        const now = new Date().toISOString();
        await S.save({ expenses: [{ expense_id: newExpenseId(s.deviceCode), kind: 'expense', date: forDay, amount: c, category: cat.get() || 'other', staff: null, note: note.value.trim(), paid_from: from.get() || 'drawer', created_at: now, updated_at: now, voided_at: null }] });
        toast(`Saved ${peso(c)}`, { kind: 'ok' }); after();
      }
    }]
  });
}

function staffPayModal(kind, staff, forDay, after) {
  const s = S.state.settings;
  const titles = { incentive_payout: `Pay incentive to ${staff.name}`, advance: `Give advance to ${staff.name}`, advance_repayment: `${staff.name} paid back an advance` };
  const amount = amountInput(), note = h('input', { type: 'text', maxLength: 200, placeholder: 'optional' });
  const hints = { incentive_payout: `Owed now: ${peso(staff.balance)}`, advance: 'This is lent money. It is NOT counted as an expense.', advance_repayment: `Advance balance: ${peso(staff.advanceBalance)}` };
  if (kind === 'incentive_payout' && staff.balance > 0) amount.value = (staff.balance / 100).toFixed(2);
  openModal({
    title: titles[kind], body: h('div', { class: 'stack' }, h('p', { class: 'hint' }, hints[kind]), field('Amount (₱)', amount), field('Note', note)),
    actions: [{ label: 'Cancel' }, {
      label: 'Save', kind: 'primary', onClick: async ({ setError }) => {
        const c = toCentavos(amount.value);
        if (Number.isNaN(c) || c <= 0) { setError('Please type the amount.'); return false; }
        const now = new Date().toISOString();
        await S.save({ expenses: [{ expense_id: newExpenseId(s.deviceCode), kind, date: forDay, amount: c, category: kind === 'incentive_payout' ? R.INCENTIVE_CATEGORY : 'advance', staff: staff.key, note: note.value.trim(), paid_from: 'drawer', created_at: now, updated_at: now, voided_at: null }] });
        toast('Saved', { kind: 'ok' }); after();
      }
    }]
  });
}

const removeExpense = (e, after) => confirmModal({
  title: 'Remove this entry?', message: `${peso(e.amount)} · ${e.note || KIND_LABEL[e.kind] || 'expense'}\nIt will be marked removed, not deleted.`, okLabel: 'Remove', kind: 'danger',
  onConfirm: async () => { await S.save({ expenses: [{ ...e, voided_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }); toast('Removed'); after(); }
});

export function renderExpenses(root) {
  clear(root);
  const s = S.state.settings, tz = s.timezone, today = S.today();
  if (!day) day = today;
  const go = (d) => { day = d; renderExpenses(root); };
  const again = () => renderExpenses(root);
  const cats = new Map(s.expenseCategories.map((c) => [c.key, c.name]));
  const all = [...S.state.expenses.values()].filter((e) => !e.voided_at && e.date === day).sort((a, b) => a.created_at.localeCompare(b.created_at));

  root.append(h('div', { class: 'page-title' }, h('h1', null, 'Expenses'), h('span', { class: 'muted' }, prettyDate(day))));
  const dateInput = h('input', { type: 'date', value: day, 'aria-label': 'Choose day', onchange: (e) => { if (e.target.value) go(e.target.value); } });
  root.append(h('div', { class: 'row between', style: { marginBottom: '.7rem' } },
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => go(addDays(day, -1)) }, '◀ Back'), dateInput, h('button', { class: 'btn small', onclick: () => go(addDays(day, 1)) }, 'Next ▶'), day !== today ? h('button', { class: 'btn small soft', onclick: () => go(today) }, 'Today') : null),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => window.print() }, '🖨 Print'))));
  const seg = choice({ label: 'Section', value: section, options: [{ value: 'expenses', label: '🧾 Expenses' }, { value: 'pay', label: '🛵 Rider pay' }], onChange: (v) => { section = v || 'expenses'; again(); } });
  seg.el.classList.add('seg-big');
  root.append(h('div', { style: { marginBottom: '.8rem' } }, seg.el));

  if (section === 'expenses') {
    const rows = all.filter((e) => (e.kind || 'expense') === 'expense');
    const total = rows.reduce((a, e) => a + e.amount, 0), drawer = rows.filter((e) => e.paid_from === 'drawer').reduce((a, e) => a + e.amount, 0);
    root.append(h('div', { class: 'row between', style: { marginBottom: '.6rem' } }, h('div', { class: 'kpis stats', style: { flex: 1 } },
      h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'Spent this day'), h('div', { class: 'v num' }, peso(total))), h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'From the drawer'), h('div', { class: 'v num' }, peso(drawer)))),
      h('button', { class: 'btn primary big', onclick: () => addExpenseModal(day, again) }, '＋ Add expense')));
    if (!rows.length) { root.append(emptyState('No expenses on this day', 'Tap “＋ Add expense” when money is spent.')); return; }
    root.append(h('div', { class: 'table-wrap book' }, h('table', { class: 'ledger' },
      h('thead', null, h('tr', null, h('th', { class: 'c-n' }, 'No.'), h('th', { class: 'c-cust' }, 'What for'), h('th', { class: 'wide' }, 'Time'), h('th', { class: 'wide' }, 'Paid from'), h('th', { class: 'r c-amt' }, 'Amount'), h('th', { class: 'c-act' }, ''))),
      h('tbody', null, rows.map((e, i) => h('tr', { class: 'orow' }, h('td', { class: 'c-n' }, String(i + 1)),
        h('td', { class: 'c-cust' }, h('strong', null, cats.get(e.category) || e.category), e.note ? h('div', { class: 'muted small' }, e.note) : null, h('div', { class: 'narrow muted small' }, FROM[e.paid_from] || '')),
        h('td', { class: 'wide' }, prettyTime(e.created_at, tz)), h('td', { class: 'wide' }, FROM[e.paid_from] || e.paid_from), h('td', { class: 'r c-amt num' }, peso(e.amount)),
        h('td', { class: 'c-act' }, h('button', { class: 'btn small', 'aria-label': 'Remove', onclick: () => removeExpense(e, again) }, '✕'))))),
      h('tfoot', null, h('tr', null, h('td', null), h('td', { colSpan: 3 }, h('strong', null, 'Total')), h('td', { class: 'r num' }, h('strong', null, peso(total))), h('td', null)))) ));
    return;
  }

  /* ---- rider pay (PIN-lockable) */
  if (s.riderPayLocked && hasPin() && !isUnlocked()) { root.append(pinCard('Rider pay is locked', again)); return; }
  touch();
  const bal = R.staffBalances([...S.state.orders.values()], [...S.state.expenses.values()], s.staff.filter((x) => x.active !== false), tz, day);
  root.append(h('div', { class: 'grid two' }, bal.map((b) => h('div', { class: 'card' }, h('h2', null, b.name),
    h('div', { class: 'foot-grid' },
      h('div', null, h('div', { class: 'k' }, 'Earned this day'), h('div', { class: 'v num' }, peso(b.earnedToday)), h('div', { class: 'hint' }, `quantity ${b.containersToday}`)),
      h('div', null, h('div', { class: 'k' }, 'Incentive owed'), h('div', { class: 'v num' }, peso(b.balance))),
      h('div', null, h('div', { class: 'k' }, 'Advance balance'), h('div', { class: 'v num' }, peso(b.advanceBalance)))),
    h('div', { class: 'row', style: { marginTop: '.7rem' } },
      h('button', { class: 'btn primary', onclick: () => staffPayModal('incentive_payout', b, day, again) }, 'Pay incentive'),
      h('button', { class: 'btn', onclick: () => staffPayModal('advance', b, day, again) }, 'Give advance'),
      b.advanceBalance > 0 ? h('button', { class: 'btn', onclick: () => staffPayModal('advance_repayment', b, day, again) }, 'Advance paid back') : null)))));
  if (!(s.incentive.pickup || s.incentive.delivery)) root.append(h('p', { class: 'hint' }, 'The incentive rate is ₱0 right now. The owner sets it in ⚙️ Settings.'));
  const rows = all.filter((e) => (e.kind || 'expense') !== 'expense');
  root.append(h('div', { class: 'section-h' }, h('span', null, 'Rider pay entries'), badge(String(rows.length))));
  if (!rows.length) root.append(emptyState('Nothing recorded on this day', ''));
  else root.append(h('div', { class: 'table-wrap book' }, h('table', { class: 'ledger' },
    h('thead', null, h('tr', null, h('th', { class: 'c-n' }, 'No.'), h('th', { class: 'c-cust' }, 'Who / what'), h('th', { class: 'wide' }, 'Time'), h('th', { class: 'r c-amt' }, 'Amount'), h('th', { class: 'c-act' }, ''))),
    h('tbody', null, rows.map((e, i) => h('tr', { class: 'orow' }, h('td', { class: 'c-n' }, String(i + 1)), h('td', { class: 'c-cust' }, h('strong', null, `${staffName(e.staff)} · ${KIND_LABEL[e.kind] || e.kind}`), e.note ? h('div', { class: 'muted small' }, e.note) : null),
      h('td', { class: 'wide' }, prettyTime(e.created_at, tz)), h('td', { class: 'r c-amt num' }, peso(e.amount)), h('td', { class: 'c-act' }, h('button', { class: 'btn small', 'aria-label': 'Remove', onclick: () => removeExpense(e, again) }, '✕'))))))));
}

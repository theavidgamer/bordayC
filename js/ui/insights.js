// Insights: rider performance, who is likely to reorder, money/containers owed, demand forecast.
import { h, clear } from './dom.js';
import { openModal, field, badge, emptyState, barChart } from './components.js';
import * as S from '../data/store.js';
import * as R from '../core/reports.js';
import * as A from '../core/analytics.js';
import * as UI from './actions.js';
import { peso } from '../core/money.js';
import { prettyDate, shortDate, dayName } from '../core/dates.js';

const orders = () => [...S.state.orders.values()];
const LEVEL = { good: ['On target', 'good'], watch: ['Watch', 'warn'], poor: ['Needs attention', 'bad'], insufficient: ['Not enough data', ''] };
const STATE = { overdue: ['Overdue', 'bad'], due: ['Due now', 'warn'], upcoming: ['Upcoming', ''], lapsed: ['May have stopped', ''] };

export function renderInsights(root) {
  clear(root);
  const s = S.state.settings, tz = s.timezone, today = S.today();
  const all = orders();
  const lateMinutes = s.timers.preparingLate + s.timers.outLate;
  const riders = A.riderStats(all, { riders: s.staff, lateMinutes });
  const reorders = A.reorderPredictions(all, today, tz, { customers: S.state.customers });
  const recv = R.receivables(all, today, tz);
  const boxes = R.containersOwed(all, today, tz);
  const forecast = A.demandForecast(all, today, tz);
  const cards = A.buildInsights({ riders, reorders, receivables: recv, containers: boxes, forecast });

  root.append(h('div', { class: 'page-title' }, h('h1', null, 'Insights'), h('span', { class: 'muted' }, 'Gets smarter the more orders you record')));
  if (!all.length) { root.append(emptyState('No data yet', 'Record some orders and come back. Rider and reorder insights need at least a few weeks of history to be reliable.')); return; }

  const stack = h('div', { class: 'stack' });
  stack.append(h('div', { class: 'stack' }, cards.length ? cards.map((c) => h('div', { class: `insight ${c.level}` }, h('div', { class: 't' }, c.title), h('div', { class: 'hint' }, c.detail), c.amount ? h('strong', { class: 'num' }, peso(c.amount)) : null)) : h('div', { class: 'insight good' }, h('div', { class: 't' }, 'Nothing needs attention right now ✅'))));

  /* riders */
  const rc = h('div', { class: 'card' }, h('h2', null, 'Delivery performance by staff'), h('p', { class: 'hint' }, `Time from order to delivered. “Late” means over ${lateMinutes} minutes (change the timers in ⚙️ Settings). A rider is only judged after 10 deliveries.`));
  if (!riders.length) rc.append(h('p', { class: 'muted' }, 'No completed deliveries yet.'));
  else rc.append(h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, ['Staff', 'Deliveries', 'Typical time', 'Late', 'Empties missed', 'Verdict'].map((x, i) => h('th', { class: i > 0 && i < 5 ? 'r' : '' }, x)))),
    h('tbody', null, riders.map((r) => h('tr', null,
      h('td', null, h('strong', null, r.name)), h('td', { class: 'r num' }, String(r.deliveries)),
      h('td', { class: 'r num' }, r.medianMinutes == null ? '–' : `${Math.round(r.medianMinutes)} min`),
      h('td', { class: 'r num' }, r.lateRate == null ? '–' : `${Math.round(r.lateRate * 100)}%`),
      h('td', { class: 'r num' }, r.owedRate == null ? '–' : `${Math.round(r.owedRate * 100)}%`),
      h('td', null, badge(LEVEL[r.level][0], LEVEL[r.level][1]), h('div', { class: 'hint' }, r.reasons.join(' '))))))))); 
  stack.append(rc);

  /* reorders */
  const rp = h('div', { class: 'card' }, h('h2', null, 'Who will probably reorder'), h('p', { class: 'hint' }, 'Based on how often each customer usually orders. Needs 3 different order days per customer. Good for a friendly reminder text or call.'));
  const shown = reorders.filter((x) => x.state !== 'lapsed').slice(0, 12);
  const lapsed = reorders.filter((x) => x.state === 'lapsed');
  if (!reorders.length) rp.append(h('p', { class: 'muted' }, 'Not enough repeat orders yet.'));
  else {
    rp.append(h('div', { class: 'list' }, shown.map((x) => h('div', { class: 'item' },
      h('div', null, h('div', { class: 't' }, x.name), h('div', { class: 's' }, `Usually every ~${x.typicalGapDays} day${x.typicalGapDays === 1 ? '' : 's'} · last ${shortDate(x.lastOrder)} · ${x.typicalQty} container${x.typicalQty === 1 ? '' : 's'} · ${x.confidence} confidence${x.phone ? ' · ☎ ' + x.phone : ''}`)),
      h('div', { class: 'row' }, badge(x.state === 'upcoming' ? `Expected ${shortDate(x.predictedDate)}` : x.state === 'overdue' ? `${x.daysLate} day(s) late` : STATE[x.state][0], STATE[x.state][1]), h('button', { class: 'btn small', onclick: () => editContact(x) }, '☎'))))));
    if (lapsed.length) rp.append(h('p', { class: 'hint', style: { marginTop: '.6rem' } }, `May have stopped ordering: ${lapsed.slice(0, 8).map((x) => x.name).join(', ')}${lapsed.length > 8 ? '…' : ''}`));
  }
  stack.append(rp);

  /* forecast */
  const fc = h('div', { class: 'card' }, h('h2', null, 'Expected demand (next 7 days)'));
  if (!forecast) fc.append(h('p', { class: 'muted' }, 'Needs about 2 weeks of orders to estimate.'));
  else {
    fc.append(barChart({ data: forecast.map((d) => ({ label: dayName(d.date), value: d.expected })), title: 'Expected containers per day', format: (n) => String(n), height: 150 }));
    fc.append(h('p', { class: 'hint' }, 'Average of the same weekday over the last 8 weeks. Use it to plan refill stock and rider shifts.'));
  }
  stack.append(fc);

  /* heatmap */
  const grid = A.busyHours(all, tz);
  const max = Math.max(1, ...grid.flat());
  const heat = h('div', { class: 'heat', role: 'img', 'aria-label': 'Busy hours by weekday' }, h('div'), Array.from({ length: 24 }, (_, i) => h('div', { style: { textAlign: 'center' } }, i % 3 === 0 ? String(i) : '')));
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d, wd) => { heat.append(h('div', null, d)); grid[wd].forEach((v, hr) => heat.append(h('div', { class: 'cell', title: `${d} ${hr}:00 – ${v} order${v === 1 ? '' : 's'}`, style: { opacity: v ? String(0.12 + 0.88 * (v / max)) : '0.06' } }))); });
  stack.append(h('div', { class: 'card' }, h('h2', null, 'Busiest hours'), heat, h('p', { class: 'hint' }, 'Darker = more orders. Hours are 0–23 in the shop’s timezone.')));
  root.append(stack);
}

function editContact(x) {
  const c = S.state.customers.get(x.key) || [...S.state.customers.values()].find((k) => `n:${k.name.trim().toLowerCase()}` === x.key);
  if (!c) { openModal({ title: x.name, body: h('p', null, 'Contact details can be saved for customers who were chosen from the list at the Counter.'), actions: [{ label: 'OK', kind: 'primary' }] }); return; }
  const phone = h('input', { type: 'text', inputMode: 'tel', value: c.phone, maxLength: 40, placeholder: '09xx xxx xxxx' });
  const addr = h('input', { type: 'text', value: c.address, maxLength: 200, placeholder: 'Address / landmark' });
  openModal({ title: c.name, body: h('div', null, field('Phone', phone), field('Address', addr)), actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => { await S.save({ customers: [{ ...c, phone: phone.value.trim(), address: addr.value.trim(), updated_at: new Date().toISOString() }] }); } }] });
}

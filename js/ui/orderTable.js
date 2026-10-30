// The notebook-style table. Used by the Orders tab, the Day book page and customer profiles.
import { h } from './dom.js';
import * as O from '../core/orders.js';
import * as T from '../core/timers.js';
import * as S from '../data/store.js';
import { peso } from '../core/money.js';
import { dateKey, shortDate } from '../core/dates.js';
import { hooks } from './bus.js';
import { nextAction, doNext } from './actions.js';
import { staffName, typeTags, lineSummary, timerTag, emptiesCell, fulfillLabel } from './view.js';

/** rows: [{ n, order, carried? }]   opts: { interactive = true, showDate = false } */
export function orderTable(rows, { interactive = true, showDate = false, now = Date.now() } = {}) {
  const tz = S.state.settings.timezone;
  const head = h('thead', null, h('tr', null,
    h('th', { class: 'c-n' }, 'No.'), h('th', { class: 'c-cust' }, 'Customer'), h('th', { class: 'wide' }, 'Qty'), h('th', { class: 'wide' }, 'Handled by'),
    h('th', { class: 'wide' }, 'Containers'), h('th', { class: 'wide' }, 'Status / time'), h('th', { class: 'r c-amt' }, 'Amount'), interactive ? h('th', { class: 'c-act' }, '') : null));
  const body = h('tbody', null);
  for (const { n, order: o, carried } of rows) {
    const st = T.stage(o, now, tz, S.state.settings.timers);
    const dead = o.voided_at || o.status === 'cancelled';
    const act = interactive ? nextAction(o) : null;
    const cls = ['orow', o.status, dead ? 'dead' : '', o.priority && !dead ? 'rush' : '', st.level === 'late' ? 'lvl-late' : st.level === 'warn' ? 'lvl-warn' : '', carried ? 'carried' : ''].filter(Boolean).join(' ');
    const nameBtn = h('button', { class: 'linklike name', type: 'button', onclick: (e) => { e.stopPropagation(); hooks.openCustomer(o.customer_name, o.customer_id); } }, o.customer_name);
    const sub = h('div', { class: 'sub narrow' },
      h('span', null, `${o.quantity}× `), typeTags(o.containers), ' ', h('span', { class: 'muted' }, `· ${staffName(o.staff)} · ${fulfillLabel(o.fulfillment)}`),
      o.fulfillment === 'delivery' && O.sumObj(o.empties_owed) ? h('span', { class: 'tag warn' }, `⚠ ${O.sumObj(o.empties_owed)} containers out`) : null,
      h('div', null, o.voided_at ? h('span', { class: 'time none' }, 'Voided') : timerTag(o, now)));
    const tr = h('tr', { class: cls, tabIndex: interactive ? 0 : -1, onclick: interactive ? () => hooks.openOrder(o) : null,
      onkeydown: interactive ? (e) => { if (e.key === 'Enter' && e.target === tr) hooks.openOrder(o); } : null },
      h('td', { class: 'c-n' }, o.priority && !dead ? `🔥${n ?? ''}` : String(n ?? '')),
      h('td', { class: 'c-cust' }, nameBtn, carried ? h('div', { class: 'tag' }, `from ${shortDate(dateKey(o.created_at, tz))}`) : null,
        h('div', { class: 'wide muted small' }, `${fulfillLabel(o.fulfillment)}${o.is_special || (o.deals || []).length ? ' · ' + lineSummary(o) : ''}`), sub),
      h('td', { class: 'wide' }, h('strong', null, `${o.quantity}`), ' ', typeTags(o.containers)),
      h('td', { class: 'wide' }, staffName(o.staff)),
      h('td', { class: 'wide' }, emptiesCell(o)),
      h('td', { class: 'wide' }, o.voided_at ? h('span', { class: 'time none' }, 'Voided') : timerTag(o, now)),
      h('td', { class: 'r c-amt num' }, dead ? h('s', null, peso(o.total_price)) : peso(o.total_price)),
      interactive ? h('td', { class: 'c-act' }, act ? h('button', { class: 'btn small primary', type: 'button', onclick: (e) => { e.stopPropagation(); doNext(o); } }, act.label) : h('span', { class: 'muted small' }, dead ? '' : '✔')) : null);
    body.append(tr);
  }
  return h('div', { class: 'table-wrap book' }, h('table', { class: 'ledger' }, head, body));
}

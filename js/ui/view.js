// Small shared pieces for showing orders: tags, names, summaries.
import { h } from './dom.js';
import * as S from '../data/store.js';
import * as O from '../core/orders.js';
import * as T from '../core/timers.js';
import { peso } from '../core/money.js';

export const settings = () => S.state.settings;
export const staffName = (key) => S.state.settings.staff.find((s) => s.key === key)?.name || (key ? key : '—');
export const typeInfo = (key) => S.state.settings.containerTypes.find((t) => t.key === key) || { key, name: key, icon: '▫️', short: key?.[0]?.toUpperCase() || '?' };

/** ⭕ 3  ⬛ 1  (only non-zero types) */
export function typeTags(counts, { dim = false } = {}) {
  const entries = Object.entries(counts || {}).filter(([, n]) => n > 0);
  if (!entries.length) return h('span', { class: 'muted' }, '–');
  return h('span', { class: `tags ${dim ? 'dim' : ''}` }, entries.map(([k, n]) => { const t = typeInfo(k); return h('span', { class: `tag type-${k}`, title: `${t.name}: ${n}` }, `${t.icon} ${n}`); }));
}

/** "2× Buy 10 get 1 + 3 regular" */
export function lineSummary(o) {
  const parts = (o.deals || []).map((d) => `${d.count}× ${d.name}`);
  if (o.regular_qty > 0) parts.push(`${o.regular_qty} regular`);
  return parts.join(' + ');
}

export function timerTag(order, nowMs = Date.now()) {
  const st = T.stage(order, nowMs, S.state.settings.timezone, S.state.settings.timers);
  return h('span', { class: `time ${st.level}` }, st.level === 'late' ? '⏰ ' : st.level === 'warn' ? '⏳ ' : st.level === 'done' ? '✔ ' : '', st.text);
}

export function emptiesCell(o) {
  if (o.fulfillment !== 'delivery') return h('span', { class: 'muted' }, '–');
  const out = O.sumObj(o.empties_owed);
  if (out > 0) return h('span', { class: 'tag warn' }, `⚠ ${out} out`, ' ', typeTags(o.empties_owed));
  if (o.empties_short > 0) return h('span', { class: 'tag ok' }, '✔ all back');
  return h('span', { class: 'muted' }, 'swapped');
}

export const rates = () => ({ pickup: S.state.settings.incentive.pickup || 0, delivery: S.state.settings.incentive.delivery || 0 });
export const unitPriceFor = (fulfillment) => (fulfillment === 'delivery' ? S.state.settings.priceDelivery : S.state.settings.pricePickup);
export const fulfillLabel = (f) => (f === 'delivery' ? 'Delivery' : 'Pick-up');

// The "what are they buying" editor, shared by the Counter and the Edit-order window.
// Deals (multiple, fixed price) + regular containers (priced each) + container type split + empties.
import { h, clear } from './dom.js';
import { stepper, choice, openModal } from './components.js';
import * as S from '../data/store.js';
import * as O from '../core/orders.js';
import { peso, toCentavos, pesoInput } from '../core/money.js';

/**
 * init: { deals:[{key,count}], regular_qty, unit_price, containers:{}, empties_owed:{} }
 * opts: { fulfillment, onChange }
 */
export function linesEditor(init, { fulfillment, onChange }) {
  const s = S.state.settings;
  const types = s.containerTypes;
  const firstKey = types[0]?.key || 'bilog';
  const st = {
    counts: Object.fromEntries(s.specials.map((d) => [d.key, (init.deals || []).find((x) => x.key === d.key)?.count || 0])),
    regular: init.regular_qty ?? 1,
    unit: init.unit_price,
    others: Object.fromEntries(types.slice(1).map((t) => [t.key, init.containers?.[t.key] || 0])), // first type = the rest
    owedMode: O.sumObj(init.empties_owed) > 0 ? 'some' : 'all',
    owed: { ...(init.empties_owed || {}) },
    unitTouched: false
  };
  const root = h('div', { class: 'lines' });

  const dealsArr = () => s.specials.filter((d) => st.counts[d.key] > 0).map((d) => ({ key: d.key, name: d.name, containers: d.containers, total: d.total, count: st.counts[d.key] }));
  const quantity = () => O.computeTotals({ deals: dealsArr(), regular_qty: st.regular, unit_price: st.unit }).quantity;
  const total = () => O.computeTotals({ deals: dealsArr(), regular_qty: st.regular, unit_price: st.unit }).total;
  const containers = () => {
    const q = quantity();
    const out = {};
    let used = 0;
    for (const t of types.slice(1)) { const n = Math.max(0, Math.min(st.others[t.key] || 0, q - used)); out[t.key] = n; used += n; }
    out[firstKey] = q - used;
    return out;
  };
  const owed = () => {
    if (fulfillment !== 'delivery' || st.owedMode === 'all') return {};
    const c = containers(); const out = {};
    for (const t of types) { const n = Math.min(st.owed[t.key] || 0, c[t.key] || 0); if (n > 0) out[t.key] = n; }
    return out;
  };
  const fire = () => onChange?.();

  function lock(d) {
    openModal({
      title: '🔒 Fixed special deal',
      body: h('div', null,
        h('p', null, `“${d.name}” is ${d.containers} containers for ${peso(d.total)}. The containers and the price of a deal cannot be changed here.`),
        h('p', null, h('strong', null, 'What to do: '), 'use − and + to add or remove whole deals. For extra containers, use the “Regular containers” box. To change a deal itself, the owner can edit it in ⚙️ Settings → Special deals.')),
      actions: [{ label: 'OK, I understand', kind: 'primary' }]
    });
  }

  function paint() {
    clear(root);
    /* --- deals */
    if (s.specials.length) {
      const box = h('div', { class: 'field' }, h('span', { class: 'label' }, '🎁 Special deals'));
      for (const d of s.specials) {
        const count = st.counts[d.key];
        const row = h('div', { class: `deal ${count ? 'on' : ''}` });
        row.append(h('div', { class: 'deal-info' }, h('strong', null, d.name), h('div', { class: 'muted' }, `${d.containers} containers · ${peso(d.total)} each deal`)));
        if (!count) row.append(h('button', { class: 'btn soft', type: 'button', onclick: () => { st.counts[d.key] = 1; paint(); fire(); } }, '＋ Add deal'));
        else {
          const sp = stepper({ value: count, min: 0, max: 99, size: 'sm', label: `${d.name} deals`, onChange: (v) => { st.counts[d.key] = v; if (v === 0) paint(); fire(); refreshTypes(); } });
          row.append(sp.el, h('button', { class: 'btn small', type: 'button', onclick: () => lock(d), 'aria-label': 'Why is this fixed?' }, '🔒 Fixed'));
        }
        box.append(row);
      }
      root.append(box);
    }
    /* --- regular */
    const reg = stepper({ value: st.regular, min: 0, max: 999, label: 'Regular containers', onChange: (v) => { st.regular = v; fire(); refreshTypes(); } });
    const priceInput = h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(st.unit), 'aria-label': 'Price each' });
    priceInput.addEventListener('input', () => { const c = toCentavos(priceInput.value); if (!Number.isNaN(c) && c >= 0) { st.unit = c; st.unitTouched = true; fire(); } });
    const priceBox = h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Price each:'), st.unitTouched || st.unitEditing ? priceInput : h('strong', null, peso(st.unit)),
      !(st.unitTouched || st.unitEditing) ? h('button', { class: 'btn small', type: 'button', onclick: () => { st.unitEditing = true; paint(); } }, 'Change price') : null);
    const quick = h('div', { class: 'suggest' }, [1, 2, 3, 4, 5, 10].map((n) => h('button', { type: 'button', class: 'chip', onclick: () => { st.regular = n; paint(); fire(); } }, String(n))));
    root.append(h('div', { class: 'field' }, h('span', { class: 'label' }, s.specials.length ? 'Regular containers (not part of a deal)' : 'How many containers?'), reg.el, quick, priceBox));
    /* --- types */
    const typesBox = h('div', { class: 'field' });
    root.append(typesBox);
    /* --- empties (delivery) */
    const emptiesBox = h('div', { class: 'field' });
    if (fulfillment === 'delivery') root.append(emptiesBox);

    function refreshTypes() {
      clear(typesBox);
      const q = quantity();
      const c = containers();
      typesBox.append(h('span', { class: 'label' }, `Container types · ${q} total`));
      if (types.length > 1) {
        for (const t of types.slice(1)) {
          const sp = stepper({ value: c[t.key], min: 0, max: q, size: 'sm', label: `${t.name} containers`, onChange: (v) => { st.others[t.key] = v; refreshTypes(); fire(); } });
          typesBox.append(h('div', { class: 'row', style: { marginBottom: '.4rem' } }, h('span', { class: 'type-label' }, `${t.icon} ${t.name}`), sp.el));
        }
        const f = types[0];
        typesBox.append(h('div', { class: 'muted' }, `${f.icon} ${f.name}: `, h('strong', null, String(c[firstKey])), ' (the rest)'));
      } else typesBox.append(h('div', null, `${types[0].icon} ${types[0].name}: `, h('strong', null, String(q))));
      refreshEmpties();
    }
    function refreshEmpties() {
      if (fulfillment !== 'delivery') return;
      clear(emptiesBox);
      emptiesBox.append(h('span', { class: 'label' }, 'Empty containers from the customer'));
      const mode = choice({ label: 'Empties', value: st.owedMode, options: [{ value: 'all', label: '🔁 All swapped' }, { value: 'some', label: '⚠️ Some NOT taken' }], onChange: (v) => { st.owedMode = v || 'all'; if (st.owedMode === 'some' && !O.sumObj(st.owed)) { const c = containers(); st.owed = { ...c }; } refreshEmpties(); fire(); } });
      emptiesBox.append(mode.el);
      if (st.owedMode === 'some') {
        const c = containers();
        for (const t of types) {
          if (!c[t.key]) continue;
          const sp = stepper({ value: Math.min(st.owed[t.key] ?? c[t.key], c[t.key]), min: 0, max: c[t.key], size: 'sm', label: `${t.name} empties not taken`, onChange: (v) => { st.owed[t.key] = v; fire(); } });
          st.owed[t.key] = Math.min(st.owed[t.key] ?? c[t.key], c[t.key]);
          emptiesBox.append(h('div', { class: 'row', style: { marginTop: '.4rem' } }, h('span', { class: 'type-label' }, `${t.icon} ${t.name} still with customer`), sp.el));
        }
      }
    }
    refreshTypes();
  }
  paint();

  return {
    el: root,
    get: () => ({ deals: dealsArr(), regular_qty: st.regular, unit_price: st.unit, containers: containers(), empties_owed: owed() }),
    total, quantity,
    setUnitPrice(c) { if (!st.unitTouched) { st.unit = c; paint(); } }
  };
}

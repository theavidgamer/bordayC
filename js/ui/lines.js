// "What are they buying" – split into small boxes so each box has ONE job (fewer choices at a time).
//   parts.quantity : regular quantity
//   parts.deals    : special deals + price (Regular / presets / custom)
//   parts.types    : container type (All Bilog / All Faucet / Mix)
//   parts.swap     : delivery only – containers swapped or NOT taken
// Words: "quantity" = how many the customer buys. "containers" = the physical bilog/faucet that are swapped or returned.
import { h, clear } from './dom.js';
import { stepper, choice, openModal } from './components.js';
import * as S from '../data/store.js';
import * as O from '../core/orders.js';
import { peso, toCentavos, pesoInput } from '../core/money.js';

const defaultPrice = (s, fulfillment) => (fulfillment === 'delivery' ? s.priceDelivery : s.pricePickup);

/** Name shown for a unit price: Regular (the default), a preset name (e.g. Family), or Modified. */
export function priceLabelFor(unit, fulfillment, s = S.state.settings) {
  if (unit === defaultPrice(s, fulfillment)) return 'Regular';
  return s.pricePresets.find((p) => p.price === unit)?.name || 'Modified';
}

/**
 * init: { deals:[{key,count}], regular_qty, unit_price, containers:{}, empties_owed:{} }
 * opts: { fulfillment, onChange }
 */
export function linesEditor(init, { fulfillment, onChange }) {
  const s = S.state.settings;
  const types = s.containerTypes;
  const firstKey = types[0]?.key || 'bilog';
  const preferred = types.find((t) => t.key === s.defaultContainerType)?.key || firstKey;
  const used = types.filter((t) => (init.containers?.[t.key] || 0) > 0);
  const st = {
    counts: Object.fromEntries(s.specials.map((d) => [d.key, (init.deals || []).find((x) => x.key === d.key)?.count || 0])),
    regular: init.regular_qty ?? 1,
    regularTouched: init.regular_qty != null,
    unit: init.unit_price ?? defaultPrice(s, fulfillment),
    customPrice: false,
    typeMode: used.length > 1 ? 'mix' : used.length === 1 ? used[0].key : preferred, // a type key = "All of that type", or 'mix'
    others: Object.fromEntries(types.slice(1).map((t) => [t.key, init.containers?.[t.key] || 0])), // first type = the rest
    owedMode: O.sumObj(init.empties_owed) > 0 ? 'some' : 'all',
    owed: { ...(init.empties_owed || {}) }
  };
  st.customPrice = st.unit !== defaultPrice(s, fulfillment) && !s.pricePresets.some((p) => p.price === st.unit);

  const parts = { quantity: h('div', null), deals: h('div', null), types: h('div', null), swap: h('div', null) };
  let qtyStepper = null;

  const dealsArr = () => s.specials.filter((d) => st.counts[d.key] > 0).map((d) => ({ key: d.key, name: d.name, containers: d.containers, total: d.total, count: st.counts[d.key] }));
  const calc = () => O.computeTotals({ deals: dealsArr(), regular_qty: st.regular, unit_price: st.unit });
  const quantity = () => calc().quantity;
  const total = () => calc().total;
  const containers = () => {
    const q = quantity();
    if (st.typeMode !== 'mix') return { [st.typeMode]: q };
    const out = {};
    let usedN = 0;
    for (const t of types.slice(1)) { const n = Math.max(0, Math.min(st.others[t.key] || 0, q - usedN)); out[t.key] = n; usedN += n; }
    out[firstKey] = q - usedN;
    return out;
  };
  const owed = () => {
    if (fulfillment !== 'delivery' || st.owedMode === 'all') return {};
    const c = containers(); const out = {};
    for (const t of types) { const n = Math.min(st.owed[t.key] || 0, c[t.key] || 0); if (n > 0) out[t.key] = n; }
    return out;
  };
  const priceLabel = () => priceLabelFor(st.unit, fulfillment, s);
  /** Rows for the total box: [{name, qty, unit, subtotal}] */
  const breakdown = () => {
    const rows = dealsArr().map((d) => ({ name: d.name, qty: d.count, unit: d.total, subtotal: d.count * d.total, deal: true }));
    if (st.regular > 0) rows.push({ name: priceLabel(), qty: st.regular, unit: st.unit, subtotal: st.regular * st.unit, deal: false });
    return rows;
  };
  const fire = () => onChange?.();
  const refreshAll = () => { paintQuantity(); paintTypes(); paintSwap(); fire(); };

  function lock(d) {
    openModal({
      title: '🔒 Fixed special deal',
      body: h('div', null,
        h('p', null, `“${d.name}” is ${d.containers} quantity for ${peso(d.total)}. The quantity and the price of a deal cannot be changed here.`),
        h('p', null, h('strong', null, 'What to do: '), 'use − and + to add or remove whole deals. For extra quantity, use the “Quantity” box. To change a deal itself, the owner can edit it in ⚙️ Settings → Special deals.')),
      actions: [{ label: 'OK, I understand', kind: 'primary' }]
    });
  }

  /* ---- quantity box */
  function paintQuantity() {
    clear(parts.quantity);
    const hasDeal = dealsArr().length > 0;
    qtyStepper = stepper({ value: st.regular, min: 0, max: 999, label: 'Quantity', onChange: (v) => { st.regular = v; st.regularTouched = true; paintTypes(); paintSwap(); fire(); } });
    const quick = h('div', { class: 'suggest' }, [1, 2, 3, 4, 5, 10].map((n) => h('button', { type: 'button', class: `chip ${st.regular === n ? 'on' : ''}`, onclick: () => { st.regular = n; st.regularTouched = true; refreshAll(); } }, String(n))));
    parts.quantity.append(qtyStepper.el, quick, hasDeal ? h('p', { class: 'hint' }, 'This is the extra quantity, on top of the special deals.') : null);
  }

  /* ---- specials + price box */
  function paintDeals() {
    clear(parts.deals);
    if (s.specials.length) {
      const wrap = h('div', { class: 'field' }, h('span', { class: 'label' }, '🎁 Special deals'));
      const tiles = h('div', { class: 'suggest' });
      for (const d of s.specials) {
        const count = st.counts[d.key];
        tiles.append(h('button', { type: 'button', class: `chip deal-chip ${count ? 'on' : ''}`, 'aria-pressed': count ? 'true' : 'false', title: `${d.containers} quantity for ${peso(d.total)}`,
          onclick: () => {
            if (count) { lock(d); return; }
            const first = !dealsArr().length;
            st.counts[d.key] = 1;
            if (first && !st.regularTouched) st.regular = 0; // buying a deal usually means no extra regular quantity
            paintDeals(); refreshAll();
          } }, d.name));
      }
      wrap.append(tiles);
      for (const d of s.specials) {
        const count = st.counts[d.key];
        if (!count) continue;
        const sp = stepper({ value: count, min: 0, max: 99, size: 'sm', label: `${d.name} deals`, onChange: (v) => { st.counts[d.key] = v; if (v === 0) paintDeals(); refreshAll(); } });
        wrap.append(h('div', { class: 'deal on' }, h('div', { class: 'deal-info' }, h('strong', null, d.name), h('div', { class: 'muted' }, `${d.containers} quantity · ${peso(d.total)} each deal`)), sp.el, h('button', { class: 'btn small', type: 'button', onclick: () => lock(d), 'aria-label': 'Why is this fixed?' }, '🔒 Fixed')));
      }
      parts.deals.append(wrap);
    }
    /* price */
    const def = defaultPrice(s, fulfillment);
    const opts = [{ value: 'regular', label: `Regular ${peso(def)}` }, ...s.pricePresets.map((p) => ({ value: `p:${p.key}`, label: `${p.name} ${peso(p.price)}` })), { value: 'custom', label: 'Other price…' }];
    const cur = st.customPrice ? 'custom' : st.unit === def ? 'regular' : `p:${s.pricePresets.find((p) => p.price === st.unit)?.key}`;
    const pc = choice({ label: 'Price each', value: cur, options: opts, onChange: (v) => {
      if (!v) return;
      if (v === 'regular') { st.unit = def; st.customPrice = false; }
      else if (v === 'custom') st.customPrice = true;
      else { const p = s.pricePresets.find((x) => `p:${x.key}` === v); if (p) { st.unit = p.price; st.customPrice = false; } }
      paintDeals(); fire();
    } });
    pc.el.classList.add('price-choice');
    const priceBox = h('div', { class: 'field' }, h('span', { class: 'label' }, '🏷 Price for each regular quantity'), pc.el);
    if (st.customPrice) {
      const inp = h('input', { type: 'text', inputMode: 'decimal', value: pesoInput(st.unit), 'aria-label': 'Price each (₱)', style: { maxWidth: '10rem', marginTop: '.5rem' } });
      inp.addEventListener('input', () => { const c = toCentavos(inp.value); if (!Number.isNaN(c) && c >= 0) { st.unit = c; fire(); } });
      priceBox.append(inp);
    }
    parts.deals.append(priceBox);
  }

  /* ---- container type box */
  function paintTypes() {
    clear(parts.types);
    const q = quantity();
    if (types.length < 2) { parts.types.append(h('div', null, `${types[0].icon} ${types[0].name}: `, h('strong', null, String(q)))); return; }
    const all = choice({ label: 'Container type', value: st.typeMode, options: [...types.map((t) => ({ value: t.key, label: `All ${t.icon} ${t.name}` })), { value: 'mix', label: 'Mix' }], onChange: (v) => {
      if (!v) return;
      st.typeMode = v;
      if (v === 'mix' && !Object.values(st.others).some((n) => n > 0)) { /* start mixed with everything on the first type */ }
      paintTypes(); paintSwap(); fire();
    } });
    all.el.classList.add('type-choice');
    parts.types.append(all.el);
    if (st.typeMode === 'mix') {
      const c = containers();
      const mix = h('div', { class: 'stack', style: { marginTop: '.6rem' } });
      for (const t of types.slice(1)) {
        const sp = stepper({ value: c[t.key], min: 0, max: q, size: 'sm', label: `${t.name} quantity`, onChange: (v) => { st.others[t.key] = v; paintTypes(); paintSwap(); fire(); } });
        mix.append(h('div', { class: 'row' }, h('span', { class: 'type-label' }, `${t.icon} ${t.name}`), sp.el));
      }
      const f = types[0];
      mix.append(h('div', { class: 'muted' }, `${f.icon} ${f.name}: `, h('strong', null, String(c[firstKey])), ' (the rest)'));
      parts.types.append(mix);
    }
  }

  /* ---- containers swapped (delivery) */
  function paintSwap() {
    clear(parts.swap);
    if (fulfillment !== 'delivery') return;
    const mode = choice({ label: 'Containers from the customer', value: st.owedMode, options: [{ value: 'all', label: '🔁 All swapped' }, { value: 'some', label: '⚠️ Some NOT taken' }], onChange: (v) => {
      st.owedMode = v || 'all';
      if (st.owedMode === 'some' && !O.sumObj(st.owed)) st.owed = { ...containers() };
      paintSwap(); fire();
    } });
    parts.swap.append(mode.el);
    if (st.owedMode === 'some') {
      const c = containers();
      parts.swap.append(h('p', { class: 'hint' }, 'How many containers did the rider NOT take back?'));
      for (const t of types) {
        if (!c[t.key]) continue;
        st.owed[t.key] = Math.min(st.owed[t.key] ?? c[t.key], c[t.key]);
        const sp = stepper({ value: st.owed[t.key], min: 0, max: c[t.key], size: 'sm', label: `${t.name} containers not taken`, onChange: (v) => { st.owed[t.key] = v; fire(); } });
        parts.swap.append(h('div', { class: 'row', style: { marginTop: '.4rem' } }, h('span', { class: 'type-label' }, `${t.icon} ${t.name} still with customer`), sp.el));
      }
    }
  }

  paintQuantity(); paintDeals(); paintTypes(); paintSwap();

  // `el` = everything stacked, for the Edit-order window. The Counter places each part in its own box instead.
  const el = h('div', { class: 'lines' },
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Quantity'), parts.quantity), parts.deals,
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Container type'), parts.types),
    fulfillment === 'delivery' ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Containers from the customer'), parts.swap) : null);

  return {
    el, parts,
    get: () => ({ deals: dealsArr(), regular_qty: st.regular, unit_price: st.unit, price_label: priceLabel(), containers: containers(), empties_owed: owed() }),
    total, quantity, breakdown, priceLabel
  };
}

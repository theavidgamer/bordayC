import { h, svg, clear } from './dom.js';
import { peso } from '../core/money.js';

/* ------------------------------------------------------------------ toast */
let toastTimer = null;
export function toast(message, { action = null, ms = 5000, kind = 'info' } = {}) {
  const host = document.getElementById('toast');
  clear(host);
  host.className = `toast show ${kind}`;
  host.append(h('span', null, message));
  if (action) host.append(h('button', { class: 'btn small ghost-light', onclick: () => { action.onClick(); hideToast(); } }, action.label));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
export function hideToast() { const t = document.getElementById('toast'); if (t) t.className = 'toast'; }

/* ------------------------------------------------------------------ modal */
const stack = [];
/** openModal({title, body, actions:[{label, kind:'primary'|'danger'|'', onClick:()=>bool|Promise, keepOpen}], wide}) */
export function openModal({ title, body, actions = [], wide = false, onClose = null }) {
  const previouslyFocused = document.activeElement;
  const root = document.getElementById('modal-root');
  const close = () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    overlay.remove();
    if (!stack.length) document.body.classList.remove('modal-open');
    previouslyFocused?.focus?.();
    onClose?.();
  };
  const err = h('p', { class: 'form-error', role: 'alert' });
  const buttons = actions.map((a) => h('button', {
    class: `btn ${a.kind || ''}`, type: 'button',
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const res = await a.onClick?.({ close, setError: (m) => { err.textContent = m || ''; } });
        if (res === false) { btn.disabled = false; return; }
        if (!a.keepOpen) close();
      } catch (ex) { err.textContent = ex.message || String(ex); }
      btn.disabled = false;
    }
  }, a.label));
  const dialog = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabIndex: -1 },
    h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div', { class: 'modal-body' }, body, err),
    buttons.length ? h('div', { class: 'modal-actions' }, buttons) : null);
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } }, dialog);
  const entry = { close };
  stack.push(entry);
  document.body.classList.add('modal-open');
  root.append(overlay);
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...dialog.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  const firstInput = dialog.querySelector('input:not([type=hidden]),select,textarea');
  (firstInput || dialog).focus();
  return { close, setError: (m) => { err.textContent = m || ''; } };
}

export function confirmModal({ title, message, okLabel = 'Yes', kind = 'primary', cancelLabel = 'Cancel', onConfirm }) {
  const body = h('div', null, ...String(message).split('\n').map((l) => h('p', null, l)));
  return openModal({ title, body, actions: [{ label: cancelLabel }, { label: okLabel, kind, onClick: onConfirm }] });
}

/* ------------------------------------------------------------- form bits */
export function field(label, control, hint) {
  const id = control.id || `f${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('p', { class: 'hint' }, hint) : null);
}

/** Big − / + stepper. Returns {el, get, set} */
export function stepper({ value = 1, min = 0, max = 9999, onChange, label = 'Quantity', size = '' }) {
  let v = value;
  const input = h('input', { class: 'step-value', type: 'text', inputMode: 'numeric', value: String(v), 'aria-label': label });
  const apply = (n, fire = true) => {
    n = Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
    v = n; input.value = String(n);
    if (fire) onChange?.(n);
  };
  input.addEventListener('input', () => { const n = parseInt(input.value.replace(/\D/g, ''), 10); if (Number.isFinite(n)) { v = Math.max(min, Math.min(max, n)); onChange?.(v); } });
  input.addEventListener('blur', () => apply(v, false));
  input.addEventListener('focus', () => input.select());
  const el = h('div', { class: `stepper ${size}`, role: 'group', 'aria-label': label },
    h('button', { class: 'step-btn', type: 'button', 'aria-label': `Less ${label}`, onclick: () => apply(v - 1) }, '−'), input,
    h('button', { class: 'step-btn', type: 'button', 'aria-label': `More ${label}`, onclick: () => apply(v + 1) }, '+'));
  return { el, get: () => v, set: (n) => apply(n, false) };
}

/** Segmented single-choice buttons. options: [{value,label}] */
export function choice({ options, value = null, onChange, label, allowNone = false }) {
  let cur = value;
  const wrap = h('div', { class: 'choice', role: 'radiogroup', 'aria-label': label });
  const paint = () => [...wrap.children].forEach((b) => { const on = b.dataset.value === String(cur); b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
  for (const o of options) {
    wrap.append(h('button', {
      type: 'button', role: 'radio', class: 'chip', dataset: { value: String(o.value) },
      onclick: () => { cur = allowNone && cur === o.value ? null : o.value; paint(); onChange?.(cur); }
    }, o.label));
  }
  paint();
  return { el: wrap, get: () => cur, set: (v) => { cur = v; paint(); } };
}

export const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);
export const emptyState = (title, hint) => h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, title), hint ? h('p', { class: 'hint' }, hint) : null);

/* ----------------------------------------------------------------- charts */
const fmtAxis = (c) => (c >= 100000 ? `₱${Math.round(c / 100000) / 10}k` : peso(c));

/** Simple accessible bar chart. series: [{label, value, value2?}] */
export function barChart({ data, height = 180, title, color2 = false, format = fmtAxis, labelEvery = 1 }) {
  const W = 640, H = height, padL = 46, padB = 24, padT = 8;
  const max = Math.max(1, ...data.map((d) => Math.max(d.value || 0, d.value2 || 0)));
  const bw = (W - padL) / data.length;
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': title }, svg('title', {}, title));
  for (let i = 0; i <= 2; i++) {
    const y = padT + (H - padB - padT) * (1 - i / 2);
    g.append(svg('line', { x1: padL, x2: W, y1: y, y2: y, class: 'grid' }));
    g.append(svg('text', { x: padL - 6, y: y + 4, class: 'axis', 'text-anchor': 'end' }, format(Math.round((max * i) / 2))));
  }
  data.forEach((d, i) => {
    const x = padL + i * bw;
    const hh = (v) => ((H - padB - padT) * (v || 0)) / max;
    const w = color2 ? bw * 0.38 : bw * 0.6;
    const x1 = x + (color2 ? bw * 0.1 : bw * 0.2);
    g.append(svg('rect', { x: x1, y: H - padB - hh(d.value), width: w, height: Math.max(0, hh(d.value)), rx: 2, class: 'bar a' }, svg('title', {}, `${d.label}: ${format(d.value || 0)}`)));
    if (color2) g.append(svg('rect', { x: x1 + w + 2, y: H - padB - hh(d.value2), width: w, height: Math.max(0, hh(d.value2)), rx: 2, class: 'bar b' }, svg('title', {}, `${d.label} expenses: ${format(d.value2 || 0)}`)));
    if (i % labelEvery === 0) g.append(svg('text', { x: x + bw / 2, y: H - 8, class: 'axis', 'text-anchor': 'middle' }, d.label));
  });
  return g;
}

/** Horizontal share bars: rows [{label, value}] */
export function shareBars(rows, format = peso) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h('div', { class: 'share' }, rows.map((r) => h('div', { class: 'share-row' },
    h('div', { class: 'share-label' }, r.label),
    h('div', { class: 'share-track' }, h('div', { class: 'share-fill', style: { width: `${Math.max(2, (r.value / max) * 100)}%` } })),
    h('div', { class: 'share-val' }, format(r.value)))));
}

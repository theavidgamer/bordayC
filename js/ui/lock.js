// One casual PIN protects Books and (optionally) Rider pay. Unlock lasts a few minutes.
import { h } from './dom.js';
import { openModal, toast } from './components.js';
import * as S from '../data/store.js';
import { verifyPin } from '../core/pin.js';

const UNLOCK_MS = 5 * 60 * 1000;
let unlockedAt = 0, failures = 0;
export const hasPin = () => !!S.state.settings.booksPin;
export const isUnlocked = () => !hasPin() || Date.now() - unlockedAt < UNLOCK_MS;
export const touch = () => { if (hasPin() && isUnlocked()) unlockedAt = Date.now(); };
export const unlockNow = () => { unlockedAt = Date.now(); failures = 0; };
export const lockNow = () => { unlockedAt = 0; };

/** Inline lock card: calls onOk() after a correct PIN. */
export function pinCard(title, onOk) {
  const pin = h('input', { type: 'password', inputMode: 'numeric', autocomplete: 'off', maxLength: 12, placeholder: 'PIN', 'aria-label': 'PIN', style: { maxWidth: '12rem', textAlign: 'center', fontSize: '1.4rem' } });
  const err = h('p', { class: 'form-error', role: 'alert' });
  let busy = false;
  const go = async () => {
    if (busy) return; busy = true;
    if (await verifyPin(pin.value, S.state.settings.booksPin)) { unlockNow(); onOk(); return; }
    failures++; err.textContent = failures >= 3 ? 'Wrong PIN. Please ask the owner.' : 'Wrong PIN. Try again.'; pin.value = ''; busy = false;
  };
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return h('div', { class: 'card lock-card' }, h('h2', null, `🔒 ${title}`), h('p', { class: 'muted' }, 'Ask the owner for the PIN.'), pin, err, h('div', { style: { marginTop: '.6rem' } }, h('button', { class: 'btn primary', onclick: go }, 'Open')));
}

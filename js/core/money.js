// All money inside the app is an INTEGER number of centavos. Never floats.

/** Parse what a person typed ("20", "20.5", "₱1,250.75") into centavos. NaN if invalid. */
export function toCentavos(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : NaN;
  if (input == null) return 0;
  const s = String(input).replace(/[₱,\s]/g, '');
  if (s === '') return 0;
  if (!/^-?\d*\.?\d*$/.test(s) || s === '-' || s === '.' || s === '-.') return NaN;
  const neg = s[0] === '-';
  const [i = '', f = ''] = s.replace('-', '').split('.');
  let c = parseInt(i || '0', 10) * 100 + parseInt((f + '00').slice(0, 2), 10);
  if (f.length > 2 && f[2] >= '5') c += 1;
  return neg ? -c : c;
}

/** Display: ₱20, ₱20.50, -₱5 */
export function peso(centavos) {
  const n = Math.round(Number(centavos) || 0);
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const w = whole.toLocaleString('en-PH');
  const body = cents === 0 ? w : `${w}.${String(cents).padStart(2, '0')}`;
  return `${n < 0 ? '-' : ''}₱${body}`;
}

/** For an <input>: 2000 -> "20", 2050 -> "20.50" */
export function pesoInput(centavos) {
  const n = Math.round(Number(centavos) || 0);
  if (n === 0) return '';
  const whole = Math.trunc(n / 100);
  const cents = Math.abs(n % 100);
  return cents === 0 ? String(whole) : `${whole}.${String(cents).padStart(2, '0')}`;
}

/** Plain decimal pesos for CSV: 2050 -> "20.50" */
export function pesoPlain(centavos) {
  const n = Math.round(Number(centavos) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export const sum = (arr, fn = (x) => x) => arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0);

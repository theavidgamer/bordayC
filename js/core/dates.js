// Dates are grouped by the calendar day in the business timezone, never the device's.

const fmtCache = new Map();
function dtf(tz, opts) {
  const key = tz + JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...opts }));
  return fmtCache.get(key);
}

/** "2026-10-29" for an ISO string / ms in the given IANA timezone. */
export function dateKey(when, tz) {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  return dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function hourOf(when, tz) {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return 0;
  const p = dtf(tz, { hour: '2-digit', hourCycle: 'h23' }).format(d);
  return parseInt(p, 10) % 24;
}

const utc = (key) => new Date(`${key}T00:00:00Z`);
export const weekdayOf = (key) => utc(key).getUTCDay(); // 0 = Sunday
export function addDays(key, n) {
  const d = utc(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
export const monthOf = (key) => key.slice(0, 7);
export const yearOf = (key) => key.slice(0, 4);
export function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}
export function eachDay(from, to) {
  const out = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}
export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}
export const minutesBetween = (a, b) => (new Date(b) - new Date(a)) / 60000;
export function mondayOf(key) {
  const wd = weekdayOf(key);
  return addDays(key, -((wd + 6) % 7));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayName = (key) => DAYS[weekdayOf(key)];
export const monthName = (i) => MONTHS[i];
export function prettyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${DAYS[weekdayOf(key)]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}
export function shortDate(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
export function prettyTime(when, tz) {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-PH', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}
export function ago(when, nowMs = Date.now()) {
  const m = Math.max(0, Math.round((nowMs - new Date(when).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}

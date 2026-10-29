const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ID_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;
export const isSafeId = (v) => typeof v === 'string' && ID_PATTERN.test(v);

function randomCode(len) {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 32];
  return out;
}

/** e.g. T-20261029-K3F9QX : device code, business date, 30 random bits.
 *  Two devices can never collide, and the id is safe to put in HTML/attributes. */
export function newOrderId(deviceCode, dateKeyStr) {
  return `${deviceCode}-${dateKeyStr.replace(/-/g, '')}-${randomCode(6)}`;
}
export const newExpenseId = (deviceCode) => `X${deviceCode}-${randomCode(8)}`;
export const newCustomerId = (deviceCode) => `C${deviceCode}-${randomCode(8)}`;
export const newCloseId = (deviceCode, dateKeyStr) => `Z${deviceCode}-${dateKeyStr.replace(/-/g, '')}-${randomCode(4)}`;

export function sanitizeDeviceCode(v) {
  const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  return s || 'D';
}

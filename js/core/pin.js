// A casual lock for the Books area (keeps cashiers out of profit numbers). It is NOT strong security:
// anyone with the physical device and technical skill can still read the stored data.
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function newSalt() {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return hex(b);
}
export async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256);
  return hex(bits);
}
export async function verifyPin(pin, record) {
  if (!record) return true;
  return (await hashPin(pin, record.salt)) === record.hash;
}

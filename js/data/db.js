// Thin IndexedDB wrapper. A write only counts as saved when the transaction COMPLETES.
const DB_NAME = 'water-station-ledger';
const DB_VERSION = 1;
export const STORES = { orders: 'order_id', expenses: 'expense_id', customers: 'customer_id', closes: 'close_id', meta: 'key', snapshots: 'date' };

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('This browser cannot store data (IndexedDB missing).'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('Could not open storage.'));
    req.onblocked = () => reject(new Error('Storage is blocked by another open tab. Close other tabs and reload.'));
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

function runTx(storeNames, mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Storage write failed.'));
    tx.onabort = () => reject(tx.error || new Error('Storage write was cancelled (disk full?).'));
    try { result = work(tx); } catch (e) { try { tx.abort(); } catch { /* already finished */ } reject(e); }
  }));
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function getAll(store) {
  const db = await openDb();
  return reqP(db.transaction(store, 'readonly').objectStore(store).getAll());
}

/** Atomic multi-store write: ops = { orders:[...], expenses:[...], meta:[{key,value}], deleteKeys:{store:[keys]} } */
export function commit(ops) {
  const names = Object.keys(ops).filter((k) => k in STORES && ops[k] && ops[k].length);
  const dels = ops.deleteKeys || {};
  const all = [...new Set([...names, ...Object.keys(dels)])];
  if (!all.length) return Promise.resolve();
  return runTx(all, 'readwrite', (tx) => {
    for (const n of names) { const st = tx.objectStore(n); for (const row of ops[n]) st.put(row); }
    for (const [n, keys] of Object.entries(dels)) { const st = tx.objectStore(n); for (const k of keys) st.delete(k); }
  });
}

export function clearAll(keep = []) {
  const names = Object.keys(STORES).filter((n) => !keep.includes(n));
  return runTx(names, 'readwrite', (tx) => { for (const n of names) tx.objectStore(n).clear(); });
}

/** Replace the whole contents of the given stores in ONE transaction (used by restore). */
export function replaceAll(data) {
  const names = Object.keys(data).filter((n) => n in STORES);
  return runTx(names, 'readwrite', (tx) => {
    for (const n of names) { const st = tx.objectStore(n); st.clear(); for (const row of data[n]) st.put(row); }
  });
}

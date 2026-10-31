// Map math. No internet needed: distances are straight-line (haversine) times a "road factor".
export const validCoord = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
export const round6 = (n) => Math.round(n * 1e6) / 1e6;
const rad = (d) => (d * Math.PI) / 180;

/** Straight-line distance in km. */
export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** Rough travel: road km = straight line × detour; minutes at an average speed. */
export function travel(a, b, { speedKmh = 20, detour = 1.4 } = {}) {
  const km = haversineKm(a, b) * detour;
  return { km, minutes: (km / Math.max(1, speedKmh)) * 60 };
}

/** Read a place out of text pasted from Google Maps. Returns {lat,lng} or {error}. Short links (maps.app.goo.gl) cannot be opened offline. */
export function parseMapLink(text) {
  const t = String(text || '').trim();
  if (!t) return { error: 'Paste a Google Maps link or the coordinates first.' };
  let dec = t;
  try { dec = decodeURIComponent(t); } catch { /* keep raw */ }
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const tries = [
    new RegExp(`^${num}\\s*[,;\\s]\\s*${num}$`),
    new RegExp(`!3d${num}!4d${num}`),
    new RegExp(`@${num},${num}`),
    new RegExp(`[?&](?:q|ll|query|center|destination|daddr)=\\+?${num}\\s*,\\s*${num}`)
  ];
  for (const re of tries) {
    const m = dec.match(re);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (validCoord(lat, lng)) return { lat: round6(lat), lng: round6(lng) };
    }
  }
  if (/(goo\.gl|maps\.app)/i.test(t)) return { error: 'This is a short link. Open it in your browser first, then copy the long address from the address bar and paste that here.' };
  return { error: 'I could not find a location in that text. Try the long Google Maps link, or type it like 14.5995, 121.0' };
}

export const googleMapsUrl = (p) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
export const googleDirectionsUrl = (to, from = null) => `https://www.google.com/maps/dir/?api=1${from ? `&origin=${from.lat},${from.lng}` : ''}&destination=${to.lat},${to.lng}`;

/* ---------------------------------------------------------------- route order */

function openPathLength(start, pts, dist) { let d = 0, cur = start; for (const p of pts) { d += dist(cur, p); cur = p; } return d; }
function nearestThen2opt(start, pts, dist = haversineKm) {
  const left = [...pts], path = [];
  let cur = start;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((p, i) => { const d = dist(cur, p); if (d < bd) { bd = d; bi = i; } });
    cur = left.splice(bi, 1)[0]; path.push(cur);
  }
  let improved = path.length > 2;
  while (improved) {
    improved = false;
    for (let i = 0; i < path.length - 1; i++) {
      for (let j = i + 1; j < path.length; j++) {
        const cand = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)];
        if (openPathLength(start, cand, dist) + 1e-9 < openPathLength(start, path, dist)) { path.splice(0, path.length, ...cand); improved = true; }
      }
    }
  }
  return path;
}

/** Order stops to visit, starting at `start`. Rush (priority) stops come first, then the rest from where the rush stops end. stops: [{id,lat,lng,priority}] */
export function orderRoute(start, stops, dist = haversineKm) {
  const rush = nearestThen2opt(start, stops.filter((s) => s.priority), dist);
  const from = rush.length ? rush[rush.length - 1] : start;
  const rest = nearestThen2opt(from, stops.filter((s) => !s.priority), dist);
  return [...rush, ...rest];
}

/** legs between start and each ordered stop, plus totals. */
export function routeStats(start, ordered, opts) {
  let cur = start, km = 0, minutes = 0;
  const legs = ordered.map((p) => { const t = travel(cur, p, opts); cur = p; km += t.km; minutes += t.minutes; return t; });
  return { legs, km, minutes };
}

export const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`);
export const fmtMin = (m) => (m < 1 ? '<1 min' : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);

/* ------------------------------------------------------------ map tiles (Web Mercator) */
export const TILE = 256;
export function project(lat, lng, z) {
  const n = TILE * 2 ** z, s = Math.sin(rad(Math.max(-85.0511, Math.min(85.0511, lat))));
  return { x: ((lng + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}
export function unproject(x, y, z) {
  const n = TILE * 2 ** z;
  const lng = (x / n) * 360 - 180, a = Math.PI - (2 * Math.PI * y) / n;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(a)), lng };
}
/** Zoom level that fits all points in width×height (max 17). */
export function fitZoom(points, w, h, pad = 40) {
  if (points.length < 2) return 16;
  for (let z = 17; z >= 2; z--) {
    const ps = points.map((p) => project(p.lat, p.lng, z));
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    if (Math.max(...xs) - Math.min(...xs) <= w - pad * 2 && Math.max(...ys) - Math.min(...ys) <= h - pad * 2) return z;
  }
  return 2;
}

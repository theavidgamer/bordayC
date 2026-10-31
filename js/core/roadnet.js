// Offline road network: shortest road distance between two places, with a safe fallback where roads are missing.
// Pure logic (no browser needed). Data comes from public/data/roads.json (OpenStreetMap, ODbL) plus roads drawn by staff.
import { haversineKm, validCoord, round6 } from './geo.js';

export const SNAP_M = 40;          // a drawn road's ends join an existing road if it is this close (metres)
export const MAX_OFFROAD_M = 1500; // a pin farther than this from every road is not forced onto the network
const CLASS_NAMES = ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'track', 'other'];

const M = (lat, lng, lat0) => [lng * 111320 * Math.cos((lat0 * Math.PI) / 180), lat * 110540]; // flat-earth metres, fine at town scale

/** Drawn roads come from storage (or a backup file): never trust them. */
export function sanitizeCustomRoads(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list.slice(0, 200)) {
    if (!r || typeof r !== 'object' || !Array.isArray(r.pts)) continue;
    const pts = r.pts.slice(0, 300).map((p) => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [NaN, NaN])).filter((p) => validCoord(p[0], p[1])).map((p) => [round6(p[0]), round6(p[1])]);
    if (pts.length < 2) continue;
    out.push({ id: String(r.id || `road_${out.length}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || `road_${out.length}`, name: String(r.name || '').trim().slice(0, 60), pts, created_at: typeof r.created_at === 'string' ? r.created_at.slice(0, 30) : null });
  }
  return out;
}

class Heap { // tiny binary min-heap of [priority, id]
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(p, v) { const a = this.a; a.push([p, v]); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[j], a[i]] = [a[i], a[j]]; i = j; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
}

export function buildNet(data, customRoads = []) {
  const lat = [], lng = [], adj = [];
  const segs = []; // {a,b,cls,custom}
  const ways = []; // for drawing: {cls, name, pts:[[lat,lng]], custom}
  const addNode = (la, lo) => { lat.push(la); lng.push(lo); adj.push([]); return lat.length - 1; };
  const km = (a, b) => haversineKm({ lat: lat[a], lng: lng[a] }, { lat: lat[b], lng: lng[b] });
  const link = (a, b, cls, custom) => { if (a === b) return; const w = km(a, b); adj[a].push([b, w]); adj[b].push([a, w]); segs.push({ a, b, cls, custom }); };

  const base = data?.nodes ? data.nodes.length : 0;
  for (const n of data?.nodes || []) addNode(n[0], n[1]);
  for (const [cls, ni, ids] of data?.ways || []) {
    for (let i = 0; i < ids.length - 1; i++) link(ids[i], ids[i + 1], cls, false);
    ways.push({ cls, name: ni >= 0 ? data.names[ni] : '', pts: ids.map((i) => [lat[i], lng[i]]), custom: false });
  }
  const places = (data?.places || []).map(([name, kind, la, lo]) => ({ name, kind, lat: la, lng: lo }));
  const bbox = data?.bbox || null;

  /** nearest point on any road. Returns {seg, t, lat, lng, distM} or null. */
  function nearest(p, onlyBase = false) {
    let best = null;
    const lat0 = p.lat;
    const [px, py] = M(p.lat, p.lng, lat0);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]; if (onlyBase && s.custom) continue;
      const [ax, ay] = M(lat[s.a], lng[s.a], lat0), [bx, by] = M(lat[s.b], lng[s.b], lat0);
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (!best || d < best.distM) best = { seg: i, t, distM: d };
    }
    if (!best) return null;
    const s = segs[best.seg];
    best.lat = lat[s.a] + (lat[s.b] - lat[s.a]) * best.t; best.lng = lng[s.a] + (lng[s.b] - lng[s.a]) * best.t;
    return best;
  }

  // drawn roads: their own nodes, ends welded to the nearest real road when it is close enough
  const joined = [];
  for (const r of customRoads) {
    const ids = r.pts.map(([la, lo]) => addNode(la, lo));
    for (let i = 0; i < ids.length - 1; i++) link(ids[i], ids[i + 1], 8, true);
    ways.push({ cls: 8, name: r.name, pts: r.pts.slice(), custom: true, id: r.id });
    const joins = [];
    for (const id of [ids[0], ids[ids.length - 1]]) {
      const hit = nearest({ lat: lat[id], lng: lng[id] }, true);
      if (hit && hit.distM <= SNAP_M) {
        const s = segs[hit.seg]; const v = addNode(hit.lat, hit.lng);
        link(v, s.a, s.cls, false); link(v, s.b, s.cls, false); link(v, id, 8, true);
        joins.push(true);
      } else joins.push(false);
    }
    joined.push({ id: r.id, start: joins[0], end: joins[1] });
  }

  function dijkstra(sources, stopAt = null) { // sources: [[node, startKm]]
    const dist = new Float64Array(lat.length).fill(Infinity), prev = new Int32Array(lat.length).fill(-1), h = new Heap();
    for (const [n, d] of sources) if (d < dist[n]) { dist[n] = d; h.push(d, n); }
    while (h.size) {
      const [d, u] = h.pop();
      if (d > dist[u]) continue;
      if (stopAt && stopAt.has(u)) { stopAt.delete(u); if (!stopAt.size) break; }
      for (const [v, w] of adj[u]) if (d + w < dist[v]) { dist[v] = d + w; prev[v] = u; h.push(dist[v], v); }
    }
    return { dist, prev };
  }

  /**
   * Distance between two places. via: 'road' (both ends on the network), 'mixed' (some off-road leg estimated),
   * 'estimate' (no usable road: straight line × detour). Always returns a number so the app never breaks.
   */
  function route(a, b, { detour = 1.4 } = {}) {
    const straight = haversineKm(a, b);
    const est = { km: straight * detour, roadKm: 0, offKm: straight * detour, via: 'estimate', path: [a, b] };
    if (!segs.length || straight < 0.01) return est; // same spot (or no roads at all): nothing to follow
    const sa = nearest(a), sb = nearest(b);
    if (!sa || !sb || sa.distM > MAX_OFFROAD_M || sb.distM > MAX_OFFROAD_M) return est;
    const offKm = ((sa.distM + sb.distM) / 1000) * detour;
    const A = segs[sa.seg], B = segs[sb.seg];
    const ptA = { lat: sa.lat, lng: sa.lng }, ptB = { lat: sb.lat, lng: sb.lng };
    const nodePt = (n) => ({ lat: lat[n], lng: lng[n] });
    let best = Infinity, via = null;
    if (sa.seg === sb.seg) { best = haversineKm(ptA, ptB); via = { direct: true }; }
    const srcs = [[A.a, haversineKm(ptA, nodePt(A.a))], [A.b, haversineKm(ptA, nodePt(A.b))]];
    const { dist, prev } = dijkstra(srcs);
    for (const end of [B.a, B.b]) {
      const total = dist[end] + haversineKm(nodePt(end), ptB);
      if (total < best) { best = total; via = { end }; }
    }
    if (!isFinite(best)) return est;
    const path = [a, ptA];
    if (!via.direct) {
      const chain = []; for (let n = via.end; n !== -1; n = prev[n]) chain.push(n);
      chain.reverse().forEach((n) => path.push(nodePt(n)));
    }
    path.push(ptB, b);
    const offOnly = sa.distM + sb.distM;
    return { km: best + offKm, roadKm: best, offKm, via: offOnly < 60 ? 'road' : 'mixed', path };
  }

  return { route, nearest, ways, places, bbox, joined, segmentCount: segs.length, nodeCount: lat.length, baseNodes: base, classNames: CLASS_NAMES };
}

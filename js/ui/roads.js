// Loads the shipped road file (works offline: it is part of the app) and mixes in roads drawn by staff.
import * as S from '../data/store.js';
import { buildNet, sanitizeCustomRoads } from '../core/roadnet.js';

let data = null, net = null, netFor = null, loading = null;
export const customRoads = () => sanitizeCustomRoads(S.state.meta.customRoads);

/** Road network or null while the file is still loading. Rebuilt automatically when drawn roads change. */
export function getNet() {
  if (!data) return null;
  const ref = S.state.meta.customRoads;
  if (!net || netFor !== ref) { net = buildNet(data, customRoads()); netFor = ref; }
  return net;
}
export function loadRoads() {
  if (!loading) loading = fetch('./data/roads.json').then((r) => { if (!r.ok) throw new Error('roads'); return r.json(); }).then((d) => { data = d; net = null; }).catch(() => { loading = null; });
  return loading.then(() => getNet());
}

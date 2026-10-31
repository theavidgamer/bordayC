// Staff can draw roads that the shipped map is missing. They are saved on this device (and inside backup files).
import { h, clear } from './dom.js';
import { openModal, confirmModal, toast } from './components.js';
import * as S from '../data/store.js';
import { haversineKm, fmtKm } from '../core/geo.js';
import { SNAP_M } from '../core/roadnet.js';
import { slippyMap, stationPoint } from './map.js';
import { getNet, customRoads } from './roads.js';

const lengthKm = (pts) => pts.slice(1).reduce((a, p, i) => a + haversineKm({ lat: pts[i][0], lng: pts[i][1] }, { lat: p[0], lng: p[1] }), 0);

export function openRoadEditor() {
  const home = stationPoint();
  let draft = [];
  const status = h('p', { class: 'pin-status' });
  const name = h('input', { type: 'text', maxLength: 60, placeholder: 'Road name (optional)', 'aria-label': 'Road name' });
  const listBox = h('div', { class: 'list' });
  const err = h('p', { class: 'form-error', role: 'alert' });

  const map = slippyMap({ center: home || undefined, zoom: 16, height: 380, pictures: true, onTap: (lat, lng) => { draft.push([lat, lng]); err.textContent = ''; paint(); } });

  const joinInfo = (p) => { const net = getNet(); const hit = net?.nearest({ lat: p[0], lng: p[1] }, true); return hit && hit.distM <= SNAP_M; };
  function paint() {
    map.set({
      paths: draft.length > 1 ? [{ pts: draft.map(([lat, lng]) => ({ lat, lng })), color: '#ff7a1a', dashed: true }] : [],
      markers: draft.map(([lat, lng], i) => ({ lat, lng, kind: i === 0 ? 'station' : 'pick', label: i === 0 ? 'A' : i === draft.length - 1 ? 'B' : '•', title: `Point ${i + 1}` }))
    });
    if (!draft.length) status.textContent = 'Tap the map at the START of the road.';
    else if (draft.length === 1) status.textContent = 'Now tap along the road, one tap for each bend, ending at the other end.';
    else status.textContent = `${draft.length} points · ${fmtKm(lengthKm(draft))} · start ${joinInfo(draft[0]) ? 'joins a road ✔' : 'is not near a road'} · end ${joinInfo(draft[draft.length - 1]) ? 'joins a road ✔' : 'is not near a road'}`;
    paintList();
  }
  function paintList() {
    clear(listBox);
    const roads = customRoads();
    if (!roads.length) { listBox.append(h('p', { class: 'muted' }, 'No roads drawn yet.')); return; }
    for (const r of roads) {
      listBox.append(h('div', { class: 'item' }, h('div', null, h('div', { class: 't' }, r.name || 'Unnamed road'), h('div', { class: 's' }, `${fmtKm(lengthKm(r.pts))} · ${r.pts.length} points`)),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => map.set({ center: { lat: r.pts[0][0], lng: r.pts[0][1] }, zoom: 17 }) }, 'Show'),
          h('button', { class: 'btn small', onclick: () => confirmModal({ title: 'Remove this road?', message: `${r.name || 'This road'} will no longer be used for distances.`, okLabel: 'Remove', kind: 'danger', onConfirm: async () => { await S.save({ meta: { customRoads: customRoads().filter((x) => x.id !== r.id) } }); toast('Road removed'); paint(); } }) }, 'Remove'))));
    }
  }
  const save = async () => {
    if (draft.length < 2) { err.textContent = 'Tap at least two points on the map first.'; return; }
    const id = `R${S.state.settings.deviceCode}-${Date.now().toString(36)}`;
    await S.save({ meta: { customRoads: [...customRoads(), { id, name: name.value.trim(), pts: draft, created_at: new Date().toISOString() }] } });
    draft = []; name.value = ''; toast('Road saved. Distances now use it.', { kind: 'ok' }); paint();
  };
  paint();
  openModal({
    title: '✏️ Draw a missing road', wide: true,
    body: h('div', { class: 'stack' },
      h('p', { class: 'hint' }, 'Orange dashed lines are roads drawn by staff. Start and end close to an existing road (within about 40 m) so the new road connects.'),
      map.el, status,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { draft.pop(); paint(); } }, '↩ Undo last point'), h('button', { class: 'btn', onclick: () => { draft = []; paint(); } }, 'Start over'), name, h('button', { class: 'btn primary', onclick: save }, '✅ Save this road')),
      err, h('h3', null, 'Roads drawn so far'), listBox),
    actions: [{ label: 'Close', kind: 'primary' }]
  });
}

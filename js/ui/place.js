// Customer locations: pin, distance and travel time from the station.
import { h } from './dom.js';
import { toast, confirmModal } from './components.js';
import * as S from '../data/store.js';
import { validCoord, travel, fmtKm, fmtMin, googleMapsUrl, googleDirectionsUrl } from '../core/geo.js';
import { getNet } from './roads.js';
import { slippyMap, openPinPicker, stationPoint } from './map.js';
import { hooks } from './bus.js';

export const pinOf = (c) => (c && validCoord(c.lat, c.lng) ? { lat: c.lat, lng: c.lng } : null);
export const travelOpts = () => ({ speedKmh: S.state.settings.speedKmh || 20, detour: S.state.settings.detour || 1.4 });
/** Trip between two places along the roads: {km, minutes, via:'road'|'mixed'|'estimate', path}. Falls back to a straight-line estimate where roads are missing. */
export function roadTrip(a, b) {
  const o = travelOpts(), net = getNet();
  if (net) { const r = net.route(a, b, { detour: o.detour }); return { km: r.km, minutes: (r.km / Math.max(1, o.speedKmh)) * 60, via: r.via, path: r.path }; }
  const t = travel(a, b, o); return { ...t, via: 'estimate', path: [a, b] };
}
/** {km, minutes, via, path} from the station, or null if the customer or the station has no pin yet. */
export function fromStation(c) { const p = pinOf(c), s = stationPoint(); return p && s ? roadTrip(s, p) : null; }
export const distanceText = (t) => (t.via === 'road' ? `${fmtKm(t.km)} by road · about ${fmtMin(t.minutes)}` : t.via === 'mixed' ? `${fmtKm(t.km)} · about ${fmtMin(t.minutes)} (last part estimated)` : `≈ ${fmtKm(t.km)} · about ${fmtMin(t.minutes)} (estimate: no road found)`);

export function setCustomerPin(c, after) {
  openPinPicker({
    title: `Where does ${c.name} live?`, start: pinOf(c),
    onSave: async (lat, lng) => { await S.save({ customers: [{ ...c, lat, lng, updated_at: new Date().toISOString() }] }); toast('Location saved', { kind: 'ok' }); after?.(); }
  });
}

/** Card for the customer profile. */
export function locationCard(c, after) {
  const p = pinOf(c), s = stationPoint();
  const card = h('div', { class: 'card', style: { marginTop: '.8rem' } }, h('div', { class: 'row between' }, h('h2', null, '📍 Location'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => setCustomerPin(c, after) }, p ? 'Move pin' : '📍 Set location'),
      p ? h('button', { class: 'btn', onclick: () => confirmModal({ title: 'Remove the pin?', message: `${c.name} will have no saved location.`, okLabel: 'Remove', kind: 'danger', onConfirm: async () => { await S.save({ customers: [{ ...c, lat: null, lng: null, updated_at: new Date().toISOString() }] }); after?.(); } }) }, 'Remove') : null)));
  if (!p) { card.append(h('p', { class: 'muted' }, 'No location saved yet. Tap the map or paste a Google Maps link.')); return card; }
  const t = fromStation(c);
  card.append(h('p', null, t ? h('strong', null, distanceText(t)) : 'Distance needs the station location.', t ? h('span', { class: 'hint' }, ' from the station (estimate)') : ''));
  if (!s) card.append(h('p', { class: 'hint' }, 'Set the station location in ⚙️ Settings → Map.'));
  const m = slippyMap({ center: p, zoom: 16, height: 240, markers: [...(s ? [{ ...s, kind: 'station', label: '🏠', title: 'Station' }] : []), { ...p, kind: 'pick', label: '📍', title: c.name }], paths: t ? [{ pts: t.path, color: '#0a6c80' }] : [] });
  card.append(m.el, h('div', { class: 'row', style: { marginTop: '.6rem' } }, h('a', { class: 'btn', href: googleDirectionsUrl(p, s), target: '_blank', rel: 'noopener' }, '🧭 Open in Google Maps')));
  requestAnimationFrame(() => setTimeout(() => m.fit(s ? [s, p] : [p]), 50));
  return card;
}
export { googleMapsUrl };

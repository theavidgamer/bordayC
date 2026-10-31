// Today's delivery route: the unfinished deliveries in a good visiting order, with distance and time estimates.
import { h, clear } from './dom.js';
import { openModal, emptyState, badge } from './components.js';
import * as S from '../data/store.js';
import * as O from '../core/orders.js';
import { orderRoute, fmtKm, fmtMin, googleDirectionsUrl } from '../core/geo.js';
import { slippyMap, stationPoint } from './map.js';
import { findCustomer } from './customers.js';
import { pinOf, setCustomerPin, roadTrip } from './place.js';
import { staffName } from './view.js';
import { hooks } from './bus.js';

const pending = (o) => o.fulfillment === 'delivery' && ['not_started', 'preparing', 'otw'].includes(o.status) && !o.voided_at;

export function openRoute() {
  const host = h('div', { class: 'stack' });
  const m = openModal({ title: '🗺 Delivery route', body: host, wide: true, actions: [{ label: 'Close', kind: 'primary' }] });
  const paint = () => {
    clear(host);
    const station = stationPoint();
    const orders = [...S.state.orders.values()].filter(pending).sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (!orders.length) { host.append(emptyState('No deliveries waiting', 'Deliveries that are waiting, being prepared, or out will show here.')); return; }
    if (!station) {
      host.append(h('div', { class: 'insight warn' }, h('div', { class: 't' }, 'The station location is not set'), h('p', { class: 'hint' }, 'The route starts from the station. The owner can set it in ⚙️ Settings → Map.'), h('button', { class: 'btn small', onclick: () => { m.close(); hooks.goTo('settings'); } }, 'Open Settings')));
      return;
    }
    const withPin = [], without = [];
    for (const o of orders) {
      const c = findCustomer(o.customer_name, o.customer_id), p = pinOf(c);
      if (p) withPin.push({ id: o.order_id, order: o, customer: c, ...p, priority: !!o.priority }); else without.push({ order: o, customer: c });
    }
    const ordered = orderRoute(station, withPin, (a, b) => roadTrip(a, b).km);
    let cur = station, totKm = 0, totMin = 0;
    const legs = ordered.map((s) => { const t = roadTrip(cur, s); cur = s; totKm += t.km; totMin += t.minutes; return t; });
    const stats = { legs, km: totKm, minutes: totMin };
    const estimated = legs.some((l) => l.via !== 'road');
    host.append(h('div', { class: 'kpis stats' },
      h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'Stops'), h('div', { class: 'v' }, String(ordered.length))),
      h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'Total distance'), h('div', { class: 'v num' }, fmtKm(stats.km)), h('div', { class: 'hint' }, estimated ? 'by road, partly estimated' : 'by road')),
      h('div', { class: 'kpi' }, h('div', { class: 'k' }, 'Driving time'), h('div', { class: 'v num' }, fmtMin(stats.minutes)), h('div', { class: 'hint' }, 'not counting stops'))));
    if (ordered.length) {
      const map = slippyMap({ center: station, zoom: 14, height: 300,
        markers: [{ ...station, kind: 'station', label: '🏠', title: 'Station' }, ...ordered.map((s, i) => ({ lat: s.lat, lng: s.lng, kind: s.priority ? 'rush' : 'stop', label: String(i + 1), title: s.order.customer_name }))],
        paths: legs.map((l) => ({ pts: l.path, color: '#0a6c80', dashed: l.via === 'estimate' })) });
      host.append(map.el);
      requestAnimationFrame(() => setTimeout(() => map.fit([station, ...ordered]), 60));
      let cum = 0, prev = station;
      const rows = ordered.map((s, i) => {
        const leg = stats.legs[i]; cum += leg.minutes;
        const from = prev; prev = s;
        return h('div', { class: 'item route-stop' },
          h('div', { class: 'stop-n' }, s.priority ? '🔥' : String(i + 1)),
          h('div', { class: 'grow' }, h('div', { class: 't' }, s.order.customer_name, ' ', badge(O.STATUS_LABEL[s.order.status])), h('div', { class: 's' }, `Quantity ${s.order.quantity} · ${staffName(s.order.staff)} · ${fmtKm(leg.km)}${leg.via === 'road' ? '' : ' (estimate)'} from ${i ? 'previous stop' : 'the station'} · arrive in about ${fmtMin(cum)}`)),
          h('a', { class: 'btn small', href: googleDirectionsUrl(s, from), target: '_blank', rel: 'noopener' }, '🧭 Go'));
      });
      host.append(h('div', { class: 'list' }, rows));
    }
    if (without.length) {
      host.append(h('div', { class: 'section-h' }, h('span', null, 'No location yet'), badge(String(without.length))),
        h('div', { class: 'list' }, without.map(({ order, customer }) => h('div', { class: 'item' }, h('div', null, h('div', { class: 't' }, order.customer_name), h('div', { class: 's' }, 'Not on the route until a pin is saved.')),
          customer ? h('button', { class: 'btn small', onclick: () => setCustomerPin(customer, paint) }, '📍 Set location') : h('span', { class: 'muted small' }, 'Add a name to the order first')))));
    }
    host.append(h('p', { class: 'hint' }, 'Rush orders are visited first. Distances follow the roads in the app’s map; where a road is missing the app adds a straight-line estimate (dashed). Time uses the average speed in ⚙️ Settings → Map, not live traffic. The 🧭 Go button opens Google Maps for directions.'));
  };
  paint();
}

// The map: roads are drawn from the road file that ships with the app, so it works with NO internet.
// Optional: switch on OpenStreetMap pictures behind the roads (needs internet).
import { h, clear } from './dom.js';
import { openModal } from './components.js';
import * as S from '../data/store.js';
import { project, unproject, fitZoom, TILE, parseMapLink, validCoord, round6 } from '../core/geo.js';
import { getNet, loadRoads } from './roads.js';
import { openRoadEditor } from './roadedit.js';

const DEFAULT_CENTER = { lat: 12.0366, lng: 125.4781 }; // Dolores town centre
export const stationPoint = () => { const s = S.state.settings; return validCoord(s.stationLat, s.stationLng) ? { lat: s.stationLat, lng: s.stationLng } : null; };
const dark = () => { try { return window.matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light'; } catch { return false; } };
const getPictures = () => { try { return localStorage.getItem('ledger.mapPictures') === '1'; } catch { return false; } };
const setPictures = (v) => { try { localStorage.setItem('ledger.mapPictures', v ? '1' : '0'); } catch { /* ignore */ } };

const WIDTH = [2.4, 2.4, 1.8, 1.8, 1.2, 1.2, 0.8, 0.8, 1.2]; // trunk, primary, secondary, tertiary, unclassified, residential, service, track, drawn
function palette() {
  return dark()
    ? { bg: '#17252b', casing: '#0b1519', minor: '#3b5560', major: '#9a7a35', custom: '#ff9a3d', text: '#dbe8ec', halo: '#17252b' }
    : { bg: '#eef2f4', casing: '#a9bac2', minor: '#ffffff', major: '#ffd98a', custom: '#ff7a1a', text: '#243840', halo: '#ffffff' };
}

/**
 * markers: [{lat,lng,label,kind:'station'|'stop'|'rush'|'pick',title}]
 * paths:   [{pts:[{lat,lng}], color, dashed}]   (drawn on top of the roads)
 */
export function slippyMap({ center = DEFAULT_CENTER, zoom = 16, height = 320, markers = [], paths = [], onTap = null, onMarker = null, pictures = true } = {}) {
  const st = { center, z: zoom, markers, paths, pics: pictures && getPictures() };
  const el = h('div', { class: 'slippy', style: { height: `${height}px` }, role: 'application', 'aria-label': 'Map' });
  const tileLayer = h('div', { class: 'layer' });
  const canvas = h('canvas', { class: 'roads-canvas' });
  const markLayer = h('div', { class: 'layer' });
  const note = h('div', { class: 'map-note', hidden: true }, 'Map pictures need internet. The roads below still work.');
  const picBtn = h('button', { type: 'button', class: 'btn pic-btn', 'aria-pressed': String(st.pics), onclick: () => { st.pics = !st.pics; setPictures(st.pics); picBtn.setAttribute('aria-pressed', String(st.pics)); render(); } }, '🖼 Pictures');
  const zoomBox = h('div', { class: 'zoom-box' },
    h('button', { type: 'button', class: 'btn', 'aria-label': 'Zoom in', onclick: () => zoomBy(1) }, '＋'), h('button', { type: 'button', class: 'btn', 'aria-label': 'Zoom out', onclick: () => zoomBy(-1) }, '－'));
  el.append(tileLayer, canvas, markLayer, zoomBox, ...(pictures ? [picBtn] : []), note, h('div', { class: 'attrib' }, '© OpenStreetMap contributors'));
  let W = 600, H = height, drag = null, tileFails = 0;

  const origin = () => { const c = project(st.center.lat, st.center.lng, st.z); return { x: c.x - W / 2, y: c.y - H / 2 }; };
  const at = (p, o) => { const q = project(p.lat, p.lng, st.z); return { x: q.x - o.x, y: q.y - o.y }; };

  function drawRoads(o) {
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const pal = palette();
    if (!st.pics) { g.fillStyle = pal.bg; g.fillRect(0, 0, W, H); }
    const net = getNet();
    const scale = Math.max(0.8, (st.z - 11) * 0.62);
    const pathOf = (pts) => { g.beginPath(); pts.forEach((p, i) => { const q = at({ lat: p[0], lng: p[1] }, o); if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }); };
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (net) {
      const vis = net.ways.filter((w) => w.pts.some((p) => { const q = at({ lat: p[0], lng: p[1] }, o); return q.x > -80 && q.x < W + 80 && q.y > -80 && q.y < H + 80; }));
      for (const pass of ['casing', 'fill']) {
        for (const w of vis) {
          const wd = WIDTH[w.cls] * scale;
          pathOf(w.pts);
          if (w.custom) { g.setLineDash(pass === 'fill' ? [8, 5] : []); g.strokeStyle = pass === 'casing' ? pal.casing : pal.custom; }
          else { g.setLineDash(w.cls === 7 && pass === 'fill' ? [5, 4] : []); g.strokeStyle = pass === 'casing' ? pal.casing : (w.cls <= 3 ? pal.major : pal.minor); }
          g.lineWidth = pass === 'casing' ? wd + 2 : wd; g.stroke();
        }
      }
      g.setLineDash([]);
      if (st.z >= 17) {
        g.font = '600 11px system-ui, sans-serif'; g.textAlign = 'center'; g.lineWidth = 3;
        for (const w of vis) {
          if (!w.name) continue;
          const mid = w.pts[Math.floor(w.pts.length / 2)], q = at({ lat: mid[0], lng: mid[1] }, o);
          if (q.x < 0 || q.x > W || q.y < 0 || q.y > H) continue;
          g.strokeStyle = pal.halo; g.strokeText(w.name, q.x, q.y - 4); g.fillStyle = pal.text; g.fillText(w.name, q.x, q.y - 4);
        }
      }
    }
    for (const p of st.paths) {
      if (!p.pts || p.pts.length < 2) continue;
      pathOf(p.pts.map((q) => [q.lat, q.lng]));
      g.setLineDash(p.dashed ? [8, 6] : []); g.strokeStyle = p.color || '#0a6c80'; g.lineWidth = Math.max(4, scale * 1.6); g.globalAlpha = .9; g.stroke(); g.globalAlpha = 1;
    }
    g.setLineDash([]);
    if (net && st.z >= 12) { // place names
      g.textAlign = 'center'; g.lineWidth = 4;
      for (const pl of net.places) {
        const q = at(pl, o); if (q.x < -60 || q.x > W + 60 || q.y < -20 || q.y > H + 20) continue;
        const big = pl.kind === 'town'; g.font = `${big ? 800 : 700} ${big ? 15 : 12}px system-ui, sans-serif`;
        g.strokeStyle = pal.halo; g.strokeText(pl.name, q.x, q.y); g.fillStyle = pal.text; g.fillText(pl.name, q.x, q.y);
      }
    }
  }

  function render() {
    W = el.clientWidth || W; H = el.clientHeight || H;
    clear(tileLayer); clear(markLayer); tileLayer.style.transform = markLayer.style.transform = '';
    const o = origin(), n = 2 ** st.z;
    if (st.pics) {
      for (let tx = Math.floor(o.x / TILE); tx <= Math.floor((o.x + W) / TILE); tx++) {
        for (let ty = Math.floor(o.y / TILE); ty <= Math.floor((o.y + H) / TILE); ty++) {
          if (ty < 0 || ty >= n) continue;
          const img = h('img', { class: 'tile', alt: '', draggable: false, loading: 'lazy', referrerPolicy: 'strict-origin-when-cross-origin', style: { left: `${tx * TILE - o.x}px`, top: `${ty * TILE - o.y}px` }, src: `https://tile.openstreetmap.org/${st.z}/${((tx % n) + n) % n}/${ty}.png` });
          img.addEventListener('error', () => { img.remove(); if (++tileFails >= 3) note.hidden = false; });
          img.addEventListener('load', () => { tileFails = 0; note.hidden = true; });
          tileLayer.append(img);
        }
      }
    } else note.hidden = true;
    el.classList.toggle('has-pics', st.pics);
    drawRoads(o);
    st.markers.forEach((m, i) => {
      const p = at(m, o);
      markLayer.append(h('button', { type: 'button', class: `pin ${m.kind || 'stop'}`, style: { left: `${p.x}px`, top: `${p.y}px` }, 'aria-label': m.title || m.label || 'Place', onclick: (e) => { e.stopPropagation(); onMarker?.(m, i); } }, h('span', null, m.label ?? '')));
    });
  }
  function zoomBy(d) { st.z = Math.max(11, Math.min(20, st.z + d)); render(); }

  el.addEventListener('pointerdown', (e) => { if (e.target.closest('.zoom-box,.pin,.pic-btn')) return; drag = { x: e.clientX, y: e.clientY, moved: false }; el.setPointerCapture?.(e.pointerId); });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    if (drag.moved) { const o = origin(); drawRoads({ x: o.x - dx, y: o.y - dy }); tileLayer.style.transform = markLayer.style.transform = `translate(${dx}px,${dy}px)`; }
  });
  el.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y, moved = drag.moved; drag = null;
    if (moved) { const c = project(st.center.lat, st.center.lng, st.z); st.center = unproject(c.x - dx, c.y - dy, st.z); render(); return; }
    if (onTap) { const r = el.getBoundingClientRect(), o = origin(); const p = unproject(o.x + (e.clientX - r.left), o.y + (e.clientY - r.top), st.z); onTap(round6(p.lat), round6(p.lng)); }
  });
  el.addEventListener('pointercancel', () => { drag = null; render(); });
  el.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (el.clientWidth && (Math.abs(el.clientWidth - W) > 2)) render(); }).observe(el);
  requestAnimationFrame(render);
  loadRoads().then(() => render());

  return {
    el,
    get zoom() { return st.z; }, get center() { return st.center; },
    set({ center: c, zoom: z, markers: m, paths: p } = {}) { if (c) st.center = c; if (z) st.z = z; if (m) st.markers = m; if (p) st.paths = p; render(); },
    setOnTap(fn) { onTap = fn; },
    fit(points) {
      const pts = points.filter((p) => validCoord(p.lat, p.lng)); if (!pts.length) return;
      const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
      st.center = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
      st.z = Math.max(11, Math.min(18, fitZoom(pts, el.clientWidth || W, el.clientHeight || H))); render();
    }
  };
}

/** Pick a place: tap the map or paste a Google Maps link. onSave(lat, lng) */
export function openPinPicker({ title, start = null, hint = 'Tap the map where it is.', onSave }) {
  const home = stationPoint();
  let pick = start && validCoord(start.lat, start.lng) ? { lat: start.lat, lng: start.lng } : null;
  const where = pick || home || DEFAULT_CENTER;
  const status = h('p', { class: 'pin-status' });
  const markersNow = () => [...(home && !(start && home.lat === start.lat) ? [{ ...home, kind: 'station', label: '🏠', title: 'Station' }] : []), ...(pick ? [{ ...pick, kind: 'pick', label: '📍', title: 'Chosen place' }] : [])];
  const paintStatus = () => { status.textContent = pick ? `Chosen: ${pick.lat.toFixed(5)}, ${pick.lng.toFixed(5)}` : 'Nothing chosen yet.'; };
  const map = slippyMap({ center: where, zoom: 16, height: 340, markers: markersNow(), onTap: (lat, lng) => { pick = { lat, lng }; map.set({ markers: markersNow() }); paintStatus(); } });
  const link = h('input', { type: 'text', placeholder: 'Paste a Google Maps link or 12.04, 125.48', 'aria-label': 'Google Maps link', autocomplete: 'off' });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const useLink = () => {
    const r = parseMapLink(link.value);
    if (r.error) { err.textContent = r.error; return; }
    err.textContent = ''; pick = { lat: r.lat, lng: r.lng }; map.set({ center: pick, zoom: 17, markers: markersNow() }); paintStatus();
  };
  link.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); useLink(); } });
  paintStatus();
  openModal({
    title, wide: true,
    body: h('div', { class: 'stack' }, h('p', { class: 'hint' }, hint), map.el, status, h('button', { type: 'button', class: 'btn small', onclick: openRoadEditor }, '✏️ A road is missing? Draw it'),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Or paste a link'), h('div', { class: 'row' }, link, h('button', { type: 'button', class: 'btn', onclick: useLink }, 'Use link')), err)),
    actions: [{ label: 'Cancel' }, { label: 'Save pin', kind: 'primary', onClick: async ({ setError }) => { if (!pick) { setError('Tap the map or paste a link first.'); return false; } await onSave(pick.lat, pick.lng); } }]
  });
}

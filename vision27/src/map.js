import { GOV_SITES } from './sites.js';
import * as THREE from 'three';
import { DISTRICTS, ROADS, segDist, districtAt } from './world.js';
import { PLOTS } from './plots.js';
import { naira } from './game.js';
import { G } from './game.js';

/* The map: a drawn plan of the whole city with named roads and places, a small map in the
   corner, a full map you can pan and zoom, saved pins, and GPS directions along the roads. */
const $ = id => document.getElementById(id);
const SPAN = 440, PX = 2, SIZE = SPAN * 2 * PX;              // base image: 2 px per metre
export const CATS = new Proxy({
  home: { label: 'Homes', c: '#1d8a4a', g: 'H' }, shop: { label: 'Shops', c: '#7b2d8e', g: 'S' }, food: { label: 'Food', c: '#d9772b', g: 'F' },
  market: { label: 'Markets', c: '#b5651d', g: 'M' }, school: { label: 'Schools', c: '#8b3a2a', g: 'E' }, hospital: { label: 'Hospitals', c: '#c9472f', g: '+' },
  bank: { label: 'Banks', c: '#16213a', g: '₦' }, government: { label: 'Government', c: '#b8891c', g: '★' }, cinema: { label: 'Cinema', c: '#a3243b', g: '▶' },
  stadium: { label: 'Stadium', c: '#2f7f55', g: '◎' }, transport: { label: 'Transport', c: '#2e5fa8', g: 'B' }, services: { label: 'Services', c: '#5a5d62', g: '!' },
  work: { label: 'Jobs', c: '#3f5f7f', g: 'J' }, office: { label: 'Offices', c: '#6d7a86', g: 'O' }, leisure: { label: 'Leisure', c: '#3a9ab8', g: 'L' },
  worship: { label: 'Worship', c: '#7d6a55', g: 'W' }, hotel: { label: 'Hotels', c: '#5a2340', g: 'Z' }, bar: { label: 'Bars & clubs', c: '#a855f7', g: '♪' },
  pharmacy: { label: 'Pharmacies', c: '#1d8a4a', g: 'Rx' }, land: { label: 'Land for sale', c: '#6d5a2e', g: '▦' }, landmark: { label: 'Landmarks', c: '#d9a936', g: '◆' }, pin: { label: 'Your pins', c: '#e0245e', g: '●' },
}, { get: (t, k) => t[k] || (typeof k === 'string' ? t.office : undefined) });
const M = { pois: [], pins: [], route: null, dest: null, view: { x: 0, z: 0, s: 1.1 }, hidden: new Set(['office']), sel: null, base: null, edges: [], nodes: new Map(), arrows: null, beacon: null, reT: 0, street: '' };
try { M.pins = JSON.parse(localStorage.getItem('abuja.pins') || '[]').filter(p => Number.isFinite(p.x)); } catch { }
const savePins = () => { try { localStorage.setItem('abuja.pins', JSON.stringify(M.pins)); } catch { } };
const toB = (x, z) => [(x + SPAN) * PX, (z + SPAN) * PX];

/* ---------- road graph ---------- */
function buildGraph() {
  const key = (x, z) => x + ',' + z;
  ROADS.forEach(r => r.pts.forEach(([x, z]) => { if (!M.nodes.has(key(x, z))) M.nodes.set(key(x, z), { x, z, k: key(x, z), adj: [] }); }));
  ROADS.forEach(r => { for (let i = 0; i < r.pts.length - 1; i++) { const a = M.nodes.get(key(...r.pts[i])), b = M.nodes.get(key(...r.pts[i + 1])), len = Math.hypot(a.x - b.x, a.z - b.z); const e = { a, b, len, name: r.name, w: r.w }; M.edges.push(e); a.adj.push({ n: b, e }); b.adj.push({ n: a, e }); } });
}
function nearestEdge(x, z) { let best = null; for (const e of M.edges) { const s = segDist(x, z, e.a.x, e.a.z, e.b.x, e.b.z); if (!best || s.d < best.d) best = { ...s, e }; } return best; }
export function streetAt(x, z) { const n = nearestEdge(x, z); return n && n.d < n.e.w / 2 + 4 ? n.e.name : ''; }
function plan(sx, sz, tx, tz) {
  const A = nearestEdge(sx, sz), Bq = nearestEdge(tx, tz);
  const start = { x: A.x, z: A.z, adj: [{ n: A.e.a, e: A.e }, { n: A.e.b, e: A.e }] }, goal = { x: Bq.x, z: Bq.z, adj: [] };
  const link = (n, e) => ({ n: goal, e });
  const extra = new Map([[Bq.e.a, link(Bq.e.a, Bq.e)], [Bq.e.b, link(Bq.e.b, Bq.e)]]);
  if (A.e === Bq.e) start.adj.push({ n: goal, e: A.e });
  const dist = new Map([[start, 0]]), prev = new Map(), open = [start], done = new Set();
  while (open.length) {
    open.sort((a, b) => dist.get(a) - dist.get(b)); const u = open.shift(); if (u === goal) break; if (done.has(u)) continue; done.add(u);
    const nb = [...(u.adj || [])]; if (extra.has(u)) nb.push(extra.get(u));
    for (const { n, e } of nb) { const d = dist.get(u) + Math.hypot(u.x - n.x, u.z - n.z); if (d < (dist.get(n) ?? 1e12)) { dist.set(n, d); prev.set(n, { u, e }); open.push(n); } }
  }
  const pts = [{ x: tx, z: tz, name: Bq.e.name }]; let n = goal;
  while (n && n !== start) { const p = prev.get(n); if (!p) break; pts.unshift({ x: n.x, z: n.z, name: p.e.name }); n = p.u; }
  pts.unshift({ x: start.x, z: start.z, name: A.e.name }, { x: sx, z: sz, name: A.e.name });
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > .5);
}

/* ---------- the base image ---------- */
function drawBase(blocks) {
  const cv = document.createElement('canvas'); cv.width = cv.height = SIZE; const g = cv.getContext('2d');
  g.fillStyle = '#a9c98a'; g.fillRect(0, 0, SIZE, SIZE);
  // hills far out
  const grd = g.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * .3, SIZE / 2, SIZE / 2, SIZE * .7); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(120,90,50,.25)'); g.fillStyle = grd; g.fillRect(0, 0, SIZE, SIZE);
  DISTRICTS.forEach(d => { const [x, z] = toB(d.x - d.w / 2, d.z - d.d / 2); g.fillStyle = d.color; g.fillRect(x, z, d.w * PX, d.d * PX); });
  // city blocks
  blocks.forEach(b => { g.fillStyle = { market: '#e8c79a', park: '#9cc27e', homes: '#efe3c9', shops: '#e3d3ee', dome: '#d8e8d6' }[b.type] || '#ddd6c8'; g.beginPath(); b.poly.forEach(([x, z], i) => { const [px, pz] = toB(x, z); i ? g.lineTo(px, pz) : g.moveTo(px, pz); }); g.closePath(); g.fill(); });
  // roads
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const pass of [0, 1]) M.edges.forEach(e => { const [ax, az] = toB(e.a.x, e.a.z), [bx, bz] = toB(e.b.x, e.b.z); g.strokeStyle = pass ? '#7d8187' : '#f6f2ea'; g.lineWidth = (e.w + (pass ? 0 : 3)) * PX; g.beginPath(); g.moveTo(ax, az); g.lineTo(bx, bz); g.stroke(); });
  const [rx, rz] = toB(0, 0); g.fillStyle = '#9cc27e'; g.beginPath(); g.arc(rx, rz, 13 * PX, 0, 7); g.fill();
  // Aso Rock and the lake
  g.fillStyle = '#9a8a76'; [[372, -236, 34], [338, -246, 26], [392, -262, 30], [408, -226, 22]].forEach(([x, z, r]) => { const [px, pz] = toB(x, z); g.beginPath(); g.arc(px, pz, r * PX, 0, 7); g.fill(); });
  g.fillStyle = '#7fbad6'; { const [px, pz] = toB(196, 290); g.beginPath(); g.ellipse(px, pz, 14 * PX, 9 * PX, 0, 0, 7); g.fill(); }
  { const [px, pz] = toB(158, 340); g.fillStyle = '#e8e2d6'; g.beginPath(); g.ellipse(px, pz, 36 * PX, 27 * PX, 0, 0, 7); g.fill(); g.fillStyle = '#5fa64a'; g.beginPath(); g.ellipse(px, pz, 25 * PX, 18 * PX, 0, 0, 7); g.fill(); }
  // land plots
  PLOTS.forEach(p => { const [x, z] = toB(p.x - p.w / 2, p.z - p.d / 2); g.fillStyle = '#e8d9ac'; g.fillRect(x, z, p.w * PX, p.d * PX); g.strokeStyle = '#b08d3c'; g.lineWidth = 2; g.strokeRect(x, z, p.w * PX, p.d * PX); });
  // district names
  g.textAlign = 'center'; g.textBaseline = 'middle';
  DISTRICTS.forEach(d => { const [x, z] = toB(d.x, d.grid ? d.z - 116 : d.z - d.d / 2 + 12); g.font = '700 26px "Fredoka", system-ui, sans-serif'; g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,.85)'; g.strokeText(d.name.toUpperCase(), x, z); g.fillStyle = '#3b3328'; g.fillText(d.name.toUpperCase(), x, z); });
  // each road's name once, on its longest stretch
  g.font = '600 15px "Fredoka", system-ui, sans-serif';
  ROADS.forEach(r => {
    let best = null; for (let i = 0; i < r.pts.length - 1; i++) { const L = Math.hypot(r.pts[i + 1][0] - r.pts[i][0], r.pts[i + 1][1] - r.pts[i][1]); const mid = [(r.pts[i][0] + r.pts[i + 1][0]) / 2, (r.pts[i][1] + r.pts[i + 1][1]) / 2]; const score = L - (Math.hypot(...mid) < 40 ? 999 : 0); if (!best || score > best.s) best = { s: score, a: r.pts[i], b: r.pts[i + 1] }; }
    const [ax, az] = toB(...best.a), [bx, bz] = toB(...best.b); let ang = Math.atan2(bz - az, bx - ax); if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
    g.save(); g.translate((ax + bx) / 2, (az + bz) / 2); g.rotate(ang); g.fillStyle = '#ffffff'; g.fillText(r.name, 0, 1); g.restore();
  });
  return cv;
}

/* ---------- setup ---------- */
export function initMap(ctx) {
  Object.assign(M, ctx);
  buildGraph();
  M.base = drawBase(ctx.blocks);
  // GPS arrows on the ground and a beam at the destination
  const ag = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-.9, -.5), new THREE.Vector2(0, .7), new THREE.Vector2(.9, -.5), new THREE.Vector2(0, -.1)])); ag.rotateX(-Math.PI / 2);
  M.arrows = new THREE.InstancedMesh(ag, new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide }), 70); M.arrows.count = 0; M.arrows.frustumCulled = false; ctx.scene.add(M.arrows);
  M.beacon = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: .35, depthWrite: false, side: THREE.DoubleSide })); M.beacon.visible = false; ctx.scene.add(M.beacon);
  // UI
  $('map').addEventListener('click', () => openMap());
  $('bMap').onclick = () => openMap();
  $('mapClose').onclick = closeMap;
  $('gpsStop').onclick = () => clearRoute(true);
  $('mapSearch').oninput = renderList;
  $('mapZoomIn').onclick = () => zoom(1.4); $('mapZoomOut').onclick = () => zoom(1 / 1.4);
  $('mapMe').onclick = () => { M.view.x = G.player.pos.x; M.view.z = G.player.pos.z; drawFull(); };
  renderChips(); renderQuick(); hookCanvas();
}
/* "I want to…": one tap finds the nearest place for a common need */
const QUICK = [
  ['Buy land', o => o.cat === 'land'], ['Buy a house', o => /estate agency/i.test(o.name)], ['Building materials', o => /building materials/i.test(o.name)],
  ['Furniture', o => /furniture/i.test(o.name)], ['Clothes', o => /fashion|boutique|lace/i.test(o.name)], ['Groceries', o => /supermarket|mart|provisions/i.test(o.name)],
  ['Food', o => o.cat === 'food'], ['Find work', o => o.cat === 'work'], ['Fuel', o => /fuel/i.test(o.name)], ['Cars', o => /motors/i.test(o.name)], ['Hospital', o => o.cat === 'hospital'],
];
function renderQuick() {
  const row = $('mapQuick'); if (!row) return; row.innerHTML = '<b>I want to:</b>';
  QUICK.forEach(([label, test]) => { const b = document.createElement('button'); b.className = 'mchip quick'; b.textContent = label; b.onclick = () => { const p = G.player.pos, o = M.pois.filter(test).sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0]; if (o) { M.hidden.delete(o.cat); renderChips(); select(o, true); } }; row.appendChild(b); });
}
export const mapOpen = () => !$('mapView').hidden;
export function openMap() {
  if (G.region !== 'city') { G.toast('The map covers Abuja city. Travel back to use it.'); return; }
  const p = G.player.pos; if (!M.getInside?.()) { M.view.x = p.x; M.view.z = p.z; }
  $('mapView').hidden = false; fit(); renderList(); drawFull();
}
function closeMap() { $('mapView').hidden = true; M.sel = null; $('mapCard').hidden = true; }
function fit() { const cv = $('mapCanvas'), r = cv.getBoundingClientRect(); cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio; }
function zoom(k) { M.view.s = Math.max(.35, Math.min(6, M.view.s * k)); drawFull(); }
const allPois = () => [...M.pois, ...M.pins.map(p => ({ ...p, cat: 'pin', pin: true }))];

function renderChips() {
  const row = $('mapChips'); row.innerHTML = '';
  Object.entries(CATS).forEach(([k, c]) => { const b = document.createElement('button'); b.className = 'mchip' + (M.hidden.has(k) ? ' off' : ''); b.innerHTML = `<i style="background:${c.c}">${c.g}</i>${c.label}`; b.onclick = () => { M.hidden.has(k) ? M.hidden.delete(k) : M.hidden.add(k); renderChips(); renderList(); drawFull(); }; row.appendChild(b); });
}
function renderList() {
  const q = $('mapSearch').value.trim().toLowerCase(), list = $('mapList'), p = G.player.pos; list.innerHTML = '';
  const items = allPois().filter(o => q ? (o.name.toLowerCase().includes(q) || CATS[o.cat].label.toLowerCase().includes(q)) : !M.hidden.has(o.cat) && o.cat !== 'home')
    .map(o => ({ o, d: Math.hypot(o.x - p.x, o.z - p.z) })).sort((a, b) => a.d - b.d).slice(0, 40);
  if (!items.length) list.innerHTML = '<div class="mempty">No places match.</div>';
  items.forEach(({ o, d }) => { const b = document.createElement('button'); b.className = 'mrow'; b.innerHTML = `<i style="background:${CATS[o.cat].c}">${CATS[o.cat].g}</i><span><b></b><small>${CATS[o.cat].label} · ${fmtD(d)}</small></span>`; b.querySelector('b').textContent = o.name; b.onclick = () => select(o, true); list.appendChild(b); });
}
const fmtD = d => d < 1000 ? Math.round(d / 10) * 10 + ' m' : (d / 1000).toFixed(1) + ' km';
function select(o, center) {
  M.sel = o; if (center) { M.view.x = o.x; M.view.z = o.z; M.view.s = Math.max(M.view.s, 1.6); }
  const card = $('mapCard'), p = G.player.pos; card.hidden = false;
  $('mcName').textContent = o.name; $('mcSub').textContent = `${CATS[o.cat]?.label || 'Place'} · ${streetAt(o.x, o.z) || districtAt(o.x, o.z)?.name || 'Abuja'} · ${fmtD(Math.hypot(o.x - p.x, o.z - p.z))} away`;
  $('mcGo').onclick = () => { setDestination(o.x, o.z, o.name); closeMap(); };
  $('mcPin').hidden = !!o.pin || !!o.cat && o.cat !== 'drop';
  $('mcPin').onclick = () => { const name = `Pin ${M.pins.length + 1}`; M.pins.push({ name, x: Math.round(o.x), z: Math.round(o.z) }); savePins(); select({ ...M.pins[M.pins.length - 1], cat: 'pin', pin: true }); renderList(); drawFull(); };
  $('mcUnpin').hidden = !o.pin;
  $('mcUnpin').onclick = () => { M.pins = M.pins.filter(q => !(q.x === o.x && q.z === o.z)); savePins(); card.hidden = true; M.sel = null; renderList(); drawFull(); };
  drawFull();
}
function hookCanvas() {
  const cv = $('mapCanvas'); let drag = null, moved = 0; const pts = new Map();
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); drag = { x: e.clientX, y: e.clientY }; moved = 0; });
  cv.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; const prevP = pts.get(e.pointerId);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; const d0 = Math.hypot(a.x - b.x, a.y - b.y); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); const [c, d] = [...pts.values()]; const d1 = Math.hypot(c.x - d.x, c.y - d.y); if (d0 > 0) zoom(d1 / d0); moved += 10; return; }
    const dx = e.clientX - prevP.x, dy = e.clientY - prevP.y; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved += Math.abs(dx) + Math.abs(dy);
    M.view.x -= dx / M.view.s; M.view.z -= dy / M.view.s; drawFull();
  });
  const up = e => { pts.delete(e.pointerId); if (moved < 6 && drag) tapAt(e); drag = null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', e => pts.delete(e.pointerId));
  cv.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
  addEventListener('resize', () => { if (mapOpen()) { fit(); drawFull(); } });
}
function screenToWorld(cx, cy) { const cv = $('mapCanvas'), r = cv.getBoundingClientRect(); return [M.view.x + (cx - r.left - r.width / 2) / M.view.s, M.view.z + (cy - r.top - r.height / 2) / M.view.s]; }
function tapAt(e) {
  const [x, z] = screenToWorld(e.clientX, e.clientY);
  let best = null, bd = 14 / M.view.s; allPois().forEach(o => { if (M.hidden.has(o.cat) && !o.pin) return; const d = Math.hypot(o.x - x, o.z - z); if (d < bd) { bd = d; best = o; } });
  if (best) return select(best);
  if (Math.abs(x) > SPAN - 10 || Math.abs(z) > SPAN - 10) return;
  select({ name: streetAt(x, z) ? `Spot on ${streetAt(x, z)}` : 'Dropped pin', cat: 'drop', x, z });
}
function drawFull() {
  const cv = $('mapCanvas'), g = cv.getContext('2d'), W = cv.width, H = cv.height, k = devicePixelRatio, s = M.view.s * k;
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#93b878'; g.fillRect(0, 0, W, H);
  g.imageSmoothingEnabled = true;
  const wx = x => W / 2 + (x - M.view.x) * s, wz = z => H / 2 + (z - M.view.z) * s;
  g.drawImage(M.base, wx(-SPAN), wz(-SPAN), SPAN * 2 * s, SPAN * 2 * s);
  // plots: yellow = for sale, green = mine, grey = owned, with their codes when zoomed in
  (G.land ? [...G.land.plots.values()] : []).forEach(p => {
    const mineP = p.owner && p.owner === G.meId?.(), sale = !p.owner || p.ask, x = wx(p.x - p.w / 2), y = wz(p.z - p.d / 2);
    g.fillStyle = mineP ? 'rgba(29,138,74,.55)' : sale ? 'rgba(242,194,48,.6)' : 'rgba(110,110,110,.45)'; g.fillRect(x, y, p.w * s, p.d * s);
    if (M.view.s > 1.8) { g.fillStyle = '#2f2a22'; g.font = `700 ${10 * k}px "Fredoka", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`${p.name && !sale ? p.name : p.code}${mineP ? ' ★' : ''}`, wx(p.x), wz(p.z) - (sale && M.view.s > 3 ? 6 * k : 0)); if (sale && M.view.s > 3) g.fillText(naira(p.ask || p.price), wx(p.x), wz(p.z) + 7 * k); }
  });
  // government land: green outline with its name
  GOV_SITES.forEach(gs => { const w = gs.w * 2, d = gs.d * 2; g.strokeStyle = 'rgba(29,110,69,.9)'; g.lineWidth = 2; g.setLineDash([6, 4]); g.strokeRect(wx(gs.x - w / 2), wz(gs.z - d / 2), w * s, d * s); g.setLineDash([]);
    if (M.view.s > 1.8) { g.fillStyle = '#1d4d33'; g.font = `700 ${10 * k}px "Fredoka", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(G.siteName?.('gov:' + gs.id) || gs.name, wx(gs.x), wz(gs.z)); } });
  if (M.route) { g.strokeStyle = '#ffb800'; g.lineWidth = Math.max(3, 4 * s * .5); g.setLineDash([]); g.beginPath(); M.route.forEach((p, i) => i ? g.lineTo(wx(p.x), wz(p.z)) : g.moveTo(wx(p.x), wz(p.z))); g.stroke(); }
  const r = Math.max(7, Math.min(13, 5 * s)) * (k > 1 ? 1.2 : 1);
  allPois().forEach(o => {
    if ((M.hidden.has(o.cat) && !o.pin) || (o.cat === 'home' && M.view.s < 1.4 && !mine(o))) return;
    const x = wx(o.x), y = wz(o.z); if (x < -20 || y < -20 || x > W + 20 || y > H + 20) return;
    const c = mine(o) ? { c: '#1d8a4a', g: '★' } : CATS[o.cat];
    g.fillStyle = c.c; g.strokeStyle = M.sel === o || (M.sel && M.sel.x === o.x && M.sel.z === o.z) ? '#ffd23a' : '#fff'; g.lineWidth = 2.5 * (k > 1 ? 1.4 : 1);
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.font = `700 ${r * 1.1}px "Fredoka", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(c.g, x, y + 1);
    if (M.view.s > 2.2 || o.pin || mine(o) || o.cat === 'land') { g.font = `600 ${11 * k}px "Fredoka", system-ui, sans-serif`; g.lineWidth = 3 * k; g.strokeStyle = 'rgba(255,255,255,.9)'; g.strokeText(o.name, x, y + r + 9 * k); g.fillStyle = '#2f2a22'; g.fillText(o.name, x, y + r + 9 * k); }
  });
  if (M.sel && M.sel.cat === 'drop') { const x = wx(M.sel.x), y = wz(M.sel.z); g.fillStyle = '#e0245e'; g.beginPath(); g.arc(x, y - 14 * k, 8 * k, 0, 7); g.fill(); g.beginPath(); g.moveTo(x - 6 * k, y - 10 * k); g.lineTo(x, y); g.lineTo(x + 6 * k, y - 10 * k); g.fill(); }
  if (M.dest) { const x = wx(M.dest.x), y = wz(M.dest.z); g.strokeStyle = '#ffb800'; g.lineWidth = 3 * k; g.beginPath(); g.arc(x, y, r + 5 * k, 0, 7); g.stroke(); }
  arrow(g, wx(G.player.pos.x), wz(G.player.pos.z), G.player.yaw, 1.4 * k);
}
const mine = o => o.house !== undefined && G.myHouseIdx?.() === o.house;
function arrow(g, x, y, yaw, sc) { g.save(); g.translate(x, y); g.rotate(-yaw + Math.PI); g.scale(sc, sc); g.fillStyle = '#c9472f'; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5.5); g.lineTo(0, 2.8); g.lineTo(-5, 5.5); g.closePath(); g.fill(); g.stroke(); g.restore(); }

/* ---------- the small map in the corner, centred on the player ---------- */
export function drawMini(ctx, size, extras) {
  const p = G.player.pos, R = 95, s = size / (R * 2);
  ctx.clearRect(0, 0, size, size); ctx.fillStyle = '#93b878'; ctx.fillRect(0, 0, size, size);
  const [bx, bz] = toB(p.x - R, p.z - R); ctx.drawImage(M.base, bx, bz, R * 2 * PX, R * 2 * PX, 0, 0, size, size);
  const mx = x => size / 2 + (x - p.x) * s, mz = z => size / 2 + (z - p.z) * s;
  if (M.route) { ctx.strokeStyle = '#ffb800'; ctx.lineWidth = 3; ctx.beginPath(); M.route.forEach((q, i) => i ? ctx.lineTo(mx(q.x), mz(q.z)) : ctx.moveTo(mx(q.x), mz(q.z))); ctx.stroke(); }
  allPois().forEach(o => { if (o.cat === 'home' && !mine(o) && !o.pin) return; if (M.hidden.has(o.cat) && !o.pin) return; const x = mx(o.x), y = mz(o.z); if (x < 0 || y < 0 || x > size || y > size) return; ctx.fillStyle = mine(o) ? '#1d8a4a' : CATS[o.cat].c; ctx.beginPath(); ctx.arc(x, y, mine(o) || o.pin ? 4 : 2.6, 0, 7); ctx.fill(); });
  extras?.(mx, mz);
  if (M.dest) { const x = Math.max(6, Math.min(size - 6, mx(M.dest.x))), y = Math.max(6, Math.min(size - 6, mz(M.dest.z))); ctx.fillStyle = '#ffb800'; ctx.strokeStyle = '#7a4a00'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); ctx.stroke(); }
  arrow(ctx, size / 2, size / 2, G.player.yaw, 1);
  // where am I
  const label = [M.street, districtAt(p.x, p.z)?.name].filter(Boolean).join(' · ');
  if (label) { ctx.font = '600 10px "Fredoka", system-ui, sans-serif'; const w = Math.min(size - 6, ctx.measureText(label).width + 10); ctx.fillStyle = 'rgba(20,24,22,.62)'; ctx.fillRect((size - w) / 2, size - 17, w, 14); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, size / 2, size - 10, size - 10); }
}

/* ---------- GPS ---------- */
export function setDestination(x, z, name) {
  M.dest = { x, z, name }; M.reT = 0; replan(); $('gps').hidden = false;
  G.toast(`GPS on: ${name}`); updateBanner();
}
export function clearRoute(user) { M.dest = null; M.route = null; M.arrows.count = 0; M.beacon.visible = false; $('gps').hidden = true; if (user) G.toast('GPS off'); }
export const gpsActive = () => !!M.dest;
function replan() { const p = G.player.pos; if (!M.dest) return; M.route = plan(p.x, p.z, M.dest.x, M.dest.z); }
function updateBanner() {
  if (!M.dest || !M.route) return;
  const p = G.player.pos, R = M.route;
  let total = Math.hypot(R[1].x - p.x, R[1].z - p.z); for (let i = 1; i < R.length - 1; i++) total += Math.hypot(R[i + 1].x - R[i].x, R[i + 1].z - R[i].z);
  // next turn: first route corner with a real change of direction
  let acc = Math.hypot(R[1].x - p.x, R[1].z - p.z), msg = '', icon = '↑';
  for (let i = 1; i < R.length - 1; i++) {
    if (i === 1 && acc < 25) { acc += Math.hypot(R[2].x - R[1].x, R[2].z - R[1].z); continue; } // joining the road
    const a = Math.atan2(R[i].x - R[i - 1].x, R[i].z - R[i - 1].z), b = Math.atan2(R[i + 1].x - R[i].x, R[i + 1].z - R[i].z);
    let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > .5 && Math.hypot(R[i].x - R[i - 1].x, R[i].z - R[i - 1].z) > 1) { const left = d > 0; icon = left ? '↰' : '↱'; msg = `${acc < 12 ? 'Now' : 'In ' + fmtD(acc)} turn ${left ? 'left' : 'right'}${R[i + 1].name && R[i + 1].name !== R[i].name ? ' onto ' + R[i + 1].name : ''}`; break; }
    acc += Math.hypot(R[i + 1].x - R[i].x, R[i + 1].z - R[i].z);
  }
  if (!msg) msg = `Go straight ${fmtD(total)} to arrive`;
  $('gpsIcon').textContent = M.getInside?.() ? '⤴' : icon; $('gpsText').textContent = M.getInside?.() ? 'Go outside to continue' : msg;
  $('gpsDest').textContent = `${M.dest.name} · ${fmtD(total)}`;
}
export function updateMap(dt, t) {
  const p = G.player.pos, inside = M.getInside?.();
  if (G.region === 'city' && !inside) { M.streetT = (M.streetT || 0) - dt; if (M.streetT <= 0) { M.streetT = .5; M.street = streetAt(p.x, p.z); } }
  if (!M.dest) return;
  if (G.region !== 'city') { M.arrows.count = 0; M.beacon.visible = false; return; }
  M.reT -= dt; if (M.reT <= 0) { M.reT = 1.2; if (!inside) replan(); updateBanner(); }
  if (!inside && Math.hypot(p.x - M.dest.x, p.z - M.dest.z) < 7) { G.toast(`You have arrived: ${M.dest.name}`); G.Sound?.ding?.(); clearRoute(); M.onArrive?.(); return; }
  M.beacon.visible = !inside; M.beacon.position.set(M.dest.x, G.gY(M.dest.x, M.dest.z) + 30, M.dest.z);
  // arrows every 5 m along the route ahead of the player
  if (inside || !M.route) { M.arrows.count = 0; return; }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3(1.1, 1, 1.1);
  let n = 0, carry = (t * 4) % 5;
  for (let i = 0; i < M.route.length - 1 && n < 70; i++) {
    const a = M.route[i], b = M.route[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), yaw = Math.atan2(b.x - a.x, b.z - a.z);
    q.setFromAxisAngle(up, yaw);
    for (let s = carry; s < L && n < 70; s += 5) { const x = a.x + (b.x - a.x) * s / L, z = a.z + (b.z - a.z) * s / L; if (Math.hypot(x - p.x, z - p.z) > 140) continue; v.set(x, G.gY(x, z) + .12, z); m.compose(v, q, sc); M.arrows.setMatrixAt(n++, m); }
    carry = ((carry - L) % 5 + 5) % 5;
  }
  M.arrows.count = n; M.arrows.instanceMatrix.needsUpdate = true;
}
export const mapState = M;
export const routeBetween = (sx, sz, tx, tz) => plan(sx, sz, tx, tz);

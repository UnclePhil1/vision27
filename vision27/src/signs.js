import * as THREE from 'three';
import { G } from './game.js';
import { routeBetween, mapState } from './map.js';
import { canvasTex } from './util.js';

/* Wayfinding: green road signs at the big junctions that point (by the real GPS route)
   to land for sale, building materials, houses and shops; gateway boards and a Lands Registry
   kiosk at the new layouts; and tall floating markers you can see from far away. */
const DEST = [
  ['Land for sale', 'Lands Registry (buy land)'], ['Building materials', 'Unity Market · Building materials'],
  ['Houses for sale', 'Homefinders Estate Agency'], ['Furniture', 'Furniture Palace'],
];
// junction, and the direction you drive toward it from
const APPROACH = [[0, -128, 0, -1], [0, -200, 0, -1], [-128, -128, 0, -1], [128, -128, 0, -1], [0, 0, 0, -1], [0, 0, 0, 1], [0, 0, 1, 0], [0, 0, -1, 0],
  [-128, 0, -1, 0], [128, 0, 1, 0], [0, 128, 0, 1], [-128, 64, -1, 0], [128, 64, 1, 0], [-128, -64, -1, 0], [128, -64, 1, 0], [-64, 262, 0, 1], [64, 262, 0, 1]];
const poi = name => mapState.pois.find(o => o.name === name || o.name.startsWith(name));
const ARROW = { up: '↑', left: '←', right: '→', back: '↓' };
function turn(sx, sz, hx, hz, t) {
  const r = routeBetween(sx, sz, t.x, t.z); let acc = 0, q = r[r.length - 1];
  for (let i = 1; i < r.length; i++) { acc += Math.hypot(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z); if (acc > 42) { q = r[i]; break; } }
  const vx = q.x - sx, vz = q.z - sz, L = Math.hypot(vx, vz) || 1, dot = (vx * hx + vz * hz) / L, cross = hx * vz - hz * vx;
  const total = r.reduce((a, p, i) => (i ? a + Math.hypot(p.x - r[i - 1].x, p.z - r[i - 1].z) : 0), 0);
  return { a: dot > .75 ? 'up' : dot < -.6 ? 'back' : cross < 0 ? 'left' : 'right', d: total };
}
const km = d => (d < 1000 ? `${Math.round(d / 50) * 50} m` : `${(d / 1000).toFixed(1)} km`);
function board(lines, w, bg = '#1d6e3a') {
  const h = 70 + lines.length * 62;
  return canvasTex(560, h, g => {
    g.fillStyle = bg; g.fillRect(0, 0, 560, h); g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(8, 8, 544, h - 16);
    g.fillStyle = '#fff'; g.textBaseline = 'middle';
    lines.forEach((l, i) => { const y = 50 + i * 62; g.font = '700 46px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(l[0], 26, y); g.font = '600 34px "Fredoka", system-ui, sans-serif'; g.fillText(l[1], 86, y, l[2] ? 300 : 440); g.textAlign = 'right'; g.font = '500 28px system-ui, sans-serif'; g.fillText(l[2] || '', 534, y); });
  }, false);
}
function post(root, x, z, yaw, tex, w, hgt, y0 = 3) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshLambertMaterial({ map: tex })); m.position.set(x, y0 + hgt / 2, z); m.rotation.y = yaw; root.add(m);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshLambertMaterial({ color: 0x8e9196 })); back.position.copy(m.position); back.rotation.y = yaw + Math.PI; back.position.x -= Math.sin(yaw) * .03; back.position.z -= Math.cos(yaw) * .03; root.add(back);
  [-1, 1].forEach(s => { const p = new THREE.Mesh(new THREE.BoxGeometry(.16, y0 + hgt, .16), new THREE.MeshLambertMaterial({ color: 0x8e9196 })); p.position.set(x + Math.cos(yaw) * s * (w / 2 - .3), (y0 + hgt) / 2, z - Math.sin(yaw) * s * (w / 2 - .3)); root.add(p); G.addCircle({ x: p.position.x, z: p.position.z, r: .2 }); });
}
/* a tall marker: a pole and a big floating label that faces you */
function beacon(root, x, z, text, color) {
  const tex = canvasTex(512, 128, g => { g.fillStyle = color; g.beginPath(); g.roundRect(4, 4, 504, 120, 30); g.fill(); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 54px "Fredoka", system-ui, sans-serif'; g.fillText(text, 256, 66, 480); }, false);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false })); sp.scale.set(14, 3.5, 1); sp.position.set(x, 17, z); root.add(sp);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, 15, 6), new THREE.MeshLambertMaterial({ color })); pole.position.set(x, 7.5, z); root.add(pole);
  const ball = new THREE.Mesh(new THREE.OctahedronGeometry(.9), new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(.35) })); ball.position.set(x, 15.2, z); root.add(ball); beacons.push(ball);
}
const beacons = [];
export function initSigns() {
  const root = new THREE.Group(); G.scene.add(root);
  // the Lands Registry kiosk at the junction of the two layouts
  const kx = -18, kz = -186;
  [[4, 3, 3.2, 0xf1ece0], [4.3, .3, 3.5, 0x6d5a2e]].forEach(([w, h, d, c], i) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c })); m.position.set(kx, i ? 3.15 : 1.5, kz); m.castShadow = true; root.add(m); });
  G.addBox({ minX: kx - 2, maxX: kx + 2, minZ: kz - 1.6, maxZ: kz + 1.6, h: 3 });
  post(root, kx, kz - 1.8, Math.PI, board([['▦', 'LANDS REGISTRY', ''], ['', 'Buy a plot here', '']], 5, '#6d5a2e'), 4, 1.6, 3.4);
  mapState.pois.push({ name: 'Lands Registry (buy land)', cat: 'land', x: kx, z: kz - 3 }, { name: 'Unity Market · Building materials', cat: 'market', x: -96, z: 40 });
  G.actionProviders.push((p, out, inside) => { if (!inside) out(Math.hypot(p.x - kx, p.z - (kz - 3)) - 2, { label: 'Lands Registry: see plots for sale', run: () => G.openApp?.('land') }); });
  // gateway boards on the expressway, facing traffic from the city
  post(root, -12, -170, 0, board([['←', 'LUGBE LAYOUT', ''], ['', 'Homes & shop plots', 'from ₦2.5M'], ['', 'Buy · Design · Build', '']], 7, '#b5651d'), 7, 3.6, 2.5);
  post(root, 12, -170, 0, board([['→', 'KATAMPE EXT.', ''], ['', 'Office & workshop plots', 'from ₦8M'], ['', 'Buy · Design · Build', '']], 7, '#2e5fa8'), 7, 3.6, 2.5);
  // direction signs at the junctions
  APPROACH.forEach(([jx, jz, hx, hz]) => {
    const back = jx === 0 && jz === 0 ? 34 : 16, sx = jx - hx * back - hz * 9.5, sz = jz - hz * back + hx * 9.5;   // before the junction, on the right-hand side
    const lines = DEST.map(([label, name]) => { const t = poi(name); if (!t) return null; const r = turn(jx - hx * back, jz - hz * back, hx, hz, t); return r.d < 30 ? null : [ARROW[r.a], label, km(r.d)]; }).filter(Boolean);
    if (lines.length) post(root, sx, sz, Math.atan2(-hx, -hz), board(lines), 5.6, 0.6 + lines.length * .62);
  });
  // floating markers
  beacon(root, -126, -192, 'LAND FOR SALE', '#b5651d'); beacon(root, 126, -192, 'LAND FOR SALE', '#2e5fa8'); beacon(root, kx, kz, 'LANDS REGISTRY', '#6d5a2e');
  beacon(root, -96, 44, 'BUILDING MATERIALS', '#b5651d');
  const fp = poi('Furniture Palace'); if (fp) beacon(root, fp.x, fp.z, 'FURNITURE', '#8a6a4e');
  const ea = poi('Homefinders Estate Agency'); if (ea) beacon(root, ea.x, ea.z, 'HOUSES FOR SALE', '#1d8a4a');
}
export function updateSigns(dt) { beacons.forEach(b => (b.rotation.y += dt * 1.2)); }

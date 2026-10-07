import * as THREE from 'three';
import { Batch, blob, canvasTex, mulberry32, makeNoise } from './util.js';

/* Places outside Abuja, each built far from the city the first time someone goes there:
   a village, Abuja airport, Uyo (airport and town), a highway for road trips and the sky for flights. */

const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
const planeMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(1, 1, 1, 12), CONE = new THREE.ConeGeometry(1, 1, 10), SPH = new THREE.IcosahedronGeometry(1, 1);
const rng = mulberry32(4242), noise = makeNoise(rng), pick = a => a[(rng() * a.length) | 0];
function label(text, bg, fg, sub) {
  return new THREE.MeshLambertMaterial({ map: canvasTex(512, 128, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${sub ? 46 : 56}px "Fredoka", system-ui, sans-serif`; g.fillText(text, w / 2, sub ? 50 : h / 2, w - 30); if (sub) { g.font = '500 28px "Fredoka", system-ui, sans-serif'; g.fillText(sub, w / 2, 98, w - 30); } }, false) });
}

export const REG = {
  village: { name: 'Kauye Village', x: -4000, z: 0, hx: 190, hz: 190 },
  airport: { name: 'Abuja Airport', x: -6000, z: 0, hx: 700, hz: 260 },
  uyo: { name: 'Uyo', x: -8600, z: 0, hx: 700, hz: 340 },
  highway: { name: 'On the road', x: -11000, z: 0, hx: 1100, hz: 80 },
  sky: { name: 'In the air', x: -14500, z: 0, hx: 1500, hz: 400 },
};
export function regionAt(x) {
  for (const k in REG) { const r = REG[k]; if (Math.abs(x - r.x) <= r.hx + 50) return k; }
  return null;
}
const heights = {};
export function regionGround(x, z) {
  const k = regionAt(x); if (!k) return 0;
  const f = heights[k]; return f ? f(x - REG[k].x, z - REG[k].z) : 0;
}

/* plane: white body, green belly line and tail */
export function makePlane() {
  const g = new THREE.Group(), b = new Batch(), white = 0xf4f5f2, grn = 0x1d8a4a;
  b.add(CYL, white, 0, 0, 0, 0, 2, 30, 2, Math.PI / 2);
  b.add(SPH, white, 0, 0, 15, 0, 2, 2, 3.2);
  b.add(new THREE.ConeGeometry(2, 7, 14), white, 0, .4, -18.4, 0, 1, 1, 1, -Math.PI / 2);
  b.add(CYL, grn, 0, -.9, 0, 0, 2.02, 30, 1.2, Math.PI / 2);
  const wing = new THREE.Shape(); wing.moveTo(0, 0); wing.lineTo(15, -5); wing.lineTo(15, -7); wing.lineTo(0, -8); wing.lineTo(0, 0);
  const wg = new THREE.ExtrudeGeometry(wing, { depth: .4, bevelEnabled: false }); wg.rotateX(Math.PI / 2);
  [-1, 1].forEach(s => { const w = wg.clone(); if (s < 0) w.scale(-1, 1, 1); w.translate(0, -.6, 3); b.add(w, 0xe9eae6); b.add(CYL, 0xd8d8d4, s * 6, -1.5, .5, 0, .9, 3.6, .9, Math.PI / 2); b.add(CYL, 0x222222, s * 6, -1.5, 2.35, 0, .7, .1, .7, Math.PI / 2); });
  const tail = new THREE.Shape(); tail.moveTo(0, 0); tail.lineTo(5.5, -4); tail.lineTo(5.5, -5.5); tail.lineTo(0, -5); tail.lineTo(0, 0);
  const tg = new THREE.ExtrudeGeometry(tail, { depth: .25, bevelEnabled: false }); tg.rotateX(Math.PI / 2);
  [-1, 1].forEach(s => { const t = tg.clone(); if (s < 0) t.scale(-1, 1, 1); t.translate(0, .6, -15); b.add(t, white); });
  const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(-5, 0); fin.lineTo(-8, 6.5); fin.lineTo(-5.5, 6.5); fin.lineTo(0, 0);
  const fg = new THREE.ExtrudeGeometry(fin, { depth: .3, bevelEnabled: false }); fg.rotateY(-Math.PI / 2); fg.translate(-.15, 1.4, -11); b.add(fg, grn);
  for (let k = 0; k < 22; k++) [-1, 1].forEach(s => b.add(BOX, 0x1d2933, s * 1.96, .45, 11 - k * 1.1, 0, .05, .35, .3));
  b.add(BOX, 0x1d2933, 0, .7, 15.8, 0, 2.2, .5, .5, -.4);
  [[0, 12], [-2.6, -1], [2.6, -1]].forEach(([x, z]) => { b.add(CYL, 0x777777, x, -2.4, z, 0, .1, 1.4, .1); b.add(CYL, 0x111111, x, -3.1, z, 0, .45, .35, .45, 0, Math.PI / 2); });
  const m = b.build(planeMat); m.castShadow = true; g.add(m);
  const nm = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.4), label('NAIJA AIR', '#f4f5f2', '#1d8a4a'));
  [-1, 1].forEach(s => { const n = nm.clone(); n.position.set(s * 2.03, .9, 4); n.rotation.y = s * Math.PI / 2; g.add(n); });
  g.scale.setScalar(.9); return g;
}

function groundMesh(w, d, seg, hf, colorAt) {
  const geo = new THREE.PlaneGeometry(w, d, seg, seg); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, hf(p.getX(i), p.getZ(i)));
  const ng = geo.toNonIndexed(); geo.dispose(); ng.computeVertexNormals();
  const a = ng.attributes.position.array, cols = new Float32Array(a.length), c = new THREE.Color();
  for (let i = 0; i < a.length; i += 9) { const cx = (a[i] + a[i + 3] + a[i + 6]) / 3, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3; c.setHex(colorAt(cx, cz)); c.offsetHSL(0, 0, (rng() - .5) * .03); for (let v = 0; v < 9; v += 3) { cols[i + v] = c.r; cols[i + v + 1] = c.g; cols[i + v + 2] = c.b; } }
  ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const m = new THREE.Mesh(ng, new THREE.MeshLambertMaterial({ vertexColors: true })); m.receiveShadow = true; return m;
}
function tree(B, x, y, z, s = 1, kind = 'round') {
  if (kind === 'palm') {
    for (let i = 0; i < 6; i++) B.add(CYL, i % 2 ? 0x8f7a5c : 0x7d684d, x + i * .06 * s, y + (i + .5) * 1.1 * s, z, 0, .22 * s, 1.15 * s, .22 * s);
    for (let f = 0; f < 9; f++) { const a = f / 9 * 6.28; B.add(BOX, 0x4f8f3c, x + Math.cos(a) * 1.4 * s, y + 6.4 * s, z + Math.sin(a) * 1.4 * s, -a, 3 * s, .08, .5 * s, 0, -.35); }
    return;
  }
  if (kind === 'baobab') { B.add(CYL, 0x8a7a6a, x, y + 2.5 * s, z, 0, 1.3 * s, 5 * s, 1.3 * s); B.add(blob(3 * s, 0, 0, 0, 1, .25), 0x5f8a45, x, y + 6.5 * s, z, 0, 1.4, .6, 1.4); return; }
  B.add(CYL, 0x6e543b, x, y + 1.5 * s, z, 0, .25 * s, 3 * s, .25 * s); B.add(blob(2 * s, 0, 0, 0), pick([0x3f8a4f, 0x4e9a55, 0x5a8f45]), x, y + 4 * s, z);
}

const built = {};
export function ensureRegion(name, scene) {
  if (built[name]) return built[name];
  const R = REG[name], fn = { village: buildVillage, airport: buildAirport, uyo: buildUyo, highway: buildHighway, sky: buildSky }[name];
  const out = fn(R); scene.add(out.group); built[name] = out; return out;
}

/* ---------------- village ---------------- */
function buildVillage(R) {
  const g = new THREE.Group(), B = new Batch(), ox = R.x, oz = R.z, boxes = [], circles = [], seats = [], walkers = [], animals = [], doors = [];
  const hf = (x, z) => { const d = Math.hypot(x, z); return d < 60 ? 0 : (noise(x * .02, z * .02) * 2.2 + 1) * Math.min(1, (d - 60) / 60); };
  heights.village = hf;
  const roadAt = (x, z) => Math.abs(z) < 4 && x > 0 || Math.abs(Math.hypot(x, z) - 38) < 3;
  g.add(groundMesh(400, 400, 120, hf, (x, z) => roadAt(x, z) ? 0xc4895a : Math.hypot(x, z) < 50 ? pick([0xb5774a, 0xaf7045]) : noise(x * .04, z * .04) > .2 ? 0x8b9a4c : pick([0xb9a26a, 0xa99358, 0x93a050])));
  g.children[0].position.set(ox, 0, oz);
  const hut = (x, z, s = 1) => {
    const y = hf(x, z), X = ox + x, Z = oz + z;
    B.add(CYL, 0xa0623a, X, y + 1.1 * s, Z, 0, 2.2 * s, 2.2 * s, 2.2 * s); B.add(CYL, 0x7d4a2a, X, y + .25, Z, 0, 2.25 * s, .5, 2.25 * s);
    B.add(CONE, 0xc9a35a, X, y + 3.3 * s, Z, rng() * 3, 3 * s, 2.6 * s, 3 * s); B.add(CONE, 0xb38f49, X, y + 2.4 * s, Z, 0, 3.05 * s, .4, 3.05 * s);
    const a = Math.atan2(-x, -z); B.add(BOX, 0x3a2a1e, X + Math.sin(a) * 2.18 * s, y + .9, Z + Math.cos(a) * 2.18 * s, a, 1, 1.8, .1);
    circles.push({ x: X, z: Z, r: 2.3 * s });
  };
  const house = (x, z, ry) => {
    const y = hf(x, z), X = ox + x, Z = oz + z;
    B.add(BOX, 0xb06a3f, X, y + 1.4, Z, ry, 6, 2.8, 4.5);
    B.add(BOX, 0x9ea3a6, X - Math.cos(ry) * 0, y + 3.15, Z, ry, 6.6, .12, 5.2, .18);
    B.add(BOX, 0x3a2a1e, X + Math.sin(ry) * 2.27, y + 1, Z + Math.cos(ry) * 2.27, ry, 1, 2, .08);
    [-1.8, 1.8].forEach(o => B.add(BOX, 0x2a2a2a, X + Math.sin(ry) * 2.27 + Math.cos(ry) * o, y + 1.6, Z + Math.cos(ry) * 2.27 - Math.sin(ry) * o, ry, .8, .7, .06));
    const c = Math.abs(Math.cos(ry)) > .5; boxes.push({ minX: X - (c ? 3 : 2.25), maxX: X + (c ? 3 : 2.25), minZ: Z - (c ? 2.25 : 3), maxZ: Z + (c ? 2.25 : 3) });
  };
  // compounds of round huts, mud houses with zinc roofs, granaries
  [[-25, -30], [24, -32], [-34, 18], [10, 30], [40, 10]].forEach(([cx, cz], i) => {
    for (let k = 0; k < 3; k++) { const a = k * 2.1 + i; hut(cx + Math.cos(a) * 7, cz + Math.sin(a) * 7, .9 + rng() * .2); }
    const y = hf(cx, cz); B.add(CYL, 0x8a5a36, ox + cx, y + 1.3, oz + cz, 0, 1, 1.6, 1); B.add(CONE, 0xc9a35a, ox + cx, y + 2.6, oz + cz, 0, 1.4, 1.2, 1.4); circles.push({ x: ox + cx, z: oz + cz, r: 1.1 });
    for (let a = 0; a < 6.28; a += .25) if (Math.abs(a - 1.6) > .5) B.add(BOX, 0x9a5a34, ox + cx + Math.cos(a) * 12, y + .6, oz + cz + Math.sin(a) * 12, -a, .5, 1.2, 3.2);
  });
  [[60, -22, 0], [62, 24, Math.PI], [-60, -10, Math.PI / 2], [-12, -62, 0], [20, 62, Math.PI]].forEach(([x, z, r]) => house(x, z, r));
  // village square: big baobab, benches, well
  tree(B, ox, 0, oz, 1.1, 'baobab'); circles.push({ x: ox, z: oz, r: 1.6 });
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + .4, x = ox + Math.cos(a) * 5, z = oz + Math.sin(a) * 5; B.add(BOX, 0x8a6a4e, x, .45, z, -a + Math.PI / 2, 2.2, .1, .5); [-.6, .6].forEach(o => seats.push({ x: x - Math.sin(a) * o, z: z + Math.cos(a) * o, y: 0, yaw: a + Math.PI })); }
  B.add(CYL, 0x8a8a84, ox + 14, .5, oz - 8, 0, 1.2, 1, 1.2); B.add(BOX, 0x6e543b, ox + 14, 2, oz - 8, 0, 2.4, .12, .12); [-1.1, 1.1].forEach(o => B.add(BOX, 0x6e543b, ox + 14 + o, 1.2, oz - 8, 0, .12, 1.8, .12)); circles.push({ x: ox + 14, z: oz - 8, r: 1.3 });
  // farms: yam mounds and maize
  for (let r = 0; r < 10; r++) for (let c = 0; c < 14; c++) { const x = 80 + c * 3, z = -70 + r * 3, y = hf(x, z); B.add(CONE, 0x8a5a36, ox + x, y + .3, oz + z, 0, .7, .7, .7); if (c % 3 === 0) B.add(CYL, 0x4f8f3c, ox + x, y + .9, oz + z, 0, .04, 1.4, .04); }
  for (let r = 0; r < 8; r++) for (let c = 0; c < 18; c++) { const x = -110 + c * 2.4, z = 40 + r * 2.6, y = hf(x, z); B.add(CYL, 0x6f9a3a, ox + x, y + 1, oz + z, 0, .05, 2, .05); B.add(BOX, 0x7aa845, ox + x, y + 1.5, oz + z, c, .9, .04, .18, 0, .5); }
  // trees around
  for (let i = 0; i < 140; i++) { const a = rng() * 6.28, d = 70 + rng() * 120, x = Math.cos(a) * d, z = Math.sin(a) * d; if (x > 70 && z < -40 && z > -80) continue; tree(B, ox + x, hf(x, z), oz + z, .8 + rng() * .6, rng() < .15 ? 'baobab' : rng() < .3 ? 'palm' : 'round'); }
  // a few stalls in the square
  for (let k = 0; k < 4; k++) { const x = -14 + k * 5, z = 14; B.add(BOX, 0x6e543b, ox + x, .5, oz + z, 0, 3, 1, 1.2); B.add(BOX, pick([0xa9aeb2, 0x9a7a5a]), ox + x, 2.4, oz + z, 0, 3.4, .1, 2); for (let q = 0; q < 6; q++) B.add(SPH, pick([0xd8352a, 0xf09a24, 0x7a5536, 0x9bb03a]), ox + x - 1 + q * .4, 1.1, oz + z, 0, .14, .12, .14); boxes.push({ minX: ox + x - 1.5, maxX: ox + x + 1.5, minZ: oz + z - .6, maxZ: oz + z + .6 }); }
  // the bus stop at the village entrance
  const sx = ox + 150, sz = oz - 8;
  B.add(BOX, 0x1d8a4a, sx, 2.6, sz, 0, 5, .12, 2); [[-2.2, -.8], [2.2, -.8]].forEach(([a, b]) => B.add(BOX, 0x8e9196, sx + a, 1.3, sz + b, 0, .1, 2.6, .1)); B.add(BOX, 0x8a6a4e, sx, .5, sz - .5, 0, 4, .1, .5);
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), label('KAUYE VILLAGE', '#1d8a4a', '#ffffff', 'Welcome. Drive slowly.')); sg.position.set(ox + 168, 4, oz + 6); sg.rotation.y = Math.PI / 2; g.add(sg);
  [-4.5, 4.5].forEach(o => B.add(BOX, 0x7d8085, ox + 168, 2, oz + 6 + o, 0, .2, 4, .2));
  // chickens and goats
  for (let i = 0; i < 14; i++) { const a = new THREE.Group(), goat = i < 4, col = goat ? pick([0xf1ece0, 0x6b4a33, 0x2b2b2b]) : pick([0xf4f4f4, 0x9a5a34, 0xd9a060]); const bb = new Batch(); if (goat) { bb.add(BOX, col, 0, .55, 0, 0, .45, .45, .9); bb.add(BOX, col, 0, .8, .55, 0, .28, .3, .35); [[-.15, -.3], [.15, -.3], [-.15, .3], [.15, .3]].forEach(([x, z]) => bb.add(BOX, col, x, .2, z, 0, .08, .4, .08)); } else { bb.add(SPH, col, 0, .25, 0, 0, .18, .16, .22); bb.add(SPH, col, 0, .42, .15, 0, .09, .09, .09); bb.add(BOX, 0xc8202a, 0, .52, .16, 0, .03, .06, .07); bb.add(BOX, 0xf2a43a, 0, .4, .25, 0, .03, .03, .06); } a.add(bb.build(mat)); const r = 10 + rng() * 40, t = rng() * 6.28; a.position.set(ox + Math.cos(t) * r, 0, oz + Math.sin(t) * r); g.add(a); animals.push({ m: a, goat, home: a.position.clone(), t: rng() * 10, tgt: a.position.clone(), wait: 0 }); }
  g.add(B.build(mat));
  return { group: g, boxes, circles, seats, animals, doors,
    spawn: { x: sx, z: sz + 2, yaw: -Math.PI / 2 }, car: { x: ox + 140, z: oz + 2, yaw: -Math.PI / 2 }, stop: { x: sx, z: sz + 1.2 }, exit: { x: ox + 175, z: oz },
    villagers: [{ x: ox + 3, z: oz + 5 }, { x: ox - 5, z: oz + 3 }, { x: ox + 20, z: oz - 30 }, { x: ox - 30, z: oz + 20 }, { x: ox + 12, z: oz + 30 }, { x: ox - 10, z: oz + 16 }] };
}

/* ---------------- airports ---------------- */
function airportBase(R, opts) {
  const g = new THREE.Group(), B = new Batch(), ox = R.x, oz = R.z, boxes = [], circles = [], seats = [], doors = [];
  heights[opts.key] = () => 0;
  g.add(groundMesh(1500, 900, 100, () => -.02, (x, z) => noise(x * .01, z * .01) > .25 ? 0xa7a05c : pick([0x8fa858, 0x98b060, 0xa6ac62])));
  g.children[0].position.set(ox, 0, oz);
  const flat = (w, d, c, x, z, y = .02) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: c, polygonOffset: true, polygonOffsetFactor: -1 - y * 10 })); m.position.set(ox + x, y, oz + z); m.receiveShadow = true; g.add(m); };
  const rz = -90, rx0 = -520, rx1 = 520;
  flat(1080, 46, 0x55585c, 0, rz); for (let x = rx0 + 60; x < rx1 - 60; x += 30) B.add(BOX, 0xf2f2ee, ox + x, .05, oz + rz, 0, 14, .01, .5);
  [rx0 + 12, rx1 - 12].forEach(x => { for (let k = -8; k <= 8; k++) if (k) B.add(BOX, 0xf2f2ee, ox + x, .05, oz + rz + k * 2.3, 0, 18, .01, 1.1); });
  for (let x = rx0; x <= rx1; x += 40) [-24, 24].forEach(o => B.add(BOX, 0xf2c230, ox + x, .2, oz + rz + o, 0, .3, .4, .3));
  flat(26, 100, 0x5e6165, 380, -30); flat(300, 90, 0xb9b6ae, 150, 40); flat(220, 40, 0x5a5d62, 150, 150);
  // terminal
  const tx = 150, tz = 108;
  B.add(BOX, 0xe9edf0, ox + tx, 6, oz + tz, 0, 130, 12, 26); B.add(BOX, 0x3f6f86, ox + tx, 6, oz + tz - 13.05, 0, 126, 9, .1); B.add(BOX, 0x3f6f86, ox + tx, 6, oz + tz + 13.05, 0, 126, 9, .1);
  B.add(new THREE.CylinderGeometry(1, 1, 1, 24, 1, false, 0, Math.PI), 0xf4f5f2, ox + tx, 12, oz + tz, 0, 15, 134, 15, 0, Math.PI / 2);
  boxes.push({ minX: ox + tx - 65, maxX: ox + tx + 65, minZ: oz + tz - 13, maxZ: oz + tz + 13 });
  const sgn = new THREE.Mesh(new THREE.PlaneGeometry(26, 3.2), label(opts.title, '#16213a', '#ffffff')); sgn.position.set(ox + tx, 14.5, oz + tz + 13.4); g.add(sgn);
  // control tower
  B.add(CYL, 0xe9edf0, ox + 300, 15, oz + 120, 0, 3, 30, 3); B.add(CYL, 0x2f4656, ox + 300, 32, oz + 120, 0, 5.5, 4, 5.5); B.add(CYL, 0xe9edf0, ox + 300, 34.3, oz + 120, 0, 6, .6, 6); circles.push({ x: ox + 300, z: oz + 120, r: 3.2 });
  // car park lines and the shuttle stop
  for (let k = 0; k < 20; k++) B.add(BOX, 0xf2f2ee, ox + 50 + k * 10, .04, oz + 150, 0, .15, .01, 10);
  B.add(BOX, 0x2f5fa0, ox + 40, 2.6, oz + 128, 0, 5, .12, 2); [[-2.2, .8], [2.2, .8]].forEach(([a, b]) => B.add(BOX, 0x8e9196, ox + 40 + a, 1.3, oz + 128 + b, 0, .1, 2.6, .1));
  const st = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), label('CITY SHUTTLE', '#2f5fa0', '#ffffff')); st.position.set(ox + 40, 3.3, oz + 127.2); st.rotation.y = Math.PI; g.add(st);
  doors.push({ kind: 'terminal', name: opts.title, pos: new THREE.Vector3(ox + tx, 0, oz + tz + 14.5), yaw: 0, airport: opts.key });
  // trees and palms along the landside road
  for (let k = 0; k < 24; k++) tree(B, ox + 20 + k * 12, 0, oz + 172, .9, opts.palms ? 'palm' : 'round');
  const parked = makePlane(); parked.position.set(ox + 230, 3.2, oz + 40); parked.rotation.y = Math.PI / 2 + .3; g.add(parked);
  g.add(B.build(mat));
  return { group: g, boxes: boxes.concat([{ minX: ox + 215, maxX: ox + 245, minZ: oz + 25, maxZ: oz + 55, h: 6 }]), circles, seats, doors,
    runway: { x0: ox + rx0, x1: ox + rx1, z: oz + rz, y: 3.2 }, gate: { x: ox + 120, z: oz + 52, yaw: -Math.PI / 2 }, taxi: [[ox + 120, oz + 52], [ox + 380, oz + 52], [ox + 380, oz + rz], [ox + rx1 - 20, oz + rz]],
    spawn: { x: ox + 40, z: oz + 131, yaw: 0 }, arrive: { x: ox + tx, z: oz + tz + 17, yaw: 0 }, car: { x: ox + 70, z: oz + 145, yaw: Math.PI / 2 }, stop: { x: ox + 40, z: oz + 130 }, exit: { x: ox + 690, z: oz + 150 } };
}
function buildAirport(R) { return airportBase(R, { key: 'airport', title: 'ABUJA AIRPORT' }); }
function buildUyo(R) {
  const a = airportBase(R, { key: 'uyo', title: 'UYO AIRPORT', palms: true });
  const B = new Batch(), ox = R.x, oz = R.z;
  // the town: a palm-lined road, a roundabout and houses
  const flat = new THREE.Mesh(new THREE.PlaneGeometry(14, 260).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5a5d62, polygonOffset: true, polygonOffsetFactor: -1 })); flat.position.set(ox - 120, .02, oz + 200); a.group.add(flat);
  for (let z = 90; z < 320; z += 14) { tree(B, ox - 131, 0, oz + z, 1, 'palm'); tree(B, ox - 109, 0, oz + z, 1, 'palm'); }
  B.add(CYL, 0xd9d4c7, ox - 120, .3, oz + 250, 0, 9, .6, 9); B.add(CYL, 0x6f9e4f, ox - 120, .62, oz + 250, 0, 8.4, .05, 8.4); B.add(CYL, 0xe8b23a, ox - 120, 4, oz + 250, 0, .8, 7, .8); B.add(SPH, 0x1d8a4a, ox - 120, 8, oz + 250, 0, 1.4, 1.4, 1.4);
  a.circles.push({ x: ox - 120, z: oz + 250, r: 9 });
  for (let k = 0; k < 14; k++) { const s = k % 2 ? 1 : -1, z = oz + 110 + (k >> 1) * 28, x = ox - 120 + s * 22, h = 4 + rng() * 6, c = pick([0xf2e3c6, 0xe4ead2, 0xf3d9c0, 0xdcebd8, 0xf6f0e4]); B.add(BOX, c, x, h / 2, z, 0, 12, h, 12); B.add(BOX, pick([0x8b3a2a, 0x3f5f7f, 0x6b4a3a]), x, h + .2, z, 0, 12.6, .4, 12.6); a.boxes.push({ minX: x - 6, maxX: x + 6, minZ: z - 6, maxZ: z + 6 }); }
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), label('WELCOME TO UYO', '#1d8a4a', '#ffffff', 'Akwa Ibom: Land of Promise')); sg.position.set(ox - 120, 6, oz + 160); sg.rotation.y = Math.PI; a.group.add(sg);
  [-6.5, 6.5].forEach(o => B.add(BOX, 0x7d8085, ox - 120 + o, 3, oz + 160, 0, .25, 6, .25));
  a.group.add(B.build(mat));
  return a;
}

/* ---------------- highway (for road trips) ---------------- */
function buildHighway(R) {
  const g = new THREE.Group(), B = new Batch(), ox = R.x, oz = R.z;
  heights.highway = (x, z) => Math.abs(z) < 14 ? 0 : (noise(x * .01, z * .02) + 1) * Math.min(1, (Math.abs(z) - 14) / 30) * 3;
  g.add(groundMesh(2300, 160, 160, heights.highway, (x, z) => Math.abs(z) < 7 ? 0x55585c : Math.abs(z) < 9 ? 0xb9a26a : noise(x * .01, z * .03) > .1 ? 0x9aa860 : pick([0xb9a26a, 0x8fa858, 0xa6ac62])));
  g.children[0].position.set(ox, 0, oz);
  for (let x = -1100; x < 1100; x += 9) B.add(BOX, 0xf2f2ee, ox + x, .05, oz, 0, 4, .01, .18);
  for (let x = -1100; x < 1100; x += 18) { const s = rng() < .5 ? -1 : 1, d = 20 + rng() * 50, k = rng(); tree(B, ox + x + rng() * 10, heights.highway(x, s * d), oz + s * d, .8 + rng() * .6, k < .2 ? 'baobab' : k < .45 ? 'palm' : 'round'); }
  for (let x = -1000; x < 1000; x += 160) { const s = rng() < .5 ? -1 : 1; for (let k = 0; k < 4; k++) { const hx = ox + x + k * 9, hz = oz + s * (24 + rng() * 10); B.add(CYL, 0xa0623a, hx, 1.1, hz, 0, 2.2, 2.2, 2.2); B.add(CONE, 0xc9a35a, hx, 3.3, hz, 0, 3, 2.6, 3); } }
  for (let x = -900; x < 900; x += 300) { const s = rng() < .5 ? -1 : 1; [-3, 3].forEach(o => B.add(BOX, 0x7d8085, ox + x + o, 4, oz + s * 16, 0, .3, 8, .3)); const bb = new THREE.Mesh(new THREE.PlaneGeometry(10, 3), label(pick(['DRIVE SAFELY', 'JOLLOF HUB', 'NAIJA AIR', 'UNITY FUEL']), pick(['#1d8a4a', '#c9472f', '#16213a']), '#ffffff', 'Next exit 5 km')); bb.position.set(ox + x, 8.5, oz + s * 16); bb.rotation.y = s > 0 ? Math.PI : 0; g.add(bb); }
  g.add(B.build(mat));
  return { group: g, boxes: [], circles: [], seats: [], doors: [], start: { x: ox + 1050, z: oz + 3.2 }, end: { x: ox - 1050, z: oz + 3.2 } };
}

/* ---------------- the sky (for flights) ---------------- */
function buildSky(R) {
  const g = new THREE.Group(), ox = R.x, oz = R.z, B = new Batch();
  heights.sky = () => -500;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 1600).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x7a9a5a })); ground.position.set(ox, 0, oz); g.add(ground);
  const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: .45, flatShading: true });
  for (let i = 0; i < 160; i++) { const x = ox + (rng() - .5) * 3200, z = oz + (rng() - .5) * 900; B.add(blob(14 + rng() * 22, 0, 0, 0, 1, .2), 0xffffff, x, 180 + rng() * 25, z, rng() * 3, 1.6, .45, 1.2); }
  const clouds = B.build(cm, { cast: false, receive: false }); clouds.material = cm; g.add(clouds);
  return { group: g, boxes: [], circles: [], seats: [], doors: [], start: { x: ox + 1400, z: oz }, end: { x: ox - 1400, z: oz }, alt: 260 };
}

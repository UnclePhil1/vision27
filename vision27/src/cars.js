import * as THREE from 'three';
import { Batch, rand, pick, damp, angleLerp, canvasTex } from './util.js';
import { S, N, RB_LANE } from './consts.js';

/* ================= car models =================
   Bodies are extruded side profiles with rounded (bevelled) edges, real wheel arches,
   separate glass with pillars, lights, grille, mirrors, bumpers and Nigerian plates.
   Each car is a handful of meshes: painted body, glass, trim, and four spinning wheels. */

export const CAR_COLORS = [0xe9e6df, 0x1f2328, 0x9aa1a8, 0xa31d27, 0x2c5ea8, 0x1f6e4f, 0xd6d0c2, 0x5d6168, 0x6b1a24, 0xc9b28a];
const paintCache = new Map();
const paint = hex => { if (!paintCache.has(hex)) paintCache.set(hex, new THREE.MeshPhongMaterial({ color: hex, shininess: 70, specular: 0x555555 })); return paintCache.get(hex); };
const glassMat = new THREE.MeshPhongMaterial({ color: 0x1d2933, shininess: 120, specular: 0x8899aa, side: THREE.DoubleSide });
const trimMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const lightMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x222222 });

const plates = [];
function plateTex() {
  if (plates.length < 12) {
    const L = 'ABCDEFGHJKLMNPRSTUVWXYZ', r = n => Array.from({ length: n }, () => L[(rand() * L.length) | 0]).join('');
    const num = `${pick(['ABJ', 'KUJ', 'GWA', 'BWR', 'ABC'])} ${100 + ((rand() * 899) | 0)} ${r(2)}`;
    plates.push(canvasTex(256, 96, g => {
      g.fillStyle = '#f4f6f2'; g.fillRect(0, 0, 256, 96); g.strokeStyle = '#1d6e3a'; g.lineWidth = 5; g.strokeRect(3, 3, 250, 90);
      g.fillStyle = '#1d6e3a'; g.textAlign = 'center'; g.font = '600 14px system-ui, sans-serif'; g.fillText('FEDERAL REPUBLIC OF NIGERIA', 128, 22);
      g.fillStyle = '#16213a'; g.font = '800 40px system-ui, sans-serif'; g.fillText(num, 128, 64);
      g.fillStyle = '#b3202a'; g.font = '600 13px system-ui, sans-serif'; g.fillText('FCT - CENTRE OF UNITY', 128, 86);
    }, false));
  }
  return plates[(rand() * plates.length) | 0];
}
const plateMats = new Map();
const plateMat = () => { const t = plateTex(); if (!plateMats.has(t)) plateMats.set(t, new THREE.MeshLambertMaterial({ map: t })); return plateMats.get(t); };
const signTexCache = new Map();
function textMat(text, bg, fg) {
  const k = text + bg + fg; if (!signTexCache.has(k)) signTexCache.set(k, new THREE.MeshLambertMaterial({ map: canvasTex(256, 64, g => { g.fillStyle = bg; g.fillRect(0, 0, 256, 64); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 38px system-ui, sans-serif'; g.fillText(text, 128, 34, 240); }, false) }));
  return signTexCache.get(k);
}

/* profile language: M x y, L x y, Q cx cy x y, A cx r (wheel arch over the bottom edge, drawn rear→front) */
function shapeFrom(cmds) {
  const s = new THREE.Shape();
  for (const c of cmds) {
    if (c[0] === 'M') s.moveTo(c[1], c[2]);
    else if (c[0] === 'L') s.lineTo(c[1], c[2]);
    else if (c[0] === 'Q') s.quadraticCurveTo(c[1], c[2], c[3], c[4]);
    else if (c[0] === 'A') { const [, cx, r, y] = c; s.lineTo(cx - r, y); s.absarc(cx, y, r, Math.PI, 0, true); }
  }
  return s;
}
// profile in (x = forward, y = up); returned geometry has +z forward, centred across the width
function extrude(cmds, width, bevel = .07) {
  const g = new THREE.ExtrudeGeometry(shapeFrom(cmds), { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * .8, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -(width - bevel * 2) / 2); g.rotateY(-Math.PI / 2); return g;
}
function flatPoly(pts, side, width) { // a side window panel at +x (side=1) or -x
  const sh = new THREE.Shape(); pts.forEach(([x, y], i) => i ? sh.lineTo(x, y) : sh.moveTo(x, y));
  const g = new THREE.ShapeGeometry(sh), p = g.attributes.position, X = side * (width / 2 + .012);
  for (let i = 0; i < p.count; i++) { const sx = p.getX(i), sy = p.getY(i); p.setXYZ(i, X, sy, sx); }
  g.computeVertexNormals(); return g;
}
function slopeGlass(a, b, halfW) { // windscreen between two profile points
  const g = new THREE.BufferGeometry();
  const v = [halfW, a[1], a[0], -halfW, a[1], a[0], -halfW, b[1], b[0], halfW, a[1], a[0], -halfW, b[1], b[0], halfW, b[1], b[0]];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals(); return g;
}
const BOXG = new THREE.BoxGeometry(1, 1, 1);
function wheel(r, w) {
  const b = new Batch();
  b.add(new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2), 0x151515);
  b.add(new THREE.CylinderGeometry(r * .62, r * .62, w + .02, 14).rotateZ(Math.PI / 2), 0xb9bec4);
  for (let k = 0; k < 5; k++) b.add(BOXG, 0x8d9399, 0, 0, 0, 0, w + .04, r * 1.1, .06, k * Math.PI / 5 * 2);
  b.add(new THREE.CylinderGeometry(r * .18, r * .18, w + .06, 8).rotateZ(Math.PI / 2), 0x555a60);
  return b.build(trimMat, { cast: false });
}

const DEFS = {
  sedan: { len: 4.5, w: 1.8, wr: .34, axF: 1.38, axR: -1.38,
    body: [['M', -2.25, .34], ['A', -1.38, .43, .34], ['A', 1.38, .43, .34], ['L', 2.18, .34], ['Q', 2.32, .36, 2.3, .58], ['L', 2.24, .8], ['Q', 2.12, .9, 1.7, .93], ['L', .86, .99], ['L', .26, 1.4], ['Q', -.32, 1.48, -.92, 1.42], ['L', -1.58, 1.01], ['L', -2.12, .96], ['Q', -2.3, .92, -2.3, .62], ['L', -2.25, .34]],
    win: [[[.8, 1.02], [.3, 1.35], [-.12, 1.38], [-.12, 1.02]], [[-.26, 1.02], [-.26, 1.38], [-.86, 1.37], [-1.44, 1.03]]],
    front: [[.86, .99], [.26, 1.4]], rear: [[-.92, 1.42], [-1.58, 1.01]], lightY: .74, nose: 2.27, tail: -2.29, mirror: [.7, 1.02] },
  suv: { len: 4.7, w: 1.92, wr: .4, axF: 1.45, axR: -1.45,
    body: [['M', -2.33, .42], ['A', -1.45, .5, .42], ['A', 1.45, .5, .42], ['L', 2.3, .42], ['Q', 2.42, .45, 2.4, .72], ['L', 2.34, 1.05], ['Q', 2.2, 1.14, 1.6, 1.16], ['L', 1.05, 1.2], ['L', .55, 1.78], ['L', -2.15, 1.8], ['Q', -2.33, 1.78, -2.36, 1.55], ['L', -2.38, .72], ['L', -2.33, .42]],
    win: [[[1.0, 1.23], [.58, 1.73], [-.05, 1.74], [-.05, 1.23]], [[-.2, 1.23], [-.2, 1.74], [-1.1, 1.74], [-1.1, 1.23]], [[-1.25, 1.23], [-1.25, 1.74], [-2.1, 1.74], [-2.18, 1.3]]],
    front: [[1.05, 1.2], [.55, 1.78]], rear: null, lightY: .95, nose: 2.39, tail: -2.37, mirror: [.95, 1.23] },
  pickup: { len: 5.1, w: 1.88, wr: .4, axF: 1.6, axR: -1.55,
    body: [['M', -2.55, .44], ['A', -1.55, .5, .44], ['A', 1.6, .5, .44], ['L', 2.45, .44], ['Q', 2.57, .47, 2.55, .74], ['L', 2.48, 1.05], ['Q', 2.3, 1.13, 1.7, 1.15], ['L', 1.15, 1.2], ['L', .7, 1.75], ['L', -.55, 1.76], ['L', -.6, 1.12], ['L', -2.55, 1.1], ['L', -2.6, .72], ['L', -2.55, .44]],
    win: [[[1.1, 1.23], [.72, 1.7], [.1, 1.71], [.1, 1.23]], [[-.04, 1.23], [-.04, 1.71], [-.5, 1.71], [-.52, 1.23]]],
    front: [[1.15, 1.2], [.7, 1.75]], rear: null, lightY: .95, nose: 2.55, tail: -2.6, mirror: [1.05, 1.23] },
  van: { len: 5.0, w: 1.9, wr: .36, axF: 1.55, axR: -1.5,
    body: [['M', -2.5, .4], ['A', -1.5, .46, .4], ['A', 1.55, .46, .4], ['L', 2.42, .4], ['Q', 2.55, .44, 2.52, .75], ['L', 2.4, 1.05], ['L', 1.75, 1.2], ['L', 1.35, 2.05], ['Q', 1.2, 2.15, .9, 2.15], ['L', -2.45, 2.15], ['Q', -2.55, 2.1, -2.55, 1.9], ['L', -2.55, .6], ['L', -2.5, .4]],
    win: [[[1.6, 1.25], [1.3, 1.98], [.75, 2.0], [.75, 1.25]], [[.55, 1.3], [.55, 1.95], [-.4, 1.95], [-.4, 1.3]], [[-.6, 1.3], [-.6, 1.95], [-1.55, 1.95], [-1.55, 1.3]], [[-1.75, 1.3], [-1.75, 1.95], [-2.35, 1.95], [-2.35, 1.3]]],
    front: [[1.75, 1.2], [1.35, 2.05]], rear: null, lightY: .85, nose: 2.53, tail: -2.56, mirror: [1.6, 1.25] },
  coach: { len: 11, w: 2.5, wr: .5, axF: 3.4, axR: -3.2,
    body: [['M', -5.45, .55], ['A', -3.2, .6, .55], ['A', 3.4, .6, .55], ['L', 5.4, .55], ['Q', 5.55, .6, 5.55, 1.0], ['L', 5.5, 2.4], ['Q', 5.45, 3.2, 5.0, 3.3], ['L', -5.3, 3.3], ['Q', -5.5, 3.25, -5.5, 3.0], ['L', -5.5, .75], ['L', -5.45, .55]],
    win: [[[4.9, 1.55], [4.9, 2.95], [-5.2, 2.95], [-5.2, 1.55]]],
    front: [[5.5, 1.5], [5.1, 3.2]], rear: null, lightY: 1.0, nose: 5.56, tail: -5.52, mirror: [5.3, 2.6] },
};

export function makeCar(type = 'sedan', color = pick(CAR_COLORS)) {
  const g = new THREE.Group();
  if (type === 'keke') return makeKeke(g);
  const base = { taxi: 'sedan', police: 'pickup', fire: 'van', ambulance: 'van', bus: 'van' }[type] || type;
  const d = DEFS[base] || DEFS.sedan;
  const body = { taxi: 0xf4f2ec, police: 0x1b2f5c, fire: 0xc4161c, ambulance: 0xf6f6f2, bus: 0x2f8a52, coach: 0xf4f2ec }[type] ?? color;
  const bodyMesh = new THREE.Mesh(extrude(d.body, d.w, base === 'coach' ? .1 : .07), paint(body)); bodyMesh.castShadow = true; bodyMesh.receiveShadow = true; g.add(bodyMesh);
  // glass
  const gl = [];
  d.win.forEach(p => { gl.push(flatPoly(p, 1, d.w), flatPoly(p, -1, d.w)); });
  if (d.front) gl.push(slopeGlass([d.front[0][0] + .02, d.front[0][1] + .015], [d.front[1][0] + .02, d.front[1][1] + .015], d.w / 2 - .14));
  if (d.rear) gl.push(slopeGlass([d.rear[0][0] - .02, d.rear[0][1] + .015], [d.rear[1][0] - .02, d.rear[1][1] + .015], d.w / 2 - .14));
  const glass = new THREE.Mesh(mergeList(gl), glassMat); g.add(glass);
  // trim: bumpers, grille, mirrors, handles, sills; lights; plates
  const t = new Batch(), L = new Batch(), hw = d.w / 2;
  t.add(BOXG, 0x2a2c30, 0, .42, d.nose - .06, 0, d.w - .1, .22, .16); t.add(BOXG, 0x2a2c30, 0, .42, d.tail + .06, 0, d.w - .1, .22, .16);
  t.add(BOXG, 0x15171a, 0, d.lightY - .02, d.nose, 0, d.w * .38, .16, .04);
  [-1, 1].forEach(s => {
    t.add(BOXG, body === 0x1f2328 ? 0x333333 : 0x1f2328, s * (hw + .08), d.mirror[1] + .06, d.mirror[0], 0, .1, .1, .2);
    t.add(BOXG, 0x22252a, s * (hw + .005), .42, 0, 0, .02, .1, d.len * .5);
    L.add(BOXG, 0xfff8de, s * (hw - .28), d.lightY, d.nose - .01, 0, .42, .14, .06);
    L.add(BOXG, 0xc8202a, s * (hw - .26), d.lightY + .04, d.tail + .01, 0, .38, .14, .06);
    L.add(BOXG, 0xf2a43a, s * (hw - .02), d.lightY + .02, d.nose - .25, 0, .03, .07, .14);
  });
  // type details
  if (type === 'taxi') { [-1, 1].forEach(s => t.add(BOXG, 0x1d8a4a, s * (hw + .006), .7, 0, 0, .02, .16, d.len - .4)); const sign = new THREE.Mesh(new THREE.BoxGeometry(.6, .2, .3), textMat('TAXI', '#f2c230', '#1d3b2a')); sign.position.set(0, 1.58, -.3); g.add(sign); }
  if (type === 'bus') { [-1, 1].forEach(s => t.add(BOXG, 0xf4f2ec, s * (hw + .006), 1.12, 0, 0, .02, .16, d.len - .4)); }
  if (type === 'coach') { [-1, 1].forEach(s => { t.add(BOXG, 0x1d8a4a, s * (hw + .006), 1.1, 0, 0, .02, .25, d.len - .6); t.add(BOXG, 0xf2c230, s * (hw + .006), 1.32, 0, 0, .02, .08, d.len - .6); }); const sg = new THREE.Mesh(new THREE.PlaneGeometry(1.8, .4), textMat('UNITY LINE', '#1d8a4a', '#ffffff')); sg.position.set(0, 3.0, d.nose + .02); g.add(sg); }
  let lightbar = null;
  if (type === 'police' || type === 'fire' || type === 'ambulance') {
    lightbar = [new THREE.Mesh(new THREE.BoxGeometry(.5, .14, .25), new THREE.MeshLambertMaterial({ color: type === 'police' ? 0x2050ff : 0xff2020, emissive: 0x000000 })), new THREE.Mesh(new THREE.BoxGeometry(.5, .14, .25), new THREE.MeshLambertMaterial({ color: type === 'police' ? 0xff2020 : 0xffffff, emissive: 0x000000 }))];
    const top = type === 'police' ? 1.84 : 2.24, z = type === 'police' ? .1 : 1.0;
    lightbar[0].position.set(-.28, top, z); lightbar[1].position.set(.28, top, z); g.add(...lightbar);
    const word = type === 'police' ? ['POLICE', '#1b2f5c', '#ffffff'] : type === 'fire' ? ['FIRE SERVICE', '#c4161c', '#ffffff'] : ['AMBULANCE', '#f6f6f2', '#c4161c'];
    [-1, 1].forEach(s => { const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, .5), textMat(...word)); m.position.set(s * (hw + .02), type === 'police' ? .82 : 1.05, -.6); m.rotation.y = s * Math.PI / 2; g.add(m); });
    if (type === 'police') [-1, 1].forEach(s => t.add(BOXG, 0xf4f4f4, s * (hw + .006), .62, 0, 0, .02, .12, d.len - .3));
    if (type === 'fire') { t.add(BOXG, 0xbfc4c8, 0, 2.3, -.6, 0, .5, .12, 3.6); [-1, 1].forEach(s => t.add(BOXG, 0xf4f4f4, s * (hw + .006), .78, 0, 0, .02, .12, d.len - .3)); }
    if (type === 'ambulance') [-1, 1].forEach(s => { t.add(BOXG, 0xc4161c, s * (hw + .006), 1.6, -1, 0, .02, .5, .14); t.add(BOXG, 0xc4161c, s * (hw + .006), 1.6, -1, 0, .02, .14, .5); });
  }
  if (base === 'pickup') { t.add(BOXG, 0x22252a, 0, 1.11, -1.57, 0, d.w - .25, .04, 1.9); }
  const trim = t.build(trimMat, { cast: false }); g.add(trim);
  const lights = L.build(lightMat, { cast: false }); g.add(lights);
  [[d.nose + .03, 0], [d.tail - .03, Math.PI]].forEach(([z, r]) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(.52, .2), plateMat()); p.position.set(0, .48, z); p.rotation.y = r; g.add(p); });
  // wheels
  const wheels = [];
  [d.axF, d.axR].forEach((az, i) => [-1, 1].forEach(s => { const w = wheel(d.wr, base === 'coach' ? .34 : .24); const holder = new THREE.Group(); holder.position.set(s * (hw - .14), d.wr, az); holder.add(w); g.add(holder); wheels.push({ holder, w, front: i === 0 }); }));
  g.userData = { len: d.len, w: d.w, type, color: body, wheels, wr: d.wr, lightbar };
  return g;
}
function makeKeke(g) {
  const yel = 0xf2c230, grn = 0x1f7a4f, b = new Batch();
  const shell = extrude([['M', -1.25, .35], ['L', .95, .35], ['Q', 1.35, .4, 1.3, .8], ['L', 1.2, 1.35], ['Q', 1.05, 1.95, .55, 2.0], ['L', -1.15, 2.0], ['L', -1.25, 1.95], ['L', -1.3, .55], ['L', -1.25, .35]], 1.3, .06);
  const body = new THREE.Mesh(shell, paint(yel)); body.castShadow = true;
  // open sides: carve with a dark interior panel look
  [-1, 1].forEach(s => { b.add(BOXG, 0x1d1d1d, s * .66, 1.15, -.3, 0, .02, .7, 1.2); b.add(BOXG, grn, s * .66, .55, 0, 0, .02, .16, 2.3); });
  b.add(BOXG, grn, 0, 2.02, -.1, 0, 1.34, .06, 2.4);
  b.add(BOXG, 0x3a2d26, 0, .85, -.6, 0, 1.15, .25, .9);
  b.add(BOXG, 0xfff6d8, 0, .95, 1.3, 0, .26, .14, .05); b.add(BOXG, 0xc8202a, -.4, .7, -1.3, 0, .16, .1, .04); b.add(BOXG, 0xc8202a, .4, .7, -1.3, 0, .16, .1, .04);
  const glass = new THREE.Mesh(slopeGlass([1.22, 1.3], [.95, 1.9], .55), glassMat);
  g.add(body, glass, b.build(trimMat, { cast: false }));
  const wheels = [];
  [[0, 1.0, true], [-.6, -.85, false], [.6, -.85, false]].forEach(([x, z, f]) => { const w = wheel(.27, .16); const h = new THREE.Group(); h.position.set(x, .27, z); h.add(w); g.add(h); wheels.push({ holder: h, w, front: f }); });
  g.userData = { len: 2.7, w: 1.35, type: 'keke', color: yel, wheels, wr: .27 };
  return g;
}
function mergeList(list) {
  list = list.map(x => { const gg = x.index ? x.toNonIndexed() : x; if (!gg.attributes.normal) gg.computeVertexNormals(); return gg; });
  let n = 0; list.forEach(x => n += x.attributes.position.count);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  list.forEach(gg => { pos.set(gg.attributes.position.array, o * 3); nor.set(gg.attributes.normal.array, o * 3); o += gg.attributes.position.count; });
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); return out;
}

/* ================= routes ================= */
const right = d => [-d[1], d[0]];
const armAngle = d => { const a = [-d[0], -d[1]]; if (a[1] > .5) return 0; if (a[0] > .5) return Math.PI / 2; if (a[1] < -.5) return Math.PI; return Math.PI * 1.5; };
export function resample(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 1.5));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  const L = [0]; for (let i = 1; i < out.length; i++) L.push(L[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
  return { pts: out, L, total: L[L.length - 1] };
}
function nodePoints(p, c, q, lane, pts) {
  const din = [Math.sign(c[0] - p[0]), Math.sign(c[1] - p[1])], dout = [Math.sign(q[0] - c[0]), Math.sign(q[1] - c[1])];
  const cx = c[0] * S, cz = c[1] * S, ri = right(din), ro = right(dout);
  if (c[0] === 0 && c[1] === 0) {
    const RL = RB_LANE + (lane > 4 ? 2.5 : 0), off = Math.asin(Math.min(.95, lane / RL));
    let a0 = armAngle(din) + off, a1 = armAngle([-dout[0], -dout[1]]) - off;
    while (a1 <= a0 + .2) a1 += Math.PI * 2;
    pts.push([cx + ri[0] * lane - din[0] * (RL + 6), cz + ri[1] * lane - din[1] * (RL + 6)]);
    for (let a = a0; a <= a1 + 1e-3; a += .12) pts.push([Math.sin(a) * RL, Math.cos(a) * RL]);
    pts.push([cx + ro[0] * lane + dout[0] * (RL + 6), cz + ro[1] * lane + dout[1] * (RL + 6)]);
  } else if (din[0] === dout[0] && din[1] === dout[1]) pts.push([cx + ri[0] * lane, cz + ri[1] * lane]);
  else if (din[0] === -dout[0] && din[1] === -dout[1]) { pts.push([cx + ri[0] * lane, cz + ri[1] * lane]); pts.push([cx - ri[0] * lane, cz - ri[1] * lane]); }
  else {
    const kx = cx + (ri[0] + ro[0]) * lane, kz = cz + (ri[1] + ro[1]) * lane, r = 4 + lane * .4;
    const a = [kx - din[0] * r, kz - din[1] * r], bq = [kx + dout[0] * r, kz + dout[1] * r];
    for (let t = 0; t <= 1.001; t += .2) { const u = 1 - t; pts.push([u * u * a[0] + 2 * u * t * kx + t * t * bq[0], u * u * a[1] + 2 * u * t * kz + t * t * bq[1]]); }
  }
}
export function routeFromNodes(nodes, lane) {
  const pts = [], n = nodes.length;
  for (let k = 0; k < n; k++) nodePoints(nodes[(k - 1 + n) % n], nodes[k], nodes[(k + 1) % n], lane, pts);
  pts.push(pts[0]); return resample(pts);
}
/* an open path along road nodes, starting at a world point and ending at another */
export function openRoute(start, nodes, end, lane = 3) {
  const pts = [start], n = nodes.length;
  for (let k = 0; k < n; k++) {
    const c = nodes[k], nx = nodes[Math.min(k + 1, n - 1)], pv = nodes[Math.max(k - 1, 0)];
    const p = k > 0 ? pv : (n > 1 ? [2 * c[0] - nx[0], 2 * c[1] - nx[1]] : [c[0] - 1, c[1]]);
    const q = k < n - 1 ? nx : (n > 1 ? [2 * c[0] - pv[0], 2 * c[1] - pv[1]] : [c[0] + 1, c[1]]);
    nodePoints(p, c, q, lane, pts);
  }
  pts.push(end); return resample(pts);
}
/* a road-grid path between two nodes (x first, then z) */
export function gridPath(a, b) {
  const out = [[...a]]; let [x, z] = a;
  while (x !== b[0]) { x += Math.sign(b[0] - x); out.push([x, z]); }
  while (z !== b[1]) { z += Math.sign(b[1] - z); out.push([x, z]); }
  return out;
}
export const nearestNode = (x, z) => [Math.max(-N, Math.min(N, Math.round(x / S))), Math.max(-N, Math.min(N, Math.round(z / S)))];
export function rectLoop(x1, z1, x2, z2) {
  const nodes = [];
  for (let x = x1; x < x2; x++) nodes.push([x, z1]);
  for (let z = z1; z < z2; z++) nodes.push([x2, z]);
  for (let x = x2; x > x1; x--) nodes.push([x, z2]);
  for (let z = z2; z > z1; z--) nodes.push([x1, z]);
  return nodes;
}
export function circleRoute(lane) {
  const R = RB_LANE + (lane > 4 ? 2.5 : 0), pts = [];
  for (let a = 0; a <= Math.PI * 2 + 1e-3; a += .1) pts.push([Math.sin(a) * R, Math.cos(a) * R]);
  return resample(pts);
}
export function pointAt(route, s) {
  s = ((s % route.total) + route.total) % route.total;
  let lo = 0, hi = route.L.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (route.L[m] <= s) lo = m; else hi = m; }
  const a = route.pts[lo], b = route.pts[hi], t = (s - route.L[lo]) / Math.max(1e-6, route.L[hi] - route.L[lo]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[0] - a[0], b[1] - a[1])];
}

/* ================= traffic ================= */
export class Traffic {
  constructor(parent) { this.cars = []; this.parent = parent; this.zones = []; this.t = 0; }
  base(mesh, extra) {
    return Object.assign({ mode: 'ai', y: 0, mesh, route: null, s: 0, v: 0, vmax: 0, idx: 0, stuck: 0, ghost: 0, honkT: 0, len: mesh.userData.len, w: mesh.userData.w, yaw: 0, fwd: new THREE.Vector2(), pos: new THREE.Vector2(), jolt: 0 }, extra);
  }
  add(route, type, s0) {
    const mesh = makeCar(type); this.parent.add(mesh);
    const c = this.base(mesh, { route, s: s0 % route.total, vmax: type === 'bus' ? 8 : type === 'keke' ? 7 : 9 + rand() * 4 });
    this.place(c, true); this.cars.push(c); return c;
  }
  addParked(type, color, x, y, z, yaw) {
    const mesh = makeCar(type, color); this.parent.add(mesh);
    const c = this.base(mesh, { mode: 'parked', yaw, y }); c.pos.set(x, z); this.sync(c); this.cars.push(c); return c;
  }
  remove(c) { this.parent.remove(c.mesh); this.cars.splice(this.cars.indexOf(c), 1); }
  sync(c) { c.fwd.set(Math.sin(c.yaw), Math.cos(c.yaw)); c.mesh.position.set(c.pos.x, c.y, c.pos.y); c.mesh.rotation.y = c.yaw; }
  nearest(x, z, maxD, filter) { let best = null, bd = maxD * maxD; for (const c of this.cars) { if (filter && !filter(c)) continue; const d = (c.pos.x - x) ** 2 + (c.pos.y - z) ** 2; if (d < bd) { bd = d; best = c; } } return best; }
  place(c, snap) {
    const r = c.route; while (r.L[c.idx + 1] < c.s) c.idx++; while (c.idx > 0 && r.L[c.idx] > c.s) c.idx--;
    const i = Math.min(c.idx, r.pts.length - 2), t = (c.s - r.L[i]) / Math.max(1e-6, r.L[i + 1] - r.L[i]);
    const a = r.pts[i], b = r.pts[i + 1];
    c.pos.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    const la = r.pts[Math.min(i + 2, r.pts.length - 1)];
    const yaw = Math.atan2(la[0] - c.pos.x, la[1] - c.pos.y);
    c.yaw = snap || !isFinite(c.yaw) ? yaw : angleLerp(c.yaw, yaw, .25);
    c.fwd.set(Math.sin(c.yaw), Math.cos(c.yaw));
    c.mesh.position.set(c.pos.x, c.y + (c.jolt > 0 ? Math.sin(c.jolt * 30) * .04 : 0), c.pos.y); c.mesh.rotation.y = c.yaw;
  }
  /* how fast a car may go given cars ahead, the player and slow zones */
  limitFor(c, player) {
    let limit = c.vmax, blocked = false;
    const look = 6 + c.v * .9;
    if (c.ghost <= 0) for (const o of this.cars) {
      if (o === c || o.mode === 'gone') continue;
      const rx = o.pos.x - c.pos.x, rz = o.pos.y - c.pos.y, ahead = rx * c.fwd.x + rz * c.fwd.y;
      if (ahead <= 0 || ahead > look + o.len) continue;
      const lat = Math.abs(rx * c.fwd.y - rz * c.fwd.x);
      if (lat < 1.9) limit = Math.min(limit, Math.max(0, (ahead - (c.len + o.len) / 2 - 1.8) * 1.4));
    }
    if (player) {
      const px = player.x - c.pos.x, pz = player.z - c.pos.y, pa = px * c.fwd.x + pz * c.fwd.y, pl = Math.abs(px * c.fwd.y - pz * c.fwd.x);
      if (pa > 0 && pa < c.len / 2 + 7 && pl < c.w / 2 + .8) { limit = Math.min(limit, Math.max(0, (pa - c.len / 2 - 1.2) * 1.5)); blocked = limit < .5; }
    }
    for (const z of this.zones) if ((c.pos.x - z.x) ** 2 + (c.pos.y - z.z) ** 2 < z.r * z.r) limit = Math.min(limit, z.limit);
    return { limit, blocked };
  }
  update(dt, player, onHonk, camPos) {
    this.t += dt;
    for (const c of this.cars) {
      if (c.jolt > 0) c.jolt -= dt;
      if (c.mode === 'ai') {
        const { limit, blocked } = this.limitFor(c, player);
        c.honkT -= dt;
        if (blocked && c.honkT <= 0) { c.honkT = 3.5; onHonk && onHonk(c); }
        c.v = damp(c.v, limit, limit < c.v ? 6 : 1.2, dt);
        if (c.v < .2 && !blocked) c.stuck += dt; else c.stuck = 0;
        if (c.stuck > 4) { c.ghost = 1.5; c.stuck = 0; }
        c.ghost -= dt;
        c.s += c.v * dt; if (c.s >= c.route.total) { c.s -= c.route.total; c.idx = 0; }
        this.place(c, false);
      }
      // spin wheels and flash light bars for nearby cars
      const ud = c.mesh.userData;
      if (camPos && (c.pos.x - camPos.x) ** 2 + (c.pos.y - camPos.z) ** 2 < 3600) {
        const spin = c.v * dt / (ud.wr || .34);
        for (const w of ud.wheels) { w.w.rotation.x += spin; if (w.front) w.holder.rotation.y = c.steer || 0; }
      }
      if (ud.lightbar) { const on = c.siren && (Math.floor(this.t * 6) % 2 === 0); ud.lightbar[0].material.emissive.setHex(c.siren && on ? ud.lightbar[0].material.color.getHex() : 0); ud.lightbar[1].material.emissive.setHex(c.siren && !on ? ud.lightbar[1].material.color.getHex() : 0); }
    }
  }
  collide(p, R, skip) {
    for (const c of this.cars) {
      if (c === skip || c.mode === 'gone' || c.mode === 'ride') continue;
      const dx = p.x - c.pos.x, dz = p.z - c.pos.y; if (dx * dx + dz * dz > 64) continue;
      const lz = dx * c.fwd.x + dz * c.fwd.y, lx = dx * c.fwd.y - dz * c.fwd.x;
      const hx = c.w / 2, hz = c.len / 2, nx = Math.max(-hx, Math.min(hx, lx)), nz = Math.max(-hz, Math.min(hz, lz));
      let ex = lx - nx, ez = lz - nz, d = Math.hypot(ex, ez);
      if (d < R) {
        if (d < 1e-4) { const ox = hx - Math.abs(lx), oz = hz - Math.abs(lz); if (ox < oz) { ex = Math.sign(lx) || 1; ez = 0; d = -ox; } else { ez = Math.sign(lz) || 1; ex = 0; d = -oz; } }
        else { ex /= d; ez /= d; }
        const push = R - d, wx = ex * c.fwd.y + ez * c.fwd.x, wz = -ex * c.fwd.x + ez * c.fwd.y;
        p.x += wx * push; p.z += wz * push;
      }
    }
  }
}

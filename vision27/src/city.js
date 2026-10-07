import * as THREE from 'three';
import { Batch, uvBox, mergeTextured, placed, blob, canvasTex, rand, pick, range, noise, smooth, lerp } from './util.js';
import { S, N, EDGE, HALF, CURB, RB_ISLAND, RB_CUT, LANES, padFactor } from './consts.js';
import { makeCar, CAR_COLORS } from './cars.js';
import { makePerson, randomPerson, ankara } from './people.js';

/* ---------------- textures ---------------- */
const T = {};
function textures() {
  T.pave = canvasTex(128, 128, (g, w) => {
    g.fillStyle = '#b9ae9b'; g.fillRect(0, 0, w, w);
    const cols = ['#d6cdbd', '#e0d8c9', '#cfc5b3', '#dcc9b0'];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) { g.fillStyle = cols[(x * 3 + y * 5) % 4]; g.fillRect(x * 32 + (y % 2) * 16 + 1, y * 16 + 1, 30, 14); }
  }); T.pave.repeat.set(.4, .4);
  T.curb = canvasTex(64, 8, g => { g.fillStyle = '#f2c230'; g.fillRect(0, 0, 32, 8); g.fillStyle = '#1e1e1e'; g.fillRect(32, 0, 32, 8); });
  const win = (wall, draw) => canvasTex(128, 112, (g, w, h) => { g.fillStyle = wall; g.fillRect(0, 0, w, h); draw(g, w, h); });
  T.glass = win('#cfd8d6', (g) => {
    const gr = g.createLinearGradient(0, 0, 128, 112); gr.addColorStop(0, '#2f6f86'); gr.addColorStop(.55, '#5fa3b5'); gr.addColorStop(1, '#2a5d73');
    g.fillStyle = gr; g.fillRect(0, 12, 128, 100); g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(20, 112); g.lineTo(70, 12); g.lineTo(90, 12); g.lineTo(40, 112); g.fill();
    g.fillStyle = '#d9e2e0'; g.fillRect(0, 0, 128, 12); g.fillRect(62, 12, 4, 100);
  });
  T.office = win('#e6d8bb', g => { g.fillStyle = '#3a5a72'; g.fillRect(16, 26, 96, 56); g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(16, 26, 96, 14); g.fillStyle = '#c9b996'; g.fillRect(16, 82, 96, 8); g.fillRect(62, 26, 4, 56); });
  T.terra = win('#c98a5e', g => { g.fillStyle = '#2f4656'; g.beginPath(); g.moveTo(40, 96); g.lineTo(40, 46); g.arc(64, 46, 24, Math.PI, 0); g.lineTo(88, 96); g.fill(); g.fillStyle = '#e9d3b6'; g.fillRect(34, 96, 60, 6); });
  T.white = win('#f1efe8', g => { g.fillStyle = '#34505f'; g.fillRect(0, 38, 128, 40); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, 38, 128, 10); g.fillStyle = '#d8d4c8'; for (let x = 0; x < 128; x += 32) g.fillRect(x, 38, 3, 40); });
}
function signTex(text, bg, fg, sub) {
  return canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${sub ? 46 : 54}px "Fredoka", "Segoe UI", system-ui, sans-serif`; g.fillText(text, w / 2, sub ? 52 : h / 2 + 2, w - 40);
    if (sub) { g.font = '500 28px "Fredoka", "Segoe UI", system-ui, sans-serif'; g.fillText(sub, w / 2, 96, w - 40); }
  }, false);
}

/* ---------------- shared geometry ---------------- */
const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(1, 1, 1, 10), CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6), SPH = new THREE.IcosahedronGeometry(1, 1), CONE4 = new THREE.ConeGeometry(1, 1, 4);

export function blockType(ix, iz) {
  const map = {
    '-2,-2': 'homes', '-1,-2': 'dome', '0,-2': 'spire', '1,-2': 'homes',
    '-2,-1': 'offices', '-1,-1': 'towers', '0,-1': 'towers', '1,-1': 'shops',
    '-2,0': 'market', '-1,0': 'towers', '0,0': 'offices', '1,0': 'park',
    '-2,1': 'shops', '-1,1': 'homes', '0,1': 'shops', '1,1': 'homes',
  };
  return map[ix + ',' + iz];
}
const isCenter = (ix, iz) => (ix === -1 || ix === 0) && (iz === -1 || iz === 0);
export function blockPolygon(ix, iz) {
  const x0 = ix * S + HALF, x1 = (ix + 1) * S - HALF, z0 = iz * S + HALF, z1 = (iz + 1) * S - HALF;
  if (!isCenter(ix, iz)) return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const sx = ix === 0 ? 1 : -1, sz = iz === 0 ? 1 : -1, n = HALF, f = S - HALF, e = Math.sqrt(RB_CUT * RB_CUT - n * n);
  const pts = [[sx * n, sz * e], [sx * n, sz * f], [sx * f, sz * f], [sx * f, sz * n], [sx * e, sz * n]];
  const a0 = Math.atan2(sz * n, sx * e), a1 = Math.atan2(sz * e, sx * n); let da = a1 - a0; da = Math.atan2(Math.sin(da), Math.cos(da));
  for (let k = 1; k < 10; k++) { const a = a0 + da * k / 10; pts.push([Math.cos(a) * RB_CUT, Math.sin(a) * RB_CUT]); }
  return pts;
}
export function terrainH(x, z) {
  const m = Math.max(Math.abs(x), Math.abs(z));
  return (smooth(142, 230, m) * (16 + noise(x * .012, z * .012) * 10) + smooth(136, 160, m) * noise(x * .05, z * .05) * .8) * padFactor(x, z);
}

export function buildCity(scene) {
  textures();
  const root = new THREE.Group(); scene.add(root);
  const B = new Batch();                       // static vertex-coloured props
  const TX = { glass: [], office: [], terra: [], white: [] };
  const doors = [], houses = [], seats = [], parked = [], adSlots = [], boxes = [], circles = [], vendors = [], quest = [], flags = [], smokes = [], trees = [], palms = [], walkLoops = [], marketPaths = [];
  const blocks = [];
  const box = (w, h, d, c, x, y, z, ry = 0) => B.add(BOX, c, x, y, z, ry, w, h, d);
  const solid = (x, z, w, d) => boxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

  /* ---------- ground ---------- */
  {
    const g = new THREE.PlaneGeometry(900, 900, 200, 200); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, terrainH(p.getX(i), p.getZ(i)) - (Math.max(Math.abs(p.getX(i)), Math.abs(p.getZ(i))) < 138 ? .05 : 0));
    const ng = g.toNonIndexed(); g.dispose(); ng.computeVertexNormals();
    const a = ng.attributes.position.array, cols = new Float32Array(a.length), c = new THREE.Color();
    const grass = [0x7fae5f, 0x8bb866, 0x739f57, 0x96bd6e], earth = [0xb0693f, 0xa45f39, 0xbb7a4c];
    for (let i = 0; i < a.length; i += 9) {
      const cx = (a[i] + a[i + 3] + a[i + 6]) / 3, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3, n = noise(cx * .03 + 5, cz * .03);
      c.setHex(n > .35 ? earth[(rand() * 3) | 0] : grass[(rand() * 4) | 0]); c.offsetHSL(0, 0, (rand() - .5) * .03);
      for (let v = 0; v < 9; v += 3) { cols[i + v] = c.r; cols[i + v + 1] = c.g; cols[i + v + 2] = c.b; }
    }
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const m = new THREE.Mesh(ng, new THREE.MeshLambertMaterial({ vertexColors: true })); m.receiveShadow = true; root.add(m);
    const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(2 * (EDGE + HALF) + 1, 2 * (EDGE + HALF) + 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5a5d62 }));
    asphalt.position.y = .005; asphalt.receiveShadow = true; root.add(asphalt);
  }

  /* ---------- blocks: raised sidewalks with black & yellow curbs ---------- */
  const slabs = [], curbs = [];
  for (let ix = -N; ix < N; ix++) for (let iz = -N; iz < N; iz++) {
    const poly = blockPolygon(ix, iz), type = blockType(ix, iz);
    blocks.push({ ix, iz, type, poly, cx: ix * S + S / 2, cz: iz * S + S / 2 });
    const sh = new THREE.Shape(); poly.forEach(([x, z], i) => i ? sh.lineTo(x, -z) : sh.moveTo(x, -z));
    const g = new THREE.ExtrudeGeometry(sh, { depth: CURB, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.clearGroups(); slabs.push(g);
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length], L = Math.hypot(bx - ax, bz - az);
      const cg = uvBox(.3, CURB + .03, L + .3, 2, CURB + .03); cg.rotateY(Math.atan2(bx - ax, bz - az)); cg.translate((ax + bx) / 2, (CURB + .03) / 2, (az + bz) / 2); curbs.push(cg);
    }
  }
  const slab = new THREE.Mesh(mergeTextured(slabs), new THREE.MeshLambertMaterial({ map: T.pave })); slab.receiveShadow = true; root.add(slab);
  const curb = new THREE.Mesh(mergeTextured(curbs), new THREE.MeshLambertMaterial({ map: T.curb })); curb.receiveShadow = true; root.add(curb);

  /* ---------- roads: medians, lane marks, crosswalks, lamps ---------- */
  const W = 0xf2f2ee, nearCenter = (x, z) => Math.hypot(x, z) < RB_CUT + 4;
  for (let k = -N; k <= N; k++) for (let j = -N; j < N; j++) {
    for (const vertical of [false, true]) {
      const a = j * S + HALF + 4, b = (j + 1) * S - HALF - 4, mid = (a + b) / 2, len = b - a, c = k * S;
      let s0 = a, s1 = b;
      if (k === 0 && j === -1) s1 = -RB_CUT - 4; if (k === 0 && j === 0) s0 = RB_CUT + 4;
      const ml = s1 - s0, mm = (s0 + s1) / 2;
      const at = (along, across, y, w, h, d, col) => vertical ? box(w, h, d, col, c + across, y, along) : box(d, h, w, col, along, y, c + across);
      // median: concrete kerb + grass + palms + lamps
      at(mm, 0, .1, 2.2, .2, ml, 0xd9d4c7); at(mm, 0, .21, 1.7, .04, ml - .4, 0x6f9e4f);
      for (let s = s0 + 6; s < s1 - 3; s += 16) {
        const [px, pz] = vertical ? [c, s] : [s, c];
        lamp(px, pz, vertical); circles.push({ x: px, z: pz, r: .35 });
        const [qx, qz] = vertical ? [c, s + 8] : [s + 8, c];
        if (s + 8 < s1 - 2) { palms.push({ x: qx, z: qz, y: .22, s: .85 + rand() * .3 }); circles.push({ x: qx, z: qz, r: .45 }); }
      }
      // lane dashes
      for (const sd of [-1, 1]) for (let s = a - 2; s < b + 2; s += 7) { if (nearCenter(vertical ? c : s, vertical ? s : c)) continue; at(s, sd * 4.5, .015, .16, .01, 3, W); }
      // crosswalk zebras at both ends of the segment
      for (const end of [j * S + HALF + 1.6, (j + 1) * S - HALF - 1.6]) {
        if (nearCenter(vertical ? c : end, vertical ? end : c)) continue;
        for (let q = -7; q <= 7; q += 1.4) at(end, q, .016, .7, .01, 2.6, W);
      }
    }
  }
  function lamp(x, z, vertical) {
    box(.18, 7, .18, 0x8e9196, x, 3.6, z);
    if (Math.abs(x) <= 70 && Math.abs(z) <= 70 && ((x + z) / 16 | 0) % 2 === 0) { const ox = vertical ? .7 : 0, oz = vertical ? 0 : .7; box(vertical ? 1.3 : .06, .06, vertical ? .06 : 1.3, 0x8e9196, x + ox * .5, 5.75, z + oz * .5); adSlot('banner', 1, 2.4, x + ox, 4.5, z + oz, vertical ? 0 : Math.PI / 2); }
    const ax = vertical ? 1 : 0, az = vertical ? 0 : 1;
    const broken = rand() < .14;
    [-1, 1].forEach(s => { box(vertical ? 1.6 : .08, .08, vertical ? .08 : 1.6, 0x8e9196, x + s * ax * .8, 7, z + s * az * .8); box(.5, .14, .3, broken && s > 0 ? 0x3a3a3a : 0xf5f0de, x + s * ax * 1.55, broken && s > 0 ? 6.6 : 6.92, z + s * az * 1.55, broken && s > 0 ? .5 : 0); });
  }

  /* ---------- roundabout ---------- */
  {
    B.add(CYL, 0xd9d4c7, 0, .17, 0, 0, RB_ISLAND, .34, RB_ISLAND);
    B.add(CYL, 0x6f9e4f, 0, .35, 0, 0, RB_ISLAND - .6, .04, RB_ISLAND - .6);
    // flower ring
    for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2, r = RB_ISLAND - 1.6; B.add(SPH, pick([0xe8452c, 0xf2c230, 0xf4f0e6, 0xd94f7a]), Math.cos(a) * r, .55, Math.sin(a) * r, 0, .55, .35, .55); }
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + .2; palms.push({ x: Math.cos(a) * 9, z: Math.sin(a) * 9, y: .36, s: 1 + rand() * .2 }); }
    // unity monument: three bronze arcs meeting at the top, on a green-white-green plinth
    B.add(CYL6, 0x1d8a4a, 0, 1.1, 0, 0, 3.2, 1.5, 3.2); B.add(CYL6, 0xf4f2ec, 0, 2.3, 0, 0, 2.6, .9, 2.6); B.add(CYL6, 0x1d8a4a, 0, 3.1, 0, 0, 2.2, .7, 2.2);
    const arc = new THREE.TorusGeometry(4.2, .35, 6, 18, Math.PI);
    for (let i = 0; i < 3; i++) B.add(arc, 0xb07a3a, 0, 3.4, 0, i * Math.PI / 3, 1, 1.9, 1);
    B.add(SPH, 0xd9a936, 0, 11.6, 0, 0, .7, .7, .7);
    circles.push({ x: 0, z: 0, r: RB_ISLAND });
  }

  /* ---------- plaza ring around the roundabout: planters and benches ---------- */
  for (let i = 0; i < 48; i++) {
    const a = i / 48 * Math.PI * 2, r = 32.5, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.min(Math.abs(x), Math.abs(z)) < HALF + 2) continue;
    if (i % 3 === 0) { B.add(CYL6, 0xd9d4c7, x, CURB + .35, z, 0, 1.1, .7, 1.1); B.add(SPH, pick([0x4e9a55, 0x3f8a4f]), x, CURB + 1.1, z, 0, 1, .7, 1); B.add(SPH, pick([0xe8452c, 0xf2c230, 0xd94f7a]), x + .3, CURB + 1.4, z, 0, .35, .25, .35); circles.push({ x, z, r: 1.2 }); }
    else if (i % 3 === 1) { box(2, .1, .6, 0x8a6a4e, x, CURB + .55, z, -a + Math.PI / 2); box(2, .5, .1, 0x8a6a4e, x + Math.cos(a) * .3, CURB + .85, z + Math.sin(a) * .3, -a + Math.PI / 2); [-.8, .8].forEach(o => box(.1, .5, .5, 0x555555, x - Math.sin(a) * o, CURB + .25, z + Math.cos(a) * o, -a + Math.PI / 2)); [-.5, .5].forEach(o => seats.push({ x: x - Math.cos(a) * .05 - Math.sin(a) * o, z: z - Math.sin(a) * .05 + Math.cos(a) * o, y: CURB, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) })); }
  }

  /* ---------- building helpers ---------- */
  const ROOFS = [0xcfc6b8, 0xbdb5a8, 0xd8d0c2];
  function building(x, z, w, d, h, style, opts = {}) {
    const y0 = CURB;
    TX[style].push(placed(uvBox(w, h, d, 4, 3.5), x, y0 + h / 2, z));
    box(w + .4, .5, d + .4, opts.trim ?? pick(ROOFS), x, y0 + h + .25, z);
    box(w + .6, 1.2, d + .6, opts.base ?? 0x9a8f80, x, y0 + .6, z);
    // rooftop clutter: AC units, water tanks
    const n = (w * d / 60) | 0;
    for (let i = 0; i < Math.min(n, 5); i++) {
      const rx = x + (rand() - .5) * (w - 3), rz = z + (rand() - .5) * (d - 3);
      if (rand() < .5) box(1.4, 1, 1, 0xdedcd6, rx, y0 + h + 1, rz); else B.add(CYL, pick([0x2b2b2b, 0x2f5fa0]), rx, y0 + h + 1.3, rz, 0, .7, 1.6, .7);
    }
    solid(x, z, w + .6, d + .6);
    if (opts.door) { // glass doors on the street side
      const [dx, dz] = opts.door, alongX = Math.abs(dx) > Math.abs(dz), s = alongX ? Math.sign(dx) || 1 : Math.sign(dz) || 1;
      const fx = alongX ? x + s * (w / 2 + .32) : x, fz = alongX ? z : z + s * (d / 2 + .32), ry = alongX ? (s > 0 ? Math.PI / 2 : -Math.PI / 2) : (s > 0 ? 0 : Math.PI);
      B.add(BOX, 0x2f4656, fx, CURB + 1.4, fz, ry, 2.6, 2.6, .1); B.add(BOX, 0xd8d0c2, fx, CURB + 2.85, fz, ry, 3.2, .3, .3);
      doors.push({ kind: 'lobby', name: opts.name || 'Office', pos: new THREE.Vector3(fx + Math.sin(ry) * 1.1, CURB, fz + Math.cos(ry) * 1.1), yaw: ry });
    }
  }
  function sign(text, x, y, z, ry, w = 5, bg = '#1f7a5c', fg = '#ffffff', sub) {
    const mt = new THREE.MeshLambertMaterial({ map: signTex(text, bg, fg, sub) }), m = new THREE.Group();
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), mt), back = front.clone(); back.rotation.y = Math.PI; m.add(front, back);
    m.position.set(x, y, z); m.rotation.y = ry; root.add(m); return m;
  }
  // an advert board: two back-to-back planes; main.js paints the adverts on them
  function adSlot(kind, w, h, x, y, z, ry, digital = false) {
    const g = new THREE.Group(), geo = new THREE.PlaneGeometry(w, h), front = new THREE.Mesh(geo, adBlank), back = new THREE.Mesh(geo, adBlank);
    back.rotation.y = Math.PI; back.position.z = -.01; g.add(front, back); g.position.set(x, y, z); g.rotation.y = ry; root.add(g);
    const slot = { g, meshes: [front, back], kind, digital, i: adSlots.length }; front.userData.slot = back.userData.slot = slot; adSlots.push(slot); return slot;
  }
  function wallPoster(x, z, w, d, h, dx, dz) { // poster on the building face that looks at the street
    const alongX = Math.abs(dx) > Math.abs(dz), sx = Math.sign(dx) || 1, sz = Math.sign(dz) || 1;
    if (alongX) adSlot('poster', 3, 4.5, x + sx * (w / 2 + .42), CURB + 3.6, z + (rand() - .5) * (d - 5), sx > 0 ? Math.PI / 2 : -Math.PI / 2);
    else adSlot('poster', 3, 4.5, x + (rand() - .5) * (w - 5), CURB + 3.6, z + sz * (d / 2 + .42), sz > 0 ? 0 : Math.PI);
  }
  function flag(x, z, h = 9) {
    box(.12, h, .12, 0xdedede, x, CURB + h / 2, z);
    const tex = canvasTex(96, 48, (g) => { g.fillStyle = '#1d8a4a'; g.fillRect(0, 0, 96, 48); g.fillStyle = '#ffffff'; g.fillRect(32, 0, 32, 48); }, false);
    const geo = new THREE.PlaneGeometry(2.6, 1.3, 10, 1); geo.translate(1.3, 0, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide })); m.position.set(x + .06, CURB + h - .7, z); root.add(m);
    flags.push({ m, base: Float32Array.from(geo.attributes.position.array), ph: rand() * 6 });
  }
  function tree(x, z, s = 1, y = CURB) { trees.push({ x, z, y, s, v: (rand() * 3) | 0 }); circles.push({ x, z, r: .4 * s }); }
  function sidewalkTrees(bk, step = 12) {
    const x0 = bk.cx - 22, x1 = bk.cx + 22, z0 = bk.cz - 22, z1 = bk.cz + 22;
    for (let t = -18; t <= 18; t += step) {
      [[bk.cx + t, z0], [bk.cx + t, z1], [x0, bk.cz + t], [x1, bk.cz + t]].forEach(([x, z]) => { if (Math.hypot(x, z) > RB_CUT + 4) tree(x, z, .75 + rand() * .3); });
    }
  }
  const plate = (x, z, w, d, col, y = CURB + .01) => box(w, .02, d, col, x, y, z);
  function walkLoop(bk) {
    const r = 20.6, pts = [[bk.cx - r, bk.cz - r], [bk.cx + r, bk.cz - r], [bk.cx + r, bk.cz + r], [bk.cx - r, bk.cz + r]];
    walkLoops.push(pts);
  }

  /* ---------- fill each block ---------- */
  const shopNames = [
    ['Mama Put Kitchen', 'Rice, beans and stew', '#c9472f'], ['Blessed Hands Salon', 'Hair and nails', '#7b3f8c'], ['Jabi Phones', 'Repairs and gadgets', '#2e5fa8'],
    ['Mr Fix Electronics', 'We fix am sharp sharp', '#1f2a36'], ['Gloria Fashion Home', 'Ankara and lace', '#d94f7a'], ['Arewa Pharmacy', 'Open every day', '#1f7a5c'],
    ['Uncle P Barbing Salon', 'Fresh cuts', '#13867f'], ['Zobo & Chapman Spot', 'Cold drinks', '#b3202a'], ['Kilishi Corner', 'Spicy beef jerky', '#8a4b22'],
    ['Sunshine POS', 'Cash out and transfers', '#e8b23a'], ['Unity Supermarket', 'Everything you need', '#2f5fa0'], ['Wazobia Prints', 'Banners and cards', '#e07a2f'],
    ['Ankara Boutique', 'Shirts, gowns and caps', '#7b2d8e'], ['Furniture Palace', 'Sofas, beds and more', '#6e543b'], ['Mama Gold Provisions', 'Rice, oil and noodles', '#b5651d'],
    ['Lace & Aso-Oke House', 'Owambe ready', '#c43d2f'], ['Iya Basira Buka', 'Amala and ewedu', '#3d6b35'], ['Big Boss Mart', 'Supermarket', '#16213a'],
    ['Kiddies Fashion', 'Boutique for all', '#e94e77'], ['Royal Furniture', 'Home and office', '#5a3e2b'],
  ];
  shopNames.splice(2, 0, ['Daily Bread Bakery', 'Agege bread and buns', '#a0522d']);
  let shopI = 0, bakeryBuilt = false;
  for (const bk of blocks) {
    const { cx, cz, type } = bk;
    if (type !== 'market' && type !== 'park') walkLoop(bk);
    if (type === 'towers') {
      const spots = [[-10, -10], [10, -10], [-10, 10], [10, 10]].filter(([dx, dz]) => Math.hypot(cx + dx, cz + dz) > RB_CUT + 14);
      spots.slice(0, 3).forEach(([dx, dz], i) => {
        const h = range(26, 58), w = range(11, 15), d = range(11, 15), style = i % 2 ? 'glass' : 'white';
        building(cx + dx, cz + dz, w, d, h, style, { door: [dx, dz], name: pick(['Zuma Towers', 'Aso Plaza', 'Unity Heights', 'Maitama House', 'Garki Centre', 'Wuse Tower']) });
        wallPoster(cx + dx, cz + dz, w + .6, d + .6, h, dx, dz);
        if (h > 40 && i === 0) { // rooftop billboard facing the street
          const sx = Math.sign(dx) || 1, top = CURB + h + .5, bx = cx + dx, bz = cz + dz;
          [-4, 4].forEach(o => box(.3, 4, .3, 0x7d8085, bx + o, top + 2, bz));
          box(11.4, 3.4, .3, 0x5a5d62, bx, top + 5.6, bz);
          adSlot('wide', 11, 2.75, bx, top + 5.6, bz + .2, 0, true); adSlot('wide', 11, 2.75, bx, top + 5.6, bz - .2, Math.PI, true);
        }
        if (rand() < .6) { TX[style].push(placed(uvBox(w * .65, 7, d * .65, 4, 3.5), cx + dx, CURB + h + 4, cz + dz)); box(w * .65 + .3, .4, d * .65 + .3, 0xd8d0c2, cx + dx, CURB + h + 7.7, cz + dz); }
      });
      sidewalkTrees(bk, 18);
    } else if (type === 'offices') {
      [[-11, -11], [11, -11], [-11, 11], [11, 11]].forEach(([dx, dz]) => {
        if (Math.hypot(cx + dx, cz + dz) < RB_CUT + 12) return;
        const w = range(13, 16), d = range(13, 16);
        building(cx + dx, cz + dz, w, d, range(10, 21), pick(['office', 'terra', 'white']), { trim: 0xe9e2d2, door: [dx, dz], name: pick(['Federal Secretariat', 'Ministry Annex', 'Central Bank House', 'Unity Offices', 'Jabi Business Hub', 'Wuse Exchange']) });
        wallPoster(cx + dx, cz + dz, w + .6, d + .6, 10, dx, dz);
      });
      flag(cx, cz - 2); flag(cx + 3, cz - 2); sidewalkTrees(bk);
    } else if (type === 'dome') {
      // House of Assembly: a colonnaded hall under a green dome
      plate(cx, cz, 40, 40, 0xe8e0cf);
      const bz = cz - 3, top = CURB + 9;
      TX.white.push(placed(uvBox(30, 9, 16, 4, 3.5), cx, CURB + 4.5, bz));
      box(30.6, .6, 16.6, 0xe9e2d2, cx, top + .3, bz); box(31, 1, 17, 0xb9b0a0, cx, CURB + .5, bz);
      box(24, .8, 5.5, 0xf3efe6, cx, top - .1, bz + 10.6); box(26, .3, 7, 0xd9d4c7, cx, CURB + .15, bz + 10.4);
      for (let k = 0; k < 10; k++) { const x = cx - 11.25 + k * 2.5; B.add(CYL, 0xf6f2ea, x, CURB + 4.5, bz + 12.6, 0, .45, 8.6, .45); circles.push({ x, z: bz + 12.6, r: .5 }); }
      B.add(CYL, 0xf3efe6, cx, top + 2.1, bz, 0, 7.5, 3.6, 7.5); B.add(CYL, 0xd9a936, cx, top + 4, bz, 0, 7.9, .35, 7.9);
      B.add(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0x2f8f5b, cx, top + 4.1, bz, 0, 7.6, 6.2, 7.6);
      B.add(CYL, 0xf3efe6, cx, top + 10.6, bz, 0, 1, 1.2, 1); B.add(SPH, 0xd9a936, cx, top + 11.6, bz, 0, .7, .7, .7);
      for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; box(.9, 2.2, .2, 0x34505f, cx + Math.cos(a) * 7.55, top + 2.2, bz + Math.sin(a) * 7.55, -a + Math.PI / 2); }
      B.add(BOX, 0x2f4656, cx, CURB + 1.6, bz + 8.06, 0, 3, 3, .1);
      solid(cx, bz, 30.6, 16.6);
      sign('HOUSE OF ASSEMBLY', cx, top - .1, bz + 13.4, 0, 11, '#f4f2ec', '#1d4d33');
      for (let k = -1; k <= 1; k++) flag(cx + k * 3, cz + 15.5, 9);
      B.add(CYL, 0xd9d4c7, cx - 12, CURB + .35, cz + 15, 0, 2.6, .7, 2.6); B.add(CYL, 0x7fc4d8, cx - 12, CURB + .66, cz + 15, 0, 2.2, .05, 2.2); circles.push({ x: cx - 12, z: cz + 15, r: 2.7 });
      B.add(CYL, 0xd9d4c7, cx + 12, CURB + .35, cz + 15, 0, 2.6, .7, 2.6); B.add(CYL, 0x7fc4d8, cx + 12, CURB + .66, cz + 15, 0, 2.2, .05, 2.2); circles.push({ x: cx + 12, z: cz + 15, r: 2.7 });
      doors.push({ kind: 'assembly', name: 'House of Assembly', pos: new THREE.Vector3(cx, CURB, bz + 9.4), yaw: 0 });
      sidewalkTrees(bk, 18);
    } else if (type === 'spire') {
      // a tall tower with a ring and a needle
      plate(cx, cz, 40, 40, 0xe2dccd);
      B.add(new THREE.CylinderGeometry(2.4, 4.2, 1, 6), 0xf3f1ea, cx, CURB + 34, cz, 0, 1, 68, 1);
      for (let y = 8; y < 64; y += 9) B.add(new THREE.CylinderGeometry(1, 1, 1, 6), 0x3f6f86, cx, CURB + y, cz, 0, 4.25 - y * .027, 1.2, 4.25 - y * .027);
      B.add(CYL, 0x3f6f86, cx, CURB + 66, cz, 0, 5.5, 3.5, 5.5); B.add(CYL, 0xf3f1ea, cx, CURB + 68, cz, 0, 6, .6, 6); B.add(CYL, 0xf3f1ea, cx, CURB + 64, cz, 0, 6, .6, 6);
      B.add(new THREE.TorusGeometry(8, .35, 6, 24), 0xd9d6cc, cx, CURB + 60, cz, 0, 1, 1, 1, Math.PI / 2);
      B.add(new THREE.ConeGeometry(.6, 22, 6), 0xdedede, cx, CURB + 80, cz);
      // podium wings
      building(cx - 13, cz + 6, 9, 18, 7, 'glass', { trim: 0xf3f1ea, door: [0, 1], name: 'Millennium Tower' }); building(cx + 13, cz + 6, 9, 18, 7, 'glass', { trim: 0xf3f1ea, door: [0, 1], name: 'Tower Gallery' });
      circles.push({ x: cx, z: cz, r: 4.4 });
      for (let i = -2; i <= 2; i++) flag(cx + i * 2.6, cz + 16, 8);
      sidewalkTrees(bk, 18);
    } else if (type === 'homes') {
      [[-10, -10], [10, -10], [-10, 10], [10, 10]].forEach(([dx, dz]) => compound(cx + dx, cz + dz, dx, dz));
      sidewalkTrees(bk, 18);
    } else if (type === 'shops') {
      plate(cx, cz, 26, 26, 0x6a6d71);
      // shop rows facing all four streets
      for (const side of [0, 1, 2, 3]) {
        for (let i = 0; i < 4; i++) {
          const t = -12 + i * 8;
          const [x, z, ry] = side === 0 ? [cx + t, cz - 16.5, Math.PI] : side === 1 ? [cx + 16.5, cz + t, Math.PI / 2] : side === 2 ? [cx - t, cz + 16.5, 0] : [cx - 16.5, cz - t, -Math.PI / 2];
          let nm = shopNames[shopI++ % shopNames.length];
          if (nm[0] === 'Daily Bread Bakery') { if (bakeryBuilt) nm = shopNames[shopI++ % shopNames.length]; bakeryBuilt = true; }
          shop(x, z, ry, nm);
        }
      }
      // parked cars in the yard
      for (let i = 0; i < 6; i++) parked.push({ type: rand() < .2 ? 'suv' : 'sedan', x: cx - 9 + (i % 3) * 9, y: CURB, z: cz - 5 + ((i / 3) | 0) * 10, yaw: (i / 3 | 0) ? 0 : Math.PI });
    } else if (type === 'park') park(bk);
    else if (type === 'market') market(bk);
  }

  function compound(x, z, dx, dz) {
    const wall = pick([0xefe2c4, 0xe9d7b5, 0xf1ece0]), cap = 0x7d6a55, size = 18.5, hs = size / 2, wh = 2.3;
    // gate faces the nearest street
    const gateSide = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'E' : 'W') : (dz > 0 ? 'S' : 'N');
    const seg = (sx, sz, w, d) => { box(w, wh, d, wall, sx, CURB + wh / 2, sz); box(w + .1, .2, d + .1, cap, sx, CURB + wh + .1, sz); solid(sx, sz, w, d); };
    const gate = 4.5;
    for (const s of ['N', 'S', 'E', 'W']) {
      const horiz = s === 'N' || s === 'S', o = (s === 'N' || s === 'W') ? -hs : hs;
      const px = horiz ? x : x + o, pz = horiz ? z + o : z;
      if (s === gateSide) {
        const L = (size - gate) / 2;
        if (horiz) { seg(x - hs + L / 2, pz, L, .3); seg(x + hs - L / 2, pz, L, .3); box(gate, 2, .12, 0x1f5e3a, x, CURB + 1.1, pz); }
        else { seg(px, z - hs + L / 2, .3, L); seg(px, z + hs - L / 2, .3, L); box(.12, 2, gate, 0x1f5e3a, px, CURB + 1.1, z); }
        if (horiz) solid(x, pz, gate, .3); else solid(px, z, .3, gate);
      } else seg(px, pz, horiz ? size : .3, horiz ? .3 : size);
    }
    plate(x, z, size - .4, size - .4, 0xb57a50, CURB + .015);
    // the house
    const hw = range(8, 10), hd = range(7, 8.5), floors = rand() < .6 ? 2 : 1, hh = floors * 3.2, col = pick([0xf2e3c6, 0xf3d9c0, 0xe4ead2, 0xf6f0e4, 0xe8d0b0]);
    const ox = -Math.sign(dx) * 1.5, oz = -Math.sign(dz) * 1.5;
    box(hw, hh, hd, col, x + ox, CURB + hh / 2, z + oz);
    B.add(CONE4, pick([0x8b3a2a, 0x6b4a3a, 0x3f5f7f, 0xa0522d]), x + ox, CURB + hh + 1.25, z + oz, Math.PI / 4, hw * .78, 2.5, hd * .78);
    for (let f = 0; f < floors; f++) for (const s of [-1, 1]) {
      box(1.4, 1.2, .1, 0x34505f, x + ox + s * hw * .25, CURB + 1.7 + f * 3.2, z + oz + hd / 2 + .03);
      box(1.4, 1.2, .1, 0x34505f, x + ox + s * hw * .25, CURB + 1.7 + f * 3.2, z + oz - hd / 2 - .03);
    }
    box(1.2, 2.2, .1, 0x6b4a33, x + ox, CURB + 1.1, z + oz + hd / 2 + .04);
    solid(x + ox, z + oz, hw, hd);
    const hIdx = houses.length, gx = gateSide === 'E' ? x + hs + .4 : gateSide === 'W' ? x - hs - .4 : x, gz = gateSide === 'S' ? z + hs + .4 : gateSide === 'N' ? z - hs - .4 : z;
    const gry = gateSide === 'E' ? Math.PI / 2 : gateSide === 'W' ? -Math.PI / 2 : gateSide === 'S' ? 0 : Math.PI;
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(3.2, .8), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    plaque.position.set(gx, CURB + 2.9, gz); plaque.rotation.y = gry; root.add(plaque);
    box(.1, .9, .1, 0x555555, gx - Math.cos(gry) * 1.4, CURB + 2.5, gz + Math.sin(gry) * 1.4); box(.1, .9, .1, 0x555555, gx + Math.cos(gry) * 1.4, CURB + 2.5, gz - Math.sin(gry) * 1.4);
    houses.push({ idx: hIdx, plaque, gate: new THREE.Vector3(gx + Math.sin(gry) * 1.2, CURB, gz + Math.cos(gry) * 1.2) });
    doors.push({ kind: 'house', house: hIdx, name: 'House ' + (hIdx + 1), pos: new THREE.Vector3(x + ox, CURB, z + oz + hd / 2 + 1), yaw: 0 });
    // water tank on a stand
    const tx = x - ox * 3.5, tz = z + oz * 3.5;
    [[-.7, -.7], [.7, -.7], [-.7, .7], [.7, .7]].forEach(([a, b]) => box(.1, 3.2, .1, 0x555555, tx + a, CURB + 1.6, tz + b));
    box(1.7, .12, 1.7, 0x555555, tx, CURB + 3.2, tz); B.add(CYL, pick([0x1f1f1f, 0x2f5fa0]), tx, CURB + 4, tz, 0, .85, 1.5, .85);
    circles.push({ x: tx, z: tz, r: 1.1 });
    if (rand() < .7) tree(x - ox * 3.2, z - oz * 3.5 + 3, .9 + rand() * .3);
    if (rand() < .5) parked.push({ type: rand() < .4 ? 'suv' : 'sedan', x: x + ox * 2.2, y: CURB, z: z - oz * 3.3, yaw: rand() < .5 ? 0 : Math.PI / 2 });
  }

  function shop(x, z, ry, [name, sub, color]) {
    const g = new THREE.Group(); g.position.set(x, CURB, z); g.rotation.y = ry;
    const wall = pick([0xf1e6cf, 0xe9dcc0, 0xf3efe6, 0xd9e6dd]);
    const local = new Batch();
    local.add(BOX, wall, 0, 2.3, 0, 0, 7.6, 4.6, 5.6);
    local.add(BOX, 0x3a4a52, 0, 1.4, 2.82, 0, 5.4, 2.6, .05);            // shopfront glass
    local.add(BOX, color, 0, 3.1, 3.4, 0, 7.8, .12, 1.4, -.25);          // awning
    local.add(BOX, 0xd9d4c7, 0, 4.75, 0, 0, 8, .3, 6);
    const m = local.build(batchMat); g.add(m);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 1.65), new THREE.MeshLambertMaterial({ map: signTex(name, color, '#ffffff', sub) }));
    s.position.set(0, 4.05, 2.86); g.add(s); root.add(g); g.updateMatrixWorld(true);
    const horiz = Math.abs(Math.sin(ry)) < .5; solid(x, z, horiz ? 7.8 : 5.8, horiz ? 5.8 : 7.8);
    doors.push({ kind: 'shop', name, sub, color, pos: g.localToWorld(new THREE.Vector3(-1.6, 0, 3.6)), yaw: ry });
    if (name === 'Daily Bread Bakery') {
      const vp = g.localToWorld(new THREE.Vector3(1.5, 0, 3.6));
      vendors.push({ pos: vp, yaw: ry, female: false, wave: true });
      quest.push({ id: 'bread', label: 'Bread', vendor: 'Baker Musa', line: 'Fresh agege bread, still warm!', pos: g.localToWorld(new THREE.Vector3(0, 0, 5.2)) });
    }
  }

  function park(bk) {
    const { cx, cz } = bk;
    plate(cx, cz, 44, 44, 0x7fb062, CURB + .012);
    plate(cx, cz, 44, 3, 0xd8cdb6, CURB + .02); plate(cx, cz, 3, 44, 0xd8cdb6, CURB + .02);
    for (let i = 0; i < 26; i++) { const x = cx + range(-19, 19), z = cz + range(-19, 19); if (Math.abs(x - cx) < 4 || Math.abs(z - cz) < 4) continue; rand() < .3 ? (palms.push({ x, z, y: CURB, s: .9 + rand() * .4 }), circles.push({ x, z, r: .45 })) : tree(x, z, 1 + rand() * .5); }
    B.add(CYL, 0xd9d4c7, cx, CURB + .4, cz, 0, 4, .8, 4); B.add(CYL, 0x7fc4d8, cx, CURB + .76, cz, 0, 3.6, .05, 3.6); B.add(CYL6, 0xd9d4c7, cx, CURB + 1.5, cz, 0, .35, 2.2, .35); B.add(SPH, 0x9ed6e6, cx, CURB + 2.7, cz, 0, .5, .3, .5);
    circles.push({ x: cx, z: cz, r: 4.1 });
    for (const [dx, dz, r] of [[6, 2.2, 0], [-6, 2.2, 0], [2.2, 6, Math.PI / 2], [2.2, -6, Math.PI / 2]]) { box(2.2, .1, .6, 0x8a6a4e, cx + dx, CURB + .55, cz + dz, r); box(2.2, .5, .1, 0x8a6a4e, cx + dx + (r ? .3 : 0), CURB + .85, cz + dz + (r ? 0 : .3), r); [-.5, .5].forEach(o => seats.push({ x: cx + dx + (r ? -.05 : o), z: cz + dz + (r ? o : -.05), y: CURB, yaw: r ? -Math.PI / 2 : Math.PI })); }
    // suya stand on the corner
    const sx = cx - 17, sz = cz + 17.5;
    box(3, 1, 1.2, 0x3a3a3a, sx, CURB + .5, sz); box(2.8, .06, 1, 0x8a2f1f, sx, CURB + 1.05, sz);
    for (let i = 0; i < 7; i++) box(.06, .06, .9, 0x6b3a22, sx - 1.1 + i * .36, CURB + 1.1, sz);
    [[-1.6, -.7], [1.6, -.7], [-1.6, .7], [1.6, .7]].forEach(([a, b]) => box(.08, 2.6, .08, 0x6b4a33, sx + a, CURB + 1.3, sz + b));
    B.add(new THREE.ConeGeometry(2.6, .9, 4), 0xc9472f, sx, CURB + 2.9, sz, Math.PI / 4, 1.1, 1, .7);
    solid(sx, sz, 3.2, 1.4);
    smokes.push(new THREE.Vector3(sx, CURB + 1.2, sz));
    vendors.push({ pos: new THREE.Vector3(sx, CURB, sz - 1.3), yaw: Math.PI, female: false, wave: false, suya: true, goods: 'suya', stand: new THREE.Vector3(sx, CURB, sz - 2.6) });
    sign('Mallam Sani Suya', sx, CURB + 3.6, sz + .8, 0, 3.6, '#8a2f1f', '#ffd166');
    quest.push({ id: 'suya', label: 'Suya', vendor: 'Mallam Sani', line: 'Hot suya, extra pepper. You go enjoy am!', pos: new THREE.Vector3(sx, CURB, sz - 2.6) });
  }

  function market(bk) {
    const { cx, cz } = bk;
    plate(cx, cz, 44, 44, 0xb98a5c, CURB + .012);
    const goods = {
      tomatoes: (b, x, y, z) => { for (let i = 0; i < 3; i++) for (let k = 0; k < 6 - i * 2; k++) b.add(SPH, 0xd8352a, x - .55 + k * .22 + i * .22, y + .12 + i * .17, z + (rand() - .5) * .3, 0, .11, .1, .11); },
      pepper: (b, x, y, z) => { for (let k = 0; k < 14; k++) b.add(new THREE.ConeGeometry(.05, .2, 4), pick([0xe8452c, 0xf08a24, 0xb3202a]), x + (rand() - .5) * 1.2, y + .08, z + (rand() - .5) * .5, rand() * 6, 1, 1, 1, Math.PI / 2); },
      yams: (b, x, y, z) => { for (let k = 0; k < 6; k++) b.add(new THREE.CapsuleGeometry(.11, .5, 2, 6), 0x7a5536, x - .6 + k * .24, y + .12 + (k % 2) * .1, z, .2, 1, 1, 1, Math.PI / 2); },
      plantain: (b, x, y, z) => { for (let k = 0; k < 7; k++) b.add(new THREE.CapsuleGeometry(.06, .38, 2, 5), pick([0x9bb03a, 0xd8c13a, 0xb6b83a]), x - .6 + k * .19, y + .1, z, .3, 1, 1, 1, Math.PI / 2 - .3); },
      onions: (b, x, y, z) => { for (let k = 0; k < 12; k++) b.add(SPH, 0x8a3b4a, x + (rand() - .5) * 1.1, y + .1, z + (rand() - .5) * .5, 0, .1, .09, .1); },
      oranges: (b, x, y, z) => { for (let k = 0; k < 12; k++) b.add(SPH, 0xf09a24, x + (rand() - .5) * 1.1, y + .1 + (k > 8 ? .15 : 0), z + (rand() - .5) * .5, 0, .1, .1, .1); },
      basins: (b, x, y, z) => { for (let k = 0; k < 3; k++) b.add(new THREE.CylinderGeometry(.35, .25, .25, 10), pick([0x2e7fd0, 0xe8452c, 0x1f9a5a, 0xf2c230]), x - .7 + k * .7, y + .13, z); },
      fabric: (b, x, y, z) => { for (let k = 0; k < 5; k++) b.add(BOX, pick([0x1f6fb2, 0xf2b632, 0xe8452c, 0x7b2d8e, 0x0f7a55, 0xe06d1f]), x - .6 + (k % 3) * .55, y + .08 + (k > 2 ? .16 : 0), z, 0, .5, .14, .6); },
    };
    const kinds = Object.keys(goods);
    const rows = [-15, -5, 5, 15], cols = [-15, -7.5, 0, 7.5, 15];
    const questStalls = { '1,1': 'tomatoes', '2,3': 'yams', '3,0': 'plantain' };
    const qInfo = {
      tomatoes: { label: 'Tomatoes', vendor: 'Mama Ngozi', line: 'Fine fresh tomatoes! I add one for you.' },
      yams: { label: 'Yam', vendor: 'Baba Femi', line: 'Big yam from Benue. E sweet well well!' },
      plantain: { label: 'Plantain', vendor: 'Aunty Hauwa', line: 'Ripe plantain for dodo. Enjoy!' },
    };
    rows.forEach((rz, ri) => cols.forEach((rx, ci) => {
      const x = cx + rx, z = cz + rz - 1.5, q = questStalls[ri + ',' + ci], kind = q || kinds[(ri * 5 + ci * 3) % kinds.length];
      // table, posts and roof
      box(5, .1, 1.6, 0x8a6a4e, x, CURB + .9, z); box(4.8, .8, 1.4, 0x6e543b, x, CURB + .45, z);
      [[-2.3, -.9], [2.3, -.9], [-2.3, 1.1], [2.3, 1.1]].forEach(([a, b]) => box(.1, 2.8, .1, 0x5e4a36, x + a, CURB + 1.4, z + b));
      if ((ri + ci) % 3 === 0) { // big umbrella
        B.add(new THREE.ConeGeometry(3, .8, 8), pick([0xe8452c, 0x2e5fa8, 0xf2c230, 0x1f9a5a]), x, CURB + 3.1, z + .1);
      } else { // corrugated zinc roof
        const zinc = pick([0xa9aeb2, 0x9a7a5a, 0xb8bcbe, 0x8c6a4a]);
        box(5.6, .08, 2.8, zinc, x, CURB + 2.85, z + .1, 0); for (let k = -2.6; k <= 2.6; k += .4) box(.06, .06, 2.8, zinc - 0x101010, x + k, CURB + 2.92, z + .1);
      }
      goods[kind](B, x - 1.1, CURB + .95, z - .1); goods[kind](B, x + 1.1, CURB + .95, z - .1);
      solid(x, z + .1, 5, 2.2);
      // vendor behind the table, facing the aisle (+z)
      vendors.push({ pos: new THREE.Vector3(q ? x : x + (rand() - .5) * 1.5, CURB, z - 1.5), yaw: 0, female: rand() < .6, wave: rand() < .3, goods: kind, stand: new THREE.Vector3(x, CURB, z + 2.2) });
      if (q) quest.push({ id: q, ...qInfo[q], pos: new THREE.Vector3(x, CURB, z + 2.2) });
    }));
    // aisles for shoppers
    rows.forEach(rz => marketPaths.push([[cx - 20, cz + rz + 3.2], [cx + 20, cz + rz + 3.2]]));
    marketPaths.push([[cx - 20, cz - 20], [cx - 20, cz + 20]], [[cx + 20, cz - 20], [cx + 20, cz + 20]]);
    // entrance arch facing the road to the east
    const ax = cx + 21.5;
    box(.8, 6, .8, 0x1f7a5c, ax, CURB + 3, cz - 5); box(.8, 6, .8, 0x1f7a5c, ax, CURB + 3, cz + 5); box(.9, 1.6, 11, 0xf2c230, ax, CURB + 6.4, cz);
    circles.push({ x: ax, z: cz - 5, r: .6 }, { x: ax, z: cz + 5, r: .6 });
    sign('UNITY MARKET', ax + .5, CURB + 6.4, cz, Math.PI / 2, 9.6, '#f2c230', '#1d3b2a', 'Fresh food and fabric');
    sign('UNITY MARKET', ax - .5, CURB + 6.4, cz, -Math.PI / 2, 9.6, '#f2c230', '#1d3b2a', 'Fresh food and fabric');
  }


  /* ---------- billboards and bus stops ---------- */
  function billboard(x, z, ry, sign) {
    box(.4, 9, .4, 0x7d8085, x - 3 * Math.cos(ry), 4.5, z + 3 * Math.sin(ry)); box(.4, 9, .4, 0x7d8085, x + 3 * Math.cos(ry), 4.5, z - 3 * Math.sin(ry));
    B.add(BOX, 0x4a4d52, x, 10.5, z, ry, 12.6, 3.5, .3);
    circles.push({ x: x - 3 * Math.cos(ry), z: z + 3 * Math.sin(ry), r: .4 }, { x: x + 3 * Math.cos(ry), z: z - 3 * Math.sin(ry), r: .4 });
    if (sign) { const g = sign(); g.position.set(x, 10.5, z); g.rotation.y = ry; return; }
    adSlot('wide', 12, 3, x + Math.sin(ry) * .17, 10.5, z + Math.cos(ry) * .17, ry, true);
    adSlot('wide', 12, 3, x - Math.sin(ry) * .17, 10.5, z - Math.cos(ry) * .17, ry + Math.PI, true);
  }
  billboard(-150, -40, Math.PI / 2, () => sign('WELCOME TO ABUJA', 0, 0, 0, 0, 12, '#1d8a4a', '#ffffff', 'Centre of Unity'));
  [[150, 30, -Math.PI / 2], [40, 150, Math.PI], [-150, 70, Math.PI / 2], [150, -80, -Math.PI / 2], [-60, 150, Math.PI], [90, -150, 0], [-100, -150, 0]].forEach(([x, z, r]) => billboard(x, z, r));
  function busStop(x, z, ry) {
    const g = new Batch(); g.add(BOX, 0x2f5fa0, 0, 2.6, 0, 0, 4, .12, 1.6); [[-1.8, -.6], [1.8, -.6]].forEach(([a, b]) => g.add(BOX, 0x8e9196, a, 1.3, b, 0, .1, 2.6, .1));
    g.add(BOX, 0x8a6a4e, 0, .5, -.4, 0, 3.4, .1, .5); g.add(BOX, 0x9fc3d8, 0, 1.5, -.75, 0, 3.6, 1.8, .04);
    const m = g.build(batchMat); m.position.set(x, CURB, z); m.rotation.y = ry; root.add(m); solid(x, z, Math.abs(Math.sin(ry)) > .5 ? 1.8 : 4.2, Math.abs(Math.sin(ry)) > .5 ? 4.2 : 1.8);
    sign('BUS STOP', x, CURB + 3.2, z, ry, 2.4, '#2f5fa0', '#ffffff');
    adSlot('half', 3.4, 1.7, x - Math.sin(ry) * .8, CURB + 1.5, z - Math.cos(ry) * .8, ry);
  }

  /* ---------- trees, palms, Aso Rock, hills ---------- */
  for (let i = 0; i < 700; i++) {
    const a = rand() * Math.PI * 2, d = range(150, 330), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.max(Math.abs(x), Math.abs(z)) < 146 || padFactor(x, z) < .95) continue;
    if (noise(x * .015, z * .015) < -.25) continue;
    trees.push({ x, z, y: terrainH(x, z) - .2, s: .9 + rand() * .8, v: (rand() * 3) | 0 });
  }
  {
    const parts = [blob(1, 0, 0, 0, 3, .32), blob(.7, .8, -.15, .3, 2, .3), blob(.55, -.75, -.2, -.2, 2, .3)];
    const g = parts.length > 1 ? mergeTextured(parts.map(p => { for (const k of Object.keys(p.attributes)) if (k !== 'position') p.deleteAttribute(k); return p; })) : parts[0];
    g.scale(95, 62, 70);
    const ng = g.index ? g.toNonIndexed() : g; ng.computeVertexNormals();
    const pa = ng.attributes.position.array, na = ng.attributes.normal.array, cols = new Float32Array(pa.length), c = new THREE.Color();
    for (let i = 0; i < pa.length; i += 9) {
      const up = na[i + 1], n = noise(pa[i] * .03, pa[i + 2] * .03);
      c.setHex(up > .72 && n > -.2 ? 0x6f8d52 : pick([0xb6a184, 0xa99377, 0xbfac90])); c.offsetHSL(0, 0, (rand() - .5) * .04);
      for (let v = 0; v < 9; v += 3) { cols[i + v] = c.r; cols[i + v + 1] = c.g; cols[i + v + 2] = c.b; }
    }
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const rock = new THREE.Mesh(ng, new THREE.MeshLambertMaterial({ vertexColors: true })); rock.position.set(150, 8, -360); root.add(rock);
  }

  /* ---------- finish batched meshes ---------- */
  const styleMat = { glass: T.glass, office: T.office, terra: T.terra, white: T.white };
  for (const k in TX) if (TX[k].length) { const m = new THREE.Mesh(mergeTextured(TX[k]), new THREE.MeshLambertMaterial({ map: styleMat[k] })); m.castShadow = m.receiveShadow = true; root.add(m); }
  busStop(-40, 9.8, Math.PI); busStop(73, -40, Math.PI / 2); busStop(-120, 73, 0);
  root.add(B.build(batchMat));

  /* ---------- quest marker for bread: make sure a bakery was built ---------- */
  return { root, doors, houses, seats, parked, adSlots, boxes, circles, vendors, quest, flags, smokes, trees, palms, walkLoops, marketPaths, blocks, groundY };
}

export const batchMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const adBlank = new THREE.MeshLambertMaterial({ color: 0xe9e4d8 });

/* ---------- height of the walkable ground ---------- */
function inBlock(x, z) {
  const ix = Math.floor(x / S), iz = Math.floor(z / S);
  if (ix < -N || ix >= N || iz < -N || iz >= N) return false;
  const lx = x - ix * S, lz = z - iz * S;
  if (lx < HALF || lx > S - HALF || lz < HALF || lz > S - HALF) return false;
  if (isCenter(ix, iz) && Math.hypot(x, z) < RB_CUT) return false;
  return true;
}
function onMedian(x, z) {
  if (Math.abs(x) > EDGE + 1 || Math.abs(z) > EDGE + 1 || Math.hypot(x, z) < RB_CUT + 4) return false;
  const kx = Math.round(x / S), kz = Math.round(z / S);
  const nearNodeZ = Math.abs(z - Math.round(z / S) * S) < HALF + 4, nearNodeX = Math.abs(x - Math.round(x / S) * S) < HALF + 4;
  return (Math.abs(x - kx * S) < 1.1 && !nearNodeZ) || (Math.abs(z - kz * S) < 1.1 && !nearNodeX);
}
export function groundY(x, z) {
  if (Math.hypot(x, z) < RB_ISLAND) return .37;
  if (inBlock(x, z)) return CURB;
  if (onMedian(x, z)) return .22;
  if (Math.max(Math.abs(x), Math.abs(z)) > EDGE + HALF) return terrainH(x, z);
  return 0;
}

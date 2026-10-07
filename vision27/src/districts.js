import * as THREE from 'three';
import { Batch, canvasTex, rand, pick, range, blob } from './util.js';
import { ROADS, segDist } from './world.js';

// points where two named roads meet, with the half-width of the widest road there
const JUNCTIONS = (() => { const m = new Map(); ROADS.forEach(r => r.pts.forEach(([x, z]) => { const k = x + ',' + z, j = m.get(k) || { x, z, n: 0, r: 0 }; j.n++; j.r = Math.max(j.r, r.w / 2 + 1); m.set(k, j); })); return [...m.values()].filter(j => j.n > 1); })();

/* The new parts of town around the old centre:
   Asokoro with Aso Rock Villa (President) and the VP Residence, Maitama Estate (sponsors and
   senators), Gwarinpa Estate (citizens), Nyanya (the street, its motor park and compounds),
   Eagle Square with the Area Council and INEC, and Jabi with the mall, cinema and stadium.
   Houses here join the same claim system as the old city houses. */
const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(1, 1, 1, 14), CONE4 = new THREE.ConeGeometry(1, 1, 4), SPH = new THREE.IcosahedronGeometry(1, 1);
const HALFPI = Math.PI / 2;

function labelMat(text, bg, fg, sub) {
  return new THREE.MeshLambertMaterial({ map: canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${sub ? 46 : 56}px "Fredoka", "Segoe UI", system-ui, sans-serif`; g.fillText(text, w / 2, sub ? 48 : h / 2, w - 30);
    if (sub) { g.font = '500 28px "Fredoka", system-ui, sans-serif'; g.fillText(sub, w / 2, 98, w - 30); }
  }, false) });
}

export function buildDistricts(scene, city, out) {
  const root = new THREE.Group(); scene.add(root);
  const B = new Batch(), boxes = [], circles = [], seats = [], parked = [], guards = [], pois = [], spots = {}, pitch = [];
  const box = (w, h, d, c, x, y, z, ry = 0) => B.add(BOX, c, x, y, z, ry, w, h, d);
  const cyl = (r, h, c, x, y, z) => B.add(CYL, c, x, y, z, 0, r, h, r);
  const solid = (x, z, w, d, h = 8) => boxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
  const plate = (x, z, w, d, c, y = .02) => box(w, .04, d, c, x, y, z);
  const sign = (text, bg, fg, x, y, z, ry, w = 8, sub) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), labelMat(text, bg, fg, sub)); m.position.set(x, y, z); m.rotation.y = ry; root.add(m); const b = m.clone(); b.rotation.y = ry + Math.PI; b.position.x -= Math.sin(ry) * .02; b.position.z -= Math.cos(ry) * .02; root.add(b); };
  const tree = (x, z, s = 1) => { box(.35 * s, 2.4 * s, .35 * s, 0x6b4a33, x, 1.2 * s, z); B.add(SPH, pick([0x4e9a55, 0x3f8a4f, 0x5aa65e]), x, 3 * s, z, rand() * 6, 1.6 * s, 1.4 * s, 1.6 * s); circles.push({ x, z, r: .4 * s }); };
  const palm = (x, z) => { cyl(.22, 6, 0x8a6a4e, x, 3, z); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; box(.3, .06, 3.2, 0x3f8a4f, x + Math.sin(a) * 1.4, 6, z + Math.cos(a) * 1.4, a); } circles.push({ x, z, r: .35 }); };
  const flag = (x, z, h = 9) => { cyl(.07, h, 0xdedede, x, h / 2, z); box(.02, .9, .55, 0x1d8a4a, x, h - .5, z + .3); box(.02, .9, .55, 0xffffff, x, h - .5, z + .85); box(.02, .9, .55, 0x1d8a4a, x, h - .5, z + 1.4); };
  const poi = (name, cat, x, z, extra = {}) => { const p = { name, cat, x, z, ...extra }; pois.push(p); return p; };
  const seat = (x, z, yaw, y = 0) => seats.push({ x, z, y, yaw });
  // local -> world for something facing `yaw` (local +z points along yaw)
  const P = (x, z, yaw, lx, lz) => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
  const quarter = yaw => Math.abs(Math.sin(yaw)) > .5;   // facing ±x: swap w/d for colliders

  /* ---------- roads ---------- */
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x5a5d62, polygonOffset: true, polygonOffsetFactor: -1 });
  ROADS.filter(r => r.built).forEach(r => {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], len = Math.hypot(bx - ax, bz - az), mx = (ax + bx) / 2, mz = (az + bz) / 2, along = Math.abs(bx - ax) > Math.abs(bz - az);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(along ? len + r.w : r.w, along ? r.w : len + r.w).rotateX(-HALFPI), roadMat); m.position.set(mx, .015, mz); m.receiveShadow = true; root.add(m);
      for (let s = 3; s < len - 3; s += 7) { const t = s / len; box(along ? 3 : .16, .01, along ? .16 : 3, 0xf2f2ee, ax + (bx - ax) * t, .03, az + (bz - az) * t); }
      // kerbs (broken at junctions) and lamps on both sides
      const gaps = JUNCTIONS.map(j => { const sd = segDist(j.x, j.z, ax, az, bx, bz); return sd.d < 1 ? { s: sd.t * len, r: j.r } : null; }).filter(Boolean);
      [-1, 1].forEach(sd => {
        const nx = along ? 0 : sd, nz = along ? sd : 0, off = r.w / 2 + .3;
        let s0 = 0; const cuts = gaps.map(gp => [gp.s - gp.r, gp.s + gp.r]).sort((p, q) => p[0] - q[0]);
        const kerb = (u0, u1) => { if (u1 - u0 < .5) return; const um = (u0 + u1) / 2, t = um / len; box(along ? u1 - u0 : .3, .2, along ? .3 : u1 - u0, sd > 0 ? 0xf2c230 : 0x2b2b2b, ax + (bx - ax) * t + nx * off, .1, az + (bz - az) * t + nz * off); };
        cuts.forEach(([c0, c1]) => { kerb(s0, Math.min(len, c0)); s0 = Math.max(s0, c1); }); kerb(s0, len);
        for (let u = 8 + (sd > 0 ? 9 : 0); u < len - 4; u += 18) {
          if (gaps.some(gp => Math.abs(u - gp.s) < gp.r + 2)) continue;
          const t = u / len, x = ax + (bx - ax) * t + nx * (off + 1), z = az + (bz - az) * t + nz * (off + 1);
          box(.16, 6.5, .16, 0x8e9196, x, 3.25, z); box(along ? .12 : 1.5, .1, along ? 1.5 : .12, 0x8e9196, x - nx * .7, 6.5, z - nz * .7); box(.45, .12, .45, rand() < .12 ? 0x3a3a3a : 0xf5f0de, x - nx * 1.4, 6.42, z - nz * 1.4); circles.push({ x, z, r: .3 });
        }
      });
    }
  });
  // green street-name boards at the start and end of every named road
  const named = new Set();
  ROADS.forEach(r => [r.pts[0], r.pts[r.pts.length - 1]].forEach(([x, z], end) => {
    const key = r.name + x + ',' + z; if (named.has(key)) return; named.add(key);
    const [nx, nz] = end ? r.pts[r.pts.length - 2] : r.pts[1], along = Math.abs(nx - x) > Math.abs(nz - z), dir = along ? Math.sign(nx - x) : Math.sign(nz - z);
    const off = r.w / 2 + 2.2, sx = x + (along ? dir * 6 : off), sz = z + (along ? off : dir * 6);
    if (Math.max(Math.abs(sx), Math.abs(sz)) < 140 && Math.abs(Math.abs(sx) - 128) > 20 && Math.abs(Math.abs(sz) - 128) > 20 && !(Math.abs(sx) < 30 && Math.abs(sz) < 30)) return;
    box(.12, 3.4, .12, 0x6d7075, sx, 1.7, sz); sign(r.name, '#1d6e45', '#ffffff', sx, 3.6, sz, along ? 0 : HALFPI, 3.4); circles.push({ x: sx, z: sz, r: .2 });
  }));

  /* ---------- a public building with a door ---------- */
  function building(x, z, w, d, h, wall, roof, face, door, opts = {}) {
    box(w, h, d, wall, x, h / 2, z); box(w + .5, .5, d + .5, roof, x, h + .25, z); box(w + .7, .9, d + .7, opts.base ?? 0x9a8f80, x, .45, z);
    const fw = quarter(face) ? d : w, fd = quarter(face) ? w : d;
    const rows = Math.max(1, (h / 3.4) | 0);
    for (let f = 0; f < rows; f++) for (let k = -2; k <= 2; k++) { if (f === 0 && Math.abs(k) < 1) continue; const [wx, wz] = P(x, z, face, k * fw / 5.5, fd / 2 + .03); box(fw / 7, 1.3, .08, 0x34505f, wx, 1.9 + f * 3.3, wz, face); }
    const [dx, dz] = P(x, z, face, 0, fd / 2 + .06); box(2.6, 2.7, .1, 0x2f4656, dx, 1.35, dz, face);
    if (opts.portico) { for (const k of [-1.5, -.5, .5, 1.5]) { const [cx, cz] = P(x, z, face, k * 2.4, fd / 2 + 2.4); cyl(.32, h * .8, 0xf6f2ea, cx, h * .4, cz); circles.push({ x: cx, z: cz, r: .35 }); } const [px, pz] = P(x, z, face, 0, fd / 2 + 2); box(quarter(face) ? 3.6 : 10.5, .4, quarter(face) ? 10.5 : 3.6, 0xf3efe6, px, h * .8 + .2, pz); }
    solid(x, z, w + .7, d + .7, h);
    if (opts.sign) { const [sx, sz] = P(x, z, face, 0, fd / 2 + .12); sign(opts.sign, opts.signBg || '#16213a', opts.signFg || '#ffffff', sx, Math.min(h - .8, 4.4), sz, face, Math.min(fw * .7, 10), opts.sub); }
    if (door) { const [px, pz] = P(x, z, face, 0, fd / 2 + 1.2); const dd = { name: opts.name || opts.sign, ...door, pos: new THREE.Vector3(px, 0, pz), yaw: face }; city.doors.push(dd); poi(dd.name, opts.cat || 'office', px, pz, { door: dd }); return dd; }
  }

  /* ---------- a claimable home on a walled lot facing `face` ---------- */
  function lot(x, z, face, style, estate, price = 0) {
    const big = style === 'mansion', sz = big ? 30 : style === 'yard' ? 24 : 20, hs = sz / 2, wh = big ? 2.8 : 2.2;
    const wall = big ? 0xf4efe6 : style === 'yard' ? 0xd9c7a5 : pick([0xefe2c4, 0xe9d7b5, 0xf1ece0]);
    // walls with a gate on the front side
    const seg = (lx, lz, lw, ld) => { const [wx, wz] = P(x, z, face, lx, lz), q = quarter(face); box(q ? ld : lw, wh, q ? lw : ld, wall, wx, wh / 2, wz); box((q ? ld : lw) + .1, .2, (q ? lw : ld) + .1, 0x7d6a55, wx, wh + .1, wz); solid(wx, wz, q ? ld : lw, q ? lw : ld, wh); };
    const gate = 5, L = (sz - gate) / 2;
    seg(0, -hs, sz, .3); seg(-hs, 0, .3, sz); seg(hs, 0, .3, sz); seg(-hs + L / 2, hs, L, .3); seg(hs - L / 2, hs, L, .3);
    const [gx, gz] = P(x, z, face, 0, hs), gq = quarter(face);
    box(gq ? .12 : gate, .5, gq ? gate : .12, big ? 0x1b1b1b : 0x1f5e3a, gx, 2.1, gz); // open gate: just the top bar
    plate(x, z, sz - .4, sz - .4, big ? 0xcfc8bb : 0xb57a50, .025);
    // the house
    const hw = big ? 16 : style === 'yard' ? 15 : range(9, 10.5), hd = big ? 10 : style === 'yard' ? 6 : range(7, 8.5), floors = big ? 2 : style === 'yard' ? 1 : (rand() < .5 ? 2 : 1), hh = floors * 3.2;
    const col = big ? 0xf7f4ee : style === 'yard' ? 0xe0cba6 : pick([0xf2e3c6, 0xf3d9c0, 0xe4ead2, 0xf6f0e4]);
    const [hx, hz] = P(x, z, face, 0, -2), q = quarter(face);
    box(q ? hd : hw, hh, q ? hw : hd, col, hx, hh / 2, hz);
    if (style === 'yard') box(q ? hd + 1.6 : hw + .6, .2, q ? hw + .6 : hd + 1.6, 0x9aa1a6, hx, hh + .1, hz); // flat zinc
    else B.add(CONE4, big ? 0x2f6f4f : pick([0x8b3a2a, 0x6b4a3a, 0x3f5f7f]), hx, hh + (big ? 1.6 : 1.25), hz, Math.PI / 4 + face, (q ? hd : hw) * .78, big ? 3.2 : 2.5, (q ? hw : hd) * .78);
    for (let f = 0; f < floors; f++) for (const s of [-1, 1]) { const [wx, wz] = P(hx, hz, face, s * hw * .3, hd / 2 + .03); box(1.5, 1.2, .1, 0x34505f, wx, 1.7 + f * 3.2, wz, face); }
    if (style === 'yard') for (const s of [-1, 1]) { const [wx, wz] = P(hx, hz, face, s * 4.5, hd / 2 + .04); box(1, 2.1, .1, 0x6b4a33, wx, 1.05, wz, face); } // more doors: face-me-I-face-you
    const [dx, dz] = P(hx, hz, face, 0, hd / 2 + .05); box(1.3, 2.3, .1, big ? 0x3a2a1c : 0x6b4a33, dx, 1.15, dz, face);
    if (big) { for (const s of [-1, 1]) { const [cx, cz] = P(hx, hz, face, s * 2, hd / 2 + 1.6); cyl(.25, 6.2, 0xffffff, cx, 3.1, cz); circles.push({ x: cx, z: cz, r: .3 }); } const [px, pz] = P(hx, hz, face, 0, hd / 2 + 1.4); box(q ? 3 : 5.4, .3, q ? 5.4 : 3, 0xf3efe6, px, 6.3, pz);
      const [wx, wz] = P(x, z, face, 8, 9); box(q ? 5 : 7, .1, q ? 7 : 5, 0x4fb3d9, wx, .06, wz); }
    solid(hx, hz, q ? hd : hw, q ? hw : hd, hh);
    // plaque at the gate
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(3.2, .8), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const [px, pz] = P(x, z, face, 0, hs + .45); plaque.position.set(px, 2.9, pz); plaque.rotation.y = face; root.add(plaque);
    const hIdx = city.houses.length, [ggx, ggz] = P(x, z, face, 0, hs + 1.6), [ddx, ddz] = P(hx, hz, face, 0, hd / 2 + 1);
    city.houses.push({ idx: hIdx, plaque, gate: new THREE.Vector3(ggx, 0, ggz), price, estate, style });
    const door = { kind: 'house', house: hIdx, name: `${estate} House ${hIdx + 1}`, pos: new THREE.Vector3(ddx, 0, ddz), yaw: face };
    city.doors.push(door); poi(`${estate} · House ${hIdx + 1}`, 'home', ggx, ggz, { house: hIdx });
    if (big) parked.push({ type: 'suv', x: P(x, z, face, -8, 6)[0], y: 0, z: P(x, z, face, -8, 6)[1], yaw: face + HALFPI });
    else if (rand() < .5) parked.push({ type: rand() < .3 ? 'suv' : 'sedan', x: P(x, z, face, -6, 6)[0], y: 0, z: P(x, z, face, -6, 6)[1], yaw: face });
    const [tx, tz] = P(x, z, face, hs - 3, -hs + 3); tree(tx, tz, big ? 1.1 : .9);
    return { gate: [gx, gz] };
  }

  /* ================= ASOKORO: Aso Rock Villa and the VP Residence ================= */
  {
    // the rock itself, rising behind the villa
    const rocks = [[372, -236, 34, 58], [338, -246, 26, 40], [408, -226, 22, 34], [392, -262, 30, 48], [352, -270, 24, 30]];
    rocks.forEach(([x, z, r, h]) => B.add(blob(1, 0, 0, 0, 2, .18), 0x8c7a66, x, h * .42 - 4, z, rand() * 6, r, h * .5, r * .9));
    sign('ASO ROCK', '#f4f2ec', '#1d4d33', 312, 3.2, -54.5, 0, 6, 'Three Arms Zone'); box(.15, 3.2, .15, 0x6d7075, 309.2, 1.6, -54.5); box(.15, 3.2, .15, 0x6d7075, 314.8, 1.6, -54.5);
    // perimeter wall with a guarded gate on Aso Villa Drive
    const x0 = 250, x1 = 410, z0 = -192, z1 = -86, wc = 0xf1ece0;
    const wallSeg = (x, z, w, d) => { box(w, 3, d, wc, x, 1.5, z); box(w + .1, .25, d + .1, 0x1d6e45, x, 3.1, z); solid(x, z, w, d, 3); };
    wallSeg((x0 + 294) / 2, z1, 294 - x0, .5); wallSeg((306 + x1) / 2, z1, x1 - 306, .5); wallSeg((x0 + x1) / 2, z0, x1 - x0, .5); wallSeg(x0, (z0 + z1) / 2, .5, z1 - z0); wallSeg(x1, (z0 + z1) / 2, .5, z1 - z0);
    box(4, 3.4, 4, 0xe8e2d6, 291, 1.7, z1 + 3.5); box(4.6, .4, 4.6, 0x1d6e45, 291, 3.6, z1 + 3.5); solid(291, z1 + 3.5, 4, 4, 3.4);
    box(.18, .18, 10, 0xc9472f, 300, 1.1, z1, HALFPI); box(.5, 1.2, .5, 0x333333, 295, .6, z1); // boom gate
    [[296, z1 + 2, Math.PI], [304, z1 + 2, Math.PI], [296, z1 - 2.5, 0], [304, z1 - 2.5, 0]].forEach(([x, z, yaw]) => guards.push({ x, z, yaw }));
    spots.villaGate = { x: 300, z: z1 + 1 };
    plate(330, -140, 150, 100, 0x8fbf6a, .02); // lawns
    for (let z = -96; z > -150; z -= 9) { palm(294, z); palm(306, z); }
    // Presidential Villa: long white palace, green roofs, central dome and portico
    const vx = 330, vz = -168;
    box(56, 10, 16, 0xf8f6f0, vx, 5, vz); box(57, .6, 17, 0xd9d4c7, vx, 10.3, vz);
    B.add(CONE4, 0x2f7f55, vx - 18, 12.2, vz, Math.PI / 4, 15, 3.4, 9); B.add(CONE4, 0x2f7f55, vx + 18, 12.2, vz, Math.PI / 4, 15, 3.4, 9);
    cyl(7, 4, 0xf8f6f0, vx, 12.5, vz); B.add(new THREE.SphereGeometry(1, 18, 9, 0, Math.PI * 2, 0, HALFPI), 0x2f8f5b, vx, 14.4, vz, 0, 7.2, 6, 7.2); B.add(SPH, 0xd9a936, vx, 21, vz, 0, .6, .6, .6);
    for (let k = -5; k <= 5; k++) { if (k === 0) continue; for (const f of [0, 1]) box(2.2, 1.6, .1, 0x2f4656, vx + k * 4.5, 2.6 + f * 4.4, vz + 8.05); }
    for (let k = 0; k < 8; k++) { const x = vx - 10.5 + k * 3; cyl(.45, 9, 0xffffff, x, 4.5, vz + 12); circles.push({ x, z: vz + 12, r: .5 }); }
    box(24, .8, 6, 0xf3efe6, vx, 9.4, vz + 11); box(26, .3, 8, 0xd9d4c7, vx, .15, vz + 11.5);
    solid(vx, vz, 57, 17, 10);
    sign('PRESIDENTIAL VILLA', '#f8f6f0', '#1d4d33', vx, 8.3, vz + 14.05, 0, 10);
    for (let k = -2; k <= 2; k++) flag(vx + k * 4, vz + 22, 10);
    const pres = { kind: 'villa', role: 'president', name: 'Presidential Villa', pos: new THREE.Vector3(vx, 0, vz + 9.4), yaw: 0 }; city.doors.push(pres); box(3, 3.2, .1, 0x2f4656, vx, 1.6, vz + 8.08);
    poi('Presidential Villa (Aso Rock)', 'government', vx, vz + 16, { door: pres });
    // VP Residence
    const px = 272, pz = -130;
    box(22, 7, 13, 0xf8f6f0, px, 3.5, pz); B.add(CONE4, 0x2f7f55, px, 8.6, pz, Math.PI / 4, 17, 3.2, 10.5);
    for (const s of [-1, 1]) { cyl(.3, 6.2, 0xffffff, px + 9, 3.1, pz + s * 2); circles.push({ x: px + 9, z: pz + s * 2, r: .35 }); }
    box(3.2, .3, 6, 0xf3efe6, px + 9.5, 6.3, pz); solid(px, pz, 22, 13, 7);
    box(.1, 2.8, 2.6, 0x2f4656, px + 11.06, 1.4, pz);
    sign("VICE PRESIDENT'S RESIDENCE", '#f8f6f0', '#1d4d33', px + 11.1, 5.4, pz, HALFPI, 8);
    flag(px + 16, pz - 4, 8); flag(px + 16, pz + 4, 8);
    const vp = { kind: 'villa', role: 'vp', name: "Vice President's Residence", pos: new THREE.Vector3(px + 12.4, 0, pz), yaw: HALFPI }; city.doors.push(vp);
    poi("Vice President's Residence", 'government', px + 14, pz, { door: vp });
    // helipad
    cyl(7, .1, 0x5a5d62, 385, .06, -112); box(.8, .02, 5, 0xffffff, 383, .12, -112); box(.8, .02, 5, 0xffffff, 387, .12, -112); box(3.2, .02, .8, 0xffffff, 385, .12, -112);
    poi('Villa Helipad', 'transport', 385, -112);
    // Asokoro side street: a church and a mosque
    building(380, -49, 16, 10, 7, 0xf1ece0, 0x8b3a2a, Math.PI, null, { sign: 'ASOKORO CHURCH', signBg: '#5a3e2b' }); poi('Asokoro Church', 'worship', 380, -55);
    building(266, -49, 14, 10, 6, 0xeef1e6, 0x1d8a4a, Math.PI, null, { sign: 'ASOKORO MOSQUE', signBg: '#1d6e45' }); cyl(1, 14, 0xeef1e6, 256, 7, -46); B.add(SPH, 0x1d8a4a, 256, 14.6, -46, 0, 1.3, 1.3, 1.3); poi('Asokoro Mosque', 'worship', 266, -55);
  }

  /* ================= MAITAMA: mansions, the bank HQ and the Country Club ================= */
  {
    for (const z of [88, 124, 160]) { lot(298, z, HALFPI, 'mansion', 'Maitama', 25000000); lot(362, z, -HALFPI, 'mansion', 'Maitama', 25000000); }
    building(285, 44, 26, 14, 18, 0xd4dde3, 0x16213a, 0, { kind: 'bank' }, { sign: 'SOVEREIGN TRUST BANK', sub: 'Head Office', name: 'Sovereign Trust Bank HQ', cat: 'bank' });
    building(372, 42, 28, 14, 7, 0xf3efe6, 0x2f6f4f, 0, { kind: 'club' }, { sign: 'ABUJA COUNTRY CLUB', signBg: '#1d4d33', name: 'Abuja Country Club', cat: 'leisure', portico: true });
    box(10, .1, 6, 0x4fb3d9, 400, .06, 42);
    sign('MAITAMA ESTATE', '#e9e0f0', '#3c2a55', 252, 3.2, 72.5, HALFPI, 6, 'Mansions from ₦25M');
  }

  /* ================= GWARINPA: citizens' estate, school and estate agent ================= */
  {
    for (const z of [92, 120, 148, 176]) { lot(-306, z, -HALFPI, 'bungalow', 'Gwarinpa'); lot(-354, z, HALFPI, 'bungalow', 'Gwarinpa'); }
    building(-372, 40, 30, 14, 7, 0xe8d9b0, 0x8b3a2a, 0, { kind: 'school' }, { sign: 'GOVT SECONDARY SCHOOL', sub: 'Gwarinpa', name: 'Government Secondary School', cat: 'school' });
    box(26, .04, 12, 0xb57a50, -372, .03, 20); flag(-372, 26, 8); // dusty field
    building(-282, 44, 14, 10, 4.5, 0xf6f0e4, 0x3f5f7f, 0, { kind: 'agency' }, { sign: 'HOMEFINDERS AGENCY', sub: 'Rent · Buy · Short-let', name: 'Homefinders Estate Agency', cat: 'work' });
    sign('GWARINPA ESTATE', '#e2ecf3', '#16213a', -252, 3.2, 72.5, -HALFPI, 6, 'Free homes for citizens');
    for (let x = -262; x > -400; x -= 15) tree(x, 74);
  }

  /* ================= NYANYA: the street, motor park, compounds and hospital ================= */
  {
    for (const z of [-96, -130, -164]) lot(-306, z, -HALFPI, 'yard', 'Nyanya');
    lot(-354, -164, HALFPI, 'yard', 'Nyanya');
    // keke and bus park with a shed
    plate(-372, -108, 44, 30, 0x777a7e, .025);
    for (let k = 0; k < 5; k++) for (const s of [-1, 1]) { box(.25, 4.4, .25, 0x7d8085, -390 + k * 9, 2.2, -108 + s * 6); circles.push({ x: -390 + k * 9, z: -108 + s * 6, r: .3 }); }
    box(40, .15, 13, 0xa9aeb2, -372, 4.5, -108);
    sign('NYANYA MOTOR PARK', '#f2c230', '#1d3b2a', -350, 4.2, -93.6, 0, 7, 'Keke · Bus · Okada');
    for (let k = 0; k < 6; k++) parked.push({ type: k % 2 ? 'keke' : 'bus', x: -388 + k * 6.5, y: 0, z: -112, yaw: Math.PI, park: true });
    spots.nyanyaPark = { x: -372, z: -100 };
    poi('Nyanya Motor Park', 'transport', -372, -100);
    building(-372, -160, 24, 14, 7, 0xf2f6f4, 0xc9472f, 0, { kind: 'hospital' }, { sign: 'NYANYA GENERAL HOSPITAL', signBg: '#c9472f', name: 'Nyanya General Hospital', cat: 'hospital' });
    box(.6, 3, .6, 0xc9472f, -358, 1.5, -150); box(2, .6, .6, 0xc9472f, -358, 2.4, -150);
    // beer parlour and buka by the road
    building(-268, -80, 12, 8, 4, 0xe9c46a, 0x6b4a3a, 0, { kind: 'shop', color: '#b5651d', sub: 'Pepper soup and cold drinks' }, { sign: 'MAMA T BEER PARLOUR', signBg: '#b5651d', name: 'Mama T Beer Parlour', cat: 'food' });
    for (let k = 0; k < 3; k++) { const x = -262 + k * 3.2; box(1.2, .06, 1.2, 0xf4f4f4, x, .75, -73.5); seat(x - .7, -73.5, HALFPI); seat(x + .7, -73.5, -HALFPI); }
    // refuse heap and a broken-down bus: life on the street
    B.add(blob(1, 0, 0, 0, 1, .4), 0x5b4a3a, -398, .5, -76, 0, 3, 1.2, 2.4);
    sign('NYANYA', '#f1e3d3', '#5a3e2b', -252, 3.2, -71.5, -HALFPI, 5, 'Welcome to the street');
  }

  /* ================= CIVIC: Eagle Square, Area Council, INEC, National Hospital ================= */
  {
    plate(-150, 330, 64, 44, 0xd9d4c7, .03);
    for (let i = -30; i <= 30; i += 4) box(.1, .01, 44, 0xc4bfb2, -150 + i, .06, 330);
    // stage with a green-white-green backdrop
    box(20, 1.4, 8, 0x5a3e2b, -150, .7, 349); box(20, 6, .4, 0xffffff, -150, 4, 353); box(6.6, 6, .42, 0x1d8a4a, -156.7, 4, 353); box(6.6, 6, .42, 0x1d8a4a, -143.3, 4, 353);
    solid(-150, 349, 20, 8, 1.4); solid(-150, 353, 20, .5, 7);
    sign('EAGLE SQUARE', '#f4f2ec', '#1d4d33', -150, 8, 352.7, Math.PI, 8);
    // grandstand facing the stage
    for (let r = 0; r < 4; r++) { box(40, .5, 1.6, 0xe8e2d6, -150, .25 + r * .6, 306 - r * 1.6); for (let k = -18; k <= 18; k += 2) if (r < 2) seat(-150 + k, 306 - r * 1.6, 0, .5 + r * .6); }
    solid(-150, 303.6, 40, 6.4, 2.6);
    spots.rally = { x: -150, z: 338 };
    poi('Eagle Square (rallies)', 'government', -150, 330);
    for (let k = -3; k <= 3; k++) flag(-150 + k * 8, 357, 10);
    building(-96, 300, 22, 14, 10, 0xf3efe6, 0x1d6e45, HALFPI, { kind: 'council' }, { sign: 'AMAC SECRETARIAT', sub: 'Area Council', name: 'AMAC Secretariat', cat: 'government', portico: true });
    building(-96, 342, 18, 12, 7, 0xf2f2ee, 0x1d8a4a, HALFPI, { kind: 'inec' }, { sign: 'INEC OFFICE', sub: 'Buy forms · Contest', name: 'INEC Office', cat: 'government' });
    building(-100, 378, 30, 12, 9, 0xf2f6f4, 0xc9472f, HALFPI, { kind: 'hospital' }, { sign: 'NATIONAL HOSPITAL', signBg: '#c9472f', name: 'National Hospital', cat: 'hospital' });
    for (let z = 280; z < 390; z += 14) palm(-72, z);
  }

  /* ================= LEISURE: National Stadium, Jabi Lake Mall + cinema, tech hub, dispatch ================= */
  {
    const sx = 158, sz = 340, rx = 30, rz = 22;
    plate(sx, sz, rx * 1.6, rz * 1.6, 0x5fa64a, .04);
    box(rx * 1.4, .02, .25, 0xffffff, sx, .07, sz); B.add(new THREE.TorusGeometry(5, .12, 4, 24), 0xffffff, sx, .07, sz, 0, 1, 1, 1, HALFPI);
    for (let i = 0; i < 44; i++) {
      const a = i / 44 * Math.PI * 2, gap = Math.abs(Math.atan2(Math.sin(a + HALFPI), Math.cos(a + HALFPI))) < .14;
      for (let t = 0; t < 5; t++) { if (gap && t < 4) continue; const r = 1 + t * .07, x = sx + Math.cos(a) * rx * r, z = sz + Math.sin(a) * rz * r; box(4.8, 1 + t * 1.6, 2, t % 2 ? 0x1d8a4a : 0xe8e2d6, x, (1 + t * 1.6) / 2, z, -a + HALFPI); if (t === 4) solid(x, z, 4.2, 4.2, 9); }
    }
    for (const k of [0, 1, 2, 3]) { const a = k * HALFPI + .78; box(.6, 22, .6, 0xdedede, sx + Math.cos(a) * rx * 1.42, 11, sz + Math.sin(a) * rz * 1.42); box(3, 1.4, .4, 0xf5f0de, sx + Math.cos(a) * rx * 1.42, 22, sz + Math.sin(a) * rz * 1.42); }
    sign('NATIONAL STADIUM', '#1d8a4a', '#ffffff', sx, 7.5, sz - rz * 1.3 - 1.2, 0, 9);
    spots.stadium = { x: sx, z: sz - rz - 5.5 };
    poi('National Stadium', 'stadium', sx, sz - rz - 6);
    for (let i = 0; i < 10; i++) pitch.push({ x: sx + (rand() - .5) * 30, z: sz + (rand() - .5) * 20, team: i % 2, ph: rand() * 6 });
    // stand seats for watching
    for (let k = -4; k <= 4; k++) seat(sx + k * 2.4, sz + rz * 1.02, Math.PI, 1.05);
    building(100, 300, 30, 18, 9, 0xe9edf0, 0x16213a, -HALFPI, { kind: 'cinema' }, { sign: 'JABI LAKE MALL', sub: 'Starlight Cinema inside', name: 'Starlight Cinema (Jabi Lake Mall)', cat: 'cinema' });
    building(100, 344, 16, 12, 12, 0x2f4656, 0xf2c230, -HALFPI, { kind: 'hub' }, { sign: 'UTAKO TECH HUB', signBg: '#16213a', signFg: '#f2c230', name: 'Utako Tech Hub', cat: 'work' });
    building(100, 378, 14, 10, 4.5, 0xf2c230, 0xc9472f, -HALFPI, { kind: 'depot' }, { sign: 'KWIK DISPATCH', signBg: '#c9472f', name: 'Kwik Dispatch', cat: 'work' });
    for (let k = 0; k < 3; k++) parked.push({ type: 'keke', x: 84, y: 0, z: 370 + k * 4, yaw: HALFPI });
    // the lake behind the mall
    B.add(new THREE.CylinderGeometry(1, 1, 1, 20), 0x4fa3c7, 196, .05, 290, 0, 14, .1, 9); poi('Jabi Lake', 'leisure', 196, 290);
  }

  /* ================= WUSE II: hotel, food, nightlife, gym, supermarket, pharmacy ================= */
  {
    const W = -HALFPI, E = HALFPI;     // west side faces east onto the crescent, and the other way round
    building(-28, 300, 22, 26, 22, 0xe6ecf2, 0x16213a, E, { kind: 'hotel' }, { sign: 'GRAND ABUJA HOTEL', sub: 'Rooms · Restaurant', name: 'Grand Abuja Hotel', cat: 'hotel', portico: true });
    building(-28, 340, 20, 22, 7, 0xf4f1e8, 0xc9472f, E, { kind: 'shopfloor', color: '#c9472f', sub: 'Groceries and household' }, { sign: 'FRESHMART SUPERMARKET', signBg: '#c9472f', name: 'FreshMart Supermarket', cat: 'shop' });
    building(-28, 370, 16, 14, 5, 0xf2f8f4, 0x1d8a4a, E, { kind: 'shop', color: '#1d8a4a', sub: 'Drugs and first aid' }, { sign: 'HEALTHPLUS PHARMACY', signBg: '#1d8a4a', name: 'HealthPlus Pharmacy', cat: 'pharmacy' });
    box(.5, 1.6, .5, 0x1d8a4a, -19, 4.2, 362); box(1.6, .5, .5, 0x1d8a4a, -19, 4.2, 362);
    building(28, 290, 18, 16, 6, 0xf6e7c8, 0x6b4a3a, W, { kind: 'restaurant' }, { sign: 'CALABAR KITCHEN', signBg: '#6b4a3a', name: 'Calabar Kitchen (restaurant)', cat: 'food' });
    building(28, 316, 16, 14, 5, 0x2b2b2b, 0xe8b23a, W, { kind: 'bar' }, { sign: 'VIBES LOUNGE', signBg: '#2b2b2b', signFg: '#e8b23a', name: 'Vibes Lounge (bar)', cat: 'bar' });
    building(28, 344, 20, 18, 8, 0x1b1530, 0xa855f7, W, { kind: 'nightclub' }, { sign: 'CLUB 27', signBg: '#1b1530', signFg: '#e0a8ff', sub: 'Open 6pm till late', name: 'Club 27 (nightclub)', cat: 'bar' });
    building(28, 372, 18, 14, 6, 0xd9dde2, 0xf2c230, W, { kind: 'gym' }, { sign: 'IRONFIT GYM', signBg: '#16213a', signFg: '#f2c230', name: 'IronFit Gym', cat: 'leisure' });
    for (let z = 280; z < 385; z += 16) { palm(-9, z); palm(9, z + 8); }
    for (let k = 0; k < 4; k++) parked.push({ type: k % 2 ? 'taxi' : 'sedan', x: -12, y: 0, z: 316 + k * 5, yaw: 0 });
    sign('WUSE II', '#f6e0e6', '#5a2340', 7.5, 3.2, 267, 0, 5, 'Hotels · Food · Nightlife'); box(.15, 3.2, .15, 0x6d7075, 5.2, 1.6, 267); box(.15, 3.2, .15, 0x6d7075, 9.8, 1.6, 267);
    spots.ride = { x: 6, z: 296 };      // taxi pick-up point outside the hotel
  }

  /* ================= WORK FLOORS: workshop, works yard and the park market ================= */
  building(-14, 196.2, 16, 12, 5, 0xdfe3e6, 0x16213a, Math.PI, { kind: 'workshop' }, { sign: 'JABI MOTORS WORKSHOP', signBg: '#16213a', sub: 'Repairs · Parts · Fuel', name: 'Jabi Motors Workshop', cat: 'work' });
  building(18, -187.2, 10, 4, 3.4, 0xc8c2b4, 0xb5651d, 0, { kind: 'yard' }, { sign: 'FCDA WORKS YARD', signBg: '#b5651d', sub: 'Roads · Waste · Markets', name: 'FCDA Works Yard', cat: 'work' });
  for (let k = 0; k < 4; k++) box(.5, .25, .8, 0x9aa1a6, 25 + (k % 2) * .6, .13 + (k >> 1) * .26, -186);
  building(-372, -138, 20, 10, 4.5, 0xe8d9b0, 0x2f8f5b, 0, { kind: 'shopfloor', color: '#2f8f5b' }, { sign: 'NYANYA PARK MARKET', signBg: '#2f8f5b', sub: 'Foodstuff · Union stalls', name: 'Nyanya Park Market', cat: 'market' });

  /* ---------- old places that deserve names on the map ---------- */
  const doorPoi = { shop: 'shop', lobby: 'office', assembly: 'government' };
  city.doors.forEach(d => { if (d.kind !== 'house' && !pois.some(p => p.door === d)) poi(d.name, d.kind === 'shop' ? (/(buka|kitchen|bakery|suya|zobo|mart|provisions)/i.test(d.name) ? 'food' : 'shop') : doorPoi[d.kind] || 'office', d.pos.x, d.pos.z, { door: d }); });
  city.houses.forEach(h => { if (!h.estate) poi(`Central House ${h.idx + 1}`, 'home', h.gate.x, h.gate.z, { house: h.idx }); });
  [['Unity Market', 'market', -96, 32], ['Abuja Motor Park', 'transport', -180, 0], ['Unity Park', 'leisure', 96, 32], ['Fire Service', 'services', out.spots.fire.x, out.spots.fire.z], ['Police Station', 'services', out.spots.police.x, out.spots.police.z], ['Jabi Motors (car dealer)', 'shop', 0, 172], ['Unity Fuel Station', 'services', out.spots.fuel.x, out.spots.fuel.z], ['Unity Roundabout', 'landmark', 0, 0], ['Lugbe Layout (land for sale)', 'land', -126, -192], ['Katampe Extension (land for sale)', 'land', 126, -192], ['Expressway to the north', 'transport', 0, -200]].forEach(([n, c, x, z]) => poi(n, c, x, z));

  root.add(B.build(mat));
  root.traverse(o => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = o.geometry.type !== 'PlaneGeometry'; } });
  return { root, boxes, circles, seats, parked, guards, pois, spots, pitch };
}

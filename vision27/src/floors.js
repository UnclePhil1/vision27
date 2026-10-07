import * as THREE from 'three';
import { G, naira, dialog } from './game.js';
import { FLOORS, GOODS_NAME, POTHOLES, WASTE, STALLS, powerOut } from './floordata.js';
import { srv, online, hh, cityHourAt } from './server.js';
import { INT_X, INT_Z, INT_GAP } from './interiors.js';
import { eco, spend, addItem, ITEMS, priceOf } from './economy.js';
import { setDestination } from './map.js';
import { setPresence } from './net.js';
import { finish } from './work.js';

/* Work floors: a shift is a list of real tasks at real stations, never a bar that fills.
   The phone names the next station, the arrows show the shortest walk, and you hold the
   action at the station. The server hands out each task, checks you are there, moves the
   city's stock and pays from tasks done (supabase/schema.sql §15). */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BY_DOOR = Object.fromEntries(Object.entries(FLOORS).map(([site, f]) => [f.door, site]));
const COL = { rice: 0xf4f0e6, beans: 0xb5651d, garri: 0xf2e6b8, oil: 0xc9472f, noodles: 0xf2c230, tomatoes: 0xe8452c, clothes: 0x7b3f8c, parts: 0x555b60, cement: 0x9aa1a6, tiles: 0xd9c7a5, paint: 0x2e7fd0, cable: 0x2b2b2b, pipes: 0xdedede, fittings: 0xf4f4f4, petrol: 0xd9771f, eggs: 0xf6e7c8 };
const ACT = { pick: 'Pick', lift: 'Lift', drop: 'Drop', pack: 'Pack', load: 'Load', scan: 'Scan', stock: 'Stock', dump: 'Dump', count: 'Count', check: 'Check', fit: 'Fit', fuel: 'Fuel', hand: 'Hand over', patch: 'Patch', shovel: 'Shovel', fix: 'Fix', lay: 'Lay blocks', wire: 'Wire', plumb: 'Plumb', tile: 'Tile', paint: 'Paint' };
const CARRY = ['lift', 'pick'];
const name = it => GOODS_NAME[it] || ITEMS[it]?.name || it;

/* ================= drawing the floors (called from interiors.js) ================= */
function buildFloor(door, c) {
  const site = BY_DOOR[door.name]; if (!site) return false;
  const f = FLOORS[site], { box, solid, wallSign, spots, npcs } = c, market = site === 'nyanya_market';
  const tag = (t, x, y, z, w = 1.2, ry = 0) => wallSign(t, '#f2c230', '#16213a', x, y, z, w, ry);
  const crate = (x, y, z, col, s = .45) => box(s, s * .8, s, col, x, y + s * .4, z);
  for (const s of f.stations) {
    const { x, z } = s;
    if (s.kind === 'bay') {
      for (const a of [1.1, 2.1]) for (const b of [-1.75, 1.75]) box(.1, 2.6, .1, 0x2e5fa8, x + a, 1.3, z + b);
      box(.06, 2.4, 3.5, 0x9aa1a6, x + 2.12, 1.3, z); solid(x + 1.6, z, 1, 3.6, 2.6);
      for (let y = 0; y < 3; y++) { box(1.1, .06, 3.6, 0xf2c230, x + 1.6, .45 + y * .8, z); for (let k = -1; k <= 1; k++) crate(x + 1.55, .48 + y * .8, z + k * 1.05, COL[s.item] || 0xb8946a, .6); }
      tag(s.code, x + 1.04, 2.05, z, 1.3, -Math.PI / 2);
      if (s.code.endsWith('-04')) tag(`AISLE ${s.code[0]}`, x, 3.1, z + 2.6, 1.8);
    } else if (s.kind === 'recv') { box(1.2, .14, 1.2, 0x8a6a4e, x, .07, z - 1.4); for (let k = 0; k < 4; k++) crate(x - .3 + (k % 2) * .6, .14 + (k > 1 ? .5 : 0), z - 1.4, 0xb8946a, .55); box(.15, 1.3, .15, 0x333333, x + .9, .65, z - .8); tag(s.code, x, 2.4, z - 2.2, 1); }
    else if (s.kind === 'pack') { box(2.6, .95, .9, 0xd8d0c2, x, .47, z + 1); solid(x, z + 1, 2.6, .9, 1); ['S', 'M', 'L'].forEach((b, i) => crate(x - .8 + i * .8, .95, z + 1.1, 0xc9a77a, .3 + i * .12)); box(.4, .3, .3, 0x2b2b2b, x + 1, 1.1, z + .9); tag(s.code, x, 2.3, z + 1.5, 1); }
    else if (s.kind === 'dock') { box(.12, 3, 3.4, 0x8d9196, f.W / 2 - .06, 1.5, z); box(1.4, .02, 3.4, 0xf2c230, x + .5, .02, z); tag('DOCK', x, 3.2, z - 2, 1.2); }
    else if (s.kind === 'bin') { box(1.2, 1, 1.2, 0x1f6e45, x, .5, z - 1.1); solid(x, z - 1.1, 1.2, 1.2, 1); tag('BIN', x, 1.6, z - .45, .9); }
    else if (s.kind === 'back') { for (let k = 0; k < 6; k++) crate(x - 1 + (k % 3) * .6, (k > 2 ? .5 : 0), z - 1.2, 0xb8946a, .55); tag(market ? 'CRATES' : 'BACK STORE', x, 2.4, z - 1.9, 1.6); }
    else if (s.kind === 'shelf') {
      const sz = z - 1.1;
      if (market) { box(3, .8, 1, 0x8a6a4e, x, .4, sz); for (let k = 0; k < 7; k++) crate(x - 1.2 + k * .4, .8, sz, COL[s.item], .32); box(3.4, .06, 1.6, [0xc9472f, 0x2e7fd0, 0xf2c230][(x + 5) / 5 % 3 | 0], x, 2.4, sz); }
      else { box(3.4, 1.9, .3, 0xb8946a, x, .95, sz - .15); for (let y = 0; y < 3; y++) { box(3.4, .05, .5, 0xd8d0c2, x, .18 + y * .6, sz + .05); for (let k = 0; k < 6; k++) crate(x - 1.4 + k * .56, .2 + y * .6, sz + .1, COL[s.item], .34); } }
      solid(x, sz, 3.4, market ? 1 : .6, 1.9); tag(`${s.code} ${s.item.toUpperCase()}`, x, 2.15, sz + .5, 1.6);
    } else if (s.kind === 'till') {
      box(3, 1, .8, 0x6e543b, x, .5, z - 1.1); box(3.1, .06, .9, 0xd8d0c2, x, 1.02, z - 1.1); solid(x, z - 1.1, 3.1, .9, 1); box(.4, .35, .3, 0x2b2b2b, x, 1.2, z - 1.1);
      tag('TILL', x, 2.4, z - 1.5, 1); spots.push({ x: c.ox + x, z: c.oz + z - 2.6, kind: 'shop', cat: 'supermarket', label: `Buy at ${door.name}` });
      for (let k = 0; k < 3; k++) npcs.push({ x: c.ox + x - .4 + k * .2, z: c.oz + z - 2.5 - k * 1.1, yaw: 0, female: k % 2 === 0 });
    } else if (s.kind === 'car') { box(.2, 2.2, .2, 0xc9472f, x - 2.4, 1.1, z - 1.2); box(.2, 2.2, .2, 0xc9472f, x + 2.4, 1.1, z - 1.2); box(4, .8, 1.8, 0x8d9ba5, x, .7, z - 2.3); box(2.2, .6, 1.6, 0x2f4656, x - .2, 1.4, z - 2.3); solid(x, z - 2.3, 4.2, 2, 1.6); tag(s.code, x, 3, z - 3.4, 1.2); }
    else if (s.kind === 'rack') { box(2.4, 1.8, .2, 0x2e5fa8, x, .9, z - 1.1); for (let k = 0; k < 4; k++) { box(2.4, .05, .5, 0xf2c230, x, .28 + (k > 1 ? .7 : 0), z - .85); crate(x - .8 + (k % 2) * 1.6, .3 + (k > 1 ? .7 : 0), z - .8, k % 2 ? 0x2b2b2b : 0xc9472f, .4); } solid(x, z - .9, 2.4, .6, 1.8); tag(s.item.toUpperCase(), x, 2.1, z - .55, 1.4); }
    else if (s.kind === 'pump') { box(.7, 1, .7, 0xc9472f, x + .9, .5, z); solid(x + .9, z, .7, .7, 1); tag('FUEL', x + .9, 1.5, z + .36, .8); }
    else if (s.kind === 'desk') { box(.8, 1, 2.4, 0x6e543b, x + 1.1, .5, z); solid(x + 1.1, z, .8, 2.4, 1); npcs.push({ x: c.ox + x + 2.1, z: c.oz + z, yaw: -Math.PI / 2, female: true }); tag('KEYS', x + 1.1, 1.8, z - 1.3, .9); }
    else if (s.kind === 'tools') { box(2.6, 2.4, 1.4, 0x6b4a33, x, 1.2, z - 1.4); solid(x, z - 1.4, 2.6, 1.4, 2.4); tag('TOOLS', x, 2.7, z - .65, 1.2); }
    else if (s.kind === 'cement') { for (let k = 0; k < 8; k++) box(.8, .25, .5, 0x9aa1a6, x - .5 + (k % 2) * .9, .13 + (k >> 1) * .26, z - 1.2); solid(x, z - 1.2, 1.8, .6, 1); tag('CEMENT', x, 2, z - .8, 1.2); }
    else if (s.kind === 'barrow') { [-.7, .7].forEach(o => { box(.7, .4, 1.1, 0x2f8f5b, x + o, .5, z - 1.2); box(.1, .3, .3, 0x222222, x + o, .15, z - .7); }); tag('BARROWS', x, 1.9, z - .6, 1.2); }
    else if (s.kind === 'truck') { box(2.4, 1.6, 4.6, 0xd9771f, x + 2.4, 1.3, z - .4); box(2.2, 1.4, 1.6, 0x2f4656, x + 2.4, 1.2, z + 2.6); solid(x + 2.4, z + .4, 2.6, 6.4, 2.4); tag('TIPPER', x + 1.15, 2.4, z - .4, 1.2, -Math.PI / 2); }
  }
  if (site === 'depot') { for (let k = 0; k < 12; k++) box(1.1, .1, .9, 0x6d7075, 3 + k * 1.1, .55, 10.9); solid(9, 10.9, 13.4, .9, .7); spots.push({ x: c.ox - 12.5, z: c.oz + 10.4, kind: 'role', id: 'dispatch', label: '' }); }
  tag(`${f.name.toUpperCase()} · STAFF CLOCK IN HERE`, -f.W / 2 + 4, 2.6, f.D / 2 - .4, 3.2, Math.PI);
  return true;
}

/* ================= the shift ================= */
const F = { mode: null, sid: null, site: null, plot: null, task: null, step: 0, choice: null, hold: null, busy: false, askT: 0, idle: '', over: false, power: true,
  counts: {}, ok: 0, fails: 0, combo: 0, role: 'all', carry: false, path: [], pathT: 0, gps: '', lastPtr: 0, shift: null, early: false, ready: false };
const here = () => { const r = G.insideRoom?.(); if (!r) return { site: 'city' }; return { site: BY_DOOR[r.door?.name] || 'room', ox: INT_X + r.slot * INT_GAP, oz: INT_Z, room: r }; };
const curStep = () => F.task?.steps?.[F.step];
function target(st) {
  if (!st) return null;
  const h = here();
  if (st.w) return h.site === 'city' ? { x: st.x, z: st.z, ok: true } : { ok: false, why: 'Go outside to ' + st.label.toLowerCase() };
  if (h.site === st.site) return { x: h.ox + st.x, z: h.oz + st.z, ok: true, h };
  return { ok: false, why: `Go to ${FLOORS[st.site]?.door}`, door: FLOORS[st.site]?.door };
}
const floorSite = () => F.mode === 'shift' ? F.shift?.meta?.floor : null;
const needsChoice = st => !!F.task?.choices && (F.step === 0) && ['pick', 'pack'].includes(st?.act);
const powerNow = () => { const s = floorSite(); return s && FLOORS[s] ? !powerOut(FLOORS[s].seed) : true; };

function begin(mode, o) {
  Object.assign(F, { mode, sid: o.sid || null, site: o.site || null, plot: o.plot || null, shift: o.shift || null, task: null, step: 0, choice: null, hold: null, counts: {}, ok: 0, fails: 0, combo: 0, idle: '', over: false, askT: 0, early: false });
  document.body.classList.add('onfloor'); paint();
}
function end() { setCarry(false); F.mode = null; F.task = null; F.path = []; document.body.classList.remove('onfloor'); hideArrows(); paint(); }

async function ask() {
  if (F.busy) return; F.busy = true;
  try {
    const r = await srv.floorNext(F.sid, F.sid ? null : F.site, floorSite() === 'depot' ? F.role : null);
    F.power = r.power !== false;
    if (r.idle) { F.task = null; F.idle = r.idle; F.over = !!r.over; }
    else { F.task = r; F.step = 0; F.choice = null; F.idle = ''; F.gps = ''; }
  } catch (e) { F.idle = e.message; if (/Clock in|not your/i.test(e.message)) end(); }
  F.busy = false; F.askT = performance.now(); F.pathT = 0; paint();
}
function startHold() {
  const st = curStep(); if (!st || F.hold || F.busy || !F.ready) return;
  if (needsChoice(st) && !F.choice) return G.toast(st.act === 'pack' ? 'Pick the right box first' : 'Choose the item first');
  if (st.power && !powerNow()) return G.toast('NEPA took light. This station has no power.');
  F.hold = { t: 0, t0: performance.now(), need: +st.hold || 1 }; paint();
}
function release() {
  const h = F.hold; if (!h) return; F.hold = null; h.t = (performance.now() - h.t0) / 1000;
  if (h.t < h.need) { G.toast('Too quick. Hold until the ring turns green.'); paint(); return; }
  stepDone();
}
function failStep(msg) { F.hold = null; F.combo = 0; G.toast(msg); G.Sound?.thud?.(); paint(); }
function stepDone() {
  const st = curStep(); F.step++; G.Sound?.step?.();
  setCarry(F.step < F.task.steps.length && CARRY.includes(st.act));
  if (F.step >= F.task.steps.length) submit(); else { F.pathT = 0; paint(); }
}
async function submit() {
  const t = F.task, last = t.steps[t.steps.length - 1], h = here(), p = G.player.pos;
  const pos = last.w ? { x: p.x, z: p.z, where: 'city' } : { x: p.x - (h.ox || 0), z: p.z - (h.oz || 0), where: h.site };
  F.busy = true;
  try {
    const r = await srv.floorDone(t.id, pos.x, pos.z, pos.where, F.choice);
    if (r.ok) { F.ok++; F.combo++; F.counts[t.kind] = (F.counts[t.kind] || 0) + 1; G.Sound?.ding?.(); G.toast(r.msg !== 'Done' ? r.msg : F.combo > 2 ? `Combo ×${F.combo}. Keep it moving.` : 'Done. Next task on your phone.'); }
    else { F.fails++; F.combo = 0; G.Sound?.thud?.(); G.toast(r.msg); }
    F.task = null; setCarry(false);
  } catch (e) {
    G.toast(e.message);
    if (/gone|over/i.test(e.message)) F.task = null; else F.step = t.steps.length - 1;
  }
  F.busy = false; F.askT = 0; paint();
}
function setCarry(on) {
  if (F.carry === on) return; F.carry = on; setPresence({ cy: on ? 1 : 0 });
  const root = G.player?.ch?.root; if (!root) return;
  if (!F.crate) { F.crate = new THREE.Mesh(new THREE.BoxGeometry(.5, .38, .42), new THREE.MeshLambertMaterial({ color: 0xc9a77a })); F.crate.position.set(0, 1.05, .38); }
  if (on) root.add(F.crate); else root.remove(F.crate);
}

/* shortest walk on the floor: a small grid search around the colliders */
function route(from, to, room) {
  const b = room.bounds, S = .5, nx = Math.ceil((b.maxX - b.minX) / S), nz = Math.ceil((b.maxZ - b.minZ) / S);
  const cell = (x, z) => [Math.max(0, Math.min(nx - 1, (x - b.minX) / S | 0)), Math.max(0, Math.min(nz - 1, (z - b.minZ) / S | 0))];
  const block = new Uint8Array(nx * nz);
  for (const o of room.boxes.concat(G.extraBoxes || [])) {
    const [x0, z0] = cell(o.minX - .3, o.minZ - .3), [x1, z1] = cell(o.maxX + .3, o.maxZ + .3);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) block[j * nx + i] = 1;
  }
  const [sx, sz] = cell(from.x, from.z), [tx, tz] = cell(to.x, to.z), goal = tz * nx + tx, start = sz * nx + sx;
  block[start] = block[goal] = 0;
  const g = new Float32Array(nx * nz).fill(1e9), prev = new Int32Array(nx * nz).fill(-1), open = [start]; g[start] = 0;
  const hcost = k => Math.hypot(k % nx - tx, (k / nx | 0) - tz);
  while (open.length) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (g[open[i]] + hcost(open[i]) < g[open[bi]] + hcost(open[bi])) bi = i;
    const k = open.splice(bi, 1)[0]; if (k === goal) break;
    const kx = k % nx, kz = k / nx | 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const ix = kx + dx, iz = kz + dz, n = iz * nx + ix; if ((!dx && !dz) || ix < 0 || iz < 0 || ix >= nx || iz >= nz || block[n]) continue;
      if (dx && dz && (block[kz * nx + ix] || block[iz * nx + kx])) continue;
      const c = g[k] + (dx && dz ? 1.414 : 1); if (c < g[n]) { if (g[n] === 1e9) open.push(n); g[n] = c; prev[n] = k; }
    }
  }
  if (prev[goal] < 0 && goal !== start) return [from, to];
  const pts = []; for (let k = goal; k >= 0; k = prev[k]) pts.unshift({ x: b.minX + (k % nx + .5) * S, z: b.minZ + ((k / nx | 0) + .5) * S });
  pts[0] = from; pts[pts.length - 1] = to;
  // keep only the turns
  return pts.filter((q, i) => i === 0 || i === pts.length - 1 || Math.abs((q.x - pts[i - 1].x) * (pts[i + 1].z - q.z) - (q.z - pts[i - 1].z) * (pts[i + 1].x - q.x)) > .01);
}

/* arrows on the floor and a ring at the station */
const arrows = [], AR = 22;
let ring = null;
function setupMarks() {
  const sh = new THREE.Shape(); sh.moveTo(-.35, -.2); sh.lineTo(0, .2); sh.lineTo(.35, -.2); sh.lineTo(.35, -.02); sh.lineTo(0, .38); sh.lineTo(-.35, -.02);
  const geo = new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2), m = new THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: .9, depthWrite: false });
  for (let i = 0; i < AR; i++) { const a = new THREE.Mesh(geo, m); a.visible = false; a.renderOrder = 3; G.scene.add(a); arrows.push(a); }
  ring = new THREE.Group();
  const r = new THREE.Mesh(new THREE.TorusGeometry(1.1, .07, 6, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3ddc84 }));
  const col = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, 4, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: .14, side: THREE.DoubleSide, depthWrite: false }));
  col.position.y = 2; ring.add(r, col); ring.visible = false; G.scene.add(ring);
}
function hideArrows() { arrows.forEach(a => (a.visible = false)); if (ring) ring.visible = false; }
function drawArrows(t, pts = F.path) {
  hideArrows(); if (pts.length < 2) return;
  const yAt = (x, z) => (G.isInside?.() ? .04 : (G.gY?.(x, z) || 0) + .06);
  let n = 0, start = .8 + (t * 1.6) % 1.3, run = 0;
  for (let i = 0; i < pts.length - 1 && n < AR; i++) {
    const a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), yaw = Math.atan2(b.x - a.x, b.z - a.z);
    for (let d = start - run; d < L && n < AR; d += 1.3) { if (d < 0) continue; const m = arrows[n++], x = a.x + (b.x - a.x) * d / L, z = a.z + (b.z - a.z) * d / L; m.position.set(x, yAt(x, z), z); m.rotation.y = yaw; m.visible = true; start = run + d + 1.3; }
    run += L;
  }
}
const showRing = tg => { ring.position.set(tg.x, tg.h ? .01 : (G.gY?.(tg.x, tg.z) || 0) + .03, tg.z); ring.visible = true; };

/* ================= HUD ================= */
const GOALS = {
  depot: [['pick', 'Pick order lines', 6], ['pack', 'Pack boxes', 3], ['dispatch', 'Load the truck', 2], ['receive', 'Scan pallets in', 1], ['putaway', 'Put stock away', 2], ['clean', 'No wrong picks']],
  shopfloor: [['unload', 'Restock shelves', 3], ['serve', 'Serve customers', 6], ['close', 'Close the till', 1], ['clean', 'No mistakes'], ['stay', 'Work to the end']],
  workshop: [['receive_car', 'Check a car in', 1], ['diagnose', 'Find the fault', 1], ['part', 'Pull the right part', 1], ['fit', 'Fit the part', 1], ['handback', 'Hand back the keys', 1], ['clean', 'No wrong parts']],
  yard: [['tools', 'Sign out tools', 1], ['fix', 'Fix city spots', 3], ['clean', 'Every job done right'], ['stay', 'Work to the end'], ['quiet', 'Clear waste heaps', 2]],
  site: [['build', 'Build pieces', 4], ['clean', 'Every piece done right'], ['stay', 'Stay on site']],
};
function goals() {
  const site = floorSite(), kind = site ? FLOORS[site].kind : 'site', s = F.shift;
  const mins = s ? (new Date(s.ends_at) - new Date(s.starts_at)) / 60000 : 4, k = Math.min(1, mins / 4);
  const n = id => id === 'fix' ? (F.counts.patch || 0) + (F.counts.waste || 0) + (F.counts.stall || 0) : id === 'quiet' ? (F.counts.waste || 0) : F.counts[id] || 0;
  return GOALS[kind].map(([id, label, want]) => {
    if (id === 'clean') return { label, done: F.ok > 0 && !F.fails, txt: F.fails ? `${F.fails} wrong` : '' };
    if (id === 'stay') { const left = s ? new Date(s.ends_at) - Date.now() : 1; return { label, done: !!s && left <= 0 && !F.early, txt: s && left > 0 ? `${Math.ceil(left / 60000)} hr left` : '' }; }
    const w = Math.max(1, Math.round(want * k)); return { label, done: n(id) >= w, txt: `${Math.min(n(id), w)}/${w}` };
  });
}
function phaseOf() {
  const h = cityHourAt(Date.now()), site = floorSite();
  if (h >= 18 && h < 22) return ['Evening rush', 1.5];
  if (site === 'depot' && h >= 6 && h < 10) return ['Morning lorries', 1.25];
  if (['freshmart', 'nyanya_market'].includes(site) && h >= 10 && h < 14) return ['Lunch rush', 1.25];
  return [h < 6 || h >= 22 ? 'Night shift' : 'Steady', 1];
}
function setupHud() {
  const css = document.createElement('style');
  css.textContent = `body.onfloor .side .list{display:none}
  .flgoals{background:var(--paper);border-radius:14px;padding:10px 12px;box-shadow:0 3px 0 var(--edge);width:150px;pointer-events:auto;font-size:13px}
  .flgoals h2{font-size:13px;margin:0 0 6px;color:var(--green-deep,#1d6e45);text-transform:uppercase;letter-spacing:.04em}
  .flgoals li{list-style:none;display:flex;justify-content:space-between;gap:6px;padding:2px 0;color:#333}.flgoals ul{margin:0;padding:0}
  .flgoals li.ok{color:#1d8a4a;text-decoration:line-through}.flgoals li i{font-style:normal;color:#777;white-space:nowrap}
  .flgoals canvas{display:block;width:150px;height:105px;margin-top:8px;border-radius:8px;background:#e9e6dc}
  #flClock{position:absolute;left:50%;transform:translateX(-50%);top:calc(70px + env(safe-area-inset-top,0px));background:#16213a;color:#fff;border-radius:999px;padding:6px 16px;font-size:14px;z-index:3;white-space:nowrap;box-shadow:0 3px 0 #0b1222}
  #flClock b{color:#f2c230}
  #flTask{position:absolute;right:76px;top:calc(14px + env(safe-area-inset-top,0px));width:250px;background:#fff;border-radius:18px;border:3px solid #16213a;padding:12px;z-index:3;font-size:14px;box-shadow:0 4px 0 #0b1222}
  #flTask .flh{display:flex;justify-content:space-between;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.04em}
  #flTask .code{font:700 34px/1.1 "Fredoka",system-ui,sans-serif;color:#16213a;margin:6px 0 2px}
  #flTask .what{font-weight:600}#flTask small{display:block;color:#666;margin-top:3px}
  #flTask .ch{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}#flTask .ch button{flex:1;min-width:60px}
  #flTask .ch button.on{background:#16213a;color:#fff}
  #flTask .hold{width:100%;margin-top:10px;padding:12px;border-radius:12px;border:0;background:#1d8a4a;color:#fff;font:600 16px inherit;touch-action:none}
  #flTask .hold:disabled{background:#b8bcbe}
  #flTask .chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}#flTask .chips span{font-size:12px;border-radius:999px;padding:3px 8px;background:#e9f5ee;color:#1d6e45}
  #flTask .chips span.bad{background:#fdebe7;color:#c9472f}
  #flTask .roles{display:flex;gap:4px;flex-wrap:wrap;margin-top:8px}#flTask .roles button{font-size:11px;padding:3px 7px;margin:0}#flTask .roles button.on{background:#16213a;color:#fff}
  #flTask .foot{display:flex;gap:6px;margin-top:8px}#flTask .foot button{flex:1;margin:0}
  #flRing{position:absolute;left:50%;bottom:24%;transform:translateX(-50%);width:96px;height:96px;z-index:3;pointer-events:none}
  #flTask .clk,#flTask .gl{display:none;font-size:12px;color:#16213a;margin-top:2px}
  @media (max-width:700px){body.onfloor .side{display:none}#flGoals,#flClock{display:none}#flTask .clk,#flTask .gl{display:block}
    #flTask{left:12px;right:68px;width:auto;top:calc(76px + env(safe-area-inset-top,0px));font-size:13px;padding:9px 11px}#flTask .code{font-size:26px;margin:2px 0}
    #flTask .hold{padding:10px;margin-top:8px}#flTask .roles button{font-size:11px;padding:2px 6px}#flRing{bottom:34%;width:80px;height:80px}
    body:has(#gps:not([hidden])) #flTask{top:calc(128px + env(safe-area-inset-top,0px))}}`;
  document.head.appendChild(css);
  const mk = (id, tag = 'div') => { const e = document.createElement(tag); e.id = id; e.hidden = true; return e; };
  const goalsEl = mk('flGoals'); goalsEl.className = 'flgoals'; $('side').appendChild(goalsEl);
  $('app').append(mk('flClock'), mk('flTask'), mk('flRing'));
  $('flRing').innerHTML = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="rgba(22,33,58,.55)" stroke="#fff" stroke-opacity=".25" stroke-width="10"/><circle id="flZone" cx="50" cy="50" r="42" fill="none" stroke="#3ddc84" stroke-opacity=".45" stroke-width="10" transform="rotate(-90 50 50)"/><circle id="flArc" cx="50" cy="50" r="42" fill="none" stroke="#f2c230" stroke-width="10" stroke-linecap="round" transform="rotate(-90 50 50)" stroke-dasharray="0 264"/><text id="flRingT" x="50" y="57" text-anchor="middle" font-size="20" font-weight="700" fill="#fff">HOLD</text></svg>';
  const t = $('flTask');
  t.addEventListener('pointerdown', e => { if (e.target.closest('.hold')) { e.preventDefault(); startHold(); } });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => t.addEventListener(ev, e => { if (e.target.closest?.('.hold')) release(); }));
  t.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ch) { F.choice = b.dataset.ch; paint(); }
    else if (b.dataset.role) { F.role = b.dataset.role; if (!F.task) F.askT = 0; paint(); }
    else if (b.dataset.act === 'out') clockOut(true);
    else if (b.dataset.act === 'finish') clockOut(false);
    else if (b.dataset.act === 'stop') end();
  });
  addEventListener('keyup', e => { if (e.code === 'KeyE') release(); });
  const bc = $('bCar'); bc.addEventListener('pointerdown', () => { if (F.ready && !F.hold) { startHold(); F.lastPtr = performance.now(); } });
  ['pointerup', 'pointercancel'].forEach(ev => bc.addEventListener(ev, () => { if (F.hold) { F.lastPtr = performance.now(); release(); } }));
}
async function clockOut(early) {
  const s = F.shift; if (!s) return;
  if (early && !(await dialog('Clock out now?', 'You are paid for the time worked and the tasks done so far. Leaving without clocking out counts as absent.', [{ label: 'Clock out', value: true }, { label: 'Keep working', value: false }]))) return;
  F.early = early; await finish(s, early); await G.refreshWork?.();
}
function paint() {
  const on = !!F.mode;
  ['flGoals', 'flClock', 'flTask'].forEach(id => ($(id).hidden = !on)); if (!on) { $('flRing').hidden = true; return; }
  const site = floorSite(), st = curStep(), tg = target(st), s = F.shift;
  $('flGoals').innerHTML = `<h2>Shift goals</h2><ul>${goals().map(g => `<li class="${g.done ? 'ok' : ''}"><span>${g.done ? '✓ ' : ''}${esc(g.label)}</span><i>${esc(g.txt)}</i></li>`).join('')}</ul><canvas id="flMap" width="300" height="210"></canvas>`;
  const pw = powerNow(), [ph, mult] = phaseOf();
  const head = `<div class="flh"><span>${esc(F.mode === 'build' ? G.siteName?.(F.site) || F.plot?.name : FLOORS[site]?.name || s?.title || 'Shift')}</span><span>✔ ${F.ok} · ✖ ${F.fails}${F.combo > 1 ? ` · ×${F.combo}` : ''}</span></div>`;
  let body;
  if (st) {
    const i = F.step, n = F.task.steps.length, qty = F.task.qty > 1 ? `${F.task.qty} × ` : '';
    const what = st.act === 'pick' && F.task.item ? `${ACT[st.act]} ${qty}${name(F.task.item)}` : st.label;
    const ch = needsChoice(st) ? `<div class="ch">${F.task.choices.map(c => `<button class="mini-btn ghost ${F.choice === c ? 'on' : ''}" data-ch="${esc(c)}">${esc(st.act === 'pack' ? `Box ${c}` : name(c))}</button>`).join('')}</div>` : '';
    const dist = tg?.ok ? Math.hypot(tg.x - G.player.pos.x, tg.z - G.player.pos.z) : null;
    body = `<small>${esc(F.task.info || '')}</small><div class="code">${esc(st.code)}</div><div class="what">${esc(what)}</div>
      <small>Step ${i + 1} of ${n}${dist !== null ? ` · ${dist < 2.2 ? 'You are here' : `${Math.round(dist)} m · follow the arrows`}` : ` · ${esc(tg?.why || '')}`}</small>${ch}
      <button class="hold" ${F.ready && !F.busy ? '' : 'disabled'}>${F.busy ? 'Checking…' : F.ready ? `Hold: ${esc(ACT[st.act] || st.act)}` : 'Walk to the station'}</button>`;
  } else body = `<div class="what" style="margin-top:6px">${esc(F.busy ? 'Getting your next task…' : F.idle || 'Getting your next task…')}</div>`;
  const chips = site ? `<div class="chips"><span class="${pw ? '' : 'bad'}">${pw ? '⚡ Power on' : '⚡ NEPA: no light'}</span>${F.idle.includes('Diesel') ? '<span class="bad">⛽ Diesel short</span>' : ''}${mult > 1 ? `<span>${esc(ph)} ×${mult}</span>` : ''}</div>` : '';
  const roles = site === 'depot' ? `<div class="roles">${['all', 'receive', 'pick', 'pack', 'dispatch'].map(r => `<button class="chip ${F.role === r ? 'on' : ''}" data-role="${r}">${r[0].toUpperCase() + r.slice(1)}</button>`).join('')}</div>` : '';
  const over = s && Date.now() >= new Date(s.ends_at) - 5000;
  const foot = F.mode === 'build' ? '<div class="foot"><button class="chip" data-act="stop">Stop working</button></div>'
    : `<div class="foot">${over ? '<button class="mini-btn" data-act="finish">Finish shift: get paid</button>' : '<button class="chip" data-act="out">Clock out early</button>'}</div>`;
  const gl = goals(), clk = `<div class="clk">${$('flClock').innerHTML}</div><div class="gl">Goals ${gl.filter(g => g.done).length}/${gl.length}: ${esc(gl.find(g => !g.done)?.label || 'all done')}</div>`;
  $('flTask').innerHTML = head + clk + body + chips + roles + foot;
  drawMini();
}
function paintClock() {
  if (!F.mode) return;
  const s = F.shift, [ph, mult] = phaseOf(), left = s ? Math.ceil((new Date(s.ends_at) - Date.now()) / 60000) : null;
  const clk = $('flTask').querySelector('.clk');
  $('flClock').innerHTML = `<b>${hh(cityHourAt(Date.now()))}</b> · ${esc(ph)}${mult > 1 ? ` ×${mult}` : ''}${left !== null ? ` · ${left > 0 ? `${left} city hr left` : 'shift over: finish at the door'}` : ' · self-build'}`;
  if (clk) clk.innerHTML = $('flClock').innerHTML;
}
function drawMini() {
  const cv = $('flMap'); if (!cv) return; const h = here(), g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
  const site = h.site, f = FLOORS[site];
  if (!f) { cv.hidden = !curStep(); const tg = target(curStep()); g.fillStyle = '#16213a'; g.font = '600 26px system-ui'; g.textAlign = 'center'; g.fillText(tg?.ok ? `${Math.round(Math.hypot(tg.x - G.player.pos.x, tg.z - G.player.pos.z))} m to go` : 'Follow the GPS', 150, 115); return; }
  const k = Math.min(cv.width / (f.W + 2), cv.height / (f.D + 2)), X = x => cv.width / 2 + (x - h.ox) * k, Z = z => cv.height / 2 + (z - h.oz) * k;
  g.fillStyle = '#f7f5ee'; g.fillRect(X(h.ox - f.W / 2), Z(h.oz - f.D / 2), f.W * k, f.D * k);
  g.fillStyle = '#b8bcbe'; (h.room?.boxes || []).forEach(o => { if (o.maxX - o.minX < f.W) g.fillRect(X(o.minX), Z(o.minZ), (o.maxX - o.minX) * k, (o.maxZ - o.minZ) * k); });
  const st = curStep();
  f.stations.forEach(s => { const hit = st && !st.w && st.code === s.code; g.fillStyle = hit ? '#1d8a4a' : '#16213a'; g.fillRect(X(h.ox + s.x) - (hit ? 5 : 2.5), Z(h.oz + s.z) - (hit ? 5 : 2.5), hit ? 10 : 5, hit ? 10 : 5); });
  if (F.path.length > 1) { g.strokeStyle = '#d9a936'; g.lineWidth = 4; g.beginPath(); F.path.forEach((q, i) => g[i ? 'lineTo' : 'moveTo'](X(q.x), Z(q.z))); g.stroke(); }
  g.fillStyle = '#c9472f'; g.beginPath(); g.arc(X(G.player.pos.x), Z(G.player.pos.z), 6, 0, 7); g.fill();
}

/* ================= every frame ================= */
let paintT = 0, clockT = 0, fixT = 30, t0 = 0;
export function updateFloors(dt) {
  if (!G.started) return;
  t0 += dt; fixT += dt; if (fixT > 30) { fixT = 0; cityFixes(); }
  const cur = (G.work?.shifts || []).find(s => s.status === 'on' && (s.meta?.floor || s.meta?.site));
  if (cur && (F.mode !== 'shift' || F.sid !== cur.id)) begin('shift', { sid: cur.id, shift: cur, site: cur.meta?.site || null });
  else if (F.mode === 'shift' && !cur) end();
  if (F.mode === 'build' && F.plot && Math.hypot(G.player.pos.x - F.plot.x, G.player.pos.z - F.plot.z) > 70) { G.toast('You left the building site'); end(); }
  if (!F.mode) return;
  if (!F.task && !F.busy && performance.now() - F.askT > (F.idle ? 5000 : 300)) ask();
  const st = curStep(), tg = target(st), p = G.player.pos;
  const d = tg?.ok ? Math.hypot(tg.x - p.x, tg.z - p.z) : 1e9, was = F.ready;
  F.ready = !!st && d < 2.2 && !F.busy && !G.player.car;
  if (F.hold) {
    F.hold.t = (performance.now() - F.hold.t0) / 1000;
    if (d > 2.6) failStep('You walked off the station. Do that step again.');
    else if (F.hold.t > F.hold.need + 1.5) failStep('Held too long. The load slipped: do it again.');
  }
  // route
  F.pathT -= dt;
  if (F.pathT <= 0) {
    F.pathT = .3; F.path = [];
    if (tg?.ok) F.path = tg.h?.room ? route({ x: p.x, z: p.z }, { x: tg.x, z: tg.z }, tg.h.room) : [{ x: p.x, z: p.z }, { x: tg.x, z: tg.z }];
    if (tg?.ok && !tg.h && d > 30 && F.gps !== st.code + F.task.id) { F.gps = st.code + F.task.id; setDestination(tg.x, tg.z, st.label); }
    if (tg && !tg.ok && tg.door && here().site === 'city' && F.gps !== tg.door) { const dd = G.city.doors.find(o => o.name === tg.door); if (dd) { F.gps = tg.door; setDestination(dd.pos.x, dd.pos.z, tg.door); } }
  }
  if (tg?.ok) {
    let pts = F.path;
    if (!tg.h && pts.length === 2) { const [a, b] = pts, L = Math.hypot(b.x - a.x, b.z - a.z); if (L > 16) pts = [a, { x: a.x + (b.x - a.x) * 16 / L, z: a.z + (b.z - a.z) * 16 / L }]; }
    if (d > 1) drawArrows(t0, pts); else hideArrows();
    showRing(tg);
  } else hideArrows();
  // hold ring
  const rg = $('flRing'); rg.hidden = !F.hold && !F.ready;
  if (!rg.hidden) {
    const need = F.hold?.need || +st?.hold || 1, full = need + 1.5, C = 264, tt = F.hold?.t || 0;
    $('flArc').setAttribute('stroke-dasharray', `${C * Math.min(1, tt / full)} ${C}`);
    $('flZone').setAttribute('stroke-dasharray', `0 ${C * need / full} ${C * 1.2 / full} ${C}`);
    $('flArc').setAttribute('stroke', tt >= need ? '#3ddc84' : '#f2c230');
    $('flRingT').textContent = !F.hold ? 'HOLD E' : tt >= need ? 'LET GO' : 'HOLD';
  }
  paintT -= dt; clockT -= dt;
  if (was !== F.ready || paintT <= 0) { paintT = .5; paint(); }
  if (clockT <= 0) { clockT = 1; paintClock(); }
}
function provider(p, out, ins) {
  if (F.ready && curStep()) out(-1, { label: `Hold: ${curStep().label}`, run: () => { if (performance.now() - F.lastPtr > 600) startHold(); } });
  if (!ins || F.mode) return;
  const site = BY_DOOR[ins.door?.name]; if (!site) return;
  const d = Math.hypot(p.x - ins.spawn.x, p.z - ins.spawn.z);
  const booked = (G.work?.shifts || []).some(s => s.place === ins.door.name && ['scheduled', 'on'].includes(s.status));
  if (!booked && d < 3) out(d, { label: `Walk-in gig here (2 city hours)`, run: () => gig(site) });
}
async function gig(site) {
  try { await srv.gig(site); await G.refreshWork?.(); G.toast(`You're on the floor. Your phone shows the next task.`); G.Sound?.ding?.(); }
  catch (e) { G.toast(e.message); }
}

/* the owner works their own building site, task by task */
export function startSiteWork(plot) {
  if (F.mode === 'shift') return G.toast('Finish your shift first');
  begin('build', { site: plot.key, plot }); G.toast(`On site at ${G.siteName?.(plot.key) || plot.name}. Follow the arrows: collect at the gate, then build each piece.`);
}

/* ================= the city as the yard leaves it ================= */
const waste = [], stalls = [];
function setupCity() {
  const m = new THREE.MeshLambertMaterial({ color: 0x5b4a3a }), m2 = new THREE.MeshLambertMaterial({ color: 0x6b4a33 }), geo = new THREE.IcosahedronGeometry(1, 0);
  WASTE.forEach(([x, z]) => { const g = new THREE.Group(); for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(geo, k % 2 ? m : m2); b.position.set((k - 2) * .45, .25, (k % 3 - 1) * .4); b.scale.set(.55, .35, .5); g.add(b); } g.position.set(x, G.gY?.(x, z) || 0, z); G.scene.add(g); waste.push(g); });
  STALLS.forEach(([x, z]) => { const g = new THREE.Group(); const pl = new THREE.Mesh(new THREE.BoxGeometry(2.2, .08, .9), m2); pl.position.set(0, .45, 0); pl.rotation.z = .35; const post = new THREE.Mesh(new THREE.BoxGeometry(.1, .9, .1), m2); post.position.set(.9, .45, .3); g.add(pl, post); g.position.set(x, G.gY?.(x, z) || 0, z); G.scene.add(g); stalls.push(g); });
}
async function cityFixes() {
  let keys = []; try { keys = ((await srv.cityFixes()) || []).map(r => r.key || r); } catch { return; }
  const has = k => keys.includes(k), pots = G.out?.potholes || [];
  POTHOLES.forEach((_, i) => {
    const h = pots[i], fixed = has(`pothole:PH-${String(i + 1).padStart(2, '0')}`); if (!h) return;
    h.meshes?.forEach(m => (m.visible = !fixed)); h.r0 ??= h.r; h.r = fixed ? 0 : h.r0;
    const zn = G.traffic?.zones?.find(o => o.x === h.x && o.z === h.z); if (zn) { zn.r0 ??= zn.r; zn.r = fixed ? 0 : zn.r0; }
  });
  waste.forEach((g, i) => (g.visible = !has(`waste:WS-${i + 1}`)));
  stalls.forEach((g, i) => (g.children[0].rotation.z = has(`stall:ST-${i + 1}`) ? 0 : .35));
}

/* shop shelves: take a staple off the real shelf and pay for it */
function shelfProvider(p, out, ins) {
  const site = ins && BY_DOOR[ins.door?.name]; if (!site || !['freshmart', 'nyanya_market'].includes(site) || F.ready) return;
  const ox = INT_X + ins.slot * INT_GAP, oz = INT_Z;
  FLOORS[site].stations.filter(s => s.kind === 'shelf' && ITEMS[s.item]).forEach(s => {
    const d = Math.hypot(p.x - ox - s.x, p.z - oz - s.z);
    if (d < 1.6) out(d + .2, { label: `Buy ${ITEMS[s.item].name.toLowerCase()} (${naira(priceOf(ITEMS[s.item]))})`, run: () => takeShelf(site, s.item) });
  });
}
async function takeShelf(site, it) {
  const cost = priceOf(ITEMS[it]); if (eco.money < cost) return G.toast('Not enough money');
  if (online()) { try { if ((await srv.shelfTake(site, it)) < 0) return G.toast('That shelf is empty. Staff restock it from the back.'); } catch (e) { return G.toast(e.message); } }
  spend(cost); addItem(it); G.Sound?.buy?.(false); G.toast(`Bought ${ITEMS[it].name.toLowerCase()}. It's in your bag.`);
}

export function initFloors() {
  G.buildFloor = buildFloor; G.startSiteWork = startSiteWork; G.floor = F;
  setupHud(); setupMarks(); setupCity();
  G.actionProviders.push(provider, shelfProvider);
}

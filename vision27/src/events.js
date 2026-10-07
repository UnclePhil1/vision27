import * as THREE from 'three';
import { G, dialog, fade, naira } from './game.js';
import { eco, spend } from './economy.js';
import { Man, manPalette, menReady, randomCharacter } from './characters.js';
import { openRoute, gridPath, nearestNode, makeCar } from './cars.js';
import { rand, pick, damp, angleLerp, clamp } from './util.js';
import { S, N, CURB } from './consts.js';

/* Things that happen: crashes (not often), fires and the fire service, police
   patrols, a checkpoint, arrests and potholes. */
const $ = id => document.getElementById(id);
const E = { fires: [], crashes: [], officers: [], timers: { crash: 80 + rand() * 60, fire: 140 + rand() * 80 }, wantedT: 0, chase: null, cpCooldown: 0, potT: 0 };
export const events = E;

/* ---------- particles for flames and smoke ---------- */
const flameTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const r = g.createRadialGradient(32, 40, 2, 32, 34, 30); r.addColorStop(0, 'rgba(255,250,200,1)'); r.addColorStop(.35, 'rgba(255,170,40,.9)'); r.addColorStop(.7, 'rgba(230,60,10,.5)'); r.addColorStop(1, 'rgba(120,20,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const smokeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const r = g.createRadialGradient(32, 32, 2, 32, 32, 30); r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
class Fire {
  constructor(pos, size = 1) {
    this.pos = pos.clone(); this.size = size; this.k = 1; this.t = 0; this.g = new THREE.Group(); G.scene.add(this.g);
    this.flames = Array.from({ length: 22 }, (_, i) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.userData = { ph: rand(), ox: (rand() - .5) * 2.4 * size, oz: (rand() - .5) * 2.4 * size }; this.g.add(s); return s; });
    this.smoke = Array.from({ length: 16 }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x3a3836, depthWrite: false, transparent: true })); s.userData = { ph: rand(), ox: (rand() - .5) * 2 * size, oz: (rand() - .5) * 2 * size }; this.g.add(s); return s; });
    this.scorch = new THREE.Mesh(new THREE.CircleGeometry(2.6 * size, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x141210, transparent: true, opacity: 0, depthWrite: false })); this.scorch.position.set(pos.x, pos.y + .03, pos.z); G.scene.add(this.scorch);
  }
  update(dt) {
    this.t += dt; const k = this.k;
    this.scorch.material.opacity = Math.min(.7, this.scorch.material.opacity + dt * .05);
    this.flames.forEach(s => { const u = s.userData; u.ph = (u.ph + dt * (1.1 + rand() * .3)) % 1; const h = u.ph * 4.5 * this.size; s.position.set(this.pos.x + u.ox * (1 - u.ph * .6), this.pos.y + .3 + h, this.pos.z + u.oz * (1 - u.ph * .6)); const sc = (1.8 - u.ph * 1.3) * this.size * (.4 + .6 * k) * (k > .02 ? 1 : 0); s.scale.set(sc, sc * 1.4, 1); s.material.opacity = (1 - u.ph) * Math.min(1, k * 2); });
    this.smoke.forEach(s => { const u = s.userData; u.ph = (u.ph + dt * .12) % 1; s.position.set(this.pos.x + u.ox + u.ph * 3, this.pos.y + 2 + u.ph * 18 * this.size, this.pos.z + u.oz + u.ph * 2); const sc = (2 + u.ph * 7) * this.size; s.scale.set(sc, sc, 1); s.material.opacity = (1 - u.ph) * .55 * Math.min(1, k + .25 * (this.t < 200 ? 1 : 0)); });
  }
  dispose() { G.scene.remove(this.g); G.scene.remove(this.scorch); }
}
const waterTex = smokeTex;

/* ---------- setup ---------- */
export function initEvents(out) {
  E.out = out;
  out.potholes.forEach(p => G.traffic.zones.push({ x: p.x, z: p.z, r: 2.2, limit: 6 }));
  const cp = out.spots.checkpoint; G.traffic.zones.push({ x: cp.x, z: cp.z, r: 12, limit: 3.5 });
  // patrol car
  E.patrol = G.traffic.add(G.patrolRoute, 'police', 40); E.patrol.noTake = true; E.patrol.police = true; E.patrol.vmax = 9;
  // checkpoint van
  const v = cp.van; const van = G.traffic.addParked('police', 0, v.x, CURB, v.z, v.yaw); van.noTake = true; van.police = true;
  G.actionProviders.push(actions);
}
export function spawnOfficers() {
  const cp = E.out.spots.checkpoint;
  cp.officers.forEach(o => {
    const ch = menReady() ? new Man('suit', manPalette({ shirt: 0x15171a, shirt2: 0x15171a, pants: 0x15171a, tie: 0x15171a, details: 0x1b2f5c }), { type: 'cap', color: 0x15171a }) : randomCharacter(false);
    ch.root.position.set(o.x, CURB, o.z); ch.root.rotation.y = o.yaw; G.scene.add(ch.root); E.officers.push({ ch, home: new THREE.Vector3(o.x, CURB, o.z), yaw: o.yaw });
  });
}
function actions(p, out) {
  if (G.player.car || G.region !== 'city') return;
  E.officers.forEach(o => out(Math.hypot(p.x - o.home.x, p.z - o.home.z) - .8, { label: 'Greet the officer', run: () => { const l = pick(['Good afternoon, officer!', 'Officer, well done o.']); G.say(l, G.player.pos); setTimeout(() => G.say(pick(['Good afternoon. Move on, safe journey.', 'How far? Make you waka safe.', 'No wahala. Keep moving.']), o.home, 3), 1200); } }));
}

/* ---------- each frame ---------- */
export function updateEvents(dt) {
  const P = G.player, p = P.pos;
  E.officers.forEach(o => o.ch.update(dt, 0));
  if (G.region !== 'city' || G.inTravel) { E.fires.forEach(f => f.fire.update(dt)); return; }
  // timers
  E.timers.crash -= dt; E.timers.fire -= dt;
  if (E.timers.crash <= 0) { E.timers.crash = 200 + rand() * 160; if (!E.crashes.length) startCrash(); }
  if (E.timers.fire <= 0) { E.timers.fire = 260 + rand() * 200; if (E.fires.length < 1) startFire(); }
  updateCrashes(dt); updateFires(dt); updatePolice(dt); checkpoint(dt); potholes(dt);
}

/* ---------- accidents ---------- */
function startCrash(forceCar) {
  const p = G.player.pos;
  const cands = G.traffic.cars.filter(c => c.mode === 'ai' && !c.police && !c.lineBus && c.v > 5 && Math.hypot(c.pos.x, c.pos.y) > 40);
  const c = forceCar || cands.filter(c => { const d = Math.hypot(c.pos.x - p.x, c.pos.y - p.z); return d > 25 && d < 110; }).sort(() => rand() - .5)[0];
  if (!c) return;
  const cars = [c];
  const behind = G.traffic.cars.find(o => o !== c && o.mode === 'ai' && o.route === c.route && ((c.s - o.s + c.route.total) % c.route.total) < 14);
  if (behind) cars.push(behind);
  cars.forEach((x, i) => { x.mode = 'crashed'; x.v = 0; x.yaw += (i ? -.25 : .45); x.mesh.rotation.y = x.yaw; x.mesh.rotation.z = i ? 0 : .06; x.fwd.set(Math.sin(x.yaw), Math.cos(x.yaw)); });
  const d = Math.hypot(c.pos.x - p.x, c.pos.y - p.z), pan = panOf(c.pos.x, c.pos.y);
  G.Sound.crash(clamp(1.4 - d / 90, .15, 1), pan);
  const smoke = new Fire(new THREE.Vector3(c.pos.x + c.fwd.x * c.len / 2, 0, c.pos.y + c.fwd.y * c.len / 2), .35); smoke.k = 0;
  // people come to look
  const side = new THREE.Vector2(c.fwd.y, -c.fwd.x), crowd = [];
  for (let i = 0; i < 4; i++) { const ch = randomCharacter(); const o = 7 + rand() * 2, a = (rand() - .5) * 6; ch.root.position.set(c.pos.x + side.x * o + c.fwd.x * a, CURB, c.pos.y + side.y * o + c.fwd.y * a); ch.root.rotation.y = Math.atan2(-side.x, -side.y); G.scene.add(ch.root); crowd.push(ch); }
  setTimeout(() => G.sayAt?.(pick(['Ehen! Accident o!', 'Jesus! Call ambulance!', 'Na brake failure o!', 'Make una no crowd am!']), crowd[0].root.position), 900);
  const burning = rand() < .2;
  E.crashes.push({ cars, smoke, crowd, t: 0, amb: null, burning });
  if (burning) setTimeout(() => startFire({ pos: new THREE.Vector3(c.pos.x, 0, c.pos.y), car: c, size: .7 }), 6000);
  if (d < 140) G.toast('There has been an accident nearby');
}
function updateCrashes(dt) {
  for (let i = E.crashes.length - 1; i >= 0; i--) {
    const k = E.crashes[i]; k.t += dt; k.smoke.update(dt); k.crowd.forEach(ch => ch.update(dt, 0));
    const c = k.cars[0];
    if (!k.amb && k.t > 10) {
      const a = G.traffic.add(c.route, 'ambulance', (c.s - 90 + c.route.total) % c.route.total); a.mode = 'script'; a.siren = true; a.noTake = true; a.vmax = 13; k.amb = a;
    }
    if (k.amb) {
      const a = k.amb, gap = (c.s - a.s + a.route.total) % a.route.total;
      const { limit } = G.traffic.limitFor(a, null);
      const want = k.t < 40 ? Math.min(13, Math.max(0, (gap - 9) * .8)) : Math.min(limit, 12);
      if (k.t >= 40) a.siren = false;
      a.v = damp(a.v, want, 3, dt); a.s = (a.s + a.v * dt) % a.route.total; G.traffic.place(a, false);
    }
    if (k.t > 40 && !k.cleared) { k.cleared = true; k.cars.forEach(x => { x.mesh.rotation.z = 0; if (x.mode === 'crashed') x.mode = 'ai'; }); k.crowd.forEach(ch => G.scene.remove(ch.root)); }
    if (k.t > 70) { k.smoke.dispose(); if (k.amb) G.traffic.remove(k.amb); E.crashes.splice(i, 1); }
  }
}

/* ---------- fires and the fire service ---------- */
function startFire(at) {
  const p = G.player.pos;
  let pos, size = 1.2, label;
  if (at) { pos = at.pos; size = at.size || 1; label = 'A car is on fire'; }
  else {
    const doors = G.city.doors.filter(d => (d.kind === 'house' || d.kind === 'lobby' || d.kind === 'shop') && !(d.kind === 'house' && G.myHouseIdx?.() === d.house));
    const near = doors.filter(d => { const dd = Math.hypot(d.pos.x - p.x, d.pos.z - p.z); return dd > 30 && dd < 160; });
    const d = pick(near.length ? near : doors);
    pos = new THREE.Vector3(d.pos.x - Math.sin(d.yaw) * 3, CURB, d.pos.z - Math.cos(d.yaw) * 3); size = d.kind === 'lobby' ? 1.8 : 1.3;
    label = d.kind === 'house' ? 'A house is on fire' : d.kind === 'shop' ? `Fire at ${d.name}` : `Fire at ${d.name}`;
  }
  const fire = new Fire(pos, size), f = { fire, pos, t: 0, truck: null, out: false, car: at?.car };
  E.fires.push(f); G.Sound.alarm();
  const dist = Math.hypot(pos.x - p.x, pos.z - p.z);
  if (dist < 200) G.toast(`${label}! The fire service is on the way.`);
  setTimeout(() => sendTruck(f), 3000);
  // people shout
  setTimeout(() => G.sayAt?.(pick(['Fire! Fire!', 'Call fire service!', 'Bring water, bring water!', 'Everybody comot!']), pos), 1500);
}
function nearestLanePoint(x, z) {
  // closest road centre line, then the lane on the fire's side
  let best = null;
  for (let k = -N; k <= N; k++) {
    const zc = k * S, dz = z - zc; if (Math.abs(x) <= N * S + 8) { const d = Math.abs(dz); if (!best || d < best.d) best = { d, x: clamp(x, -N * S, N * S), z: zc + Math.sign(dz || 1) * 6, along: 'x' }; }
    const xc = k * S, dx = x - xc; if (Math.abs(z) <= N * S + 8) { const d = Math.abs(dx); if (!best || d < best.d) best = { d, x: xc + Math.sign(dx || 1) * 6, z: clamp(z, -N * S, N * S), along: 'z' }; }
  }
  return best;
}
function sendTruck(f) {
  const base = E.out.spots.fire, lane = nearestLanePoint(f.pos.x, f.pos.z), endNode = nearestNode(lane.x, lane.z);
  const nodes = gridPath([N, 0], endNode);
  const route = openRoute([base.x, base.z - 3], nodes, [lane.x, lane.z], 3);
  const t = G.traffic.add(route, 'fire', 0); t.mode = 'script'; t.siren = true; t.noTake = true; t.s = 0; t.ghost = 999;
  f.truck = t; f.water = [];
}
function updateFires(dt) {
  const p = G.player.pos;
  for (let i = E.fires.length - 1; i >= 0; i--) {
    const f = E.fires[i]; f.t += dt; f.fire.update(dt);
    const t = f.truck;
    if (t && t.mode === 'script') {
      const left = t.route.total - t.s;
      const want = left < 2 ? 0 : Math.min(15, left * .9 + 2);
      t.v = damp(t.v, want, 2, dt); t.s = Math.min(t.route.total - .01, t.s + t.v * dt); G.traffic.place(t, false);
      if (left < 2.5 && !f.spraying) { f.spraying = true; t.v = 0; G.toast('The fire service is putting out the fire'); }
    }
    if (f.spraying && f.fire.k > 0) {
      f.fire.k = Math.max(0, f.fire.k - dt * .06);
      // water jet: a few sprites flying from the truck to the fire
      if (f.water.length < 24) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: waterTex, color: 0xcfe6f2, transparent: true, depthWrite: false })); s.userData.t = 0; G.scene.add(s); f.water.push(s); }
      f.water.forEach(s => { s.userData.t = (s.userData.t + dt * .9) % 1; const u = s.userData.t, a = new THREE.Vector3(t.pos.x, 2.6, t.pos.y), b = f.pos.clone().setY(1.5); s.position.lerpVectors(a, b, u); s.position.y += Math.sin(u * Math.PI) * 4; s.scale.setScalar(.5 + u); s.material.opacity = .7 * (1 - u * .5); });
    }
    if (!f.spraying && f.t > 120) f.fire.k = Math.max(0, f.fire.k - dt * .03);
    if (f.fire.k <= 0 && !f.out) { f.out = true; f.outT = 0; f.water?.forEach(s => G.scene.remove(s)); f.water = []; if (t) { t.siren = false; } if (f.car) { f.car.mesh.traverse(m => { if (m.isMesh && m.material.color) { m.material = m.material.clone(); m.material.color.setHex(0x1c1a18); } }); } }
    if (f.out) { f.outT += dt; if (f.outT > 25) { if (t) G.traffic.remove(t); f.fire.dispose(); E.fires.splice(i, 1); continue; } }
    // too close to the flames
    const d = Math.hypot(p.x - f.pos.x, p.z - f.pos.z);
    if (d < 3.2 * f.fire.size && f.fire.k > .2 && !G.player.car) { G.energyHit?.(dt * 8); if (!f.warned) { f.warned = true; G.toast('Too hot! Move back from the fire.'); } }
  }
}
export function nearestFire(p) { let best = 1e9; E.fires.forEach(f => { if (f.fire.k > .05) best = Math.min(best, Math.hypot(p.x - f.pos.x, p.z - f.pos.z) / (f.fire.size)); }); return best; }
export function nearestSiren(p) { let best = 1e9; G.traffic.cars.forEach(c => { if (c.siren) best = Math.min(best, Math.hypot(p.x - c.pos.x, p.z - c.pos.y)); }); return best; }

/* ---------- police: wanted level, chase, arrest ---------- */
export function addWanted(n, why) {
  eco.wanted = Math.min(3, (eco.wanted || 0) + n); E.wantedT = 0; paintWanted();
  if (why) G.toast(why);
}
function paintWanted() { const w = $('wanted'); if (!w) return; w.hidden = !eco.wanted; w.textContent = '★'.repeat(eco.wanted || 0) + '☆'.repeat(3 - (eco.wanted || 0)); }
function updatePolice(dt) {
  const P = G.player, p = P.pos, pc = E.patrol;
  if (!pc) return;
  const dist = Math.hypot(pc.pos.x - p.x, pc.pos.y - p.z);
  if (eco.wanted > 0) {
    E.wantedT += dt;
    const seen = dist < 60 || E.officers.some(o => o.home.distanceTo(p) < 25);
    if (seen) E.wantedT = 0;
    if (E.wantedT > 45) { eco.wanted--; E.wantedT = 0; paintWanted(); if (!eco.wanted) G.toast('The police have stopped looking for you'); }
    if (seen && pc.mode === 'ai') { pc.mode = 'chase'; pc.siren = true; E.chase = { t: 0, close: 0 }; G.sayAt?.('Police! Stop there!', new THREE.Vector3(pc.pos.x, 0, pc.pos.y)); G.Sound.speak('Police! Stop there!', { pitch: .8 }); }
  }
  if (pc.mode === 'chase') {
    const ch = E.chase; ch.t += dt;
    const dx = p.x - pc.pos.x, dz = p.z - pc.pos.y, want = Math.atan2(dx, dz);
    let diff = want - pc.yaw; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    G.drive(pc, dt, dist < 7 ? -.2 : 1, clamp(-diff * 2.2, -1, 1), dist < 6, false);
    pc.steer = clamp(-diff, -.5, .5);
    const caught = (!P.car && dist < 5) || (P.car && dist < 7 && Math.abs(P.car.v) < 2.5);
    ch.close = caught ? ch.close + dt : 0;
    if (ch.close > 1.5) { arrest(); return; }
    if (dist > 130 || eco.wanted <= 0) { ch.far = (ch.far || 0) + dt; if (ch.far > 8 || eco.wanted <= 0) endChase(); } else ch.far = 0;
  }
  // officers at the checkpoint catch wanted people walking past
  if (eco.wanted > 0 && !P.car && E.officers.some(o => o.home.distanceTo(p) < 3)) arrest();
}
function endChase() {
  const pc = E.patrol; pc.siren = false; E.chase = null;
  // rejoin the patrol route at the closest point
  let bi = 0, bd = 1e9; pc.route.pts.forEach((q, i) => { const d = (q[0] - pc.pos.x) ** 2 + (q[1] - pc.pos.y) ** 2; if (d < bd) { bd = d; bi = i; } });
  pc.s = pc.route.L[bi]; pc.idx = 0; pc.mode = 'ai';
  if (eco.wanted > 0) G.toast('You lost the police, for now');
}
export async function arrest(reason) {
  if (E.arresting) return; E.arresting = true;
  const P = G.player, fine = 10000, paid = Math.min(eco.money, fine);
  G.Sound.speak('You are under arrest.', { pitch: .8 });
  await fade(() => {
    if (P.car) { const c = P.car; G.leaveCar(true); returnCar(c); }
    eco.money -= paid; eco.wanted = 0; paintWanted();
    if (E.chase) endChase();
    const cell = E.out.spots.cell; G.teleport(cell.x, 0, cell.z, cell.yaw, false);
  }, 1500);
  await dialog('Police station', `${reason || 'You were arrested'}. You spent the night in the cell and paid a fine of ${naira(paid)}. Stay out of trouble.`, [{ label: 'OK', value: true }], { who: 'Desk officer' });
  E.arresting = false;
}
function returnCar(c) {
  c.mesh.rotation.z = 0;
  if (c.route && !c.owned) { c.mode = 'ai'; c.v = 0; c.s = rand() * c.route.total; c.idx = 0; G.traffic.place(c, true); }
  else if (c.home) { c.mode = 'parked'; c.pos.set(c.home.x, c.home.z); c.yaw = c.home.yaw; c.y = c.home.y; c.v = 0; G.traffic.sync(c); }
  else c.mode = 'parked';
  c.stolen = false;
}

/* ---------- checkpoint ---------- */
async function checkpoint(dt) {
  E.cpCooldown -= dt;
  const P = G.player, c = P.car, cp = E.out.spots.checkpoint;
  if (!c || E.cpCooldown > 0 || E.stopping) return;
  if (Math.hypot(P.pos.x - cp.x, P.pos.z - cp.z) > 9 || Math.abs(c.v) < .5) return;
  E.stopping = true; G.frozen = true; c.v = 0;
  G.Sound.speak('Good afternoon. Your particulars, please.', { pitch: .85 });
  const pickA = await dialog('Police checkpoint', 'Officer: "Good afternoon. Park well. Your particulars, please."', [
    { label: 'Show my papers', value: 'papers' }, { label: '"Officer, I no get papers"', value: 'none' }, { label: 'Drive off', value: 'run' }], { who: 'Police officer' });
  G.frozen = false; E.stopping = false; E.cpCooldown = 25;
  if (pickA === 'run') { addWanted(2, 'You drove off from a checkpoint. The police are after you!'); return; }
  if (c.owned) { G.Sound.speak('Everything is correct. Safe journey.', { pitch: .85 }); G.toast('Officer: "Everything correct. Safe journey!"'); return; }
  if (eco.wanted > 0 || c.stolen === 'hijack') { await arrest('This car was reported stolen'); return; }
  const fine = 5000;
  await dialog('Police checkpoint', `Officer: "This car no be your own and you no get papers. We go keep the car. You will pay ${naira(fine)} for driving without papers."`, [{ label: 'Pay and walk', value: true }], { who: 'Police officer' });
  spend(Math.min(fine, eco.money)); G.leaveCar(true); returnCar(c);
}

/* ---------- potholes ---------- */
function potholes(dt) {
  const c = G.player.car; E.potT -= dt; if (!c || E.potT > 0) return;
  for (const h of E.out.potholes) {
    if (Math.hypot(c.pos.x - h.x, c.pos.y - h.z) < h.r + .4 && Math.abs(c.v) > 4.5) { E.potT = .8; c.v *= .72; c.jolt = .4; G.shake = .5; G.Sound.thud(); if (Math.abs(c.v) > 10) G.toast('Pothole! Take it easy.'); break; }
  }
}
function panOf(x, z) { const cam = G.camera; if (!cam) return 0; const v = new THREE.Vector3(x, 0, z).sub(cam.position).normalize(), r = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion); return clamp(v.dot(r), -1, 1); }
export { panOf, startCrash, startFire };

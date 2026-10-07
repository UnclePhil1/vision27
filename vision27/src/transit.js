import * as THREE from 'three';
import { G, dialog, fade, naira } from './game.js';
import { routeFromNodes, rectLoop, pointAt, makeCar, CAR_COLORS } from './cars.js';
import { REG, ensureRegion, regionAt, makePlane } from './regions.js';
import { eco, spend, addTicket, useTicket, setOwnedCar } from './economy.js';
import { randomCharacter } from './characters.js';
import { Batch, canvasTex, damp, angleLerp, rand, pick } from './util.js';
import { HALF, CURB } from './consts.js';

/* Buses with stops, the motor park, road trips, flights, region visits and the car dealer. */
const $ = id => document.getElementById(id);
const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
const BOX = new THREE.BoxGeometry(1, 1, 1);
const STOP_NAMES = ['Wuse Stop', 'Garki Stop', 'Maitama Stop', 'Utako Stop', 'Jabi Stop', 'Asokoro Stop', 'Area 1 Stop', 'Gwarinpa Stop'];
export const FARES = { get bus() { return 300 * (G.fareMult?.() || 1); }, village: 3500, airport: 2500, flight: 45000 };
export const CAR_PRICES = { sedan: 250000, suv: 420000, keke: 120000, pickup: 380000 };

const T = { stops: [], buses: [], waitStop: null, coachMeshes: [], regionPeople: [], regionsReady: {}, out: null, dealerCars: [] };
export const transit = T;

function label(text, bg, fg, sub) {
  return new THREE.MeshLambertMaterial({ map: canvasTex(512, 128, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${sub ? 46 : 56}px "Fredoka", system-ui, sans-serif`; g.fillText(text, w / 2, sub ? 50 : h / 2, w - 30); if (sub) { g.font = '500 28px "Fredoka", system-ui, sans-serif'; g.fillText(sub, w / 2, 98, w - 30); } }, false) });
}

export function initTransit(out) {
  T.out = out;
  /* ---- city bus line on the ring road, curb lane, with stops ---- */
  const route = routeFromNodes(rectLoop(-2, -2, 2, 2), 6); T.route = route;
  const B = new Batch();
  for (let k = 0; k < 8; k++) {
    let s = route.total * (k + .5) / 8, [x, z, yaw] = pointAt(route, s);
    // keep stops away from junctions
    for (let tries = 0; tries < 30 && nearNode(x, z); tries++) { s += 3; [x, z, yaw] = pointAt(route, s); }
    const rx = -Math.cos(yaw), rz = Math.sin(yaw), sx = x + rx * 4.6, sz = z + rz * 4.6, face = Math.atan2(-rx, -rz);
    const g = new THREE.Group(); g.position.set(sx, CURB, sz); g.rotation.y = face;
    const b = new Batch(); b.add(BOX, 0x1d8a4a, 0, 2.6, 0, 0, 4.2, .12, 1.7); [[-1.9, -.65], [1.9, -.65]].forEach(([a, c]) => b.add(BOX, 0x8e9196, a, 1.3, c, 0, .1, 2.6, .1)); b.add(BOX, 0x8a6a4e, 0, .5, -.45, 0, 3.6, .1, .5); b.add(BOX, 0x9fc3d8, 0, 1.5, -.78, 0, 3.8, 1.8, .04);
    g.add(b.build(mat));
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(3, .75), label(STOP_NAMES[k], '#1d8a4a', '#ffffff')); sg.position.set(0, 3.1, .1); g.add(sg);
    const sg2 = sg.clone(); sg2.rotation.y = Math.PI; sg2.position.z = -.1; g.add(sg2);
    G.scene.add(g); G.addBox({ minX: sx - 1.2, maxX: sx + 1.2, minZ: sz - 1.2, maxZ: sz + 1.2, h: 3 });
    T.stops.push({ name: STOP_NAMES[k], s, x: sx, z: sz, face, pos: new THREE.Vector3(sx, CURB, sz) });
  }
  T.stops.sort((a, b) => a.s - b.s);
  for (let i = 0; i < 2; i++) {
    const c = G.traffic.add(route, 'bus', route.total * i / 2 + 5); c.mode = 'bus'; c.vmax = 9; c.dwell = 0; c.nextStop = 0; c.noTake = true; c.lineBus = true;
    T.buses.push(c);
  }
  /* ---- motor park coaches ---- */
  out.spots.coachBays.forEach(bay => { const m = makeCar('coach'); m.position.set(bay.x, 0, bay.z); m.rotation.y = bay.yaw; G.scene.add(m); G.addBox({ minX: bay.x - 1.4, maxX: bay.x + 1.4, minZ: bay.z - 5.6, maxZ: bay.z + 5.6, h: 3.4 }); T.coachMeshes.push({ m, bay }); const dg = new THREE.Mesh(new THREE.PlaneGeometry(2.4, .5), label(bay.dest === 'airport' ? 'AIRPORT' : 'KAUYE', '#16213a', '#f2c230')); dg.position.set(bay.x, 3.6, bay.z + (bay.yaw ? -5.6 : 5.6)); dg.rotation.y = bay.yaw; G.scene.add(dg); });
  /* ---- car dealer ---- */
  out.spots.dealer.forEach((d, i) => {
    const type = ['sedan', 'suv', 'pickup', 'keke'][i], c = G.traffic.addParked(type, pick(CAR_COLORS), d.x, .03, d.z, d.yaw);
    c.forSale = CAR_PRICES[type]; T.dealerCars.push(c);
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, .6), label(naira(c.forSale), '#f2c230', '#16213a')); tag.position.set(d.x, 2.6, d.z); tag.rotation.y = Math.PI; G.scene.add(tag); c.tag = tag;
  });
  if (eco.car) { const d = out.spots.dealer[0], c = G.traffic.addParked(eco.car.type, eco.car.color, d.x + 10, .03, d.z + 8, 0); c.owned = true; }
  G.actionProviders.push(actions);
}
function nearNode(x, z) { const nx = Math.round(x / 64) * 64, nz = Math.round(z / 64) * 64; return Math.abs(x - nx) < HALF + 8 && Math.abs(z - nz) < HALF + 8; }

/* ---------- actions the player can take near transit things ---------- */
function actions(p, out) {
  const P = G.player, rg = G.region;
  if (P.car) return;
  if (rg === 'city') {
    T.stops.forEach(st => out(Math.hypot(p.x - st.x, p.z - st.z) - .5, { label: T.waitStop === st ? `Waiting at ${st.name}` : `Wait for the bus (${naira(FARES.bus)})`, run: () => { T.waitStop = st; G.toast(`Waiting at ${st.name}. ${busEta(st)}`); } }));
    const tb = T.out.spots.ticketBooth; out(Math.hypot(p.x - tb.x, p.z - tb.z) - .5, { label: 'Buy a bus ticket', run: ticketBooth });
    T.coachMeshes.forEach(({ bay }) => out(Math.hypot(p.x - bay.x, p.z - (bay.z + (bay.yaw ? -6.5 : 6.5))) - .3, { label: `Board the bus to ${bay.dest === 'airport' ? 'the airport' : 'Kauye Village'}`, run: () => boardCoach(bay.dest) }));
    T.dealerCars.forEach(c => { if (c.forSale) out(Math.hypot(p.x - c.pos.x, p.z - c.pos.y) - 1.6, { label: `Buy this ${c.mesh.userData.type} (${naira(c.forSale)})`, run: () => buyCar(c) }); });
  } else {
    const R = T.regions?.[rg]; if (!R) return;
    if (R.stop && (rg === 'village' || rg === 'airport')) out(Math.hypot(p.x - R.stop.x, p.z - R.stop.z) - .5, { label: rg === 'village' ? `Bus back to Abuja (${naira(FARES.village)})` : `Shuttle to Abuja (${naira(FARES.airport)})`, run: () => busHome(rg) });
  }
}
function busEta(st) {
  let best = 1e9; T.buses.forEach(b => { let d = st.s - b.s; if (d < 0) d += T.route.total; best = Math.min(best, d); });
  return best < 30 ? 'The bus is almost here.' : `The bus is about ${Math.ceil(best / 9 / 10) * 10} seconds away.`;
}

/* ---------- city buses ---------- */
export function updateTransit(dt) {
  const P = G.player;
  for (const b of T.buses) {
    if (b.dwell > 0) { b.dwell -= dt; b.v = damp(b.v, 0, 8, dt); }
    else {
      const st = T.stops[b.nextStop]; let ahead = st.s - b.s; if (ahead < -5) ahead += T.route.total;
      let { limit } = G.traffic.limitFor(b, P.car ? null : { x: P.pos.x, z: P.pos.z });
      if (ahead >= 0 && ahead < 14) limit = Math.min(limit, Math.max(1.5, ahead * .7));
      if (ahead >= 0 && ahead < .8) { b.dwell = 5; b.v = 0; b.atStop = st; onBusAtStop(b, st); b.nextStop = (b.nextStop + 1) % T.stops.length; }
      else { b.v = damp(b.v, limit, limit < b.v ? 6 : 1.2, dt); b.atStop = null; }
    }
    b.s = (b.s + b.v * dt) % T.route.total; G.traffic.place(b, false);
  }
  if (G.ride?.bus) { const b = G.ride.bus; P.pos.set(b.pos.x, 0, b.pos.y); G.cine = chase(b.pos.x, b.pos.y, b.yaw, 12, 6); }
  updateRegion(dt);
}
async function onBusAtStop(b, st) {
  const P = G.player;
  if (G.ride?.bus === b && G.ride.dest === st) { // get off here
    const ride = G.ride; G.ride = null; G.cine = null; G.setAvatarVisible(true); $('travel').hidden = true;
    G.teleport(st.x + Math.sin(st.face) * 1.5, CURB, st.z + Math.cos(st.face) * 1.5, st.face, false);
    G.Sound.ding(); G.toast(`You got down at ${st.name}`); return ride;
  }
  if (T.waitStop === st && !G.ride && !P.car && Math.hypot(P.pos.x - st.x, P.pos.z - st.z) < 9) {
    T.waitStop = null; G.Sound.ding();
    const others = T.stops.filter(x => x !== st);
    const dest = await dialog('Bus is here', `Conductor: "Where you dey go? ${naira(FARES.bus)} any stop."`, others.map(o => ({ label: o.name, value: o.name })).concat([{ label: 'Not now', value: null }]), { who: 'Conductor' });
    if (!dest) return;
    if (!spend(FARES.bus)) { G.toast('You do not have enough money for the fare'); return; }
    G.track?.('bus');
    if (b.atStop !== st) { G.toast('The bus left. Wait for the next one.'); eco.money += FARES.bus; return; }
    const target = T.stops.find(x => x.name === dest);
    G.ride = { bus: b, dest: target }; G.setAvatarVisible(false); b.dwell = Math.max(b.dwell, 1);
    showTravel(`On the bus to ${target.name}`, () => skipBus());
  }
}
function skipBus() { const r = G.ride; if (!r?.bus) return; fade(() => { G.ride = null; G.cine = null; G.setAvatarVisible(true); $('travel').hidden = true; const st = r.dest; G.teleport(st.x + Math.sin(st.face) * 1.5, CURB, st.z + Math.cos(st.face) * 1.5, st.face, false); G.toast(`You got down at ${st.name}`); }); }
function chase(x, z, yaw, back, up) { return { pos: new THREE.Vector3(x - Math.sin(yaw) * back, up, z - Math.cos(yaw) * back), look: new THREE.Vector3(x + Math.sin(yaw) * 4, 1.5, z + Math.cos(yaw) * 4) }; }

/* ---------- travel overlay ---------- */
let skipFn = null, skipping = false;
export function showTravel(title, onSkip, progress) { $('travelTitle').textContent = title; $('travelBar').style.width = (progress ?? 0) * 100 + '%'; $('travelBar').parentElement.hidden = progress === undefined; skipFn = onSkip; $('travel').hidden = false; }
document.addEventListener('click', e => { if (e.target.id === 'travelSkip') { skipping = true; skipFn?.(); } });
function step(dur, fn) {
  return new Promise(res => { let t = 0; const go = () => { if (skipping) return res(); const dt = G.lastDt || .016; t += dt; fn(Math.min(1, t / dur), dt); if (t >= dur) res(); else requestAnimationFrame(go); }; requestAnimationFrame(go); });
}

/* ---------- motor park ---------- */
async function ticketBooth() {
  const pick = await dialog('Unity Motor Park', 'Ticket seller: "Oya, where you dey go?"', [
    { label: `Kauye Village · ${naira(FARES.village)}`, value: 'village' }, { label: `Airport · ${naira(FARES.airport)}`, value: 'airport' }, { label: 'Not now', value: null }], { who: 'Ticket seller' });
  if (!pick) return;
  if (eco.tickets.some(t => t.dest === pick && t.kind === 'bus')) { G.toast('You already have that ticket. Board the bus in the park.'); return; }
  if (!spend(FARES[pick])) { G.toast('Not enough money for that ticket'); return; }
  addTicket({ kind: 'bus', dest: pick }); G.Sound.buy(false);
  G.toast(`Ticket to ${pick === 'airport' ? 'the airport' : 'Kauye Village'} bought. Board the bus marked ${pick === 'airport' ? 'AIRPORT' : 'KAUYE'}.`);
}
async function boardCoach(dest) {
  if (!useTicket(dest)) { G.toast('Buy a ticket at the booth first'); return; }
  await travelRoad('coach', null, 'city', dest);
}
async function busHome(from) {
  const fare = from === 'village' ? FARES.village : FARES.airport;
  const ok = await dialog(from === 'village' ? 'Bus to Abuja' : 'City shuttle', `Fare: ${naira(fare)}. You will arrive at Unity Motor Park.`, [{ label: 'Pay and go', value: true }, { label: 'Not now', value: false }]);
  if (!ok) return; if (!spend(fare)) { G.toast('Not enough money for the fare'); return; }
  await travelRoad(from === 'village' ? 'coach' : 'bus', null, from, 'city');
}

/* ---------- regions ---------- */
export async function enterRegion(name) {
  T.regions = T.regions || {};
  if (!T.regions[name]) {
    const R = ensureRegion(name, G.scene); T.regions[name] = R;
    R.boxes.forEach(b => G.addBox(b)); R.circles.forEach(c => G.addCircle(c));
    if (R.seats?.length) G.extraSeats.push(...R.seats);
    if (R.doors?.length) R.doors.forEach(d => G.regionDoors.push(d));
    (R.villagers || []).forEach(v => { const ch = randomCharacter(); ch.root.position.set(v.x, 0, v.z); G.scene.add(ch.root); T.regionPeople.push({ ch, home: new THREE.Vector3(v.x, 0, v.z), tgt: new THREE.Vector3(v.x, 0, v.z), wait: rand() * 4, v: 0, yaw: rand() * 6, region: name }); });
  }
  G.region = name;
  return T.regions[name];
}
function updateRegion(dt) {
  const rg = G.region; if (rg === 'city' || !T.regions?.[rg]) return;
  const R = T.regions[rg];
  (R.animals || []).forEach(a => {
    a.t += dt; if (a.wait > 0) { a.wait -= dt; a.m.position.y = Math.abs(Math.sin(a.t * (a.goat ? 2 : 9))) * (a.goat ? 0 : .03); return; }
    const d = a.tgt.clone().sub(a.m.position); d.y = 0; const l = d.length();
    if (l < .3) { a.wait = 1 + Math.random() * 4; a.tgt.set(a.home.x + (Math.random() - .5) * 16, 0, a.home.z + (Math.random() - .5) * 16); return; }
    const sp = a.goat ? .8 : 1.4; a.m.position.addScaledVector(d.normalize(), sp * dt); a.m.rotation.y = Math.atan2(d.x, d.z);
  });
  T.regionPeople.forEach(n => {
    if (n.region !== rg) return;
    if (n.wait > 0) { n.wait -= dt; n.v = damp(n.v, 0, 5, dt); }
    else { const d = n.tgt.clone().sub(n.ch.root.position); d.y = 0; const l = d.length(); if (l < .4) { n.wait = 2 + Math.random() * 6; n.tgt.set(n.home.x + (Math.random() - .5) * 20, 0, n.home.z + (Math.random() - .5) * 20); } else { n.v = damp(n.v, 1.3, 3, dt); n.yaw = angleLerp(n.yaw, Math.atan2(d.x, d.z), .1); n.ch.root.position.addScaledVector(d.normalize(), n.v * dt); } }
    n.ch.root.position.y = G.gY(n.ch.root.position.x, n.ch.root.position.z); n.ch.root.rotation.y = n.yaw; n.ch.update(dt, n.v);
  });
  // driving out of a region takes you back to Abuja
  const P = G.player;
  if (P.car && R.exit && Math.hypot(P.pos.x - R.exit.x, P.pos.z - R.exit.z) < 14 && !T.asking) askDriveHome(rg);
}
let lastAsk = 0;
async function askDriveHome(rg) {
  if (performance.now() - lastAsk < 6000) return; T.asking = true; lastAsk = performance.now();
  const go = await dialog('Leave ' + REG[rg].name + '?', 'Drive back to Abuja on the highway?', [{ label: 'Drive to Abuja', value: true }, { label: 'Stay here', value: false }]);
  T.asking = false; if (go) travelRoad(null, G.player.car, rg, 'city');
}
export async function checkHighwayExit() {
  const P = G.player; if (!P.car || G.region !== 'city' || T.asking || G.ride) return;
  if (P.pos.z > -212 || Math.abs(P.pos.x) > 14) return;
  if (performance.now() - lastAsk < 6000) return; T.asking = true; lastAsk = performance.now();
  const dest = await dialog('Highway', 'Where are you driving to?', [{ label: 'Abuja Airport', value: 'airport' }, { label: 'Kauye Village', value: 'village' }, { label: 'Stay in the city', value: null }]);
  T.asking = false; if (dest) travelRoad(null, P.car, 'city', dest);
}

/* ---------- road trips: a coach, the shuttle or your own car on the highway ---------- */
async function travelRoad(vehicleType, car, from, to) {
  const H = await enterRegion('highway');
  const names = { city: 'Abuja', village: 'Kauye Village', airport: 'Abuja Airport', uyo: 'Uyo' };
  skipping = false; G.setAvatarVisible(false);
  const P = G.player;
  let mesh = car ? car.mesh : makeCar(vehicleType); if (!car) G.scene.add(mesh);
  const oncoming = [0, 1, 2].map(i => { const m = makeCar(pick(['sedan', 'bus', 'suv', 'keke'])); G.scene.add(m); return { m, x: H.end.x + 300 + i * 500 }; });
  G.ride = { travel: true }; G.inTravel = true;
  showTravel(`${names[from]} → ${names[to]}`, () => { }, 0);
  await fade(() => { }, 100);
  const len = H.start.x - H.end.x, speed = 30;
  await step(len / speed, (k, dt) => {
    const x = H.start.x - len * k, z = H.start.z; mesh.position.set(x, 0, z); mesh.rotation.y = -Math.PI / 2;
    mesh.userData.wheels?.forEach(w => w.w.rotation.x += speed * dt / (mesh.userData.wr || .34));
    P.pos.set(x, 0, z); G.cine = { pos: new THREE.Vector3(x + 16, 6.5, z + 7 + Math.sin(k * 6) * 2), look: new THREE.Vector3(x - 6, 1.4, z) };
    oncoming.forEach(o => { o.x += 26 * dt; if (o.x > H.start.x) o.x = H.end.x; o.m.position.set(o.x, 0, -3.2); o.m.rotation.y = Math.PI / 2; });
    $('travelBar').style.width = (k * 100) + '%';
    G.mixHint = { engine: speed, wind: .6 };
  });
  oncoming.forEach(o => G.scene.remove(o.m));
  await fade(async () => {
    if (!car) G.scene.remove(mesh);
    G.ride = null; G.cine = null; G.inTravel = false; G.mixHint = null; $('travel').hidden = true;
    await arrive(to, car);
  });
}
async function arrive(to, car) {
  const P = G.player;
  if (to === 'city') {
    G.region = 'city';
    if (car) { car.pos.set(0, -200); car.yaw = 0; car.y = 0; car.v = 0; G.traffic.sync(car); P.pos.set(0, 0, -200); G.teleport(0, 0, -200, 0, false, true); G.toast('Welcome back to Abuja'); }
    else { G.setAvatarVisible(true); G.teleport(-160, 0, -8, Math.PI / 2, false); G.toast('Welcome back to Abuja. You are at Unity Motor Park.'); }
    return;
  }
  const R = await enterRegion(to);
  if (car) { car.pos.set(R.car.x, R.car.z); car.yaw = R.car.yaw; car.y = 0; car.v = 0; G.traffic.sync(car); G.teleport(R.car.x, 0, R.car.z, R.car.yaw, false, true); }
  else { G.setAvatarVisible(true); G.teleport(R.spawn.x, 0, R.spawn.z, R.spawn.yaw, false); }
  G.toast(`Welcome to ${REG[to].name}`);
}

/* ---------- flights ---------- */
export async function ticketCounter(airport) {
  const to = airport === 'uyo' ? 'abuja' : 'uyo';
  if (eco.tickets.some(t => t.kind === 'flight' && t.dest === to)) { G.toast('You already have a boarding pass. Go to Gate 1.'); return; }
  const ok = await dialog('Naija Air', `Agent: "Good day! The next flight to ${to === 'uyo' ? 'Uyo' : 'Abuja'} is boarding soon. Economy is ${naira(FARES.flight)}."`, [{ label: `Buy ticket · ${naira(FARES.flight)}`, value: true }, { label: 'Not now', value: false }], { who: 'Check-in agent' });
  if (!ok) return;
  bookFlight(to);
}
export function bookFlight(to) {
  if (eco.tickets.some(t => t.kind === 'flight' && t.dest === to)) { G.toast('You already have this ticket'); return false; }
  if (!spend(FARES.flight)) { G.toast(`Not enough money. A flight costs ${naira(FARES.flight)}.`); return false; }
  addTicket({ kind: 'flight', dest: to }); G.Sound.buy(false); G.toast(`Boarding pass for ${to === 'uyo' ? 'Uyo' : 'Abuja'} is in your phone. Go to Gate 1 at the airport.`); return true;
}
export function bookBus(dest) {
  if (eco.tickets.some(t => t.kind === 'bus' && t.dest === dest)) { G.toast('You already have this ticket'); return false; }
  if (!spend(FARES[dest])) { G.toast('Not enough money'); return false; }
  addTicket({ kind: 'bus', dest }); G.Sound.buy(false); G.toast('Bus ticket saved in your phone. Board at Unity Motor Park.'); return true;
}
export async function boardingGate(airport) {
  const to = airport === 'uyo' ? 'abuja' : 'uyo';
  if (!useTicket(to)) { G.toast('You need a ticket. Buy one at the check-in counter or on your phone.'); return; }
  G.Sound.chime(); G.Sound.speak(`Naija Air flight N A 1 0 1 to ${to === 'uyo' ? 'Uyo' : 'Abuja'} is now boarding at gate one.`, { rate: .95 });
  await G.exitInterior();
  await fly(airport, to === 'uyo' ? 'uyo' : 'airport');
}
async function fly(fromKey, toKey) {
  skipping = false; G.setAvatarVisible(false); G.ride = { travel: true }; G.inTravel = true;
  const A = await enterRegion(fromKey), plane = makePlane(); G.scene.add(plane);
  const P = G.player, sky = await enterRegion('sky');
  showTravel(`Flight NA 101 → ${toKey === 'uyo' ? 'Uyo' : 'Abuja'}`, () => { }, undefined);
  const place = (x, y, z, yaw, pitch = 0) => { plane.position.set(x, y, z); plane.rotation.set(0, yaw, 0); plane.rotateX(-pitch); P.pos.set(x, Math.max(0, y - 3.2), z); };
  // taxi to the runway
  const path = A.taxi, segs = path.slice(1).map((q, i) => ({ a: path[i], b: q, l: Math.hypot(q[0] - path[i][0], q[1] - path[i][1]) })), total = segs.reduce((s, x) => s + x.l, 0);
  G.mixHint = { jet: .5 };
  await step(total / 16, k => {
    let d = k * total, s = segs[0]; for (const sg of segs) { s = sg; if (d <= sg.l) break; d -= sg.l; }
    const t = Math.min(1, d / s.l), x = s.a[0] + (s.b[0] - s.a[0]) * t, z = s.a[1] + (s.b[1] - s.a[1]) * t, yaw = Math.atan2(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    place(x, A.runway.y, z, yaw); G.cine = { pos: new THREE.Vector3(x - Math.sin(yaw) * 40 + 18, 14, z - Math.cos(yaw) * 40 + 10), look: new THREE.Vector3(x, 4, z) };
  });
  // take-off roll and climb
  G.mixHint = { jet: 1 };
  const x0 = A.runway.x1 - 20, rz = A.runway.z;
  await step(16, k => {
    const dist = k < .6 ? 650 * (k / .6) ** 2 : 650 + (k - .6) / .4 * 600, x = x0 - dist, climb = k < .55 ? 0 : ((k - .55) / .45) ** 1.6 * 160;
    place(x, A.runway.y + climb, rz, -Math.PI / 2, k > .5 ? Math.min(.22, (k - .5) * 1.2) : 0);
    G.cine = { pos: new THREE.Vector3(x0 - 300, 6, rz + 60), look: plane.position.clone() };
  });
  // cruise above the clouds
  G.mixHint = { jet: .7 };
  const len = sky.start.x - sky.end.x;
  showTravel(`Flight NA 101 → ${toKey === 'uyo' ? 'Uyo' : 'Abuja'} · cruising`, () => { }, 0);
  await step(36, k => {
    const x = sky.start.x - len * k; place(x, sky.alt + Math.sin(k * 20) * .6, sky.end.z, -Math.PI / 2);
    G.cine = { pos: new THREE.Vector3(x + 38, sky.alt + 8, 26), look: new THREE.Vector3(x - 10, sky.alt, 0) }; $('travelBar').style.width = (k * 100) + '%';
  });
  // landing at the destination
  const D = await enterRegion(toKey);
  showTravel(`Landing at ${REG[toKey].name}`, () => { }, undefined);
  G.mixHint = { jet: .9 };
  await step(16, k => {
    const start = D.runway.x1 + 900, touch = D.runway.x1 - 80, stop = D.runway.x0 + 300;
    let x, y;
    if (k < .55) { const t = k / .55; x = start + (touch - start) * t; y = D.runway.y + 110 * (1 - t) ** 1.4; }
    else { const t = (k - .55) / .45; x = touch + (stop - touch) * (1 - (1 - t) ** 2); y = D.runway.y; }
    place(x, y, D.runway.z, -Math.PI / 2, k < .5 ? -.04 : 0);
    G.cine = { pos: new THREE.Vector3(D.runway.x1 - 200, 5, D.runway.z + 70), look: plane.position.clone() };
  });
  await fade(async () => {
    G.scene.remove(plane); G.ride = null; G.cine = null; G.inTravel = false; G.mixHint = null; $('travel').hidden = true;
    G.region = toKey; G.setAvatarVisible(true); G.teleport(D.arrive.x, 0, D.arrive.z, D.arrive.yaw, false);
    G.toast(`Welcome to ${REG[toKey].name}!`); G.Sound.chime();
  });
}

/* ---------- buying a car ---------- */
async function buyCar(c) {
  if (eco.car) { const ok = await dialog('Jabi Motors', 'You already own a car. Sell it back and buy this one instead?', [{ label: 'Yes, swap', value: true }, { label: 'No', value: false }]); if (!ok) return; }
  const ok = await dialog('Jabi Motors', `Salesman: "This ${c.mesh.userData.type} is clean, Tokunbo, first body! ${naira(c.forSale)}, papers complete."`, [{ label: `Buy for ${naira(c.forSale)}`, value: true }, { label: 'Not today', value: false }], { who: 'Salesman' });
  if (!ok) return;
  if (!spend(c.forSale)) { G.toast(`You need ${naira(c.forSale)}. Work shifts at the offices to earn money.`); return; }
  G.traffic.cars.forEach(o => { if (o.owned && o !== c) o.owned = false; });
  c.owned = true; c.forSale = null; G.scene.remove(c.tag); setOwnedCar({ type: c.mesh.userData.type, color: c.mesh.userData.color });
  G.Sound.buy(true); G.toast('The car is yours, papers and all. Press E to drive it.');
}

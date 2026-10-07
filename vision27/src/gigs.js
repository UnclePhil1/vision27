import * as THREE from 'three';
import { G, naira, dialog, fade } from './game.js';
import { eco, earn, spend, addItem, ITEMS, changed } from './economy.js';
import { mapState, setDestination, clearRoute, routeBetween } from './map.js';
import { showTravel } from './transit.js';
import { randomCharacter } from './characters.js';
import { track, mult } from './life.js';
import { rand, pick } from './util.js';

/* Phone gigs, like the ride and food apps everyone uses:
   Ride: order a taxi to anywhere, or sign up to drive and carry passengers.
   Chow: order food to your location, or sign up to deliver orders.
   Orders are filled by city drivers and riders; player drivers serve city customers. */
const $ = id => document.getElementById(id);
const S = { taxi: null, order: null, driver: false, rider: false, job: null, offerT: 25, rating: 4.8, trips: 0 };
const NAMES = ['Musa', 'Chinedu', 'Bayo', 'Emeka', 'Ibrahim', 'Tunde', 'Aisha', 'Ngozi', 'Femi', 'Usman'];
const carSpeed = 13;
const distPath = r => r.reduce((a, p, i) => i ? a + Math.hypot(p.x - r[i - 1].x, p.z - r[i - 1].z) : 0, 0);
const fareFor = d => Math.round((600 + d * 9) * (mult.fare() > 1 ? 1.5 : 1) / 50) * 50;
const placesFor = () => {
  const p = G.player.pos, list = [];
  const mine = mapState.pois.find(o => o.house !== undefined && o.house === G.myHouseIdx?.());
  if (mine) list.push({ ...mine, name: 'Home' });
  if (mapState.dest) list.push({ name: 'GPS: ' + mapState.dest.name, x: mapState.dest.x, z: mapState.dest.z });
  ['Grand Abuja Hotel', 'Unity Market', 'Starlight Cinema (Jabi Lake Mall)', 'National Stadium', 'Eagle Square (rallies)', 'Club 27 (nightclub)', 'Nyanya Motor Park', 'Abuja Motor Park', 'Sovereign Trust Bank HQ', 'National Hospital', 'INEC Office', 'Presidential Villa (Aso Rock)']
    .forEach(n => { const o = mapState.pois.find(q => q.name === n); if (o) list.push(o); });
  mapState.pins.forEach(pn => list.push({ name: '📍 ' + pn.name, x: pn.x, z: pn.z }));
  return list.filter(o => Math.hypot(o.x - p.x, o.z - p.z) > 40);
};

/* ---------- moving a car along a planned route ---------- */
function follow(car, route, speed, dt) {
  let left = speed * dt;
  while (left > 0 && route.i < route.pts.length - 1) {
    const a = route.pts[route.i], b = route.pts[route.i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), rest = L - route.s;
    if (left < rest) { route.s += left; left = 0; } else { left -= rest; route.i++; route.s = 0; continue; }
    const t = route.s / L; car.pos.set(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t); car.yaw = Math.atan2(b.x - a.x, b.z - a.z);
  }
  car.v = speed; G.traffic.sync(car);
  return route.i >= route.pts.length - 1;
}
function spawnTaxi(near, far = 70) {
  const a = rand() * Math.PI * 2, sx = near.x + Math.cos(a) * far, sz = near.z + Math.sin(a) * far;
  const car = G.traffic.addParked('taxi', 0xf2c230, sx, 0, sz, 0); car.mode = 'gig'; car.noTake = true;
  return car;
}

/* ---------- RIDE: order a taxi ---------- */
async function orderTaxi(dest) {
  if (G.region !== 'city' || G.ride || G.player.car) return G.toast('Order a taxi when you are on foot in the city');
  if (G.inMyHouse?.() || G.isInside?.()) return G.toast('Go outside first so the driver can find you');
  const p = G.player.pos, route = routeBetween(p.x, p.z, dest.x, dest.z), fare = fareFor(distPath(route));
  const ok = await dialog('Confirm your ride', `${dest.name} · about ${Math.round(distPath(route) / 10) * 10} m. Fare: ${naira(fare)}${mult.fare() > 1 ? ' (morning rush price)' : ''}. Pay when you arrive.`, [{ label: `Order for ${naira(fare)}`, value: true }, { label: 'Cancel', value: false }], { who: 'Ride' });
  if (!ok) return;
  const car = spawnTaxi(p), pick0 = routeBetween(car.pos.x, car.pos.y, p.x, p.z);
  S.taxi = { car, dest, fare, driver: pick(NAMES), stage: 'coming', route: { pts: pick0, i: 0, s: 0 } };
  G.toast(`${S.taxi.driver} accepted your ride. Taxi arriving in about ${Math.max(10, Math.round(distPath(pick0) / carSpeed))}s.`);
}
function updateTaxi(dt) {
  const T = S.taxi; if (!T) return;
  const P = G.player, car = T.car;
  if (T.stage === 'coming') {
    if (follow(car, T.route, carSpeed, dt)) { T.stage = 'waiting'; G.Sound?.horn?.(.8, 0); G.toast(`${T.driver} is here. Walk to the taxi and get in.`); }
  } else if (T.stage === 'riding') {
    const done = follow(car, T.route, T.skip ? 400 : carSpeed + 3, dt);
    P.pos.set(car.pos.x, 0, car.pos.y);
    G.cine = { pos: new THREE.Vector3(car.pos.x - Math.sin(car.yaw) * 10, 5.5, car.pos.y - Math.cos(car.yaw) * 10), look: new THREE.Vector3(car.pos.x + Math.sin(car.yaw) * 4, 1.4, car.pos.y + Math.cos(car.yaw) * 4) };
    const total = distPath(T.route.pts), left = Math.max(0, total - (distPath(T.route.pts.slice(0, T.route.i + 1)) + T.route.s));
    showTravel(`Taxi to ${T.dest.name} · ${Math.round(left)} m`, () => { T.skip = true; }, 1 - left / Math.max(1, total));
    if (done) arriveTaxi();
  }
}
function boardTaxi() {
  const T = S.taxi; T.stage = 'riding'; T.route = { pts: routeBetween(T.car.pos.x, T.car.pos.y, T.dest.x, T.dest.z), i: 0, s: 0 };
  G.ride = { taxi: true }; G.setAvatarVisible(false); G.say?.(pick(['Oga, where we dey go?', 'Madam, enter. AC dey work!', 'Hold body, we dey go.']), G.player.pos, 2.5);
}
async function arriveTaxi() {
  const T = S.taxi; S.taxi = null;
  await fade(() => {
    const c = T.car, sx = c.pos.x + Math.cos(c.yaw) * 2.5, sz = c.pos.y - Math.sin(c.yaw) * 2.5;
    G.ride = null; G.cine = null; $('travel').hidden = true; G.setAvatarVisible(true); G.teleport(sx, G.gY(sx, sz), sz, c.yaw, false);
    G.traffic.remove(c);
  }, 500);
  const paid = Math.min(eco.money, T.fare); eco.money -= paid; changed();
  G.toast(`You arrived at ${T.dest.name}. Paid ${T.driver} ${naira(paid)}.`); track('ride');
}

/* ---------- RIDE: drive for money ---------- */
function offerRide() {
  const P = G.player; if (!P.car || G.region !== 'city') return;
  const pool = mapState.pois.filter(o => ['shop', 'food', 'home', 'office', 'bank', 'hotel', 'leisure', 'cinema', 'government', 'transport', 'market'].includes(o.cat));
  const from = pick(pool.filter(o => Math.hypot(o.x - P.pos.x, o.z - P.pos.z) < 220 && Math.hypot(o.x - P.pos.x, o.z - P.pos.z) > 30));
  if (!from) return;
  const to = pick(pool.filter(o => Math.hypot(o.x - from.x, o.z - from.z) > 120)); if (!to) return;
  const fare = fareFor(Math.hypot(to.x - from.x, to.z - from.z) * 1.3);
  dialog('New ride request', `${pick(NAMES)} wants a ride from ${from.name} to ${to.name}. You earn ${naira(fare)}.`, [{ label: 'Accept', value: true }, { label: 'Decline', value: false }], { who: 'Ride · driver' }).then(ok => {
    if (!ok) return;
    S.job = { kind: 'ride', stage: 'pickup', from, to, pay: fare }; setDestination(from.x, from.z, `Pick up: ${from.name}`);
  });
}
function offerDelivery() {
  const shops = mapState.pois.filter(o => ['food', 'shop', 'pharmacy', 'hotel'].includes(o.cat) || /kitchen|buka|bakery|pharmacy|mart|lounge/i.test(o.name));
  const homes = mapState.pois.filter(o => ['home', 'office', 'bank', 'government'].includes(o.cat));
  const P = G.player.pos, from = pick(shops.filter(o => Math.hypot(o.x - P.x, o.z - P.z) < 200)) || pick(shops), to = pick(homes.filter(o => Math.hypot(o.x - from.x, o.z - from.z) > 80));
  if (!from || !to) return;
  const pay = Math.round((1200 + Math.hypot(to.x - from.x, to.z - from.z) * 10) * mult.delivery() / 50) * 50, item = pick(['jollof', 'suya', 'friedRice', 'pepperSoup', 'smallChops', 'bread', 'vitamins']);
  dialog('New Chow order', `Pick up ${ITEMS[item].name.toLowerCase()} at ${from.name}, deliver to ${to.name}. You earn ${naira(pay)} plus tips.`, [{ label: 'Accept', value: true }, { label: 'Decline', value: false }], { who: 'Chow · rider' }).then(ok => {
    if (!ok) return;
    S.job = { kind: 'chow', stage: 'pickup', from, to, pay, item }; setDestination(from.x, from.z, `Pick up order: ${from.name}`);
  });
}
function updateJob() {
  const J = S.job; if (!J) return;
  const P = G.player.pos, at = q => Math.hypot(P.x - q.x, P.z - q.z) < 12;
  if (J.kind === 'ride' && !G.player.car) return;
  if (J.stage === 'pickup' && at(J.from)) {
    J.stage = 'drop'; setDestination(J.to.x, J.to.z, `${J.kind === 'ride' ? 'Drop off' : 'Deliver to'}: ${J.to.name}`);
    G.toast(J.kind === 'ride' ? 'Passenger in. Follow the GPS to the drop-off.' : 'Order collected. Deliver it while it is hot!');
  } else if (J.stage === 'drop' && at(J.to)) {
    S.job = null; clearRoute(); S.trips++;
    const tip = rand() < .4 ? Math.round(rand() * 6 + 2) * 100 : 0;
    G.practice?.(J.kind === 'ride' ? 'ride' : 'chow'); earn(J.pay + tip, J.kind === 'ride' ? `fare${tip ? ` + ₦${tip} tip` : ''}. Rated ★★★★★` : `for the delivery${tip ? ` + ₦${tip} tip` : ''}`);
    track(J.kind === 'ride' ? 'drive' : 'deliver'); track('shift');
  }
}

/* ---------- CHOW: order food to you ---------- */
async function orderFood(id) {
  const it = ITEMS[id], fee = 500, cost = Math.round(it.price * (G.priceMult?.() || 1)) + fee;
  if (!spend(cost)) return G.toast(`You need ${naira(cost)} with delivery`);
  S.order = { id, t: 20 + rand() * 20, rider: null };
  G.toast(`Order placed: ${it.name}. A rider is on the way (${Math.round(S.order.t)}s).`); track('chow');
}
function updateOrder(dt) {
  const O = S.order; if (!O) return;
  const P = G.player.pos;
  if (!O.rider) { O.t -= dt; if (O.t > 0) return; if (G.isInside?.() || G.region !== 'city') { if (O.t < -60) { addItem(O.id); S.order = null; G.toast('Your Chow order was left with the gateman. It is in your bag.'); } return; }
    O.rider = randomCharacter(false); const a = rand() * 6.28; O.rider.root.position.set(P.x + Math.cos(a) * 14, G.gY(P.x, P.z), P.z + Math.sin(a) * 14); G.scene.add(O.rider.root); G.toast('Your Chow rider is here!'); return; }
  const r = O.rider.root.position, dx = P.x - r.x, dz = P.z - r.z, d = Math.hypot(dx, dz);
  if (d > 1.6) { r.x += dx / d * 4.5 * dt; r.z += dz / d * 4.5 * dt; r.y = G.gY(r.x, r.z); O.rider.root.rotation.y = Math.atan2(dx, dz); O.rider.update(dt, 4.5); }
  else { addItem(O.id); G.say?.('Your food, enjoy!', r, 2.5); G.toast(`${ITEMS[O.id].name} is in your bag. Eat it from Bag.`); const rd = O.rider; S.order = null; setTimeout(() => G.scene.remove(rd.root), 2500); }
}

/* ---------- phone apps ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function renderRide(body, rerender) {
  const T = S.taxi, places = placesFor();
  body.innerHTML = `<div class="ph-card"><b>${T ? (T.stage === 'riding' ? 'On your way' : `${esc(T.driver)} is ${T.stage === 'coming' ? 'coming' : 'waiting outside'}`) : 'Where to?'}</b><small>${T ? `To ${esc(T.dest.name)} · ${naira(T.fare)}` : 'Green-and-white taxis come to you anywhere in the city.'}</small>${T && T.stage !== 'riding' ? '<button class="cta ghost" id="rdCancel">Cancel ride</button>' : ''}</div>`
    + (T ? '' : `<div class="ph-sec">Go to</div>` + places.map((o, i) => `<button class="row-th" data-to="${i}"><span class="th-main"><b>${esc(o.name)}</b><small>${naira(fareFor(Math.hypot(o.x - G.player.pos.x, o.z - G.player.pos.z) * 1.3))} approx</small></span><span class="mini-btn">Ride</span></button>`).join(''))
    + `<div class="ph-sec">Drive for Ride</div><div class="row-th"><span class="th-main"><b>${S.driver ? 'You are online' : 'Earn by driving'}</b><small>${S.driver ? `${S.trips} trips · ★ ${S.rating.toFixed(1)} · requests come while you drive` : 'Get in any car (or buy one at Jabi Motors) and go online.'}</small></span><button class="mini-btn" id="rdDrive">${S.driver ? 'Go offline' : 'Go online'}</button></div>`;
  body.querySelectorAll('[data-to]').forEach(b => b.onclick = () => { G.closePhone?.(); orderTaxi(places[+b.dataset.to]); });
  const c = body.querySelector('#rdCancel'); if (c) c.onclick = () => { G.traffic.remove(S.taxi.car); S.taxi = null; G.toast('Ride cancelled'); rerender(); };
  body.querySelector('#rdDrive').onclick = () => { S.driver = !S.driver; S.offerT = 8; G.toast(S.driver ? (G.player.car ? 'You are online. Ride requests will pop up.' : 'You are online. Get into a car to receive requests.') : 'You are offline'); rerender(); };
}
function renderChow(body, rerender) {
  const menu = ['jollof', 'friedRice', 'afang', 'pepperSoup', 'suya', 'smallChops', 'amala', 'bread', 'chapman', 'vitamins'];
  body.innerHTML = `<div class="ph-card"><b>${S.order ? 'Order on the way' : 'Hungry?'}</b><small>${S.order ? `${esc(ITEMS[S.order.id].name)} · ${S.order.rider ? 'rider is close' : `about ${Math.max(1, Math.round(S.order.t))}s`}` : 'Food and medicine delivered to you. ₦500 delivery.'}</small></div>`
    + (S.order ? '' : `<div class="ph-sec">Order</div>` + menu.map(id => `<button class="row-th" data-food="${id}"><span class="th-main"><b>${esc(ITEMS[id].name)}</b><small>+${ITEMS[id].energy} energy</small></span><span class="mini-btn">${naira(Math.round(ITEMS[id].price * (G.priceMult?.() || 1)) + 500)}</span></button>`).join(''))
    + `<div class="ph-sec">Deliver for Chow</div><div class="row-th"><span class="th-main"><b>${S.rider ? 'You are online' : 'Earn by delivering'}</b><small>${S.rider ? 'Orders pop up every few seconds. Walk, drive or ride.' : 'Pick up at shops and restaurants, drop at homes and offices.'}</small></span><button class="mini-btn" id="chRide">${S.rider ? 'Go offline' : 'Go online'}</button></div>`;
  body.querySelectorAll('[data-food]').forEach(b => b.onclick = () => { orderFood(b.dataset.food); rerender(); });
  body.querySelector('#chRide').onclick = () => { S.rider = !S.rider; S.offerT = 6; G.toast(S.rider ? 'You are online for Chow deliveries' : 'You are offline'); rerender(); };
}
export function initGigs(d) {
  Object.assign(G.phoneApps, {
    ride: { name: 'Ride', glyph: '🚕', color: '#f2c230', render: renderRide },
    chow: { name: 'Chow', glyph: '🍲', color: '#e0582b', render: renderChow },
  });
  // get into your ordered taxi
  G.actionProviders.push((p, out, inside) => {
    const T = S.taxi; if (inside || !T || T.stage !== 'waiting') return;
    out(Math.hypot(p.x - T.car.pos.x, p.z - T.car.pos.y) - 1.5, { label: `Get in ${T.driver}'s taxi`, run: boardTaxi });
  });
}
export function updateGigs(dt) {
  updateTaxi(dt); updateOrder(dt); updateJob();
  if ((S.driver && G.player.car) || S.rider) {
    if (!S.job && !G.ride && !G.isBusy?.()) { S.offerT -= dt; if (S.offerT <= 0) { S.offerT = 18 + rand() * 20; S.driver && G.player.car ? offerRide() : offerDelivery(); } }
  }
}
export const gigs = S;
G.gigs = S;

import * as THREE from 'three';
import { buildInterior, isInside } from './interiors.js';
import { net, meId, ownerOf, myHome, claimHome, isMutual, nameOf, resolveNames } from './net.js';
import { randomCharacter } from './characters.js';
import { canvasTex } from './util.js';
import { G } from './game.js';
import { DEFAULT_LAYOUT, furnish, leaveHouse, useLabel, inMyHouse, refurnish } from './house.js';
import { shopCategory, spend } from './economy.js';
import { dialog, naira } from './game.js';

/* Doors, interiors, seats, beds, house claims and energy. */
const $ = id => document.getElementById(id);
let C = null;                      // context from main.js
const built = new Map();           // door slot -> interior
export let inside = null;          // the interior the player is in
let returnTo = null;
export const energy = { v: 100 };
try { const e = +localStorage.getItem('abuja.energy'); if (e >= 0 && e <= 100 && localStorage.getItem('abuja.energy') !== null) energy.v = e; } catch { }

export function initPlaces(ctx) {
  C = ctx;
  paintPlaques();
  net.on('homes', () => { paintPlaques(); if (inside?.door.kind === 'house') { applyPaint(inside); refurnish(); } });
}


/* ---------- house plaques at the gates ---------- */
const plaqueCache = new Map();
async function paintPlaques() {
  const owners = [...new Set(C.city.houses.map(h => ownerOf(h.idx)).filter(Boolean))];
  await resolveNames(owners);
  C.city.houses.forEach(h => {
    const o = ownerOf(h.idx), mine = o && o === meId();
    const text = !o ? (h.price ? 'FOR SALE' : 'FREE HOUSE') : mine ? 'YOUR HOUSE' : ((nameOf(o)?.name || 'Someone') + "'s house");
    const sub = !o ? (h.price ? naira(h.price) + ' · press E at the gate' : 'Press E at the gate to claim') : mine ? 'Welcome home' : 'Private: mutuals only';
    const key = text + sub; if (plaqueCache.get(h.idx) === key) return; plaqueCache.set(h.idx, key);
    const bg = !o ? '#f2c230' : mine ? '#1d8a4a' : '#16213a', fg = !o ? '#1d3b2a' : '#ffffff';
    const tex = canvasTex(400, 100, g => { g.fillStyle = bg; g.fillRect(0, 0, 400, 100); g.fillStyle = fg; g.textAlign = 'center'; g.font = '700 38px "Fredoka", system-ui, sans-serif'; g.fillText(text, 200, 46, 380); g.font = '500 20px "Fredoka", system-ui, sans-serif'; g.fillText(sub, 200, 80, 380); }, false);
    const m = h.plaque.material; if (m.map) m.map.dispose(); m.map = tex; m.needsUpdate = true;
  });
}

/* ---------- what can the player do right here? ---------- */
export function findAction(p, nearCar) {
  let best = null, bd = 1e9;
  const consider = (d, a) => { if (a.label && d < bd) { bd = d; best = a; } };
  if (inside) {
    consider(Math.hypot(p.x - inside.exit.x, p.z - inside.exit.z) - .3, { kind: 'exit', label: 'Go outside' });
    inside.seats.forEach(s => { if (!s.taken) consider(Math.hypot(p.x - s.x, p.z - s.z) - (1.2 - .9), { kind: 'seat', seat: s, label: 'Sit down' }); });
    inside.beds.forEach(b => !b.ward && consider(Math.hypot(p.x - b.x, p.z - b.z) - .6, { kind: 'bed', bed: b, label: 'Sleep' }));
    (inside.uses || []).forEach(u => consider(Math.hypot(p.x - u.x, p.z - u.z) - .5, { kind: 'use', use: u, label: useLabel(u) }));
    (G.actionProviders || []).forEach(fn => fn(p, consider, inside));
    (inside.spots || []).forEach(sp => consider(Math.hypot(p.x - sp.x, p.z - sp.z) - .8, sp.kind === 'shop' ? { kind: 'shop', label: sp.label || `Buy at ${sp.cat ? 'the kiosk' : inside.door.name}`, cat: sp.cat || shopCategory(inside.door.name), name: sp.cat ? (sp.label ? inside.door.name : 'Airport kiosk') : inside.door.name } : sp.kind === 'work' ? { kind: 'work', label: `Work a shift here (+₦15,000)`, name: inside.door.name } : sp.kind === 'role' ? roleAction(sp) : { kind: sp.kind, label: sp.label, spot: sp }));
    return bd < 1.5 ? best : null;
  }
  C.city.doors.forEach((d, slot) => consider(Math.hypot(p.x - d.pos.x, p.z - d.pos.z), { kind: 'door', door: d, slot, label: d.kind === 'house' ? houseLabel(d) : 'Enter ' + d.name }));
  (G.regionDoors || []).forEach((d, i) => consider(Math.hypot(p.x - d.pos.x, p.z - d.pos.z), { kind: 'door', door: d, slot: 1000 + i, label: 'Enter ' + d.name.toLowerCase().replace(/^./, c => c.toUpperCase()) }));
  (G.extraSeats || []).forEach(s => { if (!s.taken) consider(Math.hypot(p.x - s.x, p.z - s.z) + .3, { kind: 'seat', seat: s, label: 'Sit down' }); });
  (G.actionProviders || []).forEach(fn => fn(p, consider));
  C.city.houses.forEach(h => { if (!ownerOf(h.idx) || ownerOf(h.idx) === meId()) consider(Math.hypot(p.x - h.gate.x, p.z - h.gate.z) + .2, { kind: 'claim', house: h, label: ownerOf(h.idx) ? 'Your house' : (G.claimCost?.(h) ? `Buy this house (${naira(G.claimCost(h))})` : 'Claim this house (free)') }); });
  C.city.seats.forEach(s => { if (!s.taken) consider(Math.hypot(p.x - s.x, p.z - s.z) + .3, { kind: 'seat', seat: s, label: 'Sit down' }); });
  if (nearCar) consider(Math.hypot(p.x - nearCar.pos.x, p.z - nearCar.pos.y) - 1.4, { kind: 'car', car: nearCar, label: 'Take this ' + ({ keke: 'keke', bus: 'bus', taxi: 'taxi' }[nearCar.mesh.userData.type] || 'car') });
  return bd < 2.2 ? best : null;
}
function roleAction(sp) { const label = G.spotLabel?.(sp); return label ? { kind: 'role', label, run: () => G.onSpot(sp) } : { kind: 'none', label: null }; }
function houseLabel(d) { const o = ownerOf(d.house); return !o ? 'Look inside (free house)' : o === meId() ? 'Go inside your house' : `Visit ${nameOf(o)?.name || 'their'} house`; }

/* ---------- doors ---------- */
export function canEnter(door) {
  if (door.kind === 'villa') return G.villaAccess ? G.villaAccess(door) : false;
  if (door.kind !== 'house') return true;
  const o = ownerOf(door.house);
  if (!o || o === meId()) return true;
  if (isMutual(o)) return true;
  C.toast(`This is ${nameOf(o)?.name || 'someone'}'s house. Only their mutuals can come in.`); return false;
}
function applyPaint(it) {
  if (!it.wallMat) return; const o = ownerOf(it.door.house), h = o ? net.homes.get(o) : null;
  it.wallMat.color.set(h?.paint || '#f2e3c6');
}
export function enter(door, slot) {
  if (!canEnter(door)) return false;
  let it = built.get(slot);
  if (!it) {
    it = buildInterior(door, slot); built.set(slot, it); C.scene.add(it.group);
    it.boxes.forEach(b => C.addBox(b)); it.circles.forEach(c => C.addCircle(c));
    it.people = it.npcs.map(n => { const ch = randomCharacter(n.female); ch.root.position.set(n.x, n.y || 0, n.z); ch.root.rotation.y = n.yaw; C.scene.add(ch.root); if (n.sit && n.seatIdx !== undefined) it.seats[n.seatIdx].taken = true; return { ch, sit: !!n.sit, dance: !!n.dance, ph: Math.random() * 6 }; });
  }
  if (door.kind === 'house') { applyPaint(it); furnish(it); }
  returnTo = { x: door.pos.x, z: door.pos.z, yaw: door.yaw };
  inside = it; C.teleport(it.spawn.x, 0, it.spawn.z, it.spawn.yaw, true);
  $('place').textContent = it.door.kind === 'shop' ? door.name : it.name; $('place').hidden = false;
  return true;
}
export function exit() {
  if (!inside) return;
  if (inside.door.kind === 'house') leaveHouse();
  inside = null; $('place').hidden = true;
  C.teleport(returnTo.x, G.gY(returnTo.x, returnTo.z), returnTo.z, returnTo.yaw, false);
}
export function goHome() {
  const h = myHome(); if (!h) { C.toast("You don't have a house yet"); return; }
  const slot = C.city.doors.findIndex(d => d.kind === 'house' && d.house === h.house);
  if (slot < 0) return; if (inside) exit();
  enter(C.city.doors[slot], slot);
}
export async function claim(h) {
  if (ownerOf(h.idx) === meId()) { C.toast('This is already your house'); return; }
  const had = myHome(), cost = G.claimCost ? G.claimCost(h) : 0;
  if (cost > 0) {
    const ok = await dialog(`Buy this ${h.style === 'mansion' ? 'mansion' : 'house'}?`, `${h.estate} homes cost ${naira(cost)}.${had ? ' You will move out of your old house.' : ''}`, [{ label: `Buy for ${naira(cost)}`, value: true }, { label: 'Not now', value: false }]);
    if (!ok) return; if (!spend(cost)) { C.toast(`You need ${naira(cost)} for this house`); return; }
  }
  claimHome(h.idx, DEFAULT_LAYOUT); C.toast(had ? `You moved to House ${h.idx + 1}` : `${h.estate || 'Central'} House ${h.idx + 1} is yours! Walk to the front door and press E to go in.`);
}
export function updatePlaces(dt) {
  if (inside) inside.people?.forEach(pp => { pp.ch.update(dt, 0, { sit: pp.sit, anim: pp.dance ? 'Clapping' : null }); if (pp.dance) { pp.ph += dt; pp.ch.root.rotation.y += Math.sin(pp.ph * 2) * dt; pp.ch.root.position.y = Math.abs(Math.sin(pp.ph * 5)) * .08; } });
}
export function sleep(onDone) {
  if (inside.door.kind === 'villa') return doSleep(onDone);
  const o = ownerOf(inside.door.house);
  if (o && o !== meId()) { C.toast("You can't sleep in someone else's bed"); return; }
  if (!inMyHouse()) { C.toast('Claim this house first, then you can sleep here'); return; }
  if (!o) { C.toast('Claim this house first, then you can sleep here'); return; }
  doSleep(onDone);
}
function doSleep(onDone) {
  const f = $('fade'); f.hidden = false; f.classList.add('on');
  setTimeout(() => { energy.v = 100; saveEnergy(); G.track?.('sleep'); onDone?.(); f.classList.remove('on'); setTimeout(() => { f.hidden = true; }, 600); C.toast('You slept well. Energy is full.'); }, 1400);
}
let saveT = 0;
export function saveEnergy() { try { localStorage.setItem('abuja.energy', String(Math.round(energy.v))); } catch { } }
export function tickEnergy(dt, speed, running, sitting) {
  if (G.fitUntil > Date.now()) dt *= .5;
  if (sitting) energy.v = Math.min(100, energy.v + 3 * dt);
  else if (running && speed > 6) energy.v = Math.max(0, energy.v - 2.2 * dt);
  else if (speed > .5) energy.v = Math.max(0, energy.v - .12 * dt);
  saveT += dt; if (saveT > 5) { saveT = 0; saveEnergy(); }
  const bar = $('energyFill'); bar.style.width = energy.v + '%'; bar.classList.toggle('low', energy.v < 20);
}

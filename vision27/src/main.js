import * as THREE from 'three';
import { clamp, damp, angleLerp, rand, pick } from './util.js';
import { BOUND, CURB, LANES } from './consts.js';
import { buildCity, groundY } from './city.js';
const gY = (x, z) => (isInside(x) ? 0 : x < -3000 ? regionGround(x, z) : groundY(x, z));
import { buildFlora, timeU } from './flora.js';
import { Traffic, routeFromNodes, rectLoop, circleRoute, makeCar } from './cars.js';
import { loadMen, LOOKS, randomCharacter } from './characters.js';
import { Sound } from './audio.js';
import { adMaterial, PLACEHOLDER, openAdEditor, safeLink, imgUrl } from './ads.js';
import { MUSIC_URL } from './music.js';
import { initNet, net, meId, setPresence, saveAds, sendHonk } from './net.js';
import { initSocial, updateSocial, sayHead, openPlayerCard, remoteHits, remoteDots, onlineCount } from './social.js';
import { initPlaces, findAction, enter, exit as exitPlace, goHome, claim, updatePlaces, sleep, tickEnergy, energy, inside } from './places.js';
import { initPhone, togglePhone, phoneOpen } from './phone.js';
import { isInside } from './interiors.js';
import { G, dialog, fade, naira } from './game.js';
import { initEconomy, eco, openShop, shopOpen, workShift, onEco, paintWallet, SHOP_STOCK, flushSave, syncWallet } from './economy.js';
import { updateHouse, startEdit, stopEdit, edit, editPointer, editKey, useThing, inMyHouse, appliances } from './house.js';
import { buildOutskirts } from './outskirts.js';
import { buildDistricts } from './districts.js';
import { initMap, updateMap, drawMini, mapOpen, openMap, setDestination } from './map.js';
import { initRoles, updateRoles, spawnGuards, paintRole, setRole, ROLES } from './roles.js';
import { makeAvatar, avatarCode, fromCode } from './avatar.js';
import { updateLife, checkStreak, track, mult, phase, paintHud } from './life.js';
import { initHub, initOfficeSync, officeRank } from './hub.js';
import { initGigs, updateGigs } from './gigs.js';
import { initVoice, updateVoice } from './voice.js';
import { useServer, srv } from './server.js';
import { initWork, updateWork } from './work.js';
import { initFloors, updateFloors } from './floors.js';
import { initMarket, updateMarket } from './market.js';
import { initUpkeep, updateUpkeep } from './upkeep.js';
import { initLand, updateLand } from './land.js';
import { initExplorer } from './explorer.js';
import { initSigns, updateSigns } from './signs.js';
import { districtAt } from './world.js';

import { ownerOf } from './net.js';
import { initTransit, updateTransit, checkHighwayExit, ticketCounter, boardingGate, transit, enterRegion, bookFlight } from './transit.js';
import { initEvents, updateEvents, spawnOfficers, addWanted, nearestFire, nearestSiren, panOf, startCrash, startFire } from './events.js';
import { regionGround, REG } from './regions.js';

const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); };

/* ---------------- renderer ---------------- */
const canvas = $('c');
/* quality: phones and small machines get a lighter setup; a slow frame rate steps it down further */
const LOW = isTouch || (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, LOW ? 1.25 : 1.75));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = LOW ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd9e2e1, LOW ? 110 : 140, LOW ? 430 : 560);
const camera = new THREE.PerspectiveCamera(55, 1, .1, 1400);
const hemi = new THREE.HemisphereLight(0xdcecff, 0xc2a37c, 1.05); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d6, 2.2);
sun.castShadow = true; sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 260 });
sun.shadow.bias = -.0005; sun.shadow.normalBias = .05;
scene.add(sun, sun.target);
const SUN_OFF = new THREE.Vector3(55, 95, -35);
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0x3a8bd8) }, low: { value: new THREE.Color(0xdfe9ea) } },
  vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: 'uniform vec3 top,low;varying vec3 vP;void main(){float h=clamp(vP.y*2.,0.,1.);gl_FragColor=vec4(mix(low,top,pow(h,.65)),1.);\n#include <colorspace_fragment>\n}',
})); skyDome.frustumCulled = false; scene.add(skyDome);

/* ---------------- city ---------------- */
const city = buildCity(scene);
buildFlora(city.root, city.trees, city.palms);
const out = buildOutskirts(scene);
city.seats.push(...out.seats);
const dist = buildDistricts(scene, city, out);
city.seats.push(...dist.seats);

const CELL = 10, grid = new Map(), key = (i, j) => i * 4099 + j;
function insert(o, x0, x1, z0, z1) { for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) { const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(o); } }
city.boxes.forEach(b => { b.kind = 0; insert(b, b.minX, b.maxX, b.minZ, b.maxZ); });
city.circles.forEach(c => { c.kind = 1; insert(c, c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r); });
out.boxes.forEach(b => { b.kind = 0; insert(b, b.minX, b.maxX, b.minZ, b.maxZ); });
out.circles.forEach(c => { c.kind = 1; insert(c, c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r); });
dist.boxes.forEach(b => { b.kind = 0; insert(b, b.minX, b.maxX, b.minZ, b.maxZ); });
dist.circles.forEach(c => { c.kind = 1; insert(c, c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r); });
const camBoxes = city.boxes.concat(out.boxes, dist.boxes);
const addBox = b => { b.kind = 0; insert(b, b.minX, b.maxX, b.minZ, b.maxZ); if (b.maxX - b.minX > 3 || b.maxZ - b.minZ > 3) camBoxes.push(b); };
const addCircle = c => { c.kind = 1; insert(c, c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r); };
let stamp = 0;
function collideStatic(p, R) {
  stamp++; let hit = false;
  for (let i = Math.floor((p.x - R) / CELL); i <= Math.floor((p.x + R) / CELL); i++) for (let j = Math.floor((p.z - R) / CELL); j <= Math.floor((p.z + R) / CELL); j++) {
    const list = grid.get(key(i, j)); if (!list) continue;
    for (const o of list) {
      if (o.st === stamp) continue; o.st = stamp;
      if (o.kind === 1) { const dx = p.x - o.x, dz = p.z - o.z, m = o.r + R, d2 = dx * dx + dz * dz; if (d2 < m * m && d2 > 1e-8) { const d = Math.sqrt(d2); p.x = o.x + dx / d * m; p.z = o.z + dz / d * m; hit = true; } }
      else {
        const nx = clamp(p.x, o.minX, o.maxX), nz = clamp(p.z, o.minZ, o.maxZ), dx = p.x - nx, dz = p.z - nz, d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue; hit = true;
        if (d2 < 1e-8) { const s = [[p.x - o.minX, -1, 0], [o.maxX - p.x, 1, 0], [p.z - o.minZ, 0, -1], [o.maxZ - p.z, 0, 1]].sort((a, b) => a[0] - b[0])[0]; p.x += s[1] * (s[0] + R); p.z += s[2] * (s[0] + R); }
        else { const d = Math.sqrt(d2); p.x = nx + dx / d * R; p.z = nz + dz / d * R; }
      }
    }
  }
  for (const o of (inside ? G.extraBoxes : G.buildBoxes || [])) {
    const nx = clamp(p.x, o.minX, o.maxX), nz = clamp(p.z, o.minZ, o.maxZ), dx = p.x - nx, dz = p.z - nz, d2 = dx * dx + dz * dz;
    if (d2 >= R * R) continue; hit = true;
    if (d2 < 1e-8) { const s = [[p.x - o.minX, -1, 0], [o.maxX - p.x, 1, 0], [p.z - o.minZ, 0, -1], [o.maxZ - p.z, 0, 1]].sort((a, b) => a[0] - b[0])[0]; p.x += s[1] * (s[0] + R); p.z += s[2] * (s[0] + R); }
    else { const d = Math.sqrt(d2); p.x = nx + dx / d * R; p.z = nz + dz / d * R; }
  }
  return hit;
}
function rayHit(o, dir, maxD) {
  let best = maxD;
  for (const b of (inside ? inside.boxes.concat(G.extraBoxes) : G.buildBoxes?.length ? camBoxes.concat(G.buildBoxes) : camBoxes)) {
    if (b.maxX - b.minX < 1.2 && b.maxZ - b.minZ < 1.2) continue;
    let t0 = 0, t1 = best;
    for (const [oa, da, mn, mx] of [[o.x, dir.x, b.minX, b.maxX], [o.z, dir.z, b.minZ, b.maxZ]]) {
      if (Math.abs(da) < 1e-6) { if (oa < mn || oa > mx) { t0 = 1e9; break; } continue; }
      let a = (mn - oa) / da, c = (mx - oa) / da; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) break;
    }
    if (t0 <= t1 && t0 < best && o.y + dir.y * t0 < (b.h ?? 14)) best = Math.max(.5, t0 - .3);
  }
  return best;
}

/* ---------------- traffic and parked cars ---------------- */
const traffic = new Traffic(scene);
const TYPES = ['sedan', 'sedan', 'sedan', 'taxi', 'taxi', 'taxi', 'suv', 'suv', 'keke', 'bus'];
[[-2, -2, 2, 2], [-2, -2, 0, 0], [0, 0, 2, 2], [-1, -1, 1, 1], [-1, 0, 1, 2], [-2, -2, 1, 0], [0, -2, 2, 0], [-2, 0, 0, 2]].forEach((l, i) => {
  LANES.forEach((lane, li) => {
    const r = routeFromNodes(rectLoop(...l), lane), n = l[2] - l[0] + l[3] - l[1] > 4 ? 3 : 2;
    for (let k = 0; k < n; k++) traffic.add(r, li === 1 && rand() < .4 ? pick(['keke', 'bus', 'taxi']) : pick(TYPES), r.total * (k / n) + i * 13 + li * 7);
  });
});
LANES.forEach(l => { const r = circleRoute(l); traffic.add(r, 'taxi', 0); traffic.add(r, pick(TYPES), r.total / 2); });
city.parked.concat(dist.parked).forEach(p => traffic.addParked(p.type, undefined, p.x, p.y, p.z, p.yaw));
G.patrolRoute = routeFromNodes(rectLoop(-1, -1, 1, 1), 3);

/* ---------------- people ---------------- */
const npcs = [];
function spawnNPCs() {
  city.vendors.forEach(v => {
    const ch = randomCharacter(v.suya ? false : v.female);
    ch.root.position.copy(v.pos); ch.root.rotation.y = v.yaw; scene.add(ch.root);
    npcs.push({ ch, kind: 'vendor', wave: v.wave, t: rand() * 10, pos: v.pos.clone() });
  });
  city.walkLoops.forEach(loop => {
    for (let k = 0; k < 2; k++) {
      const ch = randomCharacter(); scene.add(ch.root);
      const per = loop.map((p, i) => { const q = loop[(i + 1) % 4]; return Math.hypot(q[0] - p[0], q[1] - p[1]); }), total = per.reduce((a, b) => a + b, 0);
      npcs.push({ ch, kind: 'walker', loop, per, total, s: rand() * total, dir: rand() < .5 ? 1 : -1, speed: 1.1 + rand() * .6, lat: (rand() - .5) * .9, v: 0, yaw: 0 });
    }
  });
  for (let i = 0; i < 12; i++) {
    const path = pick(city.marketPaths), ch = randomCharacter(); scene.add(ch.root);
    npcs.push({ ch, kind: 'shopper', path, t: rand(), dir: rand() < .5 ? 1 : -1, speed: .9 + rand() * .5, pause: 0, v: 0, yaw: 0 });
  }
}
function updateNPCs(dt, t) {
  const cam = camera.position;
  for (let k = npcs.length - 1; k >= 0; k--) {
    const n = npcs[k], r = n.ch.root, far = r.position.distanceToSquared(cam) > 85 * 85;
    let speed = 0;
    if (n.kind === 'flee') { // a driver who just lost their car
      n.t += dt; const sp = n.t < .6 ? 0 : 5.5;
      r.position.x += Math.sin(n.yaw) * sp * dt; r.position.z += Math.cos(n.yaw) * sp * dt; r.position.y = gY(r.position.x, r.position.z); r.rotation.y = n.yaw;
      n.ch.update(dt, sp);
      if (n.t > 7) { scene.remove(r); npcs.splice(k, 1); }
      continue;
    }
    if (n.kind === 'walker') {
      let s = n.s, i = 0; while (s > n.per[i]) { s -= n.per[i]; i = (i + 1) % 4; }
      const a = n.loop[i], b = n.loop[(i + 1) % 4], f = s / n.per[i], dx = (b[0] - a[0]) / n.per[i], dz = (b[1] - a[1]) / n.per[i];
      const x = a[0] + (b[0] - a[0]) * f - dz * n.lat * n.dir, z = a[1] + (b[1] - a[1]) * f + dx * n.lat * n.dir;
      const hx = dx * n.dir, hz = dz * n.dir, px = player.pos.x - x, pz = player.pos.z - z, ahead = px * hx + pz * hz, lat = Math.abs(px * hz - pz * hx);
      const want = ahead > 0 && ahead < (player.car ? 5 : 1.8) && lat < (player.car ? 1.8 : .8) ? 0 : n.speed;
      n.v = damp(n.v, want, 5, dt); speed = n.v;
      n.s = (n.s + n.v * n.dir * dt + n.total) % n.total;
      r.position.set(x, CURB, z); n.yaw = angleLerp(n.yaw, Math.atan2(hx, hz), 1 - Math.exp(-dt * 8)); r.rotation.y = n.yaw;
    } else if (n.kind === 'shopper') {
      const [a, b] = n.path, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (n.pause > 0) { n.pause -= dt; n.v = damp(n.v, 0, 6, dt); }
      else {
        n.v = damp(n.v, n.speed, 4, dt); n.t += n.dir * n.v * dt / L;
        if (n.t > 1 || n.t < 0) { n.t = clamp(n.t, 0, 1); n.dir *= -1; n.pause = 1 + rand() * 3; }
        else if (rand() < dt * .08) n.pause = 1.5 + rand() * 2.5;
      }
      speed = n.v;
      const x = a[0] + (b[0] - a[0]) * n.t, z = a[1] + (b[1] - a[1]) * n.t;
      r.position.set(x, CURB, z); const hy = Math.atan2((b[0] - a[0]) * n.dir, (b[1] - a[1]) * n.dir);
      n.yaw = angleLerp(n.yaw, n.pause > 0 ? hy + Math.PI / 2 : hy, 1 - Math.exp(-dt * 5)); r.rotation.y = n.yaw;
    } else {
      n.t += dt;
      const near = n.pos.distanceToSquared(player.pos) < 64, clap = n.wave && (near || (n.t % 14) < 2.5);
      if (far) { r.visible = false; continue; }
      r.visible = true; n.ch.update(dt, 0, { anim: clap ? 'Clapping' : null }); continue;
    }
    r.visible = !far;
    if (!far) n.ch.update(dt, speed);
  }
}

/* ---------------- player ---------------- */
const player = { pos: new THREE.Vector3(-22, CURB, 22), vy: 0, onGround: true, yaw: Math.PI * .75, speed: 0, stepPh: 0, ch: null, car: null, look: 0, sit: null };
let camYaw = -Math.PI / 4, camPitch = .3, camDist = 7.5, started = false, alwaysRun = false;
function setAvatar(i) {
  if (player.ch) scene.remove(player.ch.root);
  player.look = i; player.ch = G.avatar ? makeAvatar(G.avatar, eco.outfit || {}) : LOOKS[i].make(eco.outfit || {}); scene.add(player.ch.root); player.ch.root.visible = !player.car && !G.ride;
}

/* ---------------- quest ---------------- */
const ORDER = ['tomatoes', 'yams', 'plantain', 'bread', 'suya'];
const quest = city.quest.slice().sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
function renderList() { $('list').innerHTML = quest.map(q => `<li class="${q.done ? 'done' : ''}"><span class="box">${q.done ? '✓' : ''}</span>${q.label}</li>`).join(''); }
renderList();
const markers = quest.map(q => {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(.35, 0), new THREE.MeshLambertMaterial({ color: 0xffcf5a, emissive: 0xffa928, emissiveIntensity: .8 }));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.2, .45, 30, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0b8, transparent: true, opacity: .14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 15; g.add(m, beam); g.position.copy(q.pos).setY(q.pos.y + 3.2); scene.add(g); return { g, m };
});

/* ---------------- vendor speech bubble ---------------- */
const bubble = $('bubble'); let bubbleT = 0, bubbleAt = null, callT = 3;
const CALLS = ['Customer, come and see!', 'Fine fresh things here!', 'Oya buy, I go reduce price!', 'Sannu! Welcome!', 'Ẹ káàbọ̀! Come in!', 'Nna, come and buy!', 'Good price for you today!'];
function say(text, pos, sec = 3) { bubble.textContent = text; bubbleAt = pos.clone().setY(pos.y + 2.25); bubbleT = sec; }
let speakT = 0;
function sayAt(text, pos, sec = 3) { say(text, pos, sec); if (pos.distanceTo(player.pos) < 22 && performance.now() > speakT) { speakT = performance.now() + 6000; Sound.speak(text, { pitch: .8 + rand() * .5, rate: 1.05, vol: .6 }); } }
const projV = new THREE.Vector3();
export function screenPos(p, out) { projV.copy(p).project(camera); if (projV.z > 1) return false; out.x = (projV.x * .5 + .5) * innerWidth; out.y = (-projV.y * .5 + .5) * innerHeight; return true; }
const sp2 = { x: 0, y: 0 };
function updateBubble(dt) {
  bubbleT -= dt; if (bubbleT <= 0 || !bubbleAt || !screenPos(bubbleAt, sp2)) { bubble.hidden = true; return; }
  bubble.hidden = false; bubble.style.transform = `translate(${sp2.x}px, ${sp2.y}px) translate(-50%, -100%)`;
}

/* ---------------- adverts ---------------- */
let adList = [], adRot = 0;
function paintAds(digitalOnly = false) {
  const ads = adList.length ? adList : [PLACEHOLDER];
  city.adSlots.forEach(s => {
    if (digitalOnly && !s.digital) return;
    const ad = ads[(s.i + (s.digital ? adRot : 0)) % ads.length]; s.ad = ad;
    const m = adMaterial(ad, s.kind); s.meshes.forEach(x => { x.material = m; });
  });
}
paintAds();
setInterval(() => { if (adList.length > 1) { adRot++; paintAds(true); } }, 12000);
const adMeshes = city.adSlots.flatMap(s => s.meshes);
function openAd(ad) {
  if (!ad || ad.id === 'empty') { $('adTitle').textContent = PLACEHOLDER.title; $('adLine').textContent = net.canEdit ? 'Open the Adverts button to add your own.' : 'This board is free. Ask the owner to place your advert.'; $('adImg').hidden = true; $('adLink').hidden = true; $('adCard').hidden = false; return; }
  $('adTitle').textContent = ad.title || ''; $('adLine').textContent = ad.line || '';
  const img = $('adImg'); if (ad.img) { img.src = imgUrl(ad.img); img.hidden = false; } else img.hidden = true;
  const link = safeLink(ad.link), a = $('adLink'); if (link) { a.href = link; a.textContent = 'Visit ' + new URL(link).hostname; a.hidden = false; } else a.hidden = true;
  $('adCard').hidden = false;
}
$('adClose').onclick = () => { $('adCard').hidden = true; canvas.focus(); };
$('adsClose').onclick = () => { $('adsPanel').hidden = true; canvas.focus(); };
$('bAds').onclick = () => openAdEditor({ panel: $('adsPanel'), list: $('adsList'), ads: adList, assets: net.assets, save: saveAds });

/* ---------------- minimap: centred on the player (map.js draws it) ---------------- */
const mm = $('map'), mctx = mm.getContext('2d'), MS = 150;
mm.width = mm.height = MS * 2; mctx.scale(2, 2);
function drawMap() {
  drawMini(mctx, MS, (mx, mz) => {
    quest.forEach(q => { if (q.done) return; mctx.fillStyle = '#ffcf3a'; mctx.strokeStyle = '#7a4a00'; mctx.lineWidth = 1.5; mctx.beginPath(); mctx.arc(mx(q.pos.x), mz(q.pos.z), 4, 0, 7); mctx.fill(); mctx.stroke(); });
    remoteDots().forEach(d => { mctx.fillStyle = d.color; mctx.strokeStyle = '#fff'; mctx.lineWidth = 1.5; mctx.beginPath(); mctx.arc(mx(d.x), mz(d.z), 3.5, 0, 7); mctx.fill(); mctx.stroke(); });
    if (moveTarget) { mctx.strokeStyle = '#1d8a4a'; mctx.lineWidth = 2; mctx.beginPath(); mctx.arc(mx(moveTarget.x), mz(moveTarget.z), 4, 0, 7); mctx.stroke(); }
  });
}

/* ---------------- effects ---------------- */
const puffTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const puffs = [];
city.smokes.forEach(p => { for (let i = 0; i < 10; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: 0xd8d4cc, transparent: true, depthWrite: false })); s.userData = { o: p, t: i / 10 }; scene.add(s); puffs.push(s); } });
const sparks = [];
function sparkle(p) {
  const n = 30, pos = new Float32Array(n * 3), vel = [];
  for (let i = 0; i < n; i++) { pos.set([p.x, p.y, p.z], i * 3); const a = rand() * 6.28, s = 2 + rand() * 3; vel.push([Math.cos(a) * s, 3 + rand() * 3, Math.sin(a) * s]); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: puffTex, size: .5, color: 0xffd76a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(pts); sparks.push({ pts, vel, t: 0 });
}
// click-to-move target ring
const ring = new THREE.Mesh(new THREE.RingGeometry(.45, .65, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .85, depthWrite: false }));
ring.visible = false; scene.add(ring);

/* ---------------- input ---------------- */
const keys = {};
let moveTarget = null, lastTap = { t: 0, x: 0, y: 0 };
addEventListener('keydown', e => {
  if (typing()) { if (e.code === 'Escape') document.activeElement.blur(); return; }
  if (e.target.tagName === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter')) return;
  if (!started) return;
  if (editKey(e.code)) return;
  if (!$('dlg').hidden || shopOpen()) { if (e.code === 'Escape') { $('shop').hidden = true; } return; }
  if (e.code === 'Enter' || e.code === 'KeyT') { e.preventDefault(); $('chatInput').focus(); return; }
  if (e.code === 'KeyE' && !e.repeat) doAction();
  if (mapOpen()) { if (e.code === 'Escape' || e.code === 'KeyM') $('mapClose').click(); return; }
  if (e.code === 'KeyM' && !e.repeat && started) { openMap(); return; }
  if (e.code === 'KeyP' && !e.repeat) { togglePhone(); return; }
  if (e.code === 'Escape' && phoneOpen()) { togglePhone(false); return; }
  if (e.code === 'KeyH' && !e.repeat && player.car) honk();
  if (e.code === 'KeyR' && !e.repeat) setRun(!alwaysRun);
  keys[e.code] = true;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) clearTarget();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
let drag = null, joy = null, follow = null, jumpReq = false;
canvas.addEventListener('contextmenu', e => e.preventDefault()); const joyEl = $('joy'), knob = joyEl.firstElementChild, joyVec = { x: 0, y: 0 };
canvas.addEventListener('pointerdown', e => {
  canvas.focus();
  if (editPointer('down', e)) { canvas.setPointerCapture(e.pointerId); return; }
  if (e.pointerType === 'touch' && e.clientX < innerWidth * .45 && !joy) { joy = { id: e.pointerId, x: e.clientX, y: e.clientY }; joyEl.hidden = false; joyEl.style.left = e.clientX + 'px'; joyEl.style.top = e.clientY + 'px'; clearTarget(); $('joyBase').classList.add('used'); }
  // mouse: hold the left button and the character follows the cursor; right or middle drag turns the camera
  else if (e.pointerType === 'mouse' && e.button === 0 && !follow) follow = { id: e.pointerId, cx: e.clientX, cy: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), on: false };
  else if (!drag) drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (edit.active) { editPointer('move', e); return; }
  if (joy && e.pointerId === joy.id) { let dx = e.clientX - joy.x, dy = e.clientY - joy.y; const l = Math.hypot(dx, dy); if (l > 50) { dx *= 50 / l; dy *= 50 / l; } joyVec.x = dx / 50; joyVec.y = dy / 50; knob.style.transform = `translate(${dx}px,${dy}px)`; }
  else if (follow && e.pointerId === follow.id) { follow.cx = e.clientX; follow.cy = e.clientY; if (!follow.on && Math.hypot(e.clientX - follow.x0, e.clientY - follow.y0) > 10) { follow.on = true; clearTarget(); } }
  else if (drag && e.pointerId === drag.id) { camYaw -= (e.clientX - drag.x) * .006; camPitch = clamp(camPitch + (e.clientY - drag.y) * .004, .02, 1.2); drag.x = e.clientX; drag.y = e.clientY; drag.moved = true; }
});
const endPtr = e => {
  if (edit.active) { editPointer('up', e); return; }
  if (joy && e.pointerId === joy.id) { joy = null; joyVec.x = joyVec.y = 0; joyEl.hidden = true; knob.style.transform = ''; }
  if (follow && e.pointerId === follow.id) { const quick = !follow.on && performance.now() - follow.t0 < 350; follow = null; if (quick && e.type === 'pointerup') tap(e.clientX, e.clientY); }
  if (drag && e.pointerId === drag.id) {
    const still = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 8 && performance.now() - drag.t0 < 400;
    drag = null; if (still && e.type === 'pointerup') tap(e.clientX, e.clientY);
  }
};
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', e => { camDist = clamp(camDist + e.deltaY * .01, 3.5, 22); e.preventDefault(); }, { passive: false });
$('bJump').addEventListener('pointerdown', e => { jumpReq = true; e.preventDefault(); });
$('bRun').onclick = () => setRun(!alwaysRun);
$('bCar').onclick = () => doAction();
$('bHonk').onclick = () => honk();
$('bArrange').onclick = () => { startEdit(); syncButtons(); };
function setRun(on) { alwaysRun = on; $('bRun').classList.toggle('on', on); $('bRun').setAttribute('aria-pressed', on); toast(on ? 'Running on' : 'Running off'); }

/* tap / click: adverts, players, or walk there */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function tap(cx, cy) {
  if (!started) return;
  ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects([...remoteHits(), ...adMeshes], false);
  const groundT = groundHit(ray.ray);
  if (hits.length && (groundT === null || hits[0].distance < groundT + .5)) {
    const o = hits[0].object;
    if (o.userData.slot) return openAd(o.userData.slot.ad);
    if (o.userData.peerId) return openPlayerCard(o.userData.peerId);
  }
  if (player.car || groundT === null) return;
  const p = ray.ray.at(groundT, new THREE.Vector3());
  const now = performance.now(), dbl = now - lastTap.t < 380 && Math.hypot(cx - lastTap.x, cy - lastTap.y) < 30;
  lastTap = { t: now, x: cx, y: cy };
  moveTarget = { x: p.x, z: p.z, run: dbl, best: Infinity, check: 0 };
  ring.position.set(p.x, gY(p.x, p.z) + .03, p.z); ring.visible = true;
}
function groundHit(r) {
  for (let t = 1; t < 260; t += .5) {
    const x = r.origin.x + r.direction.x * t, y = r.origin.y + r.direction.y * t, z = r.origin.z + r.direction.z * t;
    if (y <= gY(x, z)) return t;
  }
  return null;
}
function clearTarget() { moveTarget = null; ring.visible = false; }

/* ---------------- cars: take, drive, leave ---------------- */
let nearCar = null;
function toggleCar() {
  if (!started) return;
  const c = player.car;
  if (c) { // get out on the driver's side (left)
    c.mode = 'parked'; c.v = 0; c.steer = 0; player.car = null;
    const lx = c.fwd.y, lz = -c.fwd.x, off = c.w / 2 + .7;
    player.pos.set(c.pos.x + lx * off, gY(c.pos.x + lx * off, c.pos.y + lz * off), c.pos.y + lz * off);
    collideStatic(player.pos, .35);
    player.yaw = c.yaw; player.ch.root.visible = true; camDist = 7.5;
    setPresence({ drv: null }); syncButtons(); return;
  }
  nearCar = traffic.nearest(player.pos.x, player.pos.z, 3.6, x => x.mode !== 'gone');
  if (!nearCar) return;
  const car = nearCar;
  if (car.noTake) { toast(car.police ? 'You cannot take a police car' : 'You cannot take this vehicle'); return; }
  if (car.forSale) { toast('Buy it first, or the salesman will call police'); return; }
  if (car.mode === 'crashed') { toast('This car is damaged'); return; }
  if (!car.owned && !car.home && car.mode === 'parked') car.home = { x: car.pos.x, z: car.pos.y, yaw: car.yaw, y: car.y };
  if (!car.owned) {
    const wasAI = car.mode === 'ai'; car.stolen = wasAI ? 'hijack' : (car.stolen || 'borrowed');
    if (wasAI) addWanted(traffic.nearest(car.pos.x, car.pos.y, 45, o => o.police) ? 2 : 1, 'You took a car by force. The police are looking for you.');
  }
  if (car.mode === 'ai') { // the driver jumps out and runs off
    const ch = randomCharacter(false), lx = car.fwd.y, lz = -car.fwd.x;
    ch.root.position.set(car.pos.x + lx * 1.6, 0, car.pos.y + lz * 1.6); scene.add(ch.root);
    const away = Math.atan2(lx, lz) + (rand() - .5) * .6;
    npcs.push({ ch, kind: 'flee', t: 0, yaw: away });
    say(pick(['Ah! My car o!', 'Thief! Somebody help!', 'Haba! Bring my keke back!', 'Chai! My taxi!']), ch.root.position, 2.5);
  }
  car.mode = 'player'; player.car = car; car.v = car.mode === 'ai' ? 0 : 0; clearTarget();
  player.ch.root.visible = false; camDist = 11;
  toast(isTouch ? 'You took the car. Use the joystick to drive.' : 'You took the car. W/S drive, A/D steer, Space brake, H honk, E get out.');
  syncButtons();
}
function leaveCar(silent) {
  const c = player.car; if (!c) return;
  c.mode = 'parked'; c.v = 0; c.steer = 0; player.car = null;
  const lx = c.fwd.y, lz = -c.fwd.x, off = c.w / 2 + .7;
  player.pos.set(c.pos.x + lx * off, gY(c.pos.x + lx * off, c.pos.y + lz * off), c.pos.y + lz * off); collideStatic(player.pos, .35);
  player.ch.root.visible = true; camDist = 7.5; setPresence({ drv: null }); syncButtons();
}
let action = null;
function doAction() {
  if (!started) return;
  if (player.car) return toggleCar();
  if (player.sit) return standUp();
  const a = findAction(player.pos, traffic.nearest(player.pos.x, player.pos.z, 3.6)); if (!a) return;
  if (a.kind === 'car') toggleCar();
  else if (a.kind === 'door') { clearTarget(); enter(a.door, a.slot); }
  else if (a.kind === 'exit') exitPlace();
  else if (a.kind === 'seat') sitDown(a.seat);
  else if (a.kind === 'bed') sleep();
  else if (a.kind === 'claim') claim(a.house);
  else if (a.kind === 'shop') openShop(a.name, a.cat, { onWear: () => setAvatar(player.look), sub: a.cat === 'boutique' ? 'Try something new. It goes on right away.' : a.cat === 'furniture' ? 'Delivered to your house storage.' : a.cat === 'pos' ? '' : 'Food gives you energy.', empty: a.cat === 'pos' ? 'POS: "Network is down, come back later."' : undefined });
  else if (a.kind === 'work') workShift(a.name);
  else if (a.kind === 'use') useThing(a.use);
  else if (a.kind === 'ticket') ticketCounter(inside?.door.airport);
  else if (a.kind === 'gate') boardingGate(inside?.door.airport);
  else if (a.run) a.run();
  syncButtons();
}
function sitDown(seat) {
  clearTarget(); seat.taken = true; player.sit = seat;
  player.pos.set(seat.x, seat.y ?? gY(seat.x, seat.z), seat.z); player.yaw = seat.yaw; player.speed = 0;
  toast('Resting here slowly brings your energy back'); syncButtons();
}
function standUp() {
  const s = player.sit; if (!s) return; s.taken = false; player.sit = null;
  player.pos.x += Math.sin(s.yaw) * .7; player.pos.z += Math.cos(s.yaw) * .7; syncButtons();
}
function teleport(x, y, z, yaw, indoors) {
  if (player.sit) standUp();
  player.pos.set(x, y, z); player.yaw = yaw; player.vy = 0; clearTarget(); nearCar = null;
  camYaw = yaw + Math.PI; camPitch = indoors ? .78 : .3; camDist = indoors ? 9 : 7.5; first = true;
  syncButtons();
}
initPlaces({ city, scene, groundY, addBox, addCircle, teleport, toast });
const GOODS_NAMES = { tomatoes: 'tomatoes', pepper: 'pepper', yams: 'yam', plantain: 'plantain', onions: 'onions', oranges: 'drinks', basins: 'basins', fabric: 'fabric', suya: 'suya' };
G.actionProviders.push((p, consider, ins) => {
  if (ins || player.car || G.region !== 'city') return;
  city.vendors.forEach(v => { if (!v.stand || !v.goods || !(SHOP_STOCK[v.goods] || []).length) return; consider(Math.hypot(p.x - v.stand.x, p.z - v.stand.z) - .4, { label: `Buy ${GOODS_NAMES[v.goods] || 'from the seller'}`, run: () => openShop(v.suya ? 'Mallam Sani Suya' : 'Market stall', v.goods, { onWear: () => setAvatar(player.look), sub: 'Market price. You fit price am small.' }) }); });
});
function honk() { Sound.horn(1.4); const c = player.car; if (c) sendHonk(c.pos.x, c.pos.y); }
net.on('honk', d => { if (d && Math.hypot(d.x - player.pos.x, d.z - player.pos.z) < 60) Sound.horn(.8); });
const carTmp = new THREE.Vector3();
function drive(c, dt, throttle, steer, brake, boost) {
  const max = boost ? 26 : 17;
  if (throttle > 0) c.v += (c.v < 0 ? 16 : 7) * throttle * dt;
  else if (throttle < 0) c.v += (c.v > 0 ? 18 : 6) * throttle * dt;
  else c.v = Math.sign(c.v) * Math.max(0, Math.abs(c.v) - 3 * dt);
  if (brake) c.v = damp(c.v, 0, 5, dt);
  c.v = clamp(c.v, -6, max);
  c.yaw -= steer * clamp(Math.abs(c.v) / 5, 0, 1) * 1.8 * Math.sign(c.v || 1) * dt; c.steer = -steer * .45;
  c.fwd.set(Math.sin(c.yaw), Math.cos(c.yaw));
  c.pos.x += c.fwd.x * c.v * dt; c.pos.y += c.fwd.y * c.v * dt;
  // bump into buildings, poles and other cars using three circles along the body
  let bumped = false; const r = c.w / 2;
  for (const o of [-c.len / 3, 0, c.len / 3]) {
    carTmp.set(c.pos.x + c.fwd.x * o, 0, c.pos.y + c.fwd.y * o); const bx = carTmp.x, bz = carTmp.z;
    if (collideStatic(carTmp, r)) bumped = true;
    traffic.collide(carTmp, r * .9, c);
    c.pos.x += carTmp.x - bx; c.pos.y += carTmp.z - bz; if (carTmp.x !== bx || carTmp.z !== bz) bumped = true;
  }
  if (bumped && Math.abs(c.v) > 4) { c.v *= .45; Sound.step(); }
  const bb = bounds(); c.pos.x = clamp(c.pos.x, bb[0], bb[1]); c.pos.y = clamp(c.pos.y, bb[2], bb[3]);
  c.y = damp(c.y, gY(c.pos.x, c.pos.y), 12, dt);
  traffic.sync(c);
}
function bounds() {
  if (G.region === 'city' || !REG[G.region]) return [-BOUND, BOUND, -BOUND, BOUND];
  const r = REG[G.region]; return [r.x - r.hx, r.x + r.hx, r.z - r.hz, r.z + r.hz];
}
function syncButtons() {
  const touch = isTouch && started;
  if (G.ride) { ['bJump', 'bRun', 'bCar', 'bHonk', 'bArrange', 'hint'].forEach(id => $(id).hidden = true); return; }
  $('bJump').hidden = !touch || !!player.car || !!player.sit; $('bRun').hidden = !touch || !!player.car || !!player.sit;
  const label = player.car ? 'Get out' : player.sit ? 'Stand up' : action ? action.label : null;
  $('bCar').hidden = !started || !label; $('bCar').textContent = label || '';
  $('bHonk').hidden = !touch || !player.car;
  $('bArrange').hidden = !(inside && inMyHouse()) || edit.active;
  const hint = $('hint');
  if (!started || isTouch) hint.hidden = true;
  else if (player.car) { hint.hidden = false; hint.innerHTML = '<kbd>E</kbd> Get out <kbd>H</kbd> Honk <kbd>Space</kbd> Brake <kbd>Shift</kbd> Boost'; }
  else if (label) { hint.hidden = false; hint.innerHTML = '<kbd>E</kbd> '; hint.append(label); }
  else hint.hidden = true;
}

/* ---------------- UI ---------------- */
const toastEl = $('toast'); let toastT;
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2800); }
let lookIdx = 0; const picker = $('picker');
function renderPicker() {
  picker.innerHTML = LOOKS.map((l, i) => `<button class="pick${i === lookIdx ? ' on' : ''}" data-i="${i}" aria-pressed="${i === lookIdx}"><b>${l.name}</b><span>${l.desc}</span></button>`).join('');
  picker.querySelectorAll('button').forEach(b => b.onclick = () => { lookIdx = +b.dataset.i; renderPicker(); setAvatar(lookIdx); });
}
if (isTouch) $('keys').innerHTML = '<kbd>Left thumb</kbd><span>Drag anywhere on the left to walk</span><kbd>Right thumb</kbd><span>Drag to look around</span><kbd>Green button</kbd><span>Do the thing shown (enter, sit, buy, drive)</span><kbd>Tap</kbd><span>Walk to a spot</span>';
$('keys2').innerHTML = $('keys').innerHTML;
/* choose your life (Vision 2027 roles) */
let pickedRole = null;
const ROLE_START = { citizen: ['Homefinders Estate Agency', 'Find a free house in Gwarinpa'], politician: ['INEC Office', 'Contest your first seat at INEC'], sponsor: ['Sovereign Trust Bank HQ', 'Your bank is in Maitama'], coordinator: ['Nyanya Motor Park', 'Your turf: Nyanya Motor Park'] };
function renderRolePick() {
  const cur = pickedRole || eco.role || 'citizen';
  $('rolePick').innerHTML = Object.entries(ROLES).map(([k, r]) => `<button class="pick${k === cur ? ' on' : ''}" data-r="${k}"><b>${r.name}</b><span>${r.blurb}</span></button>`).join('');
  $('rolePick').querySelectorAll('button').forEach(b => b.onclick = () => { pickedRole = b.dataset.r; renderRolePick(); });
  const r = ROLES[cur]; $('roleNote').textContent = `Starts with ${naira(r.money)} · Home: ${r.home}${eco.role && cur !== eco.role ? ' · Switching resets your money and meters' : ''}`;
}
onEco(() => { if (!started) renderRolePick(); });
renderRolePick();
$('bChat').onclick = () => { $('chat').classList.toggle('open'); if ($('chat').classList.contains('open')) $('chatInput').focus(); };
$('bStart').onclick = () => {
  if (isTouch) { document.body.classList.add('touch'); $('joyBase').hidden = false; $('bChat').hidden = false; }
  Sound.init(); Sound.playMusic(MUSIC_URL); $('intro').hidden = true; started = G.started = true; canvas.focus();
  $('side').hidden = false; $('chat').hidden = false; syncButtons();
  const r = pickedRole || eco.role || 'citizen', fresh = r !== eco.role || G.freshStart;
  if (r !== eco.role) setRole(r, true); G.freshStart = false;
  if (fresh) { const [place, tip] = ROLE_START[r], poi = dist.pois.find(o => o.name.startsWith(place)); if (poi) setTimeout(() => setDestination(poi.x, poi.z, poi.name), 600); toast(`You are a ${ROLES[r].name}. ${tip}. Press M for the map.`); }
  else toast(`Welcome back, ${ROLES[r].name}. Press M for the map.`);
  try { if (!localStorage.getItem('v27.tip.land')) { localStorage.setItem('v27.tip.land', '1'); setTimeout(() => toast('Tip: open the map (M) and use "I want to" to find land, houses, shops and jobs. Green road signs point the way too.'), 7000); } } catch { }
};
$('bInfo').onclick = () => { $('info').hidden = false; };
$('bClose').onclick = () => { $('info').hidden = true; canvas.focus(); };
$('bSound').onclick = () => { Sound.init(); const on = Sound.toggle(); $('wave').style.opacity = on ? 1 : .15; canvas.focus(); };
$('bStay').onclick = () => { $('done').hidden = true; canvas.focus(); };

/* ---------------- loading ---------------- */
const startBtn = $('bStart'); startBtn.disabled = true; startBtn.textContent = 'Loading people…';
let loaded = false;
function onLoaded(ok) {
  if (loaded) return; loaded = true;
  spawnNPCs(); spawnOfficers(); spawnGuards(); renderPicker(); setAvatar(lookIdx);
  startBtn.disabled = false; startBtn.textContent = 'Start';
  if (!ok) $('loadNote').hidden = false;
}
loadMen().then(() => onLoaded(true)).catch(err => { console.warn('Character models failed to load', err); onLoaded(false); });
setTimeout(() => onLoaded(false), 15000);
async function boot() {
  let rt = null, B = null;
  if (__WEB__) {
    $('intro').hidden = true;
    const A = await import('./auth.js'); B = await import('./backend.js');
    const profile = await A.authGate();
    G.profile = profile; G.avatar = profile.avatar;
    // log out: save money and progress first, then sign out
    G.logout = async () => {
      if (!(await dialog('Log out?', 'Your money and progress are saved to your account first.', [{ label: 'Log out', value: true }, { label: 'Stay', value: false }]))) return;
      try { await flushSave(); await syncWallet(); } catch { }
      A.logout();
    };
    $('bOut').hidden = false; $('bOut').onclick = () => G.logout();
    rt = { room: B.makeRoom(profile), db: B.makeDb(), user: B.makeUser(profile) };
  }
  await initNet(rt);
  useServer(B?.W);
  await initEconomy(); lastOutfit = JSON.stringify(eco.outfit || {}); if (player.ch) setAvatar(player.look);
  if (__WEB__) applyProfile(G.profile, B);
  initHub(B); initGigs(dist); initWork(); initFloors(); initMarket(out.spots); initUpkeep(); initLand(); initExplorer(); initVoice(); checkStreak(); paintHud();
  initSocial({ scene, camera, player, toast, screenPos, getIn: () => (inside ? inside.slot : null) });
  initPhone({ toast, ping: () => Sound.buy(false), goHome: () => { if (player.car) toggleCar(); goHome(); setTimeout(syncButtons, 1500); }, onPaint: () => {}, arrange: () => { if (inside && inMyHouse()) { startEdit(); syncButtons(); } else toast('Go inside your house first, then arrange it'); } });
  if (net.canEdit && net.db) $('bAds').hidden = false;
}
boot().catch(e => showError(e));
/* online build: the life you chose, and any office you won in an election */
function applyProfile(p, B) {
  const want = p.office ? 'politician' : (p.life === 'politician' ? 'citizen' : p.life || 'citizen');
  setRole(want, !!p.fresh || !eco.role);
  if (p.office) { eco.life.rank = officeRank(p.office); paintRole(); }
  $('intro').hidden = false; $('picker').hidden = true; $('rolePick').hidden = true; document.querySelectorAll('#intro .label').forEach(l => (l.hidden = true));
  $('roleNote').textContent = `${p.username} · ${ROLES[want].name}${p.office ? ' · ' + p.office : ''}`;
  $('intro').querySelector('h1').textContent = `Welcome, ${p.username}`;
  pickedRole = want; G.freshStart = !!p.fresh;
  G.flushSave = flushSave;
  initOfficeSync(B, (office, was) => {
    if (office) { setRole('politician', false); eco.life.rank = officeRank(office); toast(`You won! You are now ${ROLES.politician.name}: ${office}. ${office === 'president' || office === 'vp' ? 'Aso Rock is open to you.' : ''}`); }
    else if (was) { setRole('citizen', false); toast('Your term has ended. You are back among the people.'); }
    paintRole();
  });
}
net.on('ads', list => { adList = list || []; adRot = 0; paintAds(); });

/* ---------------- shared context for feature modules ---------------- */
Object.assign(G, { scene, camera, player, traffic, city, npcs, toast, say, sayAt, teleport, gY, collideStatic, addBox, addCircle, Sound, drive, leaveCar,
  setAvatarVisible: v => { if (player.ch) player.ch.root.visible = v && !player.car; },
  exitInterior: async () => { if (inside) exitPlace(); },
  energyHit: n => { energy.v = Math.max(0, energy.v - n); },
  meId, myHouseIdx: () => { const h = net.homes.get(meId()); return h ? h.house : -1; },
  ownerOf, inMyHouse: () => !!inside && inMyHouse(), homeGate: () => city.houses.find(h => h.idx === G.myHouseIdx())?.gate, myName: () => net.me.name || 'you', sit: seat => sitDown(seat),
  closePhone: () => togglePhone(false), isInside: () => !!inside, insideSlot: () => inside?.slot ?? null, insideName: () => inside?.name, insideRoom: () => inside, out, genOn: () => appliances.generator, isBusy: () => !$('dlg').hidden || shopOpen() || phoneOpen() || mapOpen(),
  track, phase: () => phase().id, priceMult: mult.price, fareMult: mult.fare, ticker: showTicker });
function showTicker(text) { const el = $('ticker'); el.textContent = text; el.hidden = false; clearTimeout(showTicker.t); showTicker.t = setTimeout(() => (el.hidden = true), 7000); }
const lightRig = { hemi, sun, top: skyDome.material.uniforms.top.value, low: skyDome.material.uniforms.low.value, tmp: new THREE.Color() };
initMap({ scene, pois: dist.pois, blocks: city.blocks, getInside: () => inside });
initSigns();
initRoles(dist);
initTransit(out); initEvents(out);
onEco(() => { setAvatarIfOutfitChanged(); });
let lastOutfit = '';
function setAvatarIfOutfitChanged() { const k = JSON.stringify(eco.outfit || {}); if (k !== lastOutfit && player.ch) { lastOutfit = k; setAvatar(player.look); } }

/* ---------------- loop ---------------- */
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 68 : 55; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const tmp2 = new THREE.Vector3();
const clock = new THREE.Clock(), camPos = new THREE.Vector3(), target = new THREE.Vector3(), tmp = new THREE.Vector3(), v2 = new THREE.Vector2();
let first = true, frame = 0, btnT = 0;

/* never leave a blank screen: show the first error, keep running */
const showError = e => (window.__showErr ? window.__showErr(e) : console.error(e));
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); toast('Graphics reset… one moment'); });
canvas.addEventListener('webglcontextrestored', () => { renderer.shadowMap.enabled = false; renderer.setPixelRatio(1); });
function tick() {
  requestAnimationFrame(tick);
  try { step(); } catch (e) { showError(e); try { renderer.render(scene, camera); } catch { } }
}
function step() {
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime; timeU.value = reduceMotion ? 0 : t; frame++; G.lastDt = dt;
  const locked = G.frozen || mapOpen() || shopOpen() || !$('dlg').hidden || edit.active || phoneOpen() && typing();
  // input
  let ix = 0, iz = 0;
  if (started && !typing() && !locked) { if (keys.KeyW || keys.ArrowUp) iz += 1; if (keys.KeyS || keys.ArrowDown) iz -= 1; if (keys.KeyD || keys.ArrowRight) ix += 1; if (keys.KeyA || keys.ArrowLeft) ix -= 1; }
  if (!locked) { ix += joyVec.x; iz -= joyVec.y; }
  if (!started) camYaw += dt * .06;
  const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
  const shift = keys.ShiftLeft || keys.ShiftRight;
  const p = player.pos;

  if (G.ride) {
    if (frame % 20 === 0) syncButtons(); action = null;
    player.speed = 0; if (frame % 6 === 0) setPresence({ x: +p.x.toFixed(1), z: +p.z.toFixed(1), y: 0, in: 'travel', ride: true });
  } else if (player.car) {
    const c = player.car;
    drive(c, dt, locked ? 0 : iz, locked ? 0 : ix, !!keys.Space || G.frozen, shift);
    p.set(c.pos.x, c.y, c.pos.y); player.yaw = c.yaw; player.speed = Math.abs(c.v);
    if (!drag && Math.abs(c.v) > 1) camYaw = angleLerp(camYaw, c.yaw + (c.v < 0 ? 0 : Math.PI), 1 - Math.exp(-dt * 2.5));
    setPresence({ x: +c.pos.x.toFixed(2), z: +c.pos.y.toFixed(2), y: +c.y.toFixed(2), yaw: +c.yaw.toFixed(3), sp: 0, look: player.look, drv: { t: c.mesh.userData.type, c: c.mesh.userData.color ?? 0 }, in: null, sit: false, ride: false });
  } else {
    // world-space move direction from keys, joystick or a clicked target
    if (player.sit) {
      if (il > .2 || keys.Space || jumpReq) standUp();
    }
    let mx = 0, mz = 0, mag = 0, run = shift || alwaysRun || (joy && Math.hypot(joyVec.x, joyVec.y) > .95);
    if (il > .05) {
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
      mx = fx * iz + rx * ix; mz = fz * iz + rz * ix; mag = Math.min(il, 1);
    } else if (follow && (follow.on || performance.now() - follow.t0 > 220) && !locked) {
      follow.on = true;
      ndc.set(follow.cx / innerWidth * 2 - 1, -(follow.cy / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
      const gt = groundHit(ray.ray);
      if (gt !== null) { const q = ray.ray.at(gt, tmp2); const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz); if (d > .7) { mx = dx / d; mz = dz / d; mag = Math.min(1, d / 1.5); run = run || d > 14; } }
    } else if (moveTarget) {
      const dx = moveTarget.x - p.x, dz = moveTarget.z - p.z, d = Math.hypot(dx, dz);
      if (d < .6) clearTarget();
      else {
        mx = dx / d; mz = dz / d; mag = Math.min(1, d / 1.2); run = run || moveTarget.run;
        moveTarget.check += dt; if (d < moveTarget.best - .3) { moveTarget.best = d; moveTarget.check = 0; }
        if (moveTarget.check > 1.4) { clearTarget(); toast("Can't get through there"); }
      }
    }
    run = run && energy.v > 0;
    player.speed = player.sit ? 0 : damp(player.speed, mag * (run ? 10.5 : 5.2), 10, dt);
    if (mag > .05) player.yaw = angleLerp(player.yaw, Math.atan2(mx, mz), 1 - Math.exp(-dt * 12));
    if (player.sit) { p.set(player.sit.x, player.sit.y ?? p.y, player.sit.z); player.yaw = player.sit.yaw; }
    else {
      p.x += Math.sin(player.yaw) * player.speed * dt; p.z += Math.cos(player.yaw) * player.speed * dt;
      collideStatic(p, .35); if (!inside) { traffic.collide(p, .4); const bb = bounds(); p.x = clamp(p.x, bb[0], bb[1]); p.z = clamp(p.z, bb[2], bb[3]); }
    }
    tickEnergy(dt, player.speed, run, !!player.sit);
    const gy = gY(p.x, p.z);
    if ((keys.Space || jumpReq) && player.onGround && started && !typing() && !player.sit && !locked) { player.vy = 6; player.onGround = false; }
    jumpReq = false;
    player.vy -= 18 * dt; p.y += player.vy * dt;
    if (player.sit) { player.vy = 0; player.onGround = true; }
    else if (p.y <= gy) { p.y = gy; player.vy = 0; player.onGround = true; }
    else if (player.onGround && p.y - gy < .5) { p.y = damp(p.y, gy, 20, dt); player.vy = 0; }
    else player.onGround = false;
    if (player.ch) { player.ch.root.position.copy(p); player.ch.root.rotation.y = player.yaw; player.ch.update(dt, player.speed, { air: !player.onGround, sit: !!player.sit }); }
    if (player.speed > .8 && player.onGround) { player.stepPh += dt * player.speed * (run ? 1.5 : 1.9); if (player.stepPh > Math.PI) { player.stepPh -= Math.PI; Sound.step(); } }
    if (started) setPresence({ x: +p.x.toFixed(2), z: +p.z.toFixed(2), y: +p.y.toFixed(2), yaw: +player.yaw.toFixed(3), sp: +player.speed.toFixed(1), air: !player.onGround, look: player.look, av: G.avatar ? avatarCode(G.avatar) : undefined, drv: null, in: inside ? inside.slot : null, sit: !!player.sit, ride: false, of: outfitCode() });
    // nearby car?
    btnT -= dt;
    if (btnT <= 0 && started) {
      btnT = .2; nearCar = inside ? null : traffic.nearest(p.x, p.z, 3.6);
      const a = player.sit ? null : findAction(p, nearCar);
      if ((a && a.label) !== (action && action.label)) { action = a; syncButtons(); } else action = a;
    }
  }
  if (ring.visible) { ring.material.opacity = .55 + Math.sin(t * 6) * .3; ring.scale.setScalar(1 + Math.sin(t * 6) * .08); }

  // world life
  traffic.update(dt, p, c => { if (c.pos.distanceTo(v2.set(p.x, p.z)) < 40) Sound.horn(1, panOf(c.pos.x, c.pos.y)); }, camera.position);
  updateTransit(dt); updateEvents(dt); updateHouse(dt); updateMap(dt, t); updateRoles(dt, t); updateLife(dt, lightRig); updateGigs(dt); updateWork(dt); updateFloors(dt); updateMarket(dt); updateUpkeep(dt); updateLand(dt); updateSigns(dt); updateVoice(dt); if (frame % 60 === 0 && started) visitCheck(); perfCheck(dt);
  if (frame % 30 === 0) checkHighwayExit();
  if (frame % 3 === 0 && started) mixAudio(p);
  if (loaded) updateNPCs(dt, t);
  city.flags.forEach(f => { const a = f.m.geometry.attributes.position; for (let i = 0; i < a.count; i++) { const x = f.base[i * 3]; a.setZ(i, Math.sin(x * 2.2 - t * 5 + f.ph) * .12 * x); } a.needsUpdate = true; });
  puffs.forEach(s => { const u = s.userData; u.t = (u.t + dt * .35) % 1; s.position.set(u.o.x + Math.sin(u.t * 6 + u.o.x) * .3, u.o.y + u.t * 3.5, u.o.z + u.t * .6); s.scale.setScalar(.5 + u.t * 1.8); s.material.opacity = (1 - u.t) * .5; });
  for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.t += dt; const a = s.pts.geometry.attributes.position; for (let j = 0; j < s.vel.length; j++) { s.vel[j][1] -= 7 * dt; a.array[j * 3] += s.vel[j][0] * dt; a.array[j * 3 + 1] += s.vel[j][1] * dt; a.array[j * 3 + 2] += s.vel[j][2] * dt; } a.needsUpdate = true; s.pts.material.opacity = 1 - s.t; if (s.t > 1) { scene.remove(s.pts); s.pts.geometry.dispose(); s.pts.material.dispose(); sparks.splice(i, 1); } }

  // quest (on foot only)
  quest.forEach((q, i) => {
    const mk = markers[i];
    if (q.done) { if (mk.g.visible) { mk.g.scale.multiplyScalar(.9); if (mk.g.scale.x < .05) mk.g.visible = false; } return; }
    mk.m.rotation.y += dt * 1.6; mk.m.position.y = Math.sin(t * 2 + i) * .2;
    if (started && !player.car && !inside && Math.hypot(p.x - q.pos.x, p.z - q.pos.z) < 2.4) {
      q.done = true; renderList(); const left = quest.filter(x => !x.done).length;
      say(q.line, closestVendor(q.pos), 3.5); Sound.buy(left === 0); sparkle(tmp.copy(q.pos).setY(q.pos.y + 2));
      toast(left ? `Bought ${q.label.toLowerCase()} from ${q.vendor}. ${left} left` : 'Mama’s list is complete!');
      if (!left) setTimeout(() => { $('done').hidden = false; }, 2200);
    }
  });
  callT -= dt;
  if (callT <= 0 && started && bubbleT <= 0) {
    callT = 4 + rand() * 4;
    const near = npcs.filter(n => n.kind === 'vendor' && n.pos.distanceToSquared(p) < 225 && n.pos.distanceToSquared(p) > 4);
    if (near.length) sayAt(pick(CALLS), pick(near).pos, 2.6);
  }
  Sound.setChatter(Math.max(0, 1 - Math.hypot(p.x + 96, p.z - 32) / 45) * .5);

  // camera
  target.set(p.x, p.y + (player.car ? 1.8 : 1.45), p.z);
  const dir = tmp.set(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  const d = started ? rayHit(target, dir, camDist) : camDist + 4;
  const want = target.clone().addScaledVector(dir, d); want.y = Math.max(want.y, gY(want.x, want.z) + .5);
  if (G.cine) { if (first) { camPos.copy(G.cine.pos); first = false; } else camPos.lerp(G.cine.pos, 1 - Math.exp(-dt * 4)); camera.position.copy(camPos); camera.lookAt(G.cine.look); }
  else { if (first) { camPos.copy(want); first = false; } else camPos.lerp(want, 1 - Math.exp(-dt * 10)); camera.position.copy(camPos); camera.lookAt(target); }
  if (G.shake > 0) { G.shake = Math.max(0, G.shake - dt * 1.5); camera.position.x += (rand() - .5) * G.shake * .3; camera.position.y += (rand() - .5) * G.shake * .3; }
  sun.position.copy(p).add(SUN_OFF); sun.target.position.copy(p); skyDome.position.copy(camera.position);

  updateBubble(dt);
  updateSocial(dt, t); updatePlaces(dt);
  if (frame % 3 === 0 && started) { const city_ = G.region === 'city' && !inside; mm.hidden = !city_; if (city_) drawMap(); if (!inside) { const pl = $('place'); if (G.region !== 'city' && !G.inTravel) { pl.textContent = REG[G.region]?.name || ''; pl.hidden = false; } else if (G.region === 'city') pl.hidden = true; } $('online').textContent = onlineCount(); }
  renderer.render(scene, camera);
}
let lastDistrict = '';
function visitCheck() { if (G.region !== 'city' || inside) return; const d = districtAt(player.pos.x, player.pos.z)?.name || ''; if (d && d !== lastDistrict) { lastDistrict = d; track('visit:' + d); } }
/* frame-rate guard: if the game runs slow for a few seconds, lighten it */
let perfAcc = 0, perfN = 0, perfStep = 0;
function perfCheck(dt) {
  if (!started || perfStep >= 2) return; perfAcc += dt; perfN++;
  if (perfAcc < 4) return; const fps = perfN / perfAcc; perfAcc = 0; perfN = 0;
  if (fps < 28) { perfStep++; if (perfStep === 1) { renderer.setPixelRatio(1); resize(); } else { renderer.shadowMap.enabled = false; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); scene.fog.far = 360; } }
}
function outfitCode() { const o = eco.outfit || {}; const r = {}; if (o.shirt != null) r.s = o.shirt; if (o.pants != null) r.p = o.pants; if (o.hat) r.h = o.hat; if (o.hatColor != null) r.c = o.hatColor; return Object.keys(r).length ? r : null; }
/* what the player hears, from what is around them */
const whooshT = new WeakMap(); let hornT = 6;
function mixAudio(p) {
  const lv = { traffic: 0, crowd: 0, birds: 0, wind: 0, room: 0, jet: 0, fire: 0, siren: 0, generator: 0, engine: 0, engineOn: false, village: 0 };
  const rg = G.region, indoor = !!inside;
  if (G.inTravel) { Object.assign(lv, G.mixHint || {}); lv.engineOn = !!lv.engine; Sound.mix(lv); return; }
  if (rg === 'city') {
    let tr = 0, n = 0, near = [];
    for (const c of traffic.cars) { if (c.mode === 'parked' || c.mode === 'gone') continue; const d = Math.hypot(c.pos.x - p.x, c.pos.y - p.z); if (d < 80) { tr += (1 - d / 80) * Math.min(1, Math.abs(c.v) / 9 + .15); if (d < 50) near.push(c); }
      if (d < 7 && Math.abs(c.v) > 7 && c !== player.car && performance.now() > (whooshT.get(c) || 0)) { whooshT.set(c, performance.now() + 2500); Sound.whoosh(Math.min(1, Math.abs(c.v) / 14), panOf(c.pos.x, c.pos.y)); } }
    lv.traffic = Math.min(1, tr / 3.5);
    for (const q of npcs) if (q.ch.root.visible && q.ch.root.position.distanceToSquared(p) < 18 * 18) n++;
    const market = Math.max(0, 1 - Math.hypot(p.x + 96, p.z - 32) / 40);
    lv.crowd = Math.min(1, n / 9 + market * .8);
    lv.birds = Math.max(0, 1 - Math.hypot(p.x - 96, p.z - 32) / 50) * .9 + (Math.max(Math.abs(p.x), Math.abs(p.z)) > 140 ? .5 : .1);
    lv.wind = Math.max(Math.abs(p.x), Math.abs(p.z)) > 140 ? .6 : .15;
    hornT -= .05; if (hornT <= 0 && near.length > 2 && !indoor) { hornT = 4 + rand() * 9; const c = pick(near); Sound.horn(.4 + rand() * .4, panOf(c.pos.x, c.pos.y)); }
    lv.fire = Math.max(0, 1 - nearestFire(p) / 30); lv.siren = Math.max(0, 1 - nearestSiren(p) / 160);
  } else if (rg === 'village') { lv.birds = 1; lv.wind = .7; lv.village = 1; lv.crowd = Math.max(0, 1 - Math.hypot(p.x - REG.village.x, p.z - REG.village.z) / 30) * .4; }
  else if (rg === 'airport' || rg === 'uyo') { const r = REG[rg]; lv.wind = .5; lv.birds = rg === 'uyo' ? .5 : .2; lv.jet = .25; lv.traffic = .15; }
  if (indoor) {
    const k = inside.door.kind;
    lv.traffic *= k === 'house' ? .06 : .18; lv.crowd = k === 'assembly' ? .45 : k === 'terminal' ? .55 : k === 'house' ? 0 : .2; lv.birds *= .1; lv.wind = 0; lv.siren *= .3; lv.fire *= .3;
    lv.room = k === 'house' ? .8 : .4; lv.generator = k === 'house' && appliances.generator ? 1 : 0; lv.jet *= .3;
  }
  if (player.car) { lv.engineOn = true; lv.engine = Math.abs(player.car.v); }
  Sound.mix(lv);
}
function closestVendor(pos) { let best = null, bd = 1e9; for (const n of npcs) if (n.kind === 'vendor') { const d = n.pos.distanceToSquared(pos); if (d < bd) { bd = d; best = n.pos; } } return best || pos; }
requestAnimationFrame(tick);
if (location.hash === '#debug') window.__game = { gigs: G.gigs, G, dist, net, out, eco, get srv() { return srv; }, transit, enterRegion, bookFlight, boardingGate, startCrash, startFire, startEdit, scene, makeCar, get inside() { return inside; }, player, traffic, city, doAction, cam: (y, p, d) => { camYaw = y; camPitch = p; camDist = d; }, tap, toggleCar, sayHead };

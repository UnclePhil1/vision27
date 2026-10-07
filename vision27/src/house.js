import * as THREE from 'three';
import { Batch, canvasTex } from './util.js';
import { G, dialog } from './game.js';
import { net, ownerOf, meId } from './net.js';
import { eco, addFurn, takeFurn, ITEMS, cookMenu, fridgeMenu, earn } from './economy.js';

/* Furniture you can move, rotate, store, buy and use. A house layout is saved in
   homes/<owner> as furn: [{ t, x, z, r }] in room coordinates (metres from the room centre). */

const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(1, 1, 1, 14), SPH = new THREE.IcosahedronGeometry(1, 1);
export const DEFAULT_LAYOUT = [
  { t: 'bed', x: 6.2, z: -3.6, r: 0 }, { t: 'wardrobe', x: 7.4, z: .6, r: 1 }, { t: 'sofa', x: -2.5, z: 1.7, r: 2 }, { t: 'table', x: -2.5, z: -.3, r: 0 },
  { t: 'tv', x: -2.5, z: -4.9, r: 0 }, { t: 'rug', x: -2.5, z: -.5, r: 0 }, { t: 'plant', x: -7.2, z: -4.6, r: 0 }, { t: 'fridge', x: -4, z: -4.85, r: 0 },
  { t: 'cooker', x: -6.6, z: -4.85, r: 0 }, { t: 'dining', x: -5.8, z: -1.6, r: 0 }, { t: 'fan', x: 1.8, z: -4.4, r: 0 },
];
const ROOM = { w: 16, d: 11 };
/* selling back returns 40% (10% if it is spoilt) */
const sellValue = f => Math.round((ITEMS[f.l.t]?.price || 0) * ((f.l.c ?? 100) <= 0 ? .1 : .4) / 100) * 100;
const sellText = f => '₦' + sellValue(f).toLocaleString('en-NG');

function build(t) {
  const b = new Batch(), box = (w, h, d, c, x, y, z, ry = 0) => b.add(BOX, c, x, y, z, ry, w, h, d);
  let size = [1, 1], h = 1, seats = [], use = null, bed = false, parts = {};
  switch (t) {
    case 'sofa': box(3.2, .45, .9, 0x1f7a5c, 0, .3, 0); box(3.2, .7, .25, 0x1f7a5c, 0, .65, -.4); box(.25, .6, .9, 0x1a6a50, -1.55, .5, 0); box(.25, .6, .9, 0x1a6a50, 1.55, .5, 0); size = [3.3, 1.1]; seats = [[-.9, .05], [0, .05], [.9, .05]]; break;
    case 'armchair': box(1, .45, .9, 0x8a4b22, 0, .3, 0); box(1, .7, .2, 0x8a4b22, 0, .65, -.4); size = [1.1, 1]; seats = [[0, .05]]; break;
    case 'bed': box(2.2, .5, 2.6, 0xf4f0e6, 0, .35, .1); box(2.3, .3, 2.7, 0x7a4e33, 0, .15, .1); box(2.2, .15, .9, 0x2e5fa8, 0, .65, -.85); box(2.3, 1.1, .15, 0x6e543b, 0, .8, -1.25); size = [2.3, 2.8]; h = .7; bed = true; break;
    case 'tv': box(2, .6, .5, 0x3a2d26, 0, .3, 0); box(1.8, 1, .08, 0x111111, 0, 1.2, -.05); size = [2, .5]; use = 'tv'; break;
    case 'table': box(1.4, .08, .8, 0x6e543b, 0, .4, 0); [[-.6, -.32], [.6, -.32], [-.6, .32], [.6, .32]].forEach(([x, z]) => box(.06, .4, .06, 0x4a3828, x, .2, z)); size = [1.4, .8]; h = .45; break;
    case 'dining': box(1.6, .08, 1, 0x8a6a4e, 0, .75, 0); box(.1, .75, .1, 0x555555, 0, .37, 0); [[0, .8, Math.PI], [0, -.8, 0]].forEach(([x, z, yaw]) => { box(.55, .08, .55, 0x8a6a4e, x, .45, z); box(.55, .6, .08, 0x8a6a4e, x, .75, z + (z > 0 ? .25 : -.25)); seats.push([x, z, yaw]); }); size = [1.6, 2.2]; break;
    case 'wardrobe': box(1.6, 2.2, .7, 0x8a6a4e, 0, 1.1, 0); box(.04, 1.8, .02, 0x4a3828, 0, 1.1, .36); size = [1.6, .7]; h = 2.2; use = 'wardrobe'; break;
    case 'frame': box(1.1, 1.1, .06, 0x3a2d26, 0, 1.6, 0); size = [1.1, .2]; h = 0; use = 'frame'; break;
    case 'fridge': box(.9, 1.8, .7, 0xf4f4f4, 0, .9, 0); box(.04, .5, .04, 0x888888, .35, 1.2, .37); size = [.9, .7]; h = 1.8; use = 'fridge'; break;
    case 'cooker': box(.9, .9, .6, 0xdedede, 0, .45, 0); box(.9, .05, .6, 0x2b2b2b, 0, .92, 0); [[-.2, -.1], [.2, -.1], [-.2, .15], [.2, .15]].forEach(([x, z]) => b.add(CYL, 0x111111, x, .95, z, 0, .1, .02, .1)); size = [.9, .6]; use = 'cooker'; break;
    case 'plant': b.add(CYL, 0x8a6a4e, 0, .3, 0, 0, .3, .6, .3); b.add(SPH, 0x3f8a4f, 0, 1, 0, 0, .55, .7, .55); size = [.7, .7]; h = 1.5; break;
    case 'rug': box(4, .02, 3, 0xc9472f, 0, .01, 0); box(3.4, .025, 2.4, 0xe8b23a, 0, .012, 0); size = [0, 0]; h = 0; break;
    case 'shelf': box(1.4, 1.9, .4, 0x6e543b, 0, .95, 0); for (let i = 0; i < 4; i++) for (let k = 0; k < 5; k++) box(.18, .32, .26, [0xc9472f, 0x2e5fa8, 0xe8b23a, 0x1f7a5c][(i + k) % 4], -.5 + k * .25, .3 + i * .45, .02); size = [1.4, .4]; h = 1.9; break;
    case 'fan': b.add(CYL, 0x333333, 0, .02, 0, 0, .25, .04, .25); b.add(CYL, 0x777777, 0, .6, 0, 0, .03, 1.2, .03); box(.25, .25, .2, 0xeeeeee, 0, 1.25, 0); size = [.5, .5]; h = 1.4; use = 'fan'; break;
    case 'generator': box(1.1, .7, .7, 0xe8b23a, 0, .4, 0); box(1.15, .1, .75, 0x2b2b2b, 0, .05, 0); b.add(CYL, 0x333333, -.35, .82, 0, 0, .12, .1, .12); size = [1.1, .7]; use = 'generator'; break;
    case 'lamp': b.add(CYL, 0x333333, 0, .02, 0, 0, .2, .04, .2); b.add(CYL, 0x777777, 0, .8, 0, 0, .025, 1.6, .025); b.add(new THREE.ConeGeometry(.25, .3, 12, 1, true), 0xf4e3b0, 0, 1.6, 0); size = [.4, .4]; h = 1.7; break;
  }
  const g = new THREE.Group(), m = b.build(mat); m.castShadow = t !== 'rug'; g.add(m);
  if (t === 'tv') { const sc = new THREE.Mesh(new THREE.PlaneGeometry(1.7, .92), new THREE.MeshBasicMaterial({ color: 0x0c0c0c })); sc.position.set(0, 1.2, -.005); g.add(sc); parts.screen = sc; }
  if (t === 'frame') { const pic = new THREE.Mesh(new THREE.PlaneGeometry(.94, .94), new THREE.MeshBasicMaterial({ color: 0xe9e2d2 })); pic.position.set(0, 1.6, .035); g.add(pic); parts.pic = pic; }
  if (t === 'fan') { const bl = new THREE.Group(); for (let k = 0; k < 3; k++) { const p = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: 0x9fc3d8 })); p.scale.set(.12, .02, .5); p.position.z = .25; const a = new THREE.Group(); a.rotation.y = k * Math.PI * 2 / 3; a.add(p); bl.add(a); } bl.rotation.x = Math.PI / 2; bl.position.set(0, 1.25, .14); g.add(bl); parts.blades = bl; }
  return { g, size, h, seats, use, bed, parts };
}

/* furnish the house interior `it` (from interiors.js) */
let current = null;
export function furnish(it) {
  clear();
  const o = ownerOf(it.door.house), h = o ? net.homes.get(o) : null;
  const layout = (h && Array.isArray(h.furn)) ? h.furn : DEFAULT_LAYOUT;
  const ox = (it.bounds.minX + it.bounds.maxX) / 2, oz = (it.bounds.minZ + it.bounds.maxZ) / 2;
  current = { it, ox, oz, items: [], layout: layout.map(x => ({ ...x })), owner: o };
  current.layout.forEach(l => place(l));
  if (it.floorMat && h?.floor) it.floorMat.color.set(h.floor);
  refreshDerived();
}
function place(l) {
  if (!ITEMS[l.t] && l.t !== 'bed') return;
  const f = build(l.t); f.l = l;
  f.g.position.set(current.ox + l.x, 0, current.oz + l.z); f.g.rotation.y = -l.r * Math.PI / 2;
  f.g.traverse(m => { if (m.isMesh) m.userData.furn = f; });
  G.scene.add(f.g); current.items.push(f);
  if (f.parts.pic) { const own = current.owner; G.upkeep?.frameTexture(l.img, own).then(t => { f.parts.pic.material = new THREE.MeshBasicMaterial({ map: t }); }); }
  return f;
}
function clear() {
  if (!current) return;
  current.items.forEach(f => G.scene.remove(f.g)); current = null; G.extraBoxes.length = 0;
}
export function leaveHouse() { stopEdit(false); clear(); }
/* colliders, seats, beds and usable things follow the furniture */
function refreshDerived() {
  if (!current) return;
  const it = current.it; G.extraBoxes.length = 0;
  it.seats = it.seats.filter(s => !s.furn); it.beds = []; it.uses = [];
  current.items.forEach(f => {
    const rot = f.l.r & 1, w = rot ? f.size[1] : f.size[0], d = rot ? f.size[0] : f.size[1], x = current.ox + f.l.x, z = current.oz + f.l.z;
    if (w > 0 && f.h > 0) G.extraBoxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h: f.h });
    const ang = -f.l.r * Math.PI / 2, c = Math.cos(ang), s = Math.sin(ang);
    const toW = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    f.seats.forEach(([lx, lz, yaw = 0]) => { const [wx, wz] = toW(lx, lz); it.seats.push({ x: wx, z: wz, y: 0, yaw: yaw + ang, furn: true }); });
    if (f.bed) { const [wx, wz] = toW(0, 1.6); it.beds.push({ x: wx, z: wz }); }
    if (f.use) { const [wx, wz] = toW(0, Math.max(.8, f.size[1] / 2 + .6)); it.uses.push({ x: wx, z: wz, f }); }
  });
}
const tvTex = canvasTex(256, 140, g => { g.fillStyle = '#123'; g.fillRect(0, 0, 256, 140); g.fillStyle = '#1d8a4a'; g.fillRect(0, 100, 256, 40); g.fillStyle = '#fff'; g.font = '700 22px system-ui'; g.fillText('CHANNEL 7 NEWS', 12, 128); g.fillStyle = '#e8b23a'; g.beginPath(); g.arc(200, 50, 30, 0, 7); g.fill(); }, false);
export const appliances = { generator: false };
export async function useThing(u) {
  const f = u.f, mine = inMyHouse();
  if (mine && G.upkeep?.blocked(f)) return G.upkeep.repairMenu(current.items.indexOf(f));
  if (f.use === 'frame') return mine ? changePhoto(f) : f.l.img && !f.l.img.startsWith('local-') ? G.upkeep?.reportPhoto(f.l.img) : null;
  if (f.use === 'wardrobe') return mine ? G.openWardrobe?.() : G.toast('This is not your wardrobe');
  if (f.use === 'generator' && !appliances.generator && mine && !G.upkeep?.generatorReady()) return;
  if (mine) G.upkeep?.wearThing(f, f.use === 'generator' ? 6 : 3);
  if (f.use === 'tv') { const on = !f.on; f.on = on; f.parts.screen.material = on ? new THREE.MeshBasicMaterial({ map: tvTex }) : new THREE.MeshBasicMaterial({ color: 0x0c0c0c }); G.toast(on ? 'TV on: the evening news' : 'TV off'); }
  else if (f.use === 'fan') { f.on = !f.on; G.toast(f.on ? 'Fan on' : 'Fan off'); }
  else if (f.use === 'generator') { appliances.generator = !appliances.generator; G.toast(appliances.generator ? 'Generator on. Light don come!' : 'Generator off'); }
  else if (f.use === 'fridge') await fridgeMenu();
  else if (f.use === 'cooker') await cookMenu();
}
export const useLabel = u => (inMyHouse() && G.upkeep?.blocked(u.f)) ? `Fix the ${ITEMS[u.f.l.t].name.toLowerCase()} (spoilt)` : ({ wardrobe: inMyHouse() ? 'Open wardrobe' : null, frame: inMyHouse() ? (u.f.l.img ? 'Change photo' : 'Add a photo') : (u.f.l.img ? 'Report this photo' : null), tv: u.f.on ? 'Turn off TV' : 'Turn on TV', fan: u.f.on ? 'Switch off fan' : 'Switch on fan', generator: appliances.generator ? 'Stop generator' : 'Start generator', fridge: 'Open fridge', cooker: 'Cook something' }[u.f.use]);
export function updateHouse(dt) { current?.items.forEach(f => { if (f.on && f.parts.blades) f.parts.blades.rotation.z += dt * 14; }); }
export const inMyHouse = () => !!current && current.owner === meId();
export const houseNow = () => current;
export function saveLayout(quiet) { if (!current) return; const furn = current.items.map(f => ({ ...f.l, x: +f.l.x.toFixed(2), z: +f.l.z.toFixed(2), r: f.l.r & 3 })); current.layout = furn; net.saveHome?.({ furn })?.catch?.(() => { }); if (!quiet) G.toast('House saved'); }
async function changePhoto(f) {
  const id = await G.upkeep.uploadPhoto(await G.upkeep.choosePhoto()); if (!id) return;
  f.l.img = id; saveLayout(true);
  G.upkeep.frameTexture(id, current.owner).then(t => { f.parts.pic.material = new THREE.MeshBasicMaterial({ map: t }); });
}

/* ---------- arrange mode ---------- */
const $ = id => document.getElementById(id);
export const edit = { active: false, sel: null, dragging: false };
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
const PAINTS = ['#f2e3c6', '#dcebd8', '#f3d1c4', '#d6e3f0', '#efe0a8', '#e6d6f0', '#ffffff'];
const FLOORS = ['#c9a77a', '#8a6a4e', '#d9cfbf', '#b8bcbe', '#6e8a6a', '#e8dcc8'];
export function startEdit() {
  if (!inMyHouse()) { G.toast('You can only arrange your own house'); return; }
  edit.active = true; edit.sel = null;
  G.cine = { pos: new THREE.Vector3(current.ox, 17, current.oz + 8), look: new THREE.Vector3(current.ox, 0, current.oz) };
  renderBar(); $('editBar').hidden = false;
}
export function stopEdit(saveIt = true) {
  if (!edit.active) return;
  edit.active = false; select(null); G.cine = null; $('editBar').hidden = true;
  if (saveIt && current) save();
}
const save = () => saveLayout(false);
function select(f) {
  if (edit.sel) edit.sel.g.traverse(m => { if (m.isMesh && m.userData.baseMat) { m.material = m.userData.baseMat; delete m.userData.baseMat; } });
  edit.sel = f;
  if (f) f.g.traverse(m => { if (m.isMesh && m.material.isMeshLambertMaterial) { m.userData.baseMat = m.material; m.material = m.material.clone(); m.material.emissive = new THREE.Color(0x3a5a2a); } });
  renderBar();
}
function renderBar() {
  const stored = Object.entries(eco.store).filter(([, n]) => n > 0);
  $('editBar').innerHTML = `<b>Arrange house</b>
    <span class="eb-group">${edit.sel ? `<button class="chip" data-ed="rot">Rotate</button><button class="chip" data-ed="store">Put in storage</button><button class="chip" data-ed="sell">Sell (${sellText(edit.sel)})</button>${edit.sel.l.t === 'frame' ? '<button class="chip" data-ed="photo">Choose photo</button>' : ''}` : '<small>Click a piece to move it. Drag it on the floor. Frames go best against a wall.</small>'}</span>
    <span class="eb-group">${stored.length ? `<select id="edAdd" aria-label="Add from storage"><option value="">Add from storage…</option>${stored.map(([t, n]) => `<option value="${t}">${ITEMS[t]?.name || t} ×${n}</option>`).join('')}</select>` : '<small>Storage empty. Buy furniture at Furniture Palace.</small>'}</span>
    <span class="eb-group"><small>Walls</small>${PAINTS.map(c => `<button class="sw" style="background:${c}" data-paint="${c}" aria-label="Wall ${c}"></button>`).join('')}</span>
    <span class="eb-group"><small>Floor</small>${FLOORS.map(c => `<button class="sw" style="background:${c}" data-floor="${c}" aria-label="Floor ${c}"></button>`).join('')}</span>
    <button class="cta" data-ed="done">Done</button>`;
  const sel = $('edAdd'); if (sel) sel.onchange = () => { const t = sel.value; if (!t || !takeFurn(t)) return; const l = { t, x: 0, z: 0, r: 0 }; current.layout.push(l); const f = place(l); refreshDerived(); select(f); };
}
document.addEventListener('click', e => {
  if (!edit.active) return;
  const b = e.target.closest('#editBar [data-ed],#editBar [data-paint],#editBar [data-floor]'); if (!b) return;
  if (b.dataset.ed === 'done') stopEdit(true);
  else if (b.dataset.ed === 'rot' && edit.sel) { edit.sel.l.r = (edit.sel.l.r + 1) & 3; edit.sel.g.rotation.y = -edit.sel.l.r * Math.PI / 2; refreshDerived(); }
  else if (b.dataset.ed === 'store' && edit.sel) { const f = edit.sel; select(null); G.scene.remove(f.g); current.items.splice(current.items.indexOf(f), 1); addFurn(f.l.t); refreshDerived(); renderBar(); }
  else if (b.dataset.ed === 'sell' && edit.sel) { const f = edit.sel, v = sellValue(f); select(null); G.scene.remove(f.g); current.items.splice(current.items.indexOf(f), 1); refreshDerived(); renderBar(); saveLayout(true); earn(v, `for your ${ITEMS[f.l.t].name.toLowerCase()}`); }
  else if (b.dataset.ed === 'photo' && edit.sel) changePhoto(edit.sel);
  else if (b.dataset.paint) { current.it.wallMat?.color.set(b.dataset.paint); net.saveHome?.({ paint: b.dataset.paint }); }
  else if (b.dataset.floor) { current.it.floorMat?.color.set(b.dataset.floor); net.saveHome?.({ floor: b.dataset.floor }); }
});
/* pointer handling while arranging; returns true when it used the event */
export function editPointer(type, e) {
  if (!edit.active) return false;
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, G.camera);
  if (type === 'down') {
    const meshes = current.items.flatMap(f => { const a = []; f.g.traverse(m => m.isMesh && a.push(m)); return a; });
    const h = ray.intersectObjects(meshes, false)[0];
    select(h ? h.object.userData.furn : null); edit.dragging = !!h; return true;
  }
  if (type === 'move' && edit.dragging && edit.sel) {
    if (ray.ray.intersectPlane(floor, hit)) {
      const f = edit.sel, hw = ROOM.w / 2 - .4, hd = ROOM.d / 2 - .4;
      f.l.x = Math.max(-hw, Math.min(hw, Math.round((hit.x - current.ox) * 4) / 4));
      f.l.z = Math.max(-hd, Math.min(hd, Math.round((hit.z - current.oz) * 4) / 4));
      f.g.position.set(current.ox + f.l.x, 0, current.oz + f.l.z);
    }
    return true;
  }
  if (type === 'up') { if (edit.dragging) refreshDerived(); edit.dragging = false; return true; }
  return true;
}
export function editKey(code) {
  if (!edit.active) return false;
  if (code === 'KeyR' && edit.sel) { edit.sel.l.r = (edit.sel.l.r + 1) & 3; edit.sel.g.rotation.y = -edit.sel.l.r * Math.PI / 2; refreshDerived(); }
  if ((code === 'Delete' || code === 'Backspace') && edit.sel) document.querySelector('#editBar [data-ed="store"]')?.click();
  if (code === 'Escape') stopEdit(true);
  return true;
}
export const makeFurniture = t => build(t);
export const refurnish = () => { if (current && !edit.active) furnish(current.it); };

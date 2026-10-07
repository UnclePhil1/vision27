import * as THREE from 'three';
import { G, naira, dialog, formDialog } from './game.js';
import { eco, changed, setBalance, syncWallet } from './economy.js';
import { srv, online } from './server.js';
import { PIECES, PIECE, CATS, ROOMS, FH, dims, checkSite, matsOf } from './catalog.js';
import { siteOf, worldCell } from './sites.js';
import { meshParts, placeGroup, floorY, partsOf } from './structures.js';
import { askText } from './hub.js';
import { style } from './life.js';

/* Building Explorer: the one way to build. Buy a piece, drag it onto a free cell of the site grid,
   rotate, undo, save a draft, then commit. The same screen builds houses, rooms, shops, offices,
   workshops, roads, bridges and government buildings; only the catalog and the permission change. */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BRUSH_LINE = ['wall', 'fence', 'paint', 'opening'], draftMat = new THREE.MeshBasicMaterial({ color: 0x2e7fd0, transparent: true, opacity: .45, depthWrite: false });
const ROOMC = { bedroom: '#c9dcec', living: '#f2dc8a', kitchen: '#f6c9a8', bathroom: '#bfe0d8', dining: '#e8d0e8', shop: '#f2a33a', office: '#a9c6dd', workshop: '#c8c2b4', store: '#d9d4c7' };
const X = { open: false, site: null, role: null, adds: [], rems: new Set(), undo: [], redo: [], tab: null, held: null, rot: 0, fl: 0, sel: null, prices: {}, have: {}, seq: 1,
  cam: { x: 0, z: 0, h: 30 }, g: null, grid: null, hover: null, draftG: null, brush: null, drag: null, msg: '', drafts: [], name: '' };
let ray, plane;

/* ---------------- state ---------------- */
const committed = () => partsOf(X.site.key);
const finalParts = (adds = X.adds, rems = X.rems) => committed().filter(p => !rems.has(p.id)).concat(adds);
const used = pid => X.adds.filter(a => a.piece === pid).length;
const free = pid => (PIECE[pid].price ? (X.have[pid] || 0) - used(pid) : 1e9);
const price = pid => X.prices[pid] ?? PIECE[pid].price;
function problemsFor(parts, pt) { return checkSite(parts, X.site).filter(b => b.pt === pt); }
function commitOps() { return [...[...X.rems].map(id => ({ act: 'remove', id })), ...X.adds.map(({ piece, fl, x, z, rot }) => ({ act: 'place', piece, fl, x, z, rot }))]; }
function undo() { const st = X.undo.pop(); if (!st) return say('Nothing to undo.'); X.redo.push(st); apply(st, -1); say('Undone.'); }
function redo() { const st = X.redo.pop(); if (!st) return say('Nothing to redo.'); X.undo.push(st); apply(st, 1); say('Redone.'); }
function push(step) { X.undo.push(step); X.redo = []; apply(step, 1); }
function apply(step, dir) {
  const drop = step.drop || [];
  if (dir > 0) { X.adds = X.adds.filter(a => !drop.includes(a)).concat(step.add); step.rem.forEach(id => X.rems.add(id)); }
  else { X.adds = X.adds.filter(a => !step.add.includes(a)).concat(drop); step.rem.forEach(id => X.rems.delete(id)); }
  X.sel = null; saveLocal(); redraw();
}
const draftKey = () => X.site.key;
function saveLocal() { if (X.role !== 'owner') return; (eco.land ||= {}).drafts ||= {}; eco.land.drafts[draftKey()] = { adds: X.adds.map(({ piece, fl, x, z, rot }) => ({ piece, fl, x, z, rot })), rems: [...X.rems] }; changed(); }

/* try to drop one piece at a cell; returns '' or why not */
function tryPlace(pid, cx, cz, quiet) {
  const pc = PIECE[pid], pt = { id: 'd' + X.seq++, piece: pid, fl: pc.whole ? 0 : X.fl, x: cx, z: cz, rot: X.rot, built: false };
  if (pc.whole) { pt.x = 0; pt.z = 0; }
  const bad = problemsFor(finalParts([...X.adds, pt]), pt);
  if (bad.length) { if (!quiet) say(bad[0].msg); return bad[0].msg; }
  return pt;
}
async function needBuy(pid, extra) {
  if (X.role !== 'owner' || !PIECE[pid].price) return true;
  const short = extra - free(pid); return short <= 0 || buy(pid, short);
}
async function buy(pid, short) {
  const ok = await dialog(`Buy ${short} × ${PIECE[pid].name}?`, `${naira(price(pid) * short)} ${X.site.kind === 'gov' ? 'from the office budget' : 'from your wallet'}. Pieces go into your build inventory, then onto the site when you commit.`, [{ label: 'Buy', value: true }, { label: 'Cancel', value: false }]);
  if (!ok) return false;
  try { await syncWallet(); const r = await srv.pieceBuy(pid, short, X.site.key); if (online() && !r.public) setBalance(r.balance); X.have[pid] = r.qty; G.Sound?.buy?.(false); return true; }
  catch (e) { say(e.message); return false; }
}
async function dropAt(pid, cx, cz) {
  const pt = tryPlace(pid, cx, cz); if (typeof pt === 'string') return false;     // bounce first: nothing is bought for a bad drop
  if (!(await needBuy(pid, 1))) return false;
  push({ add: [pt], rem: [] }); say(`${PIECE[pid].name} placed. ${X.role === 'owner' ? 'Commit to build it.' : 'Submit your draft for the owner to approve.'}`); return true;
}
async function brushApply(pid, cells) {
  let add = [], skip = 0, why = '';
  for (const [x, z] of cells) {
    const pt = { id: 'd' + X.seq++, piece: pid, fl: X.fl, x, z, rot: X.rot, built: false };
    const bad = problemsFor(finalParts([...X.adds, ...add, pt]), pt);
    if (bad.length) { skip++; why ||= bad[0].msg; } else add.push(pt);
  }
  if (add.length && !(await needBuy(pid, add.length)) && X.role === 'owner') { const n = Math.max(0, free(pid)); skip += add.length - n; why ||= 'buy the pieces first'; add = add.slice(0, n); }
  if (add.length) push({ add, rem: [] });
  say(`${add.length} placed${skip ? `, ${skip} skipped: ${why}` : ''}.`);
}
function removeSel() {
  const s = X.sel; if (!s) return;
  if (String(s.id).startsWith('d')) {
    const bad = checkSite(finalParts(X.adds.filter(a => a !== s)), X.site);
    if (bad.length) return say(`Take off the ${PIECE[bad[0].pt.piece].name.toLowerCase()} first (${bad[0].msg.toLowerCase()}).`);
    push({ add: [], rem: [], drop: [s] }); say('Back in your inventory.'); return;
  }
  const rems = new Set(X.rems); rems.add(s.id);
  const bad = checkSite(finalParts(X.adds, rems), X.site);
  if (bad.length) return say(`Take off the ${PIECE[bad[0].pt.piece].name.toLowerCase()} first (${bad[0].msg.toLowerCase()}).`);
  push({ add: [], rem: [s.id] }); say(`Marked for removal. You get 40% back as salvage when you commit.${X.site.kind === 'gov' ? ' Pulling down public works with nothing in their place makes people angry.' : ''}`);
}

/* ---------------- 3D: grid, hover footprint, the draft ---------------- */
function rebuildGrid() {
  if (X.grid) X.g.remove(X.grid);
  const s = X.site, c = s.cell, pts = [], y = (X.fl ? floorY(X.fl) : .45) + .02;
  for (let i = 0; i <= s.w; i++) pts.push((-s.w / 2 + i) * c, y, -s.d / 2 * c, (-s.w / 2 + i) * c, y, s.d / 2 * c);
  for (let j = 0; j <= s.d; j++) pts.push(-s.w / 2 * c, y, (-s.d / 2 + j) * c, s.w / 2 * c, y, (-s.d / 2 + j) * c);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  X.grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .55 })); X.g.add(X.grid);
  plane.constant = -(X.g.position.y + y);
}
function redraw() {
  if (X.draftG) { X.g.remove(X.draftG); X.draftG.traverse(o => o.geometry?.dispose?.()); }
  X.draftG = new THREE.Group();
  const fin = finalParts(), m = meshParts(X.site, X.adds.map(a => ({ ...a, built: true })), { plan: true, mat: draftMat });
  // room tints and removal marks
  const B = [], c = X.site.cell, L = (x, z) => [(-X.site.w / 2 + x + .5) * c, (-X.site.d / 2 + z + .5) * c];
  fin.filter(p => PIECE[p.piece].layer === 'room' && p.fl === X.fl).forEach(p => { const [x, z] = L(p.x, p.z), q = new THREE.Mesh(new THREE.PlaneGeometry(c * .9, c * .9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ROOMC[PIECE[p.piece].room], transparent: true, opacity: .75, depthWrite: false })); q.position.set(x, floorY(p.fl) + .03, z); B.push(q); });
  committed().filter(p => X.rems.has(p.id)).forEach(p => { const pc = PIECE[p.piece], [w, d] = dims(pc, p.rot), [x, z] = L(p.x + (w - 1) / 2, p.z + (d - 1) / 2), q = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1, w) * c, .5, Math.max(1, d) * c), new THREE.MeshBasicMaterial({ color: 0xc9472f, transparent: true, opacity: .45, depthWrite: false })); q.position.set(x, floorY(p.fl), z); B.push(q); });
  if (X.sel) { const pc = PIECE[X.sel.piece], [w, d] = dims(pc, X.sel.rot), [x, z] = L(X.sel.x + (w - 1) / 2, X.sel.z + (d - 1) / 2), q = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1, w) * c + .1, FH, Math.max(1, d) * c + .1), new THREE.MeshBasicMaterial({ color: 0xf2c230, wireframe: true })); q.position.set(x, floorY(X.sel.fl) + FH / 2, z); B.push(q); }
  X.draftG.add(m.root, ...B); X.g.add(X.draftG);
  paint();
}
function setHover(cells, ok) {
  if (X.hover) { X.g.remove(X.hover); X.hover = null; }
  if (!cells?.length) return;
  const c = X.site.cell, grp = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: ok ? 0x3ddc84 : 0xc9472f, transparent: true, opacity: .55, depthWrite: false });
  cells.forEach(([x, z]) => { const q = new THREE.Mesh(new THREE.PlaneGeometry(c * .92, c * .92).rotateX(-Math.PI / 2), mat); q.position.set((-X.site.w / 2 + x + .5) * c, (X.fl ? floorY(X.fl) : .45) + .05, (-X.site.d / 2 + z + .5) * c); grp.add(q); });
  X.hover = grp; X.g.add(grp);
}
function cellAt(ev) {
  const r = $('c').getBoundingClientRect();
  ray.setFromCamera({ x: ((ev.clientX - r.left) / r.width) * 2 - 1, y: -((ev.clientY - r.top) / r.height) * 2 + 1 }, G.camera);
  const hit = new THREE.Vector3(); if (!ray.ray.intersectPlane(plane, hit)) return null;
  const c = worldCell(X.site, hit.x, hit.z); return { x: Math.floor(c.x), z: Math.floor(c.z), fx: c.x, fz: c.z };
}
const footprint = (pid, cx, cz) => { const pc = PIECE[pid]; if (pc.whole) return []; const [w, d] = dims(pc, X.rot), out = []; for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([cx + i, cz + j]); return out; };
function brushCells(a, b, pid) {
  if (BRUSH_LINE.includes(PIECE[pid].layer)) { const out = []; if (Math.abs(b.x - a.x) >= Math.abs(b.z - a.z)) for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) out.push([x, a.z]); else for (let z = Math.min(a.z, b.z); z <= Math.max(a.z, b.z); z++) out.push([a.x, z]); return out; }
  const out = []; for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) for (let z = Math.min(a.z, b.z); z <= Math.max(a.z, b.z); z++) out.push([x, z]); return out;
}
const brushable = pid => { const pc = PIECE[pid]; return !pc.whole && pc.w === 1 && pc.d === 1; };
function pick(cell) {
  const all = finalParts().filter(p => !X.rems.has(p.id) && (PIECE[p.piece].whole ? false : p.fl === X.fl));
  const order = ['decor', 'sign', 'opening', 'paint', 'light', 'item', 'fixture', 'room', 'stairs', 'wall', 'roof', 'tile', 'ceiling', 'balcony', 'fence', 'prefab', 'road', 'deck', 'pier', 'slab', 'foundation'];
  return all.filter(p => { const [w, d] = dims(PIECE[p.piece], p.rot); return cell.x >= p.x && cell.x < p.x + Math.max(1, w) && cell.z >= p.z && cell.z < p.z + Math.max(1, d); })
    .sort((a, b) => order.indexOf(PIECE[a.piece].layer) - order.indexOf(PIECE[b.piece].layer))[0] || null;
}

/* ---------------- pointer: drag from the catalog, brush on the grid, select, pan ---------------- */
function onViewDown(ev) {
  const c = cellAt(ev); if (!c) return;
  if (X.held) {
    if (PIECE[X.held].whole) { dropAt(X.held, 0, 0); return; }
    if (brushable(X.held)) { X.brush = { a: c, b: c }; setHover(brushCells(c, c, X.held), true); return; }
    dropAt(X.held, c.x, c.z); return;
  }
  const p = pick(c); X.sel = p; X.pan = p ? null : { sx: ev.clientX, sy: ev.clientY, x: X.cam.x, z: X.cam.z };
  X.move = p && String(p.id).startsWith('d') ? { p, from: c } : null; redraw();
}
function onViewMove(ev) {
  if (X.pan) { const k = X.cam.h / 600; X.cam.x = X.pan.x - (ev.clientX - X.pan.sx) * k; X.cam.z = X.pan.z - (ev.clientY - X.pan.sy) * k; aim(); return; }
  const c = cellAt(ev); if (!c) return;
  if (X.brush) { X.brush.b = c; setHover(brushCells(X.brush.a, c, X.held), true); return; }
  if (X.move) { const m = X.move, nx = m.p.x + c.x - m.from.x, nz = m.p.z + c.z - m.from.z, np = { ...m.p, x: nx, z: nz }; m.to = np; setHover(footprint(np.piece, nx, nz), !problemsFor(finalParts([...X.adds.filter(a => a !== m.p), np]), np).length); return; }
  const pid = X.drag?.pid || X.held;
  if (pid) { const cells = footprint(pid, c.x, c.z), pt = tryPlace(pid, c.x, c.z, true); setHover(cells, typeof pt !== 'string'); X.hint = typeof pt === 'string' ? pt : ''; $('bxHint').textContent = X.hint || hintText(); }
}
function onViewUp(ev) {
  X.pan = null;
  if (X.move) {
    const m = X.move; X.move = null; setHover(null);
    if (m.to && (m.to.x !== m.p.x || m.to.z !== m.p.z)) {
      const np = { ...m.to, id: 'd' + X.seq++ }, bad = problemsFor(finalParts([...X.adds.filter(a => a !== m.p), np]), np);
      if (bad.length) say(`Can't move it there: ${bad[0].msg.toLowerCase()}`); else { push({ add: [np], rem: [], drop: [m.p] }); X.sel = np; redraw(); say('Moved. Undo puts it back.'); }
    }
    return;
  }
  if (X.brush) { const cells = brushCells(X.brush.a, X.brush.b, X.held); X.brush = null; setHover(null); brushApply(X.held, cells); }
}
function startCardDrag(ev, pid, card) {
  ev.preventDefault(); document.querySelectorAll('.bx-ghost').forEach(g => g.remove());
  const r = card.getBoundingClientRect(), ghost = card.cloneNode(true);
  ghost.className = 'bx-ghost'; Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px' }); document.body.appendChild(ghost);
  X.drag = { pid, ghost, r, moved: false };
  const flyBack = () => { ghost.style.transition = 'left .35s, top .35s, opacity .35s'; ghost.style.left = r.left + 'px'; ghost.style.top = r.top + 'px'; ghost.style.opacity = '0'; setTimeout(() => ghost.remove(), 380); };
  const move = e => { if (Math.hypot(e.clientX - ev.clientX, e.clientY - ev.clientY) > 6) X.drag.moved = true; ghost.style.left = e.clientX - r.width / 2 + 'px'; ghost.style.top = e.clientY - 20 + 'px'; if (document.elementFromPoint(e.clientX, e.clientY)?.id === 'bxView') onViewMove(e); else setHover(null); };
  const end = async e => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
    const d = X.drag; X.drag = null; setHover(null);
    if (!d?.moved || e.type === 'pointercancel') { ghost.remove(); if (d && !d.moved) select(pid); return; }
    const c = document.elementFromPoint(e.clientX, e.clientY)?.id === 'bxView' && cellAt(e);
    if (!c) return flyBack();
    const ok = (tryPlace(pid, c.x, c.z, true)?.piece);
    if (!ok) { say(tryPlace(pid, c.x, c.z, true)); return flyBack(); }
    ghost.remove();
    if (await dropAt(pid, c.x, c.z)) select(pid); else card.classList.add('bounce'), setTimeout(() => card.classList.remove('bounce'), 400);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', end); addEventListener('pointercancel', end);
}
function select(pid) { if (X.drag?.moved) return; X.held = X.held === pid ? null : pid; X.sel = null; paint(); }

/* ---------------- camera ---------------- */
function aim() {
  const s = X.site, y = X.g.position.y + floorY(X.fl);
  G.cine = { pos: new THREE.Vector3(s.x + X.cam.x, y + X.cam.h, s.z + X.cam.z + X.cam.h * .45), look: new THREE.Vector3(s.x + X.cam.x, y, s.z + X.cam.z) };
}

/* ---------------- panels ---------------- */
const hintText = () => (X.held ? (brushable(X.held) ? `Drag across the grid to lay ${PIECE[X.held].name.toLowerCase()}. R rotates. Esc puts it down.` : `Click a free cell to drop it. R rotates. Esc puts it down.`) : 'Drag a piece from the left onto the grid. Click a placed piece to select it. Drag empty ground to move the view.');
function say(m) { X.msg = m; const el = $('bxMsg'); if (el) { el.textContent = m; el.hidden = !m; } }
function paint() {
  if (!X.open) return;
  const s = X.site, cats = s.cats, tab = cats.includes(X.tab) ? X.tab : cats[0]; X.tab = tab;
  const pieces = PIECES.filter(p => p.cat === tab);
  $('bxCat').innerHTML = `<div class="bx-tabs">${cats.map(c => `<button class="${c === tab ? 'on' : ''}" data-tab="${c}">${CATS[c]}</button>`).join('')}</div>`
    + pieces.map(p => { const have = X.have[p.id] || 0, u = used(p.id); return `<div class="bx-card${X.held === p.id ? ' held' : ''}" data-pid="${p.id}"><i style="background:${p.room ? ROOMC[p.room] : '#' + (p.col ?? 0x999999).toString(16).padStart(6, '0')}"></i><span><b>${esc(p.name)}</b><small>${p.price ? naira(price(p.id)) : 'Free label'}${p.whole ? ' · whole site' : ` · ${p.w}×${p.d}`}${p.price ? ` · own ${have}${u ? ` (${u} in draft)` : ''}` : ''}</small></span></div>`; }).join('');
  const sel = X.sel, pid = sel?.piece || X.held, pc = pid && PIECE[pid];
  const ops = commitOps(), fin = finalParts(), bad = checkSite(fin, s), mats = matsOf(X.adds), buyNeed = [...new Set(X.adds.map(a => a.piece))].map(id => [id, Math.max(0, used(id) - (X.have[id] || 0))]).filter(([id, n]) => n && PIECE[id].price);
  $('bxIns').innerHTML = (pc ? `<div class="bx-sec">${sel ? (String(sel.id).startsWith('d') ? 'In your draft' : sel.built ? 'Built' : 'Committed, waiting for the crew') : 'Selected piece'}</div>
      <h3>${esc(pc.name)}</h3><small>${pc.price ? naira(price(pid)) : 'Free'} · ${pc.whole ? 'whole site' : `${dims(pc, sel?.rot ?? X.rot).join(' × ')} cells`} · turned ${((sel?.rot ?? X.rot) * 90)}°<br>
      ${pc.trade ? `Built by a ${pc.trade === 'labour' ? 'labourer' : pc.trade}` : 'Set in place at once'}${Object.keys(pc.mats).length ? ` · uses ${Object.entries(pc.mats).map(([k, v]) => `${v} ${k}`).join(', ')} from city stock` : ''}${pc.rooms ? `<br>Goes in: ${pc.rooms.map(r => ROOMS[r]).join(', ')}` : ''}<br>You own ${X.have[pid] || 0}${used(pid) ? `, ${used(pid)} in the draft` : ''}</small>
      <div class="bx-row">${!sel && X.role === 'owner' && pc.price ? `<button class="chip" data-buy="1">Buy 1</button><button class="chip" data-buy="10">Buy 10</button>` : ''}${!sel && !pc.whole ? '<button class="chip" data-act="rot">Rotate (R)</button>' : ''}${sel ? `<button class="chip danger" data-act="del">${String(sel.id).startsWith('d') ? 'Remove from draft' : 'Demolish (salvage 40%)'}</button>` : ''}</div>` : '<div class="bx-sec">Nothing selected</div><small>Pick a piece on the left, or click a piece on the site.</small>')
    + `<div class="bx-sec">Your draft</div><small>${ops.length ? `${X.adds.length} to place, ${X.rems.size} to remove.` : 'No changes yet.'}${Object.keys(mats).length ? `<br>City stock needed: ${Object.entries(mats).map(([k, v]) => `${v} ${k}`).join(', ')}` : ''}${buyNeed.length ? `<br>${X.role === 'owner' ? 'Still to buy' : 'The owner buys'}: ${buyNeed.map(([id, n]) => `${n} ${PIECE[id].name.toLowerCase()}`).join(', ')}` : ''}</small>
      ${bad.length ? `<p class="bx-bad">${esc(PIECE[bad[0].pt.piece].name)}: ${esc(bad[0].msg)}</p>` : ''}`
    + (X.role === 'owner' && X.drafts.length ? `<div class="bx-sec">Drafts from your crew</div>${X.drafts.map((d, i) => `<div class="bx-dr"><b>${esc(d.username)}</b><small>${d.ops.length} changes · ${esc(d.status)}${d.note ? ` · “${esc(d.note)}”` : ''}</small><div class="bx-row"><button class="chip" data-dr="view" data-i="${i}">Show</button><button class="chip" data-dr="ok" data-i="${i}">Approve</button><button class="chip" data-dr="no" data-i="${i}">Send back</button></div></div>`).join('')}` : '')
    + (s.kind === 'gov' && X.role === 'owner' ? '<div class="bx-sec">Public works</div><small>Pieces are bought from the office budget. Award the work to a crew: they build it on shift. A padded crew list or a demolition with no replacement makes people angry.</small><div class="bx-row"><button class="chip" data-act="crew">Award to a crew</button></div>' : '');
  const blocked = bad.length || !ops.length;
  $('bxTop').innerHTML = `<b class="bx-t">Building Explorer</b><button class="bx-name" data-act="name" title="${X.role === 'owner' ? 'Rename' : ''}">${esc(X.name)}${X.role === 'owner' ? ' ✎' : ''}</button>
    <span class="bx-fl">${Array.from({ length: s.floors }, (_, i) => `<button class="${X.fl === i ? 'on' : ''}" data-fl="${i}">${i ? 'Floor ' + i : 'Ground'}</button>`).join('')}</span>
    <span class="bx-sp"></span><button class="chip" data-act="undo" ${X.undo.length ? '' : 'disabled'}>Undo</button><button class="chip" data-act="redo" ${X.redo.length ? '' : 'disabled'}>Redo</button>
    ${X.role === 'owner' ? `<button class="chip" data-act="save">Save draft</button><button class="cta" data-act="commit" ${blocked ? 'disabled' : ''}>Commit${ops.length ? ` (${ops.length})` : ''}</button>` : `<button class="chip" data-act="dsave">Save draft</button><button class="cta" data-act="submit" ${blocked ? 'disabled' : ''}>Send to the owner</button>`}
    <button class="chip" data-act="close">Close</button>`;
  $('bxHint').textContent = X.hint || hintText();
}
async function onClick(e) {
  const b = e.target.closest('[data-tab],[data-fl],[data-act],[data-buy],[data-dr]'); if (!b) return;
  if (b.dataset.tab) { X.tab = b.dataset.tab; X.held = null; paint(); return; }
  if (b.dataset.fl) { X.fl = +b.dataset.fl; rebuildGrid(); aim(); redraw(); return; }
  if (b.dataset.buy) { await buy(X.held, +b.dataset.buy); paint(); return; }
  if (b.dataset.dr) return draftAction(b.dataset.dr, X.drafts[+b.dataset.i]);
  const a = b.dataset.act;
  if (a === 'rot') { X.rot = (X.rot + 1) % 4; paint(); }
  else if (a === 'del') removeSel();
  else if (a === 'undo') undo();
  else if (a === 'redo') redo();
  else if (a === 'save') { saveLocal(); say('Draft saved. Only you can see it.'); }
  else if (a === 'dsave' || a === 'submit') { try { const note = a === 'submit' ? (await askText('A note for the owner (optional)', 'e.g. Two bedrooms and a kitchen')) || '' : ''; await srv.draftSave(X.site.key, commitOps(), note, a === 'submit'); say(a === 'submit' ? 'Sent. The owner approves it, and only then is it built.' : 'Draft saved. The owner can see it.'); } catch (x) { say(x.message); } }
  else if (a === 'commit') commit();
  else if (a === 'close') closeExplorer();
  else if (a === 'name' && X.role === 'owner') { const nm = await askText('Name this place', X.site.kind === 'gov' ? X.site.name : 'e.g. Ada Lodge'); if (nm === null || nm === undefined) return; try { await srv.siteRename(X.site.key, nm); X.name = nm.trim() || X.site.name; G.refreshLand?.(); paint(); } catch (x) { say(x.message); } }
  else if (a === 'crew') awardCrew();
}
async function commit() {
  const ops = commitOps(), mats = matsOf(X.adds), work = X.adds.filter(p => PIECE[p.piece].trade).length;
  const ok = await dialog('Commit to the server?', `${X.adds.length} pieces leave your inventory and go on the site${X.rems.size ? `, ${X.rems.size} come down for salvage` : ''}.${Object.keys(mats).length ? ` City stock used: ${Object.entries(mats).map(([k, v]) => `${v} ${k}`).join(', ')}.` : ''}${work ? ` ${work} pieces then need a builder: work them yourself or hire a crew.` : ''}`, [{ label: 'Commit', value: true }, { label: 'Not yet', value: false }]);
  if (!ok) return;
  try { const r = await srv.siteCommit(X.site.key, ops); if (online() && r.balance != null && X.site.kind !== 'gov') setBalance(r.balance); X.adds = []; X.rems.clear(); X.undo = []; X.redo = []; saveLocal(); await G.refreshLand?.(); await loadPrices(); redraw(); say(`Committed. ${r.salvage ? `${naira(r.salvage)} salvage back. ` : ''}Everyone can see it now.`); G.Sound?.ding?.(); }
  catch (e) { say(e.message); }
}
async function draftAction(kind, d) {
  if (!d) return;
  if (kind === 'view') { X.adds = d.ops.filter(o => o.act === 'place').map(o => ({ ...o, id: 'd' + X.seq++, built: false })); X.rems = new Set(d.ops.filter(o => o.act === 'remove').map(o => o.id)); X.undo = []; redraw(); say(`Showing ${d.username}'s draft. Approve it from the panel.`); return; }
  try { const r = await srv.approve(X.site.key, d.author, kind === 'ok'); await G.refreshLand?.(); X.adds = []; X.rems.clear(); await loadDrafts(); await loadPrices(); redraw(); say(kind === 'ok' ? `Approved and committed (${r.placed} pieces).` : 'Sent back.'); }
  catch (e) { say(e.message); }
}
async function awardCrew() {
  const v = await formDialog('Award the works to a crew', 'The crew job goes on the Work board for 2 days. They build the committed pieces on shift. Each worker costs ₦32,000 from the budget.', [
    { id: 'crew', label: 'Real workers', type: 'number', value: 2, min: 1, max: 6 }, { id: 'ghosts', label: 'Extra names (ghost workers)', type: 'number', value: 0, min: 0, max: 6 }], 'Award',
  x => `${naira(32000 * (+x.crew + +x.ghosts))} from the budget.${+x.ghosts ? ` ${naira(32000 * x.ghosts)} goes to you. That is padding.` : ''}`);
  if (!v) return;
  try { await srv.contractBuild(X.site.key, +v.crew, +v.ghosts); style(+v.ghosts ? 2 - Math.min(20, 6 * v.ghosts) : 2); say('Awarded. The crew job is on the Work board.'); } catch (e) { say(e.message); }
}
async function loadPrices() { try { const rows = (await srv.piecePrices(X.site.key)) || []; rows.forEach(r => { X.prices[r.id] = r.price; X.have[r.id] = r.have; }); } catch { } }
async function loadDrafts() { X.drafts = []; if (online()) try { X.drafts = (await srv.draftsFor(X.site.key)) || []; } catch { } }

/* ---------------- open / close ---------------- */
export async function openExplorer(key) {
  const site = siteOf(key); if (!site) return;
  let role = null; try { role = await srv.siteRole(key); } catch (e) { return G.toast(e.message); }
  if (!role) return G.toast(site.kind === 'gov' ? 'Only the seat that holds this land opens its Building Explorer. Citizens work the hired shifts.' : 'Only the owner, or a builder they hired, can open this site.');
  Object.assign(X, { open: true, site, role, adds: [], rems: new Set(), undo: [], redo: [], held: null, rot: 0, fl: 0, sel: null, msg: '', hint: '', name: G.siteName?.(key) || site.name, cam: { x: 0, z: 0, h: Math.max(site.w, site.d) * site.cell * 1.1 } });
  if (online() && role === 'invited') { try { const mine = ((await srv.draftsFor(key)) || []).find(d => d.mine); if (mine) { X.adds = mine.ops.filter(o => o.act === 'place').map(o => ({ ...o, id: 'd' + X.seq++, built: false })); X.rems = new Set(mine.ops.filter(o => o.act === 'remove').map(o => o.id)); } } catch { } }
  const saved = role === 'owner' && eco.land?.drafts?.[key];
  if (saved) { X.adds = saved.adds.map(a => ({ ...a, id: 'd' + X.seq++, built: false })); X.rems = new Set(saved.rems.filter(id => committed().some(p => p.id === id))); }
  G.closePhone?.(); G.frozen = true; document.body.classList.add('bx-on');
  X.g = placeGroup(site, new THREE.Group()); G.scene.add(X.g);
  $('bx').hidden = false; rebuildGrid(); aim();
  await Promise.all([loadPrices(), loadDrafts()]);
  redraw(); say(role === 'owner' ? '' : 'You are drafting inside the owner\'s budget. Send it to them; nothing is built until they approve.');
}
export function closeExplorer() {
  if (!X.open) return; X.open = false; saveLocal();
  G.scene.remove(X.g); X.g = X.grid = X.hover = X.draftG = null; G.cine = null; G.frozen = false;
  $('bx').hidden = true; document.body.classList.remove('bx-on');
}
export const explorerOpen = () => X.open;

export function initExplorer() {
  ray = new THREE.Raycaster(); plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const css = document.createElement('style');
  css.textContent = `#dlg{position:fixed;z-index:50}#toast{position:fixed;z-index:49}
  .bx-card.bounce{animation:bxshake .35s}@keyframes bxshake{25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
  #bx{position:fixed;inset:0;z-index:30;pointer-events:none;font-size:13px;color:#16213a}
  #bx>*{pointer-events:auto}#bxView{position:absolute;inset:56px 270px 34px 250px;cursor:crosshair;touch-action:none}
  #bxTop{position:absolute;left:0;right:0;top:0;height:56px;display:flex;align-items:center;gap:8px;padding:0 12px;background:#fffdf8;border-bottom:1px solid #e3dccb;overflow-x:auto}
  #bxTop .chip,#bxTop .cta{margin:0;white-space:nowrap}.bx-t{font:700 18px "Fredoka",system-ui,sans-serif;white-space:nowrap}.bx-sp{flex:1}
  .bx-name{border:1px solid #e3dccb;background:#fff;border-radius:10px;padding:6px 10px;font:inherit;cursor:pointer;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis}
  .bx-fl{display:flex;gap:4px}.bx-fl button,.bx-tabs button{border:1px solid #e3dccb;background:#fff;border-radius:999px;padding:5px 10px;font:inherit;cursor:pointer;white-space:nowrap}.bx-fl button.on,.bx-tabs button.on{background:#1d8a4a;color:#fff;border-color:#1d8a4a}
  #bxCat{position:absolute;left:0;top:56px;bottom:0;width:250px;background:#fffdf8;border-right:1px solid #e3dccb;overflow-y:auto;padding:8px}
  .bx-tabs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}.bx-tabs button{font-size:12px;padding:4px 8px}
  .bx-card,.bx-ghost{display:flex;gap:8px;align-items:center;padding:7px 8px;border:1px solid #e3dccb;border-radius:10px;background:#fff;margin-bottom:6px;cursor:grab;user-select:none;touch-action:none}
  .bx-card.held{border-color:#1d8a4a;box-shadow:0 0 0 2px #1d8a4a inset}.bx-card i,.bx-ghost i{width:22px;height:22px;border-radius:6px;flex:none;border:1px solid rgba(0,0,0,.15)}
  .bx-card b,.bx-ghost b{display:block;font-weight:600}.bx-card small,.bx-ghost small{color:#666}
  .bx-ghost{position:fixed;z-index:60;pointer-events:none;opacity:.92;box-shadow:0 8px 20px rgba(0,0,0,.25)}
  #bxIns{position:absolute;right:0;top:56px;bottom:0;width:270px;background:#fffdf8;border-left:1px solid #e3dccb;overflow-y:auto;padding:10px 12px}
  #bxIns h3{margin:2px 0 4px;font:600 17px "Fredoka",system-ui,sans-serif}#bxIns small{color:#555;line-height:1.5;display:block}
  .bx-sec{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#1d6e45;font-weight:700;margin:12px 0 4px}.bx-row{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.bx-row .chip{margin:0}
  .chip.danger{color:#c9472f;border-color:#c9472f}.bx-bad{color:#c9472f;margin:6px 0 0;font-size:12px}.bx-dr{border-top:1px solid #eee;padding-top:6px;margin-top:6px}
  #bxHint{position:absolute;left:250px;right:270px;bottom:0;height:34px;display:flex;align-items:center;justify-content:center;background:rgba(22,33,58,.85);color:#fff;font-size:12px;padding:0 10px;text-align:center}
  #bxMsg{position:absolute;left:50%;transform:translateX(-50%);top:66px;background:#16213a;color:#fff;border-radius:12px;padding:8px 14px;max-width:min(520px,60vw);text-align:center;box-shadow:0 4px 0 #0b1222}
  body.bx-on .side,body.bx-on .hud,body.bx-on #bCar,body.bx-on #hint,body.bx-on #chat,body.bx-on #online,body.bx-on #joy,body.bx-on #bRun,body.bx-on #bJump,body.bx-on #gps{display:none!important}
  @media (max-width:800px){#bxTop{height:92px;flex-wrap:wrap;align-content:center;gap:5px;padding:4px 8px}#bxTop .chip,#bxTop .cta{padding:5px 9px;font-size:12px}.bx-sp{display:none}#bxCat{top:92px;width:140px;padding:6px}#bxIns{top:auto;height:36%;width:auto;left:140px;border-left:0;border-top:1px solid #e3dccb}#bxView{inset:92px 0 36% 140px}#bxHint{left:140px;right:0;bottom:36%;height:auto;min-height:30px;font-size:11px;padding:4px 8px}#bxMsg{top:100px;max-width:80vw}.bx-card small{display:none}.bx-t{display:none}}`;
  document.head.appendChild(css);
  ['dlg', 'toast'].forEach(id => document.body.appendChild($(id)));   // out of the game layer, so they show above the explorer
  const root = document.createElement('div'); root.id = 'bx'; root.hidden = true;
  root.innerHTML = '<div id="bxView"></div><div id="bxTop"></div><div id="bxCat"></div><div id="bxIns"></div><div id="bxHint"></div><div id="bxMsg" hidden></div>';
  document.body.appendChild(root);
  const v = $('bxView');
  v.addEventListener('pointerdown', e => { v.setPointerCapture(e.pointerId); onViewDown(e); });
  v.addEventListener('pointermove', onViewMove); v.addEventListener('pointerup', onViewUp); v.addEventListener('pointercancel', onViewUp);
  v.addEventListener('wheel', e => { X.cam.h = Math.max(8, Math.min(140, X.cam.h * (e.deltaY > 0 ? 1.12 : .89))); aim(); e.preventDefault(); }, { passive: false });
  root.addEventListener('click', onClick);
  $('bxCat').addEventListener('pointerdown', e => { const c = e.target.closest('.bx-card'); if (c) startCardDrag(e, c.dataset.pid, c); });
  addEventListener('keydown', e => {
    if (!X.open || e.target.tagName === 'INPUT' || !$('dlg').hidden) return;
    if (e.code === 'KeyR') { X.rot = (X.rot + 1) % 4; paint(); }
    else if (e.code === 'Escape') { if (X.held) { X.held = null; setHover(null); paint(); } else closeExplorer(); }
    else if (e.code === 'Delete' || e.code === 'Backspace') removeSel();
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') e.shiftKey ? redo() : undo();
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') redo();
    else { const k = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.code]; if (k) { X.cam.x += k[0] * X.cam.h * .06; X.cam.z += k[1] * X.cam.h * .06; aim(); } }
    e.stopPropagation(); if (!e.ctrlKey && !e.metaKey) e.preventDefault();
  }, true);
  G.openExplorer = openExplorer; G.explorerOpen = explorerOpen;
}

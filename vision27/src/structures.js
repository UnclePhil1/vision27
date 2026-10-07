import * as THREE from 'three';
import { G } from './game.js';
import { Batch, canvasTex } from './util.js';
import { PIECE, FH, dims, indexParts } from './catalog.js';
import { allSites, siteOf, worldCell } from './sites.js';

/* What everyone sees: committed pieces drawn on every site. Pieces still waiting for the crew
   show as an orange plan. The Building Explorer reuses meshParts() for its draft. */
const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(1, 1, 1, 10), CONE4 = new THREE.ConeGeometry(1, 1, 4);
const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
export const planMat = new THREE.MeshBasicMaterial({ color: 0xf2a33a, transparent: true, opacity: .38, depthWrite: false });
export const floorY = fl => .4 + fl * FH;
const S = { sites: new Map(), parts: new Map(), names: new Map() };   // site key -> { g, floors[], roof, boxes }

/* local metres for a cell box */
function meshParts(site, parts, opts = {}) {
  const c = site.cell, root = new THREE.Group(), I = indexParts(parts), floors = [], roofG = new THREE.Group(), boxes = [];
  const L = (cx, cz) => [(-site.w / 2 + cx) * c, (-site.d / 2 + cz) * c];
  const batches = new Map(); const bat = (fl, plan) => { const k = (plan ? 'p' : 's') + fl; if (!batches.has(k)) batches.set(k, new Batch()); return batches.get(k); };
  const style = parts.find(p => PIECE[p.piece]?.layer === 'style');
  const roofs = [];
  for (const pt of parts) {
    const pc = PIECE[pt.piece]; if (!pc) continue;
    const plan = opts.plan || !pt.built, fl = pt.fl || 0, B = bat(pc.layer === 'roof' ? 99 : fl, plan), y0 = floorY(fl);
    const [w, d] = dims(pc, pt.rot || 0), [lx, lz] = L(pt.x + w / 2, pt.z + d / 2), sx = w * c, sz = d * c;
    const box = (bw, bh, bd, col, x, y, z, ry = 0) => B.add(BOX, col, x, y, z, ry, bw, bh, bd);
    const solid = (x, z, bw, bd, h) => { if (fl === 0 && !plan) boxes.push({ x, z, bw, bd, h }); };
    switch (pc.layer) {
      case 'pad': if (!plan || opts.plan) box(site.w * c, .06, site.d * c, pc.col, 0, .03, 0); break;
      case 'foundation': box(sx, .3, sz, pc.col, lx, .2, lz); break;
      case 'slab': { const tile = I.get('tile', fl, pt.x, pt.z); box(sx, .2, sz, tile && !opts.plan ? PIECE[tile.piece].col : pc.col, lx, y0 - .1, lz); break; }
      case 'wall': {
        const paint = I.get('paint', fl, pt.x, pt.z), col = paint ? PIECE[paint.piece].col : pc.thin ? 0xd9d4c7 : 0xb9b4a8, th = pc.thin ? .14 : .24, h = FH - .2;
        const op = I.get('opening', fl, pt.x, pt.z), opc = op && PIECE[op.piece];
        const seg = (x, z, bw, bd) => { // a wall piece, cut for a door or window
          if (!opc) { box(bw, h, bd, col, x, y0 + h / 2, z); solid(x, z, bw, bd, h); return; }
          box(bw, h - 2.2, bd, col, x, y0 + 2.2 + (h - 2.2) / 2, z);
          if (op.piece === 'window') { box(bw, .9, bd, col, x, y0 + .45, z); box(bw * .96, 1.3, bd * .4, opc.col, x, y0 + 1.55, z); solid(x, z, bw, bd, h); }
        };
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => I.has('wall', fl, pt.x + a, pt.z + b));
        if (!nb.length) seg(lx, lz, c, th);
        else { seg(lx, lz, th, th); nb.forEach(([a, b]) => seg(lx + a * c / 4, lz + b * c / 4, a ? c / 2 : th, b ? c / 2 : th)); }
        if (op?.piece === 'door') box(.06, 2.1, c * .8, opc.col, lx + c * .35, y0 + 1.05, lz + c * .1);
        const sg = I.get('sign', fl, pt.x, pt.z); if (sg) box(c, .5, .08, 0x16213a, lx, y0 + h + .25, lz);
        if (I.get('decor', fl, pt.x, pt.z)) box(.5, .4, .3, 0x6b4a33, lx, y0 + 1.6, lz);
        break;
      }
      case 'stairs': for (let k = 0; k < 6; k++) box(sx * .9, (k + 1) * FH / 6, sz / 6, pc.col, lx, y0 + (k + 1) * FH / 12, lz - sz / 2 + (k + .5) * sz / 6); if (pt.piece === 'lift') box(sx * .9, FH - .2, sz * .9, pc.col, lx, y0 + FH / 2, lz); break;
      case 'balcony': box(sx, .15, sz, pc.col, lx, y0 - .08, lz); box(sx, .9, .05, 0x6d7075, lx, y0 + .45, lz + sz / 2); break;
      case 'roof': roofs.push({ pt, pc, lx, lz, sx, sz, y: floorY(fl + 1) }); break;
      case 'item': { const h = pc.h || 1; if (pt.piece === 'lamp') { box(.12, 3, .12, pc.col, lx, 1.5, lz); box(.4, .3, .4, 0xfff4c8, lx, 3.1, lz); break; }
        box(sx - .15, h, sz - .15, pc.col, lx, y0 + h / 2, lz); if (pt.piece === 'bed') box(sx * .8, .15, .4, 0xf4f4f4, lx, y0 + h + .08, lz - sz / 2 + .3); if (pt.piece === 'sofa') box(sx - .15, .5, .2, pc.col, lx, y0 + h + .25, lz - sz / 2 + .15); break; }
      case 'light': box(.4, .06, .4, pc.col, lx, y0 + FH - .3, lz); break;
      case 'fence': { const h = pt.piece === 'gate' ? 1.8 : 1.2; box(sx, h, .15, pc.col, lx, h / 2, lz); solid(lx, lz, sx, .2, h); break; }
      case 'prefab': {
        const h = pc.h; if (pc.open) { [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => box(.3, h, .3, 0x6d7075, lx + a * (sx / 2 - .4), h / 2, lz + b * (sz / 2 - .4))); }
        else { box(sx - .4, h, sz - .4, pc.col, lx, h / 2, lz); solid(lx, lz, sx - .4, sz - .4, h); for (let k = -2; k <= 2; k++) box(sx / 8, 1.2, .08, 0x34505f, lx + k * sx / 6, h * .6, lz + sz / 2 - .18); }
        box(sx, .4, sz, pc.roofc, lx, h + .2, lz); break;
      }
      case 'road': box(sx, .06, sz, pc.col, lx, pc.ramp ? .6 : .05, lz); if (pt.piece === 'lane') box(.15, .07, sz * .5, 0xffffff, lx, .06, lz); if (pt.piece === 'junction') box(sx * .6, .07, .15, 0xffffff, lx, .06, lz); break;
      case 'fixture': if (pt.piece === 'streetlight') { box(.15, 6, .15, pc.col, lx, 3, lz); box(1.2, .12, .2, pc.col, lx + .5, 6, lz); box(.5, .15, .3, 0xfff4c8, lx + 1, 5.9, lz); } else box(sx, .9, .1, pc.col, lx, 3 + .45, lz + sz / 2 - .1); break;
      case 'pier': box(sx * .5, 3, sz * .5, pc.col, lx, 1.5, lz); break;
      case 'deck': box(sx, .3, sz, pc.col, lx, 2.85, lz); break;
    }
  }
  // roofs: flat per cell, or one gable/hip over the roofed area of each floor
  const byFl = new Map(); roofs.forEach(r => { if (!byFl.has(r.y)) byFl.set(r.y, []); byFl.get(r.y).push(r); });
  for (const [y, rs] of byFl) {
    const plan = opts.plan || rs.some(r => !r.pt.built), B = bat(99, plan), col = rs[0].pc.col;
    if (!style || rs[0].pt.piece === 'roof_slab') { rs.forEach(r => B.add(BOX, r.pc.col, r.lx, y - .05, r.lz, 0, r.sx + .05, .12, r.sz + .05)); continue; }
    const x0 = Math.min(...rs.map(r => r.lx - r.sx / 2)), x1 = Math.max(...rs.map(r => r.lx + r.sx / 2)), z0 = Math.min(...rs.map(r => r.lz - r.sz / 2)), z1 = Math.max(...rs.map(r => r.lz + r.sz / 2));
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, W = x1 - x0 + .6, D = z1 - z0 + .6;
    if (style.piece === 'hip') B.add(CONE4, col, cx, y + 1.2, cz, Math.PI / 4, W * .72, 2.4, D * .72);
    else { const long = W >= D, span = long ? D : W, rise = span * .3, slope = Math.hypot(span / 2, rise), ang = Math.atan2(rise, span / 2);
      [-1, 1].forEach(s => B.add(BOX, col, cx + (long ? 0 : s * span / 4), y + rise / 2, cz + (long ? s * span / 4 : 0), 0, long ? W : slope, .12, long ? slope : D, long ? s * ang : 0, long ? 0 : -s * ang)); }
  }
  for (const [k, B] of batches) {
    const fl = +k.slice(1), mesh = B.build(k[0] === 'p' ? (opts.mat || planMat) : solidMat, { cast: k[0] === 's' });
    if (fl === 99) roofG.add(mesh); else { (floors[fl] ||= new THREE.Group()).add(mesh); }
  }
  floors.forEach(f => f && root.add(f)); root.add(roofG);
  return { root, floors, roof: roofG, boxes };
}
export { meshParts };

/* place a site's group in the world */
export function placeGroup(site, g) { g.position.set(site.x, site.kind === 'gov' ? (G.gY?.(site.x, site.z) || 0) : 0, site.z); g.rotation.y = site.face < 0 ? Math.PI : 0; return g; }
const toWorldBox = (site, b) => { const wx = site.x + b.x * site.face, wz = site.z + b.z * site.face; return { minX: wx - b.bw / 2, maxX: wx + b.bw / 2, minZ: wz - b.bd / 2, maxZ: wz + b.bd / 2, h: b.h + .4 }; };

/* redraw a site from its committed parts */
export function drawSite(key, parts) {
  const site = siteOf(key); if (!site) return;
  const old = S.sites.get(key); if (old) { G.scene.remove(old.root); old.root.traverse(o => o.geometry?.dispose?.()); }
  S.parts.set(key, parts);
  const m = meshParts(site, parts); placeGroup(site, m.root); G.scene.add(m.root);
  m.worldBoxes = m.boxes.map(b => toWorldBox(site, b)); m.site = site; m.I = indexParts(parts);
  S.sites.set(key, m);
  G.buildBoxes = [...S.sites.values()].flatMap(x => x.worldBoxes);
}
export const partsOf = key => S.parts.get(key) || [];
/* a government land board with its name (plots have their own sign in land.js) */
export function govBoards(names) {
  allSites().filter(s => s.kind === 'gov').forEach(s => {
    const nm = names[s.key] || s.name, prev = S.names.get(s.key); if (prev?.nm === nm) return;
    if (prev) G.scene.remove(prev.mesh);
    const tex = canvasTex(512, 160, g => { g.fillStyle = '#1d6e45'; g.fillRect(0, 0, 512, 160); g.fillStyle = '#f2c230'; g.textAlign = 'center'; g.font = '600 26px "Fredoka", system-ui, sans-serif'; g.fillText('GOVERNMENT LAND', 256, 46); g.fillStyle = '#fff'; g.font = '700 38px "Fredoka", system-ui, sans-serif'; g.fillText(nm, 256, 104, 490); }, false);
    const mesh = new THREE.Group(), board = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.1), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide })), post = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: 0x6d7075 }));
    post.scale.set(.12, 2.2, .12); post.position.y = 1.1; board.position.y = 2.6; mesh.add(post, board);
    const fx = s.x - s.w * s.cell / 2 + 2, fz = s.z + s.d * s.cell / 2 + 1; mesh.position.set(fx, G.gY?.(fx, fz) || 0, fz); G.scene.add(mesh);
    S.names.set(s.key, { nm, mesh, x: fx, z: fz });
  });
}
export const govBoardSpots = () => [...S.names.entries()].map(([key, v]) => ({ key, x: v.x, z: v.z, name: v.nm }));
/* hide the roof and upper floors of the building you are standing in */
export function updateStructures() {
  const p = G.player?.pos; if (!p) return;
  for (const m of S.sites.values()) {
    const c = worldCell(m.site, p.x, p.z), inB = m.I.has('slab', 0, Math.floor(c.x), Math.floor(c.z)) || m.I.has('foundation', 0, Math.floor(c.x), Math.floor(c.z));
    m.roof.visible = !inB; m.floors.forEach((f, i) => { if (f && i > 0) f.visible = !inB; });
  }
}

import * as THREE from 'three';
import { rand, pick, canvasTex, lerp } from './util.js';

export const SKIN = [0x5b3824, 0x6b4430, 0x7a4e33, 0x8a5838, 0x4b2e1e, 0x94603f];
export const BRIGHT = [0xe8b23a, 0x1f7a5c, 0xc9472f, 0x2e5fa8, 0x7b3f8c, 0xe07a2f, 0x13867f, 0xd94f7a];
const PLAIN = [0xf1ece0, 0x2b2b2b, 0x3c5a7a, 0x8a7a63, 0x5d6b4a, 0xb8b2a6];

const mats = new Map();
export function mat(hex, map = null) {
  const k = hex + (map ? map.uuid : '');
  if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color: map ? 0xffffff : hex, map, flatShading: true }));
  return mats.get(k);
}

/* Ankara-style wax print, drawn on a canvas */
const prints = [];
export function ankara(i = (rand() * 6) | 0) {
  if (prints[i]) return prints[i];
  const sets = [
    ['#1f6fb2', '#f2b632', '#e8452c', '#fff3d6'], ['#0f7a55', '#f7d046', '#d23b2b', '#16213a'],
    ['#7b2d8e', '#f39c34', '#2bb3a3', '#fdf0d5'], ['#c43d2f', '#1d3557', '#f4c542', '#f1faee'],
    ['#e06d1f', '#2a5c3d', '#f5e6c8', '#1e1e1e'], ['#165a9b', '#e94e77', '#ffd166', '#ffffff'],
  ];
  const [bg, a, b, c] = sets[i % sets.length];
  const t = canvasTex(128, 128, (g, w) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, w);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      const cx = 32 + x * 64 + (y % 2) * 0, cy = 32 + y * 64;
      if (i % 3 === 0) { // rings
        [[26, a], [19, c], [13, b], [6, c]].forEach(([r, col]) => { g.fillStyle = col; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); });
      } else if (i % 3 === 1) { // diamonds
        [[28, a], [20, c], [12, b]].forEach(([r, col]) => { g.fillStyle = col; g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.fill(); });
      } else { // leaves
        g.fillStyle = a; g.beginPath(); g.ellipse(cx, cy, 26, 12, .7, 0, 7); g.fill();
        g.fillStyle = b; g.beginPath(); g.ellipse(cx, cy, 16, 6, .7, 0, 7); g.fill();
        g.fillStyle = c; g.beginPath(); g.arc(cx + 22, cy - 22, 6, 0, 7); g.fill();
      }
    }
    g.fillStyle = c; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(k % 2 ? 64 : 0, k < 2 ? 0 : 64, 5, 0, 7); g.fill(); }
  });
  t.repeat.set(3, 2); prints[i] = t; return t;
}

const G = {}; // shared geometries
function geo(key, make) { return G[key] || (G[key] = make()); }
const dbl = new Map();
const twoSided = m => { if (!dbl.has(m)) { const c = m.clone(); c.side = THREE.DoubleSide; dbl.set(m, c); } return dbl.get(m); };
function lathe(key, pts, seg = 9) { return geo(key, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg)); }
const cap = (r, l) => geo('cap' + r + l, () => new THREE.CapsuleGeometry(r, l, 2, 7));

/*
  Person facing +z, ~1.72 units tall. Options:
  skin, outfit: 'shirt' | 'kaftan' | 'gown', top, bottom, print (texture or null), head: 'hair' | 'cap' | 'fila' | 'gele' | 'afro', headColor
*/
export function makePerson(o = {}) {
  const skin = o.skin ?? pick(SKIN);
  const outfit = o.outfit ?? 'shirt';
  const topMat = o.print ? mat(0, o.print) : mat(o.top ?? pick(BRIGHT));
  const botMat = mat(o.bottom ?? pick(PLAIN));
  const skinM = mat(skin), shoeM = mat(o.shoes ?? pick([0x2b2b2b, 0xf1f1f1, 0x6b4a33, 0x8b2f2f]));
  const root = new THREE.Group(), add = (g, m, p, x = 0, y = 0, z = 0) => { const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.castShadow = true; p.add(mesh); return mesh; };
  const s = o.scale ?? 1; root.scale.setScalar(s);

  const pelvis = new THREE.Group(); pelvis.position.y = .9; root.add(pelvis);
  // legs: hip → knee → ankle
  const legs = [];
  [-1, 1].forEach(side => {
    const hip = new THREE.Group(); hip.position.set(side * .095, 0, 0); pelvis.add(hip);
    // under a floor-length gown only the shoes show, so legs can never poke through the cloth
    if (outfit !== 'gown') add(cap(.072, .3), botMat, hip, 0, -.2, 0);
    const knee = new THREE.Group(); knee.position.y = -.42; hip.add(knee);
    if (outfit !== 'gown') add(cap(.058, .3), botMat, knee, 0, -.19, 0);
    const ankle = new THREE.Group(); ankle.position.y = -.4; knee.add(ankle);
    add(geo('shoe', () => { const g = new THREE.BoxGeometry(.11, .07, .24); g.translate(0, -.035, .045); return g; }), shoeM, ankle);
    legs.push({ hip, knee, ankle });
  });
  add(lathe('hips', [[0, -.08], [.15, -.07], [.17, .02], [.155, .1]]), outfit === 'shirt' ? botMat : topMat, pelvis).scale.z = .72;

  // torso
  const spine = new THREE.Group(); spine.position.y = .08; pelvis.add(spine);
  const torso = add(lathe('torso', [[.15, 0], [.145, .12], [.17, .28], [.18, .38], [.16, .46], [.07, .52], [0, .53]]), topMat, spine);
  torso.scale.z = .68;
  if (outfit === 'kaftan') add(lathe('kaftanSkirt', [[0, -.52], [.25, -.52], [.2, -.2], [.16, .05]], 10), twoSided(topMat), spine).scale.z = .8;
  if (outfit === 'gown') add(lathe('gownSkirt', [[0, -.88], [.31, -.88], [.24, -.3], [.18, .02], [.15, .1]], 14), twoSided(topMat), spine).scale.z = .9;

  // arms: shoulder → elbow → hand
  const arms = [];
  [-1, 1].forEach(side => {
    const sh = new THREE.Group(); sh.position.set(side * .205, .43, 0); spine.add(sh);
    add(cap(.056, .2), outfit === 'shirt' && !o.longSleeve ? topMat : topMat, sh, 0, -.13, 0);
    const elbow = new THREE.Group(); elbow.position.y = -.28; sh.add(elbow);
    add(cap(.046, .19), (outfit === 'shirt' && !o.longSleeve) ? skinM : topMat, elbow, 0, -.13, 0);
    add(geo('hand', () => new THREE.IcosahedronGeometry(.05, 0)), skinM, elbow, 0, -.29, 0);
    sh.rotation.z = side * .06; arms.push({ sh, elbow, side });
  });

  // head
  const neck = new THREE.Group(); neck.position.y = .52; spine.add(neck);
  add(geo('neck', () => new THREE.CylinderGeometry(.045, .05, .1, 6)), skinM, neck, 0, .02, 0);
  const head = new THREE.Group(); head.position.y = .15; neck.add(head);
  add(geo('head', () => { const g = new THREE.IcosahedronGeometry(.112, 2); g.scale(.95, 1.12, 1.04); return g; }), skinM, head);
  add(geo('nose', () => { const g = new THREE.ConeGeometry(.022, .05, 4); g.rotateX(Math.PI / 2); return g; }), skinM, head, 0, -.005, .115);
  const eyeM = mat(0x1a1410);
  [-1, 1].forEach(sd => { add(geo('eye', () => new THREE.IcosahedronGeometry(.014, 0)), eyeM, head, sd * .04, .03, .1); add(geo('ear', () => new THREE.IcosahedronGeometry(.03, 0)), skinM, head, sd * .108, .0, 0).scale.set(.6, 1, .9); });
  const hc = o.headColor ?? pick(BRIGHT), hairM = mat(0x17110d);
  const hd = o.head ?? 'hair';
  if (hd === 'hair' || hd === 'cap' || hd === 'fila') add(geo('hair', () => { const g = new THREE.SphereGeometry(.12, 9, 6, 0, Math.PI * 2, 0, Math.PI * .52); g.scale(1, 1.05, 1.08); return g; }), hairM, head, 0, .02, -.008);
  if (hd === 'afro') add(geo('afro', () => { const g = new THREE.IcosahedronGeometry(.16, 1); g.scale(1.05, .9, 1); return g; }), hairM, head, 0, .07, -.03);
  if (hd === 'cap') {
    add(geo('capTop', () => new THREE.SphereGeometry(.125, 9, 5, 0, Math.PI * 2, 0, Math.PI * .5)), mat(hc), head, 0, .045, 0);
    add(geo('capBrim', () => new THREE.BoxGeometry(.2, .015, .13)), mat(hc), head, 0, .055, .14);
  }
  if (hd === 'fila') { const f = add(geo('fila', () => new THREE.CylinderGeometry(.118, .122, .12, 10)), o.print ? mat(0, o.print) : mat(hc), head, .01, .12, -.01); f.rotation.z = -.18; }
  if (hd === 'gele') {
    const gm = mat(hc);
    add(geo('geleBand', () => new THREE.TorusGeometry(.115, .035, 5, 12)), gm, head, 0, .07, 0).rotation.x = Math.PI / 2 - .2;
    for (let i = 0; i < 5; i++) {
      const a = -1.1 + i * .55, p = add(geo('geleFan', () => { const g = new THREE.SphereGeometry(.1, 6, 4); g.scale(.45, 1.1, 1); return g; }), gm, head, Math.sin(a) * .07, .17, -.03 + Math.cos(a) * .02);
      p.rotation.set(-.5, a * .6, -a * .55);
    }
  }
  root.userData = { pelvis, spine, legs, arms, neck, head, phase: rand() * 6, outfit };
  return root;
}

/* walk/run/idle animation; speed in units/sec */
export function animatePerson(p, dt, speed, t, opts = {}) {
  const u = p.userData, run = speed > 6.8, k = Math.min(speed / (run ? 5 : 4.5), 1.25);
  if (opts.sit) {
    u.pelvis.position.y = .5; u.pelvis.rotation.y = 0; u.spine.rotation.set(-.05, 0, 0);
    u.legs.forEach(l => { l.hip.rotation.x = -1.45; l.knee.rotation.x = 1.45; l.ankle.rotation.x = 0; });
    u.arms.forEach(a => { a.sh.rotation.x = -.5; a.sh.rotation.z = a.side * .12; a.elbow.rotation.x = -.7; });
    u.head.rotation.y = Math.sin(t * .4 + u.phase) * .3; return;
  }
  u.phase += dt * (run ? speed * 1.2 : speed * 2.0 + (speed > .05 ? .6 : 0));
  const ph = u.phase, sn = Math.sin(ph), cs = Math.cos(ph);
  const A = (run ? .85 : .55) * k, gownK = u.outfit === 'gown' ? .45 : 1;
  if (opts.air) {
    u.legs[0].hip.rotation.x = -.6; u.legs[0].knee.rotation.x = .9; u.legs[1].hip.rotation.x = .15; u.legs[1].knee.rotation.x = .4;
    u.arms.forEach(a => { a.sh.rotation.x = -.4; a.sh.rotation.z = a.side * .55; a.elbow.rotation.x = -.5; });
    return;
  }
  u.legs.forEach((l, i) => {
    const s = i ? -sn : sn, c = i ? -cs : cs;
    l.hip.rotation.x = -A * s * gownK;
    l.knee.rotation.x = k * (run ? 1.3 : .75) * Math.max(0, c) * gownK + .04;
    l.ankle.rotation.x = -l.hip.rotation.x * .4 - l.knee.rotation.x * .3;
  });
  u.arms.forEach((a, i) => {
    const s = i ? -sn : sn;
    const idle = Math.sin(t * 1.3 + i) * .03;
    a.sh.rotation.x = A * .85 * s + idle + (opts.wave && i === 1 ? -2.6 + Math.sin(t * 9) * .25 : 0);
    a.sh.rotation.z = a.side * (.07 + (1 - k) * .02) + (opts.wave && i === 1 ? .3 * a.side : 0);
    a.elbow.rotation.x = -(.15 + (run ? .9 : .25 * k) + Math.max(0, s) * .25 * k);
  });
  u.pelvis.position.y = .9 - (1 - Math.abs(cs)) * .035 * k + (speed < .1 ? Math.sin(t * 2) * .004 : 0);
  u.pelvis.rotation.y = sn * .07 * k;
  u.spine.rotation.y = -sn * .13 * k;
  u.spine.rotation.x = run ? .18 : .03 * k;
  u.spine.scale.y = 1 + (speed < .1 ? Math.sin(t * 2) * .008 : 0);
  u.head.rotation.y = speed < .1 ? Math.sin(t * .5 + u.phase) * .35 : u.head.rotation.y * .9;
}

/* a small set of looks for the player picker */
export const PLAYER_LOOKS = [
  { name: 'Tunde', desc: 'Ankara shirt and cap', opts: { skin: 0x6b4430, outfit: 'shirt', print: 0, bottom: 0x3c5a7a, head: 'cap', headColor: 0x1d3557, shoes: 0xf1f1f1 } },
  { name: 'Amina', desc: 'Gown and gele', opts: { skin: 0x7a4e33, outfit: 'gown', print: 3, head: 'gele', headColor: 0xe8b23a, shoes: 0x6b4a33 } },
  { name: 'Emeka', desc: 'Kaftan and fila', opts: { skin: 0x5b3824, outfit: 'kaftan', top: 0x1f7a5c, bottom: 0x1f7a5c, head: 'fila', headColor: 0xf1ece0, shoes: 0x2b2b2b, longSleeve: true } },
];
export function lookOpts(i) { const o = { ...PLAYER_LOOKS[i].opts }; if (typeof o.print === 'number') o.print = ankara(o.print); return o; }

export function randomPerson(female = rand() < .5) {
  const printed = rand() < .5;
  if (female) return makePerson({ outfit: rand() < .7 ? 'gown' : 'shirt', print: printed ? ankara() : null, head: rand() < .65 ? 'gele' : (rand() < .5 ? 'afro' : 'hair'), scale: .94 + rand() * .06 });
  const kaftan = rand() < .35;
  return makePerson({ outfit: kaftan ? 'kaftan' : 'shirt', print: !kaftan && printed ? ankara() : null, longSleeve: kaftan, head: kaftan ? 'fila' : pick(['hair', 'cap', 'hair', 'afro']), scale: .97 + rand() * .07 });
}

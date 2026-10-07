import * as THREE from 'three';
import { Man, Proc, manPalette, menReady } from './characters.js';
import { ankara } from './people.js';

/* Player avatars: male or female, six skin tones, four outfits:
   casual, suit, native (agbada / ankara gown with gele) and senator (kaftan / plain gown with gele).
   Men use the animated Quaternius models with cloth pieces on top; women use the drawn body. */
export const SKINS = [0x3b2219, 0x4b2e1e, 0x5b3824, 0x6b4430, 0x7a4e33, 0x9a6544];
export const COLORS = [0x1d8a4a, 0xe8b23a, 0x2e5fa8, 0xc9472f, 0x7b2d8e, 0xf1ece0, 0x16213a, 0x111111];
export const OUTFITS = [
  { id: 'casual', name: 'Casual', m: 'T-shirt and jeans', f: 'Top and jeans' },
  { id: 'suit', name: 'Suit', m: 'Corporate suit', f: 'Trouser suit' },
  { id: 'native', name: 'Native', m: 'Agbada and fila', f: 'Ankara gown and gele' },
  { id: 'senator', name: 'Senator', m: 'Senator kaftan and cap', f: 'Long gown and gele' },
];
export const DEFAULT_AVATAR = { g: 'm', s: 2, o: 'casual', c: 0 };
export const cleanAvatar = a => ({ g: a?.g === 'f' ? 'f' : 'm', s: Math.max(0, Math.min(SKINS.length - 1, a?.s | 0)), o: OUTFITS.some(o => o.id === a?.o) ? a.o : 'casual', c: Math.max(0, Math.min(COLORS.length - 1, a?.c | 0)) });

const mats = new Map();
const lam = (hex, map) => { const k = hex + ':' + (map ? map.uuid : ''); if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color: map ? 0xffffff : hex, map, flatShading: true, side: THREE.DoubleSide })); return mats.get(k); };
const lathe = (pts, seg = 12) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
// profiles run bottom to top so the faces point outward
const geos = {
  agbada: lathe([[.38, .46], [.5, .8], [.56, 1.08], [.44, 1.31], [.16, 1.46]], 16),   // wide, flowing robe
  kaftan: lathe([[0, .64], [.27, .64], [.25, .95], [.22, 1.3], [.17, 1.42]], 12),
};

/* overlay pieces follow the body as a whole (cheap and robust) */
function dress(man, kind, col) {
  const add = (g, m, sz = 1) => { const mesh = new THREE.Mesh(g, m); mesh.scale.z = sz; mesh.castShadow = true; man.root.add(mesh); return mesh; };
  if (kind === 'native') { const m = add(geos.agbada, lam(col), .36); m.position.z = .02; const t = add(geos.kaftan, lam(col === 0xf1ece0 ? 0xd9a936 : 0xf1ece0), .7); t.scale.setScalar(.98); t.scale.z = .7; }
  if (kind === 'senator') add(geos.kaftan, lam(col), .74);
}

export function makeAvatar(a, override = {}) {
  a = cleanAvatar(a);
  const skin = SKINS[a.s], col = override.shirt ?? COLORS[a.c], dark = [0x16213a, 0x111111, 0x2e5fa8, 0x7b2d8e].includes(col);
  if (a.g === 'f' || !menReady()) {
    const female = a.g === 'f';
    const o = { skin, scale: female ? .95 : 1, shoes: 0x2b2b2b };
    if (a.o === 'casual') Object.assign(o, { outfit: 'shirt', top: col, bottom: override.pants ?? 0x3c5a7a, head: female ? 'afro' : 'hair' });
    if (a.o === 'suit') Object.assign(o, { outfit: 'shirt', longSleeve: true, top: dark ? col : 0x16213a, bottom: dark ? col : 0x16213a, head: 'hair' });
    if (a.o === 'native') Object.assign(o, female ? { outfit: 'gown', print: ankara(a.c % 6), head: 'gele', headColor: col } : { outfit: 'kaftan', top: col, bottom: col, head: 'fila', headColor: col, longSleeve: true });
    if (a.o === 'senator') Object.assign(o, female ? { outfit: 'gown', top: col, head: 'gele', headColor: 0xd9a936 } : { outfit: 'kaftan', top: col, bottom: col, head: 'fila', headColor: 0x111111, longSleeve: true });
    return new Proc(o);
  }
  let m;
  if (a.o === 'casual') m = new Man('casual', manPalette({ skin, shirt: col, pants: override.pants ?? 0x3c5a7a }), override.hat ? { type: override.hat, color: override.hatColor ?? 0x1d3557 } : null);
  if (a.o === 'suit') m = new Man('suit', manPalette({ skin, shirt: dark ? col : 0x16213a, pants: dark ? col : 0x16213a, tie: dark ? 0xc9472f : col }));
  if (a.o === 'native') { m = new Man('longsleeve', manPalette({ skin, shirt: col, pants: col }), { type: 'fila', color: col }); dress(m, 'native', col); }
  if (a.o === 'senator') { m = new Man('longsleeve', manPalette({ skin, shirt: col, pants: col }), { type: 'fila', color: 0x111111 }); dress(m, 'senator', col); }
  return m;
}
/* short code for presence so other players see the same avatar: g s o c, e.g. "f3n4" */
const OC = { casual: 'c', suit: 'u', native: 'n', senator: 's' }, CO = { c: 'casual', u: 'suit', n: 'native', s: 'senator' };
export const avatarCode = a => { a = cleanAvatar(a); return a.g + a.s + OC[a.o] + a.c; };
export const fromCode = c => (typeof c === 'string' && /^[mf]\d[cuns]\d$/.test(c) ? cleanAvatar({ g: c[0], s: +c[1], o: CO[c[2]], c: +c[3] }) : null);

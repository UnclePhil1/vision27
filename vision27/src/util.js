import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const angleLerp = (a, b, t) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * t; };

export function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const rand = mulberry32(7104);
export const pick = arr => arr[(rand() * arr.length) | 0];
export const range = (a, b) => a + rand() * (b - a);

export function makeNoise(r) {
  const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  const p = new Uint8Array(512); for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  const c = (gi, x, y) => { let t = 0.5 - x * x - y * y; if (t < 0) return 0; t *= t; const g = G[gi & 7]; return t * t * (g[0] * x + g[1] * y); };
  return (x, y) => {
    const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t), i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1, ii = i & 255, jj = j & 255;
    return 70 * (c(p[ii + p[jj]], x0, y0) + c(p[ii + i1 + p[jj + j1]], x0 - i1 + G2, y0 - j1 + G2) + c(p[ii + 1 + p[jj + 1]], x0 - 1 + 2 * G2, y0 - 1 + 2 * G2));
  };
}
export const noise = makeNoise(rand);

/* Batch: bake many static pieces into one flat-shaded, vertex-coloured mesh */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _c = new THREE.Color();
export class Batch {
  constructor() { this.list = []; }
  add(geo, color, x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    _c.set(color);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _m.compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(_m); this.list.push(g); return this;
  }
  addMatrix(geo, color, m) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
    if (!g.attributes.color) { _c.set(color); const n = g.attributes.position.count, col = new Float32Array(n * 3); for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
    g.applyMatrix4(m); this.list.push(g); return this;
  }
  build(material, { cast = true, receive = true } = {}) {
    if (!this.list.length) return new THREE.Group();
    const g = mergeGeometries(this.list); g.computeVertexNormals(); this.list.forEach(x => x.dispose()); this.list = [];
    const mesh = new THREE.Mesh(g, material); mesh.castShadow = cast; mesh.receiveShadow = receive; return mesh;
  }
}

/* textured box with UVs in world units, so tiling textures keep their scale */
export function uvBox(w, h, d, tile = 4, tileY = tile) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, nrm = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    const sw = ny > .5 ? w : (nx > .5 ? d : w), sh = ny > .5 ? d : h;
    uv.setXY(i, uv.getX(i) * sw / tile, uv.getY(i) * sh / tileY);
  }
  return g;
}
export function mergeTextured(list) { const g = mergeGeometries(list); list.forEach(x => x.dispose()); return g; }
export function placed(geo, x, y, z, ry = 0) { const g = geo.clone(); g.rotateY(ry); g.translate(x, y, z); return g; }

/* displaced icosahedron blob, deterministic per vertex position */
export function blob(r, ox, oy, oz, detail = 1, amp = .22) {
  const g = new THREE.IcosahedronGeometry(r, detail), p = g.attributes.position, s = rand() * 50;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + noise(x * 1.3 + s, y * 1.1 + z * .9) * amp;
    p.setXYZ(i, x * k + ox, (y < 0 ? y * .75 : y) * k + oy, z * k + oz);
  }
  return g;
}

/* canvas texture helper */
export function canvasTex(w, h, draw, repeat = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

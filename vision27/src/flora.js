import * as THREE from 'three';
import { Batch, blob, rand, pick } from './util.js';

export const timeU = { value: 0 };
function swayMat(strength = .03, from = 1) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = s => {
    s.uniforms.uTime = timeU;
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
      float sw = sin(uTime * 1.3 + ip.x * .21 + ip.y * .17) * ${strength.toFixed(3)} * max(transformed.y - ${from.toFixed(1)}, 0.);
      transformed.x += sw; transformed.z += sw * .6;`);
  };
  return m;
}

function palmGeo() {
  const b = new Batch();
  // curved, ringed trunk
  let x = 0, y = 0, lean = .04 + rand() * .06;
  for (let i = 0; i < 7; i++) {
    const r = .24 - i * .012;
    b.add(new THREE.CylinderGeometry(r * .92, r, 1.05, 7), i % 2 ? 0x8f7a5c : 0x7d684d, x, y + .52, 0, 0, 1, 1, 1, 0, -lean * i * .6);
    x += lean * i * .35; y += 1.0;
  }
  b.add(new THREE.IcosahedronGeometry(.35, 0), 0x6b5a3a, x, y + .1, 0);
  // drooping fronds
  const n = 10;
  for (let f = 0; f < n; f++) {
    const a = f / n * Math.PI * 2 + rand() * .3, len = 3 + rand() * .8, droop = .9 + rand() * .5;
    const pos = [], seg = 5;
    const pts = []; for (let k = 0; k <= seg; k++) { const t = k / seg; pts.push([Math.cos(a) * t * len, Math.sin(t * Math.PI * .9) * .9 - t * t * droop * 1.6, Math.sin(a) * t * len, (1 - t * .85) * .55]); }
    const px = -Math.sin(a), pz = Math.cos(a);
    for (let k = 0; k < seg; k++) {
      const [x0, y0, z0, w0] = pts[k], [x1, y1, z1, w1] = pts[k + 1];
      const A = [x0 + px * w0, y0, z0 + pz * w0], Bv = [x0 - px * w0, y0, z0 - pz * w0], C = [x1 + px * w1, y1 - .05, z1 + pz * w1], D = [x1 - px * w1, y1 - .05, z1 - pz * w1];
      const M0 = [x0, y0 + .08, z0], M1 = [x1, y1 + .06, z1];
      pos.push(...A, ...M0, ...C, ...M0, ...M1, ...C, ...M0, ...Bv, ...D, ...M0, ...D, ...M1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.translate(x, y + .1, 0);
    b.add(g, pick([0x4f8f3c, 0x5b9a40, 0x467f36]));
  }
  return b;
}
function treeGeo(kind) {
  const b = new Batch();
  b.add(new THREE.CylinderGeometry(.2, .32, 3, 6), 0x6e543b, 0, 1.5, 0);
  const greens = [0x3f8a4f, 0x4e9a55, 0x367a45, 0x5aa35a];
  if (kind === 0) { b.add(blob(2, 0, 4, 0), greens[0]); for (let i = 0; i < 3; i++) { const a = rand() * 6.28; b.add(blob(1.2 + rand() * .5, Math.cos(a) * 1.5, 3.6 + rand(), Math.sin(a) * 1.5), pick(greens)); } }
  else if (kind === 1) { b.add(blob(1.6, 0, 3.8, 0), greens[1]); b.add(blob(1.3, .2, 5.3, 0), greens[3]); b.add(blob(.9, -.2, 6.4, .1), greens[1]); }
  else { b.add(blob(2.4, 0, 3.6, 0, 1, .18), greens[2]); b.add(blob(1.4, 1.4, 3.2, .6), greens[0]); }
  return b;
}
// shade each triangle: darker underneath
function shadeByHeight(g, lo, hi) {
  const p = g.attributes.position.array, c = g.attributes.color.array;
  for (let i = 0; i < p.length; i += 9) {
    const y = (p[i + 1] + p[i + 4] + p[i + 7]) / 3, k = .62 + .48 * Math.min(1, Math.max(0, (y - lo) / (hi - lo)));
    for (let v = 0; v < 9; v++) c[i + v] *= k;
  }
  return g;
}

export function buildFlora(root, trees, palms) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  // palms: 3 shapes
  const pv = [0, 1, 2].map(() => { const b = palmGeo(), mesh = b.build(swayMat(.025, 3)); return mesh.geometry; });
  const pmat = swayMat(.02, 3);
  pv.forEach((g, vi) => {
    const list = palms.filter((_, i) => i % 3 === vi); if (!list.length) return;
    const im = new THREE.InstancedMesh(g, pmat, list.length); im.castShadow = im.receiveShadow = true;
    list.forEach((p, i) => { e.set(0, rand() * 6.28, 0); q.setFromEuler(e); m.compose(new THREE.Vector3(p.x, p.y - .1, p.z), q, new THREE.Vector3(p.s, p.s, p.s)); im.setMatrixAt(i, m); col.setHSL(0, 0, .92 + rand() * .1); im.setColorAt(i, col); });
    root.add(im);
  });
  const tmat = swayMat(.03, 2.5);
  [0, 1, 2].forEach(v => {
    const b = treeGeo(v), g = shadeByHeight(b.build(tmat).geometry, 2.5, 6.5);
    const list = trees.filter(t => t.v === v); if (!list.length) return;
    const im = new THREE.InstancedMesh(g, tmat, list.length); im.castShadow = im.receiveShadow = true;
    list.forEach((t, i) => { e.set(0, rand() * 6.28, 0); q.setFromEuler(e); m.compose(new THREE.Vector3(t.x, t.y - .1, t.z), q, new THREE.Vector3(t.s, t.s * (.9 + rand() * .2), t.s)); im.setMatrixAt(i, m); col.setHSL(.3, .2, .9 + rand() * .15); im.setColorAt(i, col); });
    root.add(im);
  });
}

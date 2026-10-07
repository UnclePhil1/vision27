import * as THREE from 'three';
import { POTHOLES } from './floordata.js';
import { Batch, canvasTex, rand, pick } from './util.js';
import { S, N, HALF, EDGE, CURB, RB_CUT } from './consts.js';
import { terrainH } from './city.js';

/* Places around the city: motor park, fire and police stations, car dealer and fuel station,
   the highway north, a police checkpoint, potholes and the things that are broken. */
const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(1, 1, 1, 12), CONE = new THREE.ConeGeometry(1, 1, 10);

function label(text, bg, fg, sub) {
  return new THREE.MeshLambertMaterial({ map: canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${sub ? 48 : 58}px "Fredoka", "Segoe UI", system-ui, sans-serif`; g.fillText(text, w / 2, sub ? 50 : h / 2, w - 30);
    if (sub) { g.font = '500 28px "Fredoka", system-ui, sans-serif'; g.fillText(sub, w / 2, 98, w - 30); }
  }, false) });
}

export function buildOutskirts(scene) {
  const root = new THREE.Group(); scene.add(root);
  const B = new Batch(), boxes = [], circles = [], seats = [], spots = {}, potholes = [];
  const box = (w, h, d, c, x, y, z, ry = 0) => B.add(BOX, c, x, y, z, ry, w, h, d);
  const solid = (x, z, w, d, h = 6) => boxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
  const sign = (text, bg, fg, x, y, z, ry, w = 8, sub) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), label(text, bg, fg, sub)); m.position.set(x, y, z); m.rotation.y = ry; root.add(m); const b = m.clone(); b.rotation.y = ry + Math.PI; b.position.x -= Math.sin(ry) * .02; b.position.z -= Math.cos(ry) * .02; root.add(b); return m; };
  const road = (x, z, w, d) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), roadMat); m.position.set(x, .012, z); m.receiveShadow = true; root.add(m); };
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x5a5d62, polygonOffset: true, polygonOffsetFactor: -1 });

  // connector roads and the pads' hard standing
  road(-146, 0, 22, 12); road(146, 0, 22, 12); road(0, 146, 12, 22); road(0, -200, 16, 130);
  road(-178, 0, 52, 64); road(178, 0, 52, 84); road(0, 180, 84, 52);
  for (let z = -140; z > -262; z -= 7) box(.16, .01, 3, 0xf2f2ee, 0, .02, z);

  /* ---------- motor park ---------- */
  {
    const cx = -180;
    for (let k = 0; k < 6; k++) [-1, 1].forEach(s => { box(.25, 5, .25, 0x7d8085, cx - 14 + k * 5.6, 2.5, s * 7); circles.push({ x: cx - 14 + k * 5.6, z: s * 7, r: .3 }); });
    box(31, .15, 16, 0xa9aeb2, cx, 5.1, 0); for (let k = -15; k <= 15; k += .8) box(.06, .08, 16, 0x8f9498, cx + k, 5.2, 0);
    for (let k = 0; k < 4; k++) { const x = cx - 10 + k * 6.5; box(4, .12, .6, 0x8a6a4e, x, .5, -4); box(4, .5, .1, 0x8a6a4e, x, .8, -4.3); [-1.4, 0, 1.4].forEach(o => seats.push({ x: x + o, z: -3.95, y: 0, yaw: 0 })); }
    box(4, 2.6, 3, 0x1d8a4a, -158, 1.3, -18); box(4.4, .3, 3.4, 0xf2c230, -158, 2.75, -18); box(2.2, .9, .05, 0x9fc3d8, -156.6, 1.6, -18, Math.PI / 2); solid(-158, -18, 4, 3);
    sign('TICKETS', '#f2c230', '#1d3b2a', -155.9, 2.2, -18, Math.PI / 2, 2.4);
    spots.ticketBooth = { x: -154.6, z: -18 };
    [-1, 1].forEach(s => { box(.8, 7, .8, 0x1d8a4a, -153, 3.5, s * 9); circles.push({ x: -153, z: s * 9, r: .6 }); });
    box(.9, 1.6, 19, 0xf2c230, -153, 7.6, 0); sign('UNITY MOTOR PARK', '#f2c230', '#1d3b2a', -152.5, 7.6, 0, Math.PI / 2, 12, 'Buses to villages and the airport');
    spots.coachBays = [{ x: -186, z: -20, yaw: 0, dest: 'village' }, { x: -172, z: -20, yaw: 0, dest: 'airport' }, { x: -186, z: 20, yaw: Math.PI, dest: 'village' }];
    // an uncompleted building with rods sticking out, by the park
    const ux = -170, uz = 52, uy = terrainH(ux, uz);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { box(.5, 6, .5, 0x9a9690, ux - 5 + i * 5, uy + 3, uz - 4 + j * 4); for (let r = 0; r < 4; r++) box(.03, 1, .03, 0x6b4a33, ux - 5 + i * 5 + (r % 2 - .5) * .3, uy + 6.5, uz - 4 + j * 4 + ((r / 2 | 0) - .5) * .3); solid(ux - 5 + i * 5, uz - 4 + j * 4, .5, .5); }
    box(10.5, .3, 8.5, 0xa8a49c, ux, uy + 3, uz); box(4, 1.2, .2, 0xb2723c, ux - 3, uy + .6, uz - 4); box(.2, 1.2, 4, 0xb2723c, ux - 5, uy + .6, uz);
    sign('THIS PROPERTY IS NOT FOR SALE', '#ffffff', '#b3202a', ux + 6.5, uy + 1.6, uz - 6, 0, 4);
  }

  /* ---------- fire service and police ---------- */
  {
    const fx = 186, fz = -22;
    box(14, 7, 16, 0xa8342a, fx, 3.5, fz); box(14.4, .5, 16.4, 0xe9e2d2, fx, 7.25, fz); solid(fx, fz, 14, 16, 7);
    [-4, 4].forEach(o => { box(.1, 4.6, 5.6, 0xd9d4c7, fx - 7.02, 2.3, fz + o); box(.12, .2, 5.8, 0xf2f2ee, fx - 7.05, 4.7, fz + o); });
    box(2.6, 10, 2.6, 0xa8342a, fx + 5, 5, fz + 6); box(3, .4, 3, 0xe9e2d2, fx + 5, 10.2, fz + 6);
    sign('FIRE SERVICE', '#c4161c', '#ffffff', fx - 7.08, 6, fz, -Math.PI / 2, 7, 'Federal Fire Station');
    spots.fire = { x: fx - 12, z: fz, yaw: -Math.PI / 2 };
    const px = 186, pz = 24;
    box(14, 6, 16, 0xf2f0ea, px, 3, pz); box(14.2, 1, 16.2, 0x1b2f5c, px, 5.5, pz); box(14.4, .4, 16.4, 0xd9d4c7, px, 6.2, pz); solid(px, pz, 14, 16, 6);
    box(.1, 2.6, 2, 0x2f4656, px - 7.02, 1.3, pz); sign('POLICE DIVISION', '#1b2f5c', '#ffffff', px - 7.08, 4.4, pz, -Math.PI / 2, 7, 'Garki Area Command');
    box(.1, 9, .1, 0xdedede, px - 9, 4.5, pz + 7);
    spots.police = { x: px - 11, z: pz, yaw: -Math.PI / 2 };
    spots.cell = { x: px - 9.5, z: pz, yaw: -Math.PI / 2 };
    sign('FIRE · POLICE', '#16213a', '#ffffff', 150, 4, -8, -Math.PI / 2, 5);
    box(.15, 3.5, .15, 0x7d8085, 150, 1.75, -9.5); box(.15, 3.5, .15, 0x7d8085, 150, 1.75, -6.5);
  }

  /* ---------- car dealer and fuel station ---------- */
  {
    box(26, 6, 12, 0xe9edf0, -14, 3, 196); box(26.4, .5, 12.4, 0x16213a, -14, 6.2, 196); box(25.8, 4, .1, 0x2f4656, -14, 2.4, 189.95); solid(-14, 196, 26, 12);
    sign('JABI MOTORS', '#16213a', '#f2c230', -14, 7.4, 189.8, 0, 10, 'New and Tokunbo cars');
    spots.dealer = [{ x: -28, z: 176, yaw: Math.PI / 6 }, { x: -20, z: 176, yaw: Math.PI / 6 }, { x: -12, z: 176, yaw: Math.PI / 6 }, { x: -4, z: 176, yaw: Math.PI / 6 }];
    spots.dealer.forEach(d => box(5.2, .06, 3.2, 0xe2dccd, d.x, .03, d.z, d.yaw + Math.PI / 2));
    // fuel station
    const gx = 26, gz = 178;
    box(18, .5, 10, 0xf2f0ea, gx, 5.5, gz); box(18.2, .7, 10.2, 0x1d8a4a, gx, 5.1, gz);
    [[-5, -2], [5, -2], [-5, 2], [5, 2]].forEach(([a, b]) => { box(.4, 5, .4, 0xd9d4c7, gx + a, 2.5, gz + b); circles.push({ x: gx + a, z: gz + b, r: .35 }); });
    [-2.5, 2.5].forEach(a => { box(.8, 1.6, .5, 0xf2f0ea, gx + a, .8, gz); box(.82, .5, .52, 0x1d8a4a, gx + a, 1.4, gz); solid(gx + a, gz, .8, .5, 2); });
    box(6, 3, 4, 0xf2f0ea, gx, 1.5, gz + 12); solid(gx, gz + 12, 6, 4, 3);
    sign('UNITY FUEL', '#1d8a4a', '#ffffff', gx, 7, gz - 5.2, 0, 7, 'PMS · Diesel · Gas');
    spots.fuel = { x: gx, z: gz - 3 };
  }

  /* ---------- highway north ---------- */
  {
    [-7, 7].forEach(o => box(.4, 7, .4, 0x7d8085, o, 3.5, -168));
    box(14.6, 3.4, .3, 0x1d6e3a, 0, 6.2, -168);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.2), label('HIGHWAY', '#1d6e3a', '#ffffff', 'Airport · Kauye Village · Lokoja')); m.position.set(0, 6.2, -167.8); root.add(m);
    spots.highway = { x: 0, z: -206 };
  }

  /* ---------- police checkpoint on the east-west road through Wuse ---------- */
  {
    const cx = 64, cz = -36;
    for (let k = -3; k <= 3; k++) { [-1, 1].forEach(s => { B.add(CONE, 0xf26a1b, cx + s * (2.2 + Math.abs(k) * .5), .35, cz + k * 1.4, 0, .25, .7, .25); B.add(CYL, 0xf4f4f4, cx + s * (2.2 + Math.abs(k) * .5), .45, cz + k * 1.4, 0, .17, .1, .17); }); }
    box(.2, 1, 4, 0xb3202a, cx - 6, .5, cz); box(.2, 1, 4, 0xb3202a, cx + 6, .5, cz);
    box(2.2, .1, 2.2, 0x2e5fa8, cx + 11.5, 2.4, cz - 3); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => box(.06, 2.4, .06, 0x777777, cx + 11.5 + a, 1.2, cz - 3 + b));
    spots.checkpoint = { x: cx, z: cz, officers: [{ x: cx - 4.3, z: cz + 2, yaw: Math.PI / 2 }, { x: cx + 4.3, z: cz - 2, yaw: -Math.PI / 2 }, { x: cx + 11.5, z: cz - 3, yaw: -Math.PI / 2 }], van: { x: cx + 11, z: cz + 4, yaw: 0 } };
  }

  /* ---------- potholes on the roads ---------- */
  const potMat = new THREE.MeshLambertMaterial({ color: 0x2c2b2a, polygonOffset: true, polygonOffsetFactor: -3 }), rimMat = new THREE.MeshLambertMaterial({ color: 0x75726c, polygonOffset: true, polygonOffsetFactor: -2 }), waterMat = new THREE.MeshPhongMaterial({ color: 0x6a7c86, shininess: 90, polygonOffset: true, polygonOffsetFactor: -4 });
  for (const [x, z] of POTHOLES) {
    const r = .5 + rand() * .6, ry = rand() * 3;
    const rim = new THREE.Mesh(new THREE.CircleGeometry(r * 1.3, 9).rotateX(-Math.PI / 2), rimMat); rim.position.set(x, .016, z); rim.scale.set(1, 1, .7 + rand() * .4); rim.rotation.y = ry; root.add(rim);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(r, 8).rotateX(-Math.PI / 2), rand() < .35 ? waterMat : potMat); hole.position.set(x, .02, z); hole.scale.copy(rim.scale); hole.rotation.y = ry; root.add(hole);
    potholes.push({ x, z, r: r * 1.2, meshes: [rim, hole] });
  }
  // cracked tar patches
  for (let i = 0; i < 30; i++) { const x = (rand() - .5) * 250, z = Math.round((rand() - .5) * 4) * S + (rand() - .5) * 12; if (Math.hypot(x, z) < RB_CUT + 6) continue; const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5 + rand() * 3, .8 + rand()).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x4a4c50, polygonOffset: true, polygonOffsetFactor: -1 })); m.position.set(x, .014, z); m.rotation.y = rand() * 3; root.add(m); }

  /* ---------- broken and messy things ---------- */
  // an abandoned rusty car by the ring road
  { const x = -140, z = 118, y = terrainH(x, z); box(4.2, .9, 1.8, 0x7a4a2a, x, y + .55, z, .4); box(2.2, .7, 1.6, 0x6b4028, x - .3, y + 1.3, z, .4); [[-1.4, -.9], [1.4, -.9], [-1.4, .9]].forEach(([a, b]) => box(.5, .5, .25, 0x333333, x + a, y + .25, z + b, .4)); solid(x, z, 4.4, 2.6, 2); }
  // refuse heaps near the market and by the motor park
  [[-117, 60], [-75, 58], [-150, 34], [-116, 12]].forEach(([x, z]) => { for (let k = 0; k < 9; k++) B.add(new THREE.IcosahedronGeometry(1, 0), pick([0x3a3a3a, 0x2e5fa8, 0xe8e2d0, 0x6b4a33, 0x1f9a5a]), x + (rand() - .5) * 2.2, .3 + rand() * .3, z + (rand() - .5) * 2.2, rand() * 3, .5 + rand() * .4, .35, .5 + rand() * .4); circles.push({ x, z, r: 1.5 }); });
  // an open gutter beside the market road
  for (let z = 10; z < 54; z += 3) box(.9, .05, 2.6, 0x23211f, -64 - HALF - .9, CURB + .01, z);
  B.add(BOX, 0x8a8a84, -64 - HALF - .9, CURB - .2, 32, 0, 1.1, .4, 46);

  root.add(B.build(mat));
  return { root, boxes, circles, seats, spots, potholes };
}

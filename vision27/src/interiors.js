import * as THREE from 'three';
import { Batch, mulberry32, canvasTex } from './util.js';
import { G } from './game.js';

/* Interiors are built far away from the city (x >= 3000), one slot per door,
   so every player puts the same room at the same coordinates. Rooms have no
   ceiling: the camera looks in from above, like a dollhouse. */

export const INT_X = 3000, INT_Z = 3000, INT_GAP = 90;
export const isInside = x => x > INT_X - 200;
const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(1, 1, 1, 12), SPH = new THREE.IcosahedronGeometry(1, 1), CAP = new THREE.CapsuleGeometry(1, 1, 2, 8);

function label(text, bg, fg, w = 512, h = 128) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${Math.round(h * .42)}px "Fredoka", "Segoe UI", system-ui, sans-serif`; g.fillText(text, w / 2, h / 2 + 2, w - 30);
  }, false);
}

/* public buildings in the new districts: room size, colours and sign colour */
const CIVIC = {
  hospital: { w: 20, d: 12, wall: 0xf2f6f4, floor: 0xd8e2df, signBg: '#c9472f' },
  school: { w: 16, d: 12, wall: 0xf0e6c8, floor: 0xc9a77a, signBg: '#8b3a2a' },
  cinema: { w: 18, d: 14, wall: 0x2a1f24, floor: 0x3a2a30, signBg: '#c9472f' },
  bank: { w: 20, d: 12, wall: 0xe8edf1, floor: 0xdcdfe2, signBg: '#16213a' },
  club: { w: 18, d: 12, wall: 0xf3efe6, floor: 0x6e543b, signBg: '#1d4d33' },
  council: { w: 20, d: 12, wall: 0xf3efe6, floor: 0xd9d4c7, signBg: '#1d6e45' },
  inec: { w: 16, d: 11, wall: 0xf2f2ee, floor: 0xd9dcde, signBg: '#1d8a4a' },
  hub: { w: 18, d: 12, wall: 0x2f4656, floor: 0xb8bcbe, signBg: '#16213a' },
  dispatch: { w: 14, d: 10, wall: 0xf6e7b8, floor: 0xb8bcbe, signBg: '#c9472f' },
  agency: { w: 13, d: 10, wall: 0xf6f0e4, floor: 0xc9a77a, signBg: '#3f5f7f' },
  villa: { w: 20, d: 14, wall: 0xf8f6f0, floor: 0xe2dccd, signBg: '#1d4d33' },
  hotel: { w: 22, d: 14, wall: 0xf1ece0, floor: 0xd8c9ae, signBg: '#16213a' },
  restaurant: { w: 18, d: 12, wall: 0xf6e7c8, floor: 0xb08a5a, signBg: '#6b4a3a' },
  bar: { w: 16, d: 12, wall: 0x2f2a2a, floor: 0x4a3a2a, signBg: '#2b2b2b' },
  nightclub: { w: 20, d: 16, wall: 0x14101f, floor: 0x1b1530, signBg: '#7b2d8e' },
  gym: { w: 18, d: 12, wall: 0xd9dde2, floor: 0x3a3d42, signBg: '#16213a' },
  // work floors (stations come from floordata.js)
  depot: { w: 34, d: 24, wall: 0xe9edf0, floor: 0xc9ccce, signBg: '#c9472f' },
  shopfloor: { w: 24, d: 16, wall: 0xf4f1e8, floor: 0xdcd6ca, signBg: '#c9472f' },
  workshop: { w: 24, d: 16, wall: 0xdfe3e6, floor: 0x8d9196, signBg: '#16213a' },
  yard: { w: 28, d: 18, wall: 0xc8c2b4, floor: 0xa59d8c, signBg: '#b5651d' },
};

export function buildInterior(door, slot) {
  const ox = INT_X + slot * INT_GAP, oz = INT_Z, rng = mulberry32(9000 + slot), pick = a => a[(rng() * a.length) | 0];
  const g = new THREE.Group(), B = new Batch(), boxes = [], circles = [], seats = [], beds = [], npcs = [], spots = [];
  const box = (w, h, d, c, x, y, z, ry = 0) => B.add(BOX, c, ox + x, y, oz + z, ry, w, h, d);
  const solid = (x, z, w, d, h = 4) => boxes.push({ minX: ox + x - w / 2, maxX: ox + x + w / 2, minZ: oz + z - d / 2, maxZ: oz + z + d / 2, h });
  const seat = (x, z, yaw, y = 0) => seats.push({ x: ox + x, z: oz + z, y, yaw });
  const chair = (x, z, yaw, c = 0x8a6a4e) => { box(.55, .08, .55, c, x, .45, z, yaw); box(.55, .6, .08, c, x - Math.sin(yaw) * .25, .75, z - Math.cos(yaw) * .25, yaw); [[-.22, -.22], [.22, -.22], [-.22, .22], [.22, .22]].forEach(([a, b]) => box(.05, .45, .05, 0x333333, x + a, .22, z + b)); seat(x, z, yaw); };

  // room shell: floor, four walls with the exit door in the front (+z) wall
  function shell(w, d, h, wallC, floorC, wallMat) {
    box(w + 4, .2, d + 4, 0x1f1c19, 0, -.15, 0);
    box(w, .1, d, floorC, 0, -.03, 0);
    const walls = new Batch(), wall = (ww, hh, dd, x, y, z) => walls.add(BOX, 0xffffff, ox + x, y, oz + z, 0, ww, hh, dd);
    wall(w + .6, h, .3, 0, h / 2, -d / 2 - .15); wall(.3, h, d, -w / 2 - .15, h / 2, 0); wall(.3, h, d, w / 2 + .15, h / 2, 0);
    const side = (w - 2.4) / 2; wall(side + .3, h, .3, -w / 2 + side / 2 - .15, h / 2, d / 2 + .15); wall(side + .3, h, .3, w / 2 - side / 2 + .15, h / 2, d / 2 + .15); wall(2.4, h - 2.6, .3, 0, 2.6 + (h - 2.6) / 2, d / 2 + .15);
    const wm = wallMat || new THREE.MeshLambertMaterial({ color: wallC }); const wmesh = walls.build(wm); wmesh.material = wm; g.add(wmesh);
    solid(0, -d / 2 - .15, w + .6, .3, h); solid(-w / 2 - .15, 0, .3, d, h); solid(w / 2 + .15, 0, .3, d, h); solid(0, d / 2 + .15, w + .6, .3, h);
    // the exit door
    box(2.2, 2.5, .1, 0x5a3e2b, 0, 1.25, d / 2 - .02); box(.3, .3, .05, 0xd9a936, .8, 1.2, d / 2 - .08);
    const ex = new THREE.Mesh(new THREE.PlaneGeometry(1.4, .35), new THREE.MeshBasicMaterial({ map: label('EXIT', '#1d8a4a', '#ffffff', 256, 64) }));
    ex.position.set(ox, 2.62, oz + d / 2 - .09); ex.rotation.y = Math.PI; g.add(ex);
    return wm;
  }
  const wallSign = (text, bg, fg, x, y, z, w, ry = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshLambertMaterial({ map: label(text, bg, fg) })); m.position.set(ox + x, y, oz + z); m.rotation.y = ry; g.add(m); };

  let W = 12, D = 9, H = 2.9, wallMat = null, name = door.name || 'Building';
  if (door.kind === 'shop') {
    const nm = door.name.toLowerCase(), c = door.color || '#1d8a4a';
    shell(W, D, H, 0xf3ece0, 0xd9cfbf);
    wallSign(door.name, c, '#ffffff', 0, 2.3, -D / 2 + .02, 4);
    box(4.2, 1.05, .9, 0x6e543b, 0, .52, -2.4); box(4.3, .06, 1, 0xd8d0c2, 0, 1.06, -2.4); solid(0, -2.4, 4.3, 1);
    npcs.push({ x: ox + .6, z: oz - 3.4, yaw: 0, female: rng() < .5, wave: false });
    spots.push({ x: ox, z: oz - 1.5, kind: 'shop' });
    const goodsCols = [0xe8452c, 0xf2c230, 0x2e7fd0, 0x1f9a5a, 0xf4f0e6, 0x7b3f8c];
    const shelfRow = (x, z, ry) => { box(.6, 2.2, 3.6, 0xb8946a, x, 1.1, z, ry); for (let s = 0; s < 3; s++) for (let k = 0; k < 6; k++) box(.3, .32, .4, pick(goodsCols), x + (ry ? (k - 2.5) * .55 : .05), .5 + s * .65, z + (ry ? .05 : (k - 2.5) * .55), ry); solid(x, z, ry ? 3.6 : .6, ry ? .6 : 3.6, 2.2); };
    if (nm.includes('bakery')) { shelfRow(-5.4, 0, 0); shelfRow(5.4, 0, 0); for (let k = 0; k < 8; k++) B.add(CAP, 0xc98a4a, ox - 1.6 + k * .45, 1.2, oz - 2.4, 0, .12, .25, .12, 0, Math.PI / 2); }
    else if (nm.includes('salon') || nm.includes('barbing')) { for (let k = -1; k <= 1; k++) { chair(k * 3, 1, Math.PI, 0x2b2b2b); box(1.4, 1.6, .05, 0xa9c6dd, k * 3, 1.9, -D / 2 + .05); } }
    else if (nm.includes('kitchen') || nm.includes('zobo') || nm.includes('kilishi')) { [[-3.5, 1], [3.5, 1]].forEach(([x, z]) => { box(1.4, .08, 1.4, 0xd8d0c2, x, .75, z); box(.1, .75, .1, 0x555555, x, .37, z); solid(x, z, 1.4, 1.4, 1); chair(x - 1.1, z, Math.PI / 2); chair(x + 1.1, z, -Math.PI / 2); }); }
    else if (nm.includes('phones') || nm.includes('electronics') || nm.includes('pos')) { [-3.5, 3.5].forEach(x => { box(2.4, .9, 1.2, 0xe9e4d8, x, .45, 1); solid(x, 1, 2.4, 1.2, 1); for (let k = 0; k < 4; k++) box(.25, .02, .45, 0x1a1a1a, x - .9 + k * .6, .92, 1); }); shelfRow(-5.4, -1, 0); }
    else { shelfRow(-5.4, 0, 0); shelfRow(5.4, 0, 0); shelfRow(0, 1.5, Math.PI / 2); }
    box(1, 2, .8, 0xf4f4f4, 5, 1, -3.8); box(.8, 1.6, .02, 0x9fc3d8, 5, 1.1, -3.39); solid(5, -3.8, 1, .8);
  } else if (door.kind === 'house') {
    W = 16; D = 11; wallMat = new THREE.MeshLambertMaterial({ color: door.paint || 0xf2e3c6 });
    shell(W, D, H, 0, 0xc9a77a, wallMat); name = 'House';
    var floorMat = new THREE.MeshLambertMaterial({ color: 0xc9a77a });
    const fl = new THREE.Mesh(new THREE.BoxGeometry(W, .02, D), floorMat); fl.position.set(ox, .005, oz); fl.receiveShadow = true; g.add(fl);
    // bedroom partition and the kitchen counter stay put; everything else is furniture (house.js)
    box(.25, H, 6.5, 0xf6f0e4, 3, H / 2, -2.25); solid(3, -2.25, .25, 6.5, H);
    box(2.2, .95, .7, 0xe9e4d8, -1.1 - 4.6, .47, -4.85); box(.5, .1, .4, 0xb8bcbe, -5.4, .97, -4.85); solid(-5.7, -4.85, 2.2, .7);
  } else if (door.kind === 'lobby') {
    W = 18; D = 12; shell(W, D, H, 0xece8df, 0xe2dccd);
    wallSign(door.name, '#16213a', '#f2c230', 0, 2.3, -D / 2 + .02, 4);
    box(5, 1.1, 1.2, 0x2f3f4a, 0, .55, -3); box(5.1, .08, 1.3, 0xd8d0c2, 0, 1.12, -3); solid(0, -3, 5.1, 1.3);
    npcs.push({ x: ox, z: oz - 4.1, yaw: 0, female: rng() < .6, wave: false });
    spots.push({ x: ox, z: oz - 2, kind: 'work' });
    [-6, 6].forEach(x => { box(2.4, .45, .9, 0x2e5fa8, x, .3, 2); box(2.4, .7, .2, 0x2e5fa8, x, .65, 2.4); solid(x, 2.1, 2.4, 1.1, .9); seat(x - .6, 1.95, Math.PI); seat(x + .6, 1.95, Math.PI); });
    [-8, 8].forEach(x => { B.add(CYL, 0xd9d4c7, ox + x, .4, oz - 5, 0, .45, .8, .45); B.add(SPH, 0x3f8a4f, ox + x, 1.4, oz - 5, 0, .6, .9, .6); circles.push({ x: ox + x, z: oz - 5, r: .5 }); });
    [-5, 5].forEach(x => { box(1.8, 2.4, .1, 0xb8bcbe, x, 1.2, -D / 2 + .06); box(.04, 2.4, .12, 0x666666, x, 1.2, -D / 2 + .07); });
    wallSign('LIFTS', '#ffffff', '#16213a', -5, 2.75, -D / 2 + .03, 1); wallSign('LIFTS', '#ffffff', '#16213a', 5, 2.75, -D / 2 + .03, 1);
  } else if (door.kind === 'terminal') {
    W = 30; D = 18; H = 3.4; name = door.name;
    shell(W, D, H, 0xeef1f3, 0xd9dcde);
    // check-in counters with agents
    [-9, -3, 3].forEach((x, i) => { box(4.4, 1.1, 1, 0x16213a, x, .55, -4.5); box(4.5, .08, 1.1, 0xd8d0c2, x, 1.12, -4.5); solid(x, -4.5, 4.5, 1.1); npcs.push({ x: ox + x, z: oz - 5.6, yaw: 0, female: i !== 1 }); wallSign(['NAIJA AIR', 'CHECK-IN', 'TICKETS'][i], '#1d8a4a', '#ffffff', x, 2.4, -D / 2 + .02, 3.2); });
    spots.push({ x: ox - 3, z: oz - 3.4, kind: 'ticket', label: 'Book a flight at the counter' });
    // departures board
    const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.2), new THREE.MeshBasicMaterial({ map: canvasTex(600, 220, c => { c.fillStyle = '#111'; c.fillRect(0, 0, 600, 220); c.fillStyle = '#f2c230'; c.font = '700 26px monospace'; c.fillText('DEPARTURES', 20, 36); c.font = '600 22px monospace'; [['NA 101', door.airport === 'uyo' ? 'ABUJA' : 'UYO', 'BOARDING'], ['NA 207', 'LAGOS', 'DELAYED'], ['NA 312', 'KANO', 'CANCELLED']].forEach((r, i) => { c.fillStyle = i ? '#cfcfcf' : '#3ddc84'; c.fillText(r.join('   '), 20, 84 + i * 44); }); }, false) }));
    board.position.set(ox + 9, 2.3, oz - D / 2 + .03); g.add(board);
    // seats
    for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) { const x = -12 + k * 1, z = 1 + r * 2.4; box(.8, .1, .7, 0x2e5fa8, x, .45, z); box(.8, .6, .08, 0x2e5fa8, x, .75, z + .32); seat(x, z, Math.PI); }
    solid(-9.5, 3.4, 6.4, 5.6, 1);
    // food kiosk
    box(3, 1.1, 1.2, 0xc9472f, 10, .55, 3); solid(10, 3, 3, 1.2); npcs.push({ x: ox + 10, z: oz + 2, yaw: Math.PI, female: true });
    spots.push({ x: ox + 10, z: oz + 4.4, kind: 'shop', cat: 'food' });
    // boarding gate in the back wall
    box(2.6, 2.5, .1, 0x2f4656, 12, 1.25, -D / 2 + .06); wallSign('GATE 1', '#f2c230', '#16213a', 12, 2.75, -D / 2 + .03, 2);
    spots.push({ x: ox + 12, z: oz - D / 2 + 1.4, kind: 'gate', label: 'Go to the boarding gate' });
  } else if (door.kind === 'assembly') {
    W = 40; D = 34; H = 3.4; name = 'House of Assembly';
    shell(W, D, H, 0xf3ece0, 0x1f6e45);
    // gold trim band and the coat-of-arms banner behind the speaker
    box(W, .25, .1, 0xd9a936, 0, 3.1, -D / 2 + .05); box(.1, .25, D, 0xd9a936, -W / 2 + .05, 3.1, 0); box(.1, .25, D, 0xd9a936, W / 2 - .05, 3.1, 0);
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.4), new THREE.MeshLambertMaterial({ map: canvasTex(600, 204, (c) => { c.fillStyle = '#1d8a4a'; c.fillRect(0, 0, 200, 204); c.fillStyle = '#ffffff'; c.fillRect(200, 0, 200, 204); c.fillStyle = '#1d8a4a'; c.fillRect(400, 0, 200, 204); c.fillStyle = '#1d3b2a'; c.textAlign = 'center'; c.font = '700 30px "Fredoka", system-ui, sans-serif'; c.fillText('HOUSE OF', 300, 92); c.fillText('ASSEMBLY', 300, 128); }, false) }));
    ban.position.set(ox, 2.6, oz - D / 2 + .06); ban.scale.setScalar(.45); g.add(ban);
    // speaker's dais, chair and the clerk's table with the mace
    box(9, 1.2, 4, 0x5a3e2b, 0, .6, -14.5); box(9.2, .08, 4.2, 0xd9a936, 0, 1.22, -14.5); solid(0, -14.5, 9.2, 4.2, 1.3);
    box(1.4, 1.9, .3, 0x1d6e45, 0, 2.15, -15.9); box(1.3, .3, 1.1, 0x1d6e45, 0, 1.6, -15.4);
    box(5, .9, 1.6, 0x6e543b, 0, .45, -10.5); solid(0, -10.5, 5, 1.6, 1);
    B.add(CYL, 0xd9a936, ox, 1.05, oz - 10.5, 0, .08, 1.8, .08, 0, Math.PI / 2); B.add(SPH, 0xd9a936, ox - .95, 1.05, oz - 10.5, 0, .18, .18, .18); B.add(SPH, 0xd9a936, ox + .95, 1.05, oz - 10.5, 0, .25, .25, .25);
    // curved rows of green seats with desks, facing the speaker
    let n = 0;
    for (let row = 0; row < 5; row++) {
      const r = 9 + row * 2.6, count = 9 + row * 2;
      for (let k = 0; k < count; k++) {
        const a = -1.15 + 2.3 * k / (count - 1), x = Math.sin(a) * r, z = -12 + Math.cos(a) * r, yaw = a + Math.PI;
        if (Math.abs(x) < 1.6) continue; // centre aisle
        box(.62, .1, .62, 0x2f8f5b, x, .48, z, yaw); box(.62, .8, .1, 0x2f8f5b, x + Math.sin(a) * .3, .9, z + Math.cos(a) * .3, yaw);
        box(.9, .08, .35, 0x6e543b, x - Math.sin(a) * .55, .78, z - Math.cos(a) * .55, yaw);
        seat(x, z, yaw); n++;
      }
      // a low wooden rail behind each row
      for (let k = 0; k < 30; k++) { const a = -1.2 + 2.4 * k / 29, rr = r + .75; if (Math.abs(Math.sin(a) * rr) < 1.7) continue; box(.95, .5, .08, 0x5a3e2b, Math.sin(a) * rr, .25, -12 + Math.cos(a) * rr, a); }
    }
    // public gallery along the back wall
    [-10.5, 10.5].forEach(x => { box(17, 2.5, 3, 0x6e543b, x, 1.25, D / 2 - 3.5); box(17, .6, .15, 0xd9a936, x, 2.8, D / 2 - 5); }); solid(-10.5, D / 2 - 3.5, 17, 3, 3); solid(10.5, D / 2 - 3.5, 17, 3, 3);
    for (let k = 0; k < 14; k++) { const x = -18 + k * 2.6 + (k > 6 ? 1.4 : 0); if (Math.abs(x) < 2) continue; box(.6, .1, .6, 0x2f8f5b, x, 2.98, D / 2 - 3.2); }
    // members already seated
    for (let k = 0; k < 18; k++) { const s = seats[(k * 5 + 3) % seats.length]; npcs.push({ x: s.x, z: s.z, yaw: s.yaw, female: rng() < .3, sit: true, seatIdx: (k * 5 + 3) % seats.length }); }
    npcs.push({ x: ox, z: oz - 15.2, y: 1.2, yaw: 0, female: false, sit: true, speaker: true });
  }
  else if (CIVIC[door.kind]) {
    const c = CIVIC[door.kind]; W = c.w; D = c.d; H = 3.2; name = door.name;
    shell(W, D, H, c.wall, c.floor);
    wallSign(door.name.toUpperCase().slice(0, 28), c.signBg, '#ffffff', 0, 2.5, -D / 2 + .02, Math.min(7, W * .4));
    const role = (id, x, z, label) => spots.push({ x: ox + x, z: oz + z, kind: 'role', id, label });
    const desk = (x, z, staff = true) => { box(3.2, 1, 1, 0x6e543b, x, .5, z); box(3.3, .06, 1.1, 0xd8d0c2, x, 1.02, z); solid(x, z, 3.3, 1.1, 1); if (staff) npcs.push({ x: ox + x, z: oz + z - 1.1, yaw: 0, female: rng() < .5 }); };
    const bed = (x, z) => { box(1.1, .55, 2.1, 0xf4f4f4, x, .3, z); box(1.1, .2, .5, 0xa9c6dd, x, .65, z - .7); solid(x, z, 1.1, 2.1, .7); beds.push({ x: ox + x, z: oz + z, yaw: 0, ward: true }); };
    const sofa = (x, z, yaw, col = 0x2f6f4f) => { box(2.6, .5, .9, col, x, .3, z, yaw); box(2.6, .7, .2, col, x - Math.sin(yaw) * .4, .65, z - Math.cos(yaw) * .4, yaw); solid(x, z, Math.abs(Math.sin(yaw)) > .5 ? .9 : 2.6, Math.abs(Math.sin(yaw)) > .5 ? 2.6 : .9, .9); seat(x, z, yaw); };
    if (door.kind === 'hospital') { desk(0, -3); role('clinic', 0, -1.6, 'See a doctor'); for (let k = 0; k < 4; k++) { bed(-7 + k * 1.8, 2.5); } [5, 7].forEach(x => bed(x, 2.5)); box(.1, 2.2, 3, 0xbfe0d8, 2, 1.1, 2.5); }
    else if (door.kind === 'school') { box(6, 1.8, .08, 0x1f3b2a, 0, 1.6, -D / 2 + .08); desk(0, -3); for (let r = 0; r < 3; r++) for (let k = -2; k <= 2; k++) { box(1.1, .06, .6, 0x8a6a4e, k * 2.2, .72, r * 1.8); chair(k * 2.2, r * 1.8 + .6, Math.PI); if (rng() < .5) npcs.push({ x: ox + k * 2.2, z: oz + r * 1.8 + .6, yaw: Math.PI, female: rng() < .5, sit: true, seatIdx: seats.length - 1 }); } role('class', 0, -1.6, 'Take a class'); }
    else if (door.kind === 'cinema') {
      const scr = canvasTex(512, 256, c2 => { const gr = c2.createLinearGradient(0, 0, 512, 256); gr.addColorStop(0, '#f2c230'); gr.addColorStop(.5, '#c9472f'); gr.addColorStop(1, '#16213a'); c2.fillStyle = gr; c2.fillRect(0, 0, 512, 256); c2.fillStyle = '#fff'; c2.textAlign = 'center'; c2.font = '700 38px "Fredoka", system-ui, sans-serif'; c2.fillText('NOW SHOWING', 256, 100); c2.font = '600 30px "Fredoka", system-ui, sans-serif'; c2.fillText('Lagos to Abuja: The Journey', 256, 150); }, false);
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(W - 4, 4.2), new THREE.MeshBasicMaterial({ map: scr })); sm.position.set(ox, 2.1, oz - D / 2 + .1); g.add(sm);
      for (let r = 0; r < 5; r++) for (let k = -5; k <= 5; k++) { if (k === 0) continue; const x = k * 1.1, z = -3.6 + r * 1.5, y = r * .18; box(.8, .12 + y, .7, 0x8a1f24, x, .3 + y / 2, z); box(.8, .7, .1, 0x8a1f24, x, .8 + y, z + .35); seat(x, z, Math.PI, y); }
      box(W, .02, D, 0x1c1418, 0, .01, 0); desk(W / 2 - 3, D / 2 - 2.6); role('movie', W / 2 - 3, D / 2 - 1.4, 'Buy a movie ticket');
      spots.push({ x: ox - W / 2 + 3, z: oz + D / 2 - 1.4, kind: 'shop', cat: 'food' }); box(2.4, 1, .9, 0xc9472f, -W / 2 + 3, .5, D / 2 - 2.4); solid(-W / 2 + 3, D / 2 - 2.4, 2.4, .9, 1);
    }
    else if (door.kind === 'bank') { [-5, 0, 5].forEach(x => { desk(x, -3); box(3, 1.3, .05, 0xa9c6dd, x, 1.7, -3.5); }); role('teller', -5, -1.6, ''); role('bank', 5, -1.6, ''); box(2.4, 2.4, .2, 0x8e9196, 7.5, 1.2, -D / 2 + .2); [-4, 4].forEach(x => sofa(x, 3, Math.PI, 0x16213a)); }
    else if (door.kind === 'club') { box(6, 1.1, 1, 0x3a2a1c, 0, .55, -3.6); box(6.1, .08, 1.1, 0xd9a936, 0, 1.12, -3.6); solid(0, -3.6, 6.1, 1.1, 1.2); npcs.push({ x: ox, z: oz - 4.5, yaw: 0, female: false }); spots.push({ x: ox, z: oz - 2.4, kind: 'shop', cat: 'food' }); [[-6, 1, Math.PI / 2], [6, 1, -Math.PI / 2], [-3, 3.5, Math.PI], [3, 3.5, Math.PI]].forEach(([x, z, y]) => sofa(x, z, y, 0x5a3e2b)); role('club', 6, -2.5, ''); npcs.push({ x: ox - 3, z: oz + 1.6, yaw: Math.PI, female: true }, { x: ox + 3.6, z: oz + 1.4, yaw: Math.PI, female: false }); }
    else if (door.kind === 'council') { desk(-5, -3); desk(5, -3); role('tender', 5, -1.6, ''); role('runz', -5, -1.6, ''); for (let k = 0; k < 6; k++) chair(-6 + k * 2.4, 3, Math.PI, 0x2e5fa8); box(1.6, 2, .5, 0x9aa1a6, -9, 1, 1); }
    else if (door.kind === 'inec') { desk(0, -3); role('contest', 0, -1.6, ''); [-6, 6].forEach(x => { box(1.2, 1.4, .8, 0x1d8a4a, x, .7, -1); box(1, .5, .7, 0xf4f4f4, x, 1.6, -1); solid(x, -1, 1.2, .8, 1.8); }); wallSign('VOTE WISELY', '#1d8a4a', '#ffffff', 6, 2.6, -D / 2 + .03, 2.4); }
    else if (door.kind === 'hub') { for (let r = 0; r < 2; r++) for (let k = -2; k <= 2; k++) { const x = k * 3, z = -2 + r * 3.4; box(2.4, .06, 1, 0xf4f4f4, x, .74, z); box(.6, .02, .4, 0x9aa1a6, x - .4, .78, z); box(.6, .4, .03, 0x1a1a1a, x - .4, .98, z - .2); chair(x, z + .8, Math.PI, 0x2b2b2b); if (rng() < .6) npcs.push({ x: ox + x, z: oz + z + .8, yaw: Math.PI, female: rng() < .4, sit: true, seatIdx: seats.length - 1 }); } role('techjob', 0, 3.6, ''); }
    else if (G.buildFloor?.(door, { ox, oz, W, D, box, solid, spots, npcs, wallSign, g })) { /* a work floor */ }
    else if (door.kind === 'dispatch') { desk(0, -2.5); role('dispatch', 0, -1.1, ''); for (let k = 0; k < 6; k++) box(.7, .5, .6, 0xb8946a, -5 + (k % 3) * .8, .25 + ((k / 3) | 0) * .5, -3); }
    else if (door.kind === 'agency') { desk(0, -2); role('agent', 0, -.6, ''); wallSign('TO LET · FOR SALE', '#3f5f7f', '#ffffff', -4, 2.4, -D / 2 + .03, 2.6); sofa(-3, 2.5, Math.PI); }
    else if (door.kind === 'hotel') {
      desk(-5, -3.6); role('room', -5, -2.2, '');
      box(.1, .06, .1, 0xd9a936, -3.6, 1.06, -3.6);
      [[-7, 3], [-3.5, 3]].forEach(([x, z]) => sofa(x, z, Math.PI, 0x7b2d8e));
      for (let k = 0; k < 3; k++) { const x = 3 + k * 2.8; box(1.4, .06, 1.4, 0xf4f4f4, x, .75, 1); box(.1, .75, .1, 0x555555, x, .37, 1); solid(x, 1, 1.4, 1.4, 1); chair(x - 1, 1, Math.PI / 2); chair(x + 1, 1, -Math.PI / 2); }
      box(5, 1.1, .9, 0x3a2a1c, 6, .55, -4); solid(6, -4, 5, .9, 1.2); npcs.push({ x: ox + 6, z: oz - 4.9, yaw: 0, female: true }); spots.push({ x: ox + 6, z: oz - 2.8, kind: 'shop', cat: 'restaurant', label: 'Order food at the hotel restaurant' });
      wallSign('RESTAURANT', '#16213a', '#f2c230', 6, 2.4, -D / 2 + .03, 3);
      box(1.6, 2.4, .1, 0xb8bcbe, -9, 1.2, -D / 2 + .06); wallSign('LIFTS', '#ffffff', '#16213a', -9, 2.75, -D / 2 + .03, 1);
    }
    else if (door.kind === 'restaurant') {
      box(5, 1.1, .9, 0x6e543b, 0, .55, -3.8); solid(0, -3.8, 5, .9, 1.2); npcs.push({ x: ox, z: oz - 4.7, yaw: 0, female: true }); spots.push({ x: ox, z: oz - 2.6, kind: 'shop', cat: 'restaurant', label: 'Order food (eat right away or take away)' });
      for (let r = 0; r < 2; r++) for (let k = -1; k <= 1; k++) { const x = k * 4.5, z = .5 + r * 3; box(1.4, .06, 1.4, 0xf4ede0, x, .75, z); box(.1, .75, .1, 0x555555, x, .37, z); solid(x, z, 1.4, 1.4, 1); chair(x - 1, z, Math.PI / 2); chair(x + 1, z, -Math.PI / 2); if (rng() < .5) npcs.push({ x: ox + x + 1, z: oz + z, yaw: -Math.PI / 2, female: rng() < .5, sit: true, seatIdx: seats.length - 1 }); }
    }
    else if (door.kind === 'bar') {
      box(6, 1.1, 1, 0x3a2a1c, 0, .55, -3.6); box(6.1, .08, 1.1, 0xe8b23a, 0, 1.12, -3.6); solid(0, -3.6, 6.1, 1.1, 1.2);
      for (let k = 0; k < 8; k++) box(.18, .5, .18, [0x2f8f5b, 0x8a1f24, 0xe8b23a][k % 3], -2.6 + k * .75, 1.9, -D / 2 + .3);
      npcs.push({ x: ox, z: oz - 4.5, yaw: 0, female: false }); spots.push({ x: ox, z: oz - 2.4, kind: 'shop', cat: 'bar', label: 'Order a drink' });
      [[-5, 1.5], [5, 1.5]].forEach(([x, z]) => { box(1.2, .06, 1.2, 0x6e543b, x, .75, z); solid(x, z, 1.2, 1.2, 1); chair(x - .9, z, Math.PI / 2, 0x2b2b2b); chair(x + .9, z, -Math.PI / 2, 0x2b2b2b); npcs.push({ x: ox + x + .9, z: oz + z, yaw: -Math.PI / 2, female: rng() < .3, sit: true, seatIdx: seats.length - 1 }); });
      role('hangout', -5, 3.6, ''); box(1, .06, 1, 0xf4f0e6, -5, .76, 1.5);
    }
    else if (door.kind === 'nightclub') {
      const floor = canvasTex(256, 256, c2 => { for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { c2.fillStyle = ['#a855f7', '#f2c230', '#2e5fa8', '#e0245e', '#3ddc84'][(i * 3 + j * 7) % 5]; c2.fillRect(i * 32 + 2, j * 32 + 2, 28, 28); } }, false);
      const df = new THREE.Mesh(new THREE.PlaneGeometry(8, 7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: floor })); df.position.set(ox, .02, oz - .5); g.add(df);
      box(5, 1.3, 1.6, 0x111111, 0, .65, -D / 2 + 1.4); solid(0, -D / 2 + 1.4, 5, 1.6, 1.4); npcs.push({ x: ox, z: oz - D / 2 + .5, yaw: 0, female: false });
      [-2, 2].forEach(x => box(1.2, 2.2, 1, 0x222222, x * 1.8, 1.1, -D / 2 + .6));
      box(5, 1.1, 1, 0x2b2b2b, -7, .55, 3); solid(-7, 3, 5, 1, 1.2); spots.push({ x: ox - 7, z: oz + 4.4, kind: 'shop', cat: 'bar', label: 'Order a drink' });
      role('dance', 0, 1.5, '');
      for (let k = 0; k < 7; k++) npcs.push({ x: ox + (rng() - .5) * 6, z: oz - 1 + (rng() - .5) * 4, yaw: rng() * 6, female: rng() < .5, dance: true });
    }
    else if (door.kind === 'gym') {
      for (let k = 0; k < 3; k++) { const x = -6 + k * 3; box(.8, .3, 2, 0x222222, x, .4, -2); box(.9, 1.2, .2, 0x444444, x, 1, -3); solid(x, -2.3, .9, 2.4, 1.2); }
      [3, 6].forEach(x => { box(2, .1, .6, 0x333333, x, .5, 1); box(.08, .08, 2.2, 0xb8bcbe, x, 1.1, 1, Math.PI / 2); solid(x, 1, 2, .6, 1); });
      box(8, 2.2, .05, 0xa9c6dd, 2, 1.4, -D / 2 + .06);
      role('workout', 0, 2.5, ''); npcs.push({ x: ox - 3, z: oz - 2, yaw: 0, female: rng() < .5 });
    }
    else if (door.kind === 'villa') {
      box(W - .4, .03, D - .4, door.role === 'president' ? 0x6e1f24 : 0x1f3b5a, 0, .02, 0); // carpet
      box(4, 1, 1.6, 0x3a2a1c, 0, .5, -D / 2 + 2.6); box(4.1, .06, 1.7, 0xd9a936, 0, 1.02, -D / 2 + 2.6); solid(0, -D / 2 + 2.6, 4.1, 1.7, 1.1);
      box(1, 1.6, .9, 0x2f6f4f, 0, .8, -D / 2 + 1.3); seat(0, -D / 2 + 1.4, 0);
      role('office', 0, -D / 2 + 4.2, '');
      for (let k = -1; k <= 1; k++) { B.add(CYL, 0xdedede, ox + 2.6 + k * .6, 1.2, oz - D / 2 + .8, 0, .04, 2.4, .04); box(.02, .5, .9, k ? 0x1d8a4a : 0xffffff, 2.6 + k * .6, 2.1, -D / 2 + 1.3); }
      [[-6, 0, Math.PI / 2], [6, 0, -Math.PI / 2], [0, 3, Math.PI]].forEach(([x, z, y]) => sofa(x, z, y, 0xd9c08a));
      box(2.4, .5, 2.4, 0x6e543b, 0, .25, 0); solid(0, 0, 2.4, 2.4, .6);
      bed(W / 2 - 2, -D / 2 + 2); beds[beds.length - 1].ward = false;
      wallSign(door.role === 'president' ? 'OFFICE OF THE PRESIDENT' : 'OFFICE OF THE VICE PRESIDENT', '#1d4d33', '#f2c230', -5, 2.5, -D / 2 + .03, 4);
      [-W / 2 + 1, W / 2 - 1].forEach(x => npcs.push({ x: ox + x, z: oz + D / 2 - 1.5, yaw: Math.PI, female: false, guard: true }));
    }
  }
  g.add(B.build(mat));
  return { group: g, boxes, circles, seats, beds, uses: [], spots, npcs, wallMat, floorMat: typeof floorMat !== 'undefined' ? floorMat : null, name, slot, door,
    spawn: { x: ox, z: oz + D / 2 - 2.7, yaw: Math.PI }, exit: { x: ox, z: oz + D / 2 - .8 }, bounds: { minX: ox - W / 2, maxX: ox + W / 2, minZ: oz - D / 2, maxZ: oz + D / 2 } };
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { rand, pick } from './util.js';
import { SKIN, BRIGHT, makePerson, animatePerson, ankara } from './people.js';

/* Quaternius "Animated Men" (CC0): four outfits sharing one skeleton and one set of clips */
export const MEN = ['casual', 'longsleeve', 'shirt', 'suit'];
const lib = { ready: false, tpl: {}, clips: [] };
const SCALE = 1.74 / 4.84;

function b64ToBuffer(b64) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
export async function loadMen() {
  const loader = new GLTFLoader();
  const { MODELS } = await import('./models_data.js');
  const files = await Promise.all(MEN.map(n => loader.parseAsync(b64ToBuffer(MODELS[n]), '')));
  files.forEach((g, i) => {
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    lib.tpl[MEN[i]] = g.scene;
    if (g.animations.length) lib.clips = g.animations;
  });
  lib.ready = true;
  return lib;
}
export const menReady = () => lib.ready;

const matCache = new Map();
function lambert(hex) { if (!matCache.has(hex)) matCache.set(hex, new THREE.MeshLambertMaterial({ color: hex, flatShading: true })); return matCache.get(hex); }

const HAIR = 0x151010;
/* colours for each material slot, by name */
export function manPalette(o = {}) {
  return {
    Skin: o.skin ?? pick(SKIN), Hair: HAIR, Hair2: HAIR, Eyes: 0x111111,
    Shirt: o.shirt ?? pick(BRIGHT), Shirt2: o.shirt2 ?? pick([0xf1ece0, 0x2b2b2b, 0xe8b23a]),
    Pants: o.pants ?? pick([0x2b2b2b, 0x3c5a7a, 0x5d4a3a, 0xd9d0bd, 0x2f3f2f]),
    Socks: 0xf1f1f1, Shoes: 0x222222, Details: o.details ?? 0xf1ece0, TieTexture: o.tie ?? pick([0x1f7a5c, 0xb3202a, 0x2e5fa8]),
  };
}

/* A character that plays clips: idle / walk / run / jump (+ extras for vendors) */
export class Man {
  constructor(kind = pick(MEN), palette = manPalette(), hat = null) {
    this.root = new THREE.Group();
    const m = SkeletonUtils.clone(lib.tpl[kind]);
    m.scale.setScalar(SCALE);
    m.traverse(o => { if (o.isMesh) { const mm = [].concat(o.material).map(x => lambert(palette[x.name] ?? x.color.getHex())); o.material = mm.length > 1 ? mm : mm[0]; } });
    this.root.add(m); this.model = m;
    this.mixer = new THREE.AnimationMixer(m);
    this.actions = {};
    for (const c of lib.clips) this.actions[c.name] = this.mixer.clipAction(c);
    if (this.actions.Jump) { this.actions.Jump.setLoop(THREE.LoopOnce); this.actions.Jump.clampWhenFinished = true; }
    this.state = null; this.play('Idle', 0);
    this.mixer.update(rand() * 3);
    if (hat) this.addHat(hat);
  }
  addHat({ type, color, print }) {
    let head; this.model.traverse(o => { if (o.isBone && /head/i.test(o.name) && !head) head = o; });
    if (!head) return;
    const g = new THREE.Group(), mat = print ? new THREE.MeshLambertMaterial({ map: print, flatShading: true }) : lambert(color);
    if (type === 'fila') { const f = new THREE.Mesh(new THREE.CylinderGeometry(.38, .4, .36, 10), mat); f.rotation.z = -.15; g.add(f); }
    if (type === 'cap') {
      g.add(new THREE.Mesh(new THREE.SphereGeometry(.4, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat));
      const brim = new THREE.Mesh(new THREE.BoxGeometry(.62, .05, .42), mat); brim.position.set(0, .02, .42); g.add(brim);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // head bone space is in the model's original units (about 2.8x our metres)
    g.position.set(0, type === 'fila' ? .0052 : .0044, .0004); g.scale.setScalar(.0105);
    head.add(g); this.hat = g;
  }
  play(name, fade = .25) {
    if (this.state === name || !this.actions[name]) return;
    const next = this.actions[name], prev = this.actions[this.state];
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    this.state = name;
  }
  update(dt, speed, opts = {}) {
    if (opts.sit) this.play('Sitting', .35);
    else if (opts.air) this.play('Jump', .12);
    else if (opts.anim) this.play(opts.anim, .4);
    else if (speed > 6.8) { this.play('Run'); this.actions.Run.timeScale = Math.min(1.6, speed / 7); }
    else if (speed > .25) { this.play('Walk'); this.actions.Walk.timeScale = Math.min(2, Math.max(.6, speed / 2.4)); }
    else this.play('Idle', .35);
    this.mixer.update(dt);
  }
}

/* Procedural fallback / women, wrapped with the same interface */
export class Proc {
  constructor(opts) { this.root = makePerson(opts); this.root.scale.x *= .86; this.root.scale.z *= .86; this.t = rand() * 10; }
  update(dt, speed, opts = {}) { this.t += dt; animatePerson(this.root, dt, speed, this.t, { air: opts.air, sit: opts.sit, wave: opts.anim === 'Clapping' }); }
}

export function randomCharacter(female = rand() < .45) {
  if (female || !lib.ready) {
    const printed = rand() < .55;
    if (female) return new Proc({ outfit: rand() < .75 ? 'gown' : 'shirt', print: printed ? ankara() : null, head: rand() < .65 ? 'gele' : (rand() < .5 ? 'afro' : 'hair'), scale: .95 + rand() * .05 });
    return new Proc({ outfit: rand() < .35 ? 'kaftan' : 'shirt', head: pick(['hair', 'cap', 'fila']) });
  }
  const kind = pick(['casual', 'casual', 'longsleeve', 'shirt', 'shirt', 'suit']);
  const r = rand(), hat = r < .2 ? { type: 'fila', color: pick([0xf1ece0, 0x7b3f8c, 0x1f7a5c, 0xc9472f]) } : r < .32 ? { type: 'cap', color: pick(BRIGHT) } : null;
  return new Man(kind, manPalette(), hat);
}

/* player choices */
const hatOf = (o, d) => o.hat === 'none' ? null : o.hat ? { type: o.hat, color: o.hatColor ?? 0xf1ece0 } : d;
export const LOOKS = [
  { id: 'tunde', name: 'Tunde', desc: 'Casual, cap', make: (o = {}) => lib.ready ? new Man('casual', manPalette({ skin: 0x6b4430, shirt: o.shirt ?? 0xe8b23a, pants: o.pants ?? 0x3c5a7a }), hatOf(o, { type: 'cap', color: 0x1d3557 })) : new Proc({ skin: 0x6b4430, outfit: 'shirt', top: o.shirt, print: o.shirt ? null : ankara(0), bottom: o.pants ?? 0x3c5a7a, head: o.hat === 'none' ? 'hair' : (o.hat || 'cap'), headColor: o.hatColor ?? 0x1d3557 }) },
  { id: 'amina', name: 'Amina', desc: 'Gown and gele', make: (o = {}) => new Proc({ skin: 0x7a4e33, outfit: 'gown', top: o.shirt, print: o.shirt ? null : ankara(3), head: o.hat === 'none' ? 'hair' : 'gele', headColor: o.hatColor ?? 0xe8b23a, shoes: 0x6b4a33 }) },
  { id: 'emeka', name: 'Emeka', desc: 'Long sleeve, fila', make: (o = {}) => lib.ready ? new Man('longsleeve', manPalette({ skin: 0x5b3824, shirt: o.shirt ?? 0x1f7a5c, pants: o.pants ?? 0x1f7a5c }), hatOf(o, { type: 'fila', color: 0xf1ece0 })) : new Proc({ skin: 0x5b3824, outfit: 'kaftan', top: o.shirt ?? 0x1f7a5c, bottom: o.pants ?? 0x1f7a5c, head: o.hat === 'none' ? 'hair' : (o.hat || 'fila'), headColor: o.hatColor ?? 0xf1ece0, longSleeve: true }) },
  { id: 'chief', name: 'Chief', desc: 'Sharp suit', make: (o = {}) => lib.ready ? new Man('suit', manPalette({ skin: 0x4b2e1e, tie: 0x1f7a5c, shirt: o.shirt ?? 0x111111, pants: o.pants ?? 0x111111 }), hatOf(o, null)) : new Proc({ skin: 0x4b2e1e, outfit: 'shirt', top: o.shirt ?? 0x2b2b2b, bottom: o.pants ?? 0x2b2b2b, head: 'hair', longSleeve: true }) },
];

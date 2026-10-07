// City layout: a 5 x 5 grid of roads, 64 units apart, with a roundabout at the centre.
export const S = 64;            // road spacing
export const N = 2;             // road indices run -N..N
export const EDGE = S * N;      // outermost road centre line (128)
export const HALF = 8;          // half road width (dual carriageway)
export const LANES = [3, 6];    // lane centre offsets from the road centre line
export const CURB = .18;        // sidewalk height
export const RB_LANE = 19.5;    // roundabout driving radius
export const RB_ISLAND = 13;    // roundabout island radius
export const RB_CUT = 28;       // blocks are cut back this far from the centre
export const BOUND = 430;       // how far the player may walk
import { DISTRICTS, FLAT_SEGS, segDist } from './world.js';
// flat ground outside the grid for the motor park, fire and police stations, the car dealer and the highway
export const PADS = [
  { id: 'motorpark', x: -178, z: 0, w: 52, d: 64 },
  { id: 'services', x: 178, z: 0, w: 52, d: 84 },
  { id: 'dealer', x: 0, z: 180, w: 84, d: 52 },
  { id: 'highway', x: 0, z: -190, w: 24, d: 84 },
  ...DISTRICTS.filter(d => !d.grid).map(d => ({ id: d.id, x: d.x, z: d.z, w: d.w, d: d.d })),
];
export function padFactor(x, z) {
  let k = 1;
  for (const p of PADS) { const dx = Math.max(0, Math.abs(x - p.x) - p.w / 2), dz = Math.max(0, Math.abs(z - p.z) - p.d / 2), d = Math.hypot(dx, dz); const t = Math.min(1, d / 20); k = Math.min(k, t * t * (3 - 2 * t)); }
  // roads across open ground
  if (Math.max(Math.abs(x), Math.abs(z)) > 128) for (const [ax, az, bx, bz, r] of FLAT_SEGS) { const d = segDist(x, z, ax, az, bx, bz).d - r; if (d < 14) { const t = Math.max(0, d / 14); k = Math.min(k, t * t * (3 - 2 * t)); } }
  if (Math.abs(x) < 9 && z < -130) k = 0;
  return k;
}

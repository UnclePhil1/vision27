/* Shared map data: districts and named roads. Used to flatten the ground, build the new
   areas, draw the map and plan GPS routes. Junctions must be listed as points on every road
   that meets there, so the route planner can join them. */

export const DISTRICTS = [
  { id: 'cbd', name: 'Central Area', x: 0, z: 0, w: 272, d: 272, color: '#e7e1d3', grid: true },
  { id: 'asokoro', name: 'Asokoro · Aso Rock', x: 330, z: -120, w: 170, d: 150, color: '#dfe8d0' },
  { id: 'maitama', name: 'Maitama Estate', x: 330, z: 110, w: 170, d: 170, color: '#e9e0f0' },
  { id: 'gwarinpa', name: 'Gwarinpa Estate', x: -330, z: 110, w: 170, d: 170, color: '#e2ecf3' },
  { id: 'nyanya', name: 'Nyanya', x: -330, z: -120, w: 170, d: 150, color: '#f1e3d3' },
  { id: 'civic', name: 'Eagle Square & Area Council', x: -140, z: 335, w: 140, d: 120, color: '#e6efe2' },
  { id: 'leisure', name: 'Jabi & National Stadium', x: 140, z: 335, w: 140, d: 120, color: '#f3ecd8' },
  { id: 'wuse', name: 'Wuse II', x: 0, z: 330, w: 108, d: 112, color: '#f6e0e6' },
  { id: 'lugbe', name: 'Lugbe Layout', x: -126, z: -200, w: 212, d: 100, color: '#efe6cf' },
  { id: 'katampe', name: 'Katampe Extension', x: 126, z: -200, w: 212, d: 100, color: '#e3e8de' },
];

const G5 = [-128, -64, 0, 64, 128];
const V = { '-128': 'Ahmadu Bello Way', '-64': 'Herbert Macaulay Way', 0: 'Shehu Shagari Way', 64: 'Tafawa Balewa Way', 128: 'Ibrahim Babangida Way' };
const H = { '-128': 'Constitution Avenue', '-64': 'Independence Avenue', 0: 'Olusegun Obasanjo Way', 64: 'Aminu Kano Crescent', 128: 'Nnamdi Azikiwe Way' };

/* built: true means districts.js lays the tarmac (the grid and old connectors already exist) */
export const ROADS = [
  ...G5.map(x => ({ name: V[x], pts: G5.map(z => [x, z]), w: 16 })),
  ...G5.map(z => ({ name: H[z], pts: G5.map(x => [x, z]), w: 16 })),
  { name: 'Motor Park Road', pts: [[-128, 0], [-165, 0]], w: 12 },
  { name: 'Emergency Lane', pts: [[128, 0], [165, 0]], w: 12 },
  { name: 'Jabi Motors Road', pts: [[0, 128], [0, 165]], w: 12 },
  { name: 'Murtala Mohammed Expressway', pts: [[0, -128], [0, -200], [0, -230]], w: 16 },
  // new roads out to the districts
  { name: 'Independence Avenue', pts: [[128, -64], [250, -64], [300, -64], [400, -64]], w: 12, built: true },
  { name: 'Aso Villa Drive', pts: [[300, -64], [300, -150]], w: 10, built: true },
  { name: 'Aminu Kano Crescent', pts: [[128, 64], [250, 64], [330, 64], [400, 64]], w: 12, built: true },
  { name: 'Maitama Close', pts: [[330, 64], [330, 182]], w: 10, built: true },
  { name: 'Nyanya Road', pts: [[-128, -64], [-250, -64], [-330, -64], [-400, -64]], w: 12, built: true },
  { name: 'Nyanya Close', pts: [[-330, -64], [-330, -185]], w: 10, built: true },
  { name: 'Gwarinpa Avenue', pts: [[-128, 64], [-250, 64], [-330, 64], [-400, 64]], w: 12, built: true },
  { name: '1st Avenue, Gwarinpa', pts: [[-330, 64], [-330, 185]], w: 10, built: true },
  { name: 'Herbert Macaulay Way', pts: [[-64, 128], [-64, 262], [-64, 385]], w: 12, built: true },
  { name: 'Tafawa Balewa Way', pts: [[64, 128], [64, 262], [64, 385]], w: 12, built: true },
  { name: 'Stadium Road', pts: [[-210, 262], [-140, 262], [-64, 262], [0, 262], [64, 262], [140, 262], [210, 262]], w: 12, built: true },
  { name: 'Adetokunbo Ademola Crescent', pts: [[0, 262], [0, 382]], w: 10, built: true },
  { name: 'Eagle Square Road', pts: [[-140, 262], [-140, 296]], w: 10, built: true },
  { name: 'Stadium Drive', pts: [[140, 262], [140, 296]], w: 10, built: true },
  { name: 'Lugbe Layout Road', pts: [[0, -200], [-238, -200]], w: 12, built: true },
  { name: 'Katampe Road', pts: [[0, -200], [238, -200]], w: 12, built: true },
];

/* the parts of roads that run over open ground, for flattening the terrain */
export const FLAT_SEGS = [];
ROADS.forEach(r => { for (let i = 0; i < r.pts.length - 1; i++) { const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1]; if (Math.max(Math.abs(ax), Math.abs(az), Math.abs(bx), Math.abs(bz)) > 130) FLAT_SEGS.push([ax, az, bx, bz, r.w / 2 + 4]); } });
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L));
  return { d: Math.hypot(px - ax - dx * t, pz - az - dz * t), t, x: ax + dx * t, z: az + dz * t };
}
export const districtAt = (x, z) => DISTRICTS.slice(1).find(d => Math.abs(x - d.x) < d.w / 2 && Math.abs(z - d.z) < d.d / 2) || (Math.abs(x) < 140 && Math.abs(z) < 140 ? DISTRICTS[0] : null);

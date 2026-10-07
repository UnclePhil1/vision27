import { PLOTS, KIND } from './plots.js';

/* Building sites: every plot, plus government land owned by a seat. A site is a grid of cells.
   Plots use 1 m cells; government land uses 2 m cells. Also seeds the database. */
export const GOV_SITES = [
  { id: 'council', name: 'AMAC Council Grounds', level: 'local', cats: ['site', 'gov', 'outdoor'], x: -120, z: 320, w: 12, d: 10 },
  { id: 'lugbe_road', name: 'Lugbe Layout Road (extension)', level: 'local', cats: ['site', 'road'], x: -286, z: -200, w: 44, d: 6 },
  { id: 'nyanya_works', name: 'Nyanya District Works', level: 'district', cats: ['site', 'gov', 'outdoor'], x: -380, z: -190, w: 12, d: 8 },
  { id: 'katampe_road', name: 'Katampe Road (extension)', level: 'district', cats: ['site', 'road'], x: 271, z: -200, w: 28, d: 6 },
  { id: 'city_works', name: 'Federal City Works', level: 'city', cats: ['site', 'gov', 'outdoor'], x: 240, z: -160, w: 12, d: 8 },
  { id: 'jabi_bridge', name: 'Jabi Lake Bridge', level: 'bridge', cats: ['site', 'bridge', 'road'], x: 196, z: 290, w: 18, d: 4 },
  { id: 'aso_estate', name: 'Aso Rock Estate', level: 'aso', cats: ['site', 'gov', 'outdoor'], x: 330, z: -225, w: 18, d: 10 },
];
export const SEAT_LEVELS = { chairman: ['local'], senator: ['district'], vp: ['city', 'bridge', 'aso'], president: ['city', 'bridge', 'aso'] };
export const ROADISH = ['road', 'bridge'];          // citizens never open the explorer here

const PLOT_CATS = { residential: [], shop: ['shop'], office: ['office'], workshop: ['workshop'], mixed: ['shop', 'office'] };
/* one shape for every site: centre, facing, cells, cell size, floors, catalog tabs */
export function siteOf(key) {
  const [kind, id] = String(key).split(':');
  if (kind === 'plot') {
    const p = PLOTS.find(q => q.id === +id); if (!p) return null;
    return { key, kind, ref: p, code: p.code, name: `Plot ${p.code}`, x: p.x, z: p.z, face: p.face, w: p.w, d: p.d, cell: 1, floors: KIND[p.kind].floors, cats: ['structure', 'finish', 'outdoor', 'rooms', 'interior', ...PLOT_CATS[p.kind]] };
  }
  const g = GOV_SITES.find(q => q.id === id); if (!g) return null;
  return { key, kind: 'gov', ref: g, code: g.id, name: g.name, x: g.x, z: g.z, face: 1, w: g.w, d: g.d, cell: 2, floors: 1, cats: g.cats, level: g.level };
}
export const allSites = () => [...PLOTS.map(p => siteOf('plot:' + p.id)), ...GOV_SITES.map(g => siteOf('gov:' + g.id))];
/* cell (or a fractional cell position) → world, and world → cell */
export function cellWorld(s, cx, cz) { const lx = (-s.w / 2 + cx) * s.cell, lz = (-s.d / 2 + cz) * s.cell; return { x: s.x + lx * s.face, z: s.z + lz * s.face }; }
export function worldCell(s, x, z) { return { x: ((x - s.x) * s.face) / s.cell + s.w / 2, z: ((z - s.z) * s.face) / s.cell + s.d / 2 }; }
export const siteAt = (x, z) => allSites().find(s => Math.abs(x - s.x) <= s.w * s.cell / 2 && Math.abs(z - s.z) <= s.d * s.cell / 2);

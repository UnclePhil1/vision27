/* Land for sale: two new layouts south of the city, off the expressway.
   The same list seeds the database (node tools/plots-sql.mjs), so ids, places and prices match.
   A plot's front faces its road. Designs use plot-local metres: x across, z from back (-d/2) to front (+d/2). */
export const ZONES = [
  { id: 'lugbe', name: 'Lugbe Layout', code: 'L', sx: -1, factor: 1, rows: [
    ['shop', 'residential', 'residential', 'residential', 'residential', 'mixed', 'residential', 'residential'],
    ['shop', 'residential', 'residential', 'workshop', 'residential', 'residential', 'mixed', 'residential']] },
  { id: 'katampe', name: 'Katampe Extension', code: 'K', sx: 1, factor: 1.6, rows: [
    ['office', 'office', 'mixed', 'office', 'office', 'mixed', 'office', 'office'],
    ['workshop', 'workshop', 'office', 'workshop', 'mixed', 'workshop', 'office', 'workshop']] },
];
export const ROAD_Z = -200;
export const KIND = {
  residential: { name: 'Residential', price: 2500000, floors: 2, types: ['room', 'bungalow', 'duplex'] },
  shop: { name: 'Shop', price: 4000000, floors: 2, types: ['room', 'shopfront'] },
  workshop: { name: 'Workshop', price: 5000000, floors: 1, types: ['room', 'workshop'] },
  mixed: { name: 'Mixed use', price: 6000000, floors: 3, types: ['room', 'bungalow', 'duplex', 'flats', 'shopfront', 'office'] },
  office: { name: 'Office', price: 9000000, floors: 4, types: ['room', 'office'] },
};
export const PLOTS = [];
ZONES.forEach(zn => zn.rows.forEach((row, r) => row.forEach((kind, i) => {
  const n = PLOTS.filter(p => p.zone === zn.id).length + 1;
  PLOTS.push({
    id: PLOTS.length + 1, code: `${zn.code}-${String(n).padStart(2, '0')}`, zone: zn.id, kind,
    x: zn.sx * (42 + i * 24), z: r === 0 ? -172 : -228, w: 20, d: 24,
    face: r === 0 ? -1 : 1,                     // front of the plot points to -z (row A) or +z (row B)
    price: Math.round(KIND[kind].price * zn.factor / 100000) * 100000,
  });
})));
/* plot-local → world, and back */
export const toWorld = (p, lx, lz) => ({ x: p.x + lx * p.face, z: p.z + lz * p.face });
export const toLocal = (p, wx, wz) => ({ x: (wx - p.x) * p.face, z: (wz - p.z) * p.face });
export const plotAt = (x, z) => PLOTS.find(p => Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2);

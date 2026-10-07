/* Building Explorer: every piece you can buy and drop, and the rules for where it can go.
   Shared by the game and the database seed (node tools/catalog-sql.mjs). The server runs
   the same rules (site_check in supabase/schema.sql) and its answer is the one that counts. */
export const FH = 3;                       // floor height in metres
export const ROOMS = { bedroom: 'Bedroom', living: 'Living room', kitchen: 'Kitchen', bathroom: 'Bathroom', dining: 'Dining', shop: 'Shop floor', office: 'Office', workshop: 'Workshop', store: 'Store' };
export const CATS = { site: 'Site', structure: 'Structure', finish: 'Finish', outdoor: 'Outdoor', rooms: 'Rooms', interior: 'Interior', shop: 'Shop', office: 'Office', workshop: 'Workshop', gov: 'Government', road: 'Roads', bridge: 'Bridges' };
const HOME = ['bedroom', 'living', 'kitchen', 'bathroom', 'dining', 'store'], ALL = Object.keys(ROOMS);

// id, name, catalog tab, layer, width × depth in cells, price (naira), trade that builds it, city stock it uses per piece, extras
const P = (id, name, cat, layer, w, d, price, trade, mats = {}, x = {}) => ({ id, name, cat, layer, w, d, price, trade, mats, ...x });
export const PIECES = [
  P('pad', 'Clear and level the plot', 'structure', 'pad', 0, 0, 150000, 'labour', {}, { whole: true, col: 0xc9b28f }),
  P('gpad', 'Clear the site', 'site', 'pad', 0, 0, 1000000, 'labour', {}, { whole: true, col: 0xb8a684 }),
  P('foundation', 'Foundation', 'structure', 'foundation', 1, 1, 12000, 'mason', { cement: .08, rods: .03, sand: .02 }, { col: 0x9c978b }),
  P('slab', 'Floor slab', 'structure', 'slab', 1, 1, 15000, 'mason', { cement: .1, rods: .03 }, { col: 0xbdb7aa }),
  P('wall', 'Block wall', 'structure', 'wall', 1, 1, 18000, 'mason', { blocks: .12, cement: .05 }, { col: 0xf2e3c6 }),
  P('partition', 'Partition wall', 'structure', 'wall', 1, 1, 9000, 'mason', { blocks: .06 }, { col: 0xf6f0e4, thin: true }),
  P('door', 'Door', 'structure', 'opening', 1, 1, 45000, 'carpenter', { timber: .2 }, { col: 0x6b4a33 }),
  P('window', 'Window', 'structure', 'opening', 1, 1, 35000, 'carpenter', { timber: .1, fittings: .1 }, { col: 0x9fc6dc }),
  P('stairs', 'Staircase', 'structure', 'stairs', 1, 3, 250000, 'mason', { cement: .5, rods: .2 }, { col: 0x9c978b }),
  P('lift', 'Lift', 'structure', 'stairs', 2, 2, 2500000, 'electrician', { cable: 1, parts: 1 }, { col: 0x8d9196, power: true }),
  P('balcony', 'Balcony', 'structure', 'balcony', 1, 1, 22000, 'mason', { cement: .1, rods: .05 }, { col: 0xd9d4c7 }),
  P('roof_zinc', 'Zinc roof', 'structure', 'roof', 1, 1, 8000, 'carpenter', { roofing: .05, timber: .03 }, { col: 0x8d9ba5 }),
  P('roof_tile', 'Tile roof', 'structure', 'roof', 1, 1, 12000, 'carpenter', { roofing: .07, timber: .03 }, { col: 0xa0452e }),
  P('roof_slab', 'Concrete roof', 'structure', 'roof', 1, 1, 14000, 'mason', { cement: .1, rods: .04 }, { col: 0xbdb7aa }),
  P('gable', 'Roof shape: gable', 'structure', 'style', 0, 0, 40000, 'carpenter', { timber: .5 }, { whole: true }),
  P('hip', 'Roof shape: hip', 'structure', 'style', 0, 0, 50000, 'carpenter', { timber: .6 }, { whole: true }),
  ...[['cream', 0xf2e3c6], ['white', 0xf8f6f0], ['green', 0xcfe3cf], ['terracotta', 0xd98c6a], ['blue', 0xc9dcec], ['yellow', 0xf2dc8a]].map(([c, col]) =>
    P('paint_' + c, `Paint: ${c}`, 'finish', 'paint', 1, 1, 3000, 'painter', { paint: .02 }, { col })),
  P('tile_wood', 'Wood tiles', 'finish', 'tile', 1, 1, 6000, 'tiler', { tiles: .03 }, { col: 0xb08a5a }),
  P('tile_white', 'White tiles', 'finish', 'tile', 1, 1, 6000, 'tiler', { tiles: .03 }, { col: 0xecebe6 }),
  P('tile_terrazzo', 'Terrazzo', 'finish', 'tile', 1, 1, 7000, 'tiler', { tiles: .03 }, { col: 0xc9c2b4 }),
  P('ceiling', 'POP ceiling', 'finish', 'ceiling', 1, 1, 4000, 'painter', {}, { col: 0xffffff }),
  P('fence', 'Fence', 'outdoor', 'fence', 1, 1, 10000, 'mason', { blocks: .05 }, { col: 0xd9c7a5 }),
  P('gate', 'Gate', 'outdoor', 'fence', 3, 1, 180000, 'mason', { rods: .3 }, { col: 0x2b2b2b }),
  P('lamp', 'Outdoor lamp', 'outdoor', 'item', 1, 1, 30000, 'electrician', { cable: .1 }, { col: 0x444444, h: 3, outside: true }),
  ...Object.entries(ROOMS).map(([k, n]) => P('room_' + k, `Room: ${n}`, 'rooms', 'room', 1, 1, 0, null, {}, { room: k })),
  ...[['bed', 'Bed', 2, 2, 180000, ['bedroom'], .5, 0x8a6a4e], ['mattress', 'Mattress', 2, 2, 60000, ['bedroom'], .3, 0xf4f4f4], ['cupboard', 'Cupboard', 1, 1, 70000, ['kitchen', 'bedroom', 'living', 'store'], 1.8, 0xb8946a],
    ['wardrobe', 'Wardrobe', 2, 1, 120000, ['bedroom'], 2, 0x6e543b], ['kitchen', 'Kitchen unit', 2, 1, 200000, ['kitchen'], .9, 0xdedede], ['cooker', 'Cooker', 1, 1, 150000, ['kitchen'], .9, 0x2b2b2b],
    ['sink', 'Sink', 1, 1, 50000, ['kitchen', 'bathroom'], .9, 0xf4f4f4, { pipes: .2 }, 'plumber'], ['fridge', 'Fridge', 1, 1, 220000, ['kitchen'], 1.8, 0xf4f4f4, {}, null, true],
    ['table', 'Table', 2, 1, 60000, ['dining', 'living', 'kitchen', 'office'], .75, 0x8a6a4e], ['chairs', 'Chairs', 1, 1, 15000, ['dining', 'living', 'kitchen', 'office', 'shop'], .9, 0x6b4a33],
    ['sofa', 'Sofa', 2, 1, 250000, ['living', 'office'], .8, 0x2f6f4f], ['toilet', 'Toilet', 1, 1, 80000, ['bathroom'], .7, 0xf4f4f4, { pipes: .2 }, 'plumber'],
    ['shower', 'Shower', 1, 1, 70000, ['bathroom'], 2.1, 0xa9c6dd, { pipes: .2 }, 'plumber']].map(([id, name, w, d, price, rooms, h, col, mats = {}, trade = null, power]) => P(id, name, 'interior', 'item', w, d, price, trade, mats, { rooms, h, col, power })),
  P('light', 'Ceiling light', 'interior', 'light', 1, 1, 12000, 'electrician', { cable: .05 }, { col: 0xfff4c8, rooms: ALL }),
  P('frame', 'Picture frame', 'interior', 'decor', 1, 1, 8000, null, {}, { col: 0x6b4a33 }),
  P('counter', 'Shop counter', 'shop', 'item', 2, 1, 150000, null, {}, { rooms: ['shop'], h: 1, col: 0x6e543b }),
  P('shelves', 'Shelves', 'shop', 'item', 2, 1, 80000, null, {}, { rooms: ['shop', 'store'], h: 1.9, col: 0xb8946a }),
  P('till', 'Till', 'shop', 'item', 1, 1, 120000, null, {}, { rooms: ['shop'], h: 1.1, col: 0x2b2b2b, power: true }),
  P('sign', 'Shop sign', 'shop', 'sign', 1, 1, 60000, 'painter', { paint: .1 }, { col: 0x16213a }),
  P('desk', 'Office desk', 'office', 'item', 2, 1, 90000, null, {}, { rooms: ['office'], h: .75, col: 0x8a6a4e }),
  P('meeting', 'Meeting table', 'office', 'item', 3, 2, 300000, null, {}, { rooms: ['office'], h: .75, col: 0x5a3e2b }),
  P('reception', 'Reception desk', 'office', 'item', 2, 1, 180000, null, {}, { rooms: ['office'], h: 1.1, col: 0x16213a }),
  P('bay', 'Car bay', 'workshop', 'item', 3, 5, 400000, 'mason', { cement: .5 }, { rooms: ['workshop'], h: .05, col: 0xf2c230 }),
  P('carlift', 'Car lift', 'workshop', 'item', 2, 4, 1200000, 'mechanic', { parts: 1 }, { rooms: ['workshop'], h: 2.2, col: 0xc9472f, power: true }),
  P('toolrack', 'Tool rack', 'workshop', 'item', 2, 1, 90000, null, {}, { rooms: ['workshop', 'store'], h: 1.8, col: 0x2e5fa8 }),
  P('gov_office', 'Office block', 'gov', 'prefab', 6, 4, 20000000, 'mason', { cement: 6, blocks: 6, rods: 3 }, { h: 7, col: 0xf3efe6, roofc: 0x1d6e45 }),
  P('gov_market', 'Market shed', 'gov', 'prefab', 8, 4, 12000000, 'mason', { roofing: 4, rods: 2 }, { h: 4, col: 0xe8d9b0, roofc: 0x2f8f5b, open: true }),
  P('gov_clinic', 'Clinic shell', 'gov', 'prefab', 6, 5, 26000000, 'mason', { cement: 6, blocks: 8, rods: 3 }, { h: 5, col: 0xf2f6f4, roofc: 0xc9472f }),
  P('gov_school', 'School block', 'gov', 'prefab', 8, 4, 24000000, 'mason', { cement: 6, blocks: 8, rods: 3 }, { h: 5, col: 0xf0e6c8, roofc: 0x8b3a2a }),
  P('lane', 'Road lane', 'road', 'road', 1, 1, 250000, 'mason', { cement: .2, sand: .1 }, { col: 0x3f4247 }),
  P('junction', 'Junction', 'road', 'road', 1, 1, 300000, 'mason', { cement: .25, sand: .1 }, { col: 0x3f4247 }),
  P('shoulder', 'Road shoulder', 'road', 'road', 1, 1, 80000, 'mason', { sand: .1 }, { col: 0x8d8478 }),
  P('drain', 'Drainage', 'road', 'road', 1, 1, 150000, 'mason', { cement: .1, pipes: .1 }, { col: 0x5b5f63 }),
  P('streetlight', 'Street light', 'road', 'fixture', 1, 1, 200000, 'electrician', { cable: .2 }, { on: 'road', col: 0x6d7075 }),
  P('pier', 'Bridge pier', 'bridge', 'pier', 1, 1, 4000000, 'mason', { cement: 1, rods: .5 }, { col: 0xa9a399 }),
  P('deck', 'Bridge deck', 'bridge', 'deck', 1, 1, 2500000, 'mason', { cement: .4, rods: .3 }, { col: 0x8d8a84 }),
  P('ramp', 'Bridge ramp', 'bridge', 'road', 1, 1, 1500000, 'mason', { cement: .3, rods: .1 }, { col: 0x6d6a64, ramp: true }),
  P('rail', 'Bridge rail', 'bridge', 'fixture', 1, 1, 200000, 'mason', { rods: .1 }, { on: 'deck', col: 0xd9d4c7 }),
];
export const PIECE = Object.fromEntries(PIECES.map(p => [p.id, p]));

/* cells a piece covers; rot 1 and 3 turn it a quarter */
export const dims = (pc, rot) => (rot % 2 ? [pc.d, pc.w] : [pc.w, pc.d]);
export function cellsOf(pt) {
  const pc = PIECE[pt.piece]; if (!pc || pc.whole) return [];
  const [w, d] = dims(pc, pt.rot || 0), out = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([pt.x + i, pt.z + j]);
  return out;
}
/* layers that cannot share a cell with each other */
const SOLID = ['wall', 'stairs', 'item', 'prefab', 'fence', 'road', 'deck'];
export const groupOf = layer => (SOLID.includes(layer) ? 'solid' : layer);

/* index a list of parts: what sits on each cell, by layer */
export function indexParts(parts) {
  const at = new Map(), whole = new Set(), floors = new Map();
  for (const pt of parts) {
    const pc = PIECE[pt.piece]; if (!pc) continue;
    if (pc.whole) { whole.add(pc.layer); continue; }
    for (const [x, z] of cellsOf(pt)) at.set(`${pt.fl}|${x}|${z}|${pc.layer}`, pt);
    if (!floors.has(pt.fl)) floors.set(pt.fl, new Set()); floors.get(pt.fl).add(pc.layer);
  }
  const has = (layer, fl, x, z) => at.has(`${fl}|${x}|${z}|${layer}`);
  const get = (layer, fl, x, z) => at.get(`${fl}|${x}|${z}|${layer}`);
  const any = (layer, fl) => (layer === 'pad' || layer === 'style' ? whole.has(layer) : fl === undefined ? [...floors.values()].some(s => s.has(layer)) : !!floors.get(fl)?.has(layer));
  return { at, has, get, any };
}
/* a floor is enclosed when every slab cell on its edge carries a wall, door or window */
function enclosed(I, parts, fl) {
  const slabs = parts.filter(p => p.fl === fl && PIECE[p.piece]?.layer === 'slab');
  if (!slabs.length) return false;
  return slabs.every(p => [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => I.has('slab', fl, p.x + a, p.z + b)) || I.has('wall', fl, p.x, p.z));
}

/* why a part cannot stand where it is ('' when it can). site: { w, d, floors } */
export function why(pt, site, I, parts) {
  const pc = PIECE[pt.piece]; if (!pc) return 'Unknown piece';
  const fl = pt.fl || 0, cells = cellsOf(pt), all = f => cells.every(([x, z]) => f(x, z));
  if (fl < 0 || fl >= site.floors) return 'This site cannot go that high';
  if (!all((x, z) => x >= 0 && z >= 0 && x < site.w && z < site.d)) return 'Outside the site';
  if (pc.layer !== 'pad' && !I.any('pad')) return 'Clear and level the site first';
  if (fl > 0 && !I.any('stairs', fl - 1)) return 'Add a staircase or lift on the floor below first';
  const hs = l => all((x, z) => I.has(l, fl, x, z));
  switch (pc.layer) {
    case 'foundation': return fl ? 'Foundations go on the ground floor' : '';
    case 'slab': return fl === 0 ? (hs('foundation') ? '' : 'A floor slab needs a foundation under it') : all((x, z) => I.has('slab', fl - 1, x, z)) ? (hs('balcony') ? 'A balcony is there' : '') : 'An upper floor needs a slab under it';
    case 'wall': case 'stairs': return hs('slab') ? '' : 'It needs a floor slab';
    case 'opening': case 'paint': case 'sign': case 'decor': return hs('wall') ? '' : 'It needs a wall';
    case 'roof': return !hs('slab') ? 'A roof needs the floor under it' : all((x, z) => I.has('slab', fl + 1, x, z)) ? 'There is a floor above' : enclosed(I, parts, fl) ? '' : 'Close every outside edge of this floor with walls first';
    case 'style': return I.any('roof') ? '' : 'Put a roof on first';
    case 'tile': return hs('slab') ? '' : 'Tiles need a floor slab';
    case 'ceiling': return !hs('slab') ? 'It needs a floor slab' : all((x, z) => I.has('roof', fl, x, z) || I.has('slab', fl + 1, x, z)) ? '' : 'A ceiling needs a roof or a floor above';
    case 'room': return hs('slab') ? '' : 'Mark rooms on a floor slab';
    case 'item': if (pc.outside) return fl === 0 && !all((x, z) => I.has('foundation', 0, x, z)) ? '' : 'This goes outside the building';
    // falls through
    case 'light': if (!hs('slab')) return 'It needs a floor slab';
      if (!all((x, z) => I.has('room', fl, x, z))) return 'Mark the room first (Rooms tab)';
      return pc.rooms && !all((x, z) => pc.rooms.includes(PIECE[I.get('room', fl, x, z).piece].room)) ? `This goes in: ${pc.rooms.map(r => ROOMS[r]).join(', ')}` : '';
    case 'balcony': return !fl ? 'Balconies go on upper floors' : hs('slab') ? 'There is a floor here' : all((x, z) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => I.has('slab', fl, x + a, z + b))) ? '' : 'A balcony must touch the floor';
    case 'fence': return fl ? 'Fences go on the ground' : all((x, z) => !I.has('foundation', 0, x, z)) ? '' : 'Fences go outside the building';
    case 'prefab': case 'road': case 'pier': return fl ? 'This goes on the ground' : '';
    case 'fixture': return hs(pc.on) ? '' : `It goes on a ${pc.on}`;
    case 'deck': return fl ? 'This goes on the ground plan' : all((x, z) => { for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (I.has('pier', 0, x + a, z + b)) return true; return false; }) ? '' : 'A deck needs a pier within 2 cells';
  }
  return '';
}
/* check a whole site: overlaps, then every part's needs. Returns [] or a list of { pt, msg } */
export function checkSite(parts, site) {
  const seen = new Map(), bad = [];
  for (const pt of parts) {
    const pc = PIECE[pt.piece]; if (!pc) { bad.push({ pt, msg: 'Unknown piece' }); continue; }
    const keys = pc.whole ? [`w|${pc.layer}`] : cellsOf(pt).map(([x, z]) => `${pt.fl}|${x}|${z}|${groupOf(pc.layer)}`);
    for (const k of keys) { if (seen.has(k)) { bad.push({ pt, msg: `Something is already there (${PIECE[seen.get(k).piece].name})` }); break; } seen.set(k, pt); }
  }
  const I = indexParts(parts);
  for (const pt of parts) { const m = why(pt, site, I, parts); if (m) bad.push({ pt, msg: m }); }
  return bad;
}
/* the order builders work in: pad, foundations, slabs, walls … (lower floors first) */
const RANK = { pad: 0, foundation: 1, slab: 2, fence: 2, prefab: 2, road: 2, pier: 2, wall: 3, stairs: 3, deck: 3, opening: 4, balcony: 4, roof: 5, style: 6, paint: 7, tile: 7, ceiling: 7, sign: 7, fixture: 7, item: 8, light: 8, decor: 8, room: 9 };
export const rankOf = pt => (pt.fl || 0) * 10 + (RANK[PIECE[pt.piece]?.layer] ?? 9);
/* materials a set of placed parts draws from city stock (whole units, rounded up) */
export function matsOf(parts) {
  const m = {}; parts.forEach(pt => Object.entries(PIECE[pt.piece]?.mats || {}).forEach(([k, v]) => (m[k] = (m[k] || 0) + v)));
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.ceil(v - 1e-9)]));
}

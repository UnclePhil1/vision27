/* Work floors: where shifts happen, station by station. Shared by the game (to draw the
   floors and route tasks) and the database seed (node tools/floors-sql.mjs), so the server
   checks the same station positions the player walks to.
   Interior floors use room-local metres (door at +z). City stations use world metres. */

// what lives in each depot bay
export const BAYS = {
  'A-01': 'rice', 'A-02': 'beans', 'A-03': 'garri', 'A-04': 'oil',
  'B-01': 'noodles', 'B-02': 'tomatoes', 'B-03': 'clothes', 'B-04': 'parts',
  'C-01': 'cement', 'C-02': 'tiles', 'C-03': 'paint', 'C-04': 'cable',
  'D-01': 'pipes', 'D-02': 'fittings', 'D-03': 'petrol', 'D-04': 'eggs',
};
export const SHELVES = { 'S-1': 'rice', 'S-2': 'beans', 'S-3': 'garri', 'S-4': 'noodles', 'S-5': 'oil', 'S-6': 'tomatoes' };
export const PARTS = { 'RACK-1': 'brake pads', 'RACK-2': 'battery', 'RACK-3': 'tyre', 'RACK-4': 'oil filter' };
export const GOODS_NAME = {
  rice: 'Rice (50 kg bag)', beans: 'Beans (bag)', garri: 'Garri (bag)', oil: 'Palm oil (keg)', noodles: 'Noodles (carton)', tomatoes: 'Tomatoes (basket)',
  eggs: 'Eggs (crate)', clothes: 'Clothes (bale)', parts: 'Car parts (box)', cement: 'Cement (bag)', tiles: 'Tiles (carton)', paint: 'Paint (bucket)',
  cable: 'Cable (coil)', pipes: 'PVC pipes (bundle)', fittings: 'Light fittings (box)', petrol: 'Petrol (jerrycan)',
};

const rack = (letter, x) => [1, 2, 3, 4].map(n => ({ code: `${letter}-0${n}`, kind: 'bay', x, z: -9 + (n - 1) * 4, item: BAYS[`${letter}-0${n}`] }));
const shop = (back) => [
  { code: 'BACK', kind: 'back', x: -10, z: -6, label: back },
  ...Object.keys(SHELVES).map((code, i) => ({ code, kind: 'shelf', x: -5 + (i % 3) * 5, z: i < 3 ? -2.5 : 2, item: SHELVES[code] })),
  { code: 'TILL', kind: 'till', x: 8.5, z: 5, power: 1 },
];
export const FLOORS = {
  depot: {
    name: 'Kwik Dispatch depot', door: 'Kwik Dispatch', kind: 'depot', W: 34, D: 24, seed: 17,
    stations: [
      { code: 'R-1', kind: 'recv', x: -14, z: 7, power: 1 }, { code: 'R-2', kind: 'recv', x: -10, z: 7, power: 1 },
      ...rack('A', -6), ...rack('B', 0), ...rack('C', 6), ...rack('D', 12),
      { code: 'P-1', kind: 'pack', x: 3, z: 8.5, power: 1 }, { code: 'P-2', kind: 'pack', x: 7, z: 8.5, power: 1 },
      { code: 'DOCK', kind: 'dock', x: 15.5, z: 7 }, { code: 'BIN', kind: 'bin', x: -15.5, z: -10 },
    ],
  },
  freshmart: { name: 'FreshMart shop floor', door: 'FreshMart Supermarket', kind: 'shopfloor', W: 24, D: 16, seed: 29, stations: shop('Back store') },
  nyanya_market: { name: 'Nyanya Park Market', door: 'Nyanya Park Market', kind: 'shopfloor', W: 24, D: 16, seed: 41, stations: shop('Crates from the depot') },
  workshop: {
    name: 'Jabi Motors workshop', door: 'Jabi Motors Workshop', kind: 'workshop', W: 24, D: 16, seed: 53,
    stations: [
      { code: 'BAY-1', kind: 'car', x: -5, z: 0, power: 1 }, { code: 'BAY-2', kind: 'car', x: 4, z: 0, power: 1 },
      ...Object.keys(PARTS).map((code, i) => ({ code, kind: 'rack', x: -8 + i * 4.5, z: -6.5, item: PARTS[code] })),
      { code: 'PUMP', kind: 'pump', x: 10, z: 2 }, { code: 'DESK', kind: 'desk', x: 8, z: 6 },
    ],
  },
  yard: {
    name: 'FCDA Works Yard', door: 'FCDA Works Yard', kind: 'yard', W: 28, D: 18, seed: 67,
    stations: [{ code: 'TOOLS', kind: 'tools', x: -11, z: -6 }, { code: 'CEMENT', kind: 'cement', x: -5, z: -6 }, { code: 'BARROW', kind: 'barrow', x: 3, z: -6 }, { code: 'TRUCK', kind: 'truck', x: 10, z: 3 }],
  },
};
/* outdoor work for the government yard (world metres) */
export const POTHOLES = [[124.5, -47], [70.2, -43.6], [107.5, -60.9], [106.6, -59.9], [28.9, 132.6], [-60.8, 34.9], [45.3, 3.1], [-27.9, 57.5], [92.4, -122.3], [134.8, 35.1], [96, -122.5], [121.8, -89.9],
  [-5.2, 36.3], [-98.1, 4.1], [66.5, -45], [109.4, -132.8], [3.6, -46.4], [-131.1, -32.1], [-2.8, 37.9], [4.3, -96.4], [108.1, -69.7], [106.7, -135], [-57.5, -108.6], [-96.6, -133.4]];
export const WASTE = [[-84, 46], [-108, 46], [-110, 18], [-82, 18], [-360, -124], [-384, -124], [-300, -112], [-96, 60]];
export const STALLS = [[-104, 30], [-96, 30], [-88, 30], [-104, 36], [-88, 36], [-96, 24]];
export const CITY = [
  ...POTHOLES.map(([x, z], i) => ({ code: `PH-${String(i + 1).padStart(2, '0')}`, kind: 'pothole', x, z })),
  ...WASTE.map(([x, z], i) => ({ code: `WS-${i + 1}`, kind: 'waste', x, z })),
  ...STALLS.map(([x, z], i) => ({ code: `ST-${i + 1}`, kind: 'stall', x, z })),
];
/* the right box for an order: up to 2 items small, up to 5 medium, more large */
export const boxFor = n => (n <= 2 ? 'S' : n <= 5 ? 'M' : 'L');
/* NEPA on a work floor: the same for everyone, decided per city hour */
export const powerOut = (seed, t = Date.now()) => ((Math.floor(t / 60000) * 7919 + seed * 104729) % 100) < 12;

import { G, naira } from './game.js';
import { eco, changed, spend } from './economy.js';
import { PLOTS } from './plots.js';
import { PIECES, PIECE, checkSite } from './catalog.js';
import { GOV_SITES, siteOf } from './sites.js';
import { practiceNext, practiceDone, practiceTally, practiceFixes, practiceShelf } from './practice.js';

/* One door to everything the server owns: wallet, jobs, skills, materials, frames.
   Online build: Supabase functions (backend.js W). Preview build: a small local stand-in
   with the city firms only, so the systems can be tried without an account. */
export let srv = null;
export const online = () => !!srv?.live;          // true once the server wallet answered
export function useServer(W) { srv = W || LOCAL; G.ledger = W ? () => (online() ? W.ledger() : Promise.resolve([])) : null; }

export const SKILLS = {
  shop: 'Shop work', kitchen: 'Kitchen', fitness: 'Fitness', club: 'Bar and club', delivery: 'Delivery', driving: 'Driving', security: 'Security',
  mason: 'Mason', electrician: 'Electrician', plumber: 'Plumber', tiler: 'Tiler', carpenter: 'Carpenter', painter: 'Painter', mechanic: 'Mechanic',
  architect: 'Architect', supervisor: 'Site supervisor', aide: 'Political aide', organiser: 'Rally organiser', liaison: 'Contractor liaison',
};
export const LEVELS = ['New', 'Apprentice', 'Skilled', 'Master'];
export const levelOf = xp => (xp >= 25 ? 3 : xp >= 10 ? 2 : xp >= 3 ? 1 : 0);
export const cityHourAt = t => ((t / 60000) + 7) % 24;
export const hh = h => String(Math.floor(h) % 24).padStart(2, '0') + ':00';

/* ---------------- preview stand-in ---------------- */
const CITY = [
  [1, 'FreshMart', 'shift', 'Cashier', 'shop', 0, 3000, 8, 4, 'FreshMart Supermarket', -17, 340, 'freshmart'],
  [2, 'Calabar Kitchen', 'shift', 'Kitchen hand', 'kitchen', 0, 3000, 11, 4, 'Calabar Kitchen (restaurant)', 18, 290],
  [5, 'Kwik Dispatch', 'shift', 'Depot hand', 'delivery', 0, 3500, 17, 4, 'Kwik Dispatch', 92, 378, 'depot'],
  [6, 'Nyanya traders', 'shift', 'Market loader', 'shop', 0, 2500, 7, 3, 'Nyanya Park Market', -372, -131.8, 'nyanya_market'],
  [7, 'FCDA Works', 'trade', 'Works yard labourer', 'mason', 0, 3000, 7, 5, 'FCDA Works Yard', 18, -183.6, 'yard'],
  [8, 'FCDA Works', 'trade', "Electrician's mate", 'electrician', 0, 3000, 9, 4, 'Ministry Annex', -85, -12],
  [10, 'Wuse Tower', 'trade', 'Tiling crew', 'tiler', 0, 3000, 10, 4, 'Wuse Tower', -22, 49],
  [13, 'Jabi Motors', 'trade', 'Workshop boy (mechanic)', 'mechanic', 0, 3000, 8, 5, 'Jabi Motors Workshop', -14, 189, 'workshop'],
  [19, 'Vibes Lounge', 'shift', 'Bar staff', 'club', 0, 3000, 19, 4, 'Vibes Lounge (bar)', 19, 316],
  [20, 'Grand Abuja Hotel', 'shift', 'Night porter', 'shop', 0, 3200, 23, 5, 'Grand Abuja Hotel', -16, 300],
].map(([id, employer, kind, title, skill, min_level, pay, start_hour, hours, place, x, z, floor]) => ({ id, employer, source: 'city', kind, title, skill, min_level, pay, unit: 'hour', start_hour, hours, days: 1, slots: 10, place, x, z, moral: 'clean', due_pct: 0, meta: floor ? { floor } : {} }));
export const GOODS = [
  ['cement', 'Cement (50 kg bag)', 'material', 9500], ['blocks', 'Sandcrete blocks (50)', 'material', 32000], ['sand', 'Sharp sand (tipper)', 'material', 90000],
  ['rods', 'Iron rods (10)', 'material', 85000], ['tiles', 'Floor tiles (carton)', 'material', 14000], ['paint', 'Emulsion paint (20 L)', 'material', 38000],
  ['cable', 'Electric cable (coil)', 'material', 45000], ['pipes', 'PVC pipes (10)', 'material', 26000], ['roofing', 'Roofing sheets (10)', 'material', 120000],
  ['timber', 'Timber planks (10)', 'material', 40000], ['fittings', 'Light fittings (5)', 'material', 18000], ['parts', 'Spare parts box', 'material', 30000],
  ['trowel', 'Mason trowel set', 'tool', 12000, 'mason'], ['toolbox', 'Electrician toolbox', 'tool', 35000, 'electrician'], ['wrench', 'Plumber wrench kit', 'tool', 25000, 'plumber'],
  ['cutter', 'Tile cutter', 'tool', 30000, 'tiler'], ['saw', 'Carpenter saw and hammer', 'tool', 22000, 'carpenter'], ['roller', 'Paint rollers and brushes', 'tool', 9000, 'painter'],
  ['spanners', 'Mechanic spanner set', 'tool', 40000, 'mechanic'], ['drafting', 'Drafting kit and laptop', 'tool', 250000, 'architect'],
  ['petrol', 'Petrol (10 L)', 'fuel', 9000], ['diesel', 'Diesel (10 L)', 'fuel', 12000],
].map(([id, name, cat, price, skill]) => ({ id, name, cat, price, skill: skill || null }));

const L = () => { const l = (eco.land ||= {}); l.owned ||= []; l.parts ||= []; l.inv ||= {}; l.names ||= {}; l.seq ||= 1; delete l.builds; return l; };
const W = () => (eco.work ||= { skills: {}, rep: 50, done: 0, missed: 0, moral: 0, shifts: [], inv: {}, practiced: 0, seq: 1 });
const nextStart = (h, k = 0) => { const now = Date.now() / 60000, d0 = ((h - cityHourAt(Date.now())) % 24 + 24) % 24, d = d0 > 23 ? d0 - 24 : d0; return (now + d + 24 * k) * 60000; };
const near = (x, z, j) => Math.hypot(x - j.x, z - j.z) <= 25;
const no = () => { throw new Error('Hiring other players needs the online version'); };
const LOCAL = {
  profile: async () => ({ worker: { rep: W().rep, shifts_done: W().done, shifts_missed: W().missed, moral: W().moral }, skills: W().skills }),
  practice: async sk => { const w = W(); if (Date.now() - w.practiced > 120000) { w.practiced = Date.now(); w.skills[sk] = (w.skills[sk] || 0) + 1; changed(); } return levelOf(w.skills[sk] || 0); },
  board: async () => CITY.map(j => ({ ...j, hired: 0, mine: false, my_level: levelOf(W().skills[j.skill] || 0), my_status: W().shifts.some(s => s.job_id === j.id && ['scheduled', 'on'].includes(s.status)) ? 'hired' : null })),
  apply: async id => {
    const j = CITY.find(x => x.id === id), w = W(), lv = levelOf(w.skills[j.skill] || 0);
    if (lv < j.min_level) throw new Error(`You need ${j.skill} level ${j.min_level}`);
    if (!w.shifts.some(s => s.job_id === id && ['scheduled', 'on'].includes(s.status))) { const st = nextStart(j.start_hour); w.shifts.push({ id: w.seq++, job_id: id, starts_at: st, ends_at: st + j.hours * 60000, status: 'scheduled' }); changed(); }
    return 'hired';
  },
  shifts: async () => {
    const w = W(), now = Date.now();
    w.shifts.forEach(s => { if (s.status === 'scheduled' && s.ends_at < now) { s.status = 'missed'; w.missed++; w.rep = Math.max(0, w.rep - 5); } });
    w.shifts = w.shifts.filter(s => ['scheduled', 'on'].includes(s.status) || s.ends_at > now - 1800000);
    return w.shifts.map(s => { const j = CITY.find(x => x.id === s.job_id); return { ...s, title: j.title, employer: j.employer, place: j.place, x: j.x, z: j.z, pay: Math.round(j.pay * (s.ends_at - s.starts_at) / 60000), skill: j.skill, moral: j.moral, meta: j.meta, starts_at: new Date(s.starts_at).toISOString(), ends_at: new Date(s.ends_at).toISOString() }; });
  },
  checkin: async (id, x, z) => {
    const s = W().shifts.find(q => q.id === id), j = CITY.find(q => q.id === s?.job_id), now = Date.now();
    if (!s || s.status !== 'scheduled') throw new Error('This shift is not waiting for you');
    if (now < s.starts_at - 60000) throw new Error('Too early. Your shift starts at the top of the hour.');
    if (!near(x, z, j)) throw new Error(`Go to ${j.place} to clock in`);
    s.status = 'on'; s.checkin = now; changed(); return new Date(s.ends_at).toISOString();
  },
  finish: (id, x, z) => finishLocal(id, x, z, false),
  clockout: (id, x, z) => finishLocal(id, x, z, true),
  gig: async site => {
    const j = CITY.find(q => q.meta.floor === site), w = W(); if (!j) throw new Error('No gigs here');
    if (w.shifts.some(s => s.status === 'on')) throw new Error('Finish your other shift first');
    if (Date.now() < (w.gigAt || 0)) throw new Error('One gig at a time. Try again in a few minutes.');
    const now = Date.now(); w.shifts.push({ id: w.seq++, job_id: j.id, starts_at: now, ends_at: now + 120000, status: 'on', checkin: now }); w.gigAt = now + 360000; changed(); return w.seq - 1;
  },
  floorNext: async (sid, site, role) => {
    const s = W().shifts.find(q => q.id === sid && q.status === 'on'), j = s && CITY.find(q => q.id === s.job_id);
    if (sid && !s) throw new Error('Clock in first');
    return practiceNext({ shift: s, job: j, site, parts: L().parts.filter(p => p.site === site), lv: t => levelOf(W().skills[t] || 0) }, role);
  },
  floorDone: async (tid, x, z, where, ans) => { const r = practiceDone(tid, x, z, where, ans, id => L().parts.find(p => p.id === id)); changed(); return r; },
  cityFixes: async () => practiceFixes(), shelfTake: async (site, it) => practiceShelf(site, it), contracts: async () => [], myOrders: async () => [],
  quit: async id => { W().shifts.forEach(s => { if (s.job_id === id && s.status === 'scheduled') s.status = 'cancelled'; }); changed(); },
  prices: async () => { const m = G.priceMult?.() || 1; return GOODS.map(g => ({ ...g, price: Math.round(g.price * m / 10) * 10, have: W().inv[g.id] || 0 })); },
  buy: async (it, n) => { const g = GOODS.find(x => x.id === it), cost = Math.round(g.price * (G.priceMult?.() || 1) / 10) * 10 * n; if (!spend(cost)) throw new Error(`Not enough money. You have ${naira(eco.money)}`); W().inv[it] = (W().inv[it] || 0) + n; changed(); return { balance: eco.money, qty: W().inv[it], cost }; },
  use: async (it, n) => { const w = W(); if ((w.inv[it] || 0) < n) throw new Error('You do not have enough'); w.inv[it] -= n; changed(); return w.inv[it]; },
  // land and the Building Explorer (preview: your plots only, kept in this browser; government land needs the online version)
  plots: async () => PLOTS.map(p => ({ ...p, owner: L().owned.includes(p.id) ? (G.meId?.() || 'me') : null, ask: null, name: L().names['plot:' + p.id] || null })),
  buyPlot: async pid => {
    const p = PLOTS.find(x => x.id === pid); if (L().owned.includes(pid)) throw new Error('You own this plot');
    if (L().owned.length >= 2) throw new Error('You can hold 2 plots here');
    if (!spend(p.price)) throw new Error(`Not enough money. You have ${naira(eco.money)}`);
    L().owned.push(pid); changed(); return { balance: eco.money, cost: p.price };
  },
  listPlot: no,
  govSites: async () => GOV_SITES.map(g => ({ id: g.id, official: g.name, name: null })),
  parts: async () => L().parts, mySites: async () => [],
  siteRole: async site => (site.startsWith('plot:') && L().owned.includes(+site.slice(5)) ? 'owner' : null),
  piecePrices: async () => PIECES.map(p => ({ id: p.id, price: Math.round(p.price * (G.priceMult?.() || 1) / 10) * 10, have: L().inv[p.id] || 0 })),
  pieceBuy: async (pid, n, site) => {
    const s = siteOf(site), pc = PIECE[pid]; if (await LOCAL.siteRole(site) !== 'owner') throw new Error('Only the owner buys pieces for this site');
    if (!s.cats.includes(pc.cat)) throw new Error('That piece is not sold for this site');
    const cost = Math.round(pc.price * (G.priceMult?.() || 1) / 10) * 10 * n; if (!spend(cost)) throw new Error(`Not enough money. You have ${naira(eco.money)}`);
    L().inv[pid] = (L().inv[pid] || 0) + n; changed(); return { balance: eco.money, qty: L().inv[pid], cost };
  },
  siteCommit: async (site, ops) => {
    if (await LOCAL.siteRole(site) !== 'owner') throw new Error('Only the owner commits');
    const l = L(), rem = new Set(ops.filter(o => o.act === 'remove').map(o => o.id)), add = ops.filter(o => o.act === 'place');
    const fin = l.parts.filter(p => p.site === site && !rem.has(p.id)).concat(add), bad = checkSite(fin, siteOf(site));
    if (bad.length) throw new Error(`${PIECE[bad[0].pt.piece].name}: ${bad[0].msg}`);
    const need = {}; add.forEach(o => PIECE[o.piece].price && (need[o.piece] = (need[o.piece] || 0) + 1));
    for (const [pid, n] of Object.entries(need)) if ((l.inv[pid] || 0) < n) throw new Error(`Buy ${n - (l.inv[pid] || 0)} more ${PIECE[pid].name} first`);
    Object.entries(need).forEach(([pid, n]) => (l.inv[pid] -= n));
    const salvage = l.parts.filter(p => rem.has(p.id)).reduce((a, p) => a + Math.round(PIECE[p.piece].price * .4), 0); eco.money += salvage;
    l.parts = l.parts.filter(p => !rem.has(p.id)).concat(add.map(({ piece, fl = 0, x = 0, z = 0, rot = 0 }) => ({ id: l.seq++, site, piece, fl, x, z, rot, built: !PIECE[piece].trade })));
    changed(); return { placed: add.length, removed: rem.size, salvage, balance: eco.money };
  },
  siteRename: async (site, nm) => { const v = (nm || '').trim(); if (v && (v.length < 2 || v.length > 40)) throw new Error('Names are 2 to 40 letters'); L().names[site] = v || null; changed(); },
  nameReport: no, draftSave: no, draftsFor: async () => [], approve: no, contractBuild: no,
  policies: async () => [], budget: async () => 0, businesses: async () => [], posts: async () => [],
  post: no, applicants: no, decide: no, close: no, openBusiness: no, fund: no, setPolicy: no, orderDelivery: no, contractPost: no,
};

/* preview pay: same formula as the server's w_finish */
async function finishLocal(id, x, z, early) {
  const w = W(), s = w.shifts.find(q => q.id === id), j = CITY.find(q => q.id === s?.job_id);
  if (!s || s.status !== 'on') throw new Error('You are not on this shift');
  if (!early && Date.now() < s.ends_at - 5000) throw new Error('The shift is not over yet');
  if (!near(x, z, j)) throw new Error(`Clock out at ${j.place}`);
  const frac = Math.max(0, Math.min(1, (Math.min(Date.now(), s.ends_at) - Math.max(s.checkin, s.starts_at)) / (s.ends_at - s.starts_at)));
  let paid, gain, tasks, fails;
  if (j.meta.floor) {
    const hrs = Math.max(1, (s.ends_at - s.starts_at) / 60000); ({ ok: tasks, fails } = practiceTally(id));
    paid = Math.round(j.pay * hrs * (.3 * frac + .7 * Math.min(1, tasks / (3 * hrs))) * (1 - Math.min(.5, .05 * fails))); gain = Math.floor(tasks / 3);
    w.rep = Math.max(0, Math.min(100, w.rep + (tasks >= 3 * hrs * (early ? frac : 1) * .8 ? 2 : tasks ? 1 : -1)));
  } else { paid = Math.round(j.pay * j.hours * frac); gain = frac > .99 ? 2 : 1; w.rep = Math.min(100, w.rep + 2); }
  s.status = 'done'; w.done++; w.skills[j.skill] = (w.skills[j.skill] || 0) + gain;
  eco.money += paid; changed();
  return { paid, due: 0, xp: w.skills[j.skill], gained: gain, level: levelOf(w.skills[j.skill]), skill: j.skill, moral: 1, tasks, fails, balance: eco.money };
}

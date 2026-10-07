import { FLOORS, CITY, boxFor, powerOut } from './floordata.js';
import { PIECE, dims, rankOf } from './catalog.js';
import { siteOf, cellWorld } from './sites.js';

/* Preview stand-in for the work floors (supabase/schema.sql §15): the same stations, steps,
   walk-time and power checks, with stock kept in this tab. Online, the server does all of it. */
const P = { stock: {}, tasks: new Map(), seq: 1, order: null, cycle: 0, car: null, fixes: {} };
const st = (site, code) => (site === 'city' ? CITY : FLOORS[site].stations).find(s => s.code === code);
const step = (site, code, act, hold, label) => { const s = st(site, code); return { code, x: s.x, z: s.z, w: site === 'city', site, act, hold, power: !!s.power, label }; };
const pick = a => a[Math.random() * a.length | 0];
const q = k => P.stock[k] ?? (P.stock[k] = /^(freshmart|nyanya_market):shelf/.test(k) ? 4 : /:back:/.test(k) ? 6 : k.startsWith('depot:') ? 30 : k === 'yard:cement' ? 10 : 0);
const add = (k, n) => (P.stock[k] = Math.max(0, q(k) + n));

function make(site, kind, steps, o = {}) {
  let d = 0, h = 0;
  steps.forEach((s, i) => { h += s.hold; if (i && s.w === steps[i - 1].w) d += Math.hypot(s.x - steps[i - 1].x, s.z - steps[i - 1].z); });
  const t = { id: P.seq++, site, kind, steps, qty: 1, item: null, choices: null, answer: null, info: '', weight: 1, issued: Date.now(), min: d / 7 + h * .7, ...o };
  P.tasks.set(t.id, t); return t;
}
const bayOf = it => FLOORS.depot.stations.find(s => s.item === it)?.code;

function depot(role, out) {
  const want = k => role === 'all' || role === k;
  const o = P.order;
  if (o?.stage === 'packed' && want('dispatch') && !out) return make('depot', 'dispatch', [step('depot', 'P-1', 'lift', 1.2, 'Lift the packed box'), step('depot', 'DOCK', 'load', 1.8, 'Load the truck')], { info: 'Delivery for a player' });
  if (o?.stage === 'picked' && want('pack') && !out) return make('depot', 'pack', [step('depot', 'P-2', 'pack', 1.6, 'Pack and print the label')], { qty: o.qty, answer: boxFor(o.qty), choices: ['S', 'M', 'L'], info: `${o.qty} items in the tote` });
  if (want('receive') && (P.cycle++ % 3 === 2 || role === 'receive')) {
    const it = pick(['rice', 'beans', 'eggs', 'cement']);
    if (q('depot:recv:' + it) > 0) return make('depot', 'putaway', [step('depot', 'R-1', 'lift', 1.2, 'Lift from the receiving lane'), step('depot', bayOf(it), 'stock', 1.4, 'Put it away')], { item: it, qty: q('depot:recv:' + it), info: 'Put away ' + it });
    if (!out) return make('depot', 'receive', [step('depot', pick(['R-1', 'R-2']), 'scan', 1.8, 'Scan the pallet in')], { item: it, qty: 10, info: 'Pallet of ' + it });
  }
  if (want('pick') && (!o || o.stage === 'done')) {
    const it = pick(Object.values(FLOORS.depot.stations).filter(s => s.item).map(s => s.item)), n = 1 + (Math.random() * 3 | 0);
    P.order = { item: it, qty: n, stage: 'open' };
    const ch = [it, ...FLOORS.depot.stations.filter(s => s.item && s.item !== it).sort(() => Math.random() - .5).slice(0, 2).map(s => s.item)].sort(() => Math.random() - .5);
    return make('depot', 'pick', [step('depot', bayOf(it), 'pick', 1.2, `Pick ${n} from ${bayOf(it)}`), step('depot', 'P-2', 'drop', .8, 'Drop the tote at the pack bench')], { item: it, qty: n, answer: it, choices: ch, info: 'Order #' + (100 + P.seq) });
  }
  return null;
}
function shop(site, out, late, sid) {
  if (late && ![...P.tasks.values()].some(t => t.sid === sid && t.kind === 'close')) return make(site, 'close', [step(site, 'TILL', 'count', 2.2, 'Count and close the till')], { info: 'End of shift: close the till', sid });
  const shelves = FLOORS[site].stations.filter(s => s.kind === 'shelf'), low = shelves.find(s => q(`${site}:shelf:${s.item}`) < 6 && q(`${site}:back:${s.item}`) > 0);
  if (low) return make(site, 'unload', [step(site, 'BACK', 'lift', 1.2, 'Lift a crate'), step(site, low.code, 'stock', 1.6, 'Stock the shelf')], { item: low.item, qty: Math.min(6, q(`${site}:back:${low.item}`)), info: 'Restock ' + low.item });
  const s = shelves.filter(x => q(`${site}:shelf:${x.item}`) > 0); if (out || !s.length) { shelves.forEach(x => add(`${site}:back:${x.item}`, 6)); return null; }
  const it = pick(s).item, n = Math.min(q(`${site}:shelf:${it}`), 1 + (Math.random() * 3 | 0));
  return make(site, 'serve', [step(site, 'TILL', 'scan', 1.6, 'Scan and take payment')], { item: it, qty: n, info: `A customer wants ${n} ${it}` });
}
function workshop(out) {
  const c = P.car ||= { fault: pick(['brake pads', 'battery', 'tyre', 'oil filter']), bay: pick(['BAY-1', 'BAY-2']), stage: 'arrived' }, b = c.bay;
  const T = { arrived: ['receive_car', [step('workshop', b, 'check', 1.4, 'Check the car in')], 'A car has come in'], received: ['diagnose', [step('workshop', b, 'scan', 2, 'Run the diagnosis')], 'Find the fault'],
    diagnosed: ['part', [step('workshop', FLOORS.workshop.stations.find(s => s.item === c.fault).code, 'pick', 1.2, 'Take the part')], 'Fault: ' + c.fault], parted: ['fit', [step('workshop', b, 'fit', 2.2, 'Fit the ' + c.fault)], 'Fit the part'],
    fitted: ['fuel', [step('workshop', 'PUMP', 'lift', 1, 'Take the fuel can'), step('workshop', b, 'fuel', 1.6, 'Fuel the car')], 'Fuel it up'], fuelled: ['handback', [step('workshop', 'DESK', 'hand', 1.2, 'Hand the keys back')], 'The customer is waiting'] }[c.stage];
  if (out && c.stage === 'received') return null;
  return make('workshop', T[0], T[1], c.stage === 'diagnosed' ? { item: c.fault, answer: c.fault, choices: ['brake pads', 'battery', 'tyre', 'oil filter'], info: T[2] } : { info: T[2] });
}
function yard(sid) {
  if (![...P.tasks.values()].some(t => t.sid === sid && t.kind === 'tools' && t.ok)) return make('yard', 'tools', [step('yard', 'TOOLS', 'lift', 1.4, 'Sign out the tools')], { sid, info: 'City waste clearance' });
  const free = k => !(P.fixes[k] > Date.now());
  const w = CITY.filter(s => s.kind === 'waste' && free('waste:' + s.code)), h = CITY.filter(s => s.kind === 'pothole' && free('pothole:' + s.code));
  if (Math.random() < .5 && h.length && q('yard:cement') > 0) { const t = pick(h); return make('yard', 'patch', [step('yard', 'CEMENT', 'lift', 1.2, 'Load a bag of cement'), step('city', t.code, 'patch', 2.4, 'Patch the pothole')], { item: t.code, sid, info: 'Road repair' }); }
  if (!w.length) return null; const t = pick(w);
  return make('yard', 'waste', [step('yard', 'BARROW', 'lift', 1, 'Take a wheelbarrow'), step('city', t.code, 'shovel', 2, 'Shovel the waste'), step('yard', 'TRUCK', 'dump', 1.2, 'Dump it in the truck')], { item: t.code, sid, info: 'City waste clearance' });
}
/* a building site: the next committed piece in order, done at its spot */
function site(key, parts, lv) {
  const left = parts.filter(p => !p.built && PIECE[p.piece].trade); if (!left.length) return null;
  const lo = Math.min(...left.map(rankOf)), busy = id => [...P.tasks.values()].some(t => !t.done && t.parts?.includes(id) && Date.now() - t.issued < 240000);
  const p = left.find(q => rankOf(q) === lo && !busy(q.id) && (PIECE[q.piece].trade === 'labour' || lv(PIECE[q.piece].trade) >= 1)); if (!p) return null;
  const ids = PIECE[p.piece].w === 1 && PIECE[p.piece].d === 1 ? left.filter(q => q.piece === p.piece && q.fl === p.fl && !busy(q.id)).sort((a, b) => Math.abs(a.x - p.x) + Math.abs(a.z - p.z) - Math.abs(b.x - p.x) - Math.abs(b.z - p.z)).slice(0, 4).map(q => q.id) : [p.id];
  const s = siteOf(key), pc = PIECE[p.piece], [w, d] = dims(pc, p.rot), c = pc.whole ? cellWorld(s, s.w / 2, s.d / 2) : cellWorld(s, p.x + w / 2, p.z + d / 2), g = cellWorld(s, s.w / 2, s.d - .5);
  const act = { mason: 'lay', carpenter: 'fix', electrician: 'wire', plumber: 'plumb', tiler: 'tile', painter: 'paint', mechanic: 'fit' }[pc.trade] || 'dig';
  const at = (code, q, a, hold, label) => ({ code, x: q.x, z: q.z, w: true, site: key, act: a, hold, power: false, label });
  return make(key, 'build', [at('GATE', g, 'lift', 1.2, 'Collect materials at the gate'), at(pc.name.toUpperCase().slice(0, 14), c, act, 2.4, `${act[0].toUpperCase() + act.slice(1)}: ${pc.name.toLowerCase()}${ids.length > 1 ? ' ×' + ids.length : ''}`)], { parts: ids, qty: ids.length, item: pc.trade, info: s.name });
}
/* the two calls the phone makes, plus what the floor did to the city */
export function practiceNext({ shift, job, site: key, parts, lv }, role) {
  const s = job?.meta?.floor, out = s ? powerOut(FLOORS[s].seed) : false;
  if (shift && Date.now() > shift.ends_at) return { idle: 'Your shift is over. Clock out to get paid.', over: true };
  const open = [...P.tasks.values()].find(t => !t.done && Date.now() - t.issued < 240000 && (t.sid ?? null) === (shift?.id ?? null) && (!key || t.site === key));
  if (open) return open;
  const late = shift && Date.now() - shift.starts_at >= .8 * (shift.ends_at - shift.starts_at);
  const t = s === 'depot' ? depot(role || 'all', out) : s === 'freshmart' || s === 'nyanya_market' ? shop(s, out, late, shift.id) : s === 'workshop' ? workshop(out) : s === 'yard' ? yard(shift.id) : site(key, parts, lv);
  if (!t) return { idle: key ? (parts.some(p => !p.built && PIECE[p.piece].trade) ? 'Next up needs a trade you do not have yet (Apprentice or better). Hire builders from the plot sign.' : 'Nothing left to build here. Add pieces in the Building Explorer.') : out ? 'NEPA took light. Powered stations are off. Wait, or clock out.' : 'The floor is quiet. New work comes in every city hour.', power: !out };
  t.sid = shift?.id ?? null; return { ...t, power: !out };
}
export function practiceDone(tid, x, z, where, ans, findPart) {
  const t = P.tasks.get(tid); if (!t || t.done) throw new Error('That task is gone. Ask the phone for the next one.');
  const last = t.steps[t.steps.length - 1];
  if (last.w ? where !== 'city' || Math.hypot(x - last.x, z - last.z) > 3.2 : where !== last.site || Math.hypot(x - last.x, z - last.z) > 2.8) throw new Error(last.w ? `Go to ${last.label}` : `Go to station ${last.code}`);
  if ((Date.now() - t.issued) / 1000 < t.min * .6) throw new Error('Too fast. Walk the route and do each step.');
  const fl = FLOORS[t.site]; if (fl && t.steps.some(s => s.power) && powerOut(fl.seed)) throw new Error('NEPA took light. That station has no power.');
  t.done = Date.now();
  if (t.answer && ans !== t.answer) { t.ok = false; return { ok: false, msg: t.kind === 'pack' ? 'Wrong box. The order is repacked and your wage is cut.' : t.kind === 'part' ? 'Wrong part. It goes back on the rack and your wage is cut.' : 'Wrong item. The order is short and your wage is cut.' }; }
  t.ok = true; let msg = 'Done';
  const o = P.order, c = P.car;
  if (t.kind === 'pick') { add('depot:' + t.item, -t.qty); o.stage = 'picked'; }
  else if (t.kind === 'pack') o.stage = 'packed'; else if (t.kind === 'dispatch') o.stage = 'done';
  else if (t.kind === 'receive') add('depot:recv:' + t.item, t.qty); else if (t.kind === 'putaway') { add('depot:recv:' + t.item, -t.qty); add('depot:' + t.item, t.qty); }
  else if (t.kind === 'unload') { add(`${t.site}:back:${t.item}`, -t.qty); add(`${t.site}:shelf:${t.item}`, t.qty); } else if (t.kind === 'serve') add(`${t.site}:shelf:${t.item}`, -t.qty);
  else if (c && ['receive_car', 'diagnose', 'part', 'fit', 'fuel', 'handback'].includes(t.kind)) { c.stage = { receive_car: 'received', diagnose: 'diagnosed', part: 'parted', fit: 'fitted', fuel: 'fuelled' }[t.kind]; if (t.kind === 'diagnose') msg = 'Diagnosis: ' + c.fault; if (t.kind === 'handback') P.car = null; }
  else if (t.kind === 'patch') { add('yard:cement', -1); P.fixes['pothole:' + t.item] = Date.now() + 3 * 864e5; } else if (t.kind === 'waste') P.fixes['waste:' + t.item] = Date.now() + 36e5;
  else if (t.kind === 'build') { const ps = t.parts.map(findPart).filter(p => p && !p.built); if (!ps.length) throw new Error('Someone already finished that piece'); ps.forEach(p => (p.built = true)); }
  return { ok: true, msg };
}
export const practiceTally = sid => { let ok = 0, fails = 0; P.tasks.forEach(t => { if (t.sid === sid && t.done) { if (t.ok) ok += t.weight; else if (t.ok === false) fails++; } }); return { ok, fails }; };
export const practiceFixes = () => Object.entries(P.fixes).filter(([, u]) => u > Date.now()).map(([key]) => ({ key }));
export const practiceShelf = (site, it) => (q(`${site}:shelf:${it}`) < 1 ? -1 : add(`${site}:shelf:${it}`, -1));

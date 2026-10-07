import * as THREE from 'three';
import { G, dialog, fade, naira } from './game.js';
import { eco, earn, spend, changed } from './economy.js';
import { energy } from './places.js';
import { randomCharacter, Man, manPalette, menReady } from './characters.js';
import { setDestination, mapState } from './map.js';
import { arrest } from './events.js';
import { rand, pick, clamp } from './util.js';
import { track, style, mult, payAjo } from './life.js';
import { online } from './server.js';

/* Vision 2027 lives. Four ways to live in Abuja, each with three meters:
   Citizen (Stomach, Pocket, Sapa Rage), Politician (Public Love, Sponsor Gobis, Sighting),
   Sponsor (Cashflow, Puppet Grip, Asset Security), Coordinator (Turf, Mob Strength, Police Heat).
   Kept to the everyday and the satirical: no hits, ambushes, arson or ballot snatching. */
const $ = id => document.getElementById(id);
export const ROLES = {
  citizen: { name: 'Citizen', blurb: 'Hustle, eat, protest, vote', money: 50000, home: 'Gwarinpa Estate (free)',
    meters: [['stomach', 'Stomach', '#f2c230'], ['pocket', 'Pocket', '#3ddc84'], ['rage', 'Sapa Rage', '#c9472f']] },
  politician: { name: 'Politician', blurb: 'Buy love, keep sponsors sweet, dodge EFCC', money: 2000000, home: 'Maitama, then Aso Rock',
    meters: [['love', 'Public Love', '#e0245e'], ['gobis', 'Sponsor Gobis', '#f2c230'], ['sighting', 'Sighting (EFCC)', '#2e7fd0']] },
  sponsor: { name: 'Sponsor', blurb: 'Own the bank, fund the puppets', money: 50000000, home: 'Maitama mansion',
    meters: [['cashflow', 'Daily Cashflow', '#3ddc84'], ['grip', 'Puppet Grip', '#a855f7'], ['security', 'Asset Security', '#2e7fd0']] },
  coordinator: { name: 'Coordinator', blurb: 'Run the park, rent the crowd', money: 200000, home: 'Nyanya (free)',
    meters: [['turf', 'Turf Control', '#f97316'], ['mob', 'Mob Strength', '#f2c230'], ['heat', 'Police Heat', '#c9472f']] },
};
export const RANKS = ['Ward Councilor', 'Area Council Chairman', 'Senator', 'Vice President', 'President'];
const FORM = [1000000, 3000000, 10000000, 25000000, 50000000];
const START = { rage: 40, love: 50, gobis: 50, sighting: 10, grip: 30, security: 70, turf: 30, mob: 30, heat: 10, rank: 0, skills: {}, cool: {} };
const R = { crowd: [], rally: null, aiRallyT: 70, job: null, guards: [], pitch: [], tick: 0, out: null };
const L = () => eco.life;
const role = () => eco.role || 'citizen';
const bump = (k, v) => { L()[k] = clamp((L()[k] ?? 0) + v, 0, 100); };
const cool = (k, s) => { const t = performance.now() / 1000; if ((L().cool[k] || 0) > t) return Math.ceil(L().cool[k] - t); L().cool[k] = t + s; return 0; };
const ready = k => (L().cool[k] || 0) <= performance.now() / 1000;

export function setRole(r, reset) {
  if (reset || !eco.role || !eco.life || !eco.life.cool) { eco.life = JSON.parse(JSON.stringify(START)); }
  if (reset && eco.role !== r && !online()) eco.money = ROLES[r].money;   // online, the server sets starting money
  eco.role = r; changed(); paintRole();
}
export function initRoles(d) {
  R.out = d;
  if (!eco.life || !eco.life.cool) eco.life = JSON.parse(JSON.stringify(START));
  G.spotLabel = spotLabel; G.onSpot = onSpot; G.villaAccess = villaAccess; G.claimCost = claimCost;
  G.actionProviders.push(outdoor);
  mapState.onArrive = arrived;
  // footballers on the stadium pitch
  d.pitch.forEach(p => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(.28, .7, 2, 6), new THREE.MeshLambertMaterial({ color: p.team ? 0x1d8a4a : 0xf4f4f4 })); m.position.set(p.x, .65, p.z); m.castShadow = true; G.scene.add(m); R.pitch.push({ m, ...p, bx: p.x, bz: p.z }); });
  paintRole();
}
export function spawnGuards() {
  R.out.guards.forEach(g => {
    const ch = menReady() ? new Man('suit', manPalette({ shirt: 0x15171a, shirt2: 0xf4f4f4, pants: 0x15171a, tie: 0x1d8a4a, details: 0x15171a })) : randomCharacter(false);
    ch.root.position.set(g.x, 0, g.z); ch.root.rotation.y = g.yaw; G.scene.add(ch.root); R.guards.push(ch);
  });
}

/* ---------- the meters card ---------- */
export function paintRole() {
  const r = ROLES[role()], l = L(); if (!l) return;
  $('roleName').textContent = r.name + (role() === 'politician' ? ' · ' + RANKS[l.rank || 0] : '');
  const val = k => k === 'stomach' ? energy.v : k === 'pocket' ? clamp(eco.money / 2000, 0, 100) : k === 'cashflow' ? clamp(cashRate() / 20000, 0, 100) : l[k] ?? 0;
  $('roleBars').innerHTML = r.meters.map(([k, n, c]) => `<div class="rb"><span>${n}</span><b>${k === 'cashflow' ? '+' + short(cashRate()) + '/min' : Math.round(val(k)) + '%'}</b><div class="bar"><i style="width:${val(k)}%;background:${c}"></i></div></div>`).join('');
}
const short = n => n >= 1e6 ? '₦' + (n / 1e6).toFixed(1) + 'M' : '₦' + Math.round(n / 1000) + 'k';
const cashRate = () => Math.round(150000 + (L().grip || 0) * 4000) * ((L().security ?? 0) < 30 ? .4 : 1);

/* ---------- who may enter Aso Rock ---------- */
function villaAccess(door) {
  const rank = role() === 'politician' ? L().rank : -1, ok = door.role === 'president' ? rank >= 4 : rank >= 3;
  if (ok) return true;
  G.say(door.role === 'president' ? 'Oga, this na Presidential Villa. Only the President dey enter.' : "Na VP Residence be this. Only the Vice President and the President fit enter.", G.player.pos, 3.5);
  G.toast(role() === 'politician' ? `Win the ${door.role === 'president' ? 'Presidency' : 'Vice Presidency'} at the INEC Office to live here` : 'Only the President and VP live here. Become a politician at the INEC Office.');
  return false;
}
function claimCost(h) { if (!h.price) return 0; return role() === 'politician' && L().rank >= 2 ? 0 : h.price; }

/* ---------- jobs ---------- */
async function shift(name, pay, energyCost = 20) {
  if (energy.v < energyCost) { G.toast('You are too tired. Eat or sleep first.'); return; }
  const c = cool('job', 20); if (c) { G.toast(`Rest small. You can work again in ${c}s`); return; }
  await fade(() => { energy.v = Math.max(0, energy.v - energyCost); }, 900);
  earn(pay, `for your shift at ${name}`); G.practice?.(name); bump('rage', -4); track('shift'); style(1); paintRole();
}
function startDelivery(kind) {
  const p = G.player.pos, pool = mapState.pois.filter(o => (kind === 'agent' ? o.cat === 'home' && o.house !== undefined && !G.ownerOf?.(o.house) : ['shop', 'food', 'home', 'office', 'bank'].includes(o.cat)) && Math.hypot(o.x - p.x, o.z - p.z) > 60);
  if (!pool.length) { G.toast('No jobs right now. Check back soon.'); return; }
  const o = pick(pool), d = Math.hypot(o.x - p.x, o.z - p.z);
  R.job = { kind, x: o.x, z: o.z, name: o.name, pay: Math.round((kind === 'agent' ? 25000 : 1500 + d * 12) * mult.delivery()) };
  setDestination(o.x, o.z, kind === 'agent' ? `Show client: ${o.name}` : `Deliver to ${o.name}`);
  G.toast(kind === 'agent' ? `A client wants to see ${o.name}. Follow the GPS. Commission: ${naira(R.job.pay)}` : `Parcel for ${o.name}. Follow the GPS. Pay: ${naira(R.job.pay)}`);
}
function arrived() {
  const j = R.job, p = G.player.pos; if (!j || Math.hypot(p.x - j.x, p.z - j.z) > 12) return;
  R.job = null;
  if (j.kind === 'crowd1') { R.job = { kind: 'crowd2', x: R.out.spots.rally.x, z: R.out.spots.rally.z - 20, name: 'Eagle Square', pay: 300000 }; spawnCrowd(p.x, p.z, 10, 0, true); setDestination(R.job.x, R.job.z, 'Bring the crowd to Eagle Square'); G.toast('Crowd loaded! Take them to Eagle Square.'); return; }
  if (j.kind === 'crowd2') { earn(j.pay, 'for the rally crowd'); bump('mob', 15); bump('turf', 5); track('crowd'); style(-2); R.crowd.forEach(c => (c.follow = false)); paintRole(); return; }
  earn(j.pay, j.kind === 'agent' ? 'commission. The client took the house!' : 'for the delivery'); track('deliver'); track('shift'); style(1); energy.v = Math.max(0, energy.v - 6); paintRole();
}

/* ---------- crowds ---------- */
function spawnCrowd(x, z, n, ttl = 60, follow = false) {
  for (let i = 0; i < n; i++) { const ch = randomCharacter(); const a = rand() * 6.28, r = 2 + rand() * 6; ch.root.position.set(x + Math.cos(a) * r, G.gY(x, z), z + Math.sin(a) * r); ch.root.rotation.y = rand() * 6; G.scene.add(ch.root); R.crowd.push({ ch, t: ttl || 1e9, follow, off: [Math.cos(a) * r, Math.sin(a) * r] }); }
}
function startRally(by, ai) {
  const s = R.out.spots.rally; R.rally = { by, until: performance.now() / 1000 + (ai ? 90 : 60), paid: false };
  spawnCrowd(s.x, s.z - 14, ai ? 14 : 22, ai ? 90 : 60);
  const d = Math.hypot(G.player.pos.x - s.x, G.player.pos.z - s.z);
  if (d < 260) G.toast(ai ? `${by} is holding a rally at Eagle Square. Free ₦2,000 and rice!` : 'Your rally has started. The crowd is cheering!');
  setTimeout(() => G.sayAt?.(pick(['Vote for progress!', 'Una go chop! Rice for everybody!', 'We go fix the roads!', 'Light go stay!']), new THREE.Vector3(s.x, 2, s.z + 10), 4), 1500);
}
const rallyOn = () => R.rally && R.rally.until > performance.now() / 1000;

/* ---------- labels and actions on spots inside buildings ---------- */
function spotLabel(sp) {
  const r = role(), l = L();
  switch (sp.id) {
    case 'clinic': return 'See a doctor (₦5,000): full energy';
    case 'class': return l.skills.tech ? 'You have finished the computer class' : 'Take a computer class (₦10,000)';
    case 'movie': return 'Watch a movie (₦3,000)';
    case 'teller': return r === 'citizen' ? 'Work a bank teller shift (+₦12,000)' : null;
    case 'bank': return r === 'sponsor' ? 'Your bank office: fund, protect, collect' : 'Open an account (coming soon)';
    case 'club': return r === 'sponsor' ? 'Meet the cartel (boost your grip)' : 'Members only: sponsors';
    case 'tender': return r === 'politician' ? 'Award a road contract' : null;
    case 'runz': return r === 'citizen' ? 'Work as civil service runz (+₦10,000)' : null;
    case 'contest': if (G.openBallot) return 'Elections: vote or run for office'; return r === 'politician' ? (l.rank >= 4 ? 'You are the President of Nigeria' : `Contest for ${RANKS[l.rank + 1]} (form ${naira(FORM[l.rank + 1])})`) : `Buy a Ward Councilor form (${naira(FORM[0])})`;
    case 'techjob': return r === 'citizen' ? (l.skills.tech ? 'Work a remote tech gig (+₦25,000)' : 'Tech gigs need a computer class') : null;
    case 'dispatch': return r === 'citizen' ? (R.job ? 'Finish your current job first' : 'Take a delivery job') : null;
    case 'agent': return r === 'citizen' ? (R.job ? 'Finish your current job first' : 'Show a client a house') : null;
    case 'office': return 'Sit at your desk: run the country';
    case 'room': return 'Book a room for the night (₦15,000): full energy';
    case 'hangout': return 'Play draughts with the regulars';
    case 'dance': return G.phase?.() === 'evening' || G.phase?.() === 'night' ? 'Dance (₦5,000 entry)' : 'The club opens at 6pm';
    case 'workout': return 'Work out (₦3,000): stay fit all day';
  }
  return null;
}
async function onSpot(sp) {
  const r = role(), l = L();
  switch (sp.id) {
    case 'clinic': if (!spend(5000)) return G.toast('You need ₦5,000 to see the doctor'); await fade(() => { energy.v = 100; }, 900); G.toast('The doctor checked you. Energy is full.'); break;
    case 'class': if (l.skills.tech) return; if (!spend(10000)) return G.toast('The class costs ₦10,000'); await fade(null, 1200); l.skills.tech = true; changed(); G.toast('You passed the computer class! Tech gigs at Utako Tech Hub are open to you.'); break;
    case 'movie': if (!spend(3000)) return G.toast('A ticket costs ₦3,000'); await fade(null, 2200); energy.v = Math.min(100, energy.v + 15); bump('rage', -15); track('movie'); G.toast('Great movie! You feel relaxed.'); break;
    case 'teller': shift('Sovereign Trust Bank', 12000); break;
    case 'runz': shift('AMAC Secretariat', 10000, 15); break;
    case 'techjob': if (!l.skills.tech) { const sc = mapState.pois.find(o => o.cat === 'school'); if (sc) setDestination(sc.x, sc.z, sc.name); G.toast('Learn first. GPS is taking you to the school.'); return; } shift('Utako Tech Hub', 25000, 25); break;
    case 'dispatch': if (!R.job) startDelivery('dispatch'); break;
    case 'agent': if (!R.job) startDelivery('agent'); break;
    case 'bank': if (r !== 'sponsor') return G.toast('Accounts open soon. Banks here are for sponsors for now.'); return bankMenu();
    case 'club': if (r !== 'sponsor') return G.toast('The doorman says: members only.'); { const c = cool('club', 60); if (c) return G.toast(`The cartel meets again in ${c}s`); bump('grip', 12); track('club'); style(-4); G.toast('The cartel fixed loan rates. Your grip rises.'); } break;
    case 'tender': return tender();
    case 'contest': return G.openBallot ? G.openBallot() : contest();
    case 'office': return office();
    case 'room': if (!spend(15000)) return G.toast('A room costs ₦15,000'); await fade(() => { energy.v = 100; }, 1800); track('sleep'); G.toast('Room service, fresh sheets, AC and constant light. You slept like a big man.'); break;
    case 'hangout': { const c = cool('draughts', 45); if (c) return G.toast(`They are still setting the board (${c}s)`); await fade(null, 1200); const won = rand() < .5; bump('rage', -10); energy.v = Math.min(100, energy.v + 5); if (won) earn(1000, 'from a friendly draughts bet'); else G.toast('Baba Femi beat you again. Next time!'); track('hangout'); } break;
    case 'dance': { const ph = G.phase?.(); if (ph !== 'evening' && ph !== 'night') return G.toast('Club 27 opens at 6pm. Come back tonight.'); const c = cool('dance', 60); if (c) return G.toast(`Catch your breath (${c}s)`); if (!spend(5000)) return G.toast('Entry is ₦5,000'); await fade(null, 2200); bump('rage', -25); energy.v = Math.max(0, energy.v - 10); track('club'); G.toast('The DJ played your song. You danced till your legs shook!'); } break;
    case 'workout': { if (energy.v < 25) return G.toast('Eat something first. You need energy to train.'); if (!spend(3000)) return G.toast('A gym session costs ₦3,000'); await fade(() => { energy.v -= 20; }, 1500); G.fitUntil = Date.now() + 24 * 60000; track('workout'); G.toast('Great session! You get tired half as fast for the rest of the city day.'); } break;
  }
  paintRole();
}
async function bankMenu() {
  const l = L();
  const v = await dialog('Sovereign Trust Bank', `Grip ${Math.round(l.grip)}% · Security ${Math.round(l.security)}%. You earn about ${naira(cashRate())} a minute.`, [
    { label: 'Fund a campaign (₦10M)', value: 'fund' }, { label: 'Pay security (₦1M)', value: 'sec' }, { label: 'Micro-loans to POS agents (₦2M)', value: 'micro' }, { label: 'Hike interest rates', value: 'hike' }, { label: `Collect returns${l.grip < 50 ? ' (need 50% grip)' : ''}`, value: 'collect', disabled: l.grip < 50 }, { label: 'Close', value: 'x' }], { who: 'Your office' });
  if (v === 'fund') { if (!spend(10000000)) return G.toast('You need ₦10M'); bump('grip', 25); track('fund'); G.toast('A hungry candidate now owes you. Grip +25'); }
  if (v === 'micro') { if (!spend(2000000)) return G.toast('You need ₦2M'); bump('security', 15); style(12); track('microloan'); setTimeout(() => earn(2600000, 'repaid by POS agents, with interest'), 90000); G.toast('POS agents across the city got loans. They will repay in 90 seconds, and nobody riots at your bank.'); }
  if (v === 'hike') { const c = cool('hike', 120); if (c) return G.toast(`Customers are still angry (${c}s)`); earn(4000000, 'from higher interest'); bump('security', -25); style(-12); if (rand() < .3) { eco.money = Math.max(0, eco.money - 6000000); G.toast('BANK RUN! Depositors queued all day. You lost ₦6M.'); } }
  if (v === 'sec') { if (!spend(1000000)) return G.toast('You need ₦1M'); bump('security', 30); track('security'); G.toast('Guards are on retainer. Security +30'); }
  if (v === 'collect') { const amt = Math.round(l.grip * 120000); bump('grip', -25); track('collect'); earn(amt, 'in debt interest from your puppets'); }
  paintRole();
}
async function tender() {
  const c = cool('tender', 45); if (c) return G.toast(`No new contracts yet. Try again in ${c}s`);
  const road = pick(['Nyanya Road', 'Gwarinpa Avenue', 'Stadium Road', 'the Expressway', 'Aminu Kano Crescent']);
  const v = await dialog('Road contract', `A stretch of ${road} has collapsed. How do you award it?`, [
    { label: 'Fix it properly (Love +15)', value: 'clean' }, { label: 'Give it to a crony (₦1.5M for you)', value: 'crony' }], { who: 'AMAC Secretariat' });
  track('tender');
  if (v === 'clean') { bump('love', 15); bump('gobis', -5); track('clean'); style(10); G.toast('Contractors are fixing the road. The people noticed.'); }
  else { bump('gobis', 15); bump('sighting', 25); style(-10); earn(1500000, 'kickback (EFCC is watching)'); }
  paintRole();
}
async function contest() {
  const r = role(), l = L(), next = r === 'politician' ? l.rank + 1 : 0;
  if (r === 'politician' && l.rank >= 4) return G.toast('You already hold the highest seat. Aso Rock Villa is yours.');
  const fee = FORM[next], chance = r === 'politician' ? clamp(.15 + l.love / 100 * .55 + l.gobis / 100 * .3 - l.sighting / 100 * .25, .05, .92) : .6;
  const ok = await dialog(`Contest for ${RANKS[next]}`, `The form costs ${naira(fee)}. With your ${r === 'politician' ? `Love ${Math.round(l.love)}% and Gobis ${Math.round(l.gobis)}%` : 'street support'}, your chance is about ${Math.round(chance * 100)}%.`, [{ label: `Pay ${naira(fee)} and contest`, value: true }, { label: 'Not now', value: false }], { who: 'INEC Office' });
  if (!ok) return; if (!spend(fee)) return G.toast(`You need ${naira(fee)} for the form`);
  await fade(() => { }, 1600);
  const win = rand() < chance;
  showTicker(win ? `BREAKING: ${RANKS[next]} race won by ${G.myName?.() || 'you'}!` : `BREAKING: You lost the ${RANKS[next]} race. Better luck next time.`);
  if (!win) { bump('love', -5); paintRole(); return; }
  if (r !== 'politician') { eco.role = 'politician'; Object.assign(eco.life, { love: 55, gobis: 40, sighting: 10, rank: 0 }); }
  else l.rank = next;
  changed(); paintRole();
  const where = next >= 4 ? 'Presidential Villa at Aso Rock' : next === 3 ? "Vice President's Residence at Aso Rock" : next >= 2 ? 'a free official mansion in Maitama' : null;
  G.toast(`You are now ${RANKS[next]}!${where ? ` You can live in the ${where}.` : ''}`);
  if (next >= 3) { const d = mapState.pois.find(o => o.name.startsWith(next >= 4 ? 'Presidential Villa' : "Vice President")); if (d) setDestination(d.x, d.z, d.name); }
}
async function office() {
  const v = await dialog(L().rank >= 4 ? 'Office of the President' : 'Office of the Vice President', 'What will you do today?', [
    { label: 'Address the nation (Love +15)', value: 'speech' }, { label: 'Pay fuel subsidy (₦5M, Love +25)', value: 'sub' }, { label: 'Close', value: 'x' }], { who: 'Aso Rock' });
  if (v === 'speech') { const c = cool('speech', 60); if (c) return G.toast(`The nation is still digesting your last speech (${c}s)`); bump('love', 15); track('speech'); showTicker('LIVE: The President addresses the nation from Aso Rock'); }
  if (v === 'sub') { if (!spend(5000000)) return G.toast('The treasury needs ₦5M'); bump('love', 25); bump('gobis', -10); G.toast('Fuel prices drop. Citizens are happy, sponsors grumble.'); }
  paintRole();
}

/* ---------- outdoor actions ---------- */
function outdoor(p, out, inside) {
  if (inside || G.player.car || G.region !== 'city') return;
  const r = role(), s = R.out.spots;
  const near = (q, d = 0) => Math.hypot(p.x - q.x, p.z - q.z) - d;
  // Eagle Square
  if (r === 'politician') out(near(s.rally, 3), { label: rallyOn() ? 'Rally in progress' : 'Hold a rally (₦500,000)', run: () => { if (rallyOn()) return; if (!spend(500000)) return G.toast('A rally costs ₦500,000 for rice, cash and sound'); startRally('you', false); bump('love', 20); track('rallyhold'); bump('gobis', -3); paintRole(); } });
  if ((r === 'citizen' || r === 'coordinator') && rallyOn() && !R.rally.paid) out(near(s.rally, 6), { label: 'Collect ₦2,000 and rice', run: () => { R.rally.paid = true; earn(2000, 'and a pack of jollof rice'); track('rally'); style(-1); energy.v = Math.min(100, energy.v + 25); bump('rage', -8); paintRole(); } });
  if (r === 'coordinator' && !R.job) out(near(s.rally, 3), { label: 'Take a rent-a-crowd contract', run: () => { R.job = { kind: 'crowd1', x: s.nyanyaPark.x, z: s.nyanyaPark.z, name: 'Nyanya Motor Park' }; setDestination(s.nyanyaPark.x, s.nyanyaPark.z, 'Gather a crowd at Nyanya Motor Park'); G.toast('Go to Nyanya Motor Park and gather the boys. Pay: ₦300,000'); } });
  // motor parks
  [s.nyanyaPark, { x: -180, z: 0 }].forEach(pk => {
    if (r === 'coordinator') out(near(pk, 4), { label: 'Collect union dues', run: () => { const c = cool('dues', 40); if (c) return G.toast(`The drivers just paid. Come back in ${c}s`); const amt = Math.round((4000 + L().turf * 60) * mult.dues()); earn(amt, 'in union dues'); bump('turf', 5); bump('heat', 7); track('dues'); style(-3); paintRole(); } });
    if (r === 'citizen') out(near(pk, 4), { label: 'Work as a POS agent (+₦8,000)', run: () => shift('the motor park POS stand', 8000, 15) });
  });
  // protest at the Secretariat
  const sec = mapState.pois.find(o => o.name === 'AMAC Secretariat');
  if (sec && r === 'citizen') out(near(sec, 2.5), { label: L().rage >= mult.protestAt() ? 'Occupy the Secretariat (protest)' : `Protest needs Sapa Rage ${mult.protestAt()}% (now ${Math.round(L().rage)}%)`, run: () => { if (L().rage < mult.protestAt()) return G.toast('You are not angry enough yet. Sapa Rage rises with bad roads, hunger and time.'); spawnCrowd(sec.x - 6, sec.z, 16, 50); bump('rage', -60); track('protest'); style(4); G.say('No more sapa! Fix our roads! Pay our salaries!', G.player.pos, 4); setTimeout(() => G.toast('The council chairman came out. Repairs promised. Your rage cools.'), 4000); paintRole(); } });
  // the stadium
  out(near(s.stadium, 2), { label: 'Watch a match (₦2,000)', run: async () => { if (!spend(2000)) return G.toast('A match ticket costs ₦2,000'); const seat = R.out.seats[R.out.seats.length - 1 - ((rand() * 9) | 0)]; await fade(() => G.sit(seat), 600); bump('rage', -10); track('match'); G.toast('Goal! The stadium goes wild.'); G.Sound.buy?.(true); paintRole(); } });
  // Street Guardian: protect Unity Market in the evening and at night
  if (r === 'coordinator') out(near({ x: -96, z: 32 }, 10), { label: 'Protect the market tonight', run: () => { const ph = G.phase?.(); if (!ph || !['evening', 'night'].includes(ph)) return G.toast('Traders need you after dark. Come back in the evening.'); const c = cool('guard', 90); if (c) return G.toast(`The market is calm. Check again in ${c}s`); earn(6000, 'from grateful traders'); bump('turf', 8); bump('heat', -10); style(8); track('guard'); } });
  // Ajo thrift pool at the Gwarinpa estate office
  const ag = mapState.pois.find(o => o.name === 'Homefinders Estate Agency');
  if (ag && r !== 'sponsor') out(near(ag, 3), { label: 'Pay into the Ajo pool (₦5,000)', run: () => { payAjo(); paintRole(); } });
  // the villa gate
  out(near(s.villaGate, 1.5), { label: 'Talk to the guards', run: () => { const rank = role() === 'politician' ? L().rank : -1; G.say(rank >= 3 ? 'Welcome back, Your Excellency!' : 'Halt! State House. Business your way, oga.', new THREE.Vector3(s.villaGate.x, 2, s.villaGate.z + 1), 3); } });
}

/* ---------- every frame ---------- */
export function updateRoles(dt, t) {
  const l = L(); if (!l) return;
  R.crowd = R.crowd.filter(c => {
    c.t -= dt;
    if (c.follow) { const p = G.player.pos, tx = p.x + c.off[0], tz = p.z + c.off[1], r = c.ch.root.position, dx = tx - r.x, dz = tz - r.z, d = Math.hypot(dx, dz); const sp = d > 2 ? Math.min(8, d * 1.5) : 0; if (sp) { r.x += dx / d * sp * dt; r.z += dz / d * sp * dt; r.y = G.gY(r.x, r.z); c.ch.root.rotation.y = Math.atan2(dx, dz); } c.ch.update(dt, sp); }
    else c.ch.update(dt, 0);
    if (c.t <= 0) { G.scene.remove(c.ch.root); return false; } return true;
  });
  R.guards.forEach(g => g.update(dt, 0));
  R.pitch.forEach(p => { p.m.position.x = p.bx + Math.sin(t * .7 + p.ph) * 8; p.m.position.z = p.bz + Math.cos(t * .9 + p.ph * 1.3) * 5; });
  // an AI politician rallies now and then
  R.aiRallyT -= dt; if (R.aiRallyT <= 0) { R.aiRallyT = 200 + rand() * 120; if (!rallyOn()) startRally(pick(['Hon. Garba', 'Sen. Adaeze', 'Chief Bankole', 'Hon. Effiong']), true); }
  // slow drift of the meters, once a second
  R.tick += dt; if (R.tick < 1) return; R.tick = 0;
  const r = role(), home = !!G.inMyHouse?.();
  if (r === 'citizen') bump('rage', energy.v < 25 ? .12 : .03);
  if (r === 'politician') { bump('love', -.04); bump('gobis', -.03); bump('sighting', -.02); if (l.sighting >= 100) efcc(); }
  if (r === 'sponsor') { bump('security', -.04); bump('grip', -.02); l.payT = (l.payT || 0) + 1; if (l.payT >= 60) { l.payT = 0; eco.money += cashRate(); changed(); G.toast(`+${naira(cashRate())} cashflow from your bank and plazas`); if (l.security < 30 && rand() < .5) { eco.money = Math.max(0, eco.money - 2000000); G.toast('Looters hit your plaza! You lost ₦2M. Pay for security.'); } } }
  if (r === 'coordinator') { if (home && l.heat < 50) { l.lowT = (l.lowT || 0) + 1; if (l.lowT === 20) track('lielow'); } bump('heat', home ? -.25 : -.04); bump('turf', -.015); bump('mob', -.015); if (l.heat >= 100) { l.heat = 40; G.exitInterior?.(); arrest('Police raided your park'); } }
  paintRole();
}
async function efcc() {
  const l = L(); l.sighting = 35; const fine = Math.round(eco.money * .3); eco.money -= fine; if (l.rank > 0) l.rank--;
  changed(); await G.exitInterior?.();
  await dialog('EFCC', `Anti-corruption agents froze your accounts. You lost ${naira(fine)}${l.rank >= 0 ? ` and dropped to ${RANKS[l.rank]}` : ''}. Award cleaner contracts.`, [{ label: 'OK', value: 1 }], { who: 'Arrest' });
  paintRole();
}
let tickT = 0;
function showTicker(text) { const el = $('ticker'); el.textContent = text; el.hidden = false; clearTimeout(tickT); tickT = setTimeout(() => (el.hidden = true), 6000); }
export const rolesState = R;

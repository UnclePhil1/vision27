import { G, naira } from './game.js';
import { eco, changed } from './economy.js';

/* The Abuja day, from the Vision 2027 Coexistence Guide.
   One real minute is one city hour, and everyone shares the same clock, so a full day takes 24 minutes.
   Each part of the day changes prices, pay and what each life should be doing.
   On top: three daily goals per life, a login streak, XP and levels, and a playstyle title. */
const $ = id => document.getElementById(id);
export const PHASES = [
  { id: 'night', from: 22, to: 6, name: 'Night', line: 'Night: the city sleeps. Sleep earns double rest. Gwarinpa families pool Ajo savings.', sky: [0x0f1a33, 0x2a3550], light: .45 },
  { id: 'morning', from: 6, to: 10, name: 'Morning rush', line: 'Morning rush: potholes and gridlock. Bus fares are triple. The boys collect double at the parks. Banks open.', sky: [0x8fb7e0, 0xf3d9b0], light: .95 },
  { id: 'midday', from: 10, to: 14, name: 'Policy shock', line: 'Policy shock: an audit at the Area Council. Market prices jump 40%. Sponsors meet at the Country Club.', sky: [0x3a8bd8, 0xdfe9ea], light: 1.05 },
  { id: 'afternoon', from: 14, to: 18, name: 'Street flashpoint', line: 'Street flashpoint: Sapa Rage rises fast. Protests at the Secretariat need only 60% rage.', sky: [0x5c9ad6, 0xf0dcc0], light: 1 },
  { id: 'evening', from: 18, to: 22, name: 'Night hustle', line: 'Night hustle: deliveries pay 1.5×. Lounges and beer parlours are full.', sky: [0x3b4a7a, 0xe58f55], light: .7 },
];
export const hour = () => ((Date.now() / 60000) + 7) % 24;          // shared clock
export const phase = () => { const h = hour(); return PHASES.find(p => p.from < p.to ? h >= p.from && h < p.to : h >= p.from || h < p.to); };
export const clockText = () => { const h = hour(), hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); };
/* multipliers the rest of the game reads */
export const mult = {
  fare: () => (phase().id === 'morning' ? 3 : 1) * (G.policy?.fuel || 1),
  price: () => (phase().id === 'midday' ? 1.4 : 1),
  dues: () => (phase().id === 'morning' ? 2 : 1),
  delivery: () => (phase().id === 'evening' ? 1.5 : 1),
  rest: () => (phase().id === 'night' ? 2 : 1),
  protestAt: () => (phase().id === 'afternoon' ? 60 : 80),
};

/* ---------- daily goals ---------- */
const POOL = {
  citizen: [['shift', 2, 'Work 2 shifts'], ['deliver', 1, 'Finish a delivery'], ['eat', 2, 'Eat 2 meals'], ['rally', 1, 'Collect ₦2,000 at a rally'], ['bus', 1, 'Ride a city bus'], ['movie', 1, 'Watch a movie at Jabi'], ['vote', 1, 'Vote in an election'], ['visit:Gwarinpa Estate', 1, 'Visit Gwarinpa Estate'], ['ajo', 1, 'Pay into the Ajo pool'], ['ride', 1, 'Take a taxi with the Ride app'], ['chow', 1, 'Order food on Chow'], ['workout', 1, 'Work out at IronFit Gym'], ['hangout', 1, 'Play draughts at Vibes Lounge'], ['club', 1, 'Dance at Club 27 tonight'], ['visit:Lugbe Layout', 1, 'Visit Lugbe Layout (land for sale)']],
  politician: [['tender', 2, 'Award 2 road contracts'], ['rallyhold', 1, 'Hold a rally at Eagle Square'], ['speech', 1, 'Address the nation or visit INEC'], ['clean', 1, 'Award one contract cleanly'], ['visit:Asokoro · Aso Rock', 1, 'Visit Aso Rock'], ['vote', 1, 'Vote in an election']],
  sponsor: [['fund', 1, 'Fund a campaign'], ['security', 1, 'Pay your security retainer'], ['club', 1, 'Meet the cartel'], ['collect', 1, 'Collect returns'], ['microloan', 1, 'Give micro-loans to POS agents'], ['visit:Maitama Estate', 1, 'Visit Maitama'], ['ride', 1, 'Take a taxi across town'], ['club', 1, 'Unwind at Club 27']],
  coordinator: [['dues', 3, 'Collect union dues 3 times'], ['crowd', 1, 'Deliver a rally crowd'], ['guard', 1, 'Protect Unity Market at night'], ['visit:Nyanya', 1, 'Visit Nyanya'], ['lielow', 1, 'Lie low at home'], ['vote', 1, 'Vote in an election'], ['drive', 2, 'Finish 2 Ride trips'], ['deliver', 2, 'Deliver 2 Chow orders']],
};
const REWARD = { citizen: 1, coordinator: 3, politician: 25, sponsor: 120 };
const dayKey = () => new Date().toISOString().slice(0, 10);
function seeded(seed) { let a = 0; for (const c of seed) a = (a * 31 + c.charCodeAt(0)) | 0; return () => { a = (a * 1103515245 + 12345) | 0; return ((a >>> 0) % 10000) / 10000; }; }
function today() {
  const L = eco.life, role = eco.role || 'citizen', key = dayKey() + role;
  if (!L.daily || L.daily.key !== key) {
    const r = seeded(key), pool = POOL[role].filter(g => G.profile || g[0] !== 'vote'), goals = [];
    while (goals.length < 3 && pool.length) goals.push(pool.splice((r() * pool.length) | 0, 1)[0]);
    L.daily = { key, goals: goals.map(([ev, n, text]) => ({ ev, n, text, got: 0, claimed: false })) };
  }
  return L.daily;
}
const reward = () => 3000 * (REWARD[eco.role] || 1);

/* every meaningful action calls track() */
export function track(ev, n = 1) {
  if (!eco.life) return; const d = today(); let hit = false;
  d.goals.forEach(g => { if (g.ev === ev && g.got < g.n) { g.got = Math.min(g.n, g.got + n); hit = true; if (g.got === g.n) G.toast(`Goal done: ${g.text}. Claim it in the Today app.`); } });
  addXp(ev.startsWith('visit') ? 2 : 8);
  if (hit) { changed(); paintHud(); }
}
export function claim(i) {
  const g = today().goals[i]; if (!g || g.got < g.n || g.claimed) return;
  g.claimed = true; eco.money += reward(); addXp(60); changed(); G.toast(`+${naira(reward())} and 60 XP for "${g.text}"`); G.Sound?.buy?.(true); paintHud();
}
export function addXp(n) {
  const L = eco.life; L.xp = (L.xp || 0) + n; const lv = levelOf(L.xp);
  if (lv > (L.level || 1)) { L.level = lv; const bonus = 5000 * lv * (REWARD[eco.role] || 1); eco.money += bonus; G.toast(`Level up! You are now level ${lv}. Bonus ${naira(bonus)}`); G.Sound?.buy?.(true); }
  else L.level = L.level || lv;
}
export const levelOf = xp => Math.floor(Math.sqrt((xp || 0) / 120)) + 1;
export const xpFor = lv => 120 * (lv - 1) * (lv - 1);

/* playstyle: choices push you along a moral line */
export function style(n) { const L = eco.life; L.style = Math.max(-100, Math.min(100, (L.style || 0) + n)); }
const TITLES = {
  citizen: ['Shadow Hustler', 'Opportunist', 'Honest Grinder'], politician: ['Predator', 'Pragmatist', 'Reformer'],
  sponsor: ['Vulture Oligarch', 'Neutral Vault', 'Impact Banker'], coordinator: ['Mercenary', 'Double-Agent', 'Street Guardian'],
};
export const titleOf = () => { const s = eco.life?.style || 0; return TITLES[eco.role || 'citizen'][s < -30 ? 0 : s > 30 ? 2 : 1]; };

/* login streak: come back each day for a bigger gift */
export function checkStreak() {
  const L = eco.life, d = dayKey(); if (L.lastDay === d) return;
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  L.streak = L.lastDay === y ? (L.streak || 0) + 1 : 1; L.lastDay = d;
  const gift = 2000 * Math.min(7, L.streak) * (REWARD[eco.role] || 1);
  eco.money += gift; changed();
  setTimeout(() => G.toast(`Day ${L.streak} streak! Daily gift: ${naira(gift)}${L.streak < 7 ? '. Come back tomorrow for more.' : ''}`), 2500);
}

/* Ajo thrift: pay ₦5,000 a day; the fifth payment returns the pot with a 20% bonus */
export function payAjo() {
  const L = eco.life; L.ajo = L.ajo || { paid: 0, last: '' };
  if (L.ajo.last === dayKey()) return G.toast('You already paid into the Ajo pool today. Come back tomorrow.');
  if (eco.money < 5000) return G.toast('Ajo needs ₦5,000');
  eco.money -= 5000; L.ajo.paid++; L.ajo.last = dayKey(); track('ajo'); style(3);
  if (L.ajo.paid >= 5) { L.ajo.paid = 0; eco.money += 30000; G.toast('It is your turn! The Ajo pool paid you ₦30,000.'); }
  else G.toast(`Paid ₦5,000 into Ajo (${L.ajo.paid}/5). Your payout comes on the fifth day.`);
  changed();
}

/* ---------- the sky follows the clock ---------- */
let lastPhase = null, skyT = 0;
export function updateLife(dt, light) {
  skyT -= dt; if (skyT > 0) return; skyT = 1;
  const p = phase();
  if (p !== lastPhase) {
    if (lastPhase && G.started) { G.ticker?.(`${clockText()} · ${p.line}`); }
    lastPhase = p;
  }
  nepa();
  // ease the light toward this phase (dim when NEPA has taken light and there is no generator)
  const dark = G.outage && !G.genOn?.() && G.inMyHouse?.() ? .35 : 1;
  const k = .08; light.hemi.intensity += (1.05 * p.light * dark - light.hemi.intensity) * k; light.sun.intensity += (2.2 * p.light * dark - light.sun.intensity) * k;
  light.top.lerp(light.tmp.setHex(p.sky[0]), k); light.low.lerp(light.tmp.setHex(p.sky[1]), k);
  paintHud();
}
/* NEPA: now and then the power goes off at home. A generator keeps the light on. */
let nepaT = 90;
function nepa() {
  if (!G.inMyHouse?.()) return;
  nepaT -= 1; if (nepaT > 0) return;
  if (!G.outage) { G.outage = true; nepaT = 40 + Math.random() * 40; G.toast(G.genOn?.() ? 'NEPA took light! Your generator kicked in.' : 'NEPA has taken light! Switch on a generator if you have one.'); G.track?.('nepa'); }
  else { G.outage = false; nepaT = 120 + Math.random() * 180; G.toast('UP NEPA! Light is back.'); G.Sound?.ding?.(); }
}
export function paintHud() {
  const el = $('lifeChip'); if (!el || !eco.life) return;
  const L = eco.life, d = today(), left = d.goals.filter(g => !g.claimed).length;
  el.innerHTML = `<b>${clockText()}</b> ${phase().name} · Lv ${L.level || 1}${left ? ` · <i>${d.goals.filter(g => g.got >= g.n && !g.claimed).length ? 'Goal ready!' : left + ' goals left'}</i>` : ' · All done ✓'}`;
}
export const lifeToday = today;

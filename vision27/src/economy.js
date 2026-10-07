import { G, naira, dialog, fade } from './game.js';
import { net } from './net.js';
import { energy, saveEnergy } from './places.js';
import { srv, online } from './server.js';

/* Money, bag, furniture storage, outfits and tickets. Saved in the player's private
   db doc (data/users/<id>/profile); falls back to this browser when there is no db. */

export const ITEMS = {
  // food and drink (energy)
  water: { name: 'Pure water (sachet)', price: 50, cat: 'food', energy: 4 },
  malt: { name: 'Malt drink', price: 450, cat: 'food', energy: 10 },
  zobo: { name: 'Zobo drink', price: 300, cat: 'food', energy: 8 },
  chapman: { name: 'Chapman', price: 900, cat: 'food', energy: 12 },
  puff: { name: 'Puff-puff (5)', price: 300, cat: 'food', energy: 10 },
  roll: { name: 'Sausage roll', price: 250, cat: 'food', energy: 8 },
  bread: { name: 'Agege bread', price: 800, cat: 'food', energy: 15 },
  jollof: { name: 'Jollof rice and chicken', price: 2500, cat: 'food', energy: 40 },
  amala: { name: 'Amala and ewedu', price: 2000, cat: 'food', energy: 40 },
  pounded: { name: 'Pounded yam and egusi', price: 3000, cat: 'food', energy: 50 },
  suya: { name: 'Suya (wrap)', price: 1500, cat: 'food', energy: 20 },
  kilishi: { name: 'Kilishi', price: 1200, cat: 'food', energy: 18 },
  pepperSoup: { name: 'Goat meat pepper soup', price: 3500, cat: 'food', energy: 35 },
  friedRice: { name: 'Fried rice and turkey', price: 4500, cat: 'food', energy: 50 },
  ofada: { name: 'Ofada rice and ayamase', price: 4000, cat: 'food', energy: 50 },
  afang: { name: 'Afang soup and fufu', price: 3800, cat: 'food', energy: 55 },
  edikang: { name: 'Edikang ikong and garri', price: 4200, cat: 'food', energy: 55 },
  smallChops: { name: 'Small chops platter', price: 3000, cat: 'food', energy: 25 },
  fish: { name: 'Grilled catfish', price: 6000, cat: 'food', energy: 45 },
  softDrink: { name: 'Soft drink', price: 400, cat: 'food', energy: 6 },
  palmWine: { name: 'Palm wine (cup)', price: 800, cat: 'food', energy: 6 },
  coffee: { name: 'Coffee', price: 1500, cat: 'food', energy: 12 },
  mocktail: { name: 'Mocktail', price: 2500, cat: 'food', energy: 10 },
  // ingredients (cook at home)
  rice: { name: 'Rice (1 kg)', price: 1900, cat: 'ingredient' },
  tomatoes: { name: 'Tomatoes (paint)', price: 700, cat: 'ingredient' },
  pepper: { name: 'Pepper (tatashe)', price: 400, cat: 'ingredient' },
  oil: { name: 'Palm oil (bottle)', price: 1100, cat: 'ingredient' },
  yam: { name: 'Yam tuber', price: 2200, cat: 'ingredient' },
  plantain: { name: 'Plantain (bunch)', price: 900, cat: 'ingredient' },
  noodles: { name: 'Noodles (pack)', price: 350, cat: 'ingredient' },
  onions: { name: 'Onions', price: 300, cat: 'ingredient' },
  eggs: { name: 'Eggs (crate)', price: 4800, cat: 'ingredient' },
  beans: { name: 'Beans (1 kg)', price: 2000, cat: 'ingredient' },
  garri: { name: 'Garri (1 kg)', price: 1200, cat: 'ingredient' },
  spaghetti: { name: 'Spaghetti', price: 900, cat: 'ingredient' },
  milk: { name: 'Milk (tin)', price: 1300, cat: 'misc' },
  sugar: { name: 'Sugar', price: 1100, cat: 'misc' },
  soap: { name: 'Bathing soap', price: 600, cat: 'misc' },
  detergent: { name: 'Detergent', price: 1500, cat: 'misc' },
  // cooked at home
  homeJollof: { name: 'Home-made jollof', price: 0, cat: 'food', energy: 55 },
  dodo: { name: 'Fried plantain (dodo)', price: 0, cat: 'food', energy: 25 },
  porridge: { name: 'Yam porridge', price: 0, cat: 'food', energy: 45 },
  cookedNoodles: { name: 'Cooked noodles', price: 0, cat: 'food', energy: 20 },
  // other goods
  airtime: { name: 'Airtime top-up', price: 1000, cat: 'misc' },
  powerbank: { name: 'Power bank', price: 9000, cat: 'misc' },
  painkiller: { name: 'Paracetamol', price: 300, cat: 'food', energy: 5 },
  vitamins: { name: 'Vitamin C', price: 1200, cat: 'food', energy: 12 },
  ors: { name: 'ORS sachets', price: 500, cat: 'food', energy: 10 },
  antimalaria: { name: 'Malaria tablets', price: 2500, cat: 'food', energy: 20 },
  sanitizer: { name: 'Hand sanitizer', price: 900, cat: 'misc' },
  firstaid: { name: 'First aid kit', price: 4500, cat: 'misc' },
  haircut: { name: 'Fresh haircut', price: 2500, cat: 'service' },
  printing: { name: 'Business cards', price: 3000, cat: 'misc' },
  // clothes (wear right away)
  ankaraRed: { name: 'Ankara shirt (red)', price: 9000, cat: 'outfit', outfit: { shirt: 0xc9472f } },
  ankaraBlue: { name: 'Ankara shirt (blue)', price: 9000, cat: 'outfit', outfit: { shirt: 0x2e5fa8 } },
  ankaraGold: { name: 'Ankara shirt (gold)', price: 9000, cat: 'outfit', outfit: { shirt: 0xe8b23a } },
  kaftanWhite: { name: 'White kaftan set', price: 18000, cat: 'outfit', outfit: { shirt: 0xf1ece0, pants: 0xf1ece0 } },
  kaftanGreen: { name: 'Green kaftan set', price: 18000, cat: 'outfit', outfit: { shirt: 0x1f7a5c, pants: 0x1f7a5c } },
  jeans: { name: 'Blue jeans', price: 12000, cat: 'outfit', outfit: { pants: 0x3c5a7a } },
  chinos: { name: 'Khaki chinos', price: 11000, cat: 'outfit', outfit: { pants: 0xb59b6e } },
  blackTrousers: { name: 'Black trousers', price: 10000, cat: 'outfit', outfit: { pants: 0x222222 } },
  filaCap: { name: 'Fila cap', price: 4000, cat: 'outfit', outfit: { hat: 'fila', hatColor: 0xf1ece0 } },
  faceCap: { name: 'Face cap', price: 3500, cat: 'outfit', outfit: { hat: 'cap', hatColor: 0x1d3557 } },
  noHat: { name: 'Take off hat', price: 0, cat: 'outfit', outfit: { hat: 'none' } },
  gownPurple: { name: 'Ankara gown / top (purple)', price: 15000, cat: 'outfit', outfit: { shirt: 0x7b2d8e } },
  gownGreen: { name: 'Ankara gown / top (green)', price: 15000, cat: 'outfit', outfit: { shirt: 0x1d8a4a } },
  laceWhite: { name: 'White lace (owambe)', price: 35000, cat: 'outfit', outfit: { shirt: 0xf1ece0 } },
  agbadaBlue: { name: 'Royal blue senator wear', price: 30000, cat: 'outfit', outfit: { shirt: 0x16213a, pants: 0x16213a } },
  // furniture (goes to storage, place it in your house)
  sofa: { name: 'Sofa', price: 45000, cat: 'furniture' }, armchair: { name: 'Armchair', price: 15000, cat: 'furniture' },
  bed: { name: 'Bed', price: 60000, cat: 'furniture' }, tv: { name: 'Flat TV', price: 80000, cat: 'furniture' },
  table: { name: 'Coffee table', price: 12000, cat: 'furniture' }, dining: { name: 'Dining set', price: 35000, cat: 'furniture' },
  wardrobe: { name: 'Wardrobe', price: 30000, cat: 'furniture' }, fridge: { name: 'Fridge', price: 95000, cat: 'furniture' },
  cooker: { name: 'Gas cooker', price: 40000, cat: 'furniture' }, plant: { name: 'Potted plant', price: 3000, cat: 'furniture' },
  rug: { name: 'Rug', price: 8000, cat: 'furniture' }, shelf: { name: 'Bookshelf', price: 18000, cat: 'furniture' },
  fan: { name: 'Standing fan', price: 12000, cat: 'furniture' }, generator: { name: 'Generator', price: 120000, cat: 'furniture' },
  lamp: { name: 'Floor lamp', price: 7000, cat: 'furniture' }, frame: { name: 'Picture frame', price: 6000, cat: 'furniture' },
};
export const SHOP_STOCK = {
  food: ['jollof', 'amala', 'pounded', 'malt', 'water', 'zobo'],
  restaurant: ['jollof', 'friedRice', 'ofada', 'afang', 'edikang', 'pepperSoup', 'fish', 'smallChops', 'softDrink', 'chapman', 'water'],
  bar: ['chapman', 'palmWine', 'mocktail', 'softDrink', 'malt', 'water', 'suya', 'pepperSoup'],
  bakery: ['bread', 'puff', 'roll', 'malt', 'water'],
  drinks: ['zobo', 'chapman', 'malt', 'water', 'puff'],
  supermarket: ['rice', 'beans', 'garri', 'spaghetti', 'noodles', 'eggs', 'oil', 'onions', 'tomatoes', 'pepper', 'milk', 'sugar', 'bread', 'soap', 'detergent', 'malt', 'water', 'softDrink', 'roll'],
  boutique: ['ankaraRed', 'ankaraBlue', 'ankaraGold', 'gownPurple', 'gownGreen', 'laceWhite', 'kaftanWhite', 'kaftanGreen', 'agbadaBlue', 'jeans', 'chinos', 'blackTrousers', 'filaCap', 'faceCap', 'noHat'],
  furniture: ['sofa', 'armchair', 'bed', 'tv', 'table', 'dining', 'wardrobe', 'fridge', 'cooker', 'plant', 'rug', 'shelf', 'fan', 'lamp', 'frame', 'generator'],
  pharmacy: ['painkiller', 'vitamins', 'antimalaria', 'ors', 'firstaid', 'sanitizer', 'water'],
  electronics: ['airtime', 'powerbank'],
  salon: ['haircut'],
  print: ['printing'],
  kilishi: ['kilishi', 'suya', 'malt', 'water'],
  pos: [],
  tomatoes: ['tomatoes', 'pepper', 'onions'], pepper: ['pepper', 'tomatoes', 'onions'], yams: ['yam'], plantain: ['plantain'],
  onions: ['onions', 'pepper'], oranges: ['zobo', 'water'], basins: ['water'], fabric: ['ankaraRed', 'ankaraBlue', 'ankaraGold'],
  suya: ['suya', 'malt', 'water'],
};
export function shopCategory(name) {
  const n = name.toLowerCase();
  if (n.includes('boutique') || n.includes('fashion') || n.includes('lace')) return 'boutique';
  if (n.includes('furniture')) return 'furniture';
  if (n.includes('supermarket') || n.includes('provisions') || n.includes('mart')) return 'supermarket';
  if (n.includes('bakery')) return 'bakery';
  if (n.includes('restaurant') || n.includes('hotel')) return 'restaurant';
  if (n.includes('lounge') || n.includes('bar') || n.includes('club') || n.includes('parlour')) return 'bar';
  if (n.includes('kitchen') || n.includes('buka') || n.includes('canteen')) return 'food';
  if (n.includes('zobo') || n.includes('chapman')) return 'drinks';
  if (n.includes('kilishi')) return 'kilishi';
  if (n.includes('pharmacy')) return 'pharmacy';
  if (n.includes('phones') || n.includes('electronics')) return 'electronics';
  if (n.includes('salon') || n.includes('barbing')) return 'salon';
  if (n.includes('print')) return 'print';
  if (n.includes('pos')) return 'pos';
  return 'supermarket';
}
export const RECIPES = [
  { out: 'homeJollof', name: 'Jollof rice', needs: { rice: 1, tomatoes: 1, pepper: 1 } },
  { out: 'porridge', name: 'Yam porridge', needs: { yam: 1, oil: 1, pepper: 1 } },
  { out: 'dodo', name: 'Fried plantain', needs: { plantain: 1, oil: 1 } },
  { out: 'cookedNoodles', name: 'Noodles', needs: { noodles: 1 } },
];

export const eco = { bag: {}, store: {}, outfit: {}, closet: {}, tickets: [], car: null, wanted: 0, role: null, life: {}, work: null, house: {} };
/* Money. Online, the server wallet is the truth: every change here is batched and sent
   (earnings are capped per 10 minutes); the reply sets the real balance. */
let money = 50000, pendE = 0, pendS = 0, why = '', syncT = null, capWarned = 0;
Object.defineProperty(eco, 'money', {
  enumerable: true, get: () => money,
  set: v => { v = Math.round(v); const d = v - money; money = v; if (!online() || !d) return; d > 0 ? (pendE += d) : (pendS -= d); clearTimeout(syncT); syncT = setTimeout(syncWallet, 1500); },
});
export function setBalance(b) { money = Number(b) + pendE - pendS; paintWallet(); listeners.forEach(f => f(eco)); }
export async function syncWallet() {
  clearTimeout(syncT); if (!online() || (!pendE && !pendS)) return;
  const e = pendE, s = pendS, w = why || 'daily life'; pendE = pendS = 0; why = '';
  try {
    const r = await srv.sync(e, s, w); setBalance(r.balance);
    if (r.capped && Date.now() - capWarned > 120000) { capWarned = Date.now(); G.toast('You have earned all you can from street hustle for now. Real jobs on the Work app still pay.'); }
  } catch { pendE += e; pendS += s; syncT = setTimeout(syncWallet, 5000); }
}
const listeners = [];
export const onEco = fn => listeners.push(fn);
export const changed = () => { listeners.forEach(f => f(eco)); paintWallet(); save(); };
const $ = id => document.getElementById(id);

let ref = null, saveT = null;
export async function initEconomy() {
  try {
    if (net.db && net.me.id) {
      ref = net.db.doc(`data/users/${net.me.id}/profile`);
      const s = await ref.get();
      if (srv?.wallet) try { money = Number(await srv.wallet()); srv.live = true; } catch (e) { console.warn('Wallet not ready: run the latest supabase/schema.sql', e); }
      if (s.exists) Object.assign(eco, pickSaved(s.data()));
      else if (!G.profile) { try { const l = JSON.parse(localStorage.getItem('abuja.eco') || 'null'); if (l) Object.assign(eco, pickSaved(l)); } catch { } }
    } else { const l = JSON.parse(localStorage.getItem('abuja.eco') || 'null'); if (l) Object.assign(eco, pickSaved(l)); }
  } catch { }
  paintWallet(); listeners.forEach(f => f(eco));
}
const SAVED = ['bag', 'store', 'outfit', 'closet', 'wearing', 'tickets', 'car', 'role', 'life', 'work', 'house', 'land'];
function pickSaved(d) { const o = {}; SAVED.forEach(k => { if (d[k] !== undefined) o[k] = d[k]; }); if (!online() && typeof d.money === 'number' && isFinite(d.money)) money = d.money; return o; }
function save() { clearTimeout(saveT); saveT = setTimeout(writeSave, 1200); }
function writeSave() {
  const data = Object.fromEntries(SAVED.map(k => [k, eco[k] ?? null])); data.tickets = eco.tickets.slice(-10);
  if (!online()) data.money = Math.round(money);
  if (!G.profile) try { localStorage.setItem('abuja.eco', JSON.stringify(data)); } catch { }
  if (ref && net.canWrite) return ref.set(data).catch(() => { });
}
/* write now (before the server reads your money, e.g. to pay an election form) */
export async function flushSave() { clearTimeout(saveT); await writeSave(); }
export function paintWallet() { const w = $('wallet'); if (w) w.textContent = naira(eco.money); }
export function earn(n, w) { why = w || why; eco.money += n; changed(); G.toast(`+${naira(n)} ${w || ''}`.trim()); }
export function spend(n) { if (eco.money < n) return false; eco.money -= n; changed(); return true; }
export const has = (id, n = 1) => (eco.bag[id] || 0) >= n;
export function addItem(id, n = 1) { eco.bag[id] = (eco.bag[id] || 0) + n; changed(); }
export function takeItem(id, n = 1) { if (!has(id, n)) return false; eco.bag[id] -= n; if (eco.bag[id] <= 0) delete eco.bag[id]; changed(); return true; }
export function addFurn(t, n = 1) { eco.store[t] = (eco.store[t] || 0) + n; changed(); }
export function takeFurn(t) { if (!(eco.store[t] > 0)) return false; eco.store[t]--; if (!eco.store[t]) delete eco.store[t]; changed(); return true; }
export function addTicket(tk) { eco.tickets.push(tk); changed(); }
export function useTicket(dest) { const i = eco.tickets.findIndex(t => t.dest === dest); if (i < 0) return null; const [t] = eco.tickets.splice(i, 1); changed(); return t; }
export function setOwnedCar(c) { eco.car = c; changed(); }

export const priceOf = it => Math.round((it.price || 0) * (G.priceMult?.() || 1) * (1 + (G.policy?.market_levy || 0)) / 10) * 10;
export function eat(id) {
  const it = ITEMS[id]; if (!it?.energy || !takeItem(id)) return false;
  energy.v = Math.min(100, energy.v + it.energy); saveEnergy(); G.track?.('eat');
  G.toast(`You ate ${it.name.toLowerCase()}. +${it.energy} energy`); return true;
}

/* buying: food goes in your bag, clothes go on, furniture goes to storage */
export function buy(id, onWear) {
  const it = ITEMS[id]; if (!it) return false;
  const cost = priceOf(it);
  if (cost && !spend(cost)) { G.toast(`Not enough money. You have ${naira(eco.money)}`); return false; }
  G.track?.('buy');
  if (it.cat === 'outfit') { if (it.price && G.addClothes) G.addClothes(id); else { eco.outfit = { ...eco.outfit, ...it.outfit }; if (it.outfit.hat === 'none') delete eco.outfit.hatColor; changed(); } onWear?.(eco.outfit); G.toast(`You are now wearing: ${it.name.toLowerCase()}${it.price ? '. It is in your wardrobe too.' : ''}`); }
  else if (it.cat === 'furniture') { addFurn(id); G.toast(`${it.name} bought. Place it from your house (press E inside: "Arrange house")`); }
  else if (it.cat === 'service') G.toast(id === 'haircut' ? 'Fresh cut! You look sharp.' : 'Done.');
  else { addItem(id); G.toast(`Bought ${it.name.toLowerCase()} for ${naira(cost)}`); }
  return true;
}

/* shop panel */
let shopOpenFor = null;
export function openShop(title, stockKey, opts = {}) {
  const list = SHOP_STOCK[stockKey] || [], panel = $('shop');
  shopOpenFor = stockKey;
  $('shopTitle').textContent = title; $('shopSub').textContent = opts.sub || '';
  const render = () => {
    $('shopMoney').textContent = naira(eco.money);
    $('shopList').innerHTML = list.length ? list.map(id => {
      const it = ITEMS[id], own = it.cat === 'furniture' ? (eco.store[id] || 0) : (eco.bag[id] || 0);
      return `<div class="shop-row"><div><b>${it.name}</b><small>${it.energy ? `+${it.energy} energy` : it.cat === 'ingredient' ? 'For cooking at home' : it.cat === 'furniture' ? 'For your house' : it.cat === 'outfit' ? 'Wear it' : ''}${own ? ` · You have ${own}` : ''}</small></div><button class="mini-btn" data-buy="${id}">${it.price ? naira(priceOf(it)) : 'Free'}</button></div>`;
    }).join('') : `<p class="ph-empty">${opts.empty || 'Nothing for sale here.'}</p>`;
    // eat directly from the bag in food places
    const foods = Object.keys(eco.bag).filter(k => ITEMS[k]?.energy);
    $('shopBag').innerHTML = foods.length ? `<div class="ph-sec">Eat now</div>` + foods.map(k => `<button class="chip" data-eat="${k}">${ITEMS[k].name} ×${eco.bag[k]}</button>`).join('') : '';
  };
  panel.onclick = e => {
    const b = e.target.closest('[data-buy]'), f = e.target.closest('[data-eat]');
    if (b) { if (buy(b.dataset.buy, opts.onWear)) G.Sound?.buy(false); render(); }
    if (f) { eat(f.dataset.eat); render(); }
    if (e.target.id === 'shopClose') { panel.hidden = true; shopOpenFor = null; document.getElementById('c').focus(); }
  };
  render(); panel.hidden = false;
}
export const shopOpen = () => !$('shop').hidden;

/* work a shift at an office */
export async function workShift(place) {
  if (energy.v < 20) { G.toast('You are too tired to work. Rest first.'); return; }
  const pay = 15000;
  await fade(() => { energy.v = Math.max(0, energy.v - 25); saveEnergy(); }, 900);
  earn(pay, `for a shift at ${place}`); G.practice?.(place);
}

/* bag and cooking menus used by the phone and the house */
export function bagSummary() {
  const rows = Object.entries(eco.bag).filter(([k, n]) => n > 0 && ITEMS[k]);
  return rows.map(([k, n]) => ({ id: k, n, ...ITEMS[k] }));
}
export async function cookMenu() {
  const can = RECIPES.filter(r => Object.entries(r.needs).every(([k, n]) => has(k, n)));
  const choices = RECIPES.map(r => ({ label: `${r.name}`, value: r.out, disabled: !can.includes(r) })).concat([{ label: 'Close', value: null }]);
  const pick = await dialog('Gas cooker', can.length ? 'What do you want to cook?' : 'You need ingredients. Buy rice, tomatoes, pepper, yam, plantain, oil or noodles at the market or supermarket.', choices);
  const r = RECIPES.find(x => x.out === pick); if (!r) return;
  if (G.upkeep && !G.upkeep.useWater(10)) return;
  await fade(() => { Object.entries(r.needs).forEach(([k, n]) => takeItem(k, n)); addItem(r.out); }, 900);
  G.toast(`${ITEMS[r.out].name} is ready. Eat it from your fridge or bag.`);
}
export async function fridgeMenu() {
  const foods = Object.keys(eco.bag).filter(k => ITEMS[k]?.energy);
  const pick = await dialog('Fridge', foods.length ? 'What do you want to eat?' : 'Your fridge is empty. Restock at the supermarket or market, or cook.', foods.map(k => ({ label: `${ITEMS[k].name} ×${eco.bag[k]}`, value: k })).concat([{ label: 'Close', value: null }]));
  if (pick) eat(pick);
}

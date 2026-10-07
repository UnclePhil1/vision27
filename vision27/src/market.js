import { G, naira, dialog, fade } from './game.js';
import { eco, changed, setBalance, syncWallet, ITEMS, addItem, spend, priceOf, has, takeItem } from './economy.js';
import { srv, online } from './server.js';

/* Markets, fuel and the wardrobe.
   - Building materials, tools and fuel are priced and stored on the server (they feed builds and trades).
   - Prices move with the midday shock, the market levy and the fuel price set by office holders.
   - Clothes go into a wardrobe. Worn clothes wear out; wash them with detergent or restock. */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const err = e => G.toast(e?.message || 'Something went wrong');
export const inv = { list: [], have: {} };            // server goods and what I hold
G.policy = { fuel: 1, market_levy: 0 };

export async function loadGoods() { try { inv.list = (await srv.prices()) || []; inv.have = Object.fromEntries(inv.list.map(g => [g.id, g.have])); } catch { } return inv.list; }
export const holds = (id, n = 1) => (inv.have[id] || 0) >= n;
export async function useGoods(id, n = 1) { const left = await srv.use(id, n); inv.have[id] = left; return left; }
export async function loadPolicies() {
  try { const rows = (await srv.policies()) || []; G.policy = { fuel: 1, market_levy: 0 }; rows.forEach(r => (G.policy[r.key] = +r.value)); } catch { }
}

/* ---------------- goods panel (reuses the shop panel) ---------------- */
export async function openGoods(title, cats, opts = {}) {
  const panel = $('shop');
  $('shopTitle').textContent = title; $('shopSub').textContent = opts.sub || 'Prices change at midday and with city policy.';
  $('shopList').innerHTML = '<p class="ph-empty">Loading prices…</p>'; $('shopBag').innerHTML = ''; panel.hidden = false;
  await syncWallet();
  const render = async () => {
    await loadGoods();
    $('shopMoney').textContent = naira(eco.money);
    const fee = opts.delivery || 0;
    $('shopList').innerHTML = inv.list.filter(g => cats.includes(g.cat)).map(g => `<div class="shop-row"><div><b>${esc(g.name)}</b><small>${g.cat === 'tool' ? `Needed for ${esc(g.skill)} jobs` : g.cat === 'fuel' ? 'For cars and generators' : 'For building and repairs'}${g.have ? ` · You have ${g.have}` : ''}</small></div>
      <span class="buy2"><button class="mini-btn" data-buy="${g.id}" data-n="1">${naira(g.price + fee)}</button>${g.cat === 'material' ? `<button class="mini-btn ghost" data-buy="${g.id}" data-n="5">×5</button>` : ''}</span></div>`).join('');
  };
  panel.onclick = async e => {
    const b = e.target.closest('[data-buy]');
    if (b) {
      b.disabled = true;
      try {
        if (opts.delivery && !spend(opts.delivery)) throw new Error('Not enough for the delivery fee');
        await syncWallet();
        const r = await srv.buy(b.dataset.buy, +b.dataset.n); if (online()) setBalance(r.balance);
        G.track?.('buy'); G.Sound?.buy?.(false); G.toast(`${opts.delivery ? 'Ordered' : 'Bought'} for ${naira(r.cost)}. You have ${r.qty}.`);
      } catch (x) { err(x); }
      render();
    }
    if (e.target.id === 'shopClose') { panel.hidden = true; document.getElementById('c').focus(); }
  };
  render();
}

/* ---------------- fuel station: subsidy means cheap fuel and long queues ---------------- */
async function fuelStation() {
  const sub = G.policy.fuel < 1, rush = G.phase?.() === 'morning', wait = 900 + (sub ? 2200 : 0) + (rush ? 1500 : 0);
  if (sub || rush) G.toast(sub ? 'Fuel is subsidised, so the queue is long…' : 'Morning rush: the fuel queue is long…');
  await fade(null, wait);
  openGoods('Unity Fuel', ['fuel'], { sub: `Pump price: ${Math.round(G.policy.fuel * 100)}% of normal. Fuel goes into your stock for your car or generator.` });
}

/* ---------------- wardrobe ---------------- */
const parts = it => Object.keys(it.outfit || {}).filter(k => k !== 'hatColor');
export function addClothes(id) {
  eco.closet ||= {}; eco.closet[id] = { wear: 100 };
  wearClothes(id);
}
export function wearClothes(id) {
  const it = ITEMS[id]; if (!it?.outfit) return;
  eco.wearing = (eco.wearing || []).filter(w => !parts(ITEMS[w] || {}).some(p => parts(it).includes(p)));
  if (it.outfit.hat !== 'none') eco.wearing.push(id);
  eco.outfit = { ...eco.outfit, ...it.outfit }; if (it.outfit.hat === 'none') delete eco.outfit.hatColor;
  changed();
}
function takeOff(id) {
  eco.wearing = (eco.wearing || []).filter(w => w !== id);
  parts(ITEMS[id] || {}).forEach(p => { delete eco.outfit[p]; if (p === 'hat') delete eco.outfit.hatColor; });
  changed();
}
export async function openWardrobe() {
  const c = eco.closet || {}, ids = Object.keys(c).filter(id => ITEMS[id]);
  if (!ids.length) return dialog('Wardrobe', 'Your wardrobe is empty. Buy clothes at Gloria Fashion Home, Ankara Boutique or the Lace & Aso-Oke House.', [{ label: 'Close', value: null }]);
  const pick = await dialog('Wardrobe', 'Clothes wear out as you wear them. Wash them with detergent to freshen them up.', ids.map(id => ({ label: `${(eco.wearing || []).includes(id) ? '✓ ' : ''}${ITEMS[id].name} · ${Math.round(c[id].wear)}%`, value: id })).concat([{ label: 'Close', value: null }]));
  if (!pick) return;
  const on = (eco.wearing || []).includes(pick);
  const act = await dialog(ITEMS[pick].name, `Condition ${Math.round(c[pick].wear)}%`, [{ label: on ? 'Take it off' : 'Wear it', value: on ? 'off' : 'on' }, { label: has('detergent') ? 'Wash it (uses detergent)' : 'Wash it (buy detergent first)', value: 'wash', disabled: !has('detergent') }, { label: 'Give it away', value: 'give' }, { label: 'Back', value: null }]);
  if (act === 'on') wearClothes(pick); else if (act === 'off') takeOff(pick);
  else if (act === 'wash' && takeItem('detergent')) { c[pick].wear = Math.min(100, c[pick].wear + 45); changed(); G.toast('Washed and ironed. Looking fresh.'); }
  else if (act === 'give') { takeOff(pick); delete c[pick]; changed(); G.toast('You gave it to someone who needs it.'); }
  if (act) openWardrobe();
}
/* worn clothes lose condition; at 0 they are worn out */
let wearT = 0;
function wearDown(dt) {
  wearT += dt; if (wearT < 120) return; wearT = 0;
  (eco.wearing || []).slice().forEach(id => { const w = eco.closet?.[id]; if (!w) return; w.wear -= 3; if (w.wear <= 0) { takeOff(id); delete eco.closet[id]; G.toast(`Your ${ITEMS[id].name.toLowerCase()} is worn out. Time to restock your wardrobe.`); } });
  changed();
}

/* ---------------- Market app: order to your door (from level 2) ---------------- */
const GROCERIES = ['rice', 'beans', 'garri', 'tomatoes', 'pepper', 'oil', 'yam', 'plantain', 'noodles', 'eggs', 'detergent', 'soap'];
const DEPOT = ['rice', 'beans', 'garri', 'tomatoes', 'oil', 'noodles', 'eggs'];      // these come through the depot floor online
/* delivered depot food lands in your server stock; move it into your bag */
async function collect() {
  if (!online()) return; await loadGoods();
  for (const g of inv.list.filter(x => x.cat === 'food' && x.have > 0 && ITEMS[x.id])) { try { await srv.use(g.id, g.have); addItem(g.id, g.have); G.toast(`Your ${ITEMS[g.id].name.toLowerCase()} was delivered (${g.have}).`); } catch { } }
}
async function deliveries(el) {
  if (!online() || !el) return;
  let list = []; try { list = (await srv.myOrders()) || []; } catch { }
  const word = { open: 'Waiting to be picked', picked: 'Picked, waiting to be packed', packed: 'Packed, waiting for the truck', dispatched: 'Delivered', short: 'Short at the depot' };
  el.innerHTML = list.length ? '<div class="ph-sec">My deliveries</div>' + list.slice(0, 6).map(o => `<div class="row-th"><span class="th-main"><b>${o.lines.map(l => `${l.qty} ${esc(l.item)}`).join(', ')}</b><small>${word[o.state] || esc(o.state)}${o.kind === 'site' ? ' · to your building site' : ''}</small></span></div>`).join('') : '';
}
function renderMarket(body, rerender) {
  const lv = eco.life?.level || 1;
  if (lv < 2) { body.innerHTML = '<div class="ph-card"><b>Delivery unlocks at level 2</b><small>Until then, walk to Unity Market, a supermarket or the fuel station.</small></div>'; return; }
  body.innerHTML = `<div class="ph-card"><b>Order to your door</b><small>Groceries ₦1,500 delivery. Materials, tools and fuel ₦3,000 delivery. Prices follow the city.</small></div>
    <div class="ph-sec">Groceries</div>` + GROCERIES.map(id => `<button class="row-th" data-g="${id}"><span class="th-main"><b>${esc(ITEMS[id].name)}</b><small>You have ${eco.bag[id] || 0}</small></span><span class="mini-btn">${naira(priceOf(ITEMS[id]) + 1500)}</span></button>`).join('')
    + '<div id="mkDel"></div>' + `<div class="ph-sec">Building, tools and fuel</div><button class="row-th" id="mkGoods"><span class="th-main"><b>Open the materials market</b><small>Cement, blocks, tiles, cable, pipes, tools, petrol…</small></span><span class="mini-btn">Browse</span></button>`;
  collect().then(() => deliveries(body.querySelector('#mkDel')));
  body.querySelectorAll('[data-g]').forEach(b => b.onclick = async () => {
    const id = b.dataset.g, cost = priceOf(ITEMS[id]) + 1500;
    if (online() && DEPOT.includes(id)) {
      try { await syncWallet(); const r = await srv.orderDelivery(id, 1, null); setBalance(r.balance); G.toast('Ordered. Workers at the Kwik Dispatch depot pick, pack and load it. It lands in your bag when it is delivered.'); } catch (e) { err(e); }
      return rerender();
    }
    if (!spend(cost)) return G.toast(`Not enough money. You have ${naira(eco.money)}`);
    G.toast(`Ordered ${ITEMS[id].name.toLowerCase()}. It arrives in about an hour (city time).`);
    setTimeout(() => { addItem(id); G.toast(`Your ${ITEMS[id].name.toLowerCase()} was delivered.`); }, 60000);
    rerender();
  });
  body.querySelector('#mkGoods').onclick = () => { G.closePhone?.(); openGoods('Materials market (delivery)', ['material', 'tool', 'fuel'], { delivery: 3000, sub: 'Delivered to you. ₦3,000 delivery per order.' }); };
}

export function initMarket(spots) {
  G.phoneApps.market = { name: 'Market', glyph: '🧺', color: '#b5651d', render: renderMarket };
  G.loadPolicies = loadPolicies; G.openWardrobe = openWardrobe; G.addClothes = addClothes;
  const stall = { x: -96, z: 40 }, fuel = spots.fuel;
  G.actionProviders.push((p, out, inside) => {
    if (inside) return;
    out(Math.hypot(p.x - stall.x, p.z - stall.z) - 7, { label: 'Building materials and tools', run: () => openGoods('Unity Market · building and tools', ['material', 'tool']) });
    if (fuel && !G.player.car) out(Math.hypot(p.x - fuel.x, p.z - fuel.z) - 4, { label: 'Buy fuel', run: fuelStation });
  });
  loadPolicies(); setInterval(loadPolicies, 60000); setInterval(collect, 60000);
  loadGoods();
}
export function updateMarket(dt) { wearDown(dt); }

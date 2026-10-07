import * as THREE from 'three';
import { G, naira, dialog, fade } from './game.js';
import { eco, changed, ITEMS, priceOf, spend, earn } from './economy.js';
import { net, meId } from './net.js';
import { srv, online, levelOf, SKILLS } from './server.js';
import { holds, useGoods, loadGoods } from './market.js';
import { appliances, refurnish, houseNow, saveLayout } from './house.js';
import { style } from './life.js';

/* Keeping a house: power, water, spoilt fittings, an empty kitchen and wardrobe.
   Spoilt things stop working until someone repairs them: you (with the skill and tools),
   a player you hire through Work, or a new one from the shop. Plus photo frames on the walls. */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const err = e => G.toast(e?.message || 'Something went wrong');
const H = () => { const h = (eco.house ||= {}); h.water ??= 80; h.gen ??= 0; h.jobs ||= {}; return h; };
const TRADE = { tv: 'electrician', fan: 'electrician', fridge: 'electrician', lamp: 'electrician', cooker: 'plumber', generator: 'mechanic', bed: 'carpenter', sofa: 'carpenter', armchair: 'carpenter', wardrobe: 'carpenter', dining: 'carpenter', shelf: 'carpenter', table: 'carpenter' };
const TOOL = { electrician: 'toolbox', mechanic: 'spanners', carpenter: 'saw', plumber: 'wrench' };
export const cond = l => l.c ?? 100;

/* ---------------- wear and breakdowns ---------------- */
export function blocked(f) { return TRADE[f.l.t] && cond(f.l) <= 0 ? `The ${ITEMS[f.l.t].name.toLowerCase()} is spoilt.` : null; }
export function wearThing(f, n) {
  if (!TRADE[f.l.t] || houseNow()?.owner !== meId()) return;
  const was = cond(f.l); f.l.c = Math.max(0, was - n);
  if (f.l.c < 35 && Math.random() < .2) f.l.c = 0;
  if (f.l.c === 0 && was > 0) G.toast(`Ah! The ${ITEMS[f.l.t].name.toLowerCase()} has spoilt. Open it to fix or replace it.`);
  saveLayout(true);
}
const myLayout = () => (net.homes.get(meId())?.furn || []).map(l => ({ ...l }));
const spoilt = () => myLayout().map((l, i) => ({ l, i })).filter(o => TRADE[o.l.t] && cond(o.l) <= 0);
async function setCond(i, c) { const lay = myLayout(); if (!lay[i]) return; lay[i].c = c; await net.saveHome?.({ furn: lay }); refurnish(); }

/* what to do with a spoilt thing */
export async function repairMenu(i) {
  const l = myLayout()[i]; if (!l) return;
  const it = ITEMS[l.t], trade = TRADE[l.t], tool = TOOL[trade], myLv = levelOf(G.work?.prof?.skills?.[trade] || 0);
  await loadGoods();
  const canSelf = myLv >= 1 && holds(tool), pay = Math.round(it.price * .2 / 500) * 500 || 2000, pending = Object.values(H().jobs).some(j => j.i === i);
  const pick = await dialog(`Spoilt ${it.name.toLowerCase()}`, pending ? 'A repairer is booked. They will come at the time you set.' : `A ${SKILLS[trade].toLowerCase()} can fix this. Repairing is cheaper than buying new.`, [
    { label: canSelf ? 'Fix it yourself (uses 1 spare parts box)' : `Fix it yourself (needs ${SKILLS[trade]} Apprentice + tools)`, value: 'self', disabled: !canSelf },
    { label: online() ? `Hire a ${SKILLS[trade].toLowerCase()} (${naira(pay)})` : 'Hire a repairer (online version)', value: 'hire', disabled: !online() || pending },
    { label: `Replace it (${naira(priceOf(it))})`, value: 'new' },
    { label: `Sell as scrap (${naira(it.price * .1)})`, value: 'scrap' },
    { label: 'Leave it', value: null }]);
  if (pick === 'self') {
    if (!holds('parts')) return G.toast('Buy a spare parts box at Unity Market first');
    try { await useGoods('parts', 1); await fade(null, 1400); await setCond(i, 100); style(1); G.toast(`You fixed the ${it.name.toLowerCase()} yourself.`); } catch (e) { err(e); }
  } else if (pick === 'hire') hireRepair(i, l, trade, pay);
  else if (pick === 'new') { if (!spend(priceOf(it))) return G.toast(`Not enough money. You have ${naira(eco.money)}`); await setCond(i, 100); G.toast(`A new ${it.name.toLowerCase()} is in place.`); }
  else if (pick === 'scrap') { const lay = myLayout(); lay.splice(i, 1); await net.saveHome?.({ furn: lay }); refurnish(); earn(Math.round(it.price * .1), 'for scrap'); }
}
async function hireRepair(i, l, trade, pay) {
  const home = G.homeGate?.(); if (!home) return G.toast('You need a house first');
  const start = (Math.floor(((Date.now() / 60000) + 7) % 24) + 2) % 24;
  try {
    const id = await srv.post({ source: 'own', kind: 'trade', title: `Fix my ${ITEMS[l.t].name.toLowerCase()}`, skill: trade, min_level: 1, pay, unit: 'job', start_hour: start, hours: 1, days: 1, slots: 1, place: 'My house', x: home.x, z: home.z, moral: 'clean', meta: { repair: l.t, home: true } });
    H().jobs[id] = { i, t: l.t }; changed(); style(2);
    if (online()) G.toast(`Posted on the Work app. Hire a ${SKILLS[trade].toLowerCase()} from the applicants. They work at your gate.`);
  } catch (e) { err(e); }
}
/* a hired repair is done when its shift is done */
async function checkRepairs() {
  const jobs = H().jobs; if (!online() || !Object.keys(jobs).length) return;
  try {
    const posts = (await srv.posts()) || [];
    for (const p of posts) {
      const j = jobs[p.id]; if (!j) continue;
      if (p.done > 0) {
        const lay = myLayout(), idx = lay[j.i]?.t === j.t ? j.i : lay.findIndex(l => l.t === j.t && cond(l) <= 0);
        if (idx >= 0) await setCond(idx, 100);
        delete jobs[p.id]; changed(); srv.close(p.id).catch(() => { });
        G.toast(`Your ${ITEMS[j.t].name.toLowerCase()} was repaired.`);
      } else if (!p.open) { delete jobs[p.id]; changed(); }
    }
  } catch { }
}

/* ---------------- water and the generator ---------------- */
export function useWater(n) { if (H().water < n) { G.toast('No water in the tank. Order a water tanker from the My House app.'); return false; } H().water -= n; changed(); return true; }
async function orderWater() {
  if (H().water > 90) return G.toast('Your tank is full');
  if (!spend(8000)) return G.toast('A water tanker costs ₦8,000');
  G.toast('The water tanker is on its way…'); setTimeout(() => { H().water = 100; changed(); G.toast('Your water tank is full again.'); }, 20000);
}
export async function fillGenerator() {
  await loadGoods();
  if (!holds('petrol')) return G.toast('You need petrol. Buy it at Unity Fuel.');
  try { await useGoods('petrol', 1); H().gen = 100; changed(); G.toast('Generator filled with 10 litres of petrol.'); } catch (e) { err(e); }
}
export function generatorReady() { if (H().gen > 0) return true; G.toast('The generator has no fuel.'); fillGenerator(); return false; }

let tickT = 0, repT = 20;
export function updateUpkeep(dt) {
  tickT += dt; repT -= dt;
  if (repT <= 0) { repT = 30; checkRepairs(); }
  if (appliances.generator && (tickT % 6) < dt) { H().gen = Math.max(0, H().gen - 1); if (!H().gen) { appliances.generator = false; G.toast('The generator has run out of fuel.'); } }
  if (tickT > 150) { tickT = 0; H().water = Math.max(0, H().water - 1); changed(); }
  if ((tickT % 1) < dt) paintHomeChip();
}
function status() {
  const lay = myLayout(), food = Object.keys(eco.bag).filter(k => ITEMS[k]?.energy || ITEMS[k]?.cat === 'ingredient').reduce((a, k) => a + eco.bag[k], 0);
  return { power: G.outage ? (appliances.generator ? `Generator ${H().gen}%` : 'NEPA took light') : 'NEPA on', water: Math.round(H().water), food, clothes: Object.keys(eco.closet || {}).length, spoilt: spoilt().length, hasGen: lay.some(l => l.t === 'generator') };
}
function paintHomeChip() {
  const el = $('homeChip'); if (!el) return;
  el.hidden = !G.inMyHouse?.(); if (el.hidden) return;
  const s = status();
  el.innerHTML = `<b>Home</b> · ${s.power} · Water ${s.water}% · Food ${s.food} · Clothes ${s.clothes}${s.spoilt ? ` · <i>${s.spoilt} spoilt</i>` : ''}`;
}

/* ---------------- photo frames ---------------- */
const local = id => id?.startsWith('local-');
const loader = new THREE.TextureLoader(), texCache = new Map();
function waitingTex(text) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#e9e2d2'; g.fillRect(0, 0, 256, 256); g.fillStyle = '#7a6f5c'; g.textAlign = 'center'; g.font = '600 22px system-ui'; g.fillText(text, 128, 132);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/* the picture for a frame: owners see their own; visitors only approved photos */
export async function frameTexture(id, owner) {
  if (!id) return waitingTex('Empty frame');
  if (texCache.has(id)) return texCache.get(id);
  let url = null, label = 'Under review';
  try {
    if (local(id)) url = localStorage.getItem('v27.frame.' + id);
    else if (srv?.frameInfo) { const [f] = await srv.frameInfo([id]); if (f && f.status !== 'removed' && f.status !== 'rejected' && (f.status === 'approved' || f.owner === meId())) url = await srv.frameUrl(f.path); else if (f && (f.status === 'rejected' || f.status === 'removed')) label = 'Photo removed'; }
  } catch { }
  const tex = url ? await new Promise(res => loader.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, () => res(waitingTex('Could not load')))) : waitingTex(label);
  texCache.set(id, tex); return tex;
}
/* pick a photo, crop it square, shrink it, upload it */
export function choosePhoto() {
  return new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp';
    inp.onchange = () => { const file = inp.files[0]; if (!file) return res(null); if (file.size > 15e6) { G.toast('That photo is too big'); return res(null); } cropPhoto(file).then(res); };
    inp.click();
  });
}
function cropPhoto(file) {
  return new Promise(res => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const box = document.createElement('div'); box.className = 'cropper';
      box.innerHTML = `<div class="crop-card"><b>Crop your photo</b><small>Drag to move. Use the slider to zoom. Visitors see it after a moderator checks it.</small><canvas width="280" height="280"></canvas><input type="range" min="1" max="3" step=".01" value="1" aria-label="Zoom"><div class="row"><button class="cta ghost" data-x="no">Cancel</button><button class="cta" data-x="ok">Use photo</button></div></div>`;
      document.body.appendChild(box);
      const cv = box.querySelector('canvas'), g = cv.getContext('2d'), zoom = box.querySelector('input');
      let z = 1, ox = 0, oy = 0, drag = null;
      const base = 280 / Math.min(img.width, img.height);
      const draw = (ctx, size) => { const k = base * z * size / 280, w = img.width * k, h = img.height * k; const mx = Math.max(0, (w - size) / 2), my = Math.max(0, (h - size) / 2); ox = Math.max(-mx, Math.min(mx, ox)); oy = Math.max(-my, Math.min(my, oy)); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size); ctx.drawImage(img, (size - w) / 2 + ox * size / 280, (size - h) / 2 + oy * size / 280, w, h); };
      const paint = () => draw(g, 280); paint();
      zoom.oninput = () => { z = +zoom.value; paint(); };
      cv.onpointerdown = e => { drag = { x: e.clientX - ox, y: e.clientY - oy }; cv.setPointerCapture(e.pointerId); };
      cv.onpointermove = e => { if (drag) { ox = e.clientX - drag.x; oy = e.clientY - drag.y; paint(); } };
      cv.onpointerup = () => (drag = null);
      box.onclick = e => {
        const x = e.target.dataset.x; if (!x) return;
        const out = document.createElement('canvas'); out.width = out.height = 512; if (x === 'ok') draw(out.getContext('2d'), 512);
        box.remove(); URL.revokeObjectURL(url);
        if (x !== 'ok') return res(null);
        out.toBlob(b => res(b), 'image/jpeg', .82);
      };
    };
    img.onerror = () => { G.toast('Could not read that photo'); res(null); };
    img.src = url;
  });
}
export async function uploadPhoto(blob) {
  if (!blob) return null;
  if (blob.size > 300 * 1024) { G.toast('That photo is still too big after shrinking'); return null; }
  if (online()) { try { const r = await srv.uploadFrame(blob); G.toast('Photo saved. You can see it now. Visitors will see it once a moderator approves it.'); return r.id; } catch (e) { err(e); return null; } }
  const id = 'local-' + Date.now().toString(36), data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  try { localStorage.setItem('v27.frame.' + id, data); } catch { G.toast('No room to save the photo here'); return null; }
  return id;
}
async function reportPhoto(id) {
  const why = await dialog('Report this photo?', 'Moderators will check it. It stays hidden from visitors while they review it if others report it too.', [{ label: 'It is offensive', value: 'offensive' }, { label: 'It shows a private person', value: 'privacy' }, { label: 'It is spam or an advert', value: 'spam' }, { label: 'Cancel', value: null }]);
  if (!why) return;
  try { await srv.reportFrame(id, why); G.toast('Thank you. A moderator will look at it.'); } catch (e) { err(e); }
}

/* ---------------- My House app (and the moderators' Review app) ---------------- */
function renderHouse(body, rerender) {
  if (!net.homes.get(meId())) { body.innerHTML = '<div class="ph-card"><b>No house yet</b><small>Walk to a house gate with a FREE sign in Gwarinpa or Nyanya and press E to claim it. Maitama mansions are for sale. You can also buy land and build your own on the Land app.</small></div>'; return; }
  const s = status(), sp = spoilt();
  body.innerHTML = `<div class="ph-card"><b>House ${net.homes.get(meId()).house + 1}</b><small>Power: ${s.power} · Water ${s.water}% · Food ${s.food} · Clothes ${s.clothes}</small><div class="xpbar"><i style="width:${s.water}%"></i></div></div>
    <button class="row-th" id="hWater"><span class="th-main"><b>Order a water tanker</b><small>Cooking uses water. The tank runs down over time.</small></span><span class="mini-btn">${naira(8000)}</span></button>
    ${s.hasGen ? `<button class="row-th" id="hGen"><span class="th-main"><b>Fill the generator</b><small>Fuel ${H().gen}% · uses 10 L petrol from your stock</small></span><span class="mini-btn">Fill</span></button>` : '<p class="ph-note">No generator. When NEPA takes light, the house goes dark. Buy one at Furniture Palace.</p>'}
    <div class="ph-sec">Repairs</div>${sp.length ? sp.map(o => `<button class="row-th" data-fix="${o.i}"><span class="th-main"><b>${esc(ITEMS[o.l.t].name)} is spoilt</b><small>${Object.values(H().jobs).some(j => j.i === o.i) ? 'Repairer booked' : 'Fix, hire, replace or sell'}</small></span><span class="mini-btn">Sort it</span></button>`).join('') : '<p class="ph-empty">Everything works.</p>'}
    <div class="ph-sec">Kitchen and wardrobe</div><p class="ph-note">${s.food ? `${s.food} food items in the house.` : 'The kitchen is empty. Restock at the market or order from the Market app.'} ${s.clothes ? `${s.clothes} clothes in the wardrobe.` : 'The wardrobe is empty.'}</p>
    <button class="chip" id="hWard">Open wardrobe</button>
    <div class="ph-sec">Wall colour</div><div class="swatches">${['#f2e3c6', '#dcebd8', '#f3d1c4', '#d6e3f0', '#efe0a8', '#e6d6f0'].map(c => `<button class="sw${(net.homes.get(meId()).paint || '#f2e3c6') === c ? ' on' : ''}" data-paint="${c}" style="background:${c}" aria-label="Paint ${c}"></button>`).join('')}</div>
    <div class="row2"><button class="cta" data-act="gohome">Go home</button><button class="cta ghost" data-act="arrange">Arrange furniture</button></div>`;
  body.querySelector('#hWater').onclick = async () => { await orderWater(); rerender(); };
  const gb = body.querySelector('#hGen'); if (gb) gb.onclick = async () => { await fillGenerator(); rerender(); };
  body.querySelectorAll('[data-fix]').forEach(b => b.onclick = async () => { G.closePhone?.(); await repairMenu(+b.dataset.fix); });
  body.querySelector('#hWard').onclick = () => { G.closePhone?.(); G.openWardrobe?.(); };
}
async function renderReview(body, rerender) {
  body.innerHTML = '<p class="ph-empty">Loading…</p>';
  try {
    const q = (await srv.frameQueue()) || [];
    const urls = await Promise.all(q.map(f => srv.frameUrl(f.path)));
    body.innerHTML = `<div class="ph-card"><b>Photo review</b><small>${q.length} waiting. Approve only photos that are fine for everyone.</small></div>` + q.map((f, i) => `<div class="job"><img class="rev-img" src="${esc(urls[i] || '')}" alt="Photo from ${esc(f.owner_name)}"><small>${esc(f.owner_name)} · ${f.reports} reports</small>
      <div class="job-btns"><button class="mini-btn" data-rv="${f.id}" data-s="approved">Approve</button><button class="mini-btn ghost" data-rv="${f.id}" data-s="rejected">Reject</button><button class="mini-btn ghost" data-rv="${f.id}" data-s="removed">Take down</button></div></div>`).join('');
    body.querySelectorAll('[data-rv]').forEach(b => b.onclick = async () => { try { await srv.reviewFrame(b.dataset.rv, b.dataset.s); rerender(); } catch (e) { err(e); } });
  } catch (e) { body.innerHTML = `<p class="ph-empty">${esc(e.message)}</p>`; }
}

export function initUpkeep() {
  G.phoneApps.house = { name: 'My House', glyph: '🏠', color: '#8a6a4e', badge: () => spoilt().length, render: renderHouse };
  if (G.profile?.is_admin) G.phoneApps.review = { name: 'Review', glyph: '🛡', color: '#444', render: renderReview };
  G.upkeep = { blocked, wearThing, useWater, generatorReady, repairMenu, frameTexture, choosePhoto, uploadPhoto, reportPhoto };
}

import * as THREE from 'three';
import { G, naira, dialog, formDialog } from './game.js';
import { eco, setBalance, syncWallet } from './economy.js';
import { meId, nameOf, resolveNames } from './net.js';
import { srv, online, SKILLS } from './server.js';
import { PLOTS, ZONES, KIND, toWorld } from './plots.js';
import { PIECE, rankOf } from './catalog.js';
import { GOV_SITES, SEAT_LEVELS, siteOf } from './sites.js';
import { drawSite, partsOf, govBoards, govBoardSpots, updateStructures } from './structures.js';
import { setDestination } from './map.js';
import { canvasTex } from './util.js';
import { askText } from './hub.js';
import { style, track } from './life.js';

/* Land: plots with a server-owned title in Lugbe Layout and Katampe Extension, and government
   land held by the seats. Building happens in the Building Explorer (explorer.js); this file
   loads what is committed, draws the plot signs, and gives each site its menu and the Land app. */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const err = e => G.toast(e?.message || 'Something went wrong');
const S = { plots: new Map(), gov: new Map(), vis: new Map(), keys: new Map(), mySites: [], t: 0 };
const BOX = new THREE.BoxGeometry(1, 1, 1);
export const mine = p => p?.owner && p.owner === meId();
const ownerName = p => (mine(p) ? 'you' : nameOf(p.owner)?.name || 'someone');
const keyOf = p => 'plot:' + p.id;
export const siteName = key => { const [k, id] = key.split(':'); if (k === 'plot') { const p = S.plots.get(+id); return p?.name || `Plot ${p?.code}`; } return S.gov.get(id)?.name || siteOf(key)?.name; };
/* how far a site has got: pieces committed, and pieces still waiting for the crew */
export function progress(key) { const ps = partsOf(key), left = ps.filter(p => !p.built).sort((a, b) => rankOf(a) - rankOf(b)); return { n: ps.length, left: left.length, next: left[0] }; }

/* ---------------- data ---------------- */
export async function refreshLand() {
  try {
    const [plots, gov, parts, my] = await Promise.all([srv.plots(), srv.govSites(), srv.parts(), online() ? srv.mySites().catch(() => []) : []]);
    (plots || []).forEach(p => S.plots.set(p.id, { ...PLOTS.find(q => q.id === p.id), ...p }));
    (gov || []).forEach(g => S.gov.set(g.id, { ...g, name: g.name || g.official }));
    S.mySites = my || [];
    const by = new Map(); (parts || []).forEach(pt => { if (!by.has(pt.site)) by.set(pt.site, []); by.get(pt.site).push(pt); });
    for (const key of new Set([...by.keys(), ...S.keys.keys()])) {
      const list = by.get(key) || [], k = JSON.stringify(list.map(p => [p.id, p.built]));
      if (S.keys.get(key) !== k) { S.keys.set(key, k); drawSite(key, list); }
    }
    await resolveNames([...new Set([...S.plots.values()].map(p => p.owner).filter(Boolean))]);
    S.plots.forEach(paintPlot);
    govBoards(Object.fromEntries([...S.gov.values()].map(g => ['gov:' + g.id, g.name])));
  } catch { }
  S.t = 0;
}
export const plotList = () => [...S.plots.values()];

/* ---------------- plot plates and signs ---------------- */
function setupPlots() {
  PLOTS.forEach(p => {
    S.plots.set(p.id, { ...p, owner: null, ask: null, name: null });
    const g = new THREE.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = p.face < 0 ? Math.PI : 0; G.scene.add(g);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xcdb98f, polygonOffset: true, polygonOffsetFactor: -2 }));
    plate.position.y = .02; plate.receiveShadow = true; g.add(plate);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, c]) => { const peg = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: 0xd9472f })); peg.scale.set(.15, .6, .15); peg.position.set(a * p.w / 2, .3, c * p.d / 2); g.add(peg); });
    const post = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: 0x6b4a33 })); post.scale.set(.12, 2.4, .12); post.position.set(p.w / 2 - .6, 1.2, p.d / 2 + .4); g.add(post);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide })); board.position.set(p.w / 2 - .6, 2.2, p.d / 2 + .47); g.add(board);
    S.vis.set(p.id, { board, key: '' });
  });
}
function paintPlot(p) {
  const v = S.vis.get(p.id); if (!v) return;
  const pr = progress(keyOf(p)), title = !p.owner || p.ask ? 'FOR SALE' : p.name ? p.name.toUpperCase() : pr.n ? (pr.left ? 'UNDER CONSTRUCTION' : ownerName(p).toUpperCase()) : 'PRIVATE LAND';
  const sub = !p.owner ? `${naira(p.price)} · ${KIND[p.kind].name}` : p.ask ? `${naira(p.ask)} · from ${ownerName(p)}` : pr.left ? `${pr.left} pieces to build` : `Plot ${p.code} · ${ownerName(p)}`;
  const key = title + sub; if (key === v.key) return; v.key = key;
  const bg = !p.owner || p.ask ? '#f2c230' : pr.left ? '#d9771f' : '#16213a', fg = !p.owner || p.ask ? '#1d3b2a' : '#ffffff';
  const tex = canvasTex(320, 160, g => { g.fillStyle = bg; g.fillRect(0, 0, 320, 160); g.fillStyle = fg; g.textAlign = 'center'; g.font = '700 32px "Fredoka", system-ui, sans-serif'; g.fillText(title, 160, 62, 300); g.font = '500 22px "Fredoka", system-ui, sans-serif'; g.fillText(sub, 160, 100, 300); g.fillText(`Plot ${p.code} · ${p.w}×${p.d} m`, 160, 132, 300); }, false);
  v.board.material.map?.dispose(); v.board.material.map = tex; v.board.material.needsUpdate = true;
}

/* ---------------- site menus ---------------- */
export async function plotMenu(p) {
  p = S.plots.get(p.id) || p; const key = keyOf(p), pr = progress(key);
  const head = `${p.name ? `${p.name}. ` : ''}${KIND[p.kind].name} plot · ${p.w} × ${p.d} m · ${ZONES.find(z => z.id === p.zone).name}`;
  if (!p.owner || (p.ask && !mine(p))) {
    const cost = p.owner ? p.ask : p.price;
    const ok = await dialog(`Plot ${p.code}`, `${head}. ${p.owner ? `${ownerName(p)} is selling it for ${naira(cost)}.` : `The city sells it for ${naira(cost)}.`} The title is kept on the server and can be resold.${pr.n ? ' The building on it comes with it.' : ''}`, [{ label: `Buy for ${naira(cost)}`, value: true }, { label: 'Not now', value: false }], { who: 'Lands Registry' });
    if (!ok) return;
    try { await syncWallet(); const r = await srv.buyPlot(p.id); if (online()) setBalance(r.balance); G.toast(`Plot ${p.code} is yours. Open the Building Explorer from the sign to build.`); track('buy'); refreshLand(); } catch (e) { err(e); }
    return;
  }
  if (!mine(p)) {
    const opts = [{ label: 'Close', value: null }];
    if (S.mySites.some(s => s.site === key)) opts.unshift({ label: 'Open the Building Explorer (draft)', value: 'explore' });
    if (p.name && online()) opts.splice(-1, 0, { label: 'Report this name', value: 'report' });
    const pick = await dialog(p.name || `Plot ${p.code}`, `${head}. Owned by ${ownerName(p)}.${pr.n ? (pr.left ? ` ${pr.left} pieces waiting for builders.` : ' Finished.') : ''}`, opts);
    if (pick === 'explore') G.openExplorer?.(key);
    if (pick === 'report') reportName(key);
    return;
  }
  const opts = [{ label: 'Open the Building Explorer', value: 'explore' }];
  if (pr.left) opts.push({ label: `Work on site (${pr.left} pieces to build)`, value: 'work' }, { label: 'Hire builders', value: 'hire' });
  opts.push({ label: 'Hire an architect to draft it', value: 'architect' }, { label: p.name ? `Rename (now “${p.name}”)` : 'Name this place', value: 'name' });
  opts.push({ label: p.ask ? `Change price (now ${naira(p.ask)})` : 'Sell this plot', value: 'sell' });
  if (p.ask) opts.push({ label: 'Take it off the market', value: 'unsell' });
  opts.push({ label: 'Close', value: null });
  const pick = await dialog(p.name || `My plot ${p.code}`, `${head}.${pr.n ? ` ${pr.n} pieces committed${pr.left ? `, ${pr.left} waiting for builders (next: ${PIECE[pr.next.piece].name.toLowerCase()})` : ', all built'}.` : ' Empty land.'}`, opts);
  if (pick === 'explore') G.openExplorer?.(key);
  else if (pick === 'work') G.startSiteWork?.(siteOf(key));
  else if (pick === 'hire') hireBuilders(key);
  else if (pick === 'architect') hireArchitect(key);
  else if (pick === 'name') rename(key);
  else if (pick === 'sell') { const v = Math.round(+(await askText('Your asking price (₦)', String(p.price))).replace(/[^0-9]/g, '')); if (!v) return; try { await srv.listPlot(p.id, v); G.toast(`Plot ${p.code} is listed for ${naira(v)}.`); refreshLand(); } catch (e) { err(e); } }
  else if (pick === 'unsell') { try { await srv.listPlot(p.id, null); refreshLand(); } catch (e) { err(e); } }
}
async function govMenu(key) {
  const s = siteOf(key), pr = progress(key), nm = siteName(key);
  const pick = await dialog(nm, `Government land (${s.level === 'local' ? 'Area Council Chairman' : s.level === 'district' ? 'Senator' : 'Vice President and President'}). ${pr.n ? `${pr.n} pieces committed${pr.left ? `, ${pr.left} waiting for the crew` : ''}.` : 'Nothing built yet.'}`,
    [{ label: 'Open the Building Explorer', value: 'explore' }, ...(pr.left ? [{ label: 'Work on site', value: 'work' }] : []), { label: 'Rename', value: 'name' }, ...(online() ? [{ label: 'Report this name', value: 'report' }] : []), { label: 'Close', value: null }]);
  if (pick === 'explore') G.openExplorer?.(key); else if (pick === 'work') G.startSiteWork?.(s); else if (pick === 'name') rename(key); else if (pick === 'report') reportName(key);
}
async function rename(key) {
  const nm = await askText('Name this place (2 to 40 letters)', 'e.g. Ada Lodge'); if (nm === null || nm === undefined) return;
  try { await srv.siteRename(key, nm); G.toast(nm.trim() ? `It's now “${nm.trim()}”. The name shows on the map, the sign and the deed.` : 'Name cleared.'); refreshLand(); } catch (e) { err(e); }
}
async function reportName(key) { const why = await askText('What is wrong with this name?', 'e.g. rude words'); if (!why) return; try { await srv.nameReport(key, why); G.toast('Reported. After three reports the name comes down.'); } catch (e) { err(e); } }

/* builders work the committed pieces on shift; an architect drafts in the explorer and is paid on approval */
export async function hireBuilders(key) {
  if (!online()) return G.toast('Hiring builders needs the online version');
  const left = partsOf(key).filter(p => !p.built && PIECE[p.piece].trade).sort((a, b) => rankOf(a) - rankOf(b)), trades = [...new Set(left.map(p => PIECE[p.piece].trade).filter(t => t !== 'labour'))];
  if (!left.length) return G.toast('Nothing waiting to be built. Commit pieces in the Building Explorer first.');
  const first = PIECE[left[0].piece].trade, nowH = Math.floor(((Date.now() / 60000) + 7) % 24);
  const srcs = [['own', 'My own money']];
  if (eco.role === 'sponsor') (await srv.businesses() || []).forEach(z => srcs.push([`business:${z.id}`, `${z.name} (funds ${naira(z.funds)})`]));
  if (G.profile?.office && key.startsWith('plot:')) srcs.push(['seat', 'Office budget (marked padded: public money, private building)']);
  const v = await formDialog(`Hire builders · ${siteName(key)}`, `${left.length} pieces wait for builders. Each piece is one task on site. Builders bring their own tools.`, [
    { id: 'skill', label: 'Trade', type: 'select', options: (trades.length ? trades : ['mason']).map(t => [t, SKILLS[t]]), value: first === 'labour' ? 'mason' : first },
    { id: 'src', label: 'Who pays', type: 'select', options: srcs, value: 'own' },
    { id: 'pay', label: 'Pay per hour (₦)', type: 'number', value: 5000, min: 500 },
    { id: 'slots', label: 'How many builders', type: 'number', value: 1, min: 1, max: 2 },
    { id: 'start', label: 'Shifts start at', type: 'select', options: Array.from({ length: 24 }, (_, i) => { const h = (nowH + 1 + i) % 24; return [h, `${String(h).padStart(2, '0')}:00${i === 0 ? ' (next hour)' : ''}`]; }), value: (nowH + 1) % 24 },
  ], 'Post the job', x => `${x.slots} × 4 h × 2 days = up to ${naira(x.pay * 4 * x.slots * 2)} held now. Unused pay comes back when you close the job.`);
  if (!v) return;
  const [src, bizId] = String(v.src).split(':');
  try {
    await syncWallet();
    await srv.post({ source: src, business_id: bizId ? +bizId : null, kind: 'trade', title: `${SKILLS[v.skill]} · ${siteName(key)}`.slice(0, 50), skill: v.skill, min_level: 1, pay: v.pay, unit: 'hour', start_hour: +v.start, hours: 4, days: 2, slots: Math.min(2, v.slots), place: 'site', x: 0, z: 0, moral: src === 'seat' ? 'padded' : 'clean', meta: { site: key } });
    if (online()) setBalance(await srv.wallet()); style(src === 'seat' ? -10 : 2);
    G.toast('Posted on the Work app. Pick your builders from the applicants (Work → Hire).');
  } catch (e) { err(e); }
}
export async function hireArchitect(key) {
  if (!online()) return G.toast('Hiring an architect needs the online version');
  const v = await formDialog(`Hire an architect · ${siteName(key)}`, 'The architect drafts in your Building Explorer. You approve the draft; then the fee is paid and the pieces are bought and committed.', [
    { id: 'pay', label: 'Fee (₦)', type: 'number', value: 150000, min: 10000 }, { id: 'lvl', label: 'Lowest level', type: 'select', options: [[0, 'New'], [1, 'Apprentice'], [2, 'Skilled'], [3, 'Master']], value: 1 }], 'Post the job', x => `${naira(x.pay)} is held now and paid when you approve their draft.`);
  if (!v) return;
  try { await syncWallet(); await srv.post({ source: 'own', title: `Architect · ${siteName(key)}`.slice(0, 50), skill: 'architect', min_level: +v.lvl, pay: v.pay, unit: 'job', start_hour: 0, hours: 1, days: 1, slots: 1, place: 'site', x: 0, z: 0, meta: { site: key } }); setBalance(await srv.wallet()); G.toast('Posted. Hire your architect from Work → Hire.'); }
  catch (e) { err(e); }
}

function provider(p, out, inside) {
  if (inside || G.region !== 'city') return;
  S.plots.forEach(pl => {
    const sg = toWorld(pl, pl.w / 2 - .6, pl.d / 2 + 1), d = Math.hypot(p.x - sg.x, p.z - sg.z);
    if (d < 6) out(d - 1, { label: !pl.owner ? `Plot ${pl.code} for sale · ${naira(pl.price)}` : pl.ask && !mine(pl) ? `Plot ${pl.code} · ${naira(pl.ask)}` : pl.name || (mine(pl) ? `My plot ${pl.code}` : `Plot ${pl.code}`), run: () => plotMenu(pl) });
  });
  govBoardSpots().forEach(b => { const d = Math.hypot(p.x - b.x, p.z - b.z); if (d < 5) out(d - .5, { label: `Government land: ${b.name}`, run: () => govMenu(b.key) }); });
}

/* ---------------- Land app ---------------- */
function renderLand(body) {
  const all = plotList(), own = all.filter(mine), sale = all.filter(p => !p.owner || (p.ask && !mine(p))).sort((a, b) => (a.ask || a.price) - (b.ask || b.price));
  const status = key => { const pr = progress(key); return pr.n ? (pr.left ? `${pr.n} pieces · ${pr.left} to build (next: ${PIECE[pr.next.piece].name.toLowerCase()})` : `${pr.n} pieces · finished`) : 'Empty land'; };
  const myGov = GOV_SITES.filter(g => SEAT_LEVELS[G.profile?.office]?.includes(g.level));
  body.innerHTML = `<div class="ph-card"><b>Land in Abuja</b><small>Buy a plot, then build it in the Building Explorer: buy pieces, drag them onto the grid, commit. Titles and buildings are kept on the server.</small></div>`
    + `<div class="ph-sec">My plots (deeds)</div>` + (own.map(p => `<div class="job"><div class="job-top"><b>${esc(p.name || p.code)} · ${KIND[p.kind].name}</b>${p.ask ? `<i class="jtag" style="--c:#d9771f">Selling ${naira(p.ask)}</i>` : ''}</div><small>Plot ${p.code} · ${status(keyOf(p))}</small><div class="job-btns"><button class="chip" data-go-plot="${p.id}">GPS</button><button class="mini-btn" data-explore="${keyOf(p)}">Building Explorer</button>${progress(keyOf(p)).left ? `<button class="chip" data-hire="${keyOf(p)}">Hire builders</button>` : ''}</div></div>`).join('') || '<p class="ph-empty">No land yet.</p>')
    + (S.mySites.length ? `<div class="ph-sec">Sites I work on</div>` + S.mySites.map(s => `<div class="job"><div class="job-top"><b>${esc(siteName(s.site))}</b><span class="jok">${esc(SKILLS[s.skill] || s.skill)}</span></div><small>${status(s.site)}</small><div class="job-btns">${siteOf(s.site)?.cats.some(c => c === 'road' || c === 'bridge') ? '' : `<button class="mini-btn" data-explore="${s.site}">Draft in the Explorer</button>`}</div></div>`).join('') : '')
    + (myGov.length ? `<div class="ph-sec">Government land (your seat)</div>` + myGov.map(g => `<div class="job"><div class="job-top"><b>${esc(siteName('gov:' + g.id))}</b></div><small>${status('gov:' + g.id)}</small><div class="job-btns"><button class="chip" data-go-gov="${g.id}">GPS</button><button class="mini-btn" data-explore="gov:${g.id}">Building Explorer</button></div></div>`).join('') : '')
    + `<div class="ph-sec">For sale</div>` + sale.map(p => `<div class="job"><div class="job-top"><b>${p.code} · ${KIND[p.kind].name}</b><span class="jok">${naira(p.ask || p.price)}</span></div><small>${ZONES.find(z => z.id === p.zone).name} · ${p.w} × ${p.d} m${p.owner ? ` · from ${esc(ownerName(p))}` : ' · from the city'}${progress(keyOf(p)).n ? ' · has a building' : ''}</small><div class="job-btns"><button class="chip" data-go-plot="${p.id}">GPS</button><button class="mini-btn" data-buy-plot="${p.id}">Buy</button></div></div>`).join('');
  body.querySelectorAll('[data-go-plot]').forEach(b => b.onclick = () => { const p = S.plots.get(+b.dataset.goPlot), s = toWorld(p, p.w / 2 - .6, p.d / 2 + 2); setDestination(s.x, s.z, p.name || `Plot ${p.code}`); G.closePhone?.(); });
  body.querySelectorAll('[data-go-gov]').forEach(b => b.onclick = () => { const s = siteOf('gov:' + b.dataset.goGov); setDestination(s.x, s.z + s.d * s.cell / 2 + 2, siteName(s.key)); G.closePhone?.(); });
  body.querySelectorAll('[data-buy-plot]').forEach(b => b.onclick = async () => { G.closePhone?.(); await plotMenu(S.plots.get(+b.dataset.buyPlot)); });
  body.querySelectorAll('[data-explore]').forEach(b => b.onclick = () => { G.closePhone?.(); G.openExplorer?.(b.dataset.explore); });
  body.querySelectorAll('[data-hire]').forEach(b => b.onclick = () => { G.closePhone?.(); hireBuilders(b.dataset.hire); });
}

export function initLand() {
  setupPlots();
  G.phoneApps.land = { name: 'Land', glyph: '📍', color: '#6d5a2e', render: renderLand };
  G.actionProviders.push(provider);
  G.refreshLand = refreshLand; G.land = S; G.siteName = siteName; G.buildBoxes = [];
  refreshLand();
}
export function updateLand(dt) { S.t += dt; if (S.t > 30) refreshLand(); updateStructures(); }

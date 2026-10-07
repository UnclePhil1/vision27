import { G } from './game.js';
import { net, resolveNames, nameOf, isMutual, iFollow, followsMe, setFollow, myHome, setPaint, claimHome } from './net.js';
import { initDM, dmReady, sendDM, threads } from './dm.js';
import { eco, bagSummary, eat, ITEMS } from './economy.js';
import { bookFlight, bookBus, FARES } from './transit.js';
import { naira } from './game.js';

const $ = id => document.getElementById(id);
const store = { get(k, d) { try { const v = localStorage.getItem('abuja.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('abuja.' + k, JSON.stringify(v)); } catch { } } };
let ctx = null, screen = 'home', threadId = null, cache = new Map(), notifiedTs = store.get('notified', Date.now());
const PAINTS = ['#f2e3c6', '#dcebd8', '#f3d1c4', '#d6e3f0', '#efe0a8', '#e6d6f0'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const timeOf = ts => { const d = new Date(ts); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
const lastRead = id => store.get('read.' + id, 0);

export async function initPhone(c) {
  ctx = c;
  $('bPhone').hidden = false;
  $('bPhone').onclick = () => togglePhone();
  $('phBack').onclick = back;
  $('phHome').onclick = () => (screen === 'home' ? togglePhone(false) : home());
  $('phClose').onclick = () => togglePhone(false);
  $('phone').addEventListener('click', onClick);
  $('phForm').onsubmit = onSend;
  tick(); setInterval(tick, 20000);
  const ok = await initDM();
  net.on('dm', refresh); net.on('keys', refresh); net.on('follows', refresh); net.on('homes', () => screen === 'house' && render());
  if (!ok) cache = new Map();
  refresh();
}
function tick() { $('phTime').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
export function togglePhone(open = $('phone').hidden) { $('phone').hidden = !open; if (open) { go(screen); } else { document.activeElement?.blur(); document.getElementById('c').focus(); } }
export const phoneOpen = () => !$('phone').hidden;

async function refresh() {
  cache = await threads();
  const ids = [...new Set([...cache.keys(), ...(net.follows.get(net.me.id) || []), ...[...net.follows.entries()].filter(([, s]) => s.has(net.me.id)).map(([k]) => k)])];
  await resolveNames(ids);
  // unread badge and notifications
  let unread = 0, newest = notifiedTs;
  for (const [id, list] of cache) {
    const inc = list.filter(m => !m.mine);
    if (inc.length && inc[inc.length - 1].ts > lastRead(id) && !(phoneOpen() && screen === 'thread' && threadId === id)) unread++;
    for (const m of inc) if (m.ts > notifiedTs && isMutual(id)) { newest = Math.max(newest, m.ts); if (!(phoneOpen() && threadId === id)) { ctx.toast(`New message from ${nameOf(id)?.name || 'a mutual'}`); ctx.ping(); } }
  }
  if (newest > notifiedTs) { notifiedTs = newest; store.set('notified', newest); }
  const b = $('phBadge'); b.textContent = unread; b.hidden = !unread;
  if (phoneOpen() && !G.phoneApps?.[screen]) render();   // app screens may hold a half-filled form
}

/* navigation: a simple history, so Back always goes to the screen you came from.
   An app can handle Back itself first (for its own sub-pages) by returning true from back(). */
let hist = [];
function go(s, id) {
  if (s !== screen || (id !== undefined && id !== threadId)) { hist.push({ s: screen, id: threadId }); $('phBody').scrollTop = 0; }
  screen = s; if (id !== undefined) threadId = id; render();
}
function back() {
  if (G.phoneApps?.[screen]?.back?.()) return render();
  const prev = hist.pop() || { s: 'home' }; screen = prev.s; threadId = prev.id ?? threadId; $('phBody').scrollTop = 0; render();
}
function home() { hist = []; screen = 'home'; $('phBody').scrollTop = 0; render(); }
function render() {
  const body = $('phBody'), title = $('phTitle'); $('phForm').hidden = screen !== 'thread';
  $('phScreen').classList.toggle('home', screen === 'home');
  if (screen === 'home') {
    title.textContent = '';
    const unread = +$('phBadge').textContent || 0;
    const tile = (k, name, bg, icon, badge) => `<button class="app" data-go="${k}"><span class="ic" style="background:${bg}">${icon}</span>${esc(name)}${badge ? `<i class="dot">${badge}</i>` : ''}</button>`;
    body.innerHTML = `<div class="ph-home"><div class="ph-clock">${esc($('phTime').textContent)}</div><div class="ph-date">${new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div class="ph-apps">
        ${tile('messages', 'Messages', '#25b360', iconMsg, unread)}${tile('people', 'People', '#2e5fa8', iconPpl)}${tile('wallet', 'Wallet', '#d9a21b', iconWallet)}${tile('bag', 'Bag', '#c9472f', iconBag)}
        ${Object.entries(G.phoneApps || {}).map(([k, a]) => tile(k, a.name, a.color, ICONS[k] || `<b class="glyph">${a.glyph}</b>`, a.badge?.())).join('')}
        ${tile('travel', 'Travel', '#16213a', iconPlane)}
      </div></div>`;
  } else if (G.phoneApps?.[screen]) {
    const a = G.phoneApps[screen]; title.textContent = a.name; a.render(body, render);
  } else if (screen === 'messages') {
    title.textContent = 'Messages';
    if (!dmReady()) { body.innerHTML = `<p class="ph-empty">${!net.db ? 'Messages work on the shared page.' : !net.canWrite ? 'You need Contributor access to send messages.' : 'Setting up your private inbox…'}</p>`; return; }
    const rows = [...cache.entries()].sort((a, b) => b[1][b[1].length - 1].ts - a[1][a[1].length - 1].ts);
    const mutuals = [...(net.follows.get(net.me.id) || [])].filter(isMutual).filter(id => !cache.has(id));
    body.innerHTML = (rows.length ? rows.map(([id, list]) => { const last = list[list.length - 1], un = !last.mine && last.ts > lastRead(id); return `<button class="row-th${un ? ' unread' : ''}" data-th="${esc(id)}">${avatar(id)}<span class="th-main"><b>${esc(nameOf(id)?.name || 'Someone')}</b><small>${last.mine ? 'You: ' : ''}${esc(last.text)}</small></span><span class="th-time">${timeOf(last.ts)}</span></button>`; }).join('') : '<p class="ph-empty">No messages yet.</p>')
      + (mutuals.length ? `<div class="ph-sec">Start a chat with a mutual</div>` + mutuals.map(id => `<button class="row-th" data-th="${esc(id)}">${avatar(id)}<span class="th-main"><b>${esc(nameOf(id)?.name || 'Someone')}</b><small>Say hi</small></span></button>`).join('') : '')
      + `<p class="ph-note">Messages are locked so only you and the other person can read them. Only mutuals can message each other.</p>`;
  } else if (screen === 'thread') {
    const n = nameOf(threadId); title.textContent = n?.name || 'Chat';
    const list = cache.get(threadId) || [];
    body.innerHTML = `<div class="bubbles">${list.map(m => `<div class="bb${m.mine ? ' me' : ''}${m.locked ? ' locked' : ''}">${esc(m.text)}<time>${timeOf(m.ts)}</time></div>`).join('') || '<p class="ph-empty">Say hi to start the chat.</p>'}</div>`;
    body.scrollTop = body.scrollHeight;
    const can = dmReady() && isMutual(threadId);
    $('phInput').disabled = !can; $('phInput').placeholder = can ? 'Message' : 'You can only message mutuals';
    if (list.length) store.set('read.' + threadId, list[list.length - 1].ts);
    refreshBadgeSoon();
  } else if (screen === 'people') {
    title.textContent = 'People';
    const mine = net.follows.get(net.me.id) || new Set();
    const followers = [...net.follows.entries()].filter(([k, s]) => k !== net.me.id && s.has(net.me.id)).map(([k]) => k);
    const ids = [...new Set([...mine, ...followers])];
    const group = (label, list) => list.length ? `<div class="ph-sec">${label}</div>` + list.map(id => `<div class="row-th">${avatar(id)}<span class="th-main"><b>${esc(nameOf(id)?.name || 'Someone')}</b><small>${isMutual(id) ? 'Mutual' : followsMe(id) ? 'Follows you' : 'You follow them'}</small></span>${isMutual(id) ? `<button class="mini-btn" data-th="${esc(id)}">Message</button>` : `<button class="mini-btn" data-fol="${esc(id)}">${iFollow(id) ? 'Unfollow' : 'Follow back'}</button>`}</div>`).join('') : '';
    body.innerHTML = ids.length ? group('Mutuals', ids.filter(isMutual)) + group('Follows you', ids.filter(id => !isMutual(id) && followsMe(id))) + group('You follow', ids.filter(id => !isMutual(id) && iFollow(id)))
      : '<p class="ph-empty">No one yet. Click another player in the city to follow them.</p>';
  } else if (screen === 'travel') {
    title.textContent = 'Travel';
    const tk = eco.tickets.map(t => `<div class="row-th"><span class="th-main"><b>${t.kind === 'flight' ? 'Flight NA 101' : 'Bus ticket'}</b><small>To ${({ uyo: 'Uyo', abuja: 'Abuja', village: 'Kauye Village', airport: 'Abuja Airport' })[t.dest] || t.dest}</small></span><span class="th-time">${t.kind === 'flight' ? 'Gate 1' : 'Motor park'}</span></div>`).join('');
    body.innerHTML = `<div class="ph-sec">Your tickets</div>${tk || '<p class="ph-empty">No tickets yet.</p>'}
      <div class="ph-sec">Book a flight · Naija Air</div>
      <button class="row-th" data-book="flight:uyo"><span class="th-main"><b>Abuja → Uyo</b><small>Leave from Abuja Airport</small></span><span class="mini-btn">${naira(FARES.flight)}</span></button>
      <button class="row-th" data-book="flight:abuja"><span class="th-main"><b>Uyo → Abuja</b><small>Leave from Uyo Airport</small></span><span class="mini-btn">${naira(FARES.flight)}</span></button>
      <div class="ph-sec">Book a bus · Unity Line</div>
      <button class="row-th" data-book="bus:village"><span class="th-main"><b>Abuja → Kauye Village</b><small>From Unity Motor Park</small></span><span class="mini-btn">${naira(FARES.village)}</span></button>
      <button class="row-th" data-book="bus:airport"><span class="th-main"><b>Abuja → Airport</b><small>From Unity Motor Park</small></span><span class="mini-btn">${naira(FARES.airport)}</span></button>
      <p class="ph-note">To get to the airport, take the bus from Unity Motor Park (west of the city) or drive north on the highway.</p>`;
  } else if (screen === 'bag') {
    title.textContent = 'Bag';
    const items = bagSummary();
    body.innerHTML = items.length ? items.map(it => `<div class="row-th"><span class="th-main"><b>${it.name} ×${it.n}</b><small>${it.energy ? `+${it.energy} energy` : it.cat === 'ingredient' ? 'Cook it at home' : ''}</small></span>${it.energy ? `<button class="mini-btn" data-eat="${it.id}">Eat</button>` : ''}</div>`).join('')
      + (Object.keys(eco.store).length ? `<div class="ph-sec">In storage at home</div>` + Object.entries(eco.store).map(([k, n]) => `<div class="row-th"><span class="th-main"><b>${ITEMS[k]?.name || k} ×${n}</b><small>Place it from "Arrange house"</small></span></div>`).join('') : '')
      : '<p class="ph-empty">Your bag is empty. Buy food at the market, bakery or Mama Put.</p>';
  } else if (screen === 'wallet') {
    title.textContent = 'Wallet';
    body.innerHTML = `<div class="ph-card wallet-card"><small>Balance</small><b>${naira(eco.money)}</b><small>Kept safe on the server. Earn it on the Work app, at office lobbies, with Ride and Chow, or at rallies.</small></div><div id="ledger"></div>`;
    G.ledger?.().then(rows => { const el = $('ledger'); if (!el || !rows?.length) return; el.innerHTML = '<div class="ph-sec">Recent</div>' + rows.map(r => `<div class="row-th"><span class="th-main"><b>${esc(r.reason)}</b><small>${new Date(r.created_at).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</small></span><span class="th-amt ${r.delta < 0 ? 'neg' : ''}">${r.delta < 0 ? '−' : '+'}${naira(Math.abs(r.delta))}</span></div>`).join(''); }).catch(() => { });
  }
}
let badgeT; function refreshBadgeSoon() { clearTimeout(badgeT); badgeT = setTimeout(refresh, 300); }
function avatar(id) { const n = nameOf(id); return n?.avatar ? `<img class="av" alt="" src="${esc(n.avatar)}">` : `<span class="av" style="background:${esc(n?.color || '#888')}"></span>`; }

function onClick(e) {
  const t = e.target.closest('[data-go],[data-th],[data-fol],[data-paint],[data-act],[data-book],[data-eat]'); if (!t) return;
  if (t.dataset.book) { const [k, d] = t.dataset.book.split(':'); (k === 'flight' ? bookFlight(d) : bookBus(d)); render(); return; }
  if (t.dataset.eat) { eat(t.dataset.eat); render(); return; }
  if (t.dataset.go) go(t.dataset.go);
  else if (t.dataset.th) go('thread', t.dataset.th);
  else if (t.dataset.fol) { setFollow(t.dataset.fol, !iFollow(t.dataset.fol)).then(render); render(); }
  else if (t.dataset.paint) { setPaint(t.dataset.paint).then(() => ctx.onPaint(t.dataset.paint)); ctx.onPaint(t.dataset.paint); render(); }
  else if (t.dataset.act === 'gohome') { togglePhone(false); ctx.goHome(); }
  else if (t.dataset.act === 'arrange') { togglePhone(false); ctx.arrange?.(); }
}
async function onSend(e) {
  e.preventDefault();
  const inp = $('phInput'), text = inp.value.trim().slice(0, 500); if (!text || !threadId) return;
  inp.value = '';
  try { await sendDM(threadId, text); refresh(); }
  catch (err) { ctx.toast(err?.code === 'no_key' ? 'They need to open the game once before you can message them.' : 'Message not sent. Try again.'); inp.value = text; }
}
export function openThread(id) { togglePhone(true); go('thread', id); }

const iconMsg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>';
const iconPpl = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.6"/><path d="M2 20c0-4 3.2-6.5 7-6.5s7 2.5 7 6.5zM15 20c0-2-.6-3.7-1.7-5 3.6-.6 8.7.6 8.7 5z"/></svg>';
const iconPlane = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 15v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V8l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5.5z"/></svg>';
const iconBag = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 8V7a5 5 0 0 1 10 0v1h3l-1 13H5L4 8zm2 0h6V7a3 3 0 0 0-6 0z"/></svg>';
const iconWallet = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6a2 2 0 0 1 2-2h13v3H5v1h16v12H5a2 2 0 0 1-2-2zm14 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>';
const iconHome = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/></svg>';

/* one icon style for every app */
const sv = d => `<svg viewBox="0 0 24 24" fill="currentColor">${d}</svg>`;
const ICONS = {
  today: sv('<circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  vote: sv('<path d="M4 11h16v10H4z" opacity=".55"/><path d="M7 3h10v10H7z"/><path d="M9.5 8l2 2 3.5-4" fill="none" stroke="#1d8a4a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  ranks: sv('<path d="M7 3h10v4a5 5 0 0 1-10 0z"/><path d="M5 4H2v2a4 4 0 0 0 4 4M19 4h3v2a4 4 0 0 1-4 4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 13h4v4h3v3H7v-3h3z"/>'),
  me: sv('<circle cx="12" cy="8" r="4.5"/><path d="M3 21c0-4.5 4-7.5 9-7.5s9 3 9 7.5z"/>'),
  ride: sv('<path d="M5 11l2-5h10l2 5h1a1 1 0 0 1 1 1v5h-2v2h-3v-2H8v2H5v-2H3v-5a1 1 0 0 1 1-1zm2.3-1h9.4l-1.2-3H8.5z"/><circle cx="7" cy="14" r="1.4" fill="#f2c230"/><circle cx="17" cy="14" r="1.4" fill="#f2c230"/>'),
  chow: sv('<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8 3c0 2 2 2 2 4M12 3c0 2 2 2 2 4M16 3c0 2 2 2 2 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  work: sv('<path d="M9 4h6a2 2 0 0 1 2 2v1h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3V6a2 2 0 0 1 2-2zm0 3h6V6H9z"/><path d="M3 12h18" stroke="#3f5f7f" stroke-width="1.6"/>'),
  market: sv('<path d="M2 9h20l-2 11H4z"/><path d="M7 9l4-6M17 9l-4-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  house: sv('<path d="M12 3l9 8h-3v9H6v-9H3z"/><rect x="10" y="13" width="4" height="7" fill="#8a6a4e"/>'),
  land: sv('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" opacity=".6"/><path d="M12 6a4 4 0 0 1 4 4c0 3-4 7-4 7s-4-4-4-7a4 4 0 0 1 4-4z"/><circle cx="12" cy="10" r="1.5" fill="#6d5a2e"/>'),
  build: sv('<path d="M3 21V9l9-6 9 6v12h-6v-7H9v7z" opacity=".55"/><path d="M14 3l7 7-2 2-7-7z"/><path d="M4 21l8-8 2 2-8 8H4z"/>'),
  review: sv('<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M8.5 12l2.5 2.5 4.5-5" fill="none" stroke="#444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
};
/* open the phone straight to an app (used by signs and kiosks) */
export function openApp(k) { $('phone').hidden = false; hist = []; screen = 'home'; go(k); }
G.openApp = openApp;

import * as THREE from 'three';
import { G } from './game.js';
import { net, peers, resolveNames, nameOf, sendChat, setPresence, flushPresence, isMutual, iFollow, followsMe, setFollow } from './net.js';
import { LOOKS } from './characters.js';
import { makeAvatar, fromCode } from './avatar.js';
import { makeCar } from './cars.js';
import { angleLerp, damp } from './util.js';
import { openThread } from './phone.js';

const $ = id => document.getElementById(id);
let ctx = null;
const remotes = new Map();          // peer label -> remote
const labels = () => $('labels');
const clean = s => String(s || '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 140);
const hitGeo = new THREE.CylinderGeometry(.55, .55, 1.9, 8), hitMat = new THREE.MeshBasicMaterial({ visible: false });

/* ---------------- remote players ---------------- */
function el(cls) { const d = document.createElement('div'); d.className = cls; d.hidden = true; labels().appendChild(d); return d; }
function createRemote(pr) {
  const r = { peer: pr.peer, by: pr.by, g: new THREE.Group(), look: -1, ch: null, car: null, drvKey: null, tag: el('tag'), bub: el('hbubble'), bubUntil: 0, sayAt: 0, tx: 0, tz: 0, ty: 0, tyaw: 0, sp: 0, first: true };
  const hit = new THREE.Mesh(hitGeo, hitMat); hit.position.y = .95; hit.userData.peerId = pr.by; r.g.add(hit); r.hit = hit;
  ctx.scene.add(r.g); remotes.set(pr.peer, r);
  r.tag.textContent = 'Player';
  if (pr.by) resolveNames([pr.by]).then(() => paintTag(r));
  r.tag.onclick = () => pr.by && openPlayerCard(pr.by);
  return r;
}
function paintTag(r) {
  const n = r.by ? nameOf(r.by) : null;
  r.tag.textContent = (n?.name || 'Player') + (r.by && isMutual(r.by) ? ' ★' : '');
  r.tag.style.setProperty('--c', n?.color || '#888');
}
function setLook(r, i, of, av) {
  if (r.ch) r.g.remove(r.ch.root);
  const o = of && typeof of === 'object' ? { shirt: num(of.s), pants: num(of.p), hat: ['cap', 'fila', 'none'].includes(of.h) ? of.h : undefined, hatColor: num(of.c) } : {};
  const a = fromCode(av);
  r.look = i; r.av = av; r.ofKey = JSON.stringify(of || null); r.ch = a ? makeAvatar(a, o) : (LOOKS[i] || LOOKS[0]).make(o); r.g.add(r.ch.root); r.ch.root.visible = !r.car && !r.hidden;
}
const num = v => (typeof v === 'number' && isFinite(v) ? v : undefined);
function setCar(r, drv) {
  if (r.car) { r.g.remove(r.car); r.car = null; }
  r.drvKey = drv ? drv.t + ':' + drv.c : '';
  if (drv && typeof drv.t === 'string') { r.car = makeCar(['sedan', 'suv', 'taxi', 'bus', 'keke'].includes(drv.t) ? drv.t : 'sedan', typeof drv.c === 'number' ? drv.c : undefined); r.g.add(r.car); }
  if (r.ch) r.ch.root.visible = !r.car;
  r.hit.scale.set(r.car ? 2.2 : 1, 1, r.car ? 2.2 : 1);
}
function removeRemote(r) { ctx.scene.remove(r.g); r.tag.remove(); r.bub.remove(); remotes.delete(r.peer); }

const sp = { x: 0, y: 0 }, tmp = new THREE.Vector3();
function placeEl(node, pos, yOff, maxD = 70) {
  tmp.copy(pos); tmp.y += yOff;
  if (tmp.distanceTo(ctx.camera.position) > maxD || !ctx.screenPos(tmp, sp)) { node.hidden = true; return; }
  node.hidden = false; node.style.transform = `translate(${sp.x}px, ${sp.y}px) translate(-50%, -100%)`;
}

export function updateSocial(dt) {
  if (!ctx) return;
  const list = peers(), seen = new Set();
  for (const pr of list) {
    const pz = pr.presence || {};
    if (typeof pz.x !== 'number' || typeof pz.z !== 'number') continue;
    if ((pz.in ?? null) !== (ctx.getIn ? ctx.getIn() : null)) continue;
    seen.add(pr.peer);
    const r = remotes.get(pr.peer) || createRemote(pr);
    const look = Math.max(0, Math.min(LOOKS.length - 1, pz.look | 0));
    if (look !== r.look || pz.av !== r.av || JSON.stringify(pz.of || null) !== r.ofKey) setLook(r, look, pz.of, pz.av);
    r.hidden = !!pz.ride; if (r.ch) r.ch.root.visible = !r.car && !r.hidden;
    const dk = pz.drv && typeof pz.drv === 'object' ? pz.drv.t + ':' + pz.drv.c : '';
    if (dk !== r.drvKey) setCar(r, dk ? pz.drv : null);
    if (r.ch && !!pz.cy !== (r.crate?.parent === r.ch.root)) { r.cy = !!pz.cy; r.crate ||= new THREE.Mesh(new THREE.BoxGeometry(.5, .38, .42), new THREE.MeshLambertMaterial({ color: 0xc9a77a })); r.crate.position.set(0, 1.05, .38); if (r.cy) r.ch.root.add(r.crate); else r.ch.root.remove(r.crate); }
    r.tx = pz.x; r.tz = pz.z; r.ty = +pz.y || 0; r.tyaw = +pz.yaw || 0; r.sp = +pz.sp || 0; r.air = !!pz.air; r.sit = !!pz.sit; r.vc = pz.vc | 0;
    if (pz.sayAt && pz.sayAt !== r.sayAt) {
      r.sayAt = pz.sayAt;
      const text = clean(pz.say), fresh = Math.abs(Date.now() - pz.sayAt) < 20000;
      if (text && fresh && (pz.sayTo !== 'mutuals' || (r.by && isMutual(r.by)))) { r.bub.textContent = text; r.bub.classList.toggle('mutual', pz.sayTo === 'mutuals'); r.bubUntil = performance.now() + 7000; }
    }
  }
  for (const r of [...remotes.values()]) if (!seen.has(r.peer)) removeRemote(r);
  const now = performance.now();
  for (const r of remotes.values()) {
    if (r.first) { r.g.position.set(r.tx, r.ty, r.tz); r.g.rotation.y = r.tyaw; r.first = false; }
    const k = 1 - Math.exp(-dt * 10);
    r.g.position.x += (r.tx - r.g.position.x) * k; r.g.position.z += (r.tz - r.g.position.z) * k; r.g.position.y += (r.ty - r.g.position.y) * k;
    r.g.rotation.y = angleLerp(r.g.rotation.y, r.tyaw, k);
    if (r.ch && !r.car && r.g.position.distanceToSquared(ctx.camera.position) < 90 * 90) r.ch.update(dt, r.sp, { air: r.air, sit: r.sit });
    placeEl(r.tag, r.g.position, r.car ? 2.3 : 1.95);
    if (now < r.bubUntil) placeEl(r.bub, r.g.position, (r.car ? 3.1 : 2.7) + (r.vc ? .9 : 0), 90); else r.bub.hidden = true;
  }
  // my own name tag (always on) and head bubble
  const pl = ctx.player, shown = pl.car || pl.ch?.root.visible !== false;
  if (!myTag) { myTag = el('tag'); myTag.classList.add('me'); myTag.onclick = () => net.me.id && openPlayerCard(net.me.id); }
  if (myTag.textContent !== (net.me.name || 'You')) myTag.textContent = net.me.name || 'You';
  myTag.style.setProperty('--c', net.me.color || '#1d8a4a');
  if (shown) placeEl(myTag, pl.pos, pl.car ? 2.3 : 1.95); else myTag.hidden = true;
  if (myBub) { if (now < myUntil && shown) placeEl(myBub, pl.pos, (pl.car ? 3.1 : 2.6) + (G.voiceOn?.() ? .9 : 0), 90); else myBub.hidden = true; }
}
export const remoteList = () => [...remotes.values()];
export { placeEl };
export const remoteHits = () => [...remotes.values()].filter(r => r.by).map(r => r.hit);
export const remoteDots = () => [...remotes.values()].map(r => ({ x: r.g.position.x, z: r.g.position.z, color: (r.by && nameOf(r.by)?.color) || '#2e5fa8' }));
export const onlineCount = () => net.room ? `${remotes.size + 1} online` : 'Solo';

/* ---------------- head chat ---------------- */
let myBub = null, myUntil = 0;
export function sayHead(text, scope = 'all') {
  text = clean(text); if (!text) return;
  if (!myBub) myBub = el('hbubble me');
  myBub.textContent = text; myBub.classList.toggle('mutual', scope === 'mutuals'); myUntil = performance.now() + 7000;
  setPresence({ say: text, sayAt: Date.now(), sayTo: scope }); flushPresence();
}

/* ---------------- community chat (TikTok-style stream) ---------------- */
const MODES = { community: 'Chat', head: 'Head · All', mutuals: 'Head · Mutuals' };
let mode = 'head', lastSend = 0;
const shown = new Set();
function modes() { return [...(net.db && net.canWrite ? ['community'] : []), 'head', 'mutuals']; }
function setMode(m) {
  mode = m; const b = $('chatMode'); b.textContent = MODES[m]; b.dataset.mode = m;
  const inp = $('chatInput');
  inp.placeholder = m === 'community' ? 'Say something to everyone…' : m === 'head' ? 'Shows above your head for everyone…' : 'Above your head, mutuals only…';
}
function setupChatUI() {
  setMode(modes()[0]);
  $('chatMode').onclick = () => { const ms = modes(); setMode(ms[(ms.indexOf(mode) + 1) % ms.length]); $('chatInput').focus(); };
  $('chatForm').onsubmit = e => {
    e.preventDefault();
    const inp = $('chatInput'), text = clean(inp.value); if (!text) { inp.blur(); return; }
    if (performance.now() - lastSend < 1200) { ctx.toast('Slow down a little'); return; }
    lastSend = performance.now(); inp.value = '';
    if (mode === 'community') sendChat(text).catch(() => ctx.toast('Message not sent. Try again.'));
    else { sayHead(text, mode === 'mutuals' ? 'mutuals' : 'all'); if (mode === 'mutuals' && !net.room) ctx.toast('Only you can see this right now'); }
    inp.blur(); document.getElementById('c').focus();
  };
  if (!net.db) $('feedEmpty').textContent = 'The community chat works on the shared page. Head chat still works here.';
  else if (!net.canWrite) $('feedEmpty').textContent = 'You can read the chat. Ask the owner for Contributor access to post.';
  net.on('chat', renderChat); net.on('follows', () => { remotes.forEach(paintTag); refreshCard(); });
  renderChat(net.chat);
}
async function renderChat(list) {
  const feed = $('feed'), fresh = list.filter(m => !shown.has(m.k));
  $('feedEmpty').hidden = list.length > 0;
  if (!fresh.length) return;
  await resolveNames([...new Set(fresh.map(m => m.by))]);
  const initial = shown.size === 0;
  fresh.slice(-20).forEach((m, i) => {
    shown.add(m.k);
    const row = document.createElement('div'); row.className = 'msg' + (m.by === net.me.id ? ' mine' : '') + (initial ? '' : ' pop');
    const n = nameOf(m.by), b = document.createElement('b'), s = document.createElement('span');
    b.textContent = (m.by === net.me.id ? 'You' : (n?.name || 'Someone')); b.style.color = n?.color || '#ffd166';
    b.onclick = () => m.by !== net.me.id && openPlayerCard(m.by);
    s.textContent = ' ' + m.text; row.append(b, s); feed.appendChild(row);
  });
  while (feed.children.length > 30) feed.firstElementChild.remove();
  feed.scrollTop = feed.scrollHeight;
}

/* ---------------- player card: follow and mutuals ---------------- */
let cardId = null, myTag = null;
export async function openPlayerCard(id) {
  if (!id) return; cardId = id;
  await resolveNames([id]); refreshCard(); $('pcard').hidden = false;
}
function refreshCard() {
  if (!cardId) return;
  const n = nameOf(cardId), me = cardId === net.me.id;
  $('pcName').textContent = me ? 'You' : (n?.name || 'Someone');
  $('pcAvatar').src = n?.avatar || ''; $('pcAvatar').hidden = !n?.avatar;
  const mutual = isMutual(cardId), fm = followsMe(cardId), mine = iFollow(cardId);
  $('pcStatus').textContent = me ? 'This is you' : mutual ? 'Mutuals: you follow each other' : fm ? 'Follows you' : mine ? 'You follow them' : 'Not connected yet';
  const btn = $('pcFollow'); btn.hidden = me; btn.textContent = mine ? 'Following' : (fm ? 'Follow back' : 'Follow');
  btn.classList.toggle('ghost', mine); btn.disabled = !net.canWrite;
  $('pcNote').hidden = net.canWrite;
  const vm = $('pcMute'); vm.hidden = me || !G.isMuted; if (!vm.hidden) vm.textContent = G.isMuted(cardId) ? 'Unmute voice' : 'Mute voice';
}
$('pcFollow').onclick = () => { if (cardId) setFollow(cardId, !iFollow(cardId)).catch(() => ctx.toast('Could not update follow')); refreshCard(); };
$('pcMsg').onclick = () => { const id = cardId; $('pcard').hidden = true; cardId = null; openThread(id); };
$('pcMute').onclick = () => { if (cardId) G.toggleMute?.(cardId); refreshCard(); };
$('pcClose').onclick = () => { $('pcard').hidden = true; cardId = null; };

export function initSocial(c) { ctx = c; setupChatUI(); }

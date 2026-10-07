/* Live players (room presence), chat and follows (db), names (user).
   Everything is optional: with no viewer runtime the game runs single-player. */

export const net = {
  room: null, db: null, user: null, assets: null,
  me: { id: null, name: '', color: '#1d8a4a' }, canWrite: false, canEdit: false,
  follows: new Map(),            // uid -> Set of uids they follow
  chat: [],                       // [{ by, text, ts }]
  ads: null,                      // array or null when unknown
  homes: new Map(), owners: new Map(), keys: new Map(), dmDocs: new Map(),
  listeners: { chat: [], follows: [], ads: [], honk: [], homes: [], keys: [], dm: [] },
  on(ev, fn) { this.listeners[ev].push(fn); },
  emitLocal(ev, v) { this.listeners[ev].forEach(f => f(v)); },
};

const use = n => (window.claude && window.claude.use ? window.claude.use(n).catch(() => null) : Promise.resolve(null));

export async function initNet(rt) {
  const [room, db, user] = rt ? [rt.room, rt.db, rt.user] : await Promise.all([use('room'), use('db'), use('user')]);
  Object.assign(net, { room, db, user });
  if (user) {
    const me = await user.me();
    net.me = { id: me.id, name: me.name, color: me.color };
    net.canEdit = me.canEdit;
    const w = await user.can('data.write');
    net.canWrite = !!me.id && w !== false;
  }
  if (db) {
    db.collection('chat').onSnapshot(snap => {
      const all = [];
      snap.docs.forEach(d => { const m = d.data()?.msgs; if (Array.isArray(m)) m.forEach(x => { if (x && typeof x.text === 'string') all.push({ by: d.id, text: x.text.slice(0, 160), ts: +x.ts || 0, k: d.id + ':' + x.ts }); }); });
      all.sort((a, b) => a.ts - b.ts); net.chat = all.slice(-60); net.emitLocal('chat', net.chat);
    }, () => {});
    db.collection('follows').onSnapshot(snap => {
      net.follows = new Map(); snap.docs.forEach(d => { const ids = d.data()?.ids; net.follows.set(d.id, new Set(Array.isArray(ids) ? ids : [])); });
      net.emitLocal('follows', net.follows);
    }, () => {});
    db.collection('homes').onSnapshot(snap => {
      sharedHomes = new Map(); snap.docs.forEach(d => { const v = cleanHome(d.data()); if (v) sharedHomes.set(d.id, v); });
      mergeHomes();
    }, () => {});
    db.collection('keys').onSnapshot(snap => { snap.docs.forEach(d => { const k = d.data()?.pub; if (k && typeof k === 'object') net.keys.set(d.id, k); }); net.emitLocal('keys', net.keys); }, () => {});
    db.collection('dm').onSnapshot(snap => { net.dmDocs = new Map(); snap.docs.forEach(d => { const m = d.data()?.msgs; if (Array.isArray(m)) net.dmDocs.set(d.id, m); }); net.emitLocal('dm', net.dmDocs); }, () => {});
    db.doc('ads/config').onSnapshot(s => { net.ads = s.exists && Array.isArray(s.data().ads) ? s.data().ads : []; net.emitLocal('ads', net.ads); }, () => { net.ads = []; net.emitLocal('ads', []); });
  } else { net.ads = []; net.emitLocal('ads', []); }
  mergeHomes();
  if (room) room.on('honk', m => { if (!m.sameTab) net.emitLocal('honk', m.data); }, () => {});
  if (net.canEdit && !rt) net.assets = await use('assets');
  return net;
}

/* presence: absolute state, throttled */
let lastSent = 0, pending = null;
export function setPresence(p) {
  if (!net.room) return;
  pending = { ...pending, ...p };
  const now = performance.now();
  if (now - lastSent < 90) return;
  lastSent = now; const out = pending; pending = null;
  net.room.presence(out).catch(() => {});
}
export function flushPresence() { if (pending && net.room) { net.room.presence(pending).catch(() => {}); pending = null; } }
export const peers = () => (net.room ? net.room.peers().filter(p => !p.sameTab && p.kind === 'viewer') : []);

/* names */
const names = new Map();
export function nameOf(id) { return names.get(id) || null; }
export async function resolveNames(ids) {
  if (!net.user || !ids.length) return;
  const ps = await net.user.profiles(ids);
  for (const id of ids) names.set(id, { name: ps[id]?.name || 'Someone', color: ps[id]?.color || '#888', avatar: ps[id]?.avatarUrl });
}

/* chat: each person writes only their own doc, keeping their last 12 messages */
let writing = Promise.resolve();
export function sendChat(text) {
  if (!net.db || !net.me.id) return Promise.reject({ code: 'offline' });
  const ref = net.db.doc('chat/' + net.me.id);
  writing = writing.then(async () => {
    const mine = net.chat.filter(m => m.by === net.me.id).slice(-11).map(m => ({ text: m.text, ts: m.ts }));
    await ref.set({ msgs: [...mine, { text, ts: Date.now() }] });
  });
  return writing;
}

/* follows */
export const iFollow = id => !!net.follows.get(net.me.id)?.has(id);
export const followsMe = id => !!net.follows.get(id)?.has(net.me.id);
export const isMutual = id => iFollow(id) && followsMe(id);
let fWriting = Promise.resolve();
export function setFollow(id, on) {
  if (!net.db || !net.me.id) return Promise.resolve();
  const cur = new Set(net.follows.get(net.me.id) || []); on ? cur.add(id) : cur.delete(id);
  net.follows.set(net.me.id, cur); net.emitLocal('follows', net.follows);
  fWriting = fWriting.then(() => net.db.doc('follows/' + net.me.id).set({ ids: [...cur].slice(0, 500) }));
  return fWriting;
}

export function saveAds(list) { return net.db.doc('ads/config').set({ ads: list }); }
export function sendHonk(x, z) { if (net.room) net.room.emit('honk', { x: Math.round(x), z: Math.round(z) }).catch(() => {}); }

/* homes: one claim per person, kept in homes/<id> when the shared page allows it,
   and always kept on this device too, so a house works even when playing alone */
export const meId = () => net.me.id || 'me';
let sharedHomes = new Map(), localHome, localFor = null;
const homeKey = () => 'abuja.home.' + meId();
function loadLocal() { if (localFor === meId()) return; localFor = meId(); localHome = null; try { localHome = cleanHome(JSON.parse(localStorage.getItem(homeKey()) || (meId() === 'me' ? localStorage.getItem('abuja.home') : null) || 'null')); } catch { } }
function cleanHome(v) { return v && Number.isInteger(v.house) ? { house: v.house, ts: +v.ts || 0, paint: typeof v.paint === 'string' ? v.paint : null, floor: typeof v.floor === 'string' ? v.floor : null, furn: Array.isArray(v.furn) ? v.furn : null } : null; }
function mergeHomes() {
  loadLocal();
  net.homes = new Map(sharedHomes);
  if (localHome && !net.homes.has(meId())) net.homes.set(meId(), localHome);
  // first claim wins when two people pick the same house
  net.owners = new Map(); [...net.homes.entries()].sort((a, b) => a[1].ts - b[1].ts).forEach(([uid, h]) => { if (!net.owners.has(h.house)) net.owners.set(h.house, uid); });
  net.emitLocal('homes', net.homes);
}
const shared = () => !!(net.db && net.me.id && net.canWrite);
export const myHome = () => { const h = net.homes.get(meId()); return h && net.owners.get(h.house) === meId() ? h : null; };
export const ownerOf = idx => net.owners.get(idx) || null;
let hWriting = Promise.resolve();
function putHome(next) {
  localHome = next; try { localStorage.setItem(homeKey(), JSON.stringify(next)); } catch { }
  if (shared()) sharedHomes.set(meId(), next);
  mergeHomes();
  if (shared()) hWriting = hWriting.then(() => net.db.doc('homes/' + meId()).set(next)).catch(() => { });
  return hWriting;
}
export function claimHome(idx, furn) { return putHome({ house: idx, ts: Date.now(), paint: '#f2e3c6', floor: '#c9a77a', furn: furn || [] }); }
export function saveHome(patch) {
  const cur = net.homes.get(meId()); if (!cur) return Promise.resolve();
  return putHome({ house: cur.house, ts: cur.ts, paint: cur.paint || '#f2e3c6', floor: cur.floor || '#c9a77a', furn: cur.furn || [], ...patch });
}
export { mergeHomes };
net.saveHome = saveHome;
export const setPaint = color => saveHome({ paint: color });

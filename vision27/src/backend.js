import { createClient } from '@supabase/supabase-js';

/* Supabase backend for the standalone web build.
   - Auth: username + email + password, a 6-digit code by email, log in, reset password.
   - Profiles, elections, news and the leaderboard.
   - Adapters that give net.js the same room / db / user shapes the claude.ai runtime gives,
     so chat, homes, follows, DMs and live players all run on Supabase unchanged. */
export const SUPABASE_URL = 'https://qzpikbpdfzbifmjahteh.supabase.co';
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6cGlrYnBkZnpiaWZtamFodGVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyOTc1NzQsImV4cCI6MjEwNjg3MzU3NH0.u-UoJtpnKZ4m2OcVodhZCgKcsd-VpD6tggpm_rvkXGc';

// where email links send players back to (the live game, even when testing on this computer)
// what kind of email link brought the player here (read before Supabase tidies the address bar)
export const LINK_TYPE = new URLSearchParams(location.hash.slice(1)).get('type');
export const SITE_URL = /^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname) || location.protocol === 'file:' ? 'https://vision27.vercel.app' : location.origin;
// links in emails log the player in when they land back on the site (detectSessionInUrl)
export const sb = createClient(SUPABASE_URL, window.__SB_ANON || SUPABASE_ANON, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage }, realtime: { params: { eventsPerSecond: 10 } } });
const msg = e => (e && (e.message || e.error_description || e.msg)) || 'Something went wrong. Try again.';
const ok = async p => { const { data, error } = await p; if (error) throw new Error(friendly(msg(error))); return data; };
function friendly(m) {
  if (/invalid login/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'EMAIL_NOT_CONFIRMED';
  if (/already registered|already been registered/i.test(m)) return 'That email already has an account. Log in instead.';
  if (/token has expired|invalid.*token|otp/i.test(m)) return 'That code is wrong or has expired. Ask for a new one.';
  if (/email rate limit/i.test(m)) return 'The game has sent too many emails this hour. Please try again later.';
  if (/rate limit|too many/i.test(m)) return 'Too many tries. Wait a minute and try again.';
  if (/password should be|weak password/i.test(m)) return 'Password must be at least 8 characters, with letters and numbers.';
  if (/error sending|sending (confirmation|recovery|magic)/i.test(m)) return 'We could not send the email right now. Try again in a few minutes.';
  if (/only request this after (\d+)/i.test(m)) return `For safety, wait ${m.match(/after (\d+)/i)[1]} seconds before asking for another code.`;
  if (/signups not allowed/i.test(m)) return 'New sign ups are closed for now.';
  if (/invalid.*email|email.*invalid/i.test(m)) return 'That email address does not look right.';
  if (/failed to fetch|network/i.test(m)) return 'No connection. Check your internet and try again.';
  return m;
}

/* ---------------- auth ---------------- */
// players who skip the email box log in with their username; Supabase still needs an email, so we make one that never receives mail
const NO_EMAIL = '@player.vision27.vercel.app';
export const nameEmail = u => u.toLowerCase() + NO_EMAIL;
export const hasRealEmail = e => !!e && !e.endsWith(NO_EMAIL);
export const auth = {
  session: async () => (await sb.auth.getSession()).data.session,
  usernameFree: async name => { const { data, error } = await sb.rpc('username_available', { name }); return error ? true : !!data; },
  signUp: async (username, email, password) => {
    const r = await ok(sb.auth.signUp({ email: email || nameEmail(username), password, options: { data: { username }, emailRedirectTo: SITE_URL } }));
    // Supabase hides whether an email is taken: it answers with a user that has no identities and sends nothing
    if (r.user && !r.session && Array.isArray(r.user.identities) && !r.user.identities.length) throw new Error('That email already has an account. Log in instead, or reset your password.');
    return r;
  },
  verify: (email, token, type = 'email') => ok(sb.auth.verifyOtp({ email, token, type })),
  resend: email => ok(sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: SITE_URL } })),
  login: (id, password) => ok(sb.auth.signInWithPassword({ email: id.includes('@') ? id : nameEmail(id), password })),
  loginKind: async name => (await sb.rpc('login_kind', { name })).data,      // 'name', 'email' or null
  addEmail: email => ok(sb.auth.updateUser({ email }, { emailRedirectTo: SITE_URL })),
  sendReset: email => ok(sb.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL })),
  setPassword: password => ok(sb.auth.updateUser({ password })),
  logout: () => sb.auth.signOut(),
  onSignedOut: fn => sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') fn(); }),
  onSignedIn: fn => sb.auth.onAuthStateChange((ev, s) => { if (s && (ev === 'SIGNED_IN' || ev === 'PASSWORD_RECOVERY')) setTimeout(() => fn(ev), 0); }),
  /* an email link that failed (expired or used) comes back as #error=…; read it and clean the address bar */
  linkType: () => LINK_TYPE,
  linkError: () => { const h = new URLSearchParams(location.hash.slice(1)), e = h.get('error_description') || h.get('error'); if (e) history.replaceState(null, '', location.pathname + location.search); return e; },
};

/* ---------------- profiles ---------------- */
export async function myProfile() {
  const s = await auth.session(); if (!s) return null;
  const { data } = await sb.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
  return data;
}
export const saveProfile = async patch => { const s = await auth.session(); if (!s) return; return ok(sb.from('profiles').update({ ...patch, last_seen: new Date().toISOString() }).eq('id', s.user.id)); };
export const leaderboard = async (by = 'net_worth') => ok(sb.from('profiles').select('id, username, level, net_worth, life, office, avatar').order(by, { ascending: false }).limit(20));

/* ---------------- elections and news ---------------- */
export const elections = {
  refresh: () => sb.rpc('ensure_elections'),
  board: () => ok(sb.rpc('election_board')),
  declare: (eid, manifesto) => ok(sb.rpc('declare_candidacy', { eid, manifesto })),
  vote: (eid, candidate) => ok(sb.rpc('cast_vote', { eid, candidate })),
};
export async function latestNews(n = 8) { const { data } = await sb.from('news').select('*').order('id', { ascending: false }).limit(n); return data || []; }
export function onNews(fn) { return sb.channel('news').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'news' }, p => fn(p.new)).subscribe(); }

/* ---------------- adapters for net.js ---------------- */
const colorOf = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 65% 45%)`; };

export function makeUser(profile) {
  return {
    me: async () => ({ id: profile.id, name: profile.username, color: colorOf(profile.id), canEdit: !!profile.is_admin }),
    can: async () => true, isOwner: () => !!profile.is_admin, canEdit: () => !!profile.is_admin, id: async () => profile.id,
    profiles: async ids => {
      const out = {}; if (!ids.length) return out;
      const { data } = await sb.from('profiles').select('id, username, avatar').in('id', ids.slice(0, 200));
      (data || []).forEach(p => { out[p.id] = { name: p.username, color: colorOf(p.id), avatar: p.avatar }; });
      return out;
    },
  };
}

/* db: documents in the kv table, live through one realtime subscription */
export function makeDb() {
  const listeners = new Set();       // { prefix | path, fn }
  const cache = new Map();           // path -> data
  sb.channel('kv').on('postgres_changes', { event: '*', schema: 'public', table: 'kv' }, p => {
    const path = (p.new && p.new.path) || (p.old && p.old.path); if (!path) return;
    if (p.eventType === 'DELETE') cache.delete(path); else cache.set(path, p.new.data);
    listeners.forEach(l => { if (l.path ? l.path === path : path.startsWith(l.prefix)) l.emit(); });
  }).subscribe();
  const snapOf = path => ({ exists: cache.has(path), id: path.split('/').pop(), data: () => cache.get(path) });
  const fetchPath = async path => { const { data } = await sb.from('kv').select('data').eq('path', path).maybeSingle(); if (data) cache.set(path, data.data); else cache.delete(path); };
  const doc = path => ({
    get: async () => { await fetchPath(path); return snapOf(path); },
    set: async data => { cache.set(path, data); await ok(sb.from('kv').upsert({ path, data, updated_at: new Date().toISOString() })); },
    update: async patch => { await fetchPath(path); const next = { ...(cache.get(path) || {}), ...patch }; cache.set(path, next); await ok(sb.from('kv').upsert({ path, data: next, updated_at: new Date().toISOString() })); },
    delete: async () => { cache.delete(path); await ok(sb.from('kv').delete().eq('path', path)); },
    onSnapshot: (fn, err) => { const l = { path, emit: () => fn(snapOf(path)) }; listeners.add(l); fetchPath(path).then(l.emit, e => err?.(e)); return () => listeners.delete(l); },
  });
  const collection = name => ({
    doc: id => doc(name + '/' + id),
    onSnapshot: (fn, err) => {
      const prefix = name + '/';
      const emit = () => fn({ docs: [...cache.keys()].filter(k => k.startsWith(prefix) && k.split('/').length === name.split('/').length + 1).map(snapOf) });
      const l = { prefix, emit }; listeners.add(l);
      sb.from('kv').select('path, data').like('path', prefix + '%').limit(1000).then(({ data, error }) => { if (error) return err?.(error); (data || []).forEach(r => cache.set(r.path, r.data)); emit(); });
      return () => listeners.delete(l);
    },
  });
  return { doc, collection };
}

/* room: live players. Positions go out as broadcasts about 5 times a second,
   and the full state is re-sent every 2 s so newcomers see players who stand still. */
export function makeRoom(profile) {
  const tab = Math.random().toString(36).slice(2, 8), me = profile.id + ':' + tab;
  const ch = sb.channel('city', { config: { presence: { key: me }, broadcast: { self: false } } });
  const peers = new Map();           // peer -> { peer, by, presence, t }
  let state = {}, lastSent = 0, lastFull = 0, dirty = false;
  ch.on('broadcast', { event: 'p' }, ({ payload }) => { if (!payload || payload.peer === me) return; const cur = peers.get(payload.peer) || { peer: payload.peer, by: payload.by, kind: 'viewer', presence: {} }; cur.presence = { ...cur.presence, ...payload.s }; cur.t = Date.now(); peers.set(payload.peer, cur); })
    .on('presence', { event: 'leave' }, ({ key }) => peers.delete(key))
    .subscribe(st => { joined = st === 'SUBSCRIBED'; if (joined) ch.track({ by: profile.id }); });
  let joined = false;
  const send = full => { if (!joined) return; ch.send({ type: 'broadcast', event: 'p', payload: { peer: me, by: profile.id, s: state } }); lastSent = Date.now(); if (full) lastFull = lastSent; dirty = false; };
  setInterval(() => { const now = Date.now(); if (dirty && now - lastSent > 200) send(false); else if (now - lastFull > 2000) send(true); for (const [k, v] of peers) if (now - v.t > 8000) peers.delete(k); }, 100);
  const handlers = {};
  return {
    self: me,
    presence: async patch => { state = { ...state, ...patch }; dirty = true; },
    peers: () => [...peers.values()],
    on: (topic, fn) => { if (!handlers[topic]) { handlers[topic] = []; ch.on('broadcast', { event: 'e:' + topic }, ({ payload }) => handlers[topic].forEach(f => f({ data: payload, sameTab: false }))); } handlers[topic].push(fn); return () => { }; },
    emit: async (topic, data) => { if (joined) ch.send({ type: 'broadcast', event: 'e:' + topic, payload: data }); },
  };
}

/* ---------------- wallet, work, market, frames (all checked on the server) ---------------- */
const rpc = (fn, args) => ok(sb.rpc(fn, args));
export const W = {
  wallet: () => rpc('wallet_get'),
  ledger: async () => ok(sb.from('ledger').select('delta, reason, created_at').order('id', { ascending: false }).limit(12)),
  sync: (earned, spent, why) => rpc('wallet_sync', { earned, spent, why }),
  profile: () => rpc('my_work_profile'),
  practice: skill => rpc('skill_practice', { sk: skill }),
  board: () => rpc('jobs_board'),
  post: j => rpc('job_post', { j }),
  apply: id => rpc('job_apply', { jid: id }),
  applicants: id => rpc('job_applicants', { jid: id }),
  decide: (id, uid, act) => rpc('job_decide', { jid: id, uid, act }),
  quit: id => rpc('job_quit', { jid: id }),
  close: id => rpc('job_close', { jid: id }),
  shifts: () => rpc('my_shifts'),
  posts: () => rpc('my_posts'),
  checkin: (id, x, z) => rpc('shift_checkin', { sid: id, px: x, pz: z }),
  finish: (id, x, z) => rpc('shift_finish', { sid: id, px: x, pz: z }),
  budget: () => rpc('my_budget'),
  businesses: async () => ok(sb.from('businesses').select('*').eq('owner', (await auth.session())?.user.id).order('id')),
  openBusiness: (nm, k) => rpc('business_open', { nm, k }),
  fund: (bid, amount) => rpc('business_fund', { bid, amount }),
  prices: () => rpc('market_prices'),
  buy: (it, n) => rpc('buy_item', { it, n }),
  use: (it, n) => rpc('use_item', { it, n }),
  policies: () => ok(sb.from('policies').select('*')),
  setPolicy: (k, v, why) => rpc('policy_set', { k, v, why }),
  plots: async () => ok(sb.from('plots').select('*').order('id')),
  buyPlot: pid => rpc('plot_buy', { pid }),
  listPlot: (pid, ask) => rpc('plot_list', { pid, ask_: ask }),
  // Building Explorer: pieces, drafts, commits (all checked on the server)
  govSites: async () => ok(sb.from('gov_sites').select('id, official, name')),
  parts: async () => { const out = []; for (let i = 0; ; i += 1000) { const rows = await ok(sb.from('parts').select('id, site, piece, fl, x, z, rot, built').order('id').range(i, i + 999)); out.push(...rows); if (rows.length < 1000) return out; } },
  mySites: () => rpc('my_sites'),
  siteRole: site => rpc('site_role', { site_: site }),
  piecePrices: site => rpc('piece_prices', { site_: site }),
  pieceBuy: (pid, n, site) => rpc('piece_buy', { pid, n, site_: site }),
  siteCommit: (site, ops) => rpc('site_commit', { site_: site, ops }),
  siteRename: (site, nm) => rpc('site_rename', { site_: site, nm }),
  nameReport: (site, why) => rpc('name_report', { site_: site, why }),
  draftSave: (site, ops, note, submit) => rpc('site_draft_save', { site_: site, ops, note_: note, submit }),
  draftsFor: site => rpc('site_drafts_for', { site_: site }),
  approve: (site, author, ok_) => rpc('site_approve', { site_: site, author_: author, ok: ok_ }),
  contractBuild: (site, crew, ghosts) => rpc('contract_build', { site_: site, crew_: crew, ghosts }),
  // work floors: tasks at stations, real city stock, public works
  floorNext: (sid, site, role) => rpc('floor_task_next', { sid, site_: site, role_: role }),
  floorDone: (tid, x, z, where, ans) => rpc('floor_task_done', { tid, px: x, pz: z, where_: where, ans }),
  clockout: (id, x, z) => rpc('shift_clockout', { sid: id, px: x, pz: z }),
  gig: site => rpc('floor_gig', { site_: site }),
  orderDelivery: (it, n, bid) => rpc('order_delivery', { it, n, bid }),
  myOrders: () => rpc('my_orders'),
  contractPost: (kind, crew, ghosts) => rpc('contract_post', { kind_: kind, crew_: crew, ghosts }),
  contracts: () => rpc('contracts_list'),
  cityFixes: () => rpc('city_fixes'),
  shelfTake: (site, it) => rpc('shelf_take', { site_: site, it }),
  // frames: compressed photo → private storage → moderation queue
  uploadFrame: async blob => {
    const uid = (await auth.session())?.user.id, path = `${uid}/${Date.now().toString(36)}.jpg`;
    const { error } = await sb.storage.from('frames').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(friendly(msg(error)));
    return { id: await rpc('frame_add', { p: path }), path };
  },
  frameUrl: async path => { const { data } = await sb.storage.from('frames').createSignedUrl(path, 3600); return data?.signedUrl || null; },
  frameInfo: async ids => ids.length ? ok(sb.from('frames').select('id, owner, path, status').in('id', ids)) : [],
  removeFrame: async id => { const p = await rpc('frame_remove', { fid: id }); await sb.storage.from('frames').remove([p]); },
  reportFrame: (id, why) => rpc('frame_report', { fid: id, why }),
  reviewFrame: (id, st) => rpc('frame_review', { fid: id, st }),
  frameQueue: () => rpc('frames_queue'),
};

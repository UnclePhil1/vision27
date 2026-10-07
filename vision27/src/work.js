import { G, naira, dialog, formDialog } from './game.js';
import { eco, setBalance, syncWallet } from './economy.js';
import { srv, online, SKILLS, LEVELS, levelOf, cityHourAt, hh } from './server.js';
import { mapState, setDestination } from './map.js';
import { track, style } from './life.js';
import { askText } from './hub.js';

/* Work: a job board where players, businesses, unions, government and city firms post jobs.
   Apply → (shortlist) → hire → shifts on the city clock → clock in at the place → finish → paid.
   Skill grows only by working; missing a shift costs reputation. Employers see skill and
   reputation, never money. Online, all of this runs on the server (see supabase/schema.sql §6–9). */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { tab: 'find', board: [], shifts: [], prof: null, posts: [], biz: [], budget: 0, view: null, fit: false, t: 0, chipT: 0 };
const MORAL = { clean: ['Clean', '#1d8a4a'], padded: ['Padded', '#c9472f'], union: ['Union', '#d9771f'], government: ['Government', '#2e5fa8'] };
const UNION_PLACES = ['Nyanya Motor Park', 'Abuja Motor Park', 'Unity Market', 'Nyanya Park Market'];
const QUICK = [['Drive for Ride', null, 'Phone → Ride → Go online'], ['Deliver for Chow', null, 'Phone → Chow → Go online'], ['Office shifts', 'Zuma Towers', 'Walk in and work'], ['Bank teller', 'Sovereign Trust Bank HQ', 'Walk in and work'], ['Remote tech gigs', 'Utako Tech Hub', 'Walk in and work']];
const payText = j => (j.unit === 'hour' ? `${naira(j.pay)}/hr` : `${naira(j.pay)} a job`);
const when = j => `${hh(j.start_hour)}–${hh(j.start_hour + j.hours)}${j.source === 'city' ? ' daily' : j.days > 1 ? ` · ${j.days} days` : ' · 1 day'}`;
const tag = m => `<i class="jtag" style="--c:${MORAL[m][1]}">${MORAL[m][0]}</i>`;
const mins = t => Math.max(0, Math.round((new Date(t) - Date.now()) / 60000));
const office = () => G.profile?.office || null;
const err = e => G.toast(e?.message || 'Something went wrong');

/* where the server should think I am: inside the named building counts as being at its door */
function here(place, j) { if (G.isInside?.()) return G.insideName?.() === place && j ? { x: j.x, z: j.z } : { x: 1e5, z: 1e5 }; return { x: G.player.pos.x, z: G.player.pos.z }; }
const go = (x, z, name) => { setDestination(x, z, name); G.closePhone?.(); };

export async function refreshWork() {
  if (!srv) return;
  try { const [a, b] = await Promise.all([srv.shifts(), srv.profile()]); S.shifts = a || []; S.prof = b; } catch { }
  S.t = 0;
}
/* NPC work gives a little practice in shift skills (rate limited on the server) */
export function practice(place) {
  const n = (place || '').toLowerCase();
  const sk = /kitchen|restaurant|buka|bakery/.test(n) ? 'kitchen' : /gym/.test(n) ? 'fitness' : /club|bar|lounge|parlour/.test(n) ? 'club' : /dispatch|chow/.test(n) ? 'delivery' : /ride|taxi/.test(n) ? 'driving' : /bank|security/.test(n) ? 'security' : 'shop';
  srv?.practice(sk).catch(() => { });
}

/* ---------------- shifts in the world ---------------- */
const current = () => S.shifts.find(s => s.status === 'on') || S.shifts.filter(s => s.status === 'scheduled').sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0];
async function clockIn(s) {
  const p = here(s.place, s);
  try { await srv.checkin(s.id, p.x, p.z); s.status = 'on'; G.toast(`Clocked in at ${s.place}. Stay nearby until ${hh(cityHourAt(new Date(s.ends_at)))}.`); G.Sound?.ding?.(); }
  catch (e) { err(e); }
}
export async function finish(s, early = false) {
  const p = here(s.place, s);
  try {
    const r = await (early ? srv.clockout : srv.finish)(s.id, p.x, p.z); s.status = 'done';
    if (online()) setBalance(r.balance);
    if (r.moral) style(r.moral);
    track('shift'); track(s.skill === 'delivery' ? 'deliver' : 'work');
    G.toast(`+${naira(r.paid)} wages${r.tasks !== undefined ? ` for ${r.tasks} tasks${r.fails ? ` (${r.fails} wrong)` : ''}` : ''}${r.due ? ` (union dues ${naira(r.due)})` : ''}. ${SKILLS[r.skill]}: ${LEVELS[r.level]} (${r.xp} XP)`); G.Sound?.buy?.(true);
    refreshWork();
  } catch (e) { err(e); }
}
function provider(p, out, inside) {
  const s = current(); if (!s) return;
  const now = Date.now(), st = new Date(s.starts_at), en = new Date(s.ends_at);
  const d = inside ? (G.insideName?.() === s.place ? 1 : 99) : Math.max(1, Math.hypot(p.x - s.x, p.z - s.z) - 20);
  if (s.status === 'scheduled' && now >= st - 60000 && now < en) out(d, { label: `Clock in: ${s.title}`, run: () => clockIn(s) });
  if (s.status === 'on' && now >= en - 5000) out(d, { label: s.meta?.floor || s.meta?.build ? 'Finish shift: get paid for your tasks' : `Finish shift: collect ${naira(s.pay)}`, run: () => finish(s) });
}
function paintChip() {
  const el = $('shiftChip'); if (!el) return;
  const s = current(); el.hidden = !s;
  if (!s) return;
  const now = Date.now(), st = new Date(s.starts_at), en = new Date(s.ends_at);
  el.innerHTML = s.status === 'on'
    ? (now >= en ? `<b>Shift over</b> · finish at ${esc(s.place)} to get paid` : `<b>On shift</b> · ${esc(s.title)} · ${Math.ceil((en - now) / 60000)} city hr left`)
    : now >= st - 60000 ? `<b>Clock in now</b> · ${esc(s.title)} at ${esc(s.place)}` : `<b>Next shift</b> ${hh(cityHourAt(st))} · ${esc(s.title)} · in ${mins(st)} min`;
}
export function updateWork(dt) {
  if (!srv) return;
  S.t += dt; S.chipT -= dt;
  if (S.t > (S.shifts.some(s => ['scheduled', 'on'].includes(s.status)) ? 20 : 60)) refreshWork();
  if (S.chipT <= 0) { S.chipT = 1; paintChip(); }
}

/* ---------------- the Work app ---------------- */
const TABS = [['find', 'Find work'], ['mine', 'My shifts'], ['hire', 'Hire'], ['skills', 'Skills']];
async function render(body, rerender) {
  const head = `<div class="seg">${TABS.map(([k, n]) => `<button class="${S.tab === k ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>`;
  body.innerHTML = head + '<p class="ph-empty">Loading…</p>';
  try { await ({ find: renderFind, mine: renderMine, hire: renderHire, skills: renderSkills })[S.tab](body, rerender, head); }
  catch (e) { body.innerHTML = head + `<p class="ph-empty">${esc(e.message)}</p>`; }
  body.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; S.view = null; rerender(); });
}

async function renderFind(body, rerender, head) {
  S.board = (await srv.board()) || [];
  const list = S.board.filter(j => !j.mine && (!S.fit || j.my_level >= j.min_level));
  body.innerHTML = head + `<div class="ph-card"><b>${list.length} jobs open</b><small>Pay is held safe when a job is posted. Shifts run on the city clock: 1 minute = 1 hour.</small>
    <label class="tick"><input type="checkbox" id="wFit" ${S.fit ? 'checked' : ''}> Only jobs I can do now</label></div>`
    + list.map(j => {
      const can = j.my_level >= j.min_level, st = j.my_status;
      return `<div class="job"><div class="job-top"><b>${esc(j.title)}</b>${tag(j.moral)}</div>
        <small>${esc(j.employer)} · ${esc(j.place)}</small>
        <small>${payText(j)} · ${when(j)} · ${SKILLS[j.skill]}${j.min_level ? ` ${LEVELS[j.min_level]}+` : ''}${j.source !== 'city' ? ` · ${j.hired}/${j.slots} hired` : ''}${j.due_pct ? ` · ${j.due_pct}% dues` : ''}</small>
        <div class="job-btns"><button class="chip" data-gps="${j.id}">GPS</button>${st === 'hired' ? '<span class="jok">Hired ✓</span>' : st && st !== 'quit' && st !== 'rejected' ? `<span class="jok">${esc(st[0].toUpperCase() + st.slice(1))}</span>` : `<button class="mini-btn" data-apply="${j.id}" ${can ? '' : 'disabled'}>${can ? (j.source === 'city' ? 'Take shift' : 'Apply') : `Need ${LEVELS[j.min_level]}`}</button>`}</div></div>`;
    }).join('')
    + `<div class="ph-sec">Quick money (no schedule)</div>` + QUICK.map(([n, place, how], i) => `<button class="row-th" data-quick="${i}"><span class="th-main"><b>${n}</b><small>${how}${place ? ' · ' + place : ''}</small></span></button>`).join('');
  $('wFit').onchange = e => { S.fit = e.target.checked; rerender(); };
  body.querySelectorAll('[data-gps]').forEach(b => b.onclick = () => { const j = S.board.find(x => x.id === +b.dataset.gps); go(j.x, j.z, `${j.title}: ${j.place}`); });
  body.querySelectorAll('[data-apply]').forEach(b => b.onclick = async () => {
    const j = S.board.find(x => x.id === +b.dataset.apply);
    if (j.moral === 'padded' && !(await dialog('A padded contract', 'This job is paid from a padded budget. Taking it pushes you toward the shady side.', [{ label: 'Take it anyway', value: true }, { label: 'Leave it', value: false }]))) return;
    try { const r = await srv.apply(j.id); G.toast(r === 'hired' ? `You start at ${hh(j.start_hour)}. Be at ${j.place} on time.` : 'Applied. The employer will review your skill and reputation.'); await refreshWork(); rerender(); } catch (e) { err(e); }
  });
  body.querySelectorAll('[data-quick]').forEach(b => b.onclick = () => { const [n, place] = QUICK[+b.dataset.quick]; const o = place && mapState.pois.find(q => q.name.startsWith(place)); if (o) go(o.x, o.z, `${n}: ${o.name}`); else G.toast('Open the Ride or Chow app'); });
}

async function renderMine(body, rerender, head) {
  await refreshWork();
  const list = S.shifts.slice().sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const label = s => ({ scheduled: Date.now() >= new Date(s.starts_at) - 60000 ? 'Clock in now' : `Starts in ${mins(s.starts_at)} min`, on: 'On shift', done: `Paid ${naira(s.paid || s.pay)}`, missed: 'Missed (−5 reputation)', cancelled: 'Cancelled' })[s.status];
  body.innerHTML = head + (list.length ? list.map(s => `<div class="job${s.status === 'on' ? ' live' : ''}"><div class="job-top"><b>${esc(s.title)}</b>${tag(s.moral)}</div>
      <small>${esc(s.employer)} · ${esc(s.place)} · ${hh(cityHourAt(new Date(s.starts_at)))}–${hh(cityHourAt(new Date(s.ends_at)))}</small>
      <small>${label(s)} · ${naira(s.pay)} for the shift</small>
      <div class="job-btns">${['scheduled', 'on'].includes(s.status) ? `<button class="chip" data-gps="${s.id}">GPS</button><button class="chip" data-quit="${s.job_id}">Quit job</button>` : ''}</div></div>`).join('')
    : '<p class="ph-empty">No shifts yet. Take one from Find work.</p>')
    + '<p class="ph-note">Clock in at the place when the shift starts, stay nearby, then press the action button to get paid. Late? You are paid for the time you worked.</p>';
  body.querySelectorAll('[data-gps]').forEach(b => b.onclick = () => { const s = S.shifts.find(x => x.id === +b.dataset.gps); go(s.x, s.z, `${s.title}: ${s.place}`); });
  body.querySelectorAll('[data-quit]').forEach(b => b.onclick = async () => { if (!(await dialog('Quit this job?', 'Your future shifts are cancelled and you lose 3 reputation.', [{ label: 'Quit', value: true }, { label: 'Stay', value: false }]))) return; try { await srv.quit(+b.dataset.quit); await refreshWork(); rerender(); } catch (e) { err(e); } });
}

async function renderSkills(body, rerender, head) {
  await refreshWork();
  const w = S.prof?.worker || {}, sk = S.prof?.skills || {};
  const rows = Object.entries(SKILLS).map(([k, n]) => { const xp = sk[k] || 0, lv = levelOf(xp), next = [3, 10, 25][lv]; return { k, n, xp, lv, pct: next ? Math.round(xp / next * 100) : 100 }; }).sort((a, b) => b.xp - a.xp);
  body.innerHTML = head + `<div class="ph-card"><b>Reputation ${w.rep ?? 50}/100</b><small>${w.shifts_done || 0} shifts done · ${w.shifts_missed || 0} missed. Employers see this and your skills, never your money.</small><div class="xpbar"><i style="width:${w.rep ?? 50}%"></i></div></div>`
    + rows.map(r => `<div class="row-th"><span class="th-main"><b>${r.n}</b><small>${LEVELS[r.lv]} · ${r.xp} XP${r.lv < 3 ? ` · next at ${[3, 10, 25][r.lv]}` : ''}</small><div class="xpbar"><i style="width:${r.pct}%"></i></div></span></div>`).join('')
    + '<p class="ph-note">Skills grow only by doing the work. Skilled trade jobs also need your own tools, sold at Unity Market.</p>';
}

/* ---------------- hiring ---------------- */
function sources() {
  const s = [['own', 'My own money']];
  if (eco.role === 'coordinator') s.push(['union', 'Union (traders pay, you take dues)']);
  if (eco.role === 'sponsor') s.push(['business', 'One of my businesses']);
  if (office()) s.push(['seat', `Office budget (${naira(S.budget)})`]);
  return s;
}
async function renderHire(body, rerender, head) {
  if (S.view) return renderApplicants(body, rerender, head);
  [S.posts, S.biz, S.budget] = (await Promise.all([srv.posts(), eco.role === 'sponsor' ? srv.businesses() : [], office() ? srv.budget() : 0])).map((v, i) => v ?? [[], [], 0][i]);
  if (!online()) { body.innerHTML = head + `<div class="ph-card"><b>Hiring needs the online version</b><small>Here you can take city jobs and build skills. Sign in at the online game to hire players, run a business or post government jobs.</small></div>`; return; }
  const pois = mapState.pois.filter(o => o.cat !== 'home'), mine = mapState.pois.find(o => o.house !== undefined && o.house === G.myHouseIdx?.());
  const places = [...(mine ? [{ ...mine, name: 'My house', home: true }] : []), { name: 'Where I am standing', x: G.player.pos.x, z: G.player.pos.z }, ...pois];
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  body.innerHTML = head
    + (eco.role === 'sponsor' ? `<div class="ph-sec">My businesses</div>${S.biz.map(b => `<div class="row-th"><span class="th-main"><b>${esc(b.name)}</b><small>${esc(b.kind)} · funds ${naira(b.funds)}</small></span><button class="mini-btn" data-fund="${b.id}">Add funds</button></div>`).join('') || '<p class="ph-empty">No business yet.</p>'}<button class="chip" id="wBiz">Register a business (₦5,000,000)</button>` : '')
    + (office() ? policyBox() : '')
    + `<div class="ph-sec">Post a job</div><div class="wform">
      <label>Who pays<select id="fSrc">${sources().map(([v, t]) => opt(v, t)).join('')}</select></label>
      <label id="fBizL" hidden>Business<select id="fBiz">${S.biz.map(b => opt(b.id, `${b.name} (${naira(b.funds)})`)).join('')}</select></label>
      <label>Job title<input id="fTitle" maxlength="50" placeholder="e.g. Fix my fridge"></label>
      <label>Skill<select id="fSkill">${Object.entries(SKILLS).map(([k, n]) => opt(k, n)).join('')}</select></label>
      <label>Lowest level<select id="fLvl">${LEVELS.map((n, i) => opt(i, n)).join('')}</select></label>
      <div class="wrow"><label>Pay (₦)<input id="fPay" type="number" min="500" step="500" value="4000"></label><label>Per<select id="fUnit">${opt('hour', 'hour')}${opt('job', 'job')}</select></label></div>
      <div class="wrow"><label>Starts<select id="fStart">${Array.from({ length: 24 }, (_, h) => opt(h, hh(h), h === (Math.floor(cityHourAt(Date.now())) + 2) % 24)).join('')}</select></label><label>Hours<input id="fHours" type="number" min="1" max="8" value="3"></label></div>
      <div class="wrow"><label>Days<input id="fDays" type="number" min="1" max="7" value="1"></label><label>People<input id="fSlots" type="number" min="1" max="10" value="1"></label></div>
      <label>Place<select id="fPlace">${places.map((p, i) => opt(i, p.name)).join('')}</select></label>
      <label id="fMoralL" hidden>Contract<select id="fMoral">${opt('government', 'Clean government job')}${opt('padded', 'Padded (you skim 30%, Predator)')}</select></label>
      <label id="fDueL" hidden>Union dues %<input id="fDue" type="number" min="0" max="30" value="10"></label>
      <p class="ph-note" id="fCost"></p><button class="cta" id="fPost">Post job</button></div>`
    + `<div class="ph-sec">My job posts</div>` + (S.posts.map(p => `<div class="row-th"><span class="th-main"><b>${esc(p.title)}</b><small>${p.open ? 'Open' : 'Closed'} · ${p.hired}/${p.slots} hired · ${p.applied} waiting · ${p.done} shifts done${p.open ? ` · ${naira(p.escrow)} held` : ''}</small></span>${p.open ? `<button class="mini-btn" data-view="${p.id}">Applicants</button>` : ''}</div>`).join('') || '<p class="ph-empty">You have not posted a job.</p>');

  const f = id => body.querySelector('#' + id), val = id => f(id).value;
  const sync = () => {
    const src = val('fSrc'); f('fBizL').hidden = src !== 'business'; f('fMoralL').hidden = src !== 'seat'; f('fDueL').hidden = src !== 'union';
    if (src === 'union') { f('fPlace').innerHTML = places.filter(p => UNION_PLACES.includes(p.name)).map(p => opt(places.indexOf(p), p.name)).join(''); f('fUnit').value = 'hour'; }
    const per = +val('fPay') * (val('fUnit') === 'hour' ? +val('fHours') : 1), total = per * +val('fSlots') * +val('fDays');
    f('fCost').textContent = src === 'union' ? `The traders' levy pays the wages. You keep ${val('fDue')}% of each shift as dues.` : `${naira(total)} is held now and paid out per finished shift. Unused money comes back when you close the job.`;
  };
  ['fSrc', 'fPay', 'fUnit', 'fHours', 'fSlots', 'fDays', 'fDue'].forEach(id => f(id).oninput = sync); sync();
  f('fPost').onclick = async () => {
    const pl = places[+val('fPlace')], src = val('fSrc');
    const j = { source: src, business_id: src === 'business' ? +val('fBiz') : null, kind: ['mason', 'electrician', 'plumber', 'tiler', 'carpenter', 'painter', 'mechanic'].includes(val('fSkill')) ? 'trade' : ['architect', 'supervisor', 'driving', 'security'].includes(val('fSkill')) ? 'pro' : ['aide', 'organiser', 'liaison'].includes(val('fSkill')) ? 'staff' : 'shift',
      title: val('fTitle').trim() || 'Helper', skill: val('fSkill'), min_level: +val('fLvl'), pay: +val('fPay'), unit: val('fUnit'), start_hour: +val('fStart'), hours: +val('fHours'),
      days: +val('fDays'), slots: +val('fSlots'), place: pl.name, x: pl.x, z: pl.z, moral: src === 'seat' ? (pl.home ? 'padded' : val('fMoral')) : 'clean', due_pct: +val('fDue'), meta: pl.home ? { home: true } : {} };
    if (src === 'seat' && pl.home && !(await dialog('Public money at your house?', 'Paying for work at your own house from the office budget is marked as padded. It pushes you toward Predator.', [{ label: 'Do it anyway', value: true }, { label: 'Cancel', value: false }]))) return;
    try { await syncWallet(); await srv.post(j); style(j.moral === 'padded' ? -10 : src === 'union' && j.due_pct > 20 ? -4 : src === 'union' ? 1 : 2); G.toast('Job posted. Applicants will show here.'); if (online()) setBalance(await srv.wallet()); rerender(); } catch (e) { err(e); }
  };
  const bz = f('wBiz'); if (bz) bz.onclick = async () => {
    const name = await askText('Business name', 'e.g. Zuma Logistics'); if (!name) return;
    const kind = await dialog('What kind of business?', '', ['shop', 'restaurant', 'club', 'gym', 'logistics', 'construction', 'security', 'media'].map(k => ({ label: k[0].toUpperCase() + k.slice(1), value: k })).concat([{ label: 'Cancel', value: null }]));
    if (!kind) return;
    try { await syncWallet(); await srv.openBusiness(name.slice(0, 40), kind); setBalance(await srv.wallet()); G.toast(`${name} is registered. Add funds, then post jobs.`); rerender(); } catch (e) { err(e); }
  };
  body.querySelectorAll('[data-fund]').forEach(b => b.onclick = async () => {
    const amt = Math.round(+(await askText('How much to add? (₦)', '1000000')).replace(/[^0-9]/g, '')); if (!amt) return;
    try { await syncWallet(); await srv.fund(+b.dataset.fund, amt); style(1); setBalance(await srv.wallet()); rerender(); } catch (e) { err(e); }
  });
  body.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { S.view = +b.dataset.view; rerender(); });
  body.querySelectorAll('[data-policy]').forEach(b => b.onclick = () => setPolicy(b.dataset.policy, rerender));
  works(body.querySelector('#wWorks'), rerender);
}
/* public works: the crew works the FCDA Works Yard and fixes real spots in the city */
async function works(el, rerender) {
  if (!el) return; let list = []; try { list = (await srv.contracts()) || []; } catch { }
  el.innerHTML = `<div class="ph-card"><small>Pay a crew from your budget (₦32,000 a worker). They sign out tools at the FCDA Works Yard and fix real spots. Finished work with the crew paid pushes Reformer. Ghost names on the crew list put money in your pocket and push Predator.</small>
    <button class="chip" data-land="1">Build on government land</button><button class="chip" data-works="road">Road repair</button><button class="chip" data-works="waste">Waste clearance</button><button class="chip" data-works="market">Market repair</button></div>`
    + list.map(c => `<div class="row-th"><span class="th-main"><b>${esc(c.title)}</b><small>${c.status === 'open' ? 'Open' : c.status === 'done' ? 'Finished' : 'Lapsed'} · ${c.done.length}/${c.targets.length} spots done · crew of ${c.crew}${c.mine ? ' · yours' : ''}</small></span></div>`).join('');
  el.querySelectorAll('[data-land]').forEach(b => b.onclick = () => G.openApp?.('land'));
  el.querySelectorAll('[data-works]').forEach(b => b.onclick = async () => {
    const v = await formDialog({ road: 'Road repair', waste: 'Waste clearance', market: 'Market repair' }[b.dataset.works], 'Workers apply on the Work app and work the yard for 2 days.', [
      { id: 'crew', label: 'Real workers', type: 'number', value: 2, min: 1, max: 6 },
      { id: 'ghosts', label: 'Extra names on the list (ghost workers)', type: 'number', value: 0, min: 0, max: 6 }], 'Commission it',
      x => `${naira(32000 * (+x.crew + +x.ghosts))} from the budget.${+x.ghosts ? ` ${naira(32000 * x.ghosts)} of it goes to you. That is padding.` : ''}`);
    if (!v) return;
    try { await srv.contractPost(b.dataset.works, +v.crew, +v.ghosts); style(+v.ghosts ? 2 - Math.min(20, 6 * v.ghosts) : 2); if (online()) setBalance(await srv.wallet()); G.toast('Commissioned. The crew job is on the Work board.'); rerender(); } catch (e) { err(e); }
  });
}
function policyBox() {
  const o = office(), canFuel = ['vp', 'president'].includes(o), canLevy = ['chairman', 'senator', 'vp', 'president'].includes(o);
  return `<div class="ph-sec">City policy</div><div class="ph-card"><small>Office budget: ${naira(S.budget)} (refills daily). Squeezing people pushes Predator. Relief pushes Reformer.</small>
    ${canFuel ? '<button class="chip" data-policy="fuel">Set fuel price</button>' : ''}${canLevy ? '<button class="chip" data-policy="market_levy">Set market levy</button>' : ''}${!canFuel && !canLevy ? '<small>Councilors post public jobs. Chairmen and up also set city policy.</small>' : ''}</div><div class="ph-sec">Public works</div><div id="wWorks"></div>`;
}
async function setPolicy(k, rerender) {
  const opts = k === 'fuel' ? [[.7, 'Subsidy: 70% (long queues)'], [1, 'Normal: 100%'], [1.3, 'Raise to 130%'], [1.6, 'Raise to 160%']] : [[0, 'No levy'], [.05, '5%'], [.1, '10%'], [.2, '20%'], [.3, '30%']];
  const v = await dialog(k === 'fuel' ? 'Fuel pump price' : 'Market levy on materials', 'Everyone in the city feels this right away.', opts.map(([value, label]) => ({ label, value })).concat([{ label: 'Cancel', value: null }]));
  if (v === null || v === undefined) return;
  try { await srv.setPolicy(k, v, ''); style((k === 'fuel' && v > 1.2) || (k === 'market_levy' && v > .1) ? -8 : (k === 'fuel' && v < 1) || (k === 'market_levy' && v === 0) ? 4 : 0); G.loadPolicies?.(); rerender(); } catch (e) { err(e); }
}
async function renderApplicants(body, rerender, head) {
  const list = (await srv.applicants(S.view)) || [], post = S.posts.find(p => p.id === S.view);
  const btn = (a, act, label) => `<button class="mini-btn${act === 'reject' || act === 'fire' ? ' ghost' : ''}" data-act="${act}" data-u="${a.user_id}">${label}</button>`;
  body.innerHTML = head + `<button class="chip" id="wBack">← My posts</button><div class="ph-card"><b>${esc(post?.title || 'Job')}</b><small>${post?.hired || 0}/${post?.slots || 1} hired. You see each person's skill and reputation, not their money.</small></div>`
    + (list.map(a => `<div class="job"><div class="job-top"><b>${esc(a.username)}</b><span class="jok">${esc(a.status)}</span></div>
      <small>${LEVELS[a.level]} (${a.xp} XP) · Reputation ${a.rep} · ${a.shifts_done} done · ${a.shifts_missed} missed</small>
      <div class="job-btns">${a.status === 'applied' ? btn(a, 'shortlist', 'Shortlist') : ''}${['applied', 'shortlisted'].includes(a.status) ? btn(a, 'hire', 'Hire') + btn(a, 'reject', 'Reject') : ''}${a.status === 'hired' ? btn(a, 'fire', 'Fire') : ''}</div></div>`).join('') || '<p class="ph-empty">No one has applied yet.</p>')
    + `<button class="chip" id="wClose">Close this job and get unused money back</button>`;
  body.querySelector('#wBack').onclick = () => { S.view = null; rerender(); };
  body.querySelector('#wClose').onclick = async () => { try { const back = await srv.close(S.view); if (online()) setBalance(await srv.wallet()); G.toast(`Job closed. ${naira(back)} returned.`); S.view = null; rerender(); } catch (e) { err(e); } };
  body.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => { try { await srv.decide(S.view, b.dataset.u, b.dataset.act); G.toast(b.dataset.act === 'hire' ? 'Hired. Their shifts are on their phone.' : 'Done'); rerender(); } catch (e) { err(e); } });
}

export function initWork() {
  G.phoneApps.work = { name: 'Work', glyph: '💼', color: '#3f5f7f', back: () => (S.view ? ((S.view = null), true) : false), badge: () => S.shifts.filter(s => s.status === 'on' && Date.now() >= new Date(s.ends_at) - 5000 || s.status === 'scheduled' && Date.now() >= new Date(s.starts_at) - 60000).length || 0, render };
  G.actionProviders.push(provider);
  G.practice = practice; G.work = S; G.refreshWork = refreshWork;
  refreshWork();
}

import { G, naira, dialog } from './game.js';
import { eco, changed, setBalance, syncWallet } from './economy.js';
import { lifeToday, claim, levelOf, xpFor, titleOf, clockText, phase, track } from './life.js';
import { RANKS, ROLES, paintRole } from './roles.js';

/* Phone apps: Today (goals, streak, level), Vote and Ranks (online build), Me. */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const OFFICE_RANK = { councilor: 0, chairman: 1, senator: 2, vp: 3, president: 4 };
export const officeRank = o => OFFICE_RANK[o] ?? -1;

export function initHub(backend) {
  const apps = {
    today: { name: 'Today', glyph: '☀', color: '#e8b23a', badge: () => lifeToday().goals.filter(g => g.got >= g.n && !g.claimed).length || 0, render: renderToday },
  };
  if (backend) {
    apps.vote = { name: 'Vote', glyph: '✓', color: '#1d8a4a', render: renderVote };
    apps.ranks = { name: 'Ranks', glyph: '#', color: '#2e5fa8', render: renderRanks };
    apps.me = { name: 'Me', glyph: '☺', color: '#7b2d8e', render: renderMe };
  }
  G.phoneApps = apps;
  const B = backend;

  function renderToday(body, rerender) {
    const L = eco.life, d = lifeToday(), lv = L.level || levelOf(L.xp), p0 = xpFor(lv), p1 = xpFor(lv + 1), pct = Math.round(((L.xp || 0) - p0) / (p1 - p0) * 100);
    body.innerHTML = `<div class="ph-card"><small>${clockText()} · ${esc(phase().name)}</small><b>${esc(ROLES[eco.role || 'citizen'].name)} · ${esc(titleOf())}</b>
      <small>Level ${lv} · ${L.xp || 0} XP · Day ${L.streak || 1} streak</small><div class="xpbar"><i style="width:${pct}%"></i></div>
      <small>${esc(phase().line)}</small></div>
      <div class="ph-sec">Today's goals</div>
      ${d.goals.map((g, i) => `<div class="row-th"><span class="th-main"><b>${esc(g.text)}</b><small>${g.claimed ? 'Claimed ✓' : `${g.got}/${g.n}`}</small><div class="xpbar"><i style="width:${g.got / g.n * 100}%"></i></div></span>${!g.claimed && g.got >= g.n ? `<button class="mini-btn" data-claim="${i}">Claim</button>` : ''}</div>`).join('')}
      <p class="ph-note">New goals every day. Your choices move your title: clean deals and honest work make you a ${titleNice(2)}; shortcuts make you a ${titleNice(0)}.</p>`;
    body.querySelectorAll('[data-claim]').forEach(b => b.onclick = () => { claim(+b.dataset.claim); rerender(); });
  }
  const titleNice = i => ({ citizen: ['Shadow Hustler', '', 'Honest Grinder'], politician: ['Predator', '', 'Reformer'], sponsor: ['Vulture Oligarch', '', 'Impact Banker'], coordinator: ['Mercenary', '', 'Street Guardian'] })[eco.role || 'citizen'][i];

  let boardCache = null, boardT = 0;
  async function renderVote(body, rerender) {
    if (!boardCache || Date.now() - boardT > 15000) { body.innerHTML = '<p class="ph-empty">Loading the ballot…</p>'; try { await B.elections.refresh(); boardCache = await B.elections.board(); boardT = Date.now(); } catch (e) { body.innerHTML = `<p class="ph-empty">${esc(e.message)}</p>`; return; } }
    const seats = []; boardCache.forEach(r => { let s = seats.find(x => x.id === r.election_id); if (!s) seats.push(s = { id: r.election_id, seat: r.seat, title: r.title, fee: r.fee, ends: new Date(r.ends_at), my: r.my_vote, cands: [] }); if (r.candidate_id) s.cands.push(r); });
    const mine = G.profile?.office, left = t => { const m = Math.max(0, Math.round((t - Date.now()) / 60000)); return m > 90 ? Math.round(m / 60) + 'h' : m + 'm'; };
    body.innerHTML = `<div class="ph-card"><b>Elections</b><small>Politicians are chosen by players. ${mine ? `You hold: ${esc(RANKS[officeRank(mine)])}.` : 'Anyone can run for Ward Councilor, then climb.'}</small></div>`
      + seats.map(s => `<div class="ph-sec">${esc(s.title)} · closes in ${left(s.ends)}</div>`
        + (s.cands.length ? s.cands.map(c => `<div class="row-th"><span class="th-main"><b>${esc(c.username)}${c.candidate_id === s.my ? ' ✓' : ''}</b><small>${esc(c.manifesto || 'No promises yet')} · ${c.votes} vote${c.votes == 1 ? '' : 's'}</small></span>${s.my ? '' : `<button class="mini-btn" data-vote="${s.id}:${c.candidate_id}">Vote</button>`}</div>`).join('') : '<p class="ph-empty">No candidates yet.</p>')
        + `<button class="row-th" data-run="${s.id}"><span class="th-main"><b>Run for ${esc(s.title)}</b><small>Form: ${naira(s.fee)}</small></span><span class="mini-btn">Run</span></button>`).join('');
    body.querySelectorAll('[data-vote]').forEach(b => b.onclick = async () => { const [eid, cid] = b.dataset.vote.split(':'); try { await B.elections.vote(+eid, cid); track('vote'); G.toast('Your vote is in. Thank you, citizen!'); boardCache = null; rerender(); } catch (e) { G.toast(e.message); } });
    body.querySelectorAll('[data-run]').forEach(b => b.onclick = async () => {
      const s = seats.find(x => x.id === +b.dataset.run);
      const ok = await dialog(`Run for ${s.title}?`, `The form costs ${naira(s.fee)} from your savings. Write one promise to voters on the next screen.`, [{ label: `Pay ${naira(s.fee)}`, value: true }, { label: 'Not now', value: false }], { who: 'INEC' });
      if (!ok) return;
      const promise = (await askText('Your promise to voters', 'e.g. Light for every street')).slice(0, 140);
      try { await syncWallet(); await G.flushSave?.(); const left = await B.elections.declare(s.id, promise); setBalance(left); track('speech'); G.toast(`You are on the ballot for ${s.title}! Ask people to vote for you.`); boardCache = null; rerender(); }
      catch (e) { G.toast(e.message); }
    });
  }
  async function renderRanks(body) {
    body.innerHTML = '<p class="ph-empty">Loading…</p>';
    try {
      const rows = await B.leaderboard('net_worth');
      body.innerHTML = `<div class="ph-sec">Richest in Abuja</div>` + rows.map((r, i) => `<div class="row-th"><span class="av rank">${i + 1}</span><span class="th-main"><b>${esc(r.username)}${r.office ? ' · ' + esc(RANKS[officeRank(r.office)]) : ''}</b><small>${esc(ROLES[r.life]?.name || 'Citizen')} · Level ${r.level}</small></span><span class="th-time">${naira(r.net_worth)}</span></div>`).join('');
    } catch (e) { body.innerHTML = `<p class="ph-empty">${esc(e.message)}</p>`; }
  }
  function renderMe(body) {
    const p = G.profile || {};
    body.innerHTML = `<div class="ph-card"><b>${esc(p.username)}</b><small>${esc(ROLES[eco.role || 'citizen'].name)}${p.office ? ' · ' + esc(RANKS[officeRank(p.office)]) : ''} · Level ${eco.life.level || 1}</small><small>Money is saved to your account every few seconds.</small>
      <div id="meMail"></div><button class="cta ghost" id="meOut">Log out</button></div>`;
    body.querySelector('#meOut').onclick = () => G.logout?.();
    // players who signed up without an email can add one later, for password resets
    backend?.auth?.session().then(s => {
      const el = body.querySelector('#meMail'); if (!el || !s) return;
      if (backend.hasRealEmail(s.user.email)) { el.innerHTML = `<small>Email: ${esc(s.user.email)}</small>`; return; }
      el.innerHTML = '<small>No email on this account, so a forgotten password cannot be reset.</small><button class="chip" id="meAddMail">Add an email</button>';
      el.querySelector('#meAddMail').onclick = async () => {
        const e = (await askText('Your email', 'you@example.com') || '').trim(); if (!e) return;
        if (!/^\S+@\S+\.\S+$/.test(e)) return G.toast('That email does not look right');
        try { await backend.auth.addEmail(e); G.toast('Check your email and click the link to add it.'); } catch (x) { G.toast(x.message); }
      };
    });
  }
}
export function askText(title, placeholder) {
  return new Promise(res => {
    const box = document.getElementById('dlg'); document.getElementById('dlgTitle').textContent = title; document.getElementById('dlgText').textContent = '';
    document.getElementById('dlgWho').hidden = true;
    const row = document.getElementById('dlgBtns'); row.innerHTML = `<input class="dlg-input" maxlength="140" placeholder="${esc(placeholder)}"><button class="cta">Done</button>`;
    const inp = row.querySelector('input'); inp.focus();
    const done = () => { box.hidden = true; res(inp.value.trim()); };
    row.querySelector('button').onclick = done; inp.onkeydown = e => { if (e.key === 'Enter') done(); e.stopPropagation(); };
    box.hidden = false;
  });
}

/* keep the elected office in sync with the server */
export function initOfficeSync(B, onChange) {
  const check = async () => {
    try { const p = await B.myProfile(); if (!p) return; const was = G.profile?.office; G.profile = { ...G.profile, ...p }; if (p.office !== was) onChange(p.office, was); } catch { }
  };
  setInterval(check, 60000);
  B.onNews(n => { G.ticker?.(n.text); if (/ELECTION RESULT/.test(n.text)) setTimeout(check, 1500); });
  B.elections.refresh();
  setInterval(() => B.elections.refresh(), 5 * 60000);
  // save stats for the leaderboard
  setInterval(() => B.saveProfile({ level: eco.life.level || 1, xp: eco.life.xp || 0, net_worth: Math.round(eco.money), playstyle: eco.life.style || 0 }).catch(() => { }), 45000);
}

import * as THREE from 'three';
import { auth, myProfile, saveProfile } from './backend.js';
import { makeAvatar, SKINS, COLORS, OUTFITS, cleanAvatar, DEFAULT_AVATAR } from './avatar.js';
import { ROLES } from './roles.js';

/* Sign up → 6-digit email code → avatar and life setup. Log in and reset password too.
   Resolves with the player's profile once they are ready to enter the city. */
const $ = id => document.getElementById(id);
const hex = n => '#' + n.toString(16).padStart(6, '0');
let box, resolveGate, email = '', mode = 'login';

/* the splash stays up at least a moment, then fades into whatever comes next */
const shownAt = performance.now();
async function hideSplash() {
  const sp = $('splash'); if (!sp || sp.classList.contains('out')) return;
  await new Promise(r => setTimeout(r, Math.max(0, 1400 - (performance.now() - shownAt))));
  sp.classList.add('out'); setTimeout(() => sp.remove(), 700);
}
export async function authGate() {
  box = $('auth');
  return new Promise(async res => {
    resolveGate = res;
    // a saved session keeps players logged in until they log out or clear browser data
    const s = await auth.session().catch(() => null);
    if (s) { const p = await myProfile().catch(() => null); if (p?.avatar) { await hideSplash(); return finish(p); } }
    box.hidden = false;
    if (s) return afterLogin();
    // new players start on sign up, returning ones on log in
    show(localStorage.getItem('abuja.seen') ? 'login' : 'signup');
    hideSplash();
  });
}
async function afterLogin() {
  const p = await myProfile().catch(() => null);
  if (!p) { show('login', 'We could not load your profile. Check your connection and log in again.'); return; }
  if (!p.avatar) return avatarSetup(p);
  finish(p);
}
function finish(p) { try { localStorage.setItem('abuja.seen', '1'); } catch { } box.hidden = true; hideSplash(); resolveGate(p); }

/* ---------- small form helpers ---------- */
const field = (id, label, type = 'text', attrs = '') => `<label class="af"><span>${label}</span><input id="${id}" type="${type}" ${attrs}></label>`;
function busy(btn, on, text) { btn.disabled = on; if (text) btn.textContent = text; }
function err(text) { const e = $('aErr'); e.textContent = text || ''; e.hidden = !text; }
function card(html) { box.innerHTML = `<div class="acard"><div class="abrand"><b>Vision27</b><small>Abuja life sim</small></div>${html}<p class="aerr" id="aErr" hidden></p></div>`; }

function show(step, note) {
  mode = step;
  if (step === 'login') {
    card(`<h1>Welcome back</h1><p class="asub">Log in to continue your Abuja life.</p>
      ${field('aEmail', 'Email', 'email', 'autocomplete="email" inputmode="email"')}${field('aPass', 'Password', 'password', 'autocomplete="current-password"')}
      <button class="cta wide" id="aGo">Log in</button>
      <div class="alinks"><button class="alink" id="aToSign">New here? Create an account</button><button class="alink" id="aForgot">Forgot password?</button></div>`);
    $('aEmail').value = email;
    $('aGo').onclick = async () => {
      email = $('aEmail').value.trim(); const pw = $('aPass').value; if (!email || !pw) return err('Enter your email and password.');
      busy($('aGo'), true, 'Logging in…');
      try { await auth.login(email, pw); afterLogin(); }
      catch (e) { if (e.message === 'EMAIL_NOT_CONFIRMED') { auth.resend(email).catch(() => { }); show('verify', 'Your email is not verified yet. We sent you a new code.'); } else { err(e.message); busy($('aGo'), false, 'Log in'); } }
    };
    $('aToSign').onclick = () => show('signup'); $('aForgot').onclick = () => show('forgot');
  }
  if (step === 'signup') {
    card(`<h1>Create your account</h1><p class="asub">Your username is how other players see you.</p>
      ${field('aUser', 'Username', 'text', 'autocomplete="username" maxlength="20" placeholder="letters, numbers, _"')}<small class="ahint" id="aUserHint"></small>
      ${field('aEmail', 'Email', 'email', 'autocomplete="email" inputmode="email"')}${field('aPass', 'Password', 'password', 'autocomplete="new-password" placeholder="at least 6 characters"')}
      <button class="cta wide" id="aGo">Create account</button>
      <div class="alinks"><button class="alink" id="aToLogin">I already have an account</button></div>`);
    let t = 0;
    $('aUser').oninput = () => {
      clearTimeout(t); const v = $('aUser').value.trim(), h = $('aUserHint');
      if (!/^[A-Za-z0-9_]{3,20}$/.test(v)) { h.textContent = v ? '3 to 20 letters, numbers or _' : ''; h.className = 'ahint bad'; return; }
      h.textContent = 'Checking…'; h.className = 'ahint';
      t = setTimeout(async () => { const free = await auth.usernameFree(v); if ($('aUser').value.trim() !== v) return; h.textContent = free ? '✓ Available' : 'Taken. Try another.'; h.className = 'ahint ' + (free ? 'good' : 'bad'); }, 350);
    };
    $('aGo').onclick = async () => {
      const u = $('aUser').value.trim(), pw = $('aPass').value; email = $('aEmail').value.trim();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) return err('Pick a username: 3 to 20 letters, numbers or _.');
      if (!/^\S+@\S+\.\S+$/.test(email)) return err('Enter a valid email.');
      if (pw.length < 6) return err('Password must be at least 6 characters.');
      busy($('aGo'), true, 'Creating…');
      try {
        if (!(await auth.usernameFree(u))) throw new Error('That username is taken. Try another.');
        const r = await auth.signUp(u, email, pw);
        if (r.session) return afterLogin();       // email confirmation turned off in Supabase
        show('verify');
      } catch (e) { err(e.message); busy($('aGo'), false, 'Create account'); }
    };
    $('aToLogin').onclick = () => show('login');
  }
  if (step === 'verify' || step === 'reset') {
    const reset = step === 'reset';
    card(`<h1>${reset ? 'Reset your password' : 'Check your email'}</h1><p class="asub">We sent a 6-digit code to <b></b>.</p>
      <label class="af"><span>Code</span><input id="aCode" class="acode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"></label>
      ${reset ? field('aPass', 'New password', 'password', 'autocomplete="new-password"') : ''}
      <button class="cta wide" id="aGo">${reset ? 'Save new password' : 'Verify email'}</button>
      <div class="alinks"><button class="alink" id="aResend">Send a new code</button><button class="alink" id="aBack">Use a different email</button></div>`);
    box.querySelector('.asub b').textContent = email;
    $('aCode').focus();
    $('aCode').oninput = () => { $('aCode').value = $('aCode').value.replace(/\D/g, '').slice(0, 6); if (!reset && $('aCode').value.length === 6) $('aGo').click(); };
    $('aGo').onclick = async () => {
      const code = $('aCode').value; if (code.length !== 6) return err('Enter the 6-digit code.');
      if (reset && $('aPass').value.length < 6) return err('Password must be at least 6 characters.');
      busy($('aGo'), true, 'Checking…');
      try { await auth.verify(email, code, reset ? 'recovery' : 'email'); if (reset) await auth.setPassword($('aPass').value); afterLogin(); }
      catch (e) { err(e.message); busy($('aGo'), false, reset ? 'Save new password' : 'Verify email'); }
    };
    let wait = 0;
    $('aResend').onclick = async () => {
      if (Date.now() < wait) return err(`Wait ${Math.ceil((wait - Date.now()) / 1000)}s before asking again.`);
      wait = Date.now() + 60000;
      try { reset ? await auth.sendReset(email) : await auth.resend(email); err(''); $('aResend').textContent = 'Code sent ✓'; } catch (e) { err(e.message); }
    };
    $('aBack').onclick = () => show(reset ? 'forgot' : 'signup');
  }
  if (step === 'forgot') {
    card(`<h1>Forgot password</h1><p class="asub">Enter your email and we'll send a code.</p>
      ${field('aEmail', 'Email', 'email', 'autocomplete="email" inputmode="email"')}
      <button class="cta wide" id="aGo">Send code</button><div class="alinks"><button class="alink" id="aToLogin">Back to log in</button></div>`);
    $('aEmail').value = email;
    $('aGo').onclick = async () => { email = $('aEmail').value.trim(); if (!email) return err('Enter your email.'); busy($('aGo'), true, 'Sending…'); try { await auth.sendReset(email); show('reset'); } catch (e) { err(e.message); busy($('aGo'), false, 'Send code'); } };
    $('aToLogin').onclick = () => show('login');
  }
  if (note) { const p = document.createElement('p'); p.className = 'anote'; p.textContent = note; box.querySelector('.asub').after(p); }
}

/* ---------- avatar and life ---------- */
function avatarSetup(profile) {
  const a = { ...DEFAULT_AVATAR }; let life = 'citizen';
  box.innerHTML = `<div class="acard wide"><div class="abrand"><b>Vision27</b><small>Make your character</small></div>
    <div class="asetup"><div class="aprev"><canvas id="aPrev" aria-label="Your character"></canvas><small>Hi, ${profile.username.replace(/[<>&]/g, '')}</small></div>
    <div class="aopts">
      <div class="label">Body</div><div class="seg" id="aGender"><button data-g="m">Male</button><button data-g="f">Female</button></div>
      <div class="label">Skin tone</div><div class="swatches" id="aSkin">${SKINS.map((c, i) => `<button class="sw" data-s="${i}" style="background:${hex(c)}" aria-label="Skin ${i + 1}"></button>`).join('')}</div>
      <div class="label">What you wear</div><div class="ogrid" id="aOutfit">${OUTFITS.map(o => `<button data-o="${o.id}"><b>${o.name}</b><small data-m="${o.m}" data-f="${o.f}"></small></button>`).join('')}</div>
      <div class="label">Colour</div><div class="swatches" id="aCol">${COLORS.map((c, i) => `<button class="sw" data-c="${i}" style="background:${hex(c)}" aria-label="Colour ${i + 1}"></button>`).join('')}</div>
      <div class="label">Choose your life</div><div class="ogrid lives" id="aLife">${Object.entries(ROLES).map(([k, r]) => `<button data-l="${k}" ${k === 'politician' ? 'disabled' : ''}><b>${r.name}${k === 'politician' ? ' 🔒' : ''}</b><small>${k === 'politician' ? 'Elected by players’ votes. Run at INEC after you join.' : r.blurb}</small></button>`).join('')}</div>
    </div></div>
    <button class="cta wide" id="aGo">Enter Abuja</button><p class="aerr" id="aErr" hidden></p></div>`;
  // live 3D preview in its own small renderer
  const cv = $('aPrev'), r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); r.setPixelRatio(Math.min(devicePixelRatio, 2));
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, .1, 20); cam.position.set(0, 1.25, 4.4); cam.lookAt(0, .95, 0);
  sc.add(new THREE.HemisphereLight(0xffffff, 0xb08a60, 1.4)); const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(2, 3, 2); sc.add(dl);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(.8, 32).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xe6dcc6 })); sc.add(floor);
  let ch = null, alive = true, last = performance.now(), spin = 0;
  const rebuild = () => { if (ch) sc.remove(ch.root); ch = makeAvatar(a); sc.add(ch.root); paint(); };
  const size = () => { const w = cv.clientWidth, h = cv.clientHeight; if (w && h) { r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); } };
  const loop = () => { if (!alive) return; const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now; spin += dt * .6; if (ch) { ch.root.rotation.y = Math.sin(spin) * .9; ch.update(dt, 0); } size(); r.render(sc, cam); requestAnimationFrame(loop); };
  const paint = () => {
    box.querySelectorAll('#aGender button').forEach(b => b.classList.toggle('on', b.dataset.g === a.g));
    box.querySelectorAll('#aSkin .sw').forEach(b => b.classList.toggle('on', +b.dataset.s === a.s));
    box.querySelectorAll('#aCol .sw').forEach(b => b.classList.toggle('on', +b.dataset.c === a.c));
    box.querySelectorAll('#aOutfit button').forEach(b => { b.classList.toggle('on', b.dataset.o === a.o); const sm = b.querySelector('small'); sm.textContent = a.g === 'f' ? sm.dataset.f : sm.dataset.m; });
    box.querySelectorAll('#aLife button').forEach(b => b.classList.toggle('on', b.dataset.l === life));
  };
  box.querySelector('.aopts').onclick = e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.g) a.g = b.dataset.g; if (b.dataset.s) a.s = +b.dataset.s; if (b.dataset.c) a.c = +b.dataset.c; if (b.dataset.o) a.o = b.dataset.o;
    if (b.dataset.l) { life = b.dataset.l; paint(); return; }
    rebuild();
  };
  rebuild(); loop();
  $('aGo').onclick = async () => {
    busy($('aGo'), true, 'Saving…');
    try {
      const avatar = cleanAvatar(a); await saveProfile({ avatar, life });
      alive = false; r.dispose();
      finish({ ...profile, avatar, life, fresh: true });
    } catch (e) { err(e.message); busy($('aGo'), false, 'Enter Abuja'); }
  };
}
export async function logout() { await auth.logout(); location.reload(); }

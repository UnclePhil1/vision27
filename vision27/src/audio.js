/* Sound: a looping music track, plus short effects made in code
   (horns, crashes, steps, sirens, your car engine, birds, voices). */

const L = {};            // layer gain nodes
export const Sound = {
  ctx: null, master: null, on: true, voice: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.on ? .8 : 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // noise buffers
    const mk = (fn) => { const b = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), d = b.getChannelData(0); fn(d); return b; };
    let last = 0; this.brown = mk(d => { for (let i = 0; i < d.length; i++) { last = (last + .02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } });
    this.white = mk(d => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    const src = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 3); return s; };
    const filt = (type, f, q = .7) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
    const layer = (name, ...chain) => { const g = ctx.createGain(); g.gain.value = 0; let n = chain[0]; for (let i = 1; i < chain.length; i++) { n.connect(chain[i]); n = chain[i]; } n.connect(g).connect(this.master); L[name] = g; return g; };

    // no looping noise beds (they sounded like waves); music plays instead, see playMusic
    // the player's own engine
    this.pe = ctx.createOscillator(); this.pe.type = 'sawtooth'; this.pe.frequency.value = 40;
    this.pe2 = ctx.createOscillator(); this.pe2.type = 'square'; this.pe2.frequency.value = 20;
    const pf = filt('lowpass', 300); this.pf = pf; const pm = ctx.createGain(); pm.gain.value = .5;
    this.pe.connect(pf); this.pe2.connect(pm).connect(pf); layer('engine', pf); this.pe.start(); this.pe2.start();
    // generator hum (houses with a generator switched on)
    const gen = ctx.createOscillator(); gen.type = 'square'; gen.frequency.value = 98; layer('generator', gen, filt('lowpass', 420)); gen.start();
    // siren: two-tone wail
    this.sir = ctx.createOscillator(); this.sir.type = 'triangle'; this.sir.frequency.value = 700;
    const sl = ctx.createOscillator(), slg = ctx.createGain(); sl.frequency.value = .6; slg.gain.value = 260; sl.connect(slg).connect(this.sir.frequency); sl.start();
    layer('siren', this.sir, filt('lowpass', 2200)); this.sir.start();
    this.levels = {};
    const bird = () => { if ((this.levels.birds || 0) > .02) this.chirp(this.levels.birds); setTimeout(bird, 1800 + Math.random() * 5000); }; setTimeout(bird, 1500);
    const cock = () => { if ((this.levels.village || 0) > .2 && Math.random() < .5) this.rooster(); setTimeout(cock, 12000 + Math.random() * 20000); }; setTimeout(cock, 6000);
    if ('speechSynthesis' in window) { const pickV = () => { const vs = speechSynthesis.getVoices(); this.voice = vs.find(v => /en[-_]NG/i.test(v.lang)) || vs.find(v => /en[-_](GB|ZA|KE|IN)/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null; }; pickV(); speechSynthesis.onvoiceschanged = pickV; }
  },
  /* fade every layer toward its target level (0..1 each) */
  mix(lv, dt = .3) {
    if (!this.ctx) return; this.levels = lv; const t = this.ctx.currentTime;
    const set = (n, v, k = .4) => L[n] && L[n].gain.setTargetAtTime(Math.max(0, v), t, k);
    set('traffic', (lv.traffic || 0) * .5); set('crowdA', (lv.crowd || 0) * .14); set('crowdB', (lv.crowd || 0) * .1);
    set('wind', (lv.wind || 0) * .05); set('room', (lv.room || 0) * .06); set('jet', (lv.jet || 0) * .35);
    set('fire', (lv.fire || 0) * .06, .2); set('generator', (lv.generator || 0) * .02); set('siren', (lv.siren || 0) * .05, .2);
    const sp = lv.engine || 0; set('engine', lv.engineOn ? .05 + Math.min(.08, sp * .004) : 0, .15);
    this.pe.frequency.setTargetAtTime(38 + sp * 5.5, t, .12); this.pe2.frequency.setTargetAtTime(19 + sp * 2.7, t, .12); this.pf.frequency.setTargetAtTime(260 + sp * 30, t, .12);
  },
  tone(freq, start, dur, vol, type = 'square', pan = 0, cutoff = 1800) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(), p = ctx.createStereoPanner();
    o.type = type; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = cutoff; p.pan.value = pan;
    g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(vol, start + .01); g.gain.setValueAtTime(vol, start + Math.max(.02, dur - .03)); g.gain.linearRampToValueAtTime(0, start + dur);
    o.connect(f).connect(g).connect(p).connect(this.master); o.start(start); o.stop(start + dur + .02);
  },
  burst(dur, vol, freq, q = 1, pan = 0, type = 'bandpass') {
    const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
    s.buffer = this.white; f.type = type; f.frequency.value = freq; f.Q.value = q; p.pan.value = pan;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0005, t + dur);
    s.connect(f).connect(g).connect(p).connect(this.master); s.start(t, Math.random() * 3, dur + .05);
  },
  horn(vol = .5, pan = 0) { if (!this.ctx) return; const t = this.ctx.currentTime, base = 370 + Math.random() * 140; [0, .2].forEach(d => { this.tone(base, t + d, .15, .07 * vol, 'square', pan); this.tone(base * 1.26, t + d, .15, .05 * vol, 'square', pan); }); },
  whoosh(vol, pan) { if (this.ctx) this.burst(.6, .12 * vol, 700, .6, pan); },
  thud() { if (!this.ctx) return; this.tone(60, this.ctx.currentTime, .18, .25, 'sine', 0, 300); this.burst(.15, .2, 300, 1); },
  crash(vol = 1, pan = 0) { if (!this.ctx) return; this.burst(.9, .45 * vol, 1800, .4, pan); this.tone(70, this.ctx.currentTime, .3, .3 * vol, 'sine', pan, 300); for (let i = 0; i < 6; i++) setTimeout(() => this.ctx && this.burst(.12, .12 * vol, 4000 + Math.random() * 3000, 3, pan), 80 + i * 60); },
  chirp(level = 1) {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime, base = 2300 + Math.random() * 1400, pan = Math.random() * 1.6 - .8, p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(this.master);
    for (let i = 0; i < 2 + (Math.random() * 3 | 0); i++) { const o = ctx.createOscillator(), g = ctx.createGain(), s = t + i * .12; o.frequency.setValueAtTime(base, s); o.frequency.exponentialRampToValueAtTime(base * 1.4, s + .06); g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(.03 * level, s + .01); g.gain.exponentialRampToValueAtTime(.0001, s + .09); o.connect(g).connect(p); o.start(s); o.stop(s + .1); }
  },
  rooster() { if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; [[0, 500], [.15, 700], [.5, 820], [1.1, 600]].forEach(([d, f]) => o.frequency.linearRampToValueAtTime(f, t + d)); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.025, t + .05); g.gain.setValueAtTime(.025, t + 1); g.gain.linearRampToValueAtTime(0, t + 1.2); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; o.connect(f).connect(g).connect(this.master); o.start(t); o.stop(t + 1.3); },
  step(soft = false) { if (!this.ctx) return; this.burst(.07, soft ? .12 : .25, 800 + Math.random() * 400, .8); },
  buy(final) { if (!this.ctx) return; const t = this.ctx.currentTime; (final ? [523, 659, 784, 1047] : [784, 1175]).forEach((f, i) => this.tone(f, t + i * .09, .45, .07, 'triangle')); },
  ding() { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(1320, t, .5, .06, 'sine'); this.tone(990, t + .25, .7, .06, 'sine'); },
  chime() { if (!this.ctx) return; const t = this.ctx.currentTime; [659, 830, 988].forEach((f, i) => this.tone(f, t + i * .35, .9, .05, 'sine')); },
  alarm() { if (!this.ctx) return; const t = this.ctx.currentTime; for (let i = 0; i < 6; i++) this.tone(i % 2 ? 900 : 1150, t + i * .25, .22, .04, 'square'); },
  speak(text, { pitch = 1, rate = 1, vol = .7 } = {}) {
    if (!this.on || !('speechSynthesis' in window)) return;
    try { if (speechSynthesis.speaking) return; const u = new SpeechSynthesisUtterance(text); if (this.voice) u.voice = this.voice; u.pitch = pitch; u.rate = rate; u.volume = vol; speechSynthesis.speak(u); } catch { }
  },
  /* background music: one track on loop, started by the first click (browsers need one) */
  playMusic(url) {
    if (!url) return;
    if (!this.mus) { this.mus = new Audio(url); this.mus.loop = true; this.mus.volume = .45; }
    if (this.on) this.mus.play().catch(() => { });
  },
  toggle() { this.on = !this.on; if (this.mus) { if (this.on) this.mus.play().catch(() => { }); else this.mus.pause(); } if (this.master) this.master.gain.value = this.on ? .8 : 0; if (!this.on && 'speechSynthesis' in window) speechSynthesis.cancel(); return this.on; },
  // kept for older callers
  setChatter() { },
};

import * as THREE from 'three';
import { G } from './game.js';
import { net, peers, setPresence, flushPresence, nameOf, resolveNames } from './net.js';
import { remoteList, placeEl } from './social.js';

/* Proximity voice and video between players (WebRTC, peer to peer).
   - Outdoors you hear players within 30 m, quieter with distance.
   - Inside a building (House of Assembly, club, hotel…) everyone in the room hears everyone.
   - A bubble above each head shows a mic, or a live round video; a green ring shows who is talking.
   - Tap a bubble (or use the voice panel) to mute someone. Mutes are remembered on this device.
   Signals go through the live room (Supabase Realtime); audio and video flow directly between players. */
const $ = id => document.getElementById(id);
const RANGE = 30, MAX_PEERS = 8;
const V = { on: false, cam: false, stream: null, links: new Map(), muted: new Set(), ice: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }], ctx: null, me: null, myLevel: 0, myBub: null, t: 0 };
try { JSON.parse(localStorage.getItem('v27.muted') || '[]').forEach(id => V.muted.add(id)); } catch { }
const saveMuted = () => { try { localStorage.setItem('v27.muted', JSON.stringify([...V.muted])); } catch { } };
export const voiceSupported = () => !!(navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection && net.room?.self);

/* ---------- my mic and camera ---------- */
export async function setVoice(on, cam = V.cam) {
  if (on && !voiceSupported()) return G.toast('Voice chat needs the online version in a modern browser');
  try {
    if (on) {
      const want = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: cam ? { width: 240, height: 240, facingMode: 'user', frameRate: 15 } : false };
      const fresh = await navigator.mediaDevices.getUserMedia(want);
      V.stream?.getTracks().forEach(t => t.stop());
      V.stream = fresh; V.on = true; V.cam = cam;
      V.ctx = V.ctx || new (window.AudioContext || window.webkitAudioContext)(); V.ctx.resume();
      V.myMeter = meter(fresh);
      V.links.forEach(l => replaceTracks(l));
      if (!V.links.size) G.toast(cam ? 'Camera and mic on. Walk up to players to talk.' : 'Mic on. Walk up to players to talk, or go inside a building to join the room.');
    } else {
      V.stream?.getTracks().forEach(t => t.stop()); V.stream = null; V.on = false; V.cam = false;
      [...V.links.keys()].forEach(id => hangup(id, true));
    }
  } catch (e) {
    G.toast(/denied|NotAllowed/i.test(e?.name + e?.message) ? 'Allow the microphone (and camera) in your browser to talk' : 'Could not start your mic or camera');
    V.on = false; V.cam = false;
  }
  setPresence({ vc: V.on ? (V.cam ? 2 : 1) : 0 }); flushPresence(); paintButtons(); paintPanel();
}
function replaceTracks(l) {
  const senders = l.pc.getSenders();
  V.stream.getTracks().forEach(tr => { const s = senders.find(x => x.track?.kind === tr.kind); if (s) s.replaceTrack(tr); else l.pc.addTrack(tr, V.stream); });
  senders.forEach(s => { if (s.track && !V.stream.getTracks().some(t => t.kind === s.track.kind)) s.replaceTrack(null); });
  renegotiate(l);
}

/* ---------- level meter: who is speaking ---------- */
function meter(stream) {
  if (!V.ctx || !stream.getAudioTracks().length) return () => 0;
  const src = V.ctx.createMediaStreamSource(stream), an = V.ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  return () => { an.getByteTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i += 4) { const v = (buf[i] - 128) / 128; s += v * v; } return Math.sqrt(s / (buf.length / 4)); };
}

/* ---------- peer connections ---------- */
const send = (to, msg) => net.room.emit('rtc', { ...msg, to, from: net.room.self, by: net.me.id });
function link(peerId, by) {
  let l = V.links.get(peerId); if (l) return l;
  const pc = new RTCPeerConnection({ iceServers: V.ice });
  l = { id: peerId, by, pc, audio: new Audio(), video: null, gain: null, level: () => 0, making: false, polite: net.room.self > peerId, last: performance.now() };
  l.audio.autoplay = true; l.audio.playsInline = true;
  pc.onicecandidate = e => e.candidate && send(peerId, { t: 'ice', c: e.candidate });
  pc.onnegotiationneeded = () => renegotiate(l);
  pc.ontrack = e => {
    const st = e.streams[0] || new MediaStream([e.track]);
    if (e.track.kind === 'audio') { l.audio.srcObject = st; l.level = meter(st); applyVolume(l); l.audio.play().catch(() => { }); }
    if (e.track.kind === 'video') { l.vstream = st; paintBubble(l); e.track.onmute = () => paintBubble(l); e.track.onunmute = () => paintBubble(l); }
  };
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) hangup(peerId); };
  V.stream?.getTracks().forEach(tr => pc.addTrack(tr, V.stream));
  V.links.set(peerId, l); paintPanel();
  if (by) resolveNames([by]).then(paintPanel);
  return l;
}
async function renegotiate(l) {
  try { l.making = true; await l.pc.setLocalDescription(); send(l.id, { t: 'sdp', d: l.pc.localDescription }); } catch { } finally { l.making = false; }
}
async function onSignal({ data: m }) {
  if (!m || m.to !== net.room.self || !V.on) return;
  if (m.t === 'bye') return hangup(m.from, true);
  if (!V.links.has(m.from) && !wanted().some(o => o.p.peer === m.from)) return m.t === 'sdp' && send(m.from, { t: 'bye' });   // out of range: say no
  const l = link(m.from, m.by); l.last = performance.now();
  try {
    if (m.t === 'sdp') {
      const collision = m.d.type === 'offer' && (l.making || l.pc.signalingState !== 'stable');
      if (collision && !l.polite) return;                         // perfect negotiation: the impolite side wins
      await l.pc.setRemoteDescription(m.d);
      if (m.d.type === 'offer') { await l.pc.setLocalDescription(); send(m.from, { t: 'sdp', d: l.pc.localDescription }); }
    } else if (m.t === 'ice') await l.pc.addIceCandidate(m.c).catch(() => { });
  } catch { }
}
function hangup(peerId, quiet) {
  const l = V.links.get(peerId); if (!l) return;
  if (!quiet) send(peerId, { t: 'bye' });
  l.pc.close(); l.audio.srcObject = null; l.bub?.remove(); V.links.delete(peerId); paintPanel();
}

/* ---------- who should I be connected to? ---------- */
function wanted() {
  const me = G.player.pos, myIn = G.isInside?.() ? G.insideSlot?.() : null;
  return peers().filter(p => p.presence?.vc > 0 && typeof p.presence.x === 'number')
    .map(p => ({ p, d: (p.presence.in ?? null) !== myIn ? Infinity : myIn !== null ? 0 : Math.hypot(p.presence.x - me.x, p.presence.z - me.z) }))
    .filter(o => o.d <= RANGE).sort((a, b) => a.d - b.d).slice(0, MAX_PEERS);
}
function applyVolume(l, d) {
  const muted = V.muted.has(l.by);
  l.audio.muted = muted;
  l.audio.volume = muted ? 0 : d === undefined ? 1 : Math.max(.08, Math.min(1, 1.25 - d / RANGE));
}

/* ---------- bubbles above heads ---------- */
const MIC = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const MIC_OFF = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3 3l18 18" stroke="#c9472f" stroke-width="2.5"/></svg>';
function bubble() { const b = document.createElement('button'); b.className = 'vbub'; b.hidden = true; $('labels').appendChild(b); return b; }
function paintBubble(l) {
  if (!l.bub) { l.bub = bubble(); l.bub.onclick = () => toggleMute(l.by); }
  const hasVideo = l.vstream && l.vstream.getVideoTracks().some(t => t.readyState === 'live' && !t.muted) && !V.muted.has(l.by);
  if (hasVideo) { if (!l.video) { l.video = document.createElement('video'); l.video.autoplay = true; l.video.muted = true; l.video.playsInline = true; } if (l.video.srcObject !== l.vstream) l.video.srcObject = l.vstream; if (l.bub.firstChild !== l.video) { l.bub.innerHTML = ''; l.bub.appendChild(l.video); l.video.play().catch(() => { }); } }
  else l.bub.innerHTML = V.muted.has(l.by) ? MIC_OFF : MIC;
  l.bub.classList.toggle('muted', V.muted.has(l.by)); l.bub.title = `${nameOf(l.by)?.name || 'Player'} · tap to ${V.muted.has(l.by) ? 'unmute' : 'mute'}`;
}
function paintMine() {
  if (!V.on) { if (V.myBub) V.myBub.hidden = true; return; }
  if (!V.myBub) { V.myBub = bubble(); V.myBub.classList.add('me'); V.myBub.onclick = () => setVoice(true, !V.cam); }
  if (V.cam) { if (!V.myVid) { V.myVid = document.createElement('video'); V.myVid.muted = true; V.myVid.autoplay = true; V.myVid.playsInline = true; } if (V.myVid.srcObject !== V.stream) V.myVid.srcObject = V.stream; if (V.myBub.firstChild !== V.myVid) { V.myBub.innerHTML = ''; V.myBub.appendChild(V.myVid); V.myVid.play().catch(() => { }); } }
  else if (!V.myBub.dataset.mic) { V.myBub.innerHTML = MIC; }
  V.myBub.dataset.mic = V.cam ? '' : '1';
  V.myBub.title = 'You · tap to turn your camera ' + (V.cam ? 'off' : 'on');
}

/* ---------- UI: buttons and the voice panel ---------- */
export function toggleMute(by) {
  if (!by) return;
  V.muted.has(by) ? V.muted.delete(by) : V.muted.add(by); saveMuted();
  G.toast(`${nameOf(by)?.name || 'Player'} ${V.muted.has(by) ? 'muted' : 'unmuted'}`);
  V.links.forEach(l => { if (l.by === by) { applyVolume(l); paintBubble(l); } });
  paintPanel();
}
export const isMuted = by => V.muted.has(by);
function paintButtons() {
  $('bMic').classList.toggle('on', V.on); $('bMic').setAttribute('aria-pressed', V.on);
  $('bCam').classList.toggle('on', V.cam); $('bCam').setAttribute('aria-pressed', V.cam);
  $('bCam').hidden = !V.on;
}
function paintPanel() {
  const p = $('vpanel'); if (!p) return;
  const list = [...V.links.values()];
  p.hidden = !V.on; if (V.min === undefined) V.min = innerWidth <= 640; p.classList.toggle('min', V.min);
  if (!V.on) return;
  const room = G.isInside?.() ? (G.insideName?.() || 'this room') : 'nearby';
  p.innerHTML = `<div class="vp-head"><b>Voice · ${room}</b><small>${list.length ? list.length + ' connected' : 'No one in range yet'}</small></div>`
    + list.map(l => `<div class="vp-row" data-by="${l.by || ''}"><span class="vp-dot"></span><span class="vp-name"></span><button class="vp-mute">${V.muted.has(l.by) ? 'Unmute' : 'Mute'}</button></div>`).join('');
  p.querySelector('.vp-head').onclick = () => { p.classList.toggle('min'); V.min = p.classList.contains('min'); };
  [...p.querySelectorAll('.vp-row')].forEach((row, i) => { const l = list[i]; row.querySelector('.vp-name').textContent = nameOf(l.by)?.name || 'Player'; row.querySelector('.vp-mute').onclick = () => toggleMute(l.by); l.row = row; });
}

/* ---------- every frame ---------- */
export function updateVoice(dt) {
  if (!net.room || !voiceSupported()) return;
  const now = performance.now();
  if (V.on && now - V.t > 1000) {
    V.t = now;
    const want = wanted(), ids = new Set(want.map(o => o.p.peer));
    // the side with the smaller id starts the call; the other answers
    want.forEach(o => { if (!V.links.has(o.p.peer) && net.room.self < o.p.peer) { const l = link(o.p.peer, o.p.by); renegotiate(l); } });
    [...V.links.values()].forEach(l => { if (!ids.has(l.id) && performance.now() - l.last > 3000) hangup(l.id); });
    want.forEach(o => { const l = V.links.get(o.p.peer); if (l) { l.dist = o.d; applyVolume(l, o.d); } });
  }
  // speaking rings and positions
  const rem = new Map(remoteList().map(r => [r.peer, r]));
  V.links.forEach(l => {
    if (!l.bub) paintBubble(l);
    const r = rem.get(l.id); if (!r) { l.bub.hidden = true; return; }
    const lvl = V.muted.has(l.by) ? 0 : l.level(), speaking = lvl > .035;
    l.bub.classList.toggle('talk', speaking); l.bub.classList.toggle('video', !!l.video && l.bub.firstChild === l.video);
    placeEl(l.bub, r.g.position, r.car ? 3.0 : 2.5, 60);
    l.row?.classList.toggle('talk', speaking);
    r.tag.classList.toggle('talking', speaking);
  });
  paintMine();
  if (V.on && V.myBub) { const lvl = V.myMeter?.() || 0; V.myBub.classList.toggle('talk', lvl > .035); V.myBub.classList.toggle('video', V.cam); placeEl(V.myBub, G.player.pos, G.player.car ? 3.0 : 2.5, 60); }
}
export async function initVoice() {
  if (!voiceSupported()) { $('bMic').hidden = true; return; }
  $('bMic').hidden = false; G.toggleMute = toggleMute; G.voiceOn = () => V.on; G.isMuted = isMuted;
  net.room.on('rtc', onSignal);
  // optional TURN relay settings, stored by an admin in kv path "ads/rtc"
  try { const s = await net.db?.doc('ads/rtc').get(); const ice = s?.exists && s.data()?.iceServers; if (Array.isArray(ice) && ice.length) V.ice = ice; } catch { }
  $('bMic').onclick = () => setVoice(!V.on, false);
  $('bCam').onclick = () => setVoice(true, !V.cam);
  addEventListener('beforeunload', () => [...V.links.keys()].forEach(id => hangup(id)));
}
export const voiceState = V;

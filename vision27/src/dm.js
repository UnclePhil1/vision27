import { net, isMutual } from './net.js';

/* Private messages between mutuals, encrypted in the browser.
   Each person has an ECDH key pair: the public half sits in keys/<id> for anyone to read,
   the private half sits in that person's own data/users/<id>/keys doc, which nobody else
   (not even the page owner) can read. A message is sealed with AES-GCM using the key both
   sides can derive, and stored in the sender's outbox, dm/<id>. Others only see that a
   message exists, who it is for and when. */

const subtle = globalThis.crypto && crypto.subtle;
const ALG = { name: 'ECDH', namedCurve: 'P-256' };
let myPriv = null, myPubJwk = null, ready = false;
const shared = new Map();      // other id -> AES key
const plain = new Map();       // message key -> text (decrypt once)
export const dmReady = () => ready;

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function initDM() {
  if (!subtle || !net.db || !net.me.id || !net.canWrite) return false;
  try {
    const ref = net.db.doc(`data/users/${net.me.id}/keys`);
    const snap = await ref.get();
    if (snap.exists && snap.data().priv && snap.data().pub) {
      myPriv = await subtle.importKey('jwk', snap.data().priv, ALG, false, ['deriveKey']);
      myPubJwk = snap.data().pub;
    } else {
      const kp = await subtle.generateKey(ALG, true, ['deriveKey']);
      const priv = await subtle.exportKey('jwk', kp.privateKey); myPubJwk = await subtle.exportKey('jwk', kp.publicKey);
      await ref.set({ priv, pub: myPubJwk });
      myPriv = await subtle.importKey('jwk', priv, ALG, false, ['deriveKey']);
    }
    const pubRef = net.db.doc('keys/' + net.me.id), cur = await pubRef.get();
    if (!cur.exists || JSON.stringify(cur.data().pub) !== JSON.stringify(myPubJwk)) await pubRef.set({ pub: myPubJwk });
    ready = true; return true;
  } catch (e) { console.warn('Inbox keys unavailable', e); return false; }
}

async function keyFor(id) {
  const pub = net.keys.get(id); if (!pub || !myPriv) return null;
  const tag = id + JSON.stringify(pub).length + (pub.x || '');
  if (shared.has(tag)) return shared.get(tag);
  const their = await subtle.importKey('jwk', pub, ALG, false, []);
  const k = await subtle.deriveKey({ name: 'ECDH', public: their }, myPriv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  shared.set(tag, k); return k;
}

let writing = Promise.resolve();
export async function sendDM(to, text) {
  if (!ready) throw { code: 'not_ready' };
  if (!isMutual(to)) throw { code: 'not_mutual' };
  const k = await keyFor(to); if (!k) throw { code: 'no_key' };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(text.slice(0, 500)));
  const msg = { to, iv: b64(iv), ct: b64(ct), ts: Date.now() };
  writing = writing.then(async () => {
    const mine = (net.dmDocs.get(net.me.id) || []).slice(-79);
    const next = [...mine, msg]; net.dmDocs.set(net.me.id, next);
    await net.db.doc('dm/' + net.me.id).set({ msgs: next });
  });
  return writing;
}

/* every conversation I am part of, decrypted: Map otherId -> [{ mine, text, ts }] */
export async function threads() {
  const out = new Map(), me = net.me.id; if (!ready) return out;
  for (const [from, msgs] of net.dmDocs) {
    for (const m of msgs) {
      if (!m || typeof m.ct !== 'string') continue;
      const mine = from === me; if (!mine && m.to !== me) continue;
      const other = mine ? m.to : from; if (!other || other === me) continue;
      const pk = from + ':' + m.ts + ':' + m.iv;
      if (!plain.has(pk)) {
        try { const k = await keyFor(other); if (!k) continue; const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(m.iv) }, k, unb64(m.ct)); plain.set(pk, new TextDecoder().decode(pt)); }
        catch { plain.set(pk, null); }
      }
      const text = plain.get(pk);
      if (!out.has(other)) out.set(other, []);
      out.get(other).push({ mine, text: text ?? "Can't read this message", locked: text == null, ts: +m.ts || 0 });
    }
  }
  out.forEach(list => list.sort((a, b) => a.ts - b.ts));
  return out;
}

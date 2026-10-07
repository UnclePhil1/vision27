import * as THREE from 'three';

/* Advert boards: each slot shows one advert, drawn on a canvas.
   Adverts live in the shared db doc "ads/config" as { ads: [{ id, title, line, link, bg, fg, img }] }.
   `img` is an asset id uploaded from the editor; it is served at /_blob/<id>. */

export const PLACEHOLDER = { id: 'empty', title: 'YOUR AD HERE', line: 'Advertise on Vision27', bg: '#f2c230', fg: '#1d3b2a' };
const SIZE = { wide: [1024, 256], half: [512, 256], poster: [512, 768], banner: [256, 614] };
const FONT = '"Fredoka", "Segoe UI", system-ui, sans-serif';

const imgs = new Map();
function loadImg(id) {
  if (!imgs.has(id)) imgs.set(id, new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = '/_blob/' + id; }));
  return imgs.get(id);
}
export const imgUrl = id => '/_blob/' + id;
export const safeLink = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch { return null; } };

function wrap(g, text, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function cover(g, im, x, y, w, h) {
  const r = Math.max(w / im.width, h / im.height), iw = im.width * r, ih = im.height * r;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); g.restore();
}
function draw(cv, ad, kind, im) {
  const [W, H] = SIZE[kind], g = cv.getContext('2d'); cv.width = W; cv.height = H;
  const bg = ad.bg || '#1d8a4a', fg = ad.fg || '#ffffff';
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const tall = kind === 'poster' || kind === 'banner';
  // a quiet diagonal band so text-only adverts still have shape
  if (!im) { g.globalAlpha = .12; g.fillStyle = fg; g.beginPath(); g.moveTo(W * .62, 0); g.lineTo(W, 0); g.lineTo(W, H); g.lineTo(W * .38, H); g.fill(); g.globalAlpha = 1; }
  let textTop = 0, textH = H;
  if (im) {
    if (tall) { const ih = kind === 'banner' ? H * .5 : H * .62; cover(g, im, 0, 0, W, ih); textTop = ih; textH = H - ih; }
    else { cover(g, im, 0, 0, W, H); const gr = g.createLinearGradient(0, 0, W * .7, 0); gr.addColorStop(0, bg); gr.addColorStop(.55, bg + 'cc'); gr.addColorStop(1, bg + '00'); g.fillStyle = gr; g.fillRect(0, 0, W * .75, H); }
  }
  g.fillStyle = fg; g.textBaseline = 'top';
  const pad = W * (tall ? .08 : .045), maxW = tall ? W - pad * 2 : (im ? W * .5 : W * .7);
  let size = tall ? (kind === 'banner' ? 44 : 64) : (kind === 'half' ? 52 : 86);
  g.font = `700 ${size}px ${FONT}`; let lines = wrap(g, ad.title, maxW);
  while (lines.length > (tall ? 4 : 2) && size > 24) { size -= 6; g.font = `700 ${size}px ${FONT}`; lines = wrap(g, ad.title, maxW); }
  const sub = Math.round(size * .42);
  g.font = `500 ${sub}px ${FONT}`; const subLines = wrap(g, ad.line, maxW).slice(0, 2);
  const block = lines.length * size * 1.05 + (subLines.length ? 12 + subLines.length * sub * 1.2 : 0);
  let y = textTop + (textH - block) / 2;
  g.font = `700 ${size}px ${FONT}`; lines.forEach(l => { g.fillText(l, pad, y); y += size * 1.05; });
  y += 12; g.font = `500 ${sub}px ${FONT}`; g.globalAlpha = .9; subLines.forEach(l => { g.fillText(l, pad, y); y += sub * 1.2; }); g.globalAlpha = 1;
  // small "AD" tag
  const tag = Math.max(18, H * .07); g.font = `600 ${tag}px ${FONT}`; const tw = g.measureText('AD').width + tag;
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(W - tw - 10, 10, tw, tag * 1.5); g.fillStyle = '#fff'; g.fillText('AD', W - tw - 10 + tag / 2, 10 + tag * .25);
}

const mats = new Map();
export function adMaterial(ad, kind) {
  const key = (ad.id || 'x') + '|' + (ad.v || 0) + '|' + kind + '|' + ad.title + ad.line + ad.bg + ad.fg + (ad.img || '');
  if (mats.has(key)) return mats.get(key);
  const cv = document.createElement('canvas'); draw(cv, ad, kind, null);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .25 });
  if (ad.img) loadImg(ad.img).then(im => { if (im) { draw(cv, ad, kind, im); tex.needsUpdate = true; } });
  mats.set(key, m); return m;
}

/* ---------- editor (owner and editors) ---------- */
export function openAdEditor({ panel, list, ads, assets, save }) {
  let items = ads.map(a => ({ ...a }));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function render() {
    list.innerHTML = items.map((a, i) => `
      <div class="ad-row" data-i="${i}">
        <div class="ad-prev" style="background:${esc(a.bg)};color:${esc(a.fg)}">${a.img ? `<img alt="" src="${imgUrl(a.img)}">` : ''}<b></b></div>
        <label>Title<input maxlength="40" data-k="title" value="${esc(a.title)}"></label>
        <label>Line<input maxlength="70" data-k="line" value="${esc(a.line)}"></label>
        <label>Link (https)<input maxlength="200" data-k="link" placeholder="https://" value="${esc(a.link)}"></label>
        <div class="ad-cols">
          <label>Back<input type="color" data-k="bg" value="${esc(a.bg || '#1d8a4a')}"></label>
          <label>Text<input type="color" data-k="fg" value="${esc(a.fg || '#ffffff')}"></label>
          ${assets ? `<label class="ad-file">Image<input type="file" accept="image/png,image/jpeg,image/webp" data-up="${i}"></label>` : ''}
          ${a.img ? `<button class="mini" data-noimg="${i}">Remove image</button>` : ''}
          <button class="mini danger" data-del="${i}">Delete</button>
        </div>
      </div>`).join('') || '<p class="empty">No adverts yet. Add the first one.</p>';
    list.querySelectorAll('.ad-row').forEach(row => { row.querySelector('.ad-prev b').textContent = items[row.dataset.i].title || 'Untitled'; });
  }
  list.oninput = e => { const row = e.target.closest('.ad-row'), k = e.target.dataset.k; if (row && k) { items[row.dataset.i][k] = e.target.value; if (k !== 'link') { const p = row.querySelector('.ad-prev'); p.style.background = items[row.dataset.i].bg; p.style.color = items[row.dataset.i].fg; p.querySelector('b').textContent = items[row.dataset.i].title || 'Untitled'; } } };
  list.onclick = e => {
    const d = e.target.dataset;
    if (d.del) { items.splice(+d.del, 1); render(); }
    if (d.noimg) { delete items[+d.noimg].img; render(); }
  };
  list.onchange = async e => {
    const i = e.target.dataset.up; if (i === undefined || !e.target.files[0]) return;
    const st = panel.querySelector('#adStatus'); st.textContent = 'Uploading image…';
    try { const r = await assets.upload(e.target.files[0]); items[+i].img = r.id; st.textContent = 'Image added. Press Save to show it.'; render(); }
    catch (err) { st.textContent = 'Upload failed: ' + (err?.message || err?.code || 'try a smaller image'); }
  };
  panel.querySelector('#adAdd').onclick = () => { if (items.length >= 10) return; items.push({ id: 'ad' + Date.now().toString(36), title: 'New advert', line: 'Your message here', link: '', bg: '#1d8a4a', fg: '#ffffff' }); render(); };
  panel.querySelector('#adSave').onclick = async () => {
    const st = panel.querySelector('#adStatus'); st.textContent = 'Saving…';
    const clean = items.map(a => ({ id: a.id, title: (a.title || '').slice(0, 40), line: (a.line || '').slice(0, 70), link: safeLink(a.link) || '', bg: a.bg, fg: a.fg, ...(a.img ? { img: a.img } : {}), v: Date.now() }));
    try { await save(clean); st.textContent = 'Saved. Boards update for everyone.'; } catch (err) { st.textContent = 'Could not save: ' + (err?.code || 'try again'); }
  };
  render(); panel.hidden = false;
}

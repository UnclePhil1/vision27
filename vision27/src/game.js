/* Shared game context, filled in by main.js, so feature modules can reach
   the scene, the player and helpers without importing main.js. */
export const G = {
  scene: null, camera: null, player: null, traffic: null, city: null, npcs: null,
  toast: () => { }, say: () => { }, teleport: () => { }, gY: () => 0,
  collideStatic: () => false, addBox: () => { }, addCircle: () => { },
  extraBoxes: [],          // movable colliders (furniture) checked every frame
  region: 'city',
  shake: 0,                // camera shake amount
  ride: null,              // { kind, ... } while the player rides a bus or plane
  cine: null,              // camera override { pos, look } during cutscenes
  started: false,
  actionProviders: [], extraSeats: [], regionDoors: [],
  lastDt: .016, frozen: false, inTravel: false, mixHint: null,
};
const $ = id => document.getElementById(id);

/* a modal with a title, text and buttons; returns a promise of the chosen value */
export function dialog(title, text, choices, opts = {}) {
  return new Promise(res => {
    const box = $('dlg'); $('dlgTitle').textContent = title; $('dlgText').textContent = text || '';
    $('dlgWho').textContent = opts.who || ''; $('dlgWho').hidden = !opts.who;
    const row = $('dlgBtns'); row.innerHTML = '';
    choices.forEach((c, i) => {
      const b = document.createElement('button'); b.className = 'cta' + (i && !c.primary ? ' ghost' : ''); b.textContent = c.label; b.disabled = !!c.disabled;
      b.onclick = () => { box.hidden = true; res(c.value ?? c.label); };
      row.appendChild(b);
    });
    box.hidden = false; row.firstElementChild?.focus();
  });
}
/* fade to black, run something, fade back */
export function fade(fn, hold = 700) {
  const f = $('fade'); f.hidden = false; requestAnimationFrame(() => f.classList.add('on'));
  return new Promise(res => setTimeout(async () => { await fn?.(); setTimeout(() => { f.classList.remove('on'); setTimeout(() => { f.hidden = true; res(); }, 650); }, hold); }, 650));
}
export const naira = n => '₦' + Math.round(n).toLocaleString('en-NG');
/* a small form in a popup: fields [{ id, label, type: 'select'|'number'|'text', options: [[value, text]], value }].
   `note(values)` returns a live summary line. Resolves to the values, or null if cancelled. */
export function formDialog(title, text, fields, ok = 'OK', note) {
  return new Promise(res => {
    const box = document.createElement('div'); box.className = 'cropper';
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    box.innerHTML = `<div class="crop-card fdlg"><b>${esc(title)}</b>${text ? `<small>${esc(text)}</small>` : ''}<div class="wform">${fields.map(f => `<label>${esc(f.label)}${f.type === 'select' ? `<select data-f="${f.id}">${f.options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : `<input data-f="${f.id}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}>`}</label>`).join('')}</div>
      <small class="fnote"></small><div class="row"><button class="cta ghost" data-x="no">Cancel</button><button class="cta" data-x="ok">${esc(ok)}</button></div></div>`;
    document.body.appendChild(box);
    const vals = () => Object.fromEntries([...box.querySelectorAll('[data-f]')].map(e => [e.dataset.f, e.type === 'number' ? +e.value : e.value]));
    const paint = () => { if (note) box.querySelector('.fnote').textContent = note(vals()); };
    box.oninput = paint; paint();
    box.onclick = e => { const x = e.target.dataset.x; if (!x) return; const v = vals(); box.remove(); res(x === 'ok' ? v : null); };
  });
}

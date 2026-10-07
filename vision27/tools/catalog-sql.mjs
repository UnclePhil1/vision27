// Prints the SQL seed for Building Explorer pieces and government land (pasted into supabase/schema.sql).
import { PIECES } from '../src/catalog.js';
import { GOV_SITES } from '../src/sites.js';
const q = s => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`), arr = a => (a ? `array[${a.map(q).join(',')}]` : 'null');
console.log('insert into public.pieces (id, name, cat, layer, w, d, price, trade, mats, rooms, room, on_, power, whole, outside) values');
console.log(PIECES.map(p => `  (${q(p.id)}, ${q(p.name)}, ${q(p.cat)}, ${q(p.layer)}, ${p.w}, ${p.d}, ${p.price}, ${q(p.trade)}, '${JSON.stringify(p.mats)}', ${arr(p.rooms)}, ${q(p.room)}, ${q(p.on)}, ${!!p.power}, ${!!p.whole}, ${!!p.outside})`).join(',\n'));
console.log('on conflict (id) do update set name = excluded.name, cat = excluded.cat, layer = excluded.layer, w = excluded.w, d = excluded.d, price = excluded.price, trade = excluded.trade, mats = excluded.mats, rooms = excluded.rooms, room = excluded.room, on_ = excluded.on_, power = excluded.power, whole = excluded.whole, outside = excluded.outside;');
console.log('insert into public.gov_sites (id, official, level, cats, x, z, w, d) values');
console.log(GOV_SITES.map(g => `  (${q(g.id)}, ${q(g.name)}, ${q(g.level)}, ${arr(g.cats)}, ${g.x}, ${g.z}, ${g.w}, ${g.d})`).join(',\n'));
console.log('on conflict (id) do update set official = excluded.official, level = excluded.level, cats = excluded.cats, x = excluded.x, z = excluded.z, w = excluded.w, d = excluded.d;');

// Prints the SQL seed for the plots table from src/plots.js (paste into supabase/schema.sql).
import { PLOTS } from '../src/plots.js';
console.log(PLOTS.map(p => `  (${p.id}, '${p.code}', '${p.zone}', '${p.kind}', ${p.x}, ${p.z}, ${p.w}, ${p.d}, ${p.face}, ${p.price})`).join(',\n'));

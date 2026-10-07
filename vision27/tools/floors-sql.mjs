// Prints the SQL seed for work-floor stations from src/floordata.js (pasted into supabase/schema.sql).
import { FLOORS, CITY } from '../src/floordata.js';
const v = (site, s) => `  ('${site}', '${s.code}', '${s.kind}', ${s.x}, ${s.z}, ${!!s.power}, ${s.item ? `'${s.item.replace(/'/g, "''")}'` : 'null'})`;
console.log([...Object.entries(FLOORS).flatMap(([site, f]) => f.stations.map(s => v(site, s))), ...CITY.map(s => v('city', s))].join(',\n'));

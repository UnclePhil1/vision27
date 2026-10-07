// Tiny local web server for the built game: node server.mjs → http://localhost:5174
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), 'dist', 'web'), port = 5174;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.png': 'image/png', '.json': 'application/json' };
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([\\/]\.\.)+/, '');
  try {
    const body = await readFile(join(root, path === '/' || path === '\\' ? 'index.html' : path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'text/html; charset=utf-8', 'Permissions-Policy': 'camera=(self), microphone=(self)' }); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, () => console.log(`Vision27 running at http://localhost:${port}`));

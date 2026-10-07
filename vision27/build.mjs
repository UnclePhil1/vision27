// Builds Vision27 into dist/web (open with: npm start).
// Also writes index.html at the project root: the no-login preview used on claude.ai.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';

const common = { entryPoints: ['src/main.js'], bundle: true, format: 'esm', write: false, logLevel: 'warning', minifySyntax: true };
const [preview, web] = await Promise.all([
  build({ ...common, define: { __WEB__: 'false' } }),
  build({ ...common, define: { __WEB__: 'true' }, minify: true }),
]);
const template = readFileSync('template.html', 'utf8'), head = readFileSync('web/head.html', 'utf8');
const page = out => template.replace('/*BUNDLE*/', () => out.outputFiles[0].text);
mkdirSync('dist/web', { recursive: true });
writeFileSync('index.html', page(preview));
writeFileSync('dist/web/index.html', head + page(web) + '</body></html>');
copyFileSync('assets/music.mp3', 'dist/web/music.mp3');
copyFileSync('web/_headers', 'dist/web/_headers');
console.log('Built dist/web/index.html and index.html');

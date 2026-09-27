// Monta a versão do link do claude.ai. Uso: npm run build:artifact
// Saída em dist-artifact/:
//   perfumes.html   conteúdo publicado (o claude.ai põe o <!doctype>, <head> e <body> em volta)
//   bottles/*.webp  os frascos da planilha, publicados ao lado da página
//   preview.html    o mesmo conteúdo num esqueleto parecido com o do claude.ai, para abrir no navegador
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const OUT = 'dist-artifact';
rmSync(OUT, { recursive: true, force: true });
await build({ mode: 'artifact', logLevel: 'warn' });

const BUILD = path.join(OUT, 'build');
const index = readFileSync(path.join(BUILD, 'index.html'), 'utf8');
const cssFile = /href="\.\/(assets\/[^"]+\.css)"/.exec(index)?.[1];
const jsFile = /src="\.\/(assets\/[^"]+\.js)"/.exec(index)?.[1];
if (!cssFile || !jsFile) throw new Error('Não achei o CSS/JS do build em index.html.');
const leftovers = readdirSync(path.join(BUILD, 'assets')).filter((f) => !/\.(js|css)$/.test(f));
const css = readFileSync(path.join(BUILD, cssFile), 'utf8').replace(/url\(\.\/[^)]*vietnamese[^)]*\)/g, 'url(data:,)');
// Dentro de <script>, "</script" fecharia a tag antes da hora e "<!--" muda o modo do parser.
const js = readFileSync(path.join(BUILD, jsFile), 'utf8').replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

const content = [
  '<title>Meus Perfumes</title>',
  '<meta name="description" content="Minha coleção de perfumes: wishlist e coleção num seletor de frascos em 3D.">',
  '<meta name="theme-color" content="#050507">',
  `<style>${css}</style>`,
  '<div id="root"></div>',
  `<script type="module">${js}</script>`,
  '',
].join('\n');
if (Buffer.byteLength(content) > 16 * 1024 * 1024) throw new Error('Passou de 16 MB.');
writeFileSync(path.join(OUT, 'perfumes.html'), content);

mkdirSync(path.join(OUT, 'bottles'), { recursive: true });
cpSync('public/bottles', path.join(OUT, 'bottles'), { recursive: true });

writeFileSync(
  path.join(OUT, 'preview.html'),
  `<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui,sans-serif;background:#faf9f7}img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n${content}</body>\n</html>\n`,
);
rmSync(BUILD, { recursive: true, force: true });

const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`dist-artifact/perfumes.html (${kb(Buffer.byteLength(content))}; JS ${kb(Buffer.byteLength(js))}, CSS+fonte ${kb(Buffer.byteLength(css))})`);
if (leftovers.some((f) => !/vietnamese/.test(f))) console.warn('Arquivos não embutidos:', leftovers.join(', '));

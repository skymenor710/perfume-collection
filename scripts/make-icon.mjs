// Ícones do app a partir do mesmo desenho do favicon (frasco prata no preto):
//   assets/meus-perfumes.ico            atalho do Windows
//   public/icons/icon-192.png, -512     instalação (PWA)
//   public/icons/maskable-512.png       Android recorta em círculo/squircle: desenho dentro da "zona segura" (80%)
//   public/icons/apple-touch-icon.png   tela inicial do iPhone (180, sem transparência)
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const bottle = (size, { rounded = true, safe = 1 } = {}) => {
  const pad = (1 - safe) * 16;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect width="32" height="32" ${rounded ? 'rx="7"' : ''} fill="#050507"/>
  <g transform="translate(${pad} ${pad}) scale(${safe})">
    <rect x="12.5" y="5" width="7" height="5" rx="0.6" fill="#c9ccd2"/>
    <rect x="9" y="11.5" width="14" height="16" rx="1.4" fill="none" stroke="#c9ccd2" stroke-width="1.5"/>
    <path d="M11.5 15.5h9" stroke="#c9ccd2" stroke-width="0.8" opacity="0.5"/>
  </g>
</svg>`);
};

mkdirSync('public/icons', { recursive: true });
mkdirSync('assets', { recursive: true });
await sharp(bottle(192)).png().toFile('public/icons/icon-192.png');
await sharp(bottle(512)).png().toFile('public/icons/icon-512.png');
await sharp(bottle(512, { rounded: false, safe: 0.8 })).png().toFile('public/icons/maskable-512.png');
await sharp(bottle(180, { rounded: false })).flatten({ background: '#050507' }).png().toFile('public/icons/apple-touch-icon.png');

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(sizes.map((s) => sharp(bottle(s)).png().toBuffer()));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s === 256 ? 0 : s, 0);
  e.writeUInt8(s === 256 ? 0 : s, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
writeFileSync('assets/meus-perfumes.ico', Buffer.concat([header, ...entries, ...pngs]));
console.log('ícones gerados');

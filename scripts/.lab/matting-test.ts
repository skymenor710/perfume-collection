import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { removeBackground } from '../../src/core/cutout';
import { predictMask } from '../../server/media/matting';
const cases: [string, string][] = [
  ['dior-upload', 'file:C:/Users/guilh/AppData/Local/Temp/claude/C--Users-guilh-Desktop/bcecaa4f-69e4-4227-ae76-578cefb7fd1a/scratchpad/artifact-files/eb44b91f-5d6d-42e7-b16a-88fb382d556b/b5c9c8838d3e5adabc9b42a1a426a281.webp'],
  ['reflection', 'https://royaloudleicester.com/cdn/shop/files/reflection-edp-50ml100ml-mykonos-7673649.webp?v=1783431684'],
  ['collector', 'https://cdn.shopify.com/s/files/1/0655/0473/9421/files/SupremacyCollectionsEditionFront_Gray.png?v=1729755757'],
  ['ateeq', 'https://media.parfumo.com/perfumes/ca/cae1c3_ateeq-nusuk_1200.jpg'],
  ['9pm-lifestyle', 'https://cdn.shopify.com/s/files/1/0655/0473/9421/files/1_2_f6a0599f-2b6b-4c1a-b6d7-f84372906625.png?v=1768480402'],
  ['elite-dramatic', 'https://arabicparfums.com/cdn/shop/files/club-de-nuit-lite-armaf-dramatic.png?v=1789566540'],
];
const tiles: sharp.OverlayOptions[] = [];
const T = 300;
for (const [i, [name, src]] of cases.entries()) {
  const buf = src.startsWith('file:') ? readFileSync(src.slice(5)) : Buffer.from(await (await fetch(src)).arrayBuffer());
  const { data, info } = await sharp(buf).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const flood = new Uint8ClampedArray(data); const c = removeBackground(flood, info.width, info.height);
  const t0 = Date.now(); const mask = await predictMask(new Uint8Array(data), info.width, info.height); const ms = Date.now() - t0;
  const ml = new Uint8ClampedArray(data); for (let p = 0; p < info.width * info.height; p++) ml[p * 4 + 3] = Math.min(ml[p * 4 + 3], mask![p]);
  const tile = async (px: Uint8ClampedArray) => sharp(Buffer.from(px.buffer), { raw: { width: info.width, height: info.height, channels: 4 } }).resize(T - 10, T - 10, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  tiles.push({ input: await tile(new Uint8ClampedArray(data)), left: 5, top: i * T + 5 }, { input: await tile(flood), left: T + 5, top: i * T + 5 }, { input: await tile(ml), left: 2 * T + 5, top: i * T + 5 });
  console.log(name, 'flood removed', c.removed, 'ml ms', ms);
}
await sharp({ create: { width: 3 * T, height: cases.length * T, channels: 3, background: '#101014' } }).composite(tiles).png().toFile('scripts/.lab/matting.png');

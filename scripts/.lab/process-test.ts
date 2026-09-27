import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { processBottleImage } from '../../server/media/process';
const cases: [string, string][] = [
 [
  "zefiro",
  "https://media.parfumo.com/perfumes/ea/eaacb7-zefiro-xerjoff_1200.jpg"
 ],
 [
  "ghost",
  "https://cdn.shopify.com/s/files/1/0712/6220/8100/files/3_f2309c4e-9d87-440e-a328-c0dcd9c889fb.jpg?v=1751983880"
 ],
 [
  "empire",
  "https://cdn.shopify.com/s/files/1/0637/6325/1275/files/empire_50ml_sku_1.jpg?v=1778043194"
 ],
 [
  "shiyaaka",
  "https://cdn.shopify.com/s/files/1/1001/1918/3747/files/Khadlaj_Shiyaaka_Snow.webp?v=1783084833"
 ],
 [
  "cedrus",
  "https://cdn.shopify.com/s/files/1/0589/3849/0927/files/01_927c929b-7019-47cc-9c08-10d6ef05ec94.png?v=1785131491"
 ],
 [
  "refl50",
  "https://cdn.shopify.com/s/files/1/0792/8974/5753/files/reflection-edp-50ml100ml-mykonos-7128882.webp?v=1783431684"
 ],
 [
  "collector",
  "https://cdn.shopify.com/s/files/1/0655/0473/9421/files/SupremacyCollectionsEditionFront_Gray.png?v=1729755757"
 ]
];
const tiles: sharp.OverlayOptions[] = [];
for (const [i, [name, src]] of cases.entries()) {
  const buf = src.startsWith('file:') ? readFileSync(src.slice(5)) : Buffer.from(await (await fetch(src)).arrayBuffer());
  const p = await processBottleImage(buf);
  console.log(name.padEnd(15), p.method.padEnd(7), p.quality.score, p.quality.accepted ? 'OK ' : 'NÃO', p.quality.reasons.join('; '));
  tiles.push({ input: await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ff00ff' } }).composite([{ input: await sharp(p.large).resize(300, 300).toBuffer() }]).png().toBuffer(), left: i * 310 + 5, top: 5 });
}
await sharp({ create: { width: cases.length * 310 + 10, height: 310, channels: 3, background: '#101014' } }).composite(tiles).png().toFile('scripts/.lab/process.png');

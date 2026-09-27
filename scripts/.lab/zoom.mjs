import sharp from 'sharp';
const files = process.argv.slice(2);
const bg = await sharp({ create: { width: 700, height: 700, channels: 3, background: '#ff00ff' } }).png().toBuffer();
const tiles = await Promise.all(files.map(async (f) => sharp(bg).composite([{ input: await sharp('public/' + f).resize(700, 700).toBuffer() }]).png().toBuffer()));
await sharp({ create: { width: 700 * tiles.length, height: 700, channels: 3, background: '#000' } }).composite(tiles.map((t, i) => ({ input: t, left: i * 700, top: 0 }))).png().toFile(process.env.TEMP + '/zoom.png');

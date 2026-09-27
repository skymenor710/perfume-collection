import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
const s = await ort.InferenceSession.create('data/models/birefnet-lite.onnx');
const buf = Buffer.from(await (await fetch('https://royaloudleicester.com/cdn/shop/files/reflection-edp-50ml100ml-mykonos-7673649.webp?v=1783431684')).arrayBuffer());
const rgb = await sharp(buf).flatten({ background: '#fff' }).resize(1024, 1024, { fit: 'fill' }).removeAlpha().raw().toBuffer();
const P = 1024 * 1024, M = [0.485, 0.456, 0.406], S = [0.229, 0.224, 0.225];
const x = new Float32Array(3 * P);
for (let i = 0; i < P; i++) for (let c = 0; c < 3; c++) x[c * P + i] = (rgb[i * 3 + c] / 255 - M[c]) / S[c];
const out = await s.run({ input_image: new ort.Tensor('float32', x, [1, 3, 1024, 1024]) });
const o = out.output_image; const d = o.data as Float32Array;
let mn = Infinity, mx = -Infinity; for (const v of d) { if (v < mn) mn = v; if (v > mx) mx = v; }
console.log('dims', o.dims, 'min', mn, 'max', mx, 'corner', d[0], 'center', d[512 * 1024 + 512]);

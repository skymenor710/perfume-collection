// Mede o tempo de resposta de /api/status enquanto uma importação roda no servidor.
const BASE = 'http://127.0.0.1:3100';
let running = true;
const samples = [];
const probe = (async () => {
  while (running) {
    const t = performance.now();
    try {
      await fetch(`${BASE}/api/status`, { signal: AbortSignal.timeout(15000) });
      samples.push(performance.now() - t);
    } catch {
      samples.push(15000);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
})();
const t0 = performance.now();
const res = await fetch(`${BASE}/api/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: process.argv[2] }) });
const text = await res.text();
running = false;
await probe;
const over = samples.filter((s) => s > 2500).length;
console.log(`importação ${Math.round((performance.now() - t0) / 1000)}s · ${samples.length} sondas · pior ${Math.round(Math.max(...samples))} ms · acima de 2,5 s: ${over}`);
console.log(text.trim().split('\n').at(-1).slice(0, 200));

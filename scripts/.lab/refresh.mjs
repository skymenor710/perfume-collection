// "Pesquisar de novo" pela API do app (o mesmo caminho do botão), para os perfumes dados.
for (const id of process.argv.slice(2)) {
  const t = Date.now();
  const res = await fetch(`http://127.0.0.1:3100/api/perfumes/${id}/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  const last = lines.at(-1);
  const stages = lines.filter((l) => l.stage).map((l) => l.stage).join('→');
  if (last.choose) console.log(id, 'ESCOLHER VERSÃO', last.choose.variants.map((v) => v.volume).join('/'));
  else console.log(id, `${Math.round((Date.now() - t) / 1000)}s`, last.perfume.volume, last.perfume.price, last.perfume.currency, last.perfume.imageUrl, '|', last.perfume.imageSource?.label, last.perfume.imageSource?.score, '|', stages);
}

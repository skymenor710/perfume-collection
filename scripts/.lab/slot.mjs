// Três importações seguidas na MESMA conexão (keep-alive): a vaga precisa voltar ao fim de cada uma.
import http from 'node:http';
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
const post = (url) =>
  new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: Number(process.argv[2]), path: '/api/perfumes/resolve', method: 'POST', agent, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve(`${res.statusCode} ${body.trim().split('\n').at(-1).slice(0, 70)}`));
    });
    req.end(JSON.stringify({ url }));
  });
for (let i = 0; i < 3; i++) console.log(i + 1, await post('isso não é link mas é rápido'));

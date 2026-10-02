import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Servidor S3 falso em 127.0.0.1, para testar o R2StorageProvider DE VERDADE (HTTP, assinatura, checksum, listagem
 * paginada, erros) sem internet. Imita o R2 no que importa: recusa corpo com SHA-256 diferente (BadDigest /
 * XAmzContentSHA256Mismatch), 404 NoSuchKey, DELETE sempre 204, ListObjectsV2 com continuação.
 *
 * Falhas sob encomenda: `next.push({ status, body, delayMs, truncate, redirect })` vale para o próximo pedido.
 * Não confere a assinatura criptograficamente (isso só o R2 real prova, na FASE 3.1); confere que ela existe e
 * tem o formato SigV4 do R2 (região auto, serviço s3).
 */

export interface FakeS3Request {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
}

export interface FakeS3Fault {
  status?: number;
  body?: string;
  contentType?: string;
  delayMs?: number;
  /** Anuncia o tamanho inteiro e corta a conexão no meio (corpo incompleto). */
  truncate?: boolean;
  redirect?: string;
}

export interface FakeS3 {
  endpoint: string;
  bucket: string;
  objects: Map<string, { body: Buffer; contentType: string; modified: Date }>;
  requests: FakeS3Request[];
  next: FakeS3Fault[];
  close(): Promise<void>;
}

/** Corpo de erro no formato S3 (os testes usam para simular NoSuchBucket, AccessDenied, SignatureDoesNotMatch…). */
export const xmlError = (code: string) => `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function startFakeS3(bucket = 'perfumes-teste'): Promise<FakeS3> {
  const state: FakeS3 = { endpoint: '', bucket, objects: new Map(), requests: [], next: [], close: async () => {} };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const body = Buffer.concat(chunks);
      state.requests.push({ method: req.method ?? '', path: url.pathname, query: url.searchParams, headers: req.headers });
      const fault = state.next.shift();
      const respond = () => {
        if (fault?.redirect) {
          res.writeHead(fault.status ?? 302, { Location: fault.redirect });
          return res.end();
        }
        if (fault?.truncate) {
          res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': '1000' });
          res.write(Buffer.alloc(100));
          return res.destroy();
        }
        if (fault?.status || fault?.body) {
          res.writeHead(fault.status ?? 200, { 'Content-Type': fault.contentType ?? 'application/xml' });
          return res.end(fault.body ?? xmlError('InternalError'));
        }
        // Toda chamada precisa vir assinada no formato SigV4 do R2.
        const auth = String(req.headers.authorization ?? '');
        if (!/^AWS4-HMAC-SHA256 Credential=[^/]+\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[^,]+, Signature=[0-9a-f]{64}$/.test(auth)) {
          res.writeHead(403, { 'Content-Type': 'application/xml' });
          return res.end(xmlError('AccessDenied'));
        }
        const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        if (parts[0] !== bucket) {
          res.writeHead(404, { 'Content-Type': 'application/xml' });
          return res.end(xmlError('NoSuchBucket'));
        }
        const key = parts.slice(1).join('/');
        if (req.method === 'GET' && !key && url.searchParams.get('list-type') === '2') {
          const prefix = url.searchParams.get('prefix') ?? '';
          const all = [...state.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
          const start = Number(url.searchParams.get('continuation-token') ?? '0');
          const max = Number(url.searchParams.get('max-keys') ?? '1000');
          const page = all.slice(start, start + max);
          const truncated = start + max < all.length;
          const contents = page.map((k) => `<Contents><Key>${esc(k)}</Key><Size>${state.objects.get(k)!.body.length}</Size><LastModified>${state.objects.get(k)!.modified.toISOString()}</LastModified></Contents>`).join('');
          res.writeHead(200, { 'Content-Type': 'application/xml' });
          return res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><KeyCount>${page.length}</KeyCount><IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${start + max}</NextContinuationToken>` : ''}${contents}</ListBucketResult>`);
        }
        const hit = state.objects.get(key);
        if (req.method === 'PUT') {
          const hex = createHash('sha256').update(body).digest('hex');
          if (req.headers['x-amz-content-sha256'] !== hex) {
            res.writeHead(400, { 'Content-Type': 'application/xml' });
            return res.end(xmlError('XAmzContentSHA256Mismatch'));
          }
          const checksum = req.headers['x-amz-checksum-sha256'];
          if (checksum && checksum !== Buffer.from(hex, 'hex').toString('base64')) {
            res.writeHead(400, { 'Content-Type': 'application/xml' });
            return res.end(xmlError('BadDigest'));
          }
          state.objects.set(key, { body, contentType: String(req.headers['content-type'] ?? 'application/octet-stream'), modified: new Date() });
          res.writeHead(200, { ETag: `"${hex.slice(0, 32)}"` });
          return res.end();
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          if (!hit) {
            res.writeHead(404, { 'Content-Type': 'application/xml' });
            return res.end(req.method === 'HEAD' ? undefined : xmlError('NoSuchKey'));
          }
          res.writeHead(200, { 'Content-Type': hit.contentType, 'Content-Length': String(hit.body.length), 'Last-Modified': hit.modified.toUTCString() });
          return res.end(req.method === 'HEAD' ? undefined : hit.body);
        }
        if (req.method === 'DELETE') {
          state.objects.delete(key);
          res.writeHead(204);
          return res.end();
        }
        res.writeHead(405);
        res.end();
      };
      if (fault?.delayMs) setTimeout(respond, fault.delayMs);
      else respond();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return state;
}

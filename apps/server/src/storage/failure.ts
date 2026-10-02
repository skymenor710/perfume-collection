/**
 * Por que uma chamada ao armazenamento remoto (R2/S3) falhou — o que DÁ para saber e o que NÃO dá.
 *
 * Duas fontes de informação, nesta ordem:
 *   1. o código S3 do corpo XML (`<Code>NoSuchBucket</Code>`), quando há corpo;
 *   2. o status HTTP e, para falhas antes de haver resposta, o código do sistema (DNS, conexão, TLS, tempo).
 *
 * O que NÃO se sabe (e por isso nunca é afirmado):
 *   - HEAD não traz corpo: um 404 não diz se faltou o objeto (NoSuchKey) ou o bucket (NoSuchBucket), e um 403 não diz se
 *     foi permissão ou assinatura. Quem precisa dessa distinção usa `checkAccess()` (uma listagem, que TEM corpo).
 *   - Com um token restrito a UM bucket, apontar para outro bucket pode responder AccessDenied em vez de NoSuchBucket:
 *     "bucket errado" e "token sem permissão" podem ser indistinguíveis. O texto diz "provável", nunca "certo".
 *   - Os códigos que o Cloudflare R2 devolve em cada caso são os da API S3, mas esta etapa foi feita SEM falar com o R2:
 *     a correspondência é a documentada, não a observada. A FASE 3.1 real confirma.
 *
 * Nada aqui carrega endereço, bucket, chave, assinatura ou cabeçalho: só códigos e frases fixas.
 */

export type StorageFailure =
  | 'no_such_bucket'
  | 'access_denied'
  | 'forbidden'
  | 'invalid_credentials'
  | 'signature'
  | 'clock_skew'
  | 'endpoint'
  | 'dns'
  | 'connection'
  | 'tls'
  | 'timeout'
  | 'network'
  | 'throttled'
  | 'server'
  | 'unexpected';

/** Frase fixa por causa (sem nenhum dado da chamada). */
export const FAILURE_TEXT: Record<StorageFailure, string> = {
  no_such_bucket: 'bucket inexistente (NoSuchBucket)',
  access_denied: 'acesso negado (AccessDenied): o token não tem permissão neste bucket — ou o bucket configurado não é o do token',
  forbidden: 'acesso negado (403 sem corpo: a resposta a HEAD não diz se é permissão ou assinatura)',
  invalid_credentials: 'chave de acesso não reconhecida (InvalidAccessKeyId)',
  signature: 'assinatura recusada (SignatureDoesNotMatch): provável segredo incorreto para esta chave de acesso',
  clock_skew: 'relógio deste computador fora de hora (RequestTimeTooSkewed)',
  endpoint: 'o endereço não respondeu como um servidor S3/R2 (redirecionamento, página HTML ou jurisdição diferente)',
  dns: 'o nome do servidor não foi encontrado (DNS): endpoint digitado errado ou sem internet',
  connection: 'conexão recusada ou interrompida',
  tls: 'falha de certificado/TLS',
  timeout: 'sem resposta no tempo limite',
  network: 'falha de rede',
  throttled: 'limite de requisições atingido (tente de novo mais tarde)',
  server: 'erro do servidor (transitório)',
  unexpected: 'resposta inesperada',
};

/** Código S3 do corpo XML (`<Code>…</Code>`), só letras — nunca texto livre do servidor. */
export function s3ErrorCode(body: string): string | null {
  const match = /<Code>([A-Za-z]{3,40})<\/Code>/.exec(body);
  return match ? match[1]! : null;
}

/** O corpo é uma página (proxy, portal, site comum), não uma resposta de S3? */
export const looksLikeHtml = (body: string) => /<\s*(?:!doctype|html|head|body)\b/i.test(body);

/** Classifica uma resposta HTTP de erro. `code` é o código S3 do corpo, se houver. */
export function classifyResponse(status: number, code: string | null, body = ''): StorageFailure {
  if (!code && looksLikeHtml(body)) return 'endpoint';
  switch (code) {
    case 'NoSuchBucket':
      return 'no_such_bucket';
    case 'AccessDenied':
      return 'access_denied';
    case 'InvalidAccessKeyId':
      return 'invalid_credentials';
    case 'SignatureDoesNotMatch':
      return 'signature';
    case 'RequestTimeTooSkewed':
      return 'clock_skew';
    case 'SlowDown':
    case 'TooManyRequests':
    case 'Throttling':
      return 'throttled';
    case 'PermanentRedirect':
    case 'TemporaryRedirect':
    case 'AuthorizationHeaderMalformed':
    case 'InvalidRegionName':
      return 'endpoint';
    default:
      break;
  }
  if (status >= 300 && status < 400) return 'endpoint';
  if (status === 429) return 'throttled';
  if (status >= 500) return 'server';
  if (status === 401 || status === 403) return body.length > 0 ? 'access_denied' : 'forbidden';
  return 'unexpected';
}

/** Classifica uma falha ANTES de haver resposta (fetch lançou). Só códigos do sistema; nunca o endereço. */
export function classifyNetworkError(error: unknown): StorageFailure {
  const name = (error as Error | undefined)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  const cause = (error as { cause?: { code?: unknown } } | undefined)?.cause;
  const raw = cause?.code ?? (error as { code?: unknown } | undefined)?.code;
  const code = typeof raw === 'string' ? raw : '';
  if (/^(ENOTFOUND|EAI_AGAIN|EAI_NODATA|EAI_NONAME)$/.test(code)) return 'dns';
  if (/^(ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/.test(code)) return 'timeout';
  if (/^(ECONNREFUSED|ECONNRESET|EPIPE|EHOSTUNREACH|ENETUNREACH|EADDRNOTAVAIL|UND_ERR_SOCKET)$/.test(code)) return 'connection';
  if (/^(ERR_TLS|ERR_SSL|ERR_OSSL|CERT_|DEPTH_ZERO|UNABLE_TO_|SELF_SIGNED|HOSTNAME_MISMATCH)/.test(code)) return 'tls';
  return 'network';
}

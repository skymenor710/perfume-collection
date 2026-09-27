// Os únicos globais de plataforma que o núcleo usa. Existem no navegador, no Node e no React Native (Hermes),
// então o domínio continua portátil. Só entra no typecheck do próprio pacote: web e servidor usam as definições deles.
declare class URL {
  constructor(url: string, base?: string | URL);
  readonly protocol: string;
  readonly hostname: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly href: string;
  readonly origin: string;
  toString(): string;
}

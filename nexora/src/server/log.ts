import pino from 'pino';

/**
 * Journal structuré (JSON). Jamais de mot de passe, de jeton, de cookie ni de contenu de message :
 * les champs sensibles sont masqués même s'ils sont passés par erreur.
 */
export function createLogger(level: string, destination?: pino.DestinationStream) {
  const options: pino.LoggerOptions = {
    level,
    base: undefined,
    redact: {
      paths: [
        'password',
        '*.password',
        'token',
        '*.token',
        'cookie',
        '*.cookie',
        'headers.cookie',
        'headers.authorization',
        'req.headers.cookie',
        'req.headers.authorization',
        'email',
        '*.email',
        'phone',
        '*.phone',
        'apiKey',
        '*.apiKey',
        'databaseUrl',
      ],
      censor: '[masqué]',
    },
  };
  return pino(options, destination ?? pino.destination(1));
}

export type Logger = ReturnType<typeof createLogger>;

/**
 * Erreur résumée pour le journal. Une requête SQL échouée (Drizzle) cite ses paramètres dans son message et sa pile :
 * valeurs saisies par les visiteurs (e-mail, message), hachages, jetons — jamais journalisés. Le code et le message de
 * la cause (PostgreSQL : code SQLSTATE, nom de contrainte) suffisent au diagnostic ; le détail (`detail`) est omis.
 */
export function errorSummary(err: unknown) {
  if (!(err instanceof Error)) return { message: maskParams(String(err)).slice(0, 200) };
  const cause = err.cause instanceof Error ? (err.cause as Error & { code?: unknown }) : undefined;
  return {
    name: err.name,
    message: maskParams(err.message).slice(0, 2000),
    code: (err as Error & { code?: unknown }).code ?? cause?.code,
    cause: cause ? maskParams(cause.message).slice(0, 300) : undefined,
    stack: err.stack ? maskParams(err.stack) : undefined,
  };
}

/** Retire la ligne « params: … » (jusqu'à la fin du texte, ou jusqu'aux lignes « at … » d'une pile). */
const maskParams = (text: string) => text.replace(/\nparams:[\s\S]*?(?=\n\s+at |$)/, '\nparams: [masqués]');

import pino from 'pino';

/**
 * Journal structuré (JSON). Jamais de mot de passe, de jeton, de cookie ni de contenu de message :
 * les champs sensibles sont masqués même s'ils sont passés par erreur.
 */
export function createLogger(level: string, destination?: pino.DestinationStream) {
  return pino(
    {
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
  },
    destination ?? pino.destination(1),
  );
}

export type Logger = ReturnType<typeof createLogger>;

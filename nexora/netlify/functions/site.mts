// Netlify Functions (v2) : toutes les pages et l'API passent par l'application Hono ; les fichiers statiques de
// dist/client (assets, marque, polices) restent servis directement par le CDN (preferStatic).
import { serverlessApp } from '../../src/server/serverless';

export default async (req: Request, context: { ip?: string }) => {
  try {
    const { app } = await serverlessApp();
    // IP fournie par la plateforme : base de la limitation d'envoi du formulaire et des tentatives de connexion.
    return await app.fetch(req, { clientIp: context?.ip ?? '' });
  } catch (e) {
    // Message de configuration seulement (aucun secret n'y figure) ; réponse neutre pour le visiteur.
    console.error(JSON.stringify({ level: 'error', msg: 'nexora: démarrage impossible', reason: (e as Error).message }));
    return new Response('Service momentanément indisponible. Réessayez dans un instant.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60', 'cache-control': 'no-store' },
    });
  }
};

export const config = { path: '/*', preferStatic: true };

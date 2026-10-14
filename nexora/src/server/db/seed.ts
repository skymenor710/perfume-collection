import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { count } from 'drizzle-orm';
import type { Deps } from '../context';
import { projectImages, projects } from './schema';
import { processAndStoreImage } from '../lib/images';
import { bumpContentVersion } from '../lib/repo';

/**
 * Projets du portfolio affichés au départ : trois sites conçus par Nexora avec Claude Code.
 *  - maçonnerie et laboratoire : maquettes de prospection (pas des clients livrés), noms et coordonnées floutés,
 *    comme dans le dossier de présentation ;
 *  - EARKO : page produit de la marque EARKO.
 * Captures : assets-src/portfolio/ (capture.mjs pour les sites ouverts dans le navigateur, frame.py pour les
 * captures existantes du dossier). is_demo = true → mention « Démonstration » : ce ne sont pas des références clients.
 * N'agit que si la base ne contient encore aucun projet.
 */
const DEMOS = [
  {
    name: 'Entreprise de maçonnerie',
    category: 'Bâtiment · Site vitrine',
    url: null,
    images: [
      ['maconnerie-1', 'Site d’une entreprise de maçonnerie, haut de page : « De multiples savoir-faire, un seul interlocuteur », illustration d’une maison et bouton de devis.'],
      ['maconnerie-2', 'Site d’une entreprise de maçonnerie : « Sept corps d’état, une seule entreprise », liste des prestations.'],
      ['maconnerie-3', 'Site d’une entreprise de maçonnerie : la méthode en quatre étapes, de la demande à la réception du chantier.'],
      ['maconnerie-4', 'Site d’une entreprise de maçonnerie : galerie des réalisations filtrable par métier.'],
    ],
  },
  {
    name: 'Laboratoire in vitro',
    category: 'Biotechnologie · Site vitrine trilingue',
    url: null,
    images: [
      ['labo-1', 'Site d’un laboratoire de culture in vitro, haut de page : le mot « in vitro » en grand sur fond vert sombre.'],
      ['labo-2', 'Site d’un laboratoire de culture in vitro : animation de multiplication des plants pilotée par le défilement.'],
      ['labo-3', 'Site d’un laboratoire de culture in vitro : cycle de production de 142 semaines et section sur le palmier dattier.'],
      ['labo-4', 'Site d’un laboratoire de culture in vitro, bas de page : appel à projet et coordonnées (masquées).'],
    ],
  },
  {
    name: 'EARKO',
    category: 'E-commerce · Page produit',
    url: null,
    images: [
      ['earko-1', 'Site EARKO, haut de page : « Stay in motion », écouteur SecureFit, prix et bouton d’achat.'],
      ['earko-2', 'Site EARKO : section « No more constant adjustments » avec photo du produit porté.'],
      ['earko-3', 'Site EARKO : choix de la couleur parmi quatre finitions.'],
      ['earko-4', 'Site EARKO, bas de page : rappel du prix, garanties d’achat et pied de page.'],
    ],
  },
] as const;

export async function seedDemo(deps: Deps, seedDir: string) {
  const existing = await deps.db.select({ n: count() }).from(projects);
  if (Number(existing[0]?.n ?? 0) > 0) return { created: 0, skipped: true };
  let created = 0;
  for (const [i, demo] of DEMOS.entries()) {
    const [p] = await deps.db
      .insert(projects)
      .values({ name: demo.name, category: demo.category, url: demo.url, isDemo: true, published: true, featuredPosition: i + 1, sortOrder: i + 1 })
      .returning({ id: projects.id });
    for (const [k, [file, alt]] of demo.images.entries()) {
      const buf = await readFile(path.join(seedDir, `${file}.webp`));
      const img = await processAndStoreImage(deps.storage, p.id, buf, 20 * 1024 * 1024);
      await deps.db.insert(projectImages).values({
        id: img.id,
        projectId: p.id,
        sortOrder: k + 1,
        alt,
        width: img.width,
        height: img.height,
        storagePrefix: img.storagePrefix,
        variants: img.variants,
        bytes: img.bytes,
      });
    }
    created++;
  }
  await bumpContentVersion(deps.db);
  return { created, skipped: false };
}

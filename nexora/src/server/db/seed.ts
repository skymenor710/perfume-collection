import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { count } from 'drizzle-orm';
import type { Deps } from '../context';
import { projectImages, projects } from './schema';
import { processAndStoreImage } from '../lib/images';
import { bumpContentVersion } from '../lib/repo';

/**
 * Projets du portfolio affichés au départ : trois CONCEPTS conçus par Nexora avec Claude Code (pas des clients livrés).
 *  - maçonnerie et laboratoire : maquettes de prospection, noms et coordonnées floutés, comme dans le dossier de
 *    présentation ; EARKO : concept de page produit.
 * Captures 16:10 : assets-src/portfolio/capture.mjs (1440 × 900 à densité 2, soit 2880 × 1800) ; maçonnerie : captures
 * 1600 × 1000 du dossier. is_demo = true → mention « Concept / Démonstration », et aucun résultat chiffré : un concept
 * n'a pas de résultats mesurés. N'agit que si la base ne contient encore aucun projet.
 */
const DEMOS = [
  {
    name: 'Entreprise de maçonnerie',
    category: 'Bâtiment · Site vitrine',
    challenge:
      'Concept de prospection pour une entreprise qui réalise sept corps d’état : rendre lisible une offre très large et transformer les visites en demandes de devis.',
    solution:
      'Site vitrine au message clair dès l’accueil (« un seul interlocuteur »), prestations classées par métier, méthode en quatre étapes et réalisations filtrables. Le bouton de devis reste visible à chaque écran.',
    images: [
      ['maconnerie-1', 'Site d’une entreprise de maçonnerie, haut de page : « De multiples savoir-faire, un seul interlocuteur », illustration d’une maison et bouton de devis.'],
      ['maconnerie-2', 'Site d’une entreprise de maçonnerie : « Sept corps d’état, une seule entreprise », liste des prestations par métier.'],
      ['maconnerie-3', 'Site d’une entreprise de maçonnerie : la méthode en quatre étapes, de la demande à la réception du chantier.'],
      ['maconnerie-4', 'Site d’une entreprise de maçonnerie : galerie des réalisations filtrable par métier.'],
    ],
  },
  {
    name: 'Laboratoire in vitro',
    category: 'Biotechnologie · Site vitrine trilingue',
    challenge:
      'Concept pour un laboratoire de culture in vitro du palmier dattier, présent en France et aux Émirats arabes unis : expliquer un procédé scientifique à des exploitants et des investisseurs, en trois langues.',
    solution:
      'Site trilingue (français, anglais, arabe) à l’esthétique sobre : récit du procédé guidé par le défilement, chiffres clés de production et prise de contact pour les projets de plantation.',
    images: [
      ['labo-1', 'Site d’un laboratoire de culture in vitro, haut de page : le mot « in vitro » en grand sur fond vert sombre.'],
      ['labo-2', 'Site d’un laboratoire de culture in vitro : « 64 plants en culture », grille animée de jeunes plants.'],
      ['labo-3', 'Site d’un laboratoire de culture in vitro : pourquoi la voie in vitro, avec l’illustration d’un palmier dattier.'],
      ['labo-4', 'Site d’un laboratoire de culture in vitro, bas de page : coordonnées (masquées) et carte d’implantation.'],
    ],
  },
  {
    name: 'EARKO',
    category: 'E-commerce · Page produit',
    challenge:
      'Concept de page produit pour des écouteurs ouverts : rendre un produit technique désirable et mener le visiteur jusqu’à l’achat sur une seule page.',
    solution:
      'Page de vente : bénéfice clé dès l’accueil, prix et bouton d’achat toujours à portée, choix de la finition, puis réassurance (paiement sécurisé, livraison suivie, retours) avant le pied de page.',
    images: [
      ['earko-1', 'Site EARKO, haut de page : « Stay in motion », écouteur SecureFit, prix et bouton d’achat.'],
      ['earko-2', 'Site EARKO : section « No more constant adjustments » avec la photo du produit porté.'],
      ['earko-3', 'Site EARKO : choix de la finition parmi quatre couleurs.'],
      ['earko-4', 'Site EARKO, bas de page : garanties d’achat (paiement, livraison, retours, support) et pied de page.'],
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
      .values({ name: demo.name, category: demo.category, challenge: demo.challenge, solution: demo.solution, isDemo: true, published: true, featuredPosition: i + 1, sortOrder: i + 1 })
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

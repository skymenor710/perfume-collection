import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { count } from 'drizzle-orm';
import type { Deps } from '../context';
import { projectImages, projects } from './schema';
import { processAndStoreImage } from '../lib/images';
import { bumpContentVersion } from '../lib/repo';

/**
 * Projets d'EXEMPLE affichés tant que Nexora n'a pas ajouté ses propres réalisations : trois sites publics de
 * référence (Snøhetta, Opinel, Wavestone), capturés le 14/10/2026 par assets-src/real-sites/capture.mjs.
 * Ils NE SONT PAS des réalisations de Nexora : is_demo = true → mention « Démonstration » sur le site.
 * N'agit que si la base ne contient encore aucun projet.
 */
const DEMOS = [
  {
    name: 'Snøhetta',
    category: 'Architecture · Site institutionnel',
    url: 'https://www.snohetta.com',
    images: [
      ['snohetta-1', 'Site de Snøhetta, haut de page : présentation de l’agence et liste des disciplines (architecture, paysage, intérieur, design produit).'],
      ['snohetta-2', 'Site de Snøhetta, milieu de page : actualités de projets et agenda des conférences.'],
      ['snohetta-3', 'Site de Snøhetta, milieu de page : liste des projets phares, de la Bibliotheca Alexandrina à l’Opéra national de Norvège.'],
      ['snohetta-4', 'Site de Snøhetta, bas de page : contact et pied de page.'],
    ],
  },
  {
    name: 'Opinel',
    category: 'Artisanat · E-commerce',
    url: 'https://www.opinel.com/fr-fr/',
    images: [
      ['opinel-1', 'Site d’Opinel, haut de page : couteau de poche en édition limitée mis en avant.'],
      ['opinel-2', 'Site d’Opinel, milieu de page : personnalisation par gravure et collections de couteaux.'],
      ['opinel-3', 'Site d’Opinel, milieu de page : articles et conseils autour des couteaux.'],
      ['opinel-4', 'Site d’Opinel, bas de page : histoire de la marque depuis 1890 et pied de page.'],
    ],
  },
  {
    name: 'Wavestone',
    category: 'Services · Conseil',
    url: 'https://www.wavestone.com/fr/',
    images: [
      ['wavestone-1', 'Site de Wavestone, haut de page : actualité du cabinet et accroche sur les transformations par l’IA.'],
      ['wavestone-2', 'Site de Wavestone, milieu de page : dernières publications et informations.'],
      ['wavestone-3', 'Site de Wavestone, milieu de page : section Talents & Culture.'],
      ['wavestone-4', 'Site de Wavestone, bas de page : prochains événements, contact et pied de page.'],
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

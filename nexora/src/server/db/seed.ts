import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { count } from 'drizzle-orm';
import type { Deps } from '../context';
import { projectImages, projects } from './schema';
import { processAndStoreImage } from '../lib/images';
import { bumpContentVersion } from '../lib/repo';

/**
 * Données de DÉMONSTRATION clairement identifiées (is_demo = true, mention « Démonstration » sur le site) :
 * trois sites fictifs (Altura, Maison Lenoir, Vélora) — ce ne sont pas des clients.
 * N'agit que si la base ne contient encore aucun projet.
 */
const DEMOS = [
  {
    name: 'Architecture',
    category: 'Site vitrine · Design sur mesure',
    description: '',
    images: [
      ['altura-1', 'Démonstration Altura : page d’accueil avec une maison contemporaine au crépuscule et le titre « Des espaces pour mieux vivre ».'],
      ['altura-2', 'Démonstration Altura : page Projets présentant trois maisons contemporaines.'],
      ['altura-3', 'Démonstration Altura : page Approche avec un intérieur lumineux et les étapes du projet.'],
    ],
  },
  {
    name: 'Artisanat',
    category: 'Site vitrine · Design sur mesure',
    description: '',
    images: [
      ['lenoir-1', 'Démonstration Maison Lenoir : page d’accueil « Rénover avec sens » sur un salon chaleureux.'],
      ['lenoir-2', 'Démonstration Maison Lenoir : page Savoir-faire avec menuiserie, rénovation et finitions.'],
      ['lenoir-3', 'Démonstration Maison Lenoir : fiche réalisation d’un séjour rénové.'],
    ],
  },
  {
    name: 'Services',
    category: 'Site vitrine · Design sur mesure',
    description: '',
    images: [
      ['velora-1', 'Démonstration Vélora : page d’accueil « Des idées en résultats » avec une salle de réunion lumineuse.'],
      ['velora-2', 'Démonstration Vélora : page Expertises avec trois offres de conseil.'],
      ['velora-3', 'Démonstration Vélora : page Méthode en trois temps.'],
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
      .values({ name: demo.name, category: demo.category, description: demo.description, isDemo: true, published: true, featuredPosition: i + 1, sortOrder: i + 1 })
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

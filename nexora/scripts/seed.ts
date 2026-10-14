// Ajoute les 3 projets d'EXEMPLE (sites publics de référence, mention « Démonstration ») si la base n'a encore aucun projet.
import path from 'node:path';
import { bootstrap, PROJECT_ROOT } from '../src/server/bootstrap';
import { seedDemo } from '../src/server/db/seed';

const rt = await bootstrap({ migrate: true });
const r = await seedDemo(rt.deps, path.join(PROJECT_ROOT, 'seed', 'demo'));
console.log(r.skipped ? 'Des projets existent déjà : rien n’a été ajouté.' : `${r.created} projets de démonstration ajoutés.`);
await rt.close();

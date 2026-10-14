// Applique les migrations SQL versionnées (dossier drizzle/). Sans effet si la base est à jour.
import { bootstrap } from '../src/server/bootstrap';

const rt = await bootstrap({ migrate: true });
console.log('Migrations appliquées.');
await rt.close();

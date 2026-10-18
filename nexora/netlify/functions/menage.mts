// Fonction planifiée (Netlify) : remplace le minuteur du serveur Node (src/server/main.ts).
import { housekeeping } from '../../src/server/serverless';

export default async () => {
  await housekeeping();
};

export const config = { schedule: '@hourly' };

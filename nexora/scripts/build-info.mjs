// Marqueur de version publié avec les fichiers statiques : /version.txt = commit déployé (variable COMMIT_REF fournie
// par Netlify pendant le build ; « local » ailleurs). Sert à vérifier quel commit est réellement en production.
import { writeFileSync } from 'node:fs';

const ref = /^[0-9a-f]{7,40}$/.test(process.env.COMMIT_REF ?? '') ? process.env.COMMIT_REF : 'local';
writeFileSync('dist/client/version.txt', `${ref}\n`);
console.log(`version.txt : ${ref}`);

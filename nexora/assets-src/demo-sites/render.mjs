// Génère les 9 visuels des PROJETS DE DÉMONSTRATION (sites fictifs : Altura, Maison Lenoir, Vélora).
// Ce ne sont pas des clients : ces captures servent d'exemples jusqu'à l'ajout des vrais projets dans /admin.
// Photos : Unsplash (licence Unsplash, usage libre) — liste dans assets-src/demo-sites/CREDITS.md.
//
// Usage : node assets-src/demo-sites/render.mjs <dossier-photos> <dossier-polices-fontsource> <dossier-sortie>
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const [photoDir, fontDir, outDir] = process.argv.slice(2);
if (!photoDir || !fontDir || !outDir) {
  console.error('usage: render.mjs <photos> <fontsource node_modules/@fontsource> <out>');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const photo = (id) => `data:image/jpeg;base64,${readFileSync(path.join(photoDir, `${id}.jpg`)).toString('base64')}`;
const font = (pkg, file) => `data:font/woff2;base64,${readFileSync(path.join(fontDir, pkg, 'files', file)).toString('base64')}`;

const fonts = `
@font-face{font-family:Inter;font-weight:400;src:url(${font('inter', 'inter-latin-400-normal.woff2')})}
@font-face{font-family:Inter;font-weight:500;src:url(${font('inter', 'inter-latin-500-normal.woff2')})}
@font-face{font-family:Inter;font-weight:600;src:url(${font('inter', 'inter-latin-600-normal.woff2')})}
@font-face{font-family:Cormorant;font-weight:400;src:url(${font('cormorant-garamond', 'cormorant-garamond-latin-400-normal.woff2')})}
@font-face{font-family:Cormorant;font-weight:500;src:url(${font('cormorant-garamond', 'cormorant-garamond-latin-500-normal.woff2')})}
@font-face{font-family:Marcellus;font-weight:400;src:url(${font('marcellus', 'marcellus-latin-400-normal.woff2')})}
`;

const base = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:1200px;overflow:hidden}
body{font-family:Inter,sans-serif;color:#1d1b19;-webkit-font-smoothing:antialiased}
.nav{display:flex;align-items:center;justify-content:space-between;height:104px;padding:0 64px;font-size:17px;letter-spacing:.01em}
.nav ul{display:flex;gap:46px;list-style:none;color:#3b3732}
.brand{font-family:Marcellus,serif;font-size:30px;letter-spacing:.32em}
.eyebrow{font-size:14px;letter-spacing:.24em;text-transform:uppercase;color:#6b645c;font-weight:500}
.serif{font-family:Cormorant,serif;font-weight:400}
.btn{display:inline-flex;align-items:center;gap:12px;border:1px solid currentColor;border-radius:999px;padding:16px 28px;font-size:16px;font-weight:500}
.cover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
`;

const pages = {
  // ---------- ALTURA — architecture ----------
  'altura-1': `
<style>body{background:#efe9e2}.hero{position:relative;height:1096px}.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(239,233,226,.97) 0%,rgba(239,233,226,.86) 34%,rgba(239,233,226,0) 62%)}
.txt{position:absolute;left:64px;top:170px;width:560px}.txt h1{font-size:96px;line-height:.98;margin:26px 0 30px;color:#1b1916}.txt p{font-size:21px;line-height:1.5;color:#4a443d;width:440px;margin-bottom:40px}</style>
<div class="nav"><span class="brand">ALTURA</span><ul><li>Projets</li><li>Approche</li><li>Studio</li><li>Contact</li></ul></div>
<div class="hero"><img class="cover" src="${photo('1600585154340-be6161a56a0c')}"><div class="shade"></div>
<div class="txt"><div class="eyebrow">Architecture contemporaine</div><h1 class="serif">Des espaces pour mieux vivre</h1>
<p>Architecture sur mesure pour des lieux durables et inspirants.</p><span class="btn">Découvrir le studio →</span></div></div>`,
  'altura-2': `
<style>body{background:#f5f1ec}.head{padding:40px 64px 44px;display:flex;justify-content:space-between;align-items:end}.head h2{font-size:76px;line-height:1}
.grid{display:grid;grid-template-columns:1.25fr 1fr;grid-template-rows:470px 360px;gap:20px;padding:0 64px}.cell{position:relative;overflow:hidden;border-radius:6px}.cell:first-child{grid-row:span 2}
.cap{position:absolute;left:22px;bottom:20px;color:#fff;font-size:17px;font-weight:500;text-shadow:0 1px 12px rgba(0,0,0,.45)}.cap small{display:block;font-weight:400;opacity:.85;font-size:14px;margin-top:4px}</style>
<div class="nav"><span class="brand">ALTURA</span><ul><li><b>Projets</b></li><li>Approche</li><li>Studio</li><li>Contact</li></ul></div>
<div class="head"><div><div class="eyebrow">Sélection 2023 — 2026</div><h2 class="serif" style="margin-top:18px">Projets</h2></div><span class="btn">Tous les projets →</span></div>
<div class="grid"><div class="cell"><img class="cover" src="${photo('1613490493576-7fde63acd811')}"><div class="cap">Villa Horizon<small>Résidence privée · Côte méditerranéenne</small></div></div>
<div class="cell"><img class="cover" src="${photo('1600047509807-ba8f99d2cdde')}"><div class="cap">Maison Cèdre<small>Extension contemporaine</small></div></div>
<div class="cell"><img class="cover" src="${photo('1600566753190-17f0baa2a6c3')}"><div class="cap">Atelier Rivage<small>Logement et studio</small></div></div></div>`,
  'altura-3': `
<style>body{background:#1c1a18;color:#efe9e2}.nav ul{color:#cfc7bd}.wrap{display:grid;grid-template-columns:1fr 1fr;height:1096px}.pic{position:relative}
.side{padding:110px 64px 0 72px}.side h2{font-size:78px;line-height:1;margin:24px 0 34px}.side p{font-size:20px;line-height:1.6;color:#bdb4a9;margin-bottom:46px}
.steps{list-style:none;border-top:1px solid #3a3632}.steps li{display:flex;gap:26px;padding:24px 0;border-bottom:1px solid #3a3632;font-size:19px}.steps b{font-weight:500;color:#9d958b;width:36px}
.eyebrow{color:#a99f93}</style>
<div class="nav"><span class="brand">ALTURA</span><ul><li>Projets</li><li><b>Approche</b></li><li>Studio</li><li>Contact</li></ul></div>
<div class="wrap"><div class="pic"><img class="cover" src="${photo('1600573472550-8090b5e0745e')}"></div>
<div class="side"><div class="eyebrow">Notre approche</div><h2 class="serif">La lumière comme matériau</h2>
<p>Chaque projet naît d'une écoute attentive du site, de ses usages et de ceux qui l'habiteront.</p>
<ul class="steps"><li><b>01</b>Écoute et relevés du lieu</li><li><b>02</b>Esquisse et volumes</li><li><b>03</b>Conception détaillée</li><li><b>04</b>Suivi de chantier</li></ul></div></div>`,

  // ---------- MAISON LENOIR — artisanat ----------
  'lenoir-1': `
<style>body{background:#f1ebe3}.nav{background:#f1ebe3}.logo{display:flex;align-items:center;gap:14px;font-family:Marcellus,serif;font-size:19px;line-height:1.05;letter-spacing:.12em}
.mark{width:44px;height:44px;border-radius:50%;border:2px solid #2a2520;display:grid;place-items:center;font-size:20px}
.hero{position:relative;height:1096px}.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(32,24,18,.82),rgba(32,24,18,.35) 55%,rgba(32,24,18,.08))}
.txt{position:absolute;left:64px;top:190px;color:#f4ede4;width:600px}.txt h1{font-family:Marcellus,serif;font-weight:400;font-size:84px;line-height:1.04;letter-spacing:.03em;margin:26px 0 30px}
.txt p{font-size:21px;line-height:1.55;color:#e2d6c8;width:470px;margin-bottom:42px}.eyebrow{color:#e0cdb7}</style>
<div class="nav"><span class="logo"><span class="mark">ML</span><span>MAISON<br>LENOIR</span></span><ul><li>Savoir-faire</li><li>Réalisations</li><li>À propos</li><li>Contact</li></ul></div>
<div class="hero"><img class="cover" src="${photo('1618221195710-dd6b41faaea6')}"><div class="shade"></div>
<div class="txt"><div class="eyebrow">Artisans passionnés</div><h1>RÉNOVER<br>AVEC SENS</h1><p>Des intérieurs durables, au service de votre histoire.</p><span class="btn">Découvrir nos réalisations →</span></div></div>`,
  'lenoir-2': `
<style>body{background:#f1ebe3}.logo{display:flex;align-items:center;gap:14px;font-family:Marcellus,serif;font-size:19px;line-height:1.05;letter-spacing:.12em}
.mark{width:44px;height:44px;border-radius:50%;border:2px solid #2a2520;display:grid;place-items:center;font-size:20px}
.intro{padding:44px 64px 50px;display:grid;grid-template-columns:1.1fr 1fr;gap:60px;align-items:end}.intro h2{font-family:Marcellus,serif;font-weight:400;font-size:64px;line-height:1.05;letter-spacing:.02em}
.intro p{font-size:19px;line-height:1.6;color:#5b5147}.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;padding:0 64px}
.col .ph{position:relative;height:560px;border-radius:4px;overflow:hidden}.col h3{font-family:Marcellus,serif;font-weight:400;font-size:28px;margin:24px 0 8px}.col p{font-size:16px;color:#6a5f54;line-height:1.5}</style>
<div class="nav"><span class="logo"><span class="mark">ML</span><span>MAISON<br>LENOIR</span></span><ul><li><b>Savoir-faire</b></li><li>Réalisations</li><li>À propos</li><li>Contact</li></ul></div>
<div class="intro"><div><div class="eyebrow">Notre savoir-faire</div><h2 style="margin-top:20px">Trois métiers,<br>une même exigence</h2></div><p>Bois, pierre et finitions : nous restaurons les matières nobles et les faisons dialoguer avec un confort contemporain.</p></div>
<div class="cols"><div class="col"><div class="ph"><img class="cover" src="${photo('1615529182904-14819c35db37')}"></div><h3>Menuiserie</h3><p>Agencements et boiseries sur mesure.</p></div>
<div class="col"><div class="ph"><img class="cover" src="${photo('1560185007-cde436f6a4d0')}"></div><h3>Rénovation</h3><p>Volumes repensés, matières préservées.</p></div>
<div class="col"><div class="ph"><img class="cover" src="${photo('1600210492486-724fe5c67fb0')}"></div><h3>Finitions</h3><p>Enduits, peintures et détails soignés.</p></div></div>`,
  'lenoir-3': `
<style>body{background:#2a221c;color:#f1e8dc}.nav ul{color:#d8cbbb}.logo{display:flex;align-items:center;gap:14px;font-family:Marcellus,serif;font-size:19px;line-height:1.05;letter-spacing:.12em}
.mark{width:44px;height:44px;border-radius:50%;border:2px solid #f1e8dc;display:grid;place-items:center;font-size:20px}
.feat{position:relative;margin:0 64px;height:640px;border-radius:4px;overflow:hidden}.row{display:grid;grid-template-columns:1.2fr 1fr;gap:60px;padding:54px 64px}
.row h2{font-family:Marcellus,serif;font-weight:400;font-size:56px;line-height:1.08}.facts{display:grid;grid-template-columns:1fr 1fr;gap:26px 30px;font-size:16px;color:#c9baa8}.facts b{display:block;color:#f1e8dc;font-size:22px;font-weight:500;margin-bottom:4px}
.eyebrow{color:#cdb79d}</style>
<div class="nav"><span class="logo"><span class="mark">ML</span><span>MAISON<br>LENOIR</span></span><ul><li>Savoir-faire</li><li><b>Réalisations</b></li><li>À propos</li><li>Contact</li></ul></div>
<div class="feat"><img class="cover" src="${photo('1600210492486-724fe5c67fb0')}"></div>
<div class="row"><div><div class="eyebrow">Réalisation</div><h2 style="margin-top:18px">Un séjour baigné<br>de lumière</h2></div>
<div class="facts"><div><b>Rénovation</b>Type de chantier</div><div><b>85 m²</b>Surface</div><div><b>Chêne massif</b>Matière principale</div><div><b>10 semaines</b>Durée</div></div></div>`,

  // ---------- VÉLORA — conseil & stratégie ----------
  'velora-1': `
<style>body{background:#f3f1ed}.hero{position:relative;height:1096px}.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(243,241,237,.97) 0%,rgba(243,241,237,.9) 36%,rgba(243,241,237,0) 64%)}
.txt{position:absolute;left:64px;top:200px;width:560px}.txt h1{font-size:92px;line-height:1;margin:26px 0 30px}.txt p{font-size:21px;line-height:1.55;color:#4d4a45;width:470px;margin-bottom:40px}
.btn{background:#fff;border-color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.08)}</style>
<div class="nav"><span class="brand">VÉLORA</span><ul><li>Expertises</li><li>Méthode</li><li>Équipe</li><li>Contact</li></ul></div>
<div class="hero"><img class="cover" src="${photo('1517502884422-41eaead166d4')}"><div class="shade"></div>
<div class="txt"><div class="eyebrow">Conseil &amp; stratégie</div><h1 class="serif">Des idées en résultats</h1><p>Nous accompagnons les entreprises dans leur transformation durable.</p><span class="btn">Nos expertises →</span></div></div>`,
  'velora-2': `
<style>body{background:#f3f1ed}.top{display:grid;grid-template-columns:1fr 1fr;gap:56px;padding:40px 64px 54px;align-items:end}.top h2{font-size:80px;line-height:1}
.top p{font-size:19px;line-height:1.6;color:#55514b}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;padding:0 64px}
.card{background:#fff;border-radius:8px;padding:34px 30px;height:300px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 10px 30px rgba(30,25,20,.05)}
.card h3{font-size:24px;font-weight:500;margin-bottom:12px}.card p{font-size:16px;line-height:1.5;color:#6a665f}.num{font-family:Cormorant,serif;font-size:44px;color:#9a8f80}
.band{position:relative;margin:20px 64px 0;height:330px;border-radius:8px;overflow:hidden}</style>
<div class="nav"><span class="brand">VÉLORA</span><ul><li><b>Expertises</b></li><li>Méthode</li><li>Équipe</li><li>Contact</li></ul></div>
<div class="top"><div><div class="eyebrow">Expertises</div><h2 class="serif" style="margin-top:18px">Clarifier, décider, avancer</h2></div><p>Trois leviers pour transformer une intuition en plan d'action mesurable.</p></div>
<div class="cards"><div class="card"><span class="num">I</span><div><h3>Stratégie</h3><p>Vision, priorités et feuille de route à 18 mois.</p></div></div>
<div class="card"><span class="num">II</span><div><h3>Organisation</h3><p>Processus, rôles et outils au service des équipes.</p></div></div>
<div class="card"><span class="num">III</span><div><h3>Transformation</h3><p>Pilotage du changement et indicateurs durables.</p></div></div></div>
<div class="band"><img class="cover" src="${photo('1524758631624-e2822e304c36')}"></div>`,
  'velora-3': `
<style>body{background:#22262a;color:#eef0f1}.nav ul{color:#c4c9cd}.wrap{display:grid;grid-template-columns:1fr 1.05fr;gap:0;height:1096px}
.side{padding:100px 56px 0 64px}.side h2{font-size:80px;line-height:1;margin:22px 0 36px}.eyebrow{color:#a9b0b6}
.steps{list-style:none}.steps li{padding:26px 0;border-top:1px solid #3c4248}.steps b{display:block;font-weight:500;font-size:21px;margin-bottom:6px}.steps span{color:#a9b0b6;font-size:16px}
.pic{position:relative}</style>
<div class="nav"><span class="brand">VÉLORA</span><ul><li>Expertises</li><li><b>Méthode</b></li><li>Équipe</li><li>Contact</li></ul></div>
<div class="wrap"><div class="side"><div class="eyebrow">Méthode</div><h2 class="serif">Une méthode en trois temps</h2>
<ul class="steps"><li><b>Diagnostic</b><span>Entretiens, données et cartographie des enjeux.</span></li><li><b>Plan d'action</b><span>Priorités chiffrées, responsabilités et calendrier.</span></li><li><b>Accompagnement</b><span>Ateliers, suivi mensuel et ajustements.</span></li></ul></div>
<div class="pic"><img class="cover" src="${photo('1497366811353-6870744d04b2')}"></div></div>`,
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1 });
for (const [name, body] of Object.entries(pages)) {
  await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${fonts}${base}</style></head><body>${body}</body></html>`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log('ok', name);
}
await browser.close();

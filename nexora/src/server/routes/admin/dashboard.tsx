import type { Hono } from 'hono';
import { count, desc } from 'drizzle-orm';
import type { AppEnv, Deps } from '../../context';
import { contactRequests } from '../../db/schema';
import { getContent, listProjects } from '../../lib/repo';
import { missingLegal, rows } from '../../lib/content';
import { DashboardPage, type Warning } from '../../views/admin/pages';
import { createHelpers, html, takeFlash } from './shared';

export function registerDashboard(app: Hono<AppEnv>, deps: Deps) {
  const { db, config, assets } = deps;
  const { newCount } = createHelpers(deps);

  /* ------------------------------------------------------------ Tableau de bord */
  app.get('/', async (c) => {
    const s = c.get('session')!;
    const [content, all, totalReq, recent, newRequests] = await Promise.all([
      getContent(db),
      listProjects(db),
      db.select({ n: count() }).from(contactRequests),
      db.select().from(contactRequests).orderBy(desc(contactRequests.createdAt)).limit(5),
      newCount(),
    ]);
    const warnings: Warning[] = [];
    if (!config.mail.configured) {
      warnings.push({
        title: 'Notification e-mail non configurée',
        detail: `Les demandes sont bien enregistrées ici, mais aucun e-mail n’est envoyé. Variables manquantes : ${config.mail.missing.join(', ')}.`,
        href: '/admin/compte',
        linkLabel: 'Voir la configuration',
      });
    }
    const legal = missingLegal(content);
    if (legal.length) {
      warnings.push({ title: 'Informations légales incomplètes', detail: legal.map((l) => l.label).join(', '), href: '/admin/contenus', linkLabel: 'Compléter' });
    }
    const demo = all.filter((p) => p.isDemo && p.published);
    if (demo.length) {
      warnings.push({
        title: `${demo.length} concept(s) publié(s)`,
        detail: 'Affichés avec le badge « Concept / Démonstration ». Ajoutez vos projets clients dès que possible : ils passent en premier dans « Nos réalisations ».',
        href: '/admin/projets',
        linkLabel: 'Gérer les projets',
      });
    }
    // Conversion : contenus à remplir avec des données RÉELLES (sections masquées sur le site tant qu'elles sont vides).
    const todo: string[] = [];
    if (!content.contact.bookingUrl) todo.push('lien de prise de rendez-vous (facultatif : sans lien, la section Contact propose seulement le formulaire)');
    if (!content.team.name.trim() || !content.team.text.trim()) todo.push('section « Derrière Nexora » (masquée)');
    if (!rows(content.proof, 'item', 4, ['Value', 'Label'] as const).some((r) => r.Value && r.Label)) todo.push('chiffres de preuve sociale (bande masquée)');
    if (!rows(content.testimonials, 't', 3, ['Quote', 'Author'] as const).some((r) => r.Quote && r.Author)) todo.push('témoignages clients (section masquée)');
    if (!all.some((p) => p.published && !p.isDemo)) todo.push('projets clients avec résultats vérifiables (aucun « Projet client » dans « Nos réalisations »)');
    else if (all.some((p) => p.published && !p.isDemo && !p.results.trim())) todo.push('résultats vérifiables des projets clients');
    if (todo.length) {
      warnings.push({ title: 'Contenus de conversion à compléter', detail: `${todo.join(' ; ')}.`, href: '/admin/contenus', linkLabel: 'Compléter' });
    }
    const missingAlt = all.filter((p) => p.published && p.images.some((i) => !i.alt.trim()));
    if (missingAlt.length) {
      warnings.push({ title: 'Textes alternatifs manquants', detail: missingAlt.map((p) => p.name).join(', '), href: `/admin/projets/${missingAlt[0].id}`, linkLabel: 'Compléter' });
    }
    for (const w of config.warnings) warnings.push({ title: 'Configuration serveur', detail: w });
    return html(
      c,
      <DashboardPage
        session={s}
        assets={assets}
        flash={takeFlash(c)}
        newRequests={newRequests}
        stats={{ published: all.filter((p) => p.published).length, total: all.length, requests: Number(totalReq[0]?.n ?? 0) }}
        warnings={warnings}
        recent={recent}
      />,
    );
  });
}

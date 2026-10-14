import type { JSX } from 'hono/jsx/jsx-runtime';

/** Rendu serveur d'un arbre JSX Hono en document HTML complet (le JSX échappe tout texte et attribut). */
export function renderHtml(node: JSX.Element): string {
  return '<!doctype html>' + String(node);
}

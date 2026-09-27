import { describe, expect, it } from 'vitest';
import seed from '../apps/web/src/data/seed.json';
import { applyPerfumeView, fromPerfume, publicLists, referencedImages, sanitizeLibrary, sanitizeUser, toPerfumeView, toPublicView, validateUsername, type Library } from '@perfumes/core/library';
import { sanitizePerfume, type Perfume } from '@perfumes/core/perfume';

const perfumes = (seed as unknown[]).map(sanitizePerfume).filter((p): p is Perfume => p !== null);
const owned: Perfume = { ...perfumes[0], id: 'teste-colecao', status: 'owned', personalRating: 'very_good', acquiredAt: '2026-09-20T10:00:00.000Z', order: 99 };

describe('produto + entrada: a troca de armazenamento não perde nada', () => {
  it('toPerfumeView(fromPerfume(p)) devolve exatamente p — para cada perfume da planilha', () => {
    for (const p of [...perfumes, owned]) {
      const { product, entry } = fromPerfume(p, 'u1');
      expect(toPerfumeView(entry, product)).toEqual(p);
    }
  });

  it('o que é do perfume vai para o produto; o que é da pessoa, para a entrada', () => {
    const { product, entry } = fromPerfume(owned, 'u1');
    expect(entry).toMatchObject({ list: 'collection', rating: 'very_good', position: 99, userId: 'u1', productId: product.id });
    expect(product).not.toHaveProperty('status');
    expect(product.images[0]).toMatchObject({ role: 'main', url: owned.imageUrl, transparent: true });
  });

  it('versão escolhida: a foto principal fica ligada à variante (50 ml ≠ 100 ml)', () => {
    const reflection = perfumes.find((p) => p.variants.length > 1 && p.selectedVariantId)!;
    const { product, entry } = fromPerfume(reflection, 'u1');
    expect(entry.variantId).toBe(reflection.selectedVariantId);
    expect(product.images[0].variantId).toBe(reflection.selectedVariantId);
  });

  it('a biblioteca guardada passa pela mesma validação e volta igual', () => {
    const user = sanitizeUser({ id: 'u1', username: 'guilherme', displayName: 'Guilherme' })!;
    const split = perfumes.map((p) => fromPerfume(p, 'u1'));
    const library: Library = { schemaVersion: 2, users: [user], products: split.map((s) => s.product), entries: split.map((s) => s.entry) };
    const { library: back, dropped } = sanitizeLibrary(JSON.parse(JSON.stringify(library)));
    expect(dropped).toBe(0);
    expect(back).toEqual(library);
  });

  it('entrada sem produto ou sem usuário é descartada (em vez de derrubar o app)', () => {
    const user = sanitizeUser({ id: 'u1', username: 'guilherme' })!;
    const { product, entry } = fromPerfume(perfumes[0], 'u1');
    const { library, dropped } = sanitizeLibrary({ users: [user], products: [product], entries: [entry, { ...entry, id: 'x', productId: 'nao-existe' }, { ...entry, id: 'y', userId: 'intruso' }] });
    expect(library.entries).toHaveLength(1);
    expect(dropped).toBe(2);
  });

  it('editar pela interface troca a foto principal e preserva as alternativas e a observação', () => {
    const base = fromPerfume(perfumes[0], 'u1');
    base.product.images.push({ role: 'alternate', url: 'media/alt-lg.webp', thumbUrl: null, masterUrl: null, variantId: null, transparent: true, source: null, credit: null });
    base.entry.notes = 'presente da Ana';
    const edited = applyPerfumeView(base, { ...perfumes[0], imageUrl: 'media/nova-lg.webp', personalRating: null }, 'u1');
    expect(edited.product.images.map((i) => [i.role, i.url])).toEqual([
      ['main', 'media/nova-lg.webp'],
      ['alternate', 'media/alt-lg.webp'],
    ]);
    expect(edited.entry.notes).toBe('presente da Ana');
    expect(referencedImages({ schemaVersion: 2, users: [], products: [edited.product], entries: [] })).toContain('media/alt-lg.webp');
  });
});

describe('usuário e privacidade', () => {
  it('username: 3–30, minúsculo, sem nomes do app', () => {
    expect(validateUsername('Guilherme')).toEqual({ ok: true, username: 'guilherme' });
    expect(validateUsername('gui.perfumes_01')).toMatchObject({ ok: true });
    for (const bad of ['ab', 'api', 'media', 'wishlist', '.gui', 'gui.', 'gui..m', 'gui herme', 'guilherme/../api', 'x'.repeat(31)]) {
      expect(validateUsername(bad).ok, bad).toBe(false);
    }
  });

  it('tudo nasce privado; só listas abertas aparecem', () => {
    const user = sanitizeUser({ id: 'u1', username: 'guilherme' })!;
    expect(user.privacy).toEqual({ profile: 'private', wishlist: 'private', collection: 'private' });
    expect(publicLists(user)).toEqual([]);
    expect(publicLists({ ...user, privacy: { profile: 'public', wishlist: 'public', collection: 'private' } })).toEqual(['wishlist']);
  });

  it('visão pública não leva as fontes internas nem a observação de preço', () => {
    const view = toPublicView({ ...perfumes[0], priceNote: 'cupom da Ana' });
    expect(view.fieldSources).toEqual({});
    expect(view.priceNote).toBeNull();
    expect(view.name).toBe(perfumes[0].name);
  });
});

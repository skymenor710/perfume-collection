import { sanitizeUser, toPerfumeView, validateUsername, type Entry, type Library, type Product, type User } from '@perfumes/core/library';
import { sortPerfumes, type Perfume } from '@perfumes/core/perfume';
import type { OwnerPatch } from './library';

/**
 * Regras da biblioteca que NÃO dependem de onde os dados moram. As duas implementações (JSON e Postgres) usam
 * exatamente estas funções — assim o comportamento não pode divergir entre elas.
 */

/** As visões (formato da API) das entradas de uma pessoa, na ordem da interface. */
export function viewsOf(entries: readonly Entry[], productOf: (id: string) => Product | undefined, userId: string): Perfume[] {
  return sortPerfumes(
    entries
      .filter((e) => e.userId === userId)
      .map((e) => {
        const product = productOf(e.productId);
        return product ? toPerfumeView(e, product) : null;
      })
      .filter((v): v is Perfume => v !== null),
  );
}

export function libraryViews(library: Library, userId: string): Perfume[] {
  const products = new Map(library.products.map((p) => [p.id, p]));
  return viewsOf(library.entries, (id) => products.get(id), userId);
}

/**
 * Perfil atualizado a partir de um patch. Lança Error com frase para a pessoa quando inválido.
 * `usernameTaken` diz se outro usuário já usa o nome (quem implementa consulta onde os dados estão).
 */
export async function nextOwner(current: User, patch: OwnerPatch, usernameTaken: (username: string) => boolean | Promise<boolean>): Promise<User> {
  let username = current.username;
  if (patch.username !== undefined) {
    const check = validateUsername(patch.username);
    if (!check.ok) throw new Error(check.message);
    if (check.username !== current.username && (await usernameTaken(check.username))) throw new Error('Esse nome já está em uso.');
    username = check.username;
  }
  const next = sanitizeUser({
    ...current,
    username,
    displayName: patch.displayName ?? current.displayName,
    bio: patch.bio === undefined ? current.bio : patch.bio,
    privacy: { ...current.privacy, ...patch.privacy },
    updatedAt: new Date().toISOString(),
  });
  if (!next) throw new Error('Dados de perfil inválidos.');
  return next;
}

/**
 * A semente (os da planilha) foi reprocessada com um pipeline mais novo? Os perfumes guardados que vieram dela
 * recebem fotos, cores e perfil olfativo novos — sem perder o que é da pessoa. Perfumes que a pessoa removeu
 * não voltam. Devolve as visões a gravar (vazio = nada a fazer).
 */
export function seedUpgrades(current: readonly Perfume[], seed: readonly Perfume[]): Perfume[] {
  const out: Perfume[] = [];
  for (const s of seed) {
    const p = current.find((v) => v.id === s.id);
    if (!p || p.origin !== 'google-sheet') continue;
    // Versão mais nova, ou a mesma versão reprocessada (a foto da semente mudou de arquivo). Foto trocada pela
    // pessoa (media/…) não é da semente e fica.
    const seedPhotoChanged = p.imageUrl?.startsWith('bottles/') && p.imageUrl !== s.imageUrl;
    // Semente que passou a conhecer as versões do produto (50/100 ml) também atualiza: o app precisa perguntar.
    const seedLearnedVariants = s.variants.length > 1 && p.variants.length === 0;
    if (p.assetVersion >= s.assetVersion && !seedPhotoChanged && !seedLearnedVariants) continue;
    out.push({
      ...p,
      imageUrl: s.imageUrl,
      thumbUrl: s.thumbUrl,
      dominantColor: s.dominantColor,
      dominantColorOverride: s.dominantColorOverride,
      accentColor: s.accentColor,
      accentGlow: s.accentGlow,
      imageSource: s.imageSource,
      imageCredit: s.imageCredit,
      masterUrl: s.masterUrl,
      fieldSources: { ...p.fieldSources, ...s.fieldSources },
      // Variante: vai inteira (tamanho + preço + link) ou não vai — nunca a foto de uma com o preço de outra.
      variants: s.variants,
      selectedVariantId: s.selectedVariantId,
      variantUrl: s.variantUrl,
      ...(s.selectedVariantId ? { volume: s.volume, price: s.price, currency: s.currency, priceNote: s.priceNote } : {}),
      olfactoryProfile: s.olfactoryProfile,
      description: p.description ?? s.description,
      gender: p.gender ?? s.gender,
      assetVersion: s.assetVersion,
    });
  }
  return out;
}

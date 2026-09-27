import { ArrowUpRight, ImageUp, Link2, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { parsePrice } from '../core/normalize';
import { noteLabel } from '../core/notes-pt';
import {
  ASSET_VERSION,
  findDuplicate,
  formatPrice,
  genderLabel,
  newId,
  safeHttpUrl,
  sanitizePerfume,
  urlKey,
  type FieldSource,
  type Gender,
  type PerfumeVariant,
  type ImageSource,
  type OlfactoryProfile,
  type Perfume,
} from '../core/perfume';
import { FriendlyError, type IdentityHint, type ImportedDraft, type ImportStage, type PhotoMedia, type Repository, type VariantQuestion } from '../data/repository';
import { VariantPicker } from './VariantPicker';
import { assetRef } from '../lib/refs';
import { accent, accentFor } from '../design/accent';
import { Silhouette } from './Bottle';
import { Separated } from '../lib/wrap';

/**
 * link → analyzing → (confiança alta) entra direto na wishlist
 *                  → (moderada) preview: "é este?"
 *                  → (nada seguro) unidentified: tentar de novo ou dizer qual perfume é
 * review = edição (menu do perfume) ou "corrigir dados" a partir da prévia.
 */
type Step = 'link' | 'analyzing' | 'variant' | 'preview' | 'unidentified' | 'review';

interface Form {
  imageSource: ImageSource | null;
  olfactoryProfile: OlfactoryProfile | null;
  accentColor: string | null;
  accentGlow: string | null;
  fieldSources: Record<string, FieldSource>;
  variants: PerfumeVariant[];
  selectedVariantId: string | null;
  variantUrl: string | null;
  name: string;
  brand: string;
  concentration: string;
  volume: string;
  price: string;
  currency: string;
  priceNote: string;
  sourceUrl: string;
  description: string;
  gender: Gender | '';
  media: PhotoMedia | null;
  imageCredit: string | null;
}

const EMPTY: Form = {
  name: '',
  brand: '',
  concentration: '',
  volume: '',
  price: '',
  currency: 'EUR',
  priceNote: '',
  sourceUrl: '',
  description: '',
  gender: '',
  media: null,
  imageCredit: null,
  imageSource: null,
  olfactoryProfile: null,
  accentColor: null,
  accentGlow: null,
  fieldSources: {},
  variants: [],
  selectedVariantId: null,
  variantUrl: null,
};

/** As sete etapas que a pessoa vê. As do servidor caem numa delas e nunca voltam para trás. */
const STAGES: { ids: ImportStage[]; text: string }[] = [
  { ids: ['link'], text: 'Identificando perfume' },
  { ids: ['identity', 'fallback'], text: 'Analisando o link' },
  { ids: ['search'], text: 'Pesquisando o produto' },
  { ids: ['compare'], text: 'Comparando fontes' },
  { ids: ['images'], text: 'Encontrando a melhor imagem' },
  { ids: ['bottle'], text: 'Preparando o frasco' },
  { ids: ['notes'], text: 'Analisando o perfil olfativo' },
  { ids: ['final', 'done'], text: 'Finalizando' },
];
const stageIndex = (s: ImportStage) => STAGES.findIndex((x) => x.ids.includes(s));
const FALLBACK_TEXT = 'Buscando o produto em outras fontes…';

function fromDraft(p: ImportedDraft): Form {
  return {
    ...EMPTY,
    name: p.name ?? '',
    brand: p.brand ?? '',
    concentration: p.concentration ?? '',
    volume: p.volume ?? '',
    price: p.price !== null ? String(p.price).replace('.', ',') : '',
    currency: p.currency ?? 'EUR',
    sourceUrl: p.sourceUrl,
    description: p.description ?? '',
    gender: p.gender ?? '',
    media: p.media,
    imageCredit: p.imageCredit,
    imageSource: p.imageSource,
    olfactoryProfile: p.olfactoryProfile,
    accentColor: p.accentColor,
    accentGlow: p.accentGlow,
    fieldSources: p.fieldSources ?? {},
    // Só guarda as variantes quando houve escolha de verdade (mais de uma): o perfume É a escolhida.
    variants: p.variants.length > 1 ? p.variants.map(({ thumb: _t, volumeMl: _m, ...v }) => v) : [],
    selectedVariantId: p.variants.length > 1 ? (p.variant?.id ?? null) : null,
    variantUrl: p.variants.length > 1 ? p.variantUrl : null,
  };
}

interface Props {
  repo: Repository;
  perfumes: Perfume[];
  /** Perfume a editar; sem ele, é um perfume novo na wishlist. */
  editing: Perfume | null;
  onClose: () => void;
  onSaved: (perfume: Perfume, isNew: boolean) => void;
  onShow: (perfume: Perfume) => void;
  /** Link que chegou pronto (#add= vindo do link do claude.ai): a pesquisa começa sozinha. */
  initialLink?: string | null;
}

function fromPerfume(p: Perfume): Form {
  return {
    name: p.name,
    brand: p.brand ?? '',
    concentration: p.concentration ?? '',
    volume: p.volume ?? '',
    price: p.price !== null ? String(p.price).replace('.', ',') : '',
    currency: p.currency ?? 'EUR',
    priceNote: p.priceNote ?? '',
    sourceUrl: p.sourceUrl ?? '',
    description: p.description ?? '',
    gender: p.gender ?? '',
    media: p.imageUrl ? { imageUrl: p.imageUrl, thumbUrl: p.thumbUrl ?? p.imageUrl, masterUrl: p.masterUrl ?? undefined, dominantColor: p.dominantColorOverride ?? p.dominantColor ?? '', cutout: true } : null,
    imageCredit: p.imageCredit,
    imageSource: p.imageSource,
    olfactoryProfile: p.olfactoryProfile,
    accentColor: p.accentColor,
    accentGlow: p.accentGlow,
    fieldSources: p.fieldSources,
    variants: p.variants,
    selectedVariantId: p.selectedVariantId,
    variantUrl: p.variantUrl,
  };
}

export function AddPerfume({ repo, perfumes, editing, onClose, onSaved, onShow, initialLink = null }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>(editing ? 'review' : 'link');
  const [link, setLink] = useState(initialLink ?? '');
  const [stage, setStage] = useState<ImportStage>('link');
  const [form, setForm] = useState<Form>(editing ? fromPerfume(editing) : EMPTY);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkDuplicate, setLinkDuplicate] = useState<Perfume | null>(null);
  /** O site do link não deixou ler: o texto da etapa diz que a busca seguiu por outras fontes. */
  const [blocked, setBlocked] = useState(false);
  const [identityText, setIdentityText] = useState('');
  /** A pessoa recusou a prévia ("não é este") — outra frase, mesma pergunta. */
  const [rejected, setRejected] = useState(false);
  /** Pergunta "qual versão?" do servidor, e a identidade que estava valendo quando ela veio. */
  const [question, setQuestion] = useState<VariantQuestion | null>(null);
  const lastIdentity = useRef<IdentityHint | null>(null);
  const cancelled = useRef(false);
  const titleId = useId();
  const fileId = useId();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    d.showModal();
    if (!editing) linkInput.current?.focus();
    return () => d.close();
  }, [editing]);

  // Veio do link do claude.ai com o endereço já colado: a intenção é clara, a pesquisa começa sozinha.
  const autostarted = useRef(false);
  useEffect(() => {
    if (!initialLink || autostarted.current || !repo.canReadLinks) return;
    autostarted.current = true;
    void analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLink]);

  // Pré-visualização: a galáxia já veste a cor do frasco detectado.
  useEffect(() => {
    if (form.media?.dominantColor) accent.setTarget(accentFor(form.media.dominantColor));
  }, [form.media?.dominantColor]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const duplicate = (() => {
    if (!form.name.trim()) return null;
    const found = findDuplicate(
      perfumes.filter((p) => p.id !== editing?.id),
      { sourceUrl: safeHttpUrl(form.sourceUrl), brand: form.brand.trim() || null, name: form.name.trim() },
    );
    return found;
  })();

  /** Link (e, quando o sistema pediu, "qual perfume é este") → servidor resolve o produto. */
  const analyze = async (event?: React.FormEvent, identity: IdentityHint | null = null, variantId: string | null = null) => {
    lastIdentity.current = identity;
    event?.preventDefault();
    setError(null);
    const url = safeHttpUrl(link.trim());
    if (!url) {
      setStep('link');
      setError('Isso não parece um link. Copie o endereço inteiro da página do perfume (começa com https://).');
      return;
    }
    const existing = perfumes.find((p) => urlKey(p.sourceUrl) === urlKey(url));
    if (existing) {
      setStep('link');
      setLinkDuplicate(existing);
      return;
    }
    setLinkDuplicate(null);
    cancelled.current = false;
    setStage('link');
    setBlocked(false);
    setStep('analyzing');
    const started = performance.now();
    try {
      const outcome = await repo.importLink(
        url,
        (s) => {
          if (cancelled.current) return;
          if (s === 'fallback') setBlocked(true);
          // Etapas nunca voltam: a pesquisa interna pode repetir "procurando" depois das fotos.
          setStage((prev) => (stageIndex(s) >= stageIndex(prev) ? s : prev));
        },
        identity,
        variantId,
      );
      // Um instante mínimo na tela de análise: sem ele, o texto pisca e parece erro.
      await new Promise((r) => setTimeout(r, Math.max(0, 900 - (performance.now() - started))));
      if (cancelled.current) return;
      if (outcome.ok === 'choose') {
        // Mais de uma versão: a pessoa escolhe antes de a pesquisa das fotos começar (a foto depende da escolha).
        setQuestion(outcome);
        setStep('variant');
        return;
      }
      if (outcome.ok) {
        const next = fromDraft(outcome.perfume);
        setForm(next);
        setNotice(outcome.notes[0] ?? null);
        const dup = findDuplicate(perfumes, { sourceUrl: safeHttpUrl(next.sourceUrl), brand: next.brand || null, name: next.name });
        // Identidade confirmada por várias fontes e nada repetido: entra direto, sem perguntar nada.
        if (outcome.perfume.confidence === 'high' && !dup && repo.canWrite) {
          setStage('done');
          await save(undefined, next);
          return;
        }
        setStep('preview');
        return;
      }
      if (outcome.code === 'invalid_url') {
        setStep('link');
        setError(outcome.message);
        return;
      }
      if (outcome.code === 'no_reader') {
        // Link do claude.ai: sem internet para pesquisar. Fica o que o endereço diz, e a pessoa completa.
        const g = outcome.guess ?? {};
        setForm({ ...EMPTY, name: g.name ?? '', brand: g.brand ?? '', concentration: g.concentration ?? '', volume: g.volume ?? '', gender: g.gender ?? '', sourceUrl: outcome.sourceUrl ?? url });
        setNotice(outcome.message);
        setStep('review');
        return;
      }
      const g = outcome.guess;
      setIdentityText([g?.brand, g?.name].filter(Boolean).join(' '));
      setRejected(false);
      setStep('unidentified');
    } catch (e) {
      if (cancelled.current) return;
      setStep('link');
      setError(e instanceof FriendlyError ? e.message : 'Não consegui analisar esse link agora. Tente de novo.');
    }
  };

  /** "Não é este" na prévia, ou nada identificado: a pessoa diz qual perfume é, e a pesquisa recomeça. */
  const answerIdentity = (event: React.FormEvent) => {
    event.preventDefault();
    const said = identityText.trim().replace(/s+/g, ' ');
    if (said.length < 3) {
      setError('Escreva a marca e o nome, por exemplo: Afnan Supremacy in Heaven.');
      return;
    }
    void analyze(undefined, { name: said.slice(0, 140) });
  };

  const onPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setError('Essa foto é grande demais (máximo 15 MB).');
      return;
    }
    setError(null);
    setPhotoBusy(true);
    try {
      const media = await repo.uploadPhoto(file);
      setForm((f) => ({ ...f, media, imageCredit: 'foto enviada', imageSource: { origin: 'upload', url: null, pageUrl: null, label: 'foto enviada', score: null }, accentColor: null, accentGlow: null }));
      if (!media.cutout) setNotice('O fundo dessa foto não é liso, então o frasco aparece com o fundo original. Uma foto sobre fundo branco fica melhor.');
    } catch (e) {
      setError(e instanceof FriendlyError ? e.message : 'Não consegui usar essa foto. Tente outra.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const save = async (event?: React.SyntheticEvent, data: Form = form) => {
    event?.preventDefault();
    const form = data;
    setError(null);
    if (!form.name.trim()) {
      setError('Dê um nome ao perfume.');
      return;
    }
    if (form.sourceUrl.trim() && !safeHttpUrl(form.sourceUrl.trim())) {
      setError('O link da loja precisa começar com https://');
      return;
    }
    const duplicate = findDuplicate(perfumes.filter((p) => p.id !== editing?.id), { sourceUrl: safeHttpUrl(form.sourceUrl), brand: form.brand.trim() || null, name: form.name.trim() });
    if (duplicate && !editing) {
      setError(`“${duplicate.name}” já está na sua ${duplicate.status === 'owned' ? 'coleção' : 'wishlist'}.`);
      return;
    }
    const price = form.price.trim() ? parsePrice(form.price, form.currency) : { price: null, currency: null };
    if (form.price.trim() && price.price === null) {
      setError('Não entendi o preço. Use só números, por exemplo 37,50.');
      return;
    }
    const now = new Date().toISOString();
    const base = editing ?? null;
    const perfume = sanitizePerfume({
      ...(base ?? {}),
      id: base?.id ?? newId(`${form.brand} ${form.name}`),
      name: form.name,
      brand: form.brand || null,
      concentration: form.concentration || null,
      volume: form.volume || null,
      price: price.price,
      currency: price.price !== null ? form.currency : null,
      priceNote: form.priceNote || null,
      sourceUrl: form.sourceUrl.trim() || null,
      description: form.description || null,
      gender: form.gender || null,
      imageUrl: form.media?.imageUrl ?? null,
      thumbUrl: form.media?.thumbUrl ?? null,
      masterUrl: form.media?.masterUrl ?? (form.media?.imageUrl === base?.imageUrl ? (base?.masterUrl ?? null) : null),
      dominantColor: form.media && form.media.imageUrl !== base?.imageUrl ? form.media.dominantColor || null : (base?.dominantColor ?? null),
      dominantColorOverride: form.media && form.media.imageUrl !== base?.imageUrl ? null : (base?.dominantColorOverride ?? null),
      imageCredit: form.imageCredit,
      imageSource: form.imageSource,
      olfactoryProfile: form.olfactoryProfile,
      accentColor: form.accentColor,
      accentGlow: form.accentGlow,
      fieldSources: form.fieldSources,
      variants: form.variants,
      selectedVariantId: form.selectedVariantId,
      variantUrl: form.variantUrl,
      assetVersion: form.imageSource && form.imageSource.origin !== 'upload' ? ASSET_VERSION : (base?.assetVersion ?? ASSET_VERSION),
      status: base?.status ?? 'wishlist',
      origin: base?.origin ?? (form.sourceUrl.trim() ? 'url-import' : 'manual'),
      order: base?.order ?? Math.max(0, ...perfumes.map((p) => p.order)) + 10,
      createdAt: base?.createdAt ?? now,
      updatedAt: now,
    });
    if (!perfume) {
      setError('Confira os dados: o perfume precisa de um nome.');
      return;
    }
    setSaving(true);
    try {
      await repo.save(perfume);
      onSaved(perfume, !editing);
    } catch (e) {
      setError(e instanceof FriendlyError ? e.message : 'Não consegui salvar agora. Tente de novo.');
      setSaving(false);
      if (step === 'analyzing') setStep('preview');
    }
  };

  const close = () => {
    cancelled.current = true;
    onClose();
  };

  const title = editing ? 'Editar perfume' : 'Adicionar perfume';

  return (
    <dialog
      ref={dialog}
      className={`sheet sheet--${step}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onPointerDown={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="sheet__inner">
        <header className="sheet__head">
          <h2 id={titleId} className="sheet__title">
            {title}
          </h2>
          <button type="button" className="icon-link" onClick={close} aria-label="Fechar">
            <X size={18} strokeWidth={1.4} aria-hidden="true" />
          </button>
        </header>

        {step === 'link' && (
          <form className="sheet__body" onSubmit={analyze} noValidate>
            <label className="field field--hero">
              <span className="field__label">Cole o link do perfume</span>
              <span className="field__control">
                <Link2 size={16} strokeWidth={1.4} aria-hidden="true" />
                <input
                  ref={linkInput}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://"
                  value={link}
                  onChange={(e) => (setLink(e.target.value), setLinkDuplicate(null), setError(null))}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${titleId}-err` : repo.canReadLinks ? undefined : `${titleId}-hint`}
                />
              </span>
            </label>
            {!repo.canReadLinks && (
              <p className="sheet__hint" id={`${titleId}-hint`}>
                Esta página não tem acesso à internet: aqui eu só leio o que o próprio endereço diz. A pesquisa completa (foto, versão, notas) é feita pelo app do computador.{' '}
                {safeHttpUrl(link.trim()) && (
                  <a className="inline-link" href={`http://localhost:3100/#add=${encodeURIComponent(link.trim())}`} target="_blank" rel="noopener noreferrer">
                    Pesquisar no app do computador
                  </a>
                )}
              </p>
            )}
            {error && (
              <p className="sheet__error" id={`${titleId}-err`} role="alert">
                {error}
              </p>
            )}
            {linkDuplicate && (
              <p className="sheet__notice" role="alert">
                Esse link já é de “{linkDuplicate.name}”, na sua {linkDuplicate.status === 'owned' ? 'coleção' : 'wishlist'}.{' '}
                <button type="button" className="inline-link" onClick={() => onShow(linkDuplicate)}>
                  Ver
                </button>
              </p>
            )}
            <div className="sheet__actions sheet__actions--full">
              <button type="submit" className="primary primary--wide" disabled={!link.trim()}>
                Adicionar perfume
              </button>
            </div>
          </form>
        )}

        {step === 'analyzing' && (
          <div className="sheet__body analyzing" aria-live="polite">
            <div className="analyzing__scan" aria-hidden="true">
              <Silhouette />
              <span className="analyzing__beam" />
            </div>
            <p className="analyzing__text" key={blocked && stageIndex(stage) <= 2 ? 'fallback' : stage}>
              {blocked && stageIndex(stage) <= 2 ? FALLBACK_TEXT : `${STAGES[Math.max(0, stageIndex(stage))].text}…`}
            </p>
            <ol className="analyzing__steps" aria-hidden="true">
              {STAGES.map((s, i) => (
                <li key={s.text} className={i < stageIndex(stage) ? 'is-done' : i === stageIndex(stage) ? 'is-now' : ''} />
              ))}
            </ol>
            <button type="button" className="text-button" onClick={() => ((cancelled.current = true), setStep('link'))}>
              Cancelar
            </button>
          </div>
        )}

        {step === 'variant' && question && (
          <div className="sheet__body">
            <VariantPicker
              question={question}
              confirmLabel="Adicionar"
              onConfirm={(id) => void analyze(undefined, lastIdentity.current, id)}
              onCancel={() => (setQuestion(null), setStep('link'))}
            />
          </div>
        )}

        {step === 'unidentified' && (
          <form className="sheet__body unidentified" onSubmit={answerIdentity} noValidate>
            <p className="unidentified__lead" role="alert">
              {rejected ? 'Então me diga qual é — eu pesquiso de novo a partir do nome.' : 'Não conseguimos identificar este perfume com segurança.'}
            </p>
            <label className="field">
              <span className="field__label">Qual perfume é este?</span>
              <input
                value={identityText}
                onChange={(e) => (setIdentityText(e.target.value), setError(null))}
                placeholder="Marca e nome — ex.: Afnan Supremacy in Heaven"
                maxLength={140}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={error ? `${titleId}-err` : undefined}
              />
            </label>
            {error && (
              <p className="sheet__error" id={`${titleId}-err`} role="alert">
                {error}
              </p>
            )}
            <div className="sheet__actions">
              <button type="button" className="text-button" onClick={() => void analyze()}>
                <RotateCcw size={14} strokeWidth={1.4} aria-hidden="true" /> Tentar novamente
              </button>
              <button type="submit" className="primary" disabled={identityText.trim().length < 3}>
                Pesquisar este
              </button>
            </div>
          </form>
        )}

        {step === 'preview' && (
          <div className="sheet__body preview">
            <div className="preview__bottle">
              {form.media ? <img src={assetRef(form.media.imageUrl)} alt={`Frasco de ${form.name}`} /> : <Silhouette />}
            </div>
            <div className="preview__info">
              <p className="preview__ask">É este o perfume?</p>
              <h3 className="preview__name">{form.name}</h3>
              <Separated className="preview__meta">
                {[form.brand, form.concentration, form.volume, genderLabel(form.gender || null)].filter(Boolean).map((m, i) => (
                  <span key={i}>{m}</span>
                ))}
              </Separated>
              {form.price && <p className="preview__price num">{formatPrice({ price: Number(form.price.replace(',', '.')), currency: form.currency })}</p>}
              {form.olfactoryProfile && (form.olfactoryProfile.topNotes.length > 0 || form.olfactoryProfile.notes.length > 0) ? (
                <dl className="preview__notes">
                  {(
                    [
                      ['Saída', form.olfactoryProfile.topNotes],
                      ['Coração', form.olfactoryProfile.heartNotes],
                      ['Fundo', form.olfactoryProfile.baseNotes],
                      ['Notas', form.olfactoryProfile.notes],
                    ] as const
                  )
                    .filter(([, n]) => n.length)
                    .map(([k, n]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{n.map(noteLabel).join(' · ')}</dd>
                      </div>
                    ))}
                </dl>
              ) : (
                <p className="preview__missing">Perfil olfativo: não encontrei numa fonte confiável.</p>
              )}
              {form.imageSource?.label && <p className="preview__credit">Foto: {form.imageSource.label}</p>}
              {notice && <p className="sheet__notice">{notice}</p>}
              {duplicate && (
                <p className="sheet__notice">
                  “{duplicate.name}” já está na sua {duplicate.status === 'owned' ? 'coleção' : 'wishlist'}.{' '}
                  <button type="button" className="inline-link" onClick={() => onShow(duplicate)}>
                    Ver
                  </button>
                </p>
              )}
              {error && (
                <p className="sheet__error" role="alert">
                  {error}
                </p>
              )}
              <div className="sheet__actions">
                <button type="button" className="text-button" onClick={() => (setIdentityText(''), setError(null), setRejected(true), setStep('unidentified'))}>
                  Não é este
                </button>
                <button type="button" className="text-button" onClick={() => setStep('review')}>
                  Corrigir dados
                </button>
                <button type="button" className="primary" disabled={saving || Boolean(duplicate)} onClick={(e) => void save(e)}>
                  {saving ? 'Guardando…' : 'Adicionar à wishlist'}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'review' && (
          <form className="sheet__body review" onSubmit={save} noValidate>
            <div className="review__bottle">
              <div className="review__art">
                {form.media ? <img src={assetRef(form.media.imageUrl)} alt={`Foto do frasco de ${form.name || 'perfume'}`} /> : <Silhouette />}
                {photoBusy && (
                  <span className="review__busy">
                    <LoaderCircle size={18} strokeWidth={1.4} className="spin" aria-hidden="true" /> Recortando o frasco…
                  </span>
                )}
              </div>
              {repo.canWrite && (
                <label className="text-button review__photo" htmlFor={fileId}>
                  <ImageUp size={15} strokeWidth={1.4} aria-hidden="true" />
                  {form.media ? 'Trocar foto' : 'Enviar foto do frasco'}
                </label>
              )}
              <input id={fileId} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={onPhoto} disabled={photoBusy} />
            </div>

            <div className="review__fields">
              {notice && <p className="sheet__notice">{notice}</p>}
              <label className="field">
                <span className="field__label">Nome</span>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={140} autoComplete="off" />
              </label>
              <label className="field">
                <span className="field__label">Marca</span>
                <input value={form.brand} onChange={(e) => set('brand', e.target.value)} maxLength={80} autoComplete="off" />
              </label>
              <div className="field-row">
                <label className="field">
                  <span className="field__label">Concentração</span>
                  <input value={form.concentration} onChange={(e) => set('concentration', e.target.value)} list="concentrations" maxLength={40} autoComplete="off" />
                </label>
                <label className="field field--narrow">
                  <span className="field__label">Volume</span>
                  <input value={form.volume} onChange={(e) => set('volume', e.target.value)} maxLength={30} placeholder="ex.: 100 ml" autoComplete="off" />
                </label>
              </div>
              <div className="field-row">
                <label className="field">
                  <span className="field__label">Preço</span>
                  <input value={form.price} onChange={(e) => set('price', e.target.value)} inputMode="decimal" placeholder="ex.: 37,50" autoComplete="off" />
                </label>
                <label className="field field--narrow">
                  <span className="field__label">Moeda</span>
                  <select value={form.currency} onChange={(e) => set('currency', e.target.value)}>
                    <option value="EUR">€ EUR</option>
                    <option value="BRL">R$ BRL</option>
                    <option value="GBP">£ GBP</option>
                    <option value="USD">$ USD</option>
                  </select>
                </label>
              </div>
              <label className="field">
                <span className="field__label">Link da loja</span>
                <span className="field__control">
                  <input value={form.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} type="url" inputMode="url" spellCheck={false} autoComplete="off" placeholder="https://…" />
                  {safeHttpUrl(form.sourceUrl) && (
                    <a className="icon-link" href={safeHttpUrl(form.sourceUrl)!} target="_blank" rel="noopener noreferrer" aria-label="Abrir o link">
                      <ArrowUpRight size={16} strokeWidth={1.4} aria-hidden="true" />
                    </a>
                  )}
                </span>
              </label>
              <datalist id="concentrations">
                {['Extrait de Parfum', 'Eau de Parfum', 'Parfum', 'Eau de Toilette', 'Eau de Cologne', 'Elixir'].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>

              {duplicate && !editing && (
                <p className="sheet__notice">
                  “{duplicate.name}” já está na sua {duplicate.status === 'owned' ? 'coleção' : 'wishlist'}.{' '}
                  <button type="button" className="inline-link" onClick={() => onShow(duplicate)}>
                    Ver
                  </button>
                </p>
              )}
              {error && (
                <p className="sheet__error" role="alert">
                  {error}
                </p>
              )}
              <div className="sheet__actions">
                {!editing && (
                  <button type="button" className="text-button" onClick={() => setStep('link')}>
                    Voltar
                  </button>
                )}
                <button type="submit" className="primary" disabled={saving || photoBusy || Boolean(duplicate && !editing)}>
                  {saving ? 'Guardando…' : editing ? 'Salvar' : 'Adicionar à wishlist'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}

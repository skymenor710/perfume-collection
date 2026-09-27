import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { effectiveColor, ratingLabel, RATINGS, type Perfume, type PersonalRating } from './core/perfume';
import { detectRepository, FriendlyError, pair, type Repository, type VariantQuestion } from './data/repository';
import { VariantDialog } from './components/VariantPicker';
import { accent, accentFor, SILVER } from './design/accent';
import { AddPerfume } from './components/AddPerfume';
import { EmptyState, RosterNav, Toast, TopBar, VerdictFilter, type Filter, type ToastData, type View } from './components/Chrome';
import { GalaxyCanvas } from './components/GalaxyCanvas';
import { Nameplate } from './components/Nameplate';
import { OlfactoryPanel } from './components/OlfactoryPanel';
import { Stage } from './components/Stage';

type Boot = { state: 'loading' } | { state: 'pairing' } | { state: 'offline' } | { state: 'ready'; repo: Repository };
type Sheet = null | { editing: Perfume | null; initialLink?: string | null };

const VIEW_KEY = 'perfume-collection.view';

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'owned' ? 'owned' : 'wishlist';
  } catch {
    return 'wishlist';
  }
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  const [perfumes, setPerfumes] = useState<Perfume[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setViewState] = useState<View>(readView);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Record<View, string | null>>({ wishlist: null, owned: null });
  const [inspect, setInspect] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [departingId, setDepartingId] = useState<string | null>(null);
  const [arrivingId, setArrivingId] = useState<string | null>(null);
  const [pulseOwned, setPulseOwned] = useState(false);
  const toastId = useRef(0);
  /** Removidos que ainda podem ser desfeitos: somem da tela já, saem do armazenamento quando o aviso expira. */
  const [pendingRemoval, setPendingRemoval] = useState<Record<string, Perfume>>({});

  const notify = useCallback((message: string, extra: Partial<ToastData> = {}) => setToast({ id: ++toastId.current, message, ...extra }), []);

  useEffect(() => {
    let cancelled = false;
    void detectRepository().then((d) => {
      if (cancelled) return;
      setBoot('pairing' in d ? { state: 'pairing' } : 'offline' in d ? { state: 'offline' } : { state: 'ready', repo: d.repo });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const repo = boot.state === 'ready' ? boot.repo : null;
  /** Página pública: de quem é (depois que a lista chega). */
  const publicOwner = perfumes !== null ? (repo?.owner?.() ?? null) : null;

  // "#add=<link>": o link do claude.ai (sem internet) entrega o endereço para o app do computador pesquisar.
  useEffect(() => {
    if (!repo?.canReadLinks) return;
    const m = /^#add=(.+)$/.exec(window.location.hash);
    if (!m) return;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    try {
      setSheet({ editing: null, initialLink: decodeURIComponent(m[1]) });
    } catch {
      /* endereço malformado: abre normal */
    }
  }, [repo]);

  useEffect(() => {
    if (!repo) return;
    let first = true;
    return repo.subscribe(
      (list) => {
        setPerfumes(list);
        setLoadError(null);
        // Página pública de uma lista (/username/collection): abre nela.
        const owner = repo.owner?.();
        if (first && owner?.focus === 'collection') setView('owned');
        first = false;
      },
      (message) => setLoadError(message),
    );
  }, [repo]);

  const setView = useCallback((v: View) => {
    setViewState(v);
    setInspect(false);
    setToast(null);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* só conveniência */
    }
  }, []);

  // A lista que vem do armazenamento (e de outros aparelhos) ainda tem os removidos em espera: ficam de fora.
  const all = useMemo(() => (perfumes ?? []).filter((p) => !pendingRemoval[p.id]), [perfumes, pendingRemoval]);
  const counts = useMemo(() => ({ wishlist: all.filter((p) => p.status === 'wishlist').length, owned: all.filter((p) => p.status === 'owned').length }), [all]);
  const owned = useMemo(() => all.filter((p) => p.status === 'owned'), [all]);
  const filterCounts = useMemo(() => {
    const c = { all: owned.length } as Record<Filter, number>;
    for (const r of RATINGS) c[r.id] = owned.filter((p) => p.personalRating === r.id).length;
    return c;
  }, [owned]);

  const list = useMemo(() => {
    if (view === 'wishlist') return all.filter((p) => p.status === 'wishlist');
    return filter === 'all' ? owned : owned.filter((p) => p.personalRating === filter);
  }, [all, owned, view, filter]);

  const selectedId = selected[view];
  const index = Math.max(0, list.findIndex((p) => p.id === selectedId));
  const current = list[index] ?? null;

  const onIndexChange = useCallback((i: number) => {
    setSelected((s) => {
      const id = listRef.current[i]?.id ?? null;
      return s[viewRef.current] === id ? s : { ...s, [viewRef.current]: id };
    });
  }, []);
  const listRef = useRef(list);
  const viewRef = useRef(view);
  listRef.current = list;
  viewRef.current = view;

  // Sem frascos no palco, a atmosfera volta ao prata.
  useEffect(() => {
    if (perfumes && list.length === 0) accent.setTarget(SILVER);
  }, [perfumes, list.length]);

  // Pedido de navegação explícito: muda a seleção e avisa o palco (ecos do próprio carrossel não passam por aqui).
  const [request, setRequest] = useState(0);
  const select = (v: View, id: string) => {
    setSelected((s) => ({ ...s, [v]: id }));
    setRequest((n) => n + 1);
  };
  const move = (i: number) => {
    const p = list[Math.max(0, Math.min(list.length - 1, i))];
    if (p) select(view, p.id);
  };

  const write = useCallback(
    async (next: Perfume, previous: Perfume | null) => {
      if (!repo) return;
      setPerfumes((l) => (l ? [...l.filter((p) => p.id !== next.id), next].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)) : l));
      try {
        await repo.save(next);
      } catch (e) {
        if (previous) setPerfumes((l) => (l ? l.map((p) => (p.id === previous.id ? previous : p)) : l));
        notify(e instanceof FriendlyError ? e.message : 'Não consegui salvar agora. Tente de novo.', { tone: 'error' });
      }
    },
    [repo, notify],
  );

  const markOwned = (p: Perfume) => {
    setInspect(false);
    setDepartingId(p.id);
    const neighbor = list[index + 1] ?? list[index - 1] ?? null;
    window.setTimeout(() => setPulseOwned(true), 380);
    window.setTimeout(() => {
      setDepartingId(null);
      if (neighbor) select('wishlist', neighbor.id);
      select('owned', p.id);
      void write({ ...p, status: 'owned', acquiredAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, p);
      notify(`${p.name} está na sua coleção.`, { action: { label: 'Ver', onClick: () => (setFilter('all'), setView('owned')) } });
    }, 720);
    window.setTimeout(() => setPulseOwned(false), 1600);
  };

  const rate = (p: Perfume, rating: PersonalRating | null) => {
    // Com filtro ativo, o perfume acompanha o próprio veredito em vez de sumir do palco.
    if (filter !== 'all' && rating !== filter) setFilter(rating ?? 'all');
    void write({ ...p, personalRating: rating, updatedAt: new Date().toISOString() }, p);
  };

  const backToWishlist = (p: Perfume) => {
    const neighbor = list[index + 1] ?? list[index - 1] ?? null;
    if (neighbor) select('owned', neighbor.id);
    select('wishlist', p.id);
    void write({ ...p, status: 'wishlist', personalRating: null, acquiredAt: null, updatedAt: new Date().toISOString() }, p);
    notify(`${p.name} voltou para a wishlist.`, { action: { label: 'Ver', onClick: () => setView('wishlist') } });
  };

  /** Remoção de verdade — só quando o "Desfazer" não foi usado. */
  const commitRemoval = useCallback(
    async (p: Perfume) => {
      if (!repo) return;
      try {
        await repo.remove(p);
        setPerfumes((l) => (l ? l.filter((x) => x.id !== p.id) : l));
      } catch (e) {
        notify(e instanceof FriendlyError ? e.message : 'Não consegui remover agora — o perfume continua na lista.', { tone: 'error' });
      } finally {
        setPendingRemoval(({ [p.id]: _, ...rest }) => rest);
      }
    },
    [repo, notify],
  );

  const remove = (p: Perfume) => {
    if (!repo) return;
    setDepartingId(p.id);
    const neighbor = list[index + 1] ?? list[index - 1] ?? null;
    window.setTimeout(() => {
      setDepartingId(null);
      if (neighbor) select(view, neighbor.id);
      setPendingRemoval((r) => ({ ...r, [p.id]: p }));
      notify(`${p.name} foi removido.`, {
        action: {
          label: 'Desfazer',
          onClick: () => {
            setPendingRemoval(({ [p.id]: _, ...rest }) => rest);
            select(view, p.id);
          },
        },
        onExpire: () => void commitRemoval(p),
      });
    }, 520);
  };

  // Fechar a página no meio do "Desfazer" confirma a remoção (a intenção era remover). Só ao sair de verdade:
  // trocar de aba não pode apagar enquanto o botão ainda está na tela.
  useEffect(() => {
    const flush = () => {
      for (const p of Object.values(pendingRemoval)) void commitRemoval(p);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [pendingRemoval, commitRemoval]);

  const [refreshing, setRefreshing] = useState<string | null>(null);
  const REFRESH_TEXT: Record<string, string> = {
    link: 'Identificando perfume…',
    identity: 'Analisando o link…',
    fallback: 'Buscando o produto em outras fontes…',
    search: 'Pesquisando o produto…',
    compare: 'Comparando fontes…',
    images: 'Encontrando a melhor imagem…',
    bottle: 'Preparando o frasco…',
    notes: 'Analisando o perfil olfativo…',
    final: 'Finalizando…',
    done: 'Finalizando…',
  };
  /** Pergunta "qual versão?" para um perfume da coleção (itens com 50/100 ml sem escolha, ou "trocar versão"). */
  const [variantAsk, setVariantAsk] = useState<{ perfume: Perfume; question: VariantQuestion } | null>(null);
  const refreshPerfume = async (p: Perfume, variantId: string | null = null) => {
    if (!repo?.refresh) return;
    setRefreshing('Identificando perfume…');
    try {
      const result = await repo.refresh(p, (s) => setRefreshing(REFRESH_TEXT[s] ?? 'Pesquisando…'), variantId);
      if ('choose' in result) {
        setVariantAsk({ perfume: p, question: result.choose });
        return;
      }
      const updated = result.perfume;
      setPerfumes((l) => (l ? l.map((x) => (x.id === updated.id ? updated : x)) : l));
      accent.setTarget(accentFor(effectiveColor(updated)));
      notify(
        variantId && updated.volume
          ? `${updated.name} agora é o de ${updated.volume}.`
          : updated.olfactoryProfile
            ? 'Foto e perfil olfativo atualizados.'
            : 'Foto atualizada; o perfil olfativo ainda não foi encontrado.',
      );
    } catch (e) {
      notify(e instanceof FriendlyError ? e.message : 'Não consegui pesquisar agora.', { tone: 'error' });
    } finally {
      setRefreshing(null);
    }
  };

  const closeSheet = useCallback(() => {
    setSheet(null);
    // A pré-visualização tingiu a galáxia; devolve a cor do frasco em foco.
    accent.setTarget(current ? accentFor(effectiveColor(current)) : SILVER);
  }, [current]);

  const onSaved = (p: Perfume, isNew: boolean) => {
    setSheet(null);
    setPerfumes((l) => (l ? [...l.filter((x) => x.id !== p.id), p] : [p]));
    if (isNew) {
      setFilter('all');
      setView('wishlist');
      select('wishlist', p.id);
      setArrivingId(p.id);
      window.setTimeout(() => setArrivingId(null), 1400);
      notify(`${p.name} entrou na wishlist.`);
    } else {
      notify('Alterações salvas.');
    }
    accent.setTarget(accentFor(effectiveColor(p)));
  };

  const onShow = (p: Perfume) => {
    setSheet(null);
    setFilter('all');
    setView(p.status === 'owned' ? 'owned' : 'wishlist');
    select(p.status === 'owned' ? 'owned' : 'wishlist', p.id);
  };

  const dismissToast = useCallback(() => setToast(null), []);

  if (boot.state === 'pairing') return <Pairing onPaired={() => window.location.reload()} />;

  const ready = repo !== null && perfumes !== null;
  const canWrite = repo?.canWrite ?? false;
  const stageLabel = view === 'wishlist' ? 'Wishlist' : `Coleção${filter !== 'all' ? `, filtrada por ${ratingLabel(filter)}` : ''}`;

  return (
    <div className={`app app--${view}${inspect ? ' is-inspecting' : ''}${sheet ? ' has-sheet' : ''}`}>
      <GalaxyCanvas />
      <TopBar title={publicOwner ? publicOwner.displayName : undefined} view={view} counts={counts} onView={setView} onAdd={() => (setInspect(false), setSheet({ editing: null }))} canWrite={canWrite} pulseOwned={pulseOwned} />

      {view === 'owned' && owned.length > 0 && <VerdictFilter value={filter} counts={filterCounts} onChange={(f) => (setFilter(f), setInspect(false), setToast(null))} />}

      <main id="palco" className="main" role="tabpanel" aria-label={stageLabel}>
        {!ready && !loadError && boot.state !== 'offline' && (
          <p className="booting" role="status">
            Abrindo a coleção
          </p>
        )}
        {boot.state === 'offline' && (
          <EmptyState
            title="O app do computador não respondeu."
            body="A coleção mora no computador. Confira se o Meus Perfumes está aberto nele e tente de novo."
            action={{ label: 'Tentar de novo', onClick: () => window.location.reload() }}
          />
        )}
        {loadError && <EmptyState title="A coleção não abriu." body={loadError} action={{ label: 'Tentar de novo', onClick: () => window.location.reload() }} />}
        {ready && list.length > 0 && (
          <Stage
            perfumes={list}
            index={index}
            onIndexChange={onIndexChange}
            inspect={inspect}
            onInspectChange={setInspect}
            departingId={departingId}
            arrivingId={arrivingId}
            label={stageLabel}
            paused={sheet !== null}
            request={request}
          />
        )}
        {ready && list.length === 0 && !loadError && publicOwner && !publicOwner.lists.includes(view === 'owned' ? 'collection' : 'wishlist') && (
          <EmptyState title={view === 'owned' ? 'Esta coleção não é pública.' : 'Esta wishlist não é pública.'} body={`${publicOwner.displayName} ainda não abriu esta lista.`} />
        )}
        {ready && list.length === 0 && !loadError && !(publicOwner && !publicOwner.lists.includes(view === 'owned' ? 'collection' : 'wishlist')) && <Empty view={view} filter={filter} canWrite={canWrite} onAdd={() => setSheet({ editing: null })} onAll={() => setFilter('all')} onWishlist={() => setView('wishlist')} />}
      </main>

      {ready && current && (
        <div className="hud">
          <Nameplate
            perfume={current}
            canWrite={canWrite}
            onMarkOwned={() => markOwned(current)}
            onRate={(r) => rate(current, r)}
            onEdit={() => (setInspect(false), setSheet({ editing: current }))}
            onOpenProfile={() => setInspect(true)}
            onBackToWishlist={() => backToWishlist(current)}
            onRemove={() => remove(current)}
            onChooseVariant={repo?.refresh && current.brand ? () => void refreshPerfume(current) : undefined}
          />
          {list.length > 1 && <RosterNav index={index} total={list.length} onPrev={() => move(index - 1)} onNext={() => move(index + 1)} />}
        </div>
      )}

      {inspect && (
        <p className="inspect-hint" aria-live="polite">
          <span>Arraste para inclinar</span>
          <span>Pinça ou roda para aproximar</span>
          <span>Toque fora ou Esc para voltar</span>
        </p>
      )}

      {inspect && current && (
        <OlfactoryPanel
          perfume={current}
          onClose={() => setInspect(false)}
          onRefresh={repo?.refresh && canWrite && current.brand ? () => void refreshPerfume(current) : undefined}
          refreshing={refreshing}
        />
      )}

      {sheet && repo && <AddPerfume repo={repo} perfumes={all} editing={sheet.editing} initialLink={sheet.initialLink ?? null} onClose={closeSheet} onSaved={onSaved} onShow={onShow} />}
      {variantAsk && (
        <VariantDialog
          question={variantAsk.question}
          busy={refreshing !== null}
          onClose={() => setVariantAsk(null)}
          onConfirm={(id) => {
            const p = variantAsk.perfume;
            setVariantAsk(null);
            void refreshPerfume(p, id);
          }}
        />
      )}
      <Toast toast={toast} onDone={dismissToast} />
    </div>
  );
}

function Empty({ view, filter, canWrite, onAdd, onAll, onWishlist }: { view: View; filter: Filter; canWrite: boolean; onAdd: () => void; onAll: () => void; onWishlist: () => void }) {
  if (view === 'wishlist') {
    return <EmptyState title="Nenhum desejo por aqui." body="Cole o link de um perfume e ele aparece neste palco." action={canWrite ? { label: 'Adicionar perfume', onClick: onAdd } : undefined} />;
  }
  if (filter !== 'all') {
    return <EmptyState title="Nenhum perfume com esse veredito." body={`Ainda não há perfumes marcados como “${ratingLabel(filter)}”.`} action={{ label: 'Ver todos', onClick: onAll }} />;
  }
  return <EmptyState title="Sua coleção começa com uma compra." body="Na Wishlist, toque em “Comprei” e o frasco vem para cá — pronto para o seu veredito." action={{ label: 'Ir para a Wishlist', onClick: onWishlist }} />;
}

function Pairing({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="app">
      <GalaxyCanvas />
      <form
        className="pairing"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await pair(code);
            onPaired();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Código incorreto.');
            setBusy(false);
          }
        }}
      >
        <h1 className="pairing__title">Meus perfumes</h1>
        <p className="pairing__body">Digite o código de acesso que aparece no computador onde a coleção está aberta.</p>
        <label className="field">
          <span className="field__label">Código de acesso</span>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} maxLength={12} required />
        </label>
        {error && (
          <p className="sheet__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy || code.length < 4}>
          {busy ? 'Conferindo…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

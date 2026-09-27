import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { RATINGS, type PersonalRating } from '@perfumes/core/perfume';
import { Silhouette } from './Bottle';

export type View = 'wishlist' | 'owned';
export type Filter = 'all' | PersonalRating;

/** Cabeçalho mínimo: marca, os dois universos e o "+". Nada de barra lateral de painel. */
export function TopBar({
  view,
  counts,
  onView,
  onAdd,
  canWrite,
  pulseOwned,
  title = 'Meus perfumes',
}: {
  view: View;
  counts: { wishlist: number; owned: number };
  onView: (view: View) => void;
  onAdd: () => void;
  canWrite: boolean;
  pulseOwned: boolean;
  /** Nome no canto: "Meus perfumes", ou o nome do dono numa página pública. */
  title?: string;
}) {
  const tabs: { id: View; label: string; count: number }[] = [
    { id: 'wishlist', label: 'Wishlist', count: counts.wishlist },
    { id: 'owned', label: 'Coleção', count: counts.owned },
  ];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (event: React.KeyboardEvent, i: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const next = (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    refs.current[next]?.focus();
    onView(tabs[next].id);
  };
  return (
    <header className="topbar">
      <p className="wordmark" aria-label={title}>
        <span className="wordmark__glyph" aria-hidden="true" />
        {title}
      </p>
      <nav className="tabs" role="tablist" aria-label="Universos">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={view === t.id}
            aria-controls="palco"
            tabIndex={view === t.id ? 0 : -1}
            className={`tab${view === t.id ? ' is-on' : ''}${t.id === 'owned' && pulseOwned ? ' is-pulse' : ''}`}
            onClick={() => onView(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
            <span className="tab__count num">{t.count}</span>
          </button>
        ))}
      </nav>
      {canWrite ? (
        <button type="button" className="add-button" onClick={onAdd}>
          <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
          <span className="add-button__label">Adicionar perfume</span>
        </button>
      ) : (
        <span className="topbar__spacer" />
      )}
    </header>
  );
}

/** Filtro por veredito, dentro do mesmo palco — nunca vira tabela. */
export function VerdictFilter({ value, counts, onChange }: { value: Filter; counts: Record<Filter, number>; onChange: (f: Filter) => void }) {
  const options: { id: Filter; label: string }[] = [{ id: 'all', label: 'Todos' }, ...RATINGS.map((r) => ({ id: r.id as Filter, label: r.label }))];
  const bar = useRef<HTMLDivElement>(null);
  // No celular a barra rola: o filtro ativo (inclusive o que muda sozinho ao trocar o veredito) fica à vista.
  useEffect(() => {
    const on = bar.current?.querySelector<HTMLElement>('.filter.is-on');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    on?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [value]);
  return (
    <div className="filters" role="group" aria-label="Filtrar a coleção por veredito" ref={bar}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`filter${value === o.id ? ' is-on' : ''}`}
          aria-pressed={value === o.id}
          aria-label={`${o.label}: ${counts[o.id]} ${counts[o.id] === 1 ? 'perfume' : 'perfumes'}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
          <span className="filter__count num" aria-hidden="true">
            {counts[o.id]}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Contador 03 / 14 e setas — o teclado e o gesto fazem o mesmo, isto é para quem prefere clicar. */
export function RosterNav({ index, total, onPrev, onNext }: { index: number; total: number; onPrev: () => void; onNext: () => void }) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="roster-nav">
      <button type="button" className="round" onClick={onPrev} disabled={index <= 0} aria-label="Perfume anterior">
        <ChevronLeft size={18} strokeWidth={1.4} aria-hidden="true" />
      </button>
      <p className="roster-nav__count num" aria-live="off">
        <span className="roster-nav__current">{pad(index + 1)}</span>
        <span className="roster-nav__sep" aria-hidden="true">/</span>
        <span>{pad(total)}</span>
        <span className="sr-only"> de {total}</span>
      </p>
      <button type="button" className="round" onClick={onNext} disabled={index >= total - 1} aria-label="Próximo perfume">
        <ChevronRight size={18} strokeWidth={1.4} aria-hidden="true" />
      </button>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="empty">
      <div className="empty__plinth" aria-hidden="true">
        <Silhouette />
      </div>
      <h1 className="empty__title">{title}</h1>
      <p className="empty__body">{body}</p>
      {action && (
        <button type="button" className="text-button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

export interface ToastData {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
  /** Quando o aviso sai sem a ação ter sido usada (tempo, outro aviso por cima): é aqui que um "Desfazer" vira definitivo. */
  onExpire?: () => void;
  tone?: 'default' | 'error';
}

/**
 * Aviso passageiro. Com o ponteiro ou o foco em cima, o tempo para (dá para ler e alcançar a ação com calma);
 * ao sair, recomeça do zero.
 */
export function Toast({ toast, onDone }: { toast: ToastData | null; onDone: () => void }) {
  const [shown, setShown] = useState<ToastData | null>(toast);
  const [held, setHeld] = useState(false);
  const acted = useRef<number | null>(null);
  const current = useRef<ToastData | null>(null);
  useEffect(() => {
    // O aviso anterior saiu (tempo acabou ou outro tomou o lugar) sem a ação: expira. Idempotente — o
    // StrictMode roda este efeito duas vezes com o mesmo aviso e nada acontece na segunda.
    const prev = current.current;
    if (prev && prev.id !== toast?.id && acted.current !== prev.id) prev.onExpire?.();
    current.current = toast;
    if (toast) setShown(toast);
  }, [toast]);
  useEffect(() => {
    if (!toast || held) return;
    const t = window.setTimeout(onDone, toast.action ? 6500 : 3800);
    return () => window.clearTimeout(t);
  }, [toast, held, onDone]);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {shown && (
        <div
          className={`toast${toast ? ' is-in' : ''}${shown.tone === 'error' ? ' is-error' : ''}`}
          key={shown.id}
          onTransitionEnd={() => !toast && setShown(null)}
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
        >
          <span>{shown.message}</span>
          {shown.action && toast && (
            <button type="button" className="toast__action" onClick={() => ((acted.current = shown.id), shown.action?.onClick(), setHeld(false), onDone())}>
              {shown.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

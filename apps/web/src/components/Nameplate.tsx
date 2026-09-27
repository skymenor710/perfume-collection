import { ArrowUpRight, Check, Ellipsis, Layers, Pencil, Ruler, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { formatPrice, genderLabel, needsVariantChoice, purchaseUrl, RATINGS, type Perfume, type PersonalRating } from '@perfumes/core/perfume';
import { Separated } from '../lib/wrap';

interface Props {
  perfume: Perfume;
  canWrite: boolean;
  onMarkOwned: () => void;
  onRate: (rating: PersonalRating | null) => void;
  onEdit: () => void;
  onBackToWishlist: () => void;
  onRemove: () => void;
  onOpenProfile: () => void;
  /** Escolher/trocar a versão (50 ml × 100 ml) — só no computador, onde há pesquisa. */
  onChooseVariant?: () => void;
}

/**
 * Identidade do frasco em foco, como a placa de um personagem: NOME grande e largo, a ficha técnica
 * numa linha só, o preço, o ↗ para a loja — e a única ação que importa naquele universo:
 * na Wishlist, "Comprei"; na Coleção, o veredito.
 */
export function Nameplate({ perfume, canWrite, onMarkOwned, onRate, onEdit, onBackToWishlist, onRemove, onOpenProfile, onChooseVariant }: Props) {
  const link = purchaseUrl(perfume);
  const meta = [perfume.brand, perfume.concentration, perfume.volume, genderLabel(perfume.gender)].filter(Boolean);
  const price = formatPrice(perfume);
  const host = (() => {
    try {
      return link ? new URL(link).hostname.replace(/^www\./, '') : null;
    } catch {
      return null;
    }
  })();

  return (
    <section className="nameplate" aria-live="polite" aria-atomic="false" key={perfume.id}>
      <h1 className="nameplate__name">{perfume.name}</h1>
      {meta.length > 0 && (
        <Separated className="nameplate__meta">
          {meta.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </Separated>
      )}
      <div className="nameplate__row">
        {price && (
          <p className="nameplate__price">
            <span className="num">{price}</span>
            {perfume.priceNote && <span className="nameplate__note">{perfume.priceNote}</span>}
          </p>
        )}
        {link && (
          <a className="icon-link" href={link} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${perfume.name} na loja${host ? ` (${host})` : ''}`} title={host ? `Abrir em ${host}` : 'Abrir na loja'}>
            <ArrowUpRight size={18} strokeWidth={1.4} aria-hidden="true" />
          </a>
        )}
        <button type="button" className="notes-button" onClick={onOpenProfile}>
          <Layers size={15} strokeWidth={1.4} aria-hidden="true" />
          {perfume.olfactoryProfile ? 'Perfil olfativo' : 'Close-up'}
        </button>
        {canWrite && <MoreMenu perfume={perfume} onEdit={onEdit} onBackToWishlist={onBackToWishlist} onRemove={onRemove} onChooseVariant={onChooseVariant} />}
      </div>

      {canWrite && onChooseVariant && needsVariantChoice(perfume) && (
        <p className="nameplate__variant">
          Este perfume tem {perfume.variants.map((v) => v.volume ?? v.label).join(' e ')}.{' '}
          <button type="button" className="inline-link" onClick={onChooseVariant}>
            Escolher versão
          </button>
        </p>
      )}

      {canWrite && perfume.status === 'wishlist' && (
        <button type="button" className="action" onClick={onMarkOwned}>
          <span className="action__mark" aria-hidden="true" />
          Comprei
          <span className="action__hint">mover para a coleção</span>
        </button>
      )}

      {perfume.status === 'owned' && <Verdict value={perfume.personalRating} onChange={canWrite ? onRate : undefined} />}
    </section>
  );
}

/**
 * O veredito pessoal: em repouso, um carimbo — a palavra em caixa larga, na cor do frasco, num quadro fino.
 * As quatro opções só aparecem para escolher (ou trocar). Nunca estrelas.
 */
export function Verdict({ value, onChange }: { value: PersonalRating | null; onChange?: (rating: PersonalRating | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [fresh, setFresh] = useState(false);
  const stampRef = useRef<HTMLButtonElement>(null);
  const label = RATINGS.find((r) => r.id === value)?.label ?? null;

  useEffect(() => {
    if (!fresh) return;
    const t = window.setTimeout(() => setFresh(false), 900);
    return () => window.clearTimeout(t);
  }, [fresh]);

  if (label && !editing) {
    return (
      <div className="verdict">
        <p className="verdict__label">Seu veredito</p>
        <button
          ref={stampRef}
          type="button"
          className={`stamp stamp--${value}${fresh ? ' is-fresh' : ''}`}
          onClick={() => onChange && setEditing(true)}
          disabled={!onChange}
          aria-label={`Seu veredito: ${label}.${onChange ? ' Trocar veredito' : ''}`}
        >
          <span className="stamp__mark" aria-hidden="true" />
          <span className="stamp__word">{label}</span>
          {onChange && <span className="stamp__edit">trocar</span>}
        </button>
      </div>
    );
  }

  return (
    <VerdictPicker
      value={value}
      onChange={(r) => {
        onChange?.(r);
        setEditing(false);
        setFresh(Boolean(r));
      }}
      onCancel={label ? () => setEditing(false) : undefined}
      disabled={!onChange}
    />
  );
}

function VerdictPicker({ value, onChange, onCancel, disabled }: { value: PersonalRating | null; onChange: (rating: PersonalRating | null) => void; onCancel?: () => void; disabled: boolean }) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = RATINGS.findIndex((r) => r.id === value);

  useEffect(() => {
    if (onCancel) refs.current[Math.max(0, current)]?.focus();
  }, [onCancel, current]);

  const choose = (rating: PersonalRating) => onChange(rating === value ? null : rating);

  // Setas dentro do grupo, como num rádio nativo.
  const onKey = (event: React.KeyboardEvent, i: number) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const next = (i + delta + RATINGS.length) % RATINGS.length;
    refs.current[next]?.focus();
  };

  return (
    <div
      className="verdict"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onCancel) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <p className="verdict__label" id={`${id}-label`}>
        {value ? 'Trocar veredito' : 'Qual é o seu veredito?'}
        {onCancel && (
          <button type="button" className="verdict__cancel" onClick={onCancel}>
            manter
          </button>
        )}
      </p>
      <div className="verdict__options" role="radiogroup" aria-labelledby={`${id}-label`} aria-readonly={disabled}>
        {RATINGS.map((r, i) => {
          const on = r.id === value;
          return (
            <button
              key={r.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on || (current === -1 && i === 0) ? 0 : -1}
              className={`verdict__option verdict__option--${r.id}${on ? ' is-on' : ''}`}
              disabled={disabled}
              onClick={() => choose(r.id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              <span className="verdict__mark" aria-hidden="true">
                {on && <Check size={12} strokeWidth={2} />}
              </span>
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MoreMenu({ perfume, onEdit, onBackToWishlist, onRemove, onChooseVariant }: { perfume: Perfume; onEdit: () => void; onBackToWishlist: () => void; onRemove: () => void; onChooseVariant?: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      return;
    }
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') {
          event.stopPropagation();
          setOpen(false);
          wrap.current?.querySelector<HTMLButtonElement>('.icon-link')?.focus();
        }
        return;
      }
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close, true);
    wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close, true);
    };
  }, [open]);

  return (
    <div className="more" ref={wrap}>
      <button type="button" className="icon-link" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} aria-label="Mais opções" title="Mais opções" onClick={() => setOpen((v) => !v)}>
        <Ellipsis size={18} strokeWidth={1.4} aria-hidden="true" />
      </button>
      {open && (
        <div className="more__menu" role="menu" id={menuId}>
          <button type="button" role="menuitem" onClick={() => (setOpen(false), onEdit())}>
            <Pencil size={15} strokeWidth={1.4} aria-hidden="true" /> Editar dados
          </button>
          {onChooseVariant && perfume.variants.length > 1 && (
            <button type="button" role="menuitem" onClick={() => (setOpen(false), onChooseVariant())}>
              <Ruler size={15} strokeWidth={1.4} aria-hidden="true" /> {perfume.selectedVariantId ? 'Trocar versão' : 'Escolher versão'}
            </button>
          )}
          {perfume.status === 'owned' && (
            <button type="button" role="menuitem" onClick={() => (setOpen(false), onBackToWishlist())}>
              <Undo2 size={15} strokeWidth={1.4} aria-hidden="true" /> Voltar para a wishlist
            </button>
          )}
          {!confirming ? (
            <button type="button" role="menuitem" className="is-danger" onClick={() => setConfirming(true)}>
              <Trash2 size={15} strokeWidth={1.4} aria-hidden="true" /> Remover
            </button>
          ) : (
            <button type="button" role="menuitem" className="is-danger is-confirm" onClick={() => (setOpen(false), onRemove())} autoFocus>
              <Trash2 size={15} strokeWidth={1.4} aria-hidden="true" /> Confirmar remoção
            </button>
          )}
        </div>
      )}
    </div>
  );
}

import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { formatPrice } from '@perfumes/core/perfume';
import type { VariantQuestion } from '../data/repository';
import { Silhouette } from './Bottle';

/**
 * "Qual versão?" — quando o mesmo produto tem 50 ml e 100 ml (às vezes frascos diferentes), a pessoa escolhe antes
 * de qualquer coisa entrar na coleção. Cada cartão é UMA variante real: o frasco dela, o tamanho, o preço dela.
 * Grupo de rádio nativo por baixo: setas, Tab e leitor de tela funcionam como em qualquer formulário.
 */
export function VariantPicker({
  question,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  question: VariantQuestion;
  /** "Adicionar" no fluxo de adicionar; "Usar" ao trocar a versão de um perfume que já está na coleção. */
  confirmLabel: 'Adicionar' | 'Usar';
  busy?: boolean;
  onConfirm: (variantId: string) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<string | null>(question.preselectedId);
  const groupId = useId();
  const current = question.variants.find((v) => v.id === chosen) ?? null;

  return (
    <form
      className="variants"
      onSubmit={(e) => {
        e.preventDefault();
        if (chosen) onConfirm(chosen);
      }}
    >
      <p className="variants__ask" id={`${groupId}-ask`}>
        Qual versão você quer?
      </p>
      <h3 className="variants__name">{question.name}</h3>
      <p className="variants__meta">{[question.brand, question.concentration].filter(Boolean).join(' · ')}</p>

      <div className="variants__grid" role="radiogroup" aria-labelledby={`${groupId}-ask`}>
        {question.variants.map((v) => {
          const price = v.price !== null && v.currency ? formatPrice({ price: v.price, currency: v.currency }) : null;
          const inLink = v.id === question.preselectedId;
          return (
            <label key={v.id} className={`variant${chosen === v.id ? ' is-on' : ''}${v.available === false ? ' is-out' : ''}`}>
              <input className="sr-only" type="radio" name={groupId} value={v.id} checked={chosen === v.id} onChange={() => setChosen(v.id)} />
              <span className="variant__art" aria-hidden="true">
                {v.thumb ? <img src={v.thumb} alt="" /> : <Silhouette />}
              </span>
              <span className="variant__size">{v.volume ?? v.label}</span>
              {price && <span className="variant__price num">{price}</span>}
              {v.available === false && <span className="variant__note">Esgotada na loja</span>}
              {inLink && <span className="variant__badge">No seu link</span>}
            </label>
          );
        })}
      </div>

      {question.sourceLabel && <p className="variants__source">Versões e preços de {question.sourceLabel}.</p>}

      <div className="sheet__actions">
        <button type="button" className="text-button" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="primary" disabled={!chosen || busy}>
          {current ? `${confirmLabel} ${current.volume ?? current.label}` : 'Escolha uma versão'}
        </button>
      </div>
    </form>
  );
}

/** A pergunta "qual versão?" para um perfume que já está na coleção (trocar ou escolher a versão). */
export function VariantDialog({ question, busy, onConfirm, onClose }: { question: VariantQuestion; busy: boolean; onConfirm: (variantId: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="sheet sheet--variant"
      aria-labelledby={titleId}
      onCancel={(e) => (e.preventDefault(), onClose())}
      onPointerDown={(e) => e.target === dialog.current && onClose()}
    >
      <div className="sheet__inner">
        <header className="sheet__head">
          <h2 id={titleId} className="sheet__title">
            Escolher versão
          </h2>
          <button type="button" className="icon-link" onClick={onClose} aria-label="Fechar">
            <X size={18} strokeWidth={1.4} aria-hidden="true" />
          </button>
        </header>
        <div className="sheet__body">
          <VariantPicker question={question} confirmLabel="Usar" busy={busy} onConfirm={onConfirm} onCancel={onClose} />
        </div>
      </div>
    </dialog>
  );
}

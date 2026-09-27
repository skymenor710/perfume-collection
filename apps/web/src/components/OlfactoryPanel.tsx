import { ArrowUpRight, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { hasPyramid } from '@perfumes/core/olfactory';
import { accordLabel, noteLabel } from '@perfumes/core/notes-pt';
import { genderLabel, type Perfume } from '@perfumes/core/perfume';
import { Separated } from '../lib/wrap';

interface Props {
  perfume: Perfume;
  onClose: () => void;
  /** Só no computador (servidor): pesquisa de novo fotos e perfil. */
  onRefresh?: () => void;
  refreshing: string | null;
}

const TIERS = [
  { key: 'topNotes', name: 'Saída', hint: 'a primeira impressão' },
  { key: 'heartNotes', name: 'Coração', hint: 'o corpo do perfume' },
  { key: 'baseNotes', name: 'Fundo', hint: 'o que fica na pele' },
] as const;

/**
 * O perfil olfativo no close-up. A pirâmide é tipográfica: três camadas centradas, cada uma sob um fio de luz
 * mais largo que o anterior — a silhueta da pirâmide sai das linhas, não de um desenho. Sem porcentagens:
 * a ordem das notas e dos acordes é a da fonte, e a fonte está citada embaixo.
 */
export function OlfactoryPanel({ perfume, onClose, onRefresh, refreshing }: Props) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const p = perfume.olfactoryProfile;
  const meta = [perfume.brand, perfume.concentration, perfume.volume, genderLabel(perfume.gender)].filter(Boolean);
  const facts = [
    p?.perfumer ? { k: 'Perfumista', v: p.perfumer } : null,
    p?.releaseYear ? { k: 'Lançamento', v: String(p.releaseYear) } : null,
    p?.fragranceFamily ? { k: 'Família', v: p.fragranceFamily } : null,
  ].filter((f): f is { k: string; v: string } => f !== null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [perfume.id]);

  return (
    <aside className="closeup" aria-labelledby={titleId} key={perfume.id}>
      <div className="closeup__scroll">
        <header className="closeup__head">
          <h2 className="closeup__name" id={titleId} tabIndex={-1} ref={heading}>
            {perfume.name}
          </h2>
          {meta.length > 0 && (
            <Separated className="closeup__meta">
              {meta.map((m, i) => (
                <span key={i}>{m}</span>
              ))}
            </Separated>
          )}
          <button type="button" className="icon-link closeup__close" onClick={onClose} aria-label="Fechar o close-up">
            <X size={18} strokeWidth={1.4} aria-hidden="true" />
          </button>
        </header>

        <section className="profile" aria-label="Perfil olfativo">
          <h3 className="profile__label">Perfil olfativo</h3>

          {p && hasPyramid(p) && (
            <ol className="pyramid">
              {TIERS.map((tier, i) => {
                const notes = p[tier.key];
                if (!notes.length) return null;
                return (
                  <li className={`tier tier--${i}`} key={tier.key} style={{ '--i': i } as React.CSSProperties}>
                    <span className="tier__rule" aria-hidden="true" />
                    <p className="tier__head">
                      <span className="tier__name">{tier.name}</span>
                      <span className="tier__hint">{tier.hint}</span>
                    </p>
                    <Separated className="tier__notes">
                      {notes.map((n, j) => (
                        <span className="note" key={j} lang={noteLabel(n) === n ? 'en' : undefined}>
                          {noteLabel(n)}
                        </span>
                      ))}
                    </Separated>
                  </li>
                );
              })}
            </ol>
          )}

          {p && !hasPyramid(p) && p.notes.length > 0 && (
            <ol className="pyramid">
              <li className="tier tier--2" style={{ '--i': 0 } as React.CSSProperties}>
                <span className="tier__rule" aria-hidden="true" />
                <p className="tier__head">
                  <span className="tier__name">Notas</span>
                  <span className="tier__hint">a fonte não separa em camadas</span>
                </p>
                <Separated className="tier__notes">
                  {p.notes.map((n, j) => (
                    <span className="note" key={j}>
                      {noteLabel(n)}
                    </span>
                  ))}
                </Separated>
              </li>
            </ol>
          )}

          {p && p.mainAccords.length > 0 && (
            <p className="accords" style={{ '--i': 3 } as React.CSSProperties}>
              <span className="accords__label">Acordes</span>
              {p.mainAccords.map((a, j) => (
                <span className="accord" key={j}>
                  {accordLabel(a)}
                </span>
              ))}
            </p>
          )}

          {facts.length > 0 && (
            <dl className="facts" style={{ '--i': 4 } as React.CSSProperties}>
              {facts.map((f) => (
                <div key={f.k}>
                  <dt>{f.k}</dt>
                  <dd>{f.v}</dd>
                </div>
              ))}
            </dl>
          )}

          {!p && (
            <div className="profile__empty">
              <p>Ainda não encontrei o perfil olfativo deste perfume numa fonte confiável — prefiro deixar em branco a inventar.</p>
            </div>
          )}

          <footer className="profile__foot">
            {p && p.sources.length > 0 && (
              <p className="sources">
                Fontes:{' '}
                {p.sources.map((s, j) => (
                  <a key={j} href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.name}
                    <ArrowUpRight size={12} strokeWidth={1.5} aria-hidden="true" />
                  </a>
                ))}
              </p>
            )}
            {onRefresh && (
              <button type="button" className="text-button" onClick={onRefresh} disabled={Boolean(refreshing)}>
                {refreshing ? <LoaderCircle size={14} strokeWidth={1.5} className="spin" aria-hidden="true" /> : <RefreshCw size={14} strokeWidth={1.4} aria-hidden="true" />}
                {refreshing ?? 'Pesquisar de novo'}
              </button>
            )}
          </footer>
        </section>
      </div>
    </aside>
  );
}

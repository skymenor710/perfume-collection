import { useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * Listas centradas com separador entre itens ("Armaf • EDP • 55 ml • Unissex") quebram de linha e deixam um
 * "•" solto no começo da linha nova. CSS não sabe onde a linha quebrou; aqui se mede: o item cuja posição
 * vertical passa da do anterior começa uma linha e ganha `data-line-start` — o CSS esconde o separador dele.
 * Remede quando o contêiner muda de tamanho (girar o celular, abrir o close-up) ou quando os itens mudam.
 */
export function useLineStarts<T extends HTMLElement>(deps: unknown[] = []) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mark = () => {
      const items = [...el.children] as HTMLElement[];
      // Primeiro limpa (um separador escondido muda a largura da linha), depois mede.
      for (const item of items) item.removeAttribute('data-line-start');
      let prevTop: number | null = null;
      for (const item of items) {
        const top = item.offsetTop;
        if (prevTop !== null && top > prevTop + 2) item.setAttribute('data-line-start', '');
        prevTop = top;
      }
    };
    mark();
    const observer = new ResizeObserver(mark);
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** Parágrafo de itens separados (<span>s) que não deixa separador no começo de linha. */
export function Separated({ className, children }: { className: string; children: ReactNode }) {
  const ref = useLineStarts<HTMLParagraphElement>([children]);
  return (
    <p className={className} ref={ref}>
      {children}
    </p>
  );
}

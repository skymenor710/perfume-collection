/**
 * Volume estruturado: o texto que a interface mostra ("50 ml", "7,5 ml") vira número em mililitros quando é UM
 * volume inequívoco. Texto que não é um volume só ("50/100 ml" enquanto a pessoa não escolheu a versão, "3.4 oz",
 * "coffret") devolve nulo — o texto original continua guardado ao lado, então nada se perde.
 */
export function volumeMl(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*ml\s*$/i.exec(text);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(',', '.'));
  return n > 0 && n <= 5000 ? n : null;
}

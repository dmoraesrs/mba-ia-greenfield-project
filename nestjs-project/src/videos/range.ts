import { RangeNotSatisfiableException } from '../common/exceptions/domain.exception';

export interface ByteRange {
  start: number;
  end: number;
}

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Interpreta o cabeçalho `Range` para um recurso de `size` bytes. Aceita um
 * único intervalo (`bytes=a-b`, `bytes=a-`, `bytes=-n`); ausência, múltiplos
 * intervalos ou formato malformado devolvem `null` (resposta 200 com o
 * arquivo inteiro). Intervalo que começa além do fim lança
 * `RangeNotSatisfiableException` (416).
 */
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | null {
  if (!header) return null;
  const match = SINGLE_RANGE.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    // Sufixo: os últimos n bytes.
    const suffix = Number(rawEnd);
    if (suffix === 0 || size === 0) {
      throw new RangeNotSatisfiableException(size);
    }
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Number(rawEnd);
  if (start >= size) {
    throw new RangeNotSatisfiableException(size);
  }
  if (end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

export function toRangeHeader({ start, end }: ByteRange): string {
  return `bytes=${start}-${end}`;
}

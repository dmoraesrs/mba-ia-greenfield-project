const UNSAFE_CHARACTERS = new Set(['"', '\\', '/']);
const NON_ASCII = /[^\x20-\x7e]/g;
const FALLBACK_FILENAME = 'video';

/**
 * Monta `Content-Disposition: attachment` para o nome original do arquivo:
 * `filename` em ASCII (compatibilidade) e `filename*` em UTF-8 (RFC 6266),
 * sem aspas, barras e caracteres de controle.
 */
export function attachmentDisposition(filename: string): string {
  const safe = stripUnsafe(filename).trim() || FALLBACK_FILENAME;
  const ascii = safe.replace(NON_ASCII, '_');
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Remove aspas, barras e caracteres de controle (C0 e DEL). */
function stripUnsafe(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f && !UNSAFE_CHARACTERS.has(char);
    })
    .join('');
}

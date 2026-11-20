import { randomBytes } from 'node:crypto';

const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * Identificador público curto e não enumerável: 64 bits aleatórios em base64url
 * (11 caracteres, sem padding).
 */
export function generatePublicId(): string {
  return randomBytes(8).toString('base64url');
}

export function isValidPublicId(value: string): boolean {
  return PUBLIC_ID_PATTERN.test(value);
}

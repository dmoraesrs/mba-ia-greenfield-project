/**
 * O arquivo não é um vídeo reconhecível (falha permanente: não adianta tentar
 * de novo).
 */
export class InvalidVideoFileError extends Error {
  constructor(public readonly detail: string) {
    super(`Invalid video file: ${detail}`);
    this.name = 'InvalidVideoFileError';
  }
}

/** Falha do binário, de rede ou de timeout (transitória: vale retentar). */
export class MediaToolError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'MediaToolError';
  }
}

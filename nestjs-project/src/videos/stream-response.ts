import { Logger } from '@nestjs/common';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import type { StreamResult } from './video-streaming.service';

const logger = new Logger('StreamResponse');

/**
 * Escreve status e cabeçalhos e faz o pipe do corpo do storage para a
 * resposta. Em qualquer interrupção o `pipeline` destrói os dois lados, o que
 * libera o socket do cliente S3 (ex.: o player fecha a conexão num seek).
 */
export async function sendStream(
  res: Response,
  result: StreamResult,
): Promise<void> {
  res.status(result.status).set(result.headers);
  try {
    await pipeline(result.body, res);
  } catch (err) {
    // Com o corpo já em envio não há resposta de erro possível: só registrar.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      logger.warn(
        `Stream interrupted: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

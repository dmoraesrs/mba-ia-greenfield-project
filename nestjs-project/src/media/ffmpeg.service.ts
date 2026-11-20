import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { InvalidVideoFileError, MediaToolError } from './media.errors';

const PROBE_TIMEOUT_MS = 60_000;
const EXTRACT_FRAME_TIMEOUT_MS = 120_000;
const THUMBNAIL_WIDTH = 640;

/** Mensagens do ffmpeg/ffprobe que indicam conteúdo inválido, não falha transitória. */
const INVALID_DATA_PATTERNS = [
  /Invalid data found when processing input/i,
  /moov atom not found/i,
  /could not find codec parameters/i,
];

interface RunResult {
  stdout: Buffer;
  stderr: string;
}

@Injectable()
export class FfmpegService {
  /**
   * Roda `ffprobe` sobre a entrada (arquivo local ou URL pré-assinada) e
   * devolve o JSON bruto de `-show_format -show_streams`.
   */
  async probe(inputUrl: string): Promise<string> {
    const { stdout } = await this.run(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        inputUrl,
      ],
      PROBE_TIMEOUT_MS,
    );
    return stdout.toString('utf8');
  }

  /** Extrai um frame em `atSeconds` como JPEG de 640 px de largura. */
  async extractFrame(inputUrl: string, atSeconds: number): Promise<Buffer> {
    const { stdout } = await this.run(
      'ffmpeg',
      [
        '-v',
        'error',
        '-ss',
        String(atSeconds),
        '-i',
        inputUrl,
        '-frames:v',
        '1',
        '-vf',
        `scale=${THUMBNAIL_WIDTH}:-2`,
        '-f',
        'image2',
        '-c:v',
        'mjpeg',
        'pipe:1',
      ],
      EXTRACT_FRAME_TIMEOUT_MS,
    );
    if (stdout.length === 0) {
      throw new MediaToolError('ffmpeg produced an empty frame');
    }
    return stdout;
  }

  /** `spawn` sem shell: a URL nunca é interpretada como comando. */
  private run(
    command: string,
    args: string[],
    timeoutMs: number,
  ): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new MediaToolError(`${command} could not be started`, err));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const stderrText = Buffer.concat(stderr).toString('utf8').trim();
        if (timedOut) {
          reject(
            new MediaToolError(`${command} timed out after ${timeoutMs}ms`),
          );
          return;
        }
        if (code !== 0) {
          reject(this.classifyFailure(command, code, stderrText));
          return;
        }
        resolve({ stdout: Buffer.concat(stdout), stderr: stderrText });
      });
    });
  }

  private classifyFailure(
    command: string,
    code: number | null,
    stderr: string,
  ): Error {
    const lastLine = stderr.split('\n').pop() ?? '';
    if (INVALID_DATA_PATTERNS.some((pattern) => pattern.test(stderr))) {
      return new InvalidVideoFileError(lastLine || `${command} rejected input`);
    }
    return new MediaToolError(
      `${command} exited with code ${code}: ${lastLine}`,
    );
  }
}

import { spawn } from 'node:child_process';

export interface SampleVideoOptions {
  seconds?: number;
  withAudio?: boolean;
  videoBitrate?: string;
}

/**
 * Gera um vídeo H.264 320x240 a 25 fps com `ffmpeg` (fontes sintéticas
 * `testsrc`/`sine`), opcionalmente com trilha AAC.
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `ffmpeg fixture failed (${code}): ${Buffer.concat(stderr).toString()}`,
          ),
        );
    });
  });
}

/** Extrai um frame JPEG de um vídeo local (thumbnail de teste). */
export async function extractSampleFrame(
  videoPath: string,
  jpegPath: string,
): Promise<void> {
  await runFfmpeg([
    '-v',
    'error',
    '-y',
    '-ss',
    '1',
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-vf',
    'scale=640:-2',
    jpegPath,
  ]);
}

export async function generateSampleVideo(
  path: string,
  { seconds = 2, withAudio = true, videoBitrate }: SampleVideoOptions = {},
): Promise<void> {
  const args = [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x240:rate=25',
  ];
  if (withAudio) {
    args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100');
  }
  args.push('-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p');
  if (videoBitrate) {
    args.push('-b:v', videoBitrate);
  }
  if (withAudio) {
    args.push('-c:a', 'aac');
  }
  args.push(path);

  await runFfmpeg(args);
}

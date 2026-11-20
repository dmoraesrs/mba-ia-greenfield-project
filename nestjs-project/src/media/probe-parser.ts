import type { VideoMetadata } from '../videos/entities/video.entity';
import { InvalidVideoFileError } from './media.errors';

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  duration?: string;
}

interface ProbeFormat {
  format_name?: string;
  duration?: string;
  bit_rate?: string;
  size?: string;
}

interface ProbeOutput {
  streams?: ProbeStream[];
  format?: ProbeFormat;
}

export interface ParsedProbe {
  durationSeconds: number;
  metadata: VideoMetadata;
}

function toPositiveNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Converte a fração `n/d` do ffprobe; `0/0` (desconhecido) vira `null`. */
function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null;
  const [num, den] = value.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return null;
  }
  const rate = num / den;
  return rate > 0 ? Math.round(rate * 1000) / 1000 : null;
}

/**
 * Extrai duração e metadados da saída `ffprobe -print_format json
 * -show_format -show_streams`. Lança `InvalidVideoFileError` quando a saída
 * não descreve um vídeo utilizável.
 */
export function parseProbeOutput(json: string): ParsedProbe {
  let output: ProbeOutput;
  try {
    output = JSON.parse(json) as ProbeOutput;
  } catch {
    throw new InvalidVideoFileError('unrecognized ffprobe output');
  }
  if (typeof output !== 'object' || output === null) {
    throw new InvalidVideoFileError('unrecognized ffprobe output');
  }

  const streams = Array.isArray(output.streams) ? output.streams : [];
  const format = output.format ?? {};
  const video = streams.find((s) => s.codec_type === 'video');
  if (!video || !video.codec_name || !video.width || !video.height) {
    throw new InvalidVideoFileError('no video stream');
  }

  const durationSeconds =
    toPositiveNumber(format.duration) ?? toPositiveNumber(video.duration);
  if (durationSeconds === null) {
    throw new InvalidVideoFileError('no duration');
  }

  const audio = streams.find((s) => s.codec_type === 'audio');
  const bitrate = toPositiveNumber(format.bit_rate);

  return {
    durationSeconds,
    metadata: {
      width: video.width,
      height: video.height,
      video_codec: video.codec_name,
      audio_codec: audio?.codec_name ?? null,
      bitrate: bitrate === null ? null : Math.round(bitrate),
      container: format.format_name ?? 'unknown',
      frame_rate: parseFrameRate(video.avg_frame_rate),
      size_bytes: Math.round(toPositiveNumber(format.size) ?? 0),
    },
  };
}

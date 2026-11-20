import { InvalidVideoFileError } from './media.errors';
import { parseProbeOutput } from './probe-parser';

const videoStream = {
  codec_type: 'video',
  codec_name: 'h264',
  width: 320,
  height: 240,
  avg_frame_rate: '25/1',
  duration: '2.000000',
};

const audioStream = { codec_type: 'audio', codec_name: 'aac' };

const format = {
  format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
  duration: '2.023000',
  bit_rate: '187456',
  size: '47404',
};

const probe = (output: unknown) => JSON.stringify(output);

function omit<T extends object>(source: T, key: keyof T): Partial<T> {
  const copy: Partial<T> = { ...source };
  delete copy[key];
  return copy;
}

describe('parseProbeOutput', () => {
  it('should extract duration and metadata from a video with audio', () => {
    const result = parseProbeOutput(
      probe({ streams: [videoStream, audioStream], format }),
    );

    expect(result).toEqual({
      durationSeconds: 2.023,
      metadata: {
        width: 320,
        height: 240,
        video_codec: 'h264',
        audio_codec: 'aac',
        bitrate: 187456,
        container: 'mov,mp4,m4a,3gp,3g2,mj2',
        frame_rate: 25,
        size_bytes: 47404,
      },
    });
  });

  it('should report a null audio codec when there is no audio track', () => {
    const result = parseProbeOutput(probe({ streams: [videoStream], format }));

    expect(result.metadata.audio_codec).toBeNull();
  });

  it('should convert fractional frame rates and map 0/0 to null', () => {
    const ntsc = parseProbeOutput(
      probe({
        streams: [{ ...videoStream, avg_frame_rate: '30000/1001' }],
        format,
      }),
    );
    const unknown = parseProbeOutput(
      probe({ streams: [{ ...videoStream, avg_frame_rate: '0/0' }], format }),
    );

    expect(ntsc.metadata.frame_rate).toBe(29.97);
    expect(unknown.metadata.frame_rate).toBeNull();
  });

  it('should report a null bitrate when the format has none', () => {
    const withoutBitrate = omit(format, 'bit_rate');

    const result = parseProbeOutput(
      probe({ streams: [videoStream], format: withoutBitrate }),
    );

    expect(result.metadata.bitrate).toBeNull();
  });

  it('should fall back to the video stream duration', () => {
    const withoutDuration = omit(format, 'duration');

    const result = parseProbeOutput(
      probe({ streams: [videoStream], format: withoutDuration }),
    );

    expect(result.durationSeconds).toBe(2);
  });

  it('should reject output without a video stream', () => {
    expect(() =>
      parseProbeOutput(probe({ streams: [audioStream], format })),
    ).toThrow(InvalidVideoFileError);
  });

  it('should reject output without any duration', () => {
    const formatWithoutDuration = omit(format, 'duration');
    const streamWithoutDuration = omit(videoStream, 'duration');

    expect(() =>
      parseProbeOutput(
        probe({
          streams: [streamWithoutDuration],
          format: formatWithoutDuration,
        }),
      ),
    ).toThrow(/no duration/);
  });

  it.each(['not json', '', 'null'])(
    'should reject malformed output %p',
    (raw) => {
      expect(() => parseProbeOutput(raw)).toThrow(InvalidVideoFileError);
    },
  );
});

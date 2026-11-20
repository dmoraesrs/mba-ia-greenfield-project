import { createWorkerTestingModule } from './test/worker-test-module';
import { FfmpegService } from './media/ffmpeg.service';
import { VideoProcessingProcessor } from './videos/processing/video-processing.processor';

describe('WorkerModule', () => {
  it('should compile and resolve the queue processors with the test configs', async () => {
    const module = await createWorkerTestingModule().compile();

    expect(module.get(VideoProcessingProcessor)).toBeInstanceOf(
      VideoProcessingProcessor,
    );
    expect(module.get(FfmpegService)).toBeInstanceOf(FfmpegService);
    await module.close();
  }, 15000);
});

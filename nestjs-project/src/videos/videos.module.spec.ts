import { createVideosTestingModule } from '../test/videos-test-module';
import { VideoProcessingQueue } from './video-processing.queue';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

describe('VideosModule', () => {
  it('should compile and resolve its controller and providers with the test configs', async () => {
    const module = await createVideosTestingModule().compile();

    expect(module.get(VideosService)).toBeInstanceOf(VideosService);
    expect(module.get(VideosController)).toBeInstanceOf(VideosController);
    expect(module.get(VideoProcessingQueue)).toBeInstanceOf(
      VideoProcessingQueue,
    );
    await module.close();
  }, 15000);
});

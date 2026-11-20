import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { VideosModule } from '../videos/videos.module';
import { createTestDataSource } from './create-test-data-source';
import { testQueueConfig, testStorageConfig } from './test-infra';
import { VIDEO_TEST_ENTITIES } from './video-fixtures';

/**
 * Módulo de teste com o `VideosModule` real sobre Postgres, RustFS (bucket de
 * teste) e Valkey (prefixo de teste).
 */
export function createVideosTestingModule(): TestingModuleBuilder {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [storageConfig, queueConfig, videoConfig],
      }),
      TypeOrmModule.forRoot(createTestDataSource(VIDEO_TEST_ENTITIES).options),
      VideosModule,
    ],
  })
    .overrideProvider(storageConfig.KEY)
    .useValue(testStorageConfig())
    .overrideProvider(queueConfig.KEY)
    .useValue(testQueueConfig());
}

import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { WorkerModule } from '../worker.module';
import { testQueueConfig, testStorageConfig } from './test-infra';

/**
 * `WorkerModule` real (Postgres, MinIO, Valkey e FFmpeg) com bucket e prefixo
 * de fila de teste. Após `init()`, os consumidores rodam in-process.
 */
export function createWorkerTestingModule(): TestingModuleBuilder {
  return Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(storageConfig.KEY)
    .useValue(testStorageConfig())
    .overrideProvider(queueConfig.KEY)
    .useValue({ ...testQueueConfig(), workerConcurrency: 1 });
}

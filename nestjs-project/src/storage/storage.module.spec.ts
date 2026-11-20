import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { testStorageConfig } from '../test/test-infra';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageModule', () => {
  it('should compile and resolve StorageService with the test config', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    })
      .overrideProvider(storageConfig.KEY)
      .useValue(testStorageConfig())
      .compile();

    const service = module.get(StorageService);

    expect(service).toBeInstanceOf(StorageService);
    expect(service.bucketName).toBe(testStorageConfig().bucket);
    await module.close();
  });
});

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigRootModule } from './config/config-root.module';
import { DatabaseRootModule } from './database/database-root.module';
import { MediaModule } from './media/media.module';
import {
  VIDEO_MAINTENANCE_QUEUE,
  VIDEO_PROCESSING_QUEUE,
} from './queue/queue.constants';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';
import { Video } from './videos/entities/video.entity';
import { VideoProcessingProcessor } from './videos/processing/video-processing.processor';
import { VideosRepository } from './videos/videos.repository';

/**
 * Módulo raiz do processo `video-worker` (entrypoint `src/worker.ts`). Os
 * consumidores das filas vivem só aqui; a API (`AppModule`) só produz jobs.
 */
@Module({
  imports: [
    ConfigRootModule,
    DatabaseRootModule,
    TypeOrmModule.forFeature([Video]),
    QueueModule,
    BullModule.registerQueue(
      { name: VIDEO_PROCESSING_QUEUE },
      { name: VIDEO_MAINTENANCE_QUEUE },
    ),
    StorageModule,
    MediaModule,
    // Video -> Channel -> User: entidades do grafo de relações, registradas
    // pelos módulos donos (autoLoadEntities só carrega o que é importado).
    UsersModule,
  ],
  providers: [VideosRepository, VideoProcessingProcessor],
})
export class WorkerModule {}

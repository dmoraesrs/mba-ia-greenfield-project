import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import queueConfig from '../config/queue.config';

/**
 * Conexão compartilhada da BullMQ com o Valkey. Cada módulo dono registra as
 * próprias filas com `BullModule.registerQueue`.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [queueConfig.KEY],
      useFactory: (queue: ConfigType<typeof queueConfig>) => ({
        connection: { host: queue.host, port: queue.port },
        prefix: queue.prefix,
      }),
    }),
  ],
})
export class QueueModule {}

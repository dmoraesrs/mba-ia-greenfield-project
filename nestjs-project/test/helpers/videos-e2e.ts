import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';
import queueConfig from '../../src/config/queue.config';
import storageConfig from '../../src/config/storage.config';
import { Channel } from '../../src/channels/entities/channel.entity';
import { User } from '../../src/users/entities/user.entity';
import { testQueueConfig, testStorageConfig } from '../../src/test/test-infra';

export interface VideosE2eContext {
  app: INestApplication<App>;
  moduleFixture: TestingModule;
  dataSource: DataSource;
}

export interface AuthenticatedUser {
  accessToken: string;
  userId: string;
  channelId: string;
}

/**
 * App completa (AppModule) com bucket e prefixo de fila de teste e a mesma
 * configuração global do `main.ts` (pipes e filtros).
 */
export async function createVideosE2eApp(): Promise<VideosE2eContext> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(storageConfig.KEY)
    .useValue(testStorageConfig())
    .overrideProvider(queueConfig.KEY)
    .useValue(testQueueConfig())
    .compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();

  return { app, moduleFixture, dataSource: moduleFixture.get(DataSource) };
}

/** Zera o rate limit global (10 req/min) entre testes. */
export function resetThrottler(context: VideosE2eContext): void {
  context.moduleFixture
    .get<ThrottlerStorageService>(ThrottlerStorage)
    .storage.clear();
}

/** Registra, confirma (direto no banco) e faz login de um usuário novo. */
export async function registerAndLogin(
  context: VideosE2eContext,
): Promise<AuthenticatedUser> {
  const { app, dataSource } = context;
  resetThrottler(context);
  const email = `uploader_${randomUUID().slice(0, 8)}@example.com`;
  const password = 'password123';

  const registered = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const userId = (registered.body as { id: string }).id;
  await dataSource
    .getRepository(User)
    .update({ id: userId }, { is_confirmed: true });

  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);
  const channel = await dataSource
    .getRepository(Channel)
    .findOneByOrFail({ user_id: userId });

  return {
    accessToken: (login.body as { access_token: string }).access_token,
    userId,
    channelId: channel.id,
  };
}

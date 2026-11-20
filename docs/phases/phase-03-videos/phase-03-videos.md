---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-11-20T00:16:09-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-11-20T00:16:01-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-20T00:13:41-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-11-19T23:33:58-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-11-19T23:33:58-03:00"
---

# Fase 03: Upload e Processamento de Vídeos

## Objective

Entregar no backend (`nestjs-project/`) o serviço de armazenamento de arquivos (vídeos e thumbnails) e o serviço de processamento em segundo plano (filas), com upload de vídeos de até 10GB sem impacto na performance, pré-cadastro automático do vídeo como rascunho ao iniciar o upload, processamento automático após o upload (extração de duração e metadados), geração automática de thumbnail a partir de um frame, URL única por vídeo sem conflito, reprodução via streaming e download do vídeo pelo usuário.

---

## Step Implementations

### SI-03.1 — Corrigir erros de lint pré-existentes nos testes

**Description:** Zera os cerca de 150 erros de lint já existentes em arquivos de teste (`no-unsafe-*`, `unbound-method`) num commit próprio (`chore:`), sem mudar comportamento, para que a Definition of Done (`npm run lint` verde) seja verificável no restante da fase.

**Technical actions:**

1. Rodar `docker compose exec nestjs-api npx eslint "{src,test}/**/*.ts"` (sem `--fix`) e registrar no `progress.md` a contagem inicial por regra e por arquivo.
2. Corrigir `no-unsafe-*` nos testes tipando as respostas do `supertest` (`response.body as T` com interfaces locais ou os DTOs de resposta existentes) e os retornos de helpers (`src/test/mailpit.ts`, `src/test/create-test-data-source.ts`).
3. Corrigir `unbound-method` nos testes unitários trocando `expect(obj.method)` por `jest.mocked`/`jest.spyOn` com referência a mocks tipados (`jest.Mocked<T>`), seguindo `.claude/rules/nestjs-testing.md`.
4. Confirmar que nenhum arquivo de produção (`src/**/*.ts` fora de `*.spec.ts`, `*.integration-spec.ts`, `test/`) foi alterado e commitar como `chore: corrige erros de lint pré-existentes nos testes`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Suítes existentes (regressão) | Unit + Integration + E2E existentes, sem alteração de asserções | `src/**/*.spec.ts`, `src/**/*.integration-spec.ts`, `test/*.e2e-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `docker compose exec nestjs-api npx eslint "{src,apps,libs,test}/**/*.ts"` termina com 0 erros.
- `docker compose exec nestjs-api npm test -- --runInBand` e `npm run test:e2e` passam com o mesmo número de testes de antes da correção.
- O diff do commit toca apenas arquivos de teste e helpers de teste (`src/test/`).

---

### SI-03.2 — Infra: serviços Valkey, RustFS e video-worker no Compose com FFmpeg

**Description:** Sobe a infraestrutura nova da fase (fila, object storage e container do worker) com imagens fixadas por tag e digest e aprovadas no gate de segurança, e coloca o FFmpeg na imagem usada pela API e pelos testes.

**Technical actions:**

1. Escolher a imagem do Valkey (`valkey/valkey:{versão}-alpine@sha256:...`, publicada há pelo menos 7 dias) e a imagem base com FFmpeg do worker (base `node:25.6.0-slim` atual + `ffmpeg` via `apt`, per `phase-03-videos/TD-07`); rodar `trivy image --severity HIGH,CRITICAL --ignore-unfixed` em cada uma e em `rustfs/rustfs:1.0.5@sha256:b81d16a90ee25bd9511280127ca1471788c6e874cf0f0da759645f46b2dc1d74`, registrando resultado e digest no `progress.md` (per revisões de `phase-03-videos/TD-01`, `phase-03-videos/TD-03`, `phase-03-videos/TD-07`).
2. Atualizar `nestjs-project/Dockerfile.dev` para instalar `ffmpeg` (com `--no-install-recommends`), de modo que `nestjs-api` (testes) e `video-worker` usem a mesma imagem (per `phase-03-videos/TD-07`, `phase-03-videos/TD-14`).
3. Em `nestjs-project/compose.yaml`: adicionar `valkey` (sem porta no host, `command: valkey-server --maxmemory-policy noeviction`, healthcheck `valkey-cli ping`), `rustfs` (portas `9000:9000` e `9001:9001`, livres no host conforme `lsof` em 2026-11-20, volume nomeado `rustfs-data`, credenciais pelas variáveis do README da imagem, healthcheck) e `video-worker` (mesmo `build` e volume do `nestjs-api`, `command: npm run start:worker:dev`, `depends_on` com `condition: service_healthy` para `db`, `valkey`, `rustfs`); `nestjs-api` passa a depender de `valkey` e `rustfs` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-03`, `phase-03-videos/TD-07`).
4. Instalar dependências com versões exatas de `library-refs.md`: `docker compose exec nestjs-api npm install --save-exact --ignore-scripts @aws-sdk/client-s3@3.1168.0 @aws-sdk/s3-request-presigner@3.1168.0 @nestjs/bullmq@12.0.1 bullmq@6.7.6`.
5. Acrescentar ao `.env.example` (sem segredos reais) e ao `.env` local: `STORAGE_ENDPOINT=http://rustfs:9000`, `STORAGE_PUBLIC_ENDPOINT=http://localhost:9000`, `STORAGE_REGION=us-east-1`, `STORAGE_BUCKET=streamtube`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `QUEUE_HOST=valkey`, `QUEUE_PORT=6379`, `QUEUE_PREFIX=streamtube`, `VIDEO_WORKER_CONCURRENCY=2`, `UPLOAD_PART_URL_EXPIRATION_SECONDS=3600`, `DOWNLOAD_URL_EXPIRATION_SECONDS=300`, `UPLOAD_EXPIRATION_HOURS=24`, `UPLOAD_EXPIRATION_SWEEP_INTERVAL_MS=3600000` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-06`).

**Tests:** _(empty — Infra)_

**Dependencies:** SI-03.1 (lint zerado antes de novas mudanças)

**Acceptance criteria:**

- `docker compose ps` mostra `db`, `valkey`, `rustfs`, `nestjs-api` e `video-worker` em execução e `healthy` onde há healthcheck (o `video-worker` pode reiniciar até o SI-03.9 criar o entrypoint).
- `docker compose exec valkey valkey-cli CONFIG GET maxmemory-policy` retorna `noeviction`.
- `docker compose exec nestjs-api ffprobe -version` e `ffmpeg -version` retornam versão.
- `compose.yaml` não contém nenhuma imagem sem tag fixa; Valkey e RustFS estão fixados por digest e o resultado do Trivy (zero HIGH/CRITICAL com correção) está registrado no `progress.md`.
- `package.json` lista os quatro pacotes com versão exata, sem `^`.

---

### SI-03.3 — Namespaces de configuração de storage, fila e vídeos

**Description:** Cria os `registerAs` da fase e a validação Joi das variáveis novas, seguindo a convenção de configuração por domínio herdada da Fase 01.

**Technical actions:**

1. Criar `src/config/storage.config.ts`: `registerAs('storage', ...)` com `endpoint`, `publicEndpoint`, `region`, `bucket`, `accessKeyId`, `secretAccessKey` (per `phase-03-videos/TD-02`, `phase-01-configuracao-base/TD-03`).
2. Criar `src/config/queue.config.ts`: `registerAs('queue', ...)` com `host`, `port`, `prefix`, `workerConcurrency` (per `phase-03-videos/TD-03`, `phase-03-videos/TD-14`).
3. Criar `src/config/video.config.ts`: `registerAs('video', ...)` com `maxSizeBytes = 10737418240`, `partSizeBytes = 67108864`, `allowedMimeTypes`, `partUrlExpirationSeconds`, `downloadUrlExpirationSeconds`, `uploadExpirationHours`, `uploadExpirationSweepIntervalMs` (per `phase-03-videos/TD-04`, `phase-03-videos/TD-06`, `phase-03-videos/TD-12`).
4. Estender `src/config/env.validation.ts` com as variáveis do SI-03.2 (`STORAGE_*` obrigatórias, demais com default) e registrar os três namespaces no `load` do `ConfigModule.forRoot` em `src/app.module.ts` (per `phase-01-configuracao-base/TD-02`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` | Integration: variáveis `STORAGE_*` obrigatórias rejeitadas quando ausentes, defaults de fila e vídeo aplicados | `src/config/env.validation.integration-spec.ts` |
| `storageConfig`, `queueConfig`, `videoConfig` | Unit: mapeamento de env para objeto tipado e coerção numérica | `src/config/storage.config.spec.ts` |

**Dependencies:** SI-03.2 (variáveis no `.env` e no `.env.example`)

**Acceptance criteria:**

- A API não inicia (erro de validação Joi listando a variável) quando `STORAGE_BUCKET` ou `STORAGE_ACCESS_KEY` está ausente.
- Sem `QUEUE_PREFIX`, `UPLOAD_EXPIRATION_HOURS` e `VIDEO_WORKER_CONCURRENCY` no ambiente, os namespaces expõem `streamtube`, `24` e `2`.
- `ConfigType<typeof videoConfig>` expõe `maxSizeBytes` igual a `10737418240`.

---

### SI-03.4 — Módulo de storage S3 (RustFS) com multipart, assinatura e leitura por Range

**Description:** Entrega o serviço de armazenamento de arquivos como adapter S3 isolado, com dois clientes (interno e público) e todas as operações que upload, worker, streaming e download consomem.

**Technical actions:**

1. Criar `src/storage/storage.module.ts` e `src/storage/storage.service.ts` com dois `S3Client` (`forcePathStyle: true`): interno (`storage.endpoint`) para chamadas e URLs lidas pelo worker, público (`storage.publicEndpoint`) só para assinar URLs entregues ao cliente (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`).
2. Implementar no `StorageService`: `ensureBucket()` (HeadBucket/CreateBucket, chamado em `onModuleInit`), `createMultipartUpload(key, contentType)`, `signUploadParts(key, uploadId, partNumbers, expiresIn)`, `listParts(key, uploadId)`, `completeMultipartUpload(key, uploadId, parts)`, `abortMultipartUpload(key, uploadId)`, `headObject(key)`, `deleteObject(key)`, `putObject(key, body, contentType)`, `getObjectStream(key, range?)` (retorna `Body`, `ContentRange`, `ContentLength`, `ContentType`, `ETag`) e `signGetObject(key, { expiresIn, responseContentDisposition?, internal })` (per `phase-03-videos/TD-04`, `phase-03-videos/TD-08`, `phase-03-videos/TD-11`, `phase-03-videos/TD-12`).
3. Criar `src/storage/storage.errors.ts`: `StorageObjectNotFoundError`, `StorageUploadNotFoundError`, `StorageInvalidPartsError`, `StorageRangeNotSatisfiableError` (mapeando `NoSuchKey`/`NotFound`, `NoSuchUpload`, `InvalidPart`/`InvalidPartOrder`/`EntityTooSmall`, `InvalidRange` pelo `name` e `$metadata.httpStatusCode`) e `src/storage/storage-keys.ts` (`originalKey(videoId)`, `thumbnailKey(videoId)`) (per `### Error Catalog`).
4. Criar `src/test/test-infra.ts`: `testStorageConfig()` que sobrescreve `bucket` para `${STORAGE_BUCKET}-test` e `publicEndpoint` para o endpoint interno, e `emptyTestBucket()` para limpeza em `afterAll` (per `phase-03-videos/TD-14`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration (RustFS real, bucket de teste): multipart real com 2 partes (`PUT` nas URLs assinadas via `fetch`) + `CompleteMultipartUpload` + `HeadObject`; `getObjectStream` com `Range: bytes=0-9` devolve 10 bytes e `ContentRange`; `abortMultipartUpload`; `deleteObject`; URL de `signGetObject` com `responseContentDisposition` responde `Content-Disposition: attachment` | `src/storage/storage.service.integration-spec.ts` |
| `storage.errors` | Unit: mapeamento de cada erro do SDK para o erro de domínio | `src/storage/storage.errors.spec.ts` |
| `StorageModule` | Unit: compilação com config de teste | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.3 (`storageConfig`)

**Acceptance criteria:**

- Um upload multipart de 2 partes enviado direto ao RustFS pelas URLs assinadas resulta num objeto cujo `HeadObject.ContentLength` é a soma das partes.
- `GetObject` com `Range: bytes=0-9` sobre esse objeto devolve exatamente 10 bytes e `ContentRange` `bytes 0-9/{total}`.
- Uma URL de download assinada com `ResponseContentDisposition: attachment; filename="a.mp4"` devolve o cabeçalho `Content-Disposition` correspondente; se o RustFS não honrar, o desvio fica registrado no `progress.md` e o SI-03.15 aplica o plano B (per revisão de `phase-03-videos/TD-12`).
- `HeadObject` de chave inexistente lança `StorageObjectNotFoundError`; `ListParts` de `UploadId` abortado lança `StorageUploadNotFoundError`.
- A API inicializada com bucket inexistente cria o bucket no boot.

---

### SI-03.5 — Módulo de fila BullMQ e produtor do processamento

**Description:** Configura a conexão BullMQ com o Valkey e expõe o produtor tipado do job `process-video`, separado do consumidor que vive só no worker.

**Technical actions:**

1. Criar `src/queue/queue.module.ts`: `BullModule.forRootAsync({ inject: [queueConfig.KEY], useFactory: ... })` com `connection: { host, port }` e `prefix` (per `phase-03-videos/TD-03`, `phase-03-videos/TD-14`).
2. Criar `src/queue/queue.constants.ts`: `VIDEO_PROCESSING_QUEUE = 'video-processing'`, `PROCESS_VIDEO_JOB = 'process-video'`, `VIDEO_MAINTENANCE_QUEUE = 'video-maintenance'`, `EXPIRE_ABANDONED_UPLOADS_JOB = 'expire-abandoned-uploads'` e o tipo `ProcessVideoJobData = { videoId: string }` (per `### Events/Messages`).
3. Criar `src/videos/video-processing.queue.ts`: `VideoProcessingQueue.enqueue(videoId)` chamando `queue.add(PROCESS_VIDEO_JOB, { videoId }, { jobId: videoId, attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true, removeOnFail: { age: 86400 } })` (per `phase-03-videos/TD-09`).
4. Estender `src/test/test-infra.ts` com `testQueueConfig()` (prefixo `${QUEUE_PREFIX}-test`) e `obliterateTestQueues()` para limpeza em `afterAll` (per `phase-03-videos/TD-14`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingQueue` | Integration (Valkey real, prefixo de teste): job criado com `jobId = videoId`, `attempts = 3`, backoff exponencial; segunda chamada com o mesmo `videoId` não cria job duplicado | `src/videos/video-processing.queue.integration-spec.ts` |
| `QueueModule` | Unit: compilação com config de teste | `src/queue/queue.module.spec.ts` |

**Dependencies:** SI-03.3 (`queueConfig`)

**Acceptance criteria:**

- `enqueue(videoId)` cria na fila `video-processing` um job `process-video` com `data.videoId` igual ao argumento e `opts.jobId` igual ao `videoId`.
- Duas chamadas seguidas de `enqueue` com o mesmo `videoId` resultam em um único job na fila.
- Jobs criados pelos testes ficam sob o prefixo `${QUEUE_PREFIX}-test` e não aparecem para o `video-worker` de desenvolvimento.

---

### SI-03.6 — Entidade Video, migration e repositório com identificador público único

**Description:** Cria o modelo persistente do vídeo (status, dados do upload, metadados e thumbnail) e a geração do `public_id` sem conflito, base de todos os fluxos da fase.

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` com as colunas, o enum `VideoStatus` (`draft`, `processing`, `ready`, `failed`), o tipo `VideoMetadata`, o transformer `bigint ↔ number` em `size_bytes` e a relação `ManyToOne` com `Channel` exatamente como em `### Data Model → Video` (per `phase-03-videos/TD-05`, revisão AMB-1).
2. Gerar e revisar `src/database/migrations/{timestamp}-CreateVideos.ts` com `npm run migration:generate`, incluindo o enum `videos_status_enum`, as checks de `size_bytes` e `part_count`, o `UNIQUE` de `public_id` e os índices `(channel_id)` e `(status, created_at)`; garantir `down` reversível (per `.claude/rules/typeorm-migrations.md`, `phase-03-videos/TD-10`).
3. Criar `src/videos/public-id.ts`: `generatePublicId()` com `crypto.randomBytes(8).toString('base64url')` (11 caracteres) e `isValidPublicId()` (`^[A-Za-z0-9_-]{11}$`) (per `phase-03-videos/TD-10`).
4. Criar `src/videos/videos.repository.ts`: `createDraft(data)` que insere com `generatePublicId()` e, em violação do `UNIQUE` de `public_id` (código Postgres `23505` na constraint do `public_id`), gera outro e tenta de novo até 5 vezes; mais `findOwnedById(id, userId)` (join com `channels.user_id`), `findReadyByPublicId(publicId)`, `findById(id)`, `updateWhereStatus(id, expectedStatus, patch)` (update condicional que retorna se afetou linha) e `findExpiredDrafts(cutoff, limit)` (per `phase-03-videos/TD-06`, `phase-03-videos/TD-10`, `.claude/rules/typeorm-queries.md`).
5. Garantir em `ChannelsService` um método `findByUserId(userId)` (criar se não existir) para o serviço de vídeos resolver o canal do usuário, mantendo a posse da entidade `Channel` no `ChannelsModule`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` (entity) | Integration: default `status = 'draft'`, `UNIQUE` em `public_id`, checks de `size_bytes` (0 e 10737418241 rejeitados) e `part_count`, FK com cascade ao apagar o canal, round-trip de `metadata` jsonb e `size_bytes` como number | `src/videos/entities/video.entity.integration-spec.ts` |
| `VideosRepository` | Integration: retentativa em colisão de `public_id` (gerador forçado a repetir), `findOwnedById` não retorna vídeo de outro usuário, `updateWhereStatus` não altera linha em status diferente, `findExpiredDrafts` só retorna `draft` anterior ao corte | `src/videos/videos.repository.integration-spec.ts` |
| `public-id` | Unit: 11 caracteres no alfabeto base64url, `isValidPublicId` aceita/rejeita formatos | `src/videos/public-id.spec.ts` |
| Migrations | Integration: suíte existente roda `CreateVideos` up/down com banco zerado | `src/database/migrations.integration-spec.ts` |

**Dependencies:** SI-03.2 (banco e Compose atualizados); usa `Channel` da Fase 02.

**Acceptance criteria:**

- Inserir dois vídeos com o mesmo `public_id` viola a constraint `UNIQUE`; `createDraft` com colisão forçada na primeira tentativa persiste o vídeo com outro `public_id`.
- Inserir vídeo com `size_bytes = 10737418241` ou `part_count = 0` é rejeitado pelo banco.
- Um vídeo recém-criado tem `status = 'draft'`, `duration_seconds`, `metadata`, `thumbnail_key` e `failure_reason` nulos.
- Apagar o canal apaga seus vídeos.
- `migration:run` seguido de `migration:revert` deixa o schema sem a tabela `videos` e sem o tipo `videos_status_enum`.

---

### SI-03.7 — Endpoint POST /videos (início do upload e pré-cadastro como rascunho)

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/videos-create.plan.md`
**Authorization:** Authenticated (per `### Authorization Matrix`)

**Description:** Ao iniciar o upload, cria o vídeo como rascunho no canal do usuário, inicia o multipart no storage e devolve as URLs pré-assinadas de todas as partes, sem que o arquivo passe pela API.

**Technical actions:**

1. Criar `src/videos/dto/create-video.dto.ts` (`filename`, `mime_type`, `size_bytes` com as regras de `#### Validation Rules: Upload de vídeo`) e `src/videos/dto/video-response.dto.ts` (`VideoResponse`, `VideoMetadataDto`, `SignedPartDto`, `CreateVideoResponseDto`) com mapeamento `snake_case` da entidade (per `phase-02-auth/TD-06`, revisão MD-1 de `phase-03-videos/TD-04`).
2. Criar `src/videos/videos.service.ts`: `initiateUpload(userId, dto)`: resolve o canal (`ChannelsService.findByUserId`), calcula `part_count = ceil(size_bytes / partSizeBytes)`, gera o `id` (uuid) antes do insert para montar `storage_key = videos/{id}/original`, chama `createMultipartUpload`, persiste o rascunho via `createDraft` com `upload_id` e, em falha do insert, aborta o multipart; assina as partes `1..part_count` com o cliente público (per `phase-03-videos/TD-04`, `phase-03-videos/TD-05`, `phase-03-videos/TD-10`).
3. Criar `src/videos/videos.controller.ts` com `POST /videos` (`201`, `@CurrentUser()`), decoradores `@nestjs/swagger` explícitos e envelope de erro (per `openapi-docs-nestjs/TD-01`, `### API Contracts → POST /videos`).
4. Criar `src/videos/videos.module.ts` (imports: `TypeOrmModule.forFeature([Video])`, `StorageModule`, `QueueModule`, `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE })`, `ChannelsModule`) e registrar `VideosModule` em `AppModule`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.initiateUpload` | Unit: cálculo de `part_count` (1 byte → 1 parte; 10737418240 → 160 partes), abort do multipart quando o insert falha (repo e storage mockados) | `src/videos/videos.service.spec.ts` |
| `VideosService.initiateUpload` | Integration (Postgres + RustFS reais): rascunho persistido com `upload_id` e multipart existente no storage (`ListParts` vazio) | `src/videos/videos.service.integration-spec.ts` |
| `VideosModule` | Unit: compilação com configs de teste | `src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.4 (storage), SI-03.5 (fila registrada no módulo), SI-03.6 (entidade e repositório)

**Acceptance criteria:**

- `POST /videos` autenticado com `{ filename: "a.mp4", mime_type: "video/mp4", size_bytes: 134217728 }` retorna `201` com `video.status = "draft"`, `video.public_id` de 11 caracteres, `upload.part_size_bytes = 67108864`, `upload.part_count = 2` e 2 URLs em `upload.parts`.
- `POST /videos` com `mime_type: "video/avi"` ou `size_bytes: 10737418241` retorna `400` com `error: "VALIDATION_ERROR"` e nenhum vídeo é criado.
- `POST /videos` sem `Authorization` retorna `401`.
- Após `201`, a tabela `videos` contém a linha `draft` no canal do usuário e o storage tem um multipart aberto para `videos/{id}/original`.

---

### SI-03.8 — Endpoints de partes do upload (listar e reassinar)

**Route:** GET /videos/:id/upload/parts, POST /videos/:id/upload/parts
**Test Specs:** see `nestjs-project/specs/videos-upload-parts.plan.md`
**Authorization:** Owner (per `### Authorization Matrix`)

**Description:** Permite retomar um upload interrompido: o cliente descobre quais partes o storage já recebeu e pede novas URLs para as que faltam ou cujas URLs expiraram.

**Technical actions:**

1. Criar `src/videos/dto/sign-parts.dto.ts` (`part_numbers` com as regras de `#### Validation Rules: Upload de vídeo`) e os DTOs de resposta `UploadedPartDto` e `SignPartsResponseDto` (per `phase-03-videos/TD-04`).
2. Adicionar a `src/common/exceptions/domain.exception.ts` as exceções `VideoNotFoundException` (`VIDEO_NOT_FOUND`, 404), `VideoNotInDraftException` (`VIDEO_NOT_IN_DRAFT`, 409) e `InvalidPartNumberException` (`INVALID_PART_NUMBER`, 400) (per `### Error Catalog`, `phase-02-auth/TD-07`).
3. Implementar em `VideosService` `listUploadedParts(userId, id)` e `signParts(userId, id, partNumbers)`: `findOwnedById` (senão `VIDEO_NOT_FOUND`), exige `status = 'draft'` (senão `VIDEO_NOT_IN_DRAFT`), valida `part_number <= part_count`, chama `listParts`/`signUploadParts`; `StorageUploadNotFoundError` vira `VIDEO_NOT_IN_DRAFT` (upload já abortado pela expiração).
4. Adicionar ao `VideosController` `GET /videos/:id/upload/parts` e `POST /videos/:id/upload/parts` (`200`, `ParseUUIDPipe`, swagger explícito) (per `### API Contracts`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.signParts` / `listUploadedParts` | Unit: `VIDEO_NOT_FOUND` para vídeo de outro usuário, `VIDEO_NOT_IN_DRAFT` fora de `draft`, `INVALID_PART_NUMBER` acima de `part_count`, tradução de `StorageUploadNotFoundError` | `src/videos/videos.service.spec.ts` |
| `VideosService.listUploadedParts` | Integration (RustFS real): após enviar a parte 1 pela URL assinada, a listagem devolve `part_number = 1` com `etag` e `size_bytes` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.7 (vídeo `draft` com multipart aberto, controller e módulo)

**Acceptance criteria:**

- Depois de enviar a parte 1 de um upload de 2 partes, `GET /videos/{id}/upload/parts` do dono retorna `200` com `parts` contendo só `part_number: 1`, seu `etag` e `size_bytes`.
- `POST /videos/{id}/upload/parts` com `{ part_numbers: [2] }` retorna `200` com uma URL para a parte 2 e `expires_at` cerca de 1 h no futuro.
- `POST /videos/{id}/upload/parts` com `{ part_numbers: [3] }` num vídeo de 2 partes retorna `400` com `error: "INVALID_PART_NUMBER"`.
- Os dois endpoints chamados por outro usuário autenticado retornam `404` com `error: "VIDEO_NOT_FOUND"`; num vídeo `processing` retornam `409` com `error: "VIDEO_NOT_IN_DRAFT"`.

---

### SI-03.9 — Endpoint POST /videos/:id/upload/complete (conclusão, conferência de tamanho e enfileiramento)

**Route:** POST /videos/:id/upload/complete
**Test Specs:** see `nestjs-project/specs/videos-upload-complete.plan.md`
**Authorization:** Owner (per `### Authorization Matrix`)

**Description:** Conclui o multipart, confere o tamanho real do objeto contra o declarado e o limite de 10GB e, se estiver tudo certo, passa o vídeo para `processing` e enfileira o processamento automático.

**Technical actions:**

1. Criar `src/videos/dto/complete-upload.dto.ts` (`parts[]` com `part_number` e `etag`, regras de `#### Validation Rules: Upload de vídeo`) (per `phase-03-videos/TD-04`).
2. Adicionar a `src/common/exceptions/domain.exception.ts` `InvalidUploadPartsException` (`INVALID_UPLOAD_PARTS`, 400), `UploadSizeMismatchException` (`UPLOAD_SIZE_MISMATCH`, 422) e `UploadTooLargeException` (`UPLOAD_TOO_LARGE`, 422) (per `### Error Catalog`).
3. Implementar `VideosService.completeUpload(userId, id, dto)`: `findOwnedById` + exige `draft`; ordena as partes e chama `completeMultipartUpload` (`StorageInvalidPartsError` vira `INVALID_UPLOAD_PARTS`, vídeo segue `draft`); `headObject`: acima de `10737418240` apaga o objeto, grava `failed`/`upload_too_large` e lança `UPLOAD_TOO_LARGE`; diferente de `size_bytes` apaga, grava `failed`/`upload_size_mismatch` e lança `UPLOAD_SIZE_MISMATCH` (per revisão MD-1 de `phase-03-videos/TD-04` e de `phase-03-videos/TD-09`).
4. No caminho feliz, `updateWhereStatus(id, 'draft', { status: 'processing', upload_id: null })`; se não afetou linha, `VIDEO_NOT_IN_DRAFT` (corrida com a expiração); depois `VideoProcessingQueue.enqueue(id)`. Se o enfileiramento falhar, a exceção sobe como 500 e o vídeo fica `processing`; a nova chamada não reprocessa, então registrar no `progress.md` essa limitação conhecida da falta de atomicidade entre Postgres e fila (per `phase-03-videos/TD-03`, `phase-03-videos/TD-09`).
5. Adicionar ao `VideosController` `POST /videos/:id/upload/complete` (`200` com `VideoResponse`, `@HttpCode(200)`, swagger explícito) (per `### API Contracts`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.completeUpload` | Unit: ordenação de partes, `INVALID_UPLOAD_PARTS` mantém `draft`, `UPLOAD_TOO_LARGE` e `UPLOAD_SIZE_MISMATCH` gravam `failed` com motivo e apagam o objeto sem enfileirar, `VIDEO_NOT_IN_DRAFT` quando o update condicional não afeta linha | `src/videos/videos.service.spec.ts` |
| `VideosService.completeUpload` | Integration (Postgres + RustFS + Valkey reais): upload real de 2 partes, conclusão grava `processing` e cria o job `process-video` com `jobId = videoId`; upload com tamanho real diferente do declarado vira `failed` com `upload_size_mismatch` e o objeto deixa de existir | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.8 (exceções de vídeo e fluxo de partes), SI-03.5 (produtor da fila)

**Acceptance criteria:**

- `POST /videos/{id}/upload/complete` com as 2 partes e ETags corretos retorna `200` com `status: "processing"` e existe um job `process-video` com `data.videoId = id`.
- Um upload declarado com 134217728 bytes mas enviado com 134217729 bytes, ao ser concluído, retorna `422` com `error: "UPLOAD_SIZE_MISMATCH"`; o vídeo fica `failed` com `failure_reason = "upload_size_mismatch"`, o objeto é apagado e nenhum job é criado.
- `POST /videos/{id}/upload/complete` com um ETag errado retorna `400` com `error: "INVALID_UPLOAD_PARTS"` e o vídeo continua `draft`.
- Uma segunda chamada de conclusão para o mesmo vídeo retorna `409` com `error: "VIDEO_NOT_IN_DRAFT"`.
- A conclusão por outro usuário retorna `404` com `error: "VIDEO_NOT_FOUND"`.

---

### SI-03.10 — Serviço FFmpeg: extração de duração, metadados e frame de thumbnail

**Description:** Encapsula a invocação de `ffprobe` e `ffmpeg` (via `spawn`, sem shell) e a conversão da saída do `ffprobe` em `duration_seconds` + `VideoMetadata`, separando de forma tipada arquivo inválido (permanente) de erro transitório.

**Technical actions:**

1. Criar `src/media/ffmpeg.service.ts`: `probe(inputUrl)`: `spawn('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputUrl])` com timeout, coletando `stdout`/`stderr` (per `phase-03-videos/TD-07`, `phase-03-videos/TD-08`).
2. Implementar `extractFrame(inputUrl, atSeconds)`: `spawn('ffmpeg', ['-ss', String(atSeconds), '-i', inputUrl, '-frames:v', '1', '-vf', 'scale=640:-2', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'])` retornando `Buffer` JPEG; saída vazia é erro (per `phase-03-videos/TD-07`).
3. Criar `src/media/probe-parser.ts`: `parseProbeOutput(json)` que devolve `{ durationSeconds, metadata: VideoMetadata }` conforme `### Data Model → VideoMetadata` (frame rate `n/d`, `audio_codec` nulo sem trilha, `bitrate` nulo ausente) e lança `InvalidVideoFileError` quando não há stream de vídeo, duração válida ou JSON reconhecível (per revisão AMB-1 de `phase-03-videos/TD-07` e revisão MD-1 de `phase-03-videos/TD-09`).
4. Mapear em `FfmpegService` o código de saída do `ffprobe` para `InvalidVideoFileError` quando o `stderr` indicar dado inválido (`Invalid data found when processing input`, `moov atom not found`) e para `MediaToolError` (transitório) nos demais casos; criar `src/media/media.module.ts` exportando `FfmpegService`.
5. Criar `src/test/fixtures.ts`: `generateSampleVideo(path, { seconds: 2, withAudio, videoBitrate? })` que roda `ffmpeg -f lavfi -i testsrc=size=320x240:rate=25 [-f lavfi -i sine] -t 2 -c:v libx264 -pix_fmt yuv420p [-b:v {videoBitrate}] [-c:a aac] {path}` para os testes da fase (per `phase-03-videos/TD-14`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `parseProbeOutput` | Unit: JSON com áudio, sem áudio, `avg_frame_rate = 0/0`, sem stream de vídeo (erro), sem duração (erro), JSON malformado (erro) | `src/media/probe-parser.spec.ts` |
| `FfmpegService` | Integration (binários reais, vídeo gerado pelo fixture e servido por URL assinada do RustFS): `probe` devolve duração cerca de 2 s, 320x240, `h264`; `extractFrame` devolve JPEG (começa com `FF D8`); arquivo de texto com extensão `.mp4` lança `InvalidVideoFileError` | `src/media/ffmpeg.service.integration-spec.ts` |

**Dependencies:** SI-03.2 (FFmpeg na imagem), SI-03.4 (URL assinada para entrada remota), SI-03.6 (tipo `VideoMetadata`)

**Acceptance criteria:**

- Para um vídeo de 2 s 320x240 H.264 com áudio AAC, a extração devolve `duration_seconds` entre 1.9 e 2.1 e `metadata` com `width: 320`, `height: 240`, `video_codec: "h264"`, `audio_codec: "aac"`, `frame_rate: 25` e `size_bytes` igual ao tamanho do arquivo.
- Para o mesmo vídeo sem trilha de áudio, `metadata.audio_codec` é `null`.
- Um arquivo que não é vídeo resulta em `InvalidVideoFileError`; falha de rede ou de binário resulta em `MediaToolError`.
- A extração de frame de um vídeo válido produz um JPEG não vazio com largura 640.

---

### SI-03.11 — Worker de processamento: entrypoint próprio e processor do job process-video

**Description:** Cria o processo `video-worker` (mesmo código NestJS, entrypoint próprio) que consome a fila, extrai duração, metadados e thumbnail e fecha o ciclo de status em `ready` ou `failed` com motivo.

**Technical actions:**

1. Criar `src/worker.ts` (`NestFactory.createApplicationContext(WorkerModule)`, `enableShutdownHooks()`) e `src/worker.module.ts` (`ConfigModule`, `TypeOrmModule.forRootAsync` iguais ao `AppModule`, `QueueModule`, `StorageModule`, `MediaModule`, `TypeOrmModule.forFeature([Video])`, `BullModule.registerQueue` das duas filas); adicionar a `package.json` os scripts `start:worker:dev` (`nest start --watch --entryFile worker`) e `start:worker` (`node dist/worker`) (per `phase-03-videos/TD-07`).
2. Criar `src/videos/processing/video-processing.processor.ts`: `@Processor(VIDEO_PROCESSING_QUEUE, { concurrency })` estendendo `WorkerHost`: carrega o vídeo por `findById`; se não estiver `processing`, retorna sem efeito; gera `signGetObject(storage_key, { internal: true, expiresIn: 3600 })`, chama `probe` e `parseProbeOutput`, `extractFrame` em `min(1, duração/2)`, `putObject(thumbnailKey(id), jpeg, 'image/jpeg')` e `updateWhereStatus(id, 'processing', { status: 'ready', duration_seconds, metadata, thumbnail_key, failure_reason: null })` (per `phase-03-videos/TD-07`, `phase-03-videos/TD-08`, `### Events/Messages → video-processing`).
3. No processor, converter `InvalidVideoFileError` em `UnrecoverableError` com a mensagem `invalid_video_file: {detalhe}`; demais erros são relançados para retentativa com backoff (per revisão MD-1 de `phase-03-videos/TD-09`).
4. Implementar `@OnWorkerEvent('failed')`: quando o erro é `UnrecoverableError` ou `job.attemptsMade >= job.opts.attempts`, `updateWhereStatus(id, 'processing', { status: 'failed', failure_reason })` com `invalid_video_file: ...` ou `processing_failed: {mensagem}` (per `phase-03-videos/TD-09`).
5. Garantir que o processor não é registrado no `AppModule` (a API só produz) e documentar em `nestjs-project/CLAUDE.md` o serviço `video-worker`, seus logs (`docker compose logs video-worker`) e as verificações de prontidão de `valkey` e `rustfs`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingProcessor` | Unit: vídeo fora de `processing` é ignorado; `InvalidVideoFileError` vira `UnrecoverableError`; handler `failed` só grava `failed` na última tentativa ou em erro não retentável (serviços mockados) | `src/videos/processing/video-processing.processor.spec.ts` |
| `VideoProcessingProcessor` | Integration (Postgres + RustFS + Valkey + FFmpeg reais, worker in-process com prefixo de teste): vídeo gerado pelo fixture e enviado ao storage fica `ready` com duração, metadados e `thumbnail.jpg` no bucket; arquivo de texto fica `failed` com `invalid_video_file:` após uma única tentativa | `src/videos/processing/video-processing.processor.integration-spec.ts` |
| `WorkerModule` | Unit: compilação com configs de teste | `src/worker.module.spec.ts` |

**Dependencies:** SI-03.9 (job enfileirado na conclusão), SI-03.10 (serviço FFmpeg)

**Acceptance criteria:**

- Com o `video-worker` em execução, um vídeo válido concluído via `POST /videos/{id}/upload/complete` passa a `status = 'ready'` com `duration_seconds`, `metadata` preenchidos e `thumbnail_key = 'videos/{id}/thumbnail.jpg'`, e o objeto da thumbnail existe no bucket.
- Um arquivo que o `ffprobe` não reconhece como vídeo termina `failed` com `failure_reason` iniciado por `invalid_video_file:` e `attemptsMade = 1` no job.
- Um erro transitório em todas as 3 tentativas termina `failed` com `failure_reason` iniciado por `processing_failed:`; um erro transitório só na primeira tentativa termina `ready`.
- Reentregar o mesmo job para um vídeo já `ready` não altera a linha.
- `docker compose logs video-worker` mostra o worker conectado à fila `video-processing` após `docker compose up -d`.

---

### SI-03.12 — Expiração de uploads abandonados (job agendado)

**Description:** Fecha o ciclo do rascunho que nunca teve o upload concluído: um job periódico aborta o multipart e marca o vídeo `failed` com `upload_expired`.

**Technical actions:**

1. Criar `src/videos/processing/upload-expiration.scheduler.ts`: no `onApplicationBootstrap` do `WorkerModule`, `queue.upsertJobScheduler(EXPIRE_ABANDONED_UPLOADS_JOB, { every: uploadExpirationSweepIntervalMs }, { name: EXPIRE_ABANDONED_UPLOADS_JOB, data: {}, opts: { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true, removeOnFail: { age: 86400 } } })` na fila `video-maintenance` (per `phase-03-videos/TD-06`, `phase-03-videos/TD-03`).
2. Criar `src/videos/processing/upload-expiration.service.ts`: `expireAbandonedUploads(now)`: `findExpiredDrafts(now - uploadExpirationHours, 100)` em lotes; para cada vídeo, `abortMultipartUpload` ignorando `StorageUploadNotFoundError`, depois `updateWhereStatus(id, 'draft', { status: 'failed', failure_reason: 'upload_expired', upload_id: null })` (per `phase-03-videos/TD-06`).
3. Criar `src/videos/processing/upload-expiration.processor.ts`: `@Processor(VIDEO_MAINTENANCE_QUEUE)` que delega ao serviço; registrar scheduler, serviço e processor apenas no `WorkerModule` (per `phase-03-videos/TD-07`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `UploadExpirationService` | Integration (Postgres + RustFS reais): rascunho com `created_at` anterior ao corte vira `failed`/`upload_expired` e o multipart deixa de existir; rascunho recente e vídeo `processing` antigo não são tocados; `NoSuchUpload` não interrompe o lote | `src/videos/processing/upload-expiration.service.integration-spec.ts` |
| `UploadExpirationScheduler` | Integration (Valkey real, prefixo de teste): duas inicializações resultam em um único job scheduler `expire-abandoned-uploads` | `src/videos/processing/upload-expiration.scheduler.integration-spec.ts` |

**Dependencies:** SI-03.11 (`WorkerModule` e fila `video-maintenance` registrada)

**Acceptance criteria:**

- Um vídeo `draft` criado há mais de `UPLOAD_EXPIRATION_HOURS` passa a `failed` com `failure_reason = "upload_expired"` e `upload_id` nulo após a execução do job, e `ListParts` do seu `UploadId` passa a falhar com `NoSuchUpload`.
- Um vídeo `draft` mais recente que o corte e um vídeo `processing` mais antigo que o corte permanecem inalterados.
- Reiniciar o `video-worker` não duplica o agendamento: a fila `video-maintenance` mantém um único job scheduler com id `expire-abandoned-uploads`.
- Depois da expiração, `POST /videos/{id}/upload/complete` do vídeo expirado retorna `409` com `error: "VIDEO_NOT_IN_DRAFT"`.

---

### SI-03.13 — Endpoints de consulta: GET /videos/:id (dono) e GET /videos/public/:publicId

**Route:** GET /videos/:id, GET /videos/public/:publicId
**Test Specs:** see `nestjs-project/specs/videos-get.plan.md`
**Authorization:** Owner em `GET /videos/:id`; Anonymous em `GET /videos/public/:publicId` (per `### Authorization Matrix`)

**Description:** Expõe ao dono o acompanhamento do processamento (status, metadados, motivo de falha) e a qualquer pessoa com o link os dados públicos do vídeo `ready`, identificado pela URL única.

**Technical actions:**

1. Criar `src/videos/dto/public-video-response.dto.ts` (`public_id`, `mime_type`, `duration_seconds`, `metadata`, `created_at`) (per `### API Contracts → GET /videos/public/:publicId`).
2. Implementar `VideosService.getOwned(userId, id)` (`VIDEO_NOT_FOUND` quando inexistente ou de outro usuário) e `VideosService.getPublic(publicId)` (`isValidPublicId` + `findReadyByPublicId`; formato inválido, inexistente ou fora de `ready` respondem igual com `VIDEO_NOT_FOUND`) (per `phase-03-videos/TD-10`, `phase-03-videos/TD-13`).
3. Adicionar ao `VideosController` `GET /videos/:id` (`ParseUUIDPipe`) e `GET /videos/public/:publicId` com `@Public()`, declarando as rotas `public/...` antes de `:id` e com swagger explícito (per `phase-02-auth/TD-02`, `openapi-docs-nestjs/TD-01`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getOwned` / `getPublic` | Unit: `VIDEO_NOT_FOUND` para vídeo de outro usuário, `publicId` malformado, vídeo `draft`/`processing`/`failed` | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.7 (controller, módulo e `VideoResponse`)

**Acceptance criteria:**

- `GET /videos/{id}` do dono retorna `200` com `VideoResponse` refletindo o status atual (`processing` logo após a conclusão, `ready` com `metadata` e `has_thumbnail: true` após o worker).
- `GET /videos/{id}` de outro usuário retorna `404` com `error: "VIDEO_NOT_FOUND"`; com `id` que não é uuid retorna `400` com `error: "VALIDATION_ERROR"`.
- `GET /videos/public/{public_id}` sem autenticação retorna `200` para vídeo `ready`, sem expor `id`, `channel_id`, `storage_key` ou `upload_id`.
- `GET /videos/public/{public_id}` para vídeo `processing`, para `public_id` inexistente e para `public_id` com formato inválido retorna o mesmo `404` com `error: "VIDEO_NOT_FOUND"`.

---

### SI-03.14 — Endpoints de streaming com Range (206) e de thumbnail

**Route:** GET /videos/public/:publicId/stream, GET /videos/public/:publicId/thumbnail
**Test Specs:** see `nestjs-project/specs/videos-public-stream.plan.md`
**Authorization:** Anonymous (per `### Authorization Matrix`)

**Description:** Entrega a reprodução via streaming sem download completo, repassando o `Range` do cliente ao storage e respondendo `206 Partial Content`, e serve a thumbnail gerada pelo worker.

**Technical actions:**

1. Criar `src/videos/range.ts`: `parseRange(header, size)` que aceita um único intervalo `bytes=a-b`, `bytes=a-` ou `bytes=-n` (limita `b` a `size - 1`), devolve `null` para ausência ou múltiplos intervalos e lança `RangeNotSatisfiableException` (`RANGE_NOT_SATISFIABLE`, 416) quando `a >= size` (per `phase-03-videos/TD-11`, `### Error Catalog`).
2. Implementar `VideoStreamingService.openStream(publicId, rangeHeader)` (novo `src/videos/video-streaming.service.ts`): `getPublic` para o vídeo `ready`, usa `metadata.size_bytes` (ou `HeadObject`) como tamanho, chama `getObjectStream(storage_key, 'bytes=a-b')` e devolve `{ status: 206 | 200, headers, body }`; `openThumbnail(publicId)` faz o mesmo para `thumbnail_key` (`VIDEO_NOT_FOUND` sem thumbnail) (per `phase-03-videos/TD-11`, `phase-03-videos/TD-13`).
3. Adicionar ao `VideosController` `GET /videos/public/:publicId/stream` e `GET /videos/public/:publicId/thumbnail` com `@Public()`, escrevendo status e cabeçalhos (`Content-Type`, `Content-Range`, `Content-Length`, `Accept-Ranges: bytes`, `ETag`, `Cache-Control` na thumbnail) via `@Res()` e fazendo `pipeline(body, res)`; no `close` da resposta antes do fim, `body.destroy()` (per `library-refs.md → @aws-sdk/client-s3`, `phase-03-videos/TD-11`).
4. Garantir no filtro de exceções que `RangeNotSatisfiableException` responde com o cabeçalho `Content-Range: bytes */{size}` além do envelope `{ statusCode, error, message }` (per `phase-02-auth/TD-07`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `parseRange` | Unit: `bytes=0-9`, `bytes=100-` , `bytes=-500`, fim além do tamanho (limitado), início além do tamanho (416), múltiplos intervalos e cabeçalho malformado (null) | `src/videos/range.spec.ts` |
| `VideoStreamingService` | Integration (Postgres + RustFS reais): vídeo `ready` com objeto real devolve `206` e o trecho exato pedido; sem `Range` devolve `200` com o arquivo inteiro | `src/videos/video-streaming.service.integration-spec.ts` |
| `DomainExceptionFilter` | Unit: `RANGE_NOT_SATISFIABLE` inclui `Content-Range: bytes */{size}` | `src/common/filters/domain-exception.filter.spec.ts` |

**Dependencies:** SI-03.13 (`getPublic`), SI-03.4 (`getObjectStream`)

**Acceptance criteria:**

- `GET /videos/public/{public_id}/stream` com `Range: bytes=0-1023` retorna `206` com `Content-Range: bytes 0-1023/{size}`, `Content-Length: 1024`, `Accept-Ranges: bytes`, `Content-Type` do vídeo e os 1024 primeiros bytes do arquivo.
- O mesmo endpoint sem `Range` retorna `200` com `Content-Length` igual ao tamanho do arquivo e corpo idêntico ao original.
- Com `Range: bytes={size}-` retorna `416` com `error: "RANGE_NOT_SATISFIABLE"` e `Content-Range: bytes */{size}`.
- `GET /videos/public/{public_id}/thumbnail` de vídeo `ready` retorna `200` com `Content-Type: image/jpeg` e corpo JPEG; de vídeo `processing` retorna `404` com `error: "VIDEO_NOT_FOUND"`.
- Abortar a conexão no meio do streaming não deixa a API com sockets de storage pendentes (requisições seguintes continuam respondendo normalmente).

---

### SI-03.15 — Endpoint de download (302 para URL pré-assinada com attachment)

**Route:** GET /videos/public/:publicId/download
**Test Specs:** see `nestjs-project/specs/videos-public-download.plan.md`
**Authorization:** Anonymous (per `### Authorization Matrix`)

**Description:** Permite ao usuário baixar o vídeo sem que os bytes passem pela API, redirecionando para uma URL pré-assinada de curta duração com `Content-Disposition: attachment`.

**Technical actions:**

1. Criar `src/videos/content-disposition.ts`: `attachmentDisposition(filename)` que gera `attachment; filename="{ascii}"; filename*=UTF-8''{encoded}`, removendo aspas, barras e caracteres de controle do `original_filename` (per `phase-03-videos/TD-12`).
2. Implementar `VideosService.getDownloadUrl(publicId)`: `getPublic` + `signGetObject(storage_key, { internal: false, expiresIn: downloadUrlExpirationSeconds, responseContentDisposition })` (per `phase-03-videos/TD-12`, `phase-03-videos/TD-13`).
3. Adicionar ao `VideosController` `GET /videos/public/:publicId/download` com `@Public()`, respondendo `302` com `Location` (`@Redirect` dinâmico ou `res.redirect(302, url)`) e swagger explícito.
4. Se o SI-03.4 tiver registrado que o RustFS não honra `response-content-disposition`, aplicar o plano B no mesmo endpoint: responder `200` em stream via `getObjectStream` com `Content-Disposition` de `attachmentDisposition`, `Content-Type` e `Content-Length`, e registrar a decisão no `progress.md` (per revisão de `phase-03-videos/TD-12`, revisão de `phase-03-videos/TD-01`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `attachmentDisposition` | Unit: nome ASCII simples, nome com acentos (`filename*`), nome com aspas e barras sanitizado | `src/videos/content-disposition.spec.ts` |
| `VideosService.getDownloadUrl` | Integration (Postgres + RustFS reais): a URL devolvida, acessada com `fetch`, responde `200` com `Content-Disposition: attachment` e o corpo do vídeo | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.13 (`getPublic`), SI-03.4 (`signGetObject` e verificação de `response-content-disposition`)

**Acceptance criteria:**

- `GET /videos/public/{public_id}/download` de vídeo `ready` retorna `302` com `Location` apontando para `STORAGE_PUBLIC_ENDPOINT`, contendo `response-content-disposition` e `X-Amz-Expires=300`.
- Seguir a URL do `Location` devolve o arquivo original com `Content-Disposition: attachment; filename="{original_filename}"`.
- O endpoint para vídeo fora de `ready` ou `public_id` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`.
- No plano B, o mesmo caminho responde `200` com `Content-Disposition: attachment` e o corpo completo, e o desvio está registrado no `progress.md`.

---

### SI-03.16 — Fluxo completo upload, processamento e streaming com a infra real, e documentação da fase

**Description:** Prova de ponta a ponta os entregáveis da fase com a infraestrutura do Compose (upload multipart real no RustFS, processamento pelo worker in-process com vídeo gerado por ffmpeg, streaming `206` e download) e atualiza OpenAPI e documentação.

**Technical actions:**

1. Criar `test/videos-flow.e2e-spec.ts`: sobe o `AppModule` e o `WorkerModule` in-process com `testStorageConfig()`/`testQueueConfig()`; registra e confirma um usuário (padrão de `test/auth.e2e-spec.ts` com Mailpit), gera um vídeo de 2 s com `generateSampleVideo` e `videoBitrate: '24M'` (cerca de 6 MiB), chama `POST /videos` com `part_size_bytes` reduzido via override do `videoConfig` para 5 MiB (mínimo S3), o que resulta em 2 partes, envia as partes com `fetch` para as URLs assinadas, conclui, aguarda (polling de `GET /videos/:id` com timeout) `ready`, e verifica `stream` com `Range` (`206`), `thumbnail` e `download` (per `phase-03-videos/TD-14`).
2. No mesmo arquivo, cenário de arquivo inválido: upload de um arquivo de texto declarado como `video/mp4` termina `failed` com `invalid_video_file:` via `GET /videos/:id`; `afterAll` esvazia o bucket de teste, oblitera as filas de teste e fecha `Queue`/`Worker`.
3. Regenerar `nestjs-project/openapi.json` com `npm run openapi:export` e conferir que os 9 endpoints da fase aparecem com respostas por status e envelope de erro (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).
4. Atualizar `nestjs-project/README.md` e `nestjs-project/api.http` com o fluxo de upload (iniciar, enviar partes, concluir, acompanhar), as portas `9000`/`9001` do RustFS, a ausência de porta do Valkey no host e os registros de risco da fase: fork/servidor S3 trocável por configuração (`phase-03-videos/TD-01`), streaming pela API em vez de URL direta do diagrama (`phase-03-videos/TD-11`), acesso por link a vídeos `ready` até a Fase 04 (`phase-03-videos/TD-13`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Fluxo upload → worker → streaming/download | E2E (Postgres, Valkey, RustFS, Mailpit e FFmpeg reais; worker in-process): vídeo válido chega a `ready` e é reproduzido com `206`; arquivo inválido chega a `failed` | `test/videos-flow.e2e-spec.ts` |
| `openapi.json` | Integration: suíte existente de export confirma o documento gerado | `src/openapi-export.integration-spec.ts` |

**Dependencies:** SI-03.11, SI-03.12, SI-03.14, SI-03.15 (todos os fluxos implementados)

**Acceptance criteria:**

- Um vídeo de cerca de 6 MiB enviado em 2 partes direto ao RustFS, concluído via API, chega a `ready` em até 60 s com `duration_seconds` próximo de 2 e `metadata.width = 320`.
- Para esse vídeo, `GET /videos/public/{public_id}/stream` com `Range: bytes=0-99` retorna `206` com 100 bytes idênticos aos 100 primeiros bytes do arquivo enviado.
- Para esse vídeo, `GET /videos/public/{public_id}/download` leva (seguindo o redirect, ou diretamente no plano B) ao arquivo com `Content-Disposition: attachment`.
- Um arquivo de texto enviado como `video/mp4` chega a `failed` com `failure_reason` iniciado por `invalid_video_file:`.
- `openapi.json` versionado contém os 9 caminhos/métodos da fase e o `npm run openapi:export` não gera diff depois de commitado.
- Depois das suítes, o bucket `${STORAGE_BUCKET}-test` está vazio e não há chaves com o prefixo `${QUEUE_PREFIX}-test` no Valkey.

---

## Technical Specifications

### Data Model

#### Video (tabela `videos`)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | Usado na chave do storage `videos/{videoId}/...` (per `phase-03-videos/TD-02`) e como `jobId` da fila (per `phase-03-videos/TD-09`) |
| public_id | varchar(11) | unique, not null | Identificador público: 11 caracteres base64url de `crypto.randomBytes(8)` (64 bits); nova tentativa em colisão do `UNIQUE` (per `phase-03-videos/TD-10`) |
| channel_id | uuid | FK → channels.id, not null, `ON DELETE CASCADE` | Canal do usuário autenticado que iniciou o upload; dono = `channels.user_id` |
| status | enum `videos_status_enum` | not null, default `'draft'`, values: `'draft'`, `'processing'`, `'ready'`, `'failed'` | `draft` = pré-cadastro com upload ainda não concluído; `processing` = upload concluído e job enfileirado; `ready`/`failed` finais (per `phase-03-videos/TD-05`). Todo vídeo permanece não publicado até a Fase 04 (campo de publicação separado, criado na Fase 04) |
| original_filename | varchar(255) | not null | Nome declarado no início do upload; usado no `filename` do download (sanitizado) |
| mime_type | varchar(100) | not null | Um de `video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska` (per revisão MD-1 de `phase-03-videos/TD-04`) |
| size_bytes | bigint | not null, check `size_bytes BETWEEN 1 AND 10737418240` | Tamanho declarado; transformer `bigint ↔ number` (seguro até 2^53) |
| storage_key | varchar(512) | not null | `videos/{videoId}/original` (per `phase-03-videos/TD-02`) |
| upload_id | varchar(1024) | nullable | `UploadId` do multipart; preenchido em `draft`, zerado após conclusão ou abort (per `phase-03-videos/TD-04`, `phase-03-videos/TD-06`) |
| part_size_bytes | integer | not null | Tamanho fixo de parte calculado pela API (64 MiB = 67 108 864) |
| part_count | integer | not null, check `part_count BETWEEN 1 AND 10000` | `ceil(size_bytes / part_size_bytes)` |
| thumbnail_key | varchar(512) | nullable | `videos/{videoId}/thumbnail.jpg`, preenchido pelo worker (per `phase-03-videos/TD-07`) |
| duration_seconds | double precision | nullable | Duração extraída pelo `ffprobe` (per revisão AMB-1 de `phase-03-videos/TD-05`) |
| metadata | jsonb | nullable | `VideoMetadata` (abaixo), preenchido pelo worker (per revisão AMB-1 de `phase-03-videos/TD-05` e `phase-03-videos/TD-07`) |
| failure_reason | text | nullable | Motivo legível da falha (per `phase-03-videos/TD-08`, `phase-03-videos/TD-09`); valores de domínio listados em `#### Failure reasons` |
| created_at | timestamptz | not null, auto-generated | `@CreateDateColumn`; base do corte de expiração de rascunhos (per `phase-03-videos/TD-06`) |
| updated_at | timestamptz | not null, auto-generated | `@UpdateDateColumn` |

**Relations:** Video → Channel (many-to-one, owning side via `channel_id`); Channel → Video (one-to-many, sem cascade de persistência a partir do Channel).
**Indexes:** `(public_id)` unique; `(channel_id)` FK; `(status, created_at)` para a varredura de rascunhos abandonados (per `phase-03-videos/TD-06`).
**Migration:** `CreateVideos` (TypeORM, gerada com `npm run migration:generate` e revisada), cria o enum `videos_status_enum`, a tabela, as checks e os índices; `down` desfaz na ordem inversa.

#### VideoMetadata (forma do jsonb `metadata`)

| Key | Type | Origem no `ffprobe -print_format json -show_format -show_streams` |
|-----|------|------------------------------------------------------------------|
| width | integer | `streams[codec_type=video].width` |
| height | integer | `streams[codec_type=video].height` |
| video_codec | string | `streams[codec_type=video].codec_name` |
| audio_codec | string \| null | `streams[codec_type=audio].codec_name`, `null` sem trilha de áudio |
| bitrate | integer \| null | `format.bit_rate` (bits/s), `null` se ausente |
| container | string | `format.format_name` |
| frame_rate | number \| null | `streams[codec_type=video].avg_frame_rate` (fração `n/d` convertida; `null` se `0/0`) |
| size_bytes | integer | `format.size` (tamanho real do objeto) |

`duration_seconds` vem de `format.duration` (fallback `streams[codec_type=video].duration`); ausência de stream de vídeo ou de duração é arquivo inválido (falha permanente, per revisão MD-1 de `phase-03-videos/TD-09`).

#### Failure reasons (valores de `failure_reason`)

| Valor | Quem grava | Quando |
|-------|-----------|--------|
| `upload_expired` | job de expiração (`video-maintenance`) | Rascunho `draft` mais antigo que `UPLOAD_EXPIRATION_HOURS`; multipart abortado (per `phase-03-videos/TD-06`) |
| `upload_size_mismatch` | API (conclusão do upload) | `HeadObject.ContentLength` diferente do `size_bytes` declarado (per revisão MD-1 de `phase-03-videos/TD-04`) |
| `upload_too_large` | API (conclusão do upload) | `HeadObject.ContentLength` acima de 10 737 418 240 bytes (per revisão MD-1 de `phase-03-videos/TD-04`) |
| `invalid_video_file: {detalhe}` | worker | `ffprobe` não reconhece o arquivo como vídeo (sem retentativas, per revisão MD-1 de `phase-03-videos/TD-09`) |
| `processing_failed: {mensagem do último erro}` | worker | Retentativas esgotadas em erro transitório (per `phase-03-videos/TD-09`) |

#### Storage (bucket e chaves)

Não é tabela; contrato de organização do object storage (per `phase-03-videos/TD-01` revisão RustFS, `phase-03-videos/TD-02`, `phase-03-videos/TD-14`):

| Item | Valor |
|------|-------|
| Servidor (dev/teste) | RustFS `rustfs/rustfs:1.0.5@sha256:b81d16a90ee25bd9511280127ca1471788c6e874cf0f0da759645f46b2dc1d74`, serviço Compose `rustfs`, portas 9000 (S3) e 9001 (console) |
| Bucket | único e privado, `STORAGE_BUCKET` (dev: `streamtube`); testes usam `${STORAGE_BUCKET}-test` |
| Original | `videos/{videoId}/original` |
| Thumbnail | `videos/{videoId}/thumbnail.jpg` (`image/jpeg`) |
| Endpoint interno | `STORAGE_ENDPOINT=http://rustfs:9000` (API e worker; chamadas S3 e URL pré-assinada lida pelo `ffprobe`/`ffmpeg`, per `phase-03-videos/TD-08`) |
| Endpoint público | `STORAGE_PUBLIC_ENDPOINT=http://localhost:9000` (só para assinar URLs entregues ao cliente: partes do upload e download; o `Host` faz parte da assinatura). Nos testes é sobrescrito pelo endpoint interno, porque o "cliente" do teste roda dentro do container |
| Endereçamento | `forcePathStyle: true`, região `STORAGE_REGION` (default `us-east-1`) |

### API Contracts

Todas as respostas JSON usam `snake_case`, como nas fases anteriores. `VideoResponse` (usado por `POST /videos`, `POST /videos/:id/upload/complete` e `GET /videos/:id`):

- id: string (uuid)
- public_id: string (11 caracteres base64url)
- status: `'draft' | 'processing' | 'ready' | 'failed'`
- original_filename: string
- mime_type: string
- size_bytes: number
- duration_seconds: number | null
- metadata: `VideoMetadata` | null (ver `### Data Model`)
- has_thumbnail: boolean
- failure_reason: string | null
- created_at: string (ISO-8601)
- updated_at: string (ISO-8601)

`SignedPart`: `{ part_number: number, url: string }`; as URLs são `UploadPartCommand` pré-assinadas com o endpoint público e `expiresIn = UPLOAD_PART_URL_EXPIRATION_SECONDS` (default 3600, per `phase-03-videos/TD-04`). O cliente envia cada parte com `PUT {url}` direto ao storage e guarda o cabeçalho `ETag` da resposta; o arquivo nunca passa pela API.

#### POST /videos (SI-03.7)

Inicia o upload: cria o rascunho (`draft`), inicia o multipart e assina todas as partes (per `phase-03-videos/TD-04`, `phase-03-videos/TD-05`, `phase-03-videos/TD-10`).

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- filename: string, required: 1 a 255 caracteres
- mime_type: string, required: um de `video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska`
- size_bytes: integer, required: 1 a 10737418240

**Response 201:**
- video: `VideoResponse` (status `draft`)
- upload: `{ part_size_bytes: number, part_count: number, parts: SignedPart[], expires_at: string (ISO-8601) }`

**Error responses:**
- 400 VALIDATION_ERROR: MIME fora da lista, `size_bytes` ausente, não inteiro, menor que 1 ou maior que 10737418240, `filename` vazio ou longo demais
- 401: access token ausente ou inválido

---

#### GET /videos/:id/upload/parts (SI-03.8)

Lista as partes já recebidas pelo storage (`ListParts`) para o cliente retomar um upload interrompido (per `phase-03-videos/TD-04`).

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- parts: `Array<{ part_number: number, etag: string, size_bytes: number }>` em ordem crescente

**Error responses:**
- 400 VALIDATION_ERROR: `id` não é uuid
- 401: access token ausente ou inválido
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro usuário
- 409 VIDEO_NOT_IN_DRAFT: vídeo fora do status `draft`

---

#### POST /videos/:id/upload/parts (SI-03.8)

Reassina partes (URLs expiradas ou retomada) (per `phase-03-videos/TD-04`).

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- part_numbers: integer[], required: 1 a 10000 itens, únicos, cada um entre 1 e 10000

**Response 200:**
- parts: `SignedPart[]`
- expires_at: string (ISO-8601)

**Error responses:**
- 400 VALIDATION_ERROR: corpo inválido ou `id` não uuid
- 400 INVALID_PART_NUMBER: algum `part_number` maior que o `part_count` do vídeo
- 401: access token ausente ou inválido
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro usuário
- 409 VIDEO_NOT_IN_DRAFT: vídeo fora do status `draft`

---

#### POST /videos/:id/upload/complete (SI-03.9)

Conclui o multipart, confere o tamanho real (`HeadObject`) e enfileira o processamento (per `phase-03-videos/TD-04` revisão MD-1, `phase-03-videos/TD-05`, `phase-03-videos/TD-09`).

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- parts: `Array<{ part_number: integer 1..10000, etag: string não vazia }>`, required: 1 a 10000 itens; a API ordena por `part_number` antes do `CompleteMultipartUpload`

**Response 200:**
- `VideoResponse` com status `processing` (job `process-video` enfileirado com `jobId = videoId`)

**Error responses:**
- 400 VALIDATION_ERROR: corpo inválido ou `id` não uuid
- 400 INVALID_UPLOAD_PARTS: o storage rejeitou a lista de partes (`InvalidPart`, `InvalidPartOrder`, `EntityTooSmall`); o vídeo continua `draft` e o upload pode ser corrigido
- 401: access token ausente ou inválido
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro usuário
- 409 VIDEO_NOT_IN_DRAFT: vídeo fora do status `draft` (inclui segunda chamada de conclusão)
- 422 UPLOAD_SIZE_MISMATCH: tamanho real diferente do declarado; o objeto é apagado e o vídeo vira `failed` (`upload_size_mismatch`), sem job
- 422 UPLOAD_TOO_LARGE: tamanho real acima de 10737418240; o objeto é apagado e o vídeo vira `failed` (`upload_too_large`), sem job

---

#### GET /videos/:id (SI-03.13)

Consulta do dono, usada para acompanhar o processamento.

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- `VideoResponse`

**Error responses:**
- 400 VALIDATION_ERROR: `id` não é uuid
- 401: access token ausente ou inválido
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro usuário

---

#### GET /videos/public/:publicId (SI-03.13)

Dados públicos do vídeo `ready` acessado pelo link (per `phase-03-videos/TD-13`).

**Request path parameters:**
- publicId: string: `^[A-Za-z0-9_-]{11}$`

**Response 200:**
- public_id: string
- mime_type: string
- duration_seconds: number
- metadata: `VideoMetadata`
- created_at: string (ISO-8601)

**Error responses:**
- 404 VIDEO_NOT_FOUND: `publicId` com formato inválido, inexistente ou vídeo fora de `ready` (mesma resposta para todos, sem revelar existência)

---

#### GET /videos/public/:publicId/stream (SI-03.14)

Streaming com suporte a `Range`, proxy do storage pela API (per `phase-03-videos/TD-11`, `phase-03-videos/TD-13`).

**Request headers:**
- Range: `bytes=start-end`, `bytes=start-` ou `bytes=-suffix`, optional (um único intervalo; múltiplos intervalos são tratados como ausência de `Range`)

**Response 206 (com `Range` válido):**
- Headers: `Content-Type` (mime do vídeo), `Content-Range: bytes {start}-{end}/{size}`, `Content-Length`, `Accept-Ranges: bytes`, `ETag`
- Body: bytes do intervalo, repassados do `GetObject` com o mesmo `Range`

**Response 200 (sem `Range`):**
- Headers: `Content-Type`, `Content-Length`, `Accept-Ranges: bytes`, `ETag`
- Body: arquivo completo em stream (nunca carregado em memória)

**Error responses:**
- 404 VIDEO_NOT_FOUND: como em `GET /videos/public/:publicId`
- 416 RANGE_NOT_SATISFIABLE: `Range` fora do tamanho do objeto; header `Content-Range: bytes */{size}`

---

#### GET /videos/public/:publicId/thumbnail (SI-03.14)

**Response 200:**
- Headers: `Content-Type: image/jpeg`, `Content-Length`, `Cache-Control: public, max-age=300`
- Body: `videos/{videoId}/thumbnail.jpg` em stream

**Error responses:**
- 404 VIDEO_NOT_FOUND: como em `GET /videos/public/:publicId` (inclui vídeo `ready` sem `thumbnail_key`)

---

#### GET /videos/public/:publicId/download (SI-03.15)

Download por redirect para URL pré-assinada com `attachment` (per `phase-03-videos/TD-12`, `phase-03-videos/TD-13`).

**Response 302:**
- Header `Location`: `GetObjectCommand` pré-assinado com o endpoint público, `ResponseContentDisposition: attachment; filename="{original_filename sanitizado}"` e `expiresIn = DOWNLOAD_URL_EXPIRATION_SECONDS` (default 300)

**Error responses:**
- 404 VIDEO_NOT_FOUND: como em `GET /videos/public/:publicId`

**Plano B (revisão de `phase-03-videos/TD-12`):** se o RustFS não honrar `response-content-disposition`, o mesmo endpoint passa a responder `200` em stream com `Content-Disposition: attachment; filename="..."`, sem mudar o caminho; o desvio é registrado no `progress.md`.

#### Validation Rules: Upload de vídeo

| Field | Rule | Error |
|-------|------|-------|
| filename | string, 1 a 255 caracteres (`@IsString`, `@Length(1, 255)`) | VALIDATION_ERROR |
| mime_type | `@IsIn(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'])` | VALIDATION_ERROR |
| size_bytes | `@IsInt`, `@Min(1)`, `@Max(10737418240)` | VALIDATION_ERROR |
| part_numbers | `@IsArray`, `@ArrayMinSize(1)`, `@ArrayMaxSize(10000)`, `@ArrayUnique`, cada item `@IsInt @Min(1) @Max(10000)` | VALIDATION_ERROR |
| parts | `@IsArray`, `@ArrayMinSize(1)`, `@ArrayMaxSize(10000)`, `@ValidateNested({ each: true })` com `part_number` (`@IsInt @Min(1) @Max(10000)`) e `etag` (`@IsString @IsNotEmpty`) | VALIDATION_ERROR |
| :id | `ParseUUIDPipe` | VALIDATION_ERROR (400) |

Todos os endpoints recebem decoradores `@nestjs/swagger` explícitos (`@ApiOperation`, `@ApiResponse` por status, `@ApiBody`, `@ApiParam`, `@ApiHeader` para `Range`) com o envelope de erro de `phase-02-auth/TD-07`, per `openapi-docs-nestjs/TD-01`, e o `openapi.json` versionado é regenerado per `openapi-docs-nestjs/TD-02`.

### Authorization Matrix

O `JwtAuthGuard` global da Fase 02 continua protegendo tudo por padrão; os endpoints públicos usam `@Public()`. "Dono" = usuário autenticado cujo canal (`channels.user_id`) é o `channel_id` do vídeo; vídeo de outro usuário responde `404 VIDEO_NOT_FOUND` (não `403`), para não revelar existência.

| Endpoint | Anonymous | Authenticated | Owner | Notes |
|----------|-----------|---------------|-------|-------|
| POST /videos | ✗ | ✓ | n/a | O vídeo nasce no canal do usuário autenticado |
| GET /videos/:id/upload/parts | ✗ | ✗ (404) | ✓ | Só em `draft` |
| POST /videos/:id/upload/parts | ✗ | ✗ (404) | ✓ | Só em `draft` |
| POST /videos/:id/upload/complete | ✗ | ✗ (404) | ✓ | Só em `draft` |
| GET /videos/:id | ✗ | ✗ (404) | ✓ | Qualquer status |
| GET /videos/public/:publicId | ✓ | ✓ | ✓ | Só vídeos `ready` (per `phase-03-videos/TD-13`) |
| GET /videos/public/:publicId/stream | ✓ | ✓ | ✓ | Só vídeos `ready`; acesso por link, protegido pela não enumerabilidade do `public_id` (per `phase-03-videos/TD-13`, `phase-03-videos/TD-10`) |
| GET /videos/public/:publicId/thumbnail | ✓ | ✓ | ✓ | Só vídeos `ready` |
| GET /videos/public/:publicId/download | ✓ | ✓ | ✓ | Só vídeos `ready` |

**Exposição registrada (per `phase-03-videos/TD-13`):** até a Fase 04 introduzir publicação e visibilidade, todo vídeo `ready` é acessível por quem tiver o link, comportamento equivalente a "não listado". Aceito apenas para o ambiente de desenvolvimento desta fase; a Fase 04/05 deve acrescentar a regra de visibilidade nos mesmos endpoints.

### Error Catalog

Formato herdado de `phase-02-auth/TD-07`: `{ statusCode: number, error: string, message: string }`, com `error` carregando o código abaixo (validação: `VALIDATION_ERROR` com `message` em array). Novas exceções estendem `DomainException` em `src/common/exceptions/domain.exception.ts`.

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| VIDEO_NOT_FOUND | 404 | Video not found | Vídeo inexistente, de outro usuário (rotas de dono) ou fora de `ready`/`publicId` inválido (rotas públicas) |
| VIDEO_NOT_IN_DRAFT | 409 | Video upload is not in progress | Reassinar, listar partes ou concluir upload com vídeo fora de `draft` |
| INVALID_PART_NUMBER | 400 | Part number exceeds the upload part count | `POST /videos/:id/upload/parts` com `part_number > part_count` |
| INVALID_UPLOAD_PARTS | 400 | Uploaded parts are invalid or incomplete | `CompleteMultipartUpload` rejeitado pelo storage (`InvalidPart`, `InvalidPartOrder`, `EntityTooSmall`) |
| UPLOAD_SIZE_MISMATCH | 422 | Uploaded file size does not match the declared size | Conclusão com `HeadObject.ContentLength != size_bytes`; vídeo vira `failed` |
| UPLOAD_TOO_LARGE | 422 | Uploaded file exceeds the 10GB limit | Conclusão com `HeadObject.ContentLength > 10737418240`; vídeo vira `failed` |
| RANGE_NOT_SATISFIABLE | 416 | Requested range not satisfiable | `GET /videos/public/:publicId/stream` com `Range` além do tamanho; responde também `Content-Range: bytes */{size}` |

Erros do SDK S3 sem mapeamento de domínio (storage indisponível etc.) seguem como 500 padrão do Nest; o adapter de storage converte `NoSuchKey`/`NotFound`/`NoSuchUpload` em erros internos tipados (`StorageObjectNotFoundError`, `StorageUploadNotFoundError`) que o serviço de vídeos traduz para os códigos acima.

### Events/Messages

Servidor da fila: Valkey com tag fixa (preferencialmente por digest, publicada há pelo menos 7 dias, aprovada no `trivy image --severity HIGH,CRITICAL --ignore-unfixed`), serviço Compose `valkey`, `maxmemory-policy noeviction`, sem porta publicada no host (per `phase-03-videos/TD-03`). Conexão via `BullModule.forRootAsync` lendo `queueConfig` (`QUEUE_HOST=valkey`, `QUEUE_PORT=6379`, `QUEUE_PREFIX`, default `streamtube`; testes usam `${QUEUE_PREFIX}-test`, per `phase-03-videos/TD-14`).

#### Fila `video-processing` / job `process-video`

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** `VideoProcessingQueue` (wrapper de `@InjectQueue('video-processing')`, chamado por `VideosService.completeUpload`) (per `phase-03-videos/TD-03`, `phase-03-videos/TD-05`)
**Consumer:** `VideoProcessingProcessor` (`@Processor('video-processing', { concurrency: VIDEO_WORKER_CONCURRENCY })`, registrado só no `WorkerModule` carregado por `src/worker.ts` no container `video-worker`; instanciado in-process nos testes) (per `phase-03-videos/TD-07`, `phase-03-videos/TD-14`)
**Trigger:** conclusão do upload com tamanho validado; o vídeo passa a `processing` na mesma operação que enfileira.
**Processamento:** carrega o vídeo; se não estiver em `processing`, encerra sem efeito (idempotência). Gera URL pré-assinada interna de `GetObject` (`expiresIn` 3600) e roda `ffprobe -v error -print_format json -show_format -show_streams {url}` via `spawn` (sem shell); depois `ffmpeg -ss {min(1, duração/2)} -i {url} -frames:v 1 -vf scale=640:-2 -f image2 -c:v mjpeg pipe:1`, envia o JPEG para `videos/{videoId}/thumbnail.jpg` e grava `duration_seconds`, `metadata`, `thumbnail_key`, `status = 'ready'`, `failure_reason = null` (per `phase-03-videos/TD-07`, `phase-03-videos/TD-08`).
**Delivery semantics:** at-least-once; `jobId = videoId` deduplica enquanto o job existir, `attempts: 3`, `backoff: { type: 'exponential', delay: 1000 }`, `removeOnComplete: true`, `removeOnFail: { age: 86400 }` (per `phase-03-videos/TD-09`).
**Falhas:** `ffprobe` sem stream de vídeo, sem duração ou com saída não reconhecida → `UnrecoverableError` (sem retentativa) e `failed` com `invalid_video_file: {detalhe}`; demais erros são transitórios e relançados; no evento `@OnWorkerEvent('failed')`, quando `err` é `UnrecoverableError` ou `job.attemptsMade >= job.opts.attempts`, grava `status = 'failed'` e `failure_reason` (per `phase-03-videos/TD-09` revisão MD-1).

#### Fila `video-maintenance` / job `expire-abandoned-uploads`

**Payload:**

```json
{}
```

**Producer:** `queue.upsertJobScheduler('expire-abandoned-uploads', { every: UPLOAD_EXPIRATION_SWEEP_INTERVAL_MS }, { name: 'expire-abandoned-uploads', data: {}, opts: { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true, removeOnFail: { age: 86400 } } })`, chamado no bootstrap do worker (idempotente) (per `phase-03-videos/TD-06`, `phase-03-videos/TD-03`)
**Consumer:** `UploadExpirationProcessor` (`@Processor('video-maintenance')`, só no `WorkerModule`)
**Trigger:** agendamento periódico (default a cada 1 h).
**Processamento:** busca vídeos `draft` com `created_at < now() - UPLOAD_EXPIRATION_HOURS` (default 24), em lotes de 100; para cada um chama `AbortMultipartUpload` (ignorando `NoSuchUpload`), grava `status = 'failed'`, `failure_reason = 'upload_expired'`, `upload_id = null` com update condicional `WHERE status = 'draft'` (não sobrescreve vídeo concluído no meio da varredura).
**Delivery semantics:** at-least-once; a operação é idempotente.

---

## Dependency Map

```
SI-03.1 (root, lint zerado)
└── SI-03.2: infraestrutura do Compose, FFmpeg e dependências
    ├── SI-03.3: namespaces de configuração
    │   ├── SI-03.4: storage S3 (RustFS)
    │   └── SI-03.5: fila BullMQ e produtor
    └── SI-03.6: entidade Video, migration e repositório

SI-03.4 + SI-03.5 + SI-03.6
└── SI-03.7: POST /videos (rascunho + multipart)
    ├── SI-03.8: listar e reassinar partes
    │   └── SI-03.9: conclusão do upload + enfileiramento (também depende de SI-03.5)
    └── SI-03.13: GET /videos/:id e GET /videos/public/:publicId
        ├── SI-03.14: streaming com Range e thumbnail (também depende de SI-03.4)
        └── SI-03.15: download por redirect (também depende de SI-03.4)

SI-03.2 + SI-03.4 + SI-03.6
└── SI-03.10: serviço FFmpeg

SI-03.9 + SI-03.10
└── SI-03.11: worker e processor process-video
    └── SI-03.12: expiração de uploads abandonados

SI-03.11 + SI-03.12 + SI-03.14 + SI-03.15
└── SI-03.16: fluxo completo e2e, OpenAPI e documentação
```

Ordem linear de implementação: SI-03.1 → SI-03.2 → SI-03.3 → SI-03.4, SI-03.5, SI-03.6 (paralelos) → SI-03.7 → SI-03.8 → SI-03.9 → SI-03.10 → SI-03.11 → SI-03.12 → SI-03.13 → SI-03.14 → SI-03.15 → SI-03.16

---

## Deliverables

- [ ] SI-03.1 — Corrigir erros de lint pré-existentes nos testes
- [ ] SI-03.2 — Infra: serviços Valkey, RustFS e video-worker no Compose com FFmpeg
- [ ] SI-03.3 — Namespaces de configuração de storage, fila e vídeos
- [ ] SI-03.4 — Módulo de storage S3 (RustFS) com multipart, assinatura e leitura por Range
- [ ] SI-03.5 — Módulo de fila BullMQ e produtor do processamento
- [ ] SI-03.6 — Entidade Video, migration e repositório com identificador público único
- [ ] SI-03.7 — Endpoint POST /videos (início do upload e pré-cadastro como rascunho)
- [ ] SI-03.8 — Endpoints de partes do upload (listar e reassinar)
- [ ] SI-03.9 — Endpoint POST /videos/:id/upload/complete (conclusão, conferência de tamanho e enfileiramento)
- [ ] SI-03.10 — Serviço FFmpeg: extração de duração, metadados e frame de thumbnail
- [ ] SI-03.11 — Worker de processamento: entrypoint próprio e processor do job process-video
- [ ] SI-03.12 — Expiração de uploads abandonados (job agendado)
- [ ] SI-03.13 — Endpoints de consulta: GET /videos/:id (dono) e GET /videos/public/:publicId
- [ ] SI-03.14 — Endpoints de streaming com Range (206) e de thumbnail
- [ ] SI-03.15 — Endpoint de download (302 para URL pré-assinada com attachment)
- [ ] SI-03.16 — Fluxo completo upload, processamento e streaming com a infra real, e documentação da fase

**Full test suites:**

- [ ] Backend tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`cd nestjs-project && docker compose exec nestjs-api npm run lint`)
- [ ] Project builds successfully, including the worker entrypoint (`cd nestjs-project && docker compose exec nestjs-api npm run build` produces `dist/main.js` and `dist/worker.js`)

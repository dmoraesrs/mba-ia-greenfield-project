# phase-03-videos — Progress

**Status:** completed
**SIs:** 16/16 completed

**Verificação final (2026-11-20):**

- `docker compose exec nestjs-api npm test -- --runInBand`: 45 suítes, 304 testes passando (baseline antes da fase: 23 suítes, 144 testes).
- `docker compose exec nestjs-api npm run test:e2e`: 10 suítes, 87 testes passando (baseline: 3 suítes, 52 testes).
- `npx tsc --noEmit`: ok. `npm run lint`: 0 erros (23 warnings pré-existentes, `--fix` não alterou arquivos).
- `npm run build`: gera `dist/main.js` e `dist/worker.js`.
- Após as suítes: bucket `streamtube-test` sem objetos e sem uploads multipart abertos; nenhuma chave `streamtube-test:*` no Valkey.
- Correções feitas durante a verificação final: o script `test:e2e` não tinha `--runInBand` (o `CLAUDE.md` já dizia que tinha) e as 10 suítes e2e em paralelo se contaminavam pelo banco compartilhado (commit `be415d0`); `emptyTestBucket` passou a abortar uploads multipart abertos (commit `a28e3b4`).

### SI-03.1 — Corrigir erros de lint pré-existentes nos testes
- **Status:** completed
- **Tests:** regressão sem alteração de contagem: 144 unit/integration (23 suítes) e 52 e2e (3 suítes) passando antes e depois; `eslint` com 0 erros (23 warnings); `tsc --noEmit` ok
- **Observations:**
  - Contagem inicial: 150 erros. Por regra: no-unsafe-member-access 76, no-unsafe-assignment 41, unbound-method 19, no-unsafe-return 6, require-await 4, no-unused-vars 2, no-unsafe-call 1, no-unsafe-function-type 1. Por arquivo: test/auth.e2e-spec.ts 48, src/auth/auth.service.spec.ts 45, src/mail/mail.service.integration-spec.ts 16, src/channels/channels.service.spec.ts 15, src/auth/auth.service.integration-spec.ts 7, src/common/filters/domain-exception.filter.spec.ts 7, src/channels/channels.service.ts 6, src/common/filters/validation-exception.filter.spec.ts 2, src/config/env.validation.integration-spec.ts 2, src/test/create-test-data-source.ts 1, src/users/users.service.integration-spec.ts 1.
  - Desvio do AC "diff só em testes": 6 erros estavam em código de produção (`src/channels/channels.service.ts`, cast `as any` em `isPgUniqueViolationOnColumn`). Corrigido só na tipagem (`QueryFailedError & { code?: unknown; detail?: unknown }`), sem mudar comportamento, no mesmo commit `chore:` (e9f4915), porque o AC de 0 erros não seria atingível sem isso.
  - `src/test/mailpit.ts` ganhou interfaces de retorno (`MailpitMessageSummary`, `MailpitMessageDetail`); `unbound-method` resolvido com interfaces locais de mock baseadas em `jest.MockedFunction` (o `jest.Mocked<T>` ainda dispara a regra).
  - A suíte `src/database/migrations.integration-spec.ts` só passa com o schema zerado (derruba tabelas, mas não o enum `verification_tokens_type_enum`); com falha nela o Jest não encerra (handles abertos). Antes das suítes completas é preciso `docker compose exec db psql -U streamtube -d streamtube -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`. O banco de teste é o mesmo `streamtube` do desenvolvimento (sem `DB_DATABASE` separado). Fora do escopo; registrar como tarefa futura.

### SI-03.2 — Infra: serviços Valkey, RustFS e video-worker no Compose com FFmpeg
- **Status:** completed
- **Tests:** no tests (infra); ACs verificados: serviços `healthy`, `maxmemory-policy noeviction`, `ffprobe`/`ffmpeg` 5.1.9 no `nestjs-api`, quatro pacotes com versão exata
- **Observations:**
  - **Gate Trivy (2026-11-20, `--severity HIGH,CRITICAL --ignore-unfixed`):** `valkey/valkey:9.1.3-alpine@sha256:bf09d58e96d6b4524a15396b65b242bbe18beebbcc15a04d8ee75ddac62fae0b` (publicada em 2026-10-27; a 9.1.4 de 2026-11-18 está no cooldown) = 0 achados; `rustfs/rustfs:1.0.5@sha256:b81d16a90ee25bd9511280127ca1471788c6e874cf0f0da759645f46b2dc1d74` = 0 achados; imagem do `nestjs-api`/`video-worker` (`Dockerfile.dev`) = 0 achados após ajuste.
  - A base `node:25.6.0-slim` (fixada agora por digest `sha256:3746b7c7...988730`) reprovou o gate com 28 HIGH e 6 CRITICAL corrigíveis (pacotes Debian como `libgnutls30`, `perl-base`, `libpcre2-8-0`, e dependências do npm global como `tar`, `minimatch`, `pacote`). Corrigido no `Dockerfile.dev` com `apt-get upgrade -y` e `npm install -g npm@11.21.2` (publicado em 2026-11-04), sem trocar o major do Node. O código do projeto não entra na imagem (volume).
  - Node 25 é uma linha ímpar já fora de suporte em 2026-11; migrar para a LTS (24 ou 26) é tarefa futura fora do escopo.
  - O AC "nenhuma imagem sem tag fixa" exigiu fixar também `postgres:17` e `axllent/mailpit` (sem tag): fixados exatamente nas versões já em execução (`postgres:17.11@sha256:ff87...b3d4f`, `axllent/mailpit:v1.33.0@sha256:9b3a...5231`), sem mudança de comportamento.
  - RustFS: credenciais por `RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY` (confirmadas no `entrypoint.sh` e no `rustfs server --help` da imagem), interpoladas de `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` do `.env` (o compose falha cedo se faltarem); console habilitado com `RUSTFS_CONSOLE_ENABLE=true`; healthcheck `curl -fsS http://localhost:9000/health`. Portas 9000/9001 e 6379 livres no host (`lsof` em 2026-11-20); Valkey sem porta publicada.
  - `.env` local recebeu credenciais aleatórias do storage (fora do Git); `.env.example` com placeholders `change-me-*`.
  - `video-worker` fica em `Restarting` até existir o script `start:worker:dev` (SI-03.11), como previsto no AC.

### SI-03.3 — Namespaces de configuração de storage, fila e vídeos
- **Status:** completed
- **Tests:** 17 passing (`env.validation.integration-spec.ts` + `storage.config.spec.ts`)
- **Observations:**
  - `STORAGE_ENDPOINT` e `STORAGE_PUBLIC_ENDPOINT` também ficaram obrigatórios (além de bucket e credenciais), com validação de URI; `STORAGE_REGION` tem default `us-east-1`.
  - `requiredEnv` do teste de validação existente recebeu as `STORAGE_*` para continuar representando um ambiente válido.

### SI-03.4 — Módulo de storage S3 (RustFS) com multipart, assinatura e leitura por Range
- **Status:** completed
- **Tests:** 18 passing (`storage.service.integration-spec.ts`, `storage.errors.spec.ts`, `storage.module.spec.ts`)
- **Observations:**
  - **Compatibilidade RustFS confirmada:** multipart por URLs assinadas, `ListParts`, `Range` (`ContentRange bytes 0-9/{total}`) e `response-content-disposition` funcionam. O RustFS honra `ResponseContentDisposition`, então o plano B do TD-12 não é necessário e o SI-03.15 segue com redirect 302.
  - O `@aws-sdk/client-s3` 3.1168.0 calcula checksum por padrão (`requestChecksumCalculation: WHEN_SUPPORTED`) e embute `x-amz-checksum-crc32` de corpo vazio nas URLs assinadas de `UploadPart`, o que faz o PUT do cliente falhar com `400 BadDigest`. Os dois clientes usam `requestChecksumCalculation`/`responseChecksumValidation: 'WHEN_REQUIRED'`.
  - Chamadas ao SDK passam por um wrapper `run()` que aplica `mapStorageError`; `HeadBucket` 404 (nome `NotFound`) dispara o `CreateBucket` no `onModuleInit`.

### SI-03.5 — Módulo de fila BullMQ e produtor do processamento
- **Status:** completed
- **Tests:** 4 passing (`queue.module.spec.ts`, `video-processing.queue.integration-spec.ts`)
- **Observations:**
  - **Desvio de versão:** `@nestjs/bullmq` instalado em `11.0.5`, não `12.0.1`. A 12.x é só ESM e o Jest CommonJS do projeto não a carrega; a 11.0.5 é CommonJS, corresponde ao NestJS 11 e aceita `bullmq` ^6. Registrado no `library-refs.md`.
  - **Dependência nova:** `ioredis@5.11.1`. Na `bullmq` 6 o `ioredis` é peer opcional e sem ele a fila não conecta; a `6.0.0` conflita com o peer opcional `ioredis@^5.0.4` do `typeorm@0.3.28`.
  - `queue.module.spec.ts` (unit) abre conexão com o Valkey ao instanciar a `Queue` durante o `compile()`; é efeito do próprio `@nestjs/bullmq` e foi mantido como teste de compilação previsto no plano.
  - `ALL_QUEUES` foi adicionado em `queue.constants.ts` para o `obliterateTestQueues()` percorrer as duas filas.

### SI-03.6 — Entidade Video, migration e repositório com identificador público único
- **Status:** completed
- **Tests:** 31 passing (`video.entity.integration-spec.ts`, `videos.repository.integration-spec.ts`, `public-id.spec.ts`, `migrations.integration-spec.ts`)
- **Observations:**
  - Migration `1795148126778-CreateVideos` gerada pelo CLI contra banco zerado e migrado; `migration:revert` remove a tabela `videos` e o tipo `videos_status_enum`, e `migration:run` reaplica.
  - Checks, unique e índices têm nome explícito na entidade (`UQ_videos_public_id`, `CHK_videos_size_bytes`, `CHK_videos_part_count`, `IDX_videos_channel_id`, `IDX_videos_status_created_at`), para o repositório identificar a colisão de `public_id` pelo nome da constraint e para o `synchronize` dos DataSources de teste criar as mesmas restrições.
  - O lado inverso `Channel.videos` (`@OneToMany`) foi adiado para o SI-03.7: com `autoLoadEntities`, adicioná-lo antes de o `VideosModule` registrar `Video` quebraria o boot do `AppModule` e os e2e.
  - `migrations.integration-spec.ts` agora também derruba os tipos `videos_status_enum` e `verification_tokens_type_enum` no `beforeAll`, eliminando a dependência de banco zerado registrada no SI-03.1.
  - A colisão de `public_id` é forçada no teste com `jest.spyOn` no módulo `public-id`, sem gancho de teste no código de produção. `src/test/video-fixtures.ts` concentra a criação de usuário com canal e dos dados de rascunho para os SIs seguintes.

### SI-03.7 — Endpoint POST /videos (início do upload e pré-cadastro como rascunho)
- **Status:** completed
- **Tests:** 13 passing (`videos.service.spec.ts` 7, `videos.service.integration-spec.ts` 1, `videos.module.spec.ts` 1, `test/videos-create.e2e-spec.ts` 4); suíte unit/integration completa rodada também por causa da mudança em `Channel`
- **Observations:**
  - `Channel.videos` (`@OneToMany`) entrou aqui junto com o registro do `VideosModule`; os 10 DataSources de teste existentes (`ALL_ENTITIES`) receberam `Video`, senão o TypeORM falha ao montar os metadados de `Channel`.
  - `migrations.integration-spec.ts`: os `DROP TABLE ... CASCADE` do `beforeAll` rodavam em paralelo (`Promise.all`) e passaram a dar deadlock com a FK nova de `videos`; agora rodam em sequência. O deadlock deixava o banco num estado quebrado que derrubava as outras suítes.
  - MIME aceitos, limite de 10 GiB, tamanho de parte e motivos de falha ficaram em `src/videos/videos.constants.ts` (fonte única para `video.config.ts` e para o `CreateVideoDto`).
  - Helpers novos: `src/test/videos-test-module.ts` (`VideosModule` real sobre Postgres/RustFS/Valkey de teste) e `test/helpers/videos-e2e.ts` (app com overrides de storage e fila, `registerAndLogin` real e `resetThrottler`, já que o throttler global limita 10 req/min).
  - Incidente corrigido: um `prettier --write src` reformatou os templates `.hbs` de e-mail e eles entraram no commit; restaurados e o commit foi emendado antes de seguir.

### SI-03.8 — Endpoints de partes do upload (listar e reassinar)
- **Status:** completed
- **Tests:** 24 passing (`videos.service.spec.ts` + `videos.service.integration-spec.ts` 18, `test/videos-upload-parts.e2e-spec.ts` 6)
- **Observations:**
  - `test/helpers/videos-e2e.ts` ganhou override opcional do `videoConfig` (o spec usa partes de 5 MiB) e `putPart(url, size)`.
  - `listUploadedParts` traduz `StorageUploadNotFoundError` (multipart já abortado) em `VIDEO_NOT_IN_DRAFT`; `signParts` não consulta o storage (assinatura é local), então só valida dono, status e `part_count`.

### SI-03.9 — Endpoint POST /videos/:id/upload/complete (conclusão, conferência de tamanho e enfileiramento)
- **Status:** completed
- **Tests:** 35 passing (`videos.service.spec.ts` + `videos.service.integration-spec.ts` + `videos.module.spec.ts` 29, `test/videos-upload-complete.e2e-spec.ts` 6)
- **Observations:**
  - **Limitação conhecida (sem atomicidade Postgres/fila):** o vídeo passa a `processing` com update condicional e só depois o job é enfileirado. Se o `queue.add` falhar (Valkey indisponível), a requisição responde 500 e o vídeo fica `processing` sem job; uma nova chamada de conclusão responde `409 VIDEO_NOT_IN_DRAFT` e não reprocessa. Mitigações possíveis em fase futura: outbox no Postgres ou varredura de vídeos `processing` sem job.
  - `createVideosTestingModule` aceita override do `videoConfig`; o integration-spec do serviço passou a usar partes de 5 MiB para fazer uploads reais de 2 partes (o teste de `initiateUpload` com 134217728 bytes agora espera 26 partes).
  - A ordenação das partes acontece no serviço (verificada no teste unitário) e também no adapter de storage.

### SI-03.10 — Serviço FFmpeg: extração de duração, metadados e frame de thumbnail
- **Status:** completed
- **Tests:** 15 passing (`probe-parser.spec.ts` 10, `ffmpeg.service.integration-spec.ts` 5)
- **Observations:**
  - Entrada remota por URL pré-assinada interna do RustFS funciona com `ffprobe`/`ffmpeg` 5.1.9 (leitura por Range via HTTP); o fixture gera H.264 320x240 25 fps com `libx264` e AAC, disponíveis no `ffmpeg` do Debian.
  - Classificação de falhas: `stderr` com `Invalid data found when processing input`, `moov atom not found` ou `could not find codec parameters` vira `InvalidVideoFileError`; qualquer outra saída diferente de zero, timeout ou falha ao iniciar o binário vira `MediaToolError`. O padrão `Invalid argument` foi deixado de fora de propósito, porque também aparece em erros de URL/rede.
  - Teste de "falha de rede" usa uma porta fechada (`http://rustfs:9/...`), que o `ffprobe` reporta como erro de conexão (`MediaToolError`).

### SI-03.11 — Worker de processamento: entrypoint próprio e processor do job process-video
- **Status:** completed
- **Tests:** 16 passing (`video-processing.processor.spec.ts`, `video-processing.processor.integration-spec.ts` com worker in-process, `worker.module.spec.ts`); smoke do `videos-create.e2e-spec.ts` após o refactor do `AppModule`
- **Observations:**
  - `ConfigModule.forRoot` e `TypeOrmModule.forRootAsync` saíram do `AppModule` para `src/config/config-root.module.ts` e `src/database/database-root.module.ts`, reutilizados pelo `WorkerModule` sem duplicar configuração.
  - O `WorkerModule` importa o `UsersModule`: com `autoLoadEntities`, sem `Channel` e `User` registrados o TypeORM falha ao montar `Video#channel` (`Entity metadata for Video#channel was not found`), o que derrubava o container.
  - **Desvio do script do plano:** `start:worker:dev` é `nest start --watch --entryFile worker --path tsconfig.worker.json`, com `outDir` `dist-worker/` (no `.gitignore` e excluído do `tsconfig.json`/`tsconfig.build.json`). Com o mesmo `dist/` e `deleteOutDir: true`, um `npm run build` ou `start:dev` da API apagaria os arquivos do worker em execução (e vice-versa). `start:worker` (`node dist/worker`) e o `npm run build` continuam gerando `dist/worker.js`.
  - A concorrência vem de `VIDEO_WORKER_CONCURRENCY`, aplicada em `onApplicationBootstrap` (`worker.concurrency`), já que o decorator `@Processor` é estático. O log `Consuming queue "video-processing" (prefix ..., concurrency ...)` confirma a conexão em `docker compose logs video-worker`.
  - Confirmado no código da `bullmq` 6.7.6 que `attemptsMade` é incrementado antes do evento `failed`; a regra "última tentativa" é `attemptsMade >= opts.attempts`. Integração cobre: válido vira `ready` com thumbnail no bucket; texto vira `failed` com `invalid_video_file:` e `attemptsMade = 1`; erro transitório nas 3 tentativas vira `processing_failed:`; erro só na primeira termina `ready`.
  - `nestjs-project/CLAUDE.md` documenta `video-worker`, `valkey`, `rustfs`, logs e verificações de prontidão.

### SI-03.12 — Expiração de uploads abandonados (job agendado)
- **Status:** completed
- **Tests:** 5 passing (`upload-expiration.service.integration-spec.ts` 3, `upload-expiration.scheduler.integration-spec.ts` 1, `worker.module.spec.ts` 1)
- **Observations:**
  - A varredura busca lotes de 100 até vir um lote incompleto; cada vídeo do lote sai de `draft` pelo update condicional, então não há reprocessamento do mesmo lote. Erros do storage que não sejam `NoSuchUpload` interrompem a execução e entram na política de retentativa do job.
  - O AC "conclusão de vídeo expirado retorna 409" decorre do `findOwnedDraft` do `VideosService` (status `failed` vira `VIDEO_NOT_IN_DRAFT`), já coberto pelos testes do SI-03.8/SI-03.9.

### SI-03.13 — Endpoints de consulta: GET /videos/:id (dono) e GET /videos/public/:publicId
- **Status:** completed
- **Tests:** 37 passing (`videos.service.spec.ts` 31, `test/videos-get.e2e-spec.ts` 6)
- **Observations:**
  - `getPublic` valida o formato com `isValidPublicId` antes de consultar o banco; formato inválido, inexistente e fora de `ready` produzem o mesmo corpo `404 VIDEO_NOT_FOUND` (verificado byte a byte no e2e).
  - `seedVideo` e `SAMPLE_METADATA` em `src/test/video-fixtures.ts` semeiam vídeos em qualquer estado para os e2e de consulta, streaming e download.

### SI-03.14 — Endpoints de streaming com Range (206) e de thumbnail
- **Status:** completed
- **Tests:** 34 passing (`range.spec.ts`, `video-streaming.service.integration-spec.ts`, `domain-exception.filter.spec.ts` 26; `test/videos-public-stream.e2e-spec.ts` 8)
- **Observations:**
  - **Decisão de implementação:** `stream` e `thumbnail` usam `@SkipThrottle()`. O throttler global da Fase 02 (10 req/min por IP) devolvia `429` a partir da 11ª requisição, e um player faz muitas requisições `Range` por minuto (buffer e seek); o teste de 20 conexões abortadas expôs isso. Já havia precedente no `AppController`. `GET /videos/public/:publicId` e `download` continuam limitados; rever o limite das rotas públicas de leitura na fase de catálogo/reprodução.
  - Bug encontrado pelo teste unitário e corrigido: em `bytes={size}-` o fim implícito (`size - 1`) ficava menor que o início e o intervalo era descartado como malformado antes da checagem de 416.
  - O piping usa `pipeline(body, res)` em `src/videos/stream-response.ts`; o aborto do cliente destrói o `Body` do `GetObject` (socket do cliente S3 liberado) e `ERR_STREAM_PREMATURE_CLOSE` é ignorado. Depois de 20 abortos seguidos a API responde normalmente.
  - O tamanho usado no `Range` vem de `metadata.size_bytes` (fallback para `HeadObject`); `416` leva `Content-Range: bytes */{size}` pelo `DomainExceptionFilter`.
  - `src/test/fixtures.ts` ganhou `extractSampleFrame` e o helper interno `runFfmpeg`.

### SI-03.15 — Endpoint de download (302 para URL pré-assinada com attachment)
- **Status:** completed
- **Tests:** 12 passing (`content-disposition.spec.ts` + `videos.service.integration-spec.ts` 9, `test/videos-public-download.e2e-spec.ts` 3)
- **Observations:**
  - **Plano B não adotado:** o RustFS 1.0.5 honra `response-content-disposition` (verificado no SI-03.4 e de novo aqui seguindo o `Location`), então o endpoint responde `302`. O cenário 1.3 do spec (plano B) não foi implementado porque é condicional à adoção do plano B.
  - `attachmentDisposition` gera `filename` ASCII e `filename*` UTF-8 (RFC 6266) e remove aspas, barras e caracteres de controle por code point (sem regex de controle, que o ESLint proíbe).

### SI-03.16 — Fluxo completo upload, processamento e streaming com a infra real, e documentação da fase
- **Status:** completed
- **Tests:** 11 passing (`test/videos-flow.e2e-spec.ts` 2, `src/openapi-export.integration-spec.ts` 9); `npm run openapi:export` não gera diff depois de commitado
- **Observations:**
  - O `testsrc` comprime demais e `-b:v 24M` sozinho gerava 68 KiB. O fixture passou a aplicar ruído temporal (`noise=alls=100:allf=t+u`) e teto de taxa (`-maxrate`/`-bufsize`) quando recebe `videoBitrate`; o fluxo usa `26M` (cerca de 6 MiB, margem acima dos 5 MiB da parte) para sempre gerar 2 partes.
  - O usuário do fluxo é confirmado direto no banco pelo `registerAndLogin` (registro e login reais via HTTP), em vez de ler o token no Mailpit.
  - **Limitação pré-existente do OpenAPI:** o `openapi:export` roda via `ts-node`, sem o plugin do `@nestjs/swagger` (o `src/metadata.ts` é um stub), então os DTOs de requisição saem com `properties: {}` (o `RegisterDto` da Fase 02 já estava assim). Os 9 endpoints, os status por resposta, o envelope de erro e os DTOs de resposta (com `@ApiProperty`) estão completos. Corrigir o export para aplicar o plugin é tarefa futura.
  - README e `api.http` documentam o fluxo de upload, portas `9000`/`9001` do RustFS, Valkey sem porta no host e os riscos de TD-01, TD-11 e TD-13. Travessões nas linhas novas do `nestjs-project/CLAUDE.md` (SI-03.11) e num nome de suíte (SI-03.3) foram removidos (o último em commit `style:` separado).

### Gates de segurança da revisão final
- **Status:** completed
- **Dependências:** `npm audit --omit=dev` acusava vulnerabilidades HIGH em `@nestjs/core`, `body-parser`, `brace-expansion` e outras transitivas. Corrigidas com `npm audit fix --before=2026-11-13 --ignore-scripts` (só versões com pelo menos 7 dias de publicadas, sem mudar o `package.json`). Suíte repetida depois: 304 unitários/integração e 87 e2e passando, `tsc` limpo, lint sem erros.
- **Risco aceito (reavaliar até 2027-02-20):** restam 35 vulnerabilidades moderadas, todas em `@nestjs-modules/mailer` (via `mjml`, `glob`, `minimatch`), dependência da Fase 02, e em `typeorm` (via `glob`). A correção exige troca de versão major desses pacotes, fora do escopo desta fase.
- **Imagens:** `nestjs-api`, `video-worker`, `rustfs` e `valkey` sem CVE HIGH ou CRITICAL com correção (Trivy). `postgres:17.11` e `axllent/mailpit:v1.33.0`, herdadas da Fase 02 e usadas só no ambiente local, têm CVEs HIGH na imagem do fornecedor; ficam como risco aceito até a próxima atualização de digest.
- **Segredos:** `gitleaks` sem achados nos commits da fase.

### Revisão do TD-01: RustFS substituído pelo MinIO
- **Status:** completed
- **Motivo:** decisão do maestro de seguir o enunciado da fase ("na prática você roda MinIO localmente"). A imagem oficial `minio/minio` saiu do Docker Hub, então o serviço usa o fork comunitário `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`, fixado por digest (`sha256:b6bfe723...`).
- **Mudanças:** serviço `rustfs` virou `minio` no `compose.yaml` (`server /data --console-address ":9001"`, credenciais `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` vindas de `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`, healthcheck em `/minio/health/live`, volume `minio-data`); host padrão `http://minio:9000` em `storage.config.ts`, `.env.example` e testes; README, `CLAUDE.md`, `api.http`, specs, plano, `library-refs.md`, `context.md` e TD-01 atualizados. O código de storage não mudou, porque fala só a API S3.
- **Tests:** suíte completa contra o MinIO: 304 unitários/integração e 87 e2e passando (inclui upload multipart real, worker, streaming com `206` e download com `response-content-disposition`); `tsc` limpo; lint sem erros.
- **Risco aceito:** o Trivy aponta 52 HIGH e 3 CRITICAL com correção na imagem `pgsty/minio` (somando os alvos da imagem). Aceito pelo maestro por ser ambiente local/lab; em produção o storage é o AWS S3. As menções ao RustFS nos registros acima são históricas.

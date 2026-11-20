---
libs:
  "@aws-sdk/client-s3":
    version: "3.1168.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-11-20T00:15:30-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "3.1168.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-11-20T00:15:30-03:00"
  "@nestjs/bullmq":
    version: "11.0.5"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-11-20T00:15:30-03:00"
  "bullmq":
    version: "6.7.6"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-11-20T00:15:30-03:00"
  "ioredis":
    version: "5.11.1"
    context7_id: "n/a (dependência de conexão da bullmq; nenhuma API do ioredis é usada diretamente)"
    fetched_at: "2026-11-20T01:15:00-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-20T00:13:41-03:00"
---

# Library References: phase-03-videos

_Cache de documentação gerado por `/plan-resolve 03` (execução não interativa conduzida pelo maestro). Versões escolhidas pela política de supply-chain do maestro: a release estável mais recente publicada há pelo menos 7 dias em 2026-11-20 (corte em 2026-11-13), fixada de forma exata no `package.json` e instalada com `npm install --ignore-scripts` dentro do container `nestjs-api`._

| Pacote | Versão fixada | Publicada em | `latest` em 2026-11-20 (fora do cooldown) | Peer dependencies |
|--------|---------------|--------------|-------------------------------------------|-------------------|
| `@aws-sdk/client-s3` | `3.1168.0` | 2026-11-12 | `3.1173.0` (2026-11-19) | nenhuma |
| `@aws-sdk/s3-request-presigner` | `3.1168.0` | 2026-11-12 | `3.1173.0` (2026-11-19) | nenhuma (manter na mesma versão do `client-s3`) |
| `@nestjs/bullmq` | `11.0.5` (revisado na implementação; o plano previa `12.0.1`) | 2026-08-07 | `12.0.2` (2026-11-13) | `@nestjs/common`/`@nestjs/core` `^10 \|\| ^11`, `bullmq` `^3..^6` |
| `bullmq` | `6.7.6` | 2026-11-12 | `6.7.8` (2026-11-19) | opcionais: `ioredis`, `redis`, `pg`, `bullmq-otel` (na 6.x o `ioredis` deixou de ser dependência direta) |
| `ioredis` | `5.11.1` (adicionado na implementação) | 2026-06-04 | `6.0.0` (2026-07-31) | nenhuma; a 6.0.0 conflita com o peer opcional `ioredis@^5.0.4` do `typeorm@0.3.28` |

**Revisões feitas no SI-03.5 (implementação):**

- `@nestjs/bullmq` 12.x é publicado só como ESM (`"type": "module"`), e o Jest do projeto (CommonJS via `ts-jest`) não carrega o pacote (`SyntaxError: Unexpected token 'export'`). A linha 11.x é CommonJS, corresponde ao NestJS 11 instalado e a 11.0.5 já aceita `bullmq` ^6. A API usada (`BullModule.forRootAsync`, `registerQueue`, `@InjectQueue`, `@Processor`/`WorkerHost`, `@OnWorkerEvent`) é a mesma.
- Na `bullmq` 6.x o `ioredis` virou peer opcional; sem ele a fila falha com `BullMQ could not load the optional 'ioredis' package`. Instalado `ioredis@5.11.1` (versão exata, `--ignore-scripts`).

Usado por: `phase-03-videos/TD-01`, `TD-02`, `TD-04`, `TD-08`, `TD-11`, `TD-12` (S3) e `TD-03`, `TD-06`, `TD-09`, `TD-14` (fila). O servidor S3 é o RustFS (`TD-01`, Option C); o código fala só a API S3.

### @aws-sdk/client-s3

- **Cliente para storage S3 compatível (RustFS):** `new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } })`. `forcePathStyle` (antigo `s3ForcePathStyle` do v2) coloca o bucket no path, necessário para endpoints como `http://rustfs:9000`. Pelo TD-02 existem dois clientes: um com o endpoint interno (nome do serviço do Compose) para chamadas da API e do worker, e outro com o endpoint público usado só para assinar URLs entregues ao cliente (o `Host` faz parte da assinatura).
- **Multipart (TD-04):**
  - `CreateMultipartUploadCommand({ Bucket, Key, ContentType })` retorna `UploadId`.
  - `UploadPartCommand({ Bucket, Key, UploadId, PartNumber })`: `PartNumber` entre 1 e 10.000; partes de 5 MiB a 5 GiB (exceto a última).
  - `CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: [{ ETag, PartNumber }] } })`: `Parts` em ordem crescente; parte inválida gera 400.
  - `ListPartsCommand({ Bucket, Key, UploadId })` para retomar; `AbortMultipartUploadCommand({ Bucket, Key, UploadId })` para cancelar/expirar (TD-06).
- **Conferência na conclusão (revisão MD-1 do TD-04):** `HeadObjectCommand({ Bucket, Key })` devolve `ContentLength` (tamanho real) e `ContentType`; comparar com o tamanho declarado e o limite de 10 737 418 240 bytes.
- **Streaming com Range (TD-11):** `GetObjectCommand({ Bucket, Key, Range: 'bytes=0-9' })` responde com `ContentRange` (`bytes 0-9/43`), `ContentLength`, `AcceptRanges`, `ContentType`, `ETag`. Em Node.js o `Body` é um `Readable` não consumido: sempre fazer pipe até o fim para a resposta HTTP ou chamar `Body.destroy()` em erro/abort do cliente, senão há exaustão de sockets (EFFECTIVE_PRACTICES do SDK).
- **Erros:** comandos lançam exceções de serviço (`NoSuchKey`, `NoSuchUpload`, `NotFound` no `HeadObject`) com `$metadata.httpStatusCode`; mapear para erros de domínio na camada de infraestrutura.

### @aws-sdk/s3-request-presigner

- `getSignedUrl(client, command, { expiresIn })`; `expiresIn` em segundos, padrão 900. Funciona para qualquer comando S3 (`UploadPartCommand`, `GetObjectCommand`, `PutObjectCommand`).
- **URLs de parte (TD-04):** `getSignedUrl(publicClient, new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }), { expiresIn: 3600 })`. O presigner sempre usa `X-Amz-Content-Sha256: UNSIGNED-PAYLOAD` e não assina `content-type`: a integridade da parte não é verificada pela assinatura, por isso o tamanho total é conferido com `HeadObject` na conclusão e o conteúdo pelo `ffprobe` no worker. Cabeçalhos `x-amz-*` que precisem ser obrigatórios vão em `unhoistableHeaders`.
- **Leitura pelo worker (TD-08):** `getSignedUrl(internalClient, new GetObjectCommand({ Bucket, Key }), { expiresIn })` com o endpoint interno, passada como entrada para `ffprobe`/`ffmpeg` (leitura por Range via HTTP).
- **Download (TD-12):** `getSignedUrl(publicClient, new GetObjectCommand({ Bucket, Key, ResponseContentDisposition: 'attachment; filename="..."' }), { expiresIn })` e resposta `302`. Se o RustFS não honrar `response-content-disposition`, aplicar o plano B registrado na revisão do TD-12 (proxy com `Content-Disposition: attachment`).
- Não há verificação de expiração das credenciais contra `expiresIn`; com credenciais estáticas do storage isso não é problema.

### @nestjs/bullmq

- **Conexão global:** `BullModule.forRootAsync({ inject: [ConfigService], useFactory: (config: ConfigService) => ({ connection: { host, port }, prefix }) })`, lendo um `registerAs` do módulo de configuração (padrão do projeto: `@nestjs/config` + Joi). `prefix` separa ambientes (TD-14: prefixo próprio de teste).
- **Filas:** `BullModule.registerQueue({ name: 'video-processing' })` no módulo dono; produtor injeta com `@InjectQueue('video-processing') queue: Queue` (tipo `Queue` da `bullmq`).
- **Consumidor:** classe `@Processor('video-processing', { concurrency })` que estende `WorkerHost` e implementa `async process(job: Job, token?: string): Promise<unknown>`; erro lançado falha o job e segue a política de retentativas. O getter `this.worker` só existe após o registro (`onModuleInit`); usar em `onApplicationBootstrap` ou depois.
- **Eventos:** `@OnWorkerEvent('failed') onFailed(job: Job, err: Error)` (também `completed`, `active`, `error`, `stalled`). Para o TD-09, gravar `failed` + `failure_reason` quando `job.attemptsMade >= job.opts.attempts` ou o erro for `UnrecoverableError`.
- **Worker em processo separado (TD-07):** o `@Processor` só deve ser registrado no `WorkerModule` carregado por `src/worker.ts` (`NestFactory.createApplicationContext`); a API registra apenas a fila (produtor). Nos testes (TD-14) o mesmo processor é instanciado in-process.

### bullmq

- **Enfileirar (TD-09):** `queue.add('process-video', { videoId }, { jobId: videoId, attempts: 3, backoff: { type: 'exponential', delay: 1000 } })`. Backoff exponencial = `2^(attempts-1) * delay`; `jitter` opcional. `jobId` determinístico deduplica o mesmo vídeo enquanto o job existir (combinar com `removeOnComplete`/`removeOnFail` de forma consciente para permitir reprocessamento).
- **Falha permanente (revisão MD-1 do TD-09):** `throw new UnrecoverableError('...')` dentro do processor move o job direto para `failed`, ignorando `attempts`. Usar quando o `ffprobe` não reconhecer o arquivo como vídeo.
- **Jobs agendados (TD-06):** `queue.upsertJobScheduler('expire-abandoned-uploads', { every: ms } | { pattern: cron }, { name, data, opts: { attempts, backoff, removeOnFail } })`. É idempotente (upsert), pode ser chamado no boot sem duplicar o agendamento; `limit` opcional.
- **Servidor:** Valkey/Redis com `maxmemory-policy noeviction` (exigência da BullMQ, revisão do TD-03). Encerrar `Queue`/`Worker` com `close()` no shutdown e ao fim dos testes para não deixar conexões abertas no Jest.

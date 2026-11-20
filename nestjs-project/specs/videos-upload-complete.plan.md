---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.9
target_file: test/videos-upload-complete.e2e-spec.ts
---

# Conclusão do upload (POST /videos/:id/upload/complete) Test Plan

## Application Overview

`POST /videos/:id/upload/complete` conclui o multipart no MinIO, confere o tamanho real do objeto (`HeadObject`) contra o tamanho declarado e o limite de 10GB e, no caminho feliz, passa o vídeo de `draft` para `processing` e enfileira o job `process-video` (`jobId = videoId`) na fila BullMQ `video-processing`. Divergência de tamanho apaga o objeto e marca o vídeo `failed` com motivo, sem job; ETag inválido mantém o vídeo em `draft` para correção.

## Test Scenarios

### 1. POST /videos/:id/upload/complete

**Setup:** `beforeAll`: `Test.createTestingModule({ imports: [AppModule] })` com `testStorageConfig()`, `testQueueConfig()` e override de `videoConfig` com `partSizeBytes = 5242880` (5 MiB, mínimo S3), `ValidationPipe` e filtros globais como em `test/auth.e2e-spec.ts`; obter a `Queue` de `video-processing` via `getQueueToken(VIDEO_PROCESSING_QUEUE)`. Nenhum worker roda in-process neste arquivo (o job permanece na fila para inspeção; o prefixo de teste impede que o `video-worker` do Compose o consuma). `beforeEach`: `cleanAllTables(dataSource)`, `obliterateTestQueues()`, registro, confirmação e login de dois usuários (dono e outro) e `POST /videos` do dono com `{ "filename": "a.mp4", "mime_type": "video/mp4", "size_bytes": 10485760 }` (2 partes de 5 MiB). Helper `uploadParts(urls, buffers)` que faz `PUT` com `fetch` em cada URL assinada e devolve os `ETag`. `afterAll`: `emptyTestBucket()`, `obliterateTestQueues()` e `app.close()`.

Nota: o AC #2 usa 134217728 declarados e 134217729 enviados com a parte padrão de 64 MiB; o cenário 1.2 preserva a mesma semântica (1 byte a mais que o declarado) com a parte reduzida a 5 MiB para não alocar 128 MiB no teste.

#### 1.1. conclui-e-enfileira-processamento

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Enviar 2 buffers de 5242880 bytes às URLs das partes 1 e 2
    - expect: cada `PUT` responde `200` com `ETag`
  2. POST /videos/{id}/upload/complete com o token do dono e body `{ "parts": [{ "part_number": 2, "etag": "<etag2>" }, { "part_number": 1, "etag": "<etag1>" }] }` (fora de ordem, a API ordena)
    - expect: status `200`
    - expect: corpo `VideoResponse` com `id` igual ao do vídeo e `status = "processing"`
  3. `queue.getJob(id)` na fila de teste `video-processing`
    - expect: job existe com `name = "process-video"` e `data.videoId = id`
  4. Consultar a linha do vídeo e fazer `HeadObject` de `videos/{id}/original`
    - expect: `status = 'processing'`, `upload_id` nulo; o objeto existe com `ContentLength = 10485760`

#### 1.2. tamanho-real-diferente-do-declarado

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Enviar a parte 1 com 5242880 bytes e a parte 2 com 5242881 bytes (total 10485761, 1 byte acima do declarado)
    - expect: cada `PUT` responde `200` com `ETag`
  2. POST /videos/{id}/upload/complete com o token do dono e as 2 partes com os ETags corretos
    - expect: status `422` e `error = "UPLOAD_SIZE_MISMATCH"`
  3. Consultar a linha do vídeo
    - expect: `status = 'failed'` e `failure_reason = 'upload_size_mismatch'`
  4. `HeadObject` de `videos/{id}/original` e `queue.getJob(id)`
    - expect: o objeto não existe (`NotFound`) e não há job para o vídeo

#### 1.3. etag-errado-mantem-draft

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Enviar as 2 partes de 5242880 bytes
    - expect: cada `PUT` responde `200` com `ETag`
  2. POST /videos/{id}/upload/complete com o token do dono, parte 1 com o ETag correto e parte 2 com `etag = "\"00000000000000000000000000000000\""`
    - expect: status `400` e `error = "INVALID_UPLOAD_PARTS"`
  3. Consultar a linha do vídeo e `queue.getJob(id)`
    - expect: `status = 'draft'`, `upload_id` ainda preenchido e nenhum job criado
  4. POST /videos/{id}/upload/complete de novo com os ETags corretos
    - expect: status `200` com `status = "processing"` (o upload pôde ser corrigido)

#### 1.4. segunda-conclusao-recebe-409

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Enviar as 2 partes e concluir com os ETags corretos
    - expect: status `200`
  2. POST /videos/{id}/upload/complete novamente com o mesmo body
    - expect: status `409` e `error = "VIDEO_NOT_IN_DRAFT"`
  3. Contar jobs do vídeo na fila
    - expect: continua existindo um único job `process-video` com `jobId = id`

#### 1.5. outro-usuario-recebe-404

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Enviar as 2 partes de 5242880 bytes
  2. POST /videos/{id}/upload/complete com o token do outro usuário e as partes corretas
    - expect: status `404` e `error = "VIDEO_NOT_FOUND"`
  3. Consultar a linha do vídeo
    - expect: `status = 'draft'` (nada mudou)

#### 1.6. valida-entrada

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. POST /videos/{id}/upload/complete com o token do dono e body `{ "parts": [] }`
    - expect: status `400` e `error = "VALIDATION_ERROR"`
  2. POST /videos/nao-e-uuid/upload/complete com o token do dono e body válido
    - expect: status `400` e `error = "VALIDATION_ERROR"`
  3. POST /videos/{id}/upload/complete sem `Authorization`
    - expect: status `401`

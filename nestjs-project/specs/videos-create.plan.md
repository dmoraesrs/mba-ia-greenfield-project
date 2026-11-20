---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.7
target_file: test/videos-create.e2e-spec.ts
---

# Início do upload (POST /videos) Test Plan

## Application Overview

`POST /videos` inicia o upload de um vídeo de até 10GB sem que o arquivo passe pela API: cria o vídeo como rascunho (`draft`) no canal do usuário autenticado, abre um multipart upload no MinIO para `videos/{id}/original` e devolve as URLs pré-assinadas de todas as partes (`part_count = ceil(size_bytes / part_size_bytes)`, parte de 64 MiB). Formato (MIME declarado) e tamanho declarado são validados na entrada, e o endpoint exige autenticação.

## Test Scenarios

### 1. POST /videos

**Setup:** `beforeAll`: `Test.createTestingModule({ imports: [AppModule] })` com os overrides `testStorageConfig()` (bucket `${STORAGE_BUCKET}-test`, endpoint público igual ao interno) e `testQueueConfig()` (prefixo `${QUEUE_PREFIX}-test`), `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) e filtros globais `DomainExceptionFilter` + `ValidationExceptionFilter` como em `test/auth.e2e-spec.ts`; `videoConfig` com valores padrão (`partSizeBytes = 67108864`). `beforeEach`: `cleanAllTables(dataSource)` e registro, confirmação e login de um usuário (helper no padrão de `test/auth.e2e-spec.ts`). `afterAll`: `emptyTestBucket()`, `obliterateTestQueues()` e `app.close()`.

#### 1.1. cria-rascunho-e-devolve-urls-das-partes

**Covers AC:** #1, #4
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. POST /videos com `Authorization: Bearer <access_token>` e body `{ "filename": "a.mp4", "mime_type": "video/mp4", "size_bytes": 134217728 }`
    - expect: status `201`
    - expect: `video.status = "draft"`, `video.original_filename = "a.mp4"`, `video.mime_type = "video/mp4"`, `video.size_bytes = 134217728`, `video.has_thumbnail = false`, `video.duration_seconds = null`, `video.metadata = null`
    - expect: `video.public_id` casa `^[A-Za-z0-9_-]{11}$` e `video.id` é uuid
    - expect: `upload.part_size_bytes = 67108864`, `upload.part_count = 2`, `upload.parts` com 2 itens (`part_number` 1 e 2, cada um com `url` string) e `upload.expires_at` ISO-8601 no futuro
    - expect: o corpo não expõe `storage_key` nem `upload_id`
  2. Consultar a tabela `videos` pelo `video.id` retornado
    - expect: existe uma linha com `status = 'draft'`, `channel_id` igual ao canal do usuário autenticado, `storage_key = 'videos/{id}/original'`, `upload_id` não nulo, `part_count = 2`
  3. Chamar `ListParts` no bucket de teste com `Key = videos/{id}/original` e o `upload_id` da linha
    - expect: a chamada não falha (multipart aberto) e a lista de partes está vazia

#### 1.2. rejeita-mime-fora-da-lista

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. POST /videos autenticado com body `{ "filename": "a.avi", "mime_type": "video/avi", "size_bytes": 1024 }`
    - expect: status `400`
    - expect: `error = "VALIDATION_ERROR"` e `message` é array mencionando `mime_type`
  2. Contar linhas da tabela `videos`
    - expect: zero linhas

#### 1.3. rejeita-tamanho-acima-de-10gb

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. POST /videos autenticado com body `{ "filename": "a.mp4", "mime_type": "video/mp4", "size_bytes": 10737418241 }`
    - expect: status `400`
    - expect: `error = "VALIDATION_ERROR"` e `message` menciona `size_bytes`
  2. Contar linhas da tabela `videos`
    - expect: zero linhas

#### 1.4. exige-autenticacao

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. POST /videos sem cabeçalho `Authorization` e com body válido `{ "filename": "a.mp4", "mime_type": "video/mp4", "size_bytes": 1024 }`
    - expect: status `401`
  2. Contar linhas da tabela `videos`
    - expect: zero linhas

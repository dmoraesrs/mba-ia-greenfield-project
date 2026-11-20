---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8
target_file: test/videos-upload-parts.e2e-spec.ts
---

# Partes do upload (GET e POST /videos/:id/upload/parts) Test Plan

## Application Overview

Os endpoints de partes permitem retomar um upload multipart interrompido: `GET /videos/:id/upload/parts` lista as partes que o RustFS já recebeu (`ListParts`) e `POST /videos/:id/upload/parts` reassina URLs para partes que faltam ou cujas URLs expiraram. Só o dono do vídeo acessa (outro usuário recebe `404 VIDEO_NOT_FOUND`, sem revelar existência) e só enquanto o vídeo está em `draft`.

## Test Scenarios

### 1. GET /videos/:id/upload/parts e POST /videos/:id/upload/parts

**Setup:** `beforeAll`: `Test.createTestingModule({ imports: [AppModule] })` com `testStorageConfig()`, `testQueueConfig()` e override de `videoConfig` com `partSizeBytes = 5242880` (5 MiB, mínimo S3, para que 2 partes caibam em memória), `ValidationPipe` e filtros globais como em `test/auth.e2e-spec.ts`. `beforeEach`: `cleanAllTables(dataSource)`, registro, confirmação e login de dois usuários (dono e outro) e `POST /videos` do dono com `{ "filename": "a.mp4", "mime_type": "video/mp4", "size_bytes": 10485760 }` (2 partes). `afterAll`: `emptyTestBucket()`, `obliterateTestQueues()` e `app.close()`.

#### 1.1. lista-partes-recebidas-pelo-storage

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. `PUT` de um buffer de 5242880 bytes na URL assinada da parte 1 (`fetch`, direto ao RustFS)
    - expect: status `200` e cabeçalho `ETag` presente
  2. GET /videos/{id}/upload/parts com o token do dono
    - expect: status `200`
    - expect: `parts` tem exatamente 1 item com `part_number = 1`, `etag` igual ao `ETag` do passo 1 (comparado sem aspas) e `size_bytes = 5242880`

#### 1.2. reassina-parte-pendente

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. POST /videos/{id}/upload/parts com o token do dono e body `{ "part_numbers": [2] }`
    - expect: status `200`
    - expect: `parts` tem 1 item com `part_number = 2` e `url` string
    - expect: `expires_at` está entre 55 e 65 minutos no futuro
  2. `PUT` de um buffer de 5242880 bytes na URL reassinada
    - expect: status `200` (a URL nova é aceita pelo storage)

#### 1.3. rejeita-parte-acima-do-part-count

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. POST /videos/{id}/upload/parts com o token do dono e body `{ "part_numbers": [3] }`
    - expect: status `400`
    - expect: `error = "INVALID_PART_NUMBER"`

#### 1.4. outro-usuario-recebe-404

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. GET /videos/{id}/upload/parts com o token do outro usuário
    - expect: status `404` e `error = "VIDEO_NOT_FOUND"`
  2. POST /videos/{id}/upload/parts com o token do outro usuário e body `{ "part_numbers": [1] }`
    - expect: status `404` e `error = "VIDEO_NOT_FOUND"`

#### 1.5. video-fora-de-draft-recebe-409

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Atualizar a linha do vídeo no banco para `status = 'processing'` (repositório do TypeORM)
  2. GET /videos/{id}/upload/parts com o token do dono
    - expect: status `409` e `error = "VIDEO_NOT_IN_DRAFT"`
  3. POST /videos/{id}/upload/parts com o token do dono e body `{ "part_numbers": [1] }`
    - expect: status `409` e `error = "VIDEO_NOT_IN_DRAFT"`

#### 1.6. valida-entrada

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. GET /videos/nao-e-uuid/upload/parts com o token do dono
    - expect: status `400` e `error = "VALIDATION_ERROR"`
  2. POST /videos/{id}/upload/parts com o token do dono e body `{ "part_numbers": [] }`
    - expect: status `400` e `error = "VALIDATION_ERROR"`
  3. GET /videos/{id}/upload/parts sem `Authorization`
    - expect: status `401`

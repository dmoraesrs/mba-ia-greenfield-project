---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.13
target_file: test/videos-get.e2e-spec.ts
---

# Consulta de vídeo (GET /videos/:id e GET /videos/public/:publicId) Test Plan

## Application Overview

`GET /videos/:id` permite ao dono acompanhar o processamento do vídeo (status, duração, metadados, thumbnail e motivo de falha) em qualquer status. `GET /videos/public/:publicId` é anônimo e devolve só os dados públicos de vídeos `ready` acessados pela URL única (`public_id` de 11 caracteres); formato inválido, inexistente ou vídeo fora de `ready` respondem o mesmo `404 VIDEO_NOT_FOUND`, sem revelar existência.

## Test Scenarios

### 1. GET /videos/:id

**Setup:** `beforeAll`: `Test.createTestingModule({ imports: [AppModule] })` com `testStorageConfig()` e `testQueueConfig()`, `ValidationPipe` e filtros globais como em `test/auth.e2e-spec.ts`. `beforeEach`: `cleanAllTables(dataSource)`, registro, confirmação e login de dois usuários (dono e outro). Vídeos em estados específicos são semeados direto pelo repositório `Video` do TypeORM no canal do dono (o fluxo real upload → worker é coberto por `test/videos-flow.e2e-spec.ts`). `afterAll`: `emptyTestBucket()`, `obliterateTestQueues()` e `app.close()`.

#### 1.1. dono-acompanha-status-processing

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Semear um vídeo `processing` do dono (sem `metadata`, sem `thumbnail_key`)
  2. GET /videos/{id} com o token do dono
    - expect: status `200`
    - expect: `VideoResponse` com `status = "processing"`, `metadata = null`, `duration_seconds = null`, `has_thumbnail = false`, `failure_reason = null`
    - expect: o corpo não expõe `storage_key`, `upload_id` nem `channel_id`

#### 1.2. dono-ve-ready-com-metadados-e-thumbnail

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Semear um vídeo `ready` do dono com `duration_seconds = 2`, `metadata` completo (`width: 320`, `height: 240`, `video_codec: "h264"`, `audio_codec: "aac"`, `bitrate`, `container`, `frame_rate: 25`, `size_bytes`) e `thumbnail_key = 'videos/{id}/thumbnail.jpg'`
  2. GET /videos/{id} com o token do dono
    - expect: status `200`
    - expect: `status = "ready"`, `duration_seconds = 2`, `metadata` igual ao semeado e `has_thumbnail = true`

#### 1.3. dono-ve-motivo-de-falha

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Semear um vídeo `failed` do dono com `failure_reason = 'invalid_video_file: Invalid data found when processing input'`
  2. GET /videos/{id} com o token do dono
    - expect: status `200` com `status = "failed"` e `failure_reason` iniciado por `invalid_video_file:`

#### 1.4. outro-usuario-e-id-invalido

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Semear um vídeo `ready` do dono
  2. GET /videos/{id} com o token do outro usuário
    - expect: status `404` e `error = "VIDEO_NOT_FOUND"`
  3. GET /videos/{uuid aleatório inexistente} com o token do dono
    - expect: status `404` e `error = "VIDEO_NOT_FOUND"`
  4. GET /videos/nao-e-uuid com o token do dono
    - expect: status `400` e `error = "VALIDATION_ERROR"`
  5. GET /videos/{id} sem `Authorization`
    - expect: status `401`

### 2. GET /videos/public/:publicId

**Setup:** mesmo módulo do grupo 1; vídeos semeados pelo repositório `Video` no canal do dono.

#### 2.1. anonimo-ve-dados-publicos-de-video-ready

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Semear um vídeo `ready` com `metadata` completo e `duration_seconds = 2`
  2. GET /videos/public/{public_id} sem `Authorization`
    - expect: status `200`
    - expect: corpo com `public_id`, `mime_type`, `duration_seconds = 2`, `metadata` igual ao semeado e `created_at` ISO-8601
    - expect: o corpo não contém as chaves `id`, `channel_id`, `storage_key` nem `upload_id`

#### 2.2. mesma-resposta-404-sem-revelar-existencia

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Semear um vídeo `processing` e guardar seu `public_id`
  2. GET /videos/public/{public_id do processing} sem `Authorization`
    - expect: status `404` e `error = "VIDEO_NOT_FOUND"`
  3. GET /videos/public/AAAAAAAAAAA (11 caracteres válidos, inexistente)
    - expect: status `404` e `error = "VIDEO_NOT_FOUND"`
  4. GET /videos/public/curto! (formato inválido)
    - expect: status `404` e `error = "VIDEO_NOT_FOUND"`
    - expect: os três corpos (passos 2, 3 e 4) são idênticos (`statusCode`, `error`, `message`)

---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.15
target_file: test/videos-public-download.e2e-spec.ts
---

# Download (GET /videos/public/:publicId/download) Test Plan

## Application Overview

`GET /videos/public/:publicId/download` permite baixar o vídeo sem que os bytes passem pela API: responde `302` com `Location` para uma URL pré-assinada (`GetObjectCommand` no endpoint público, `expiresIn = 300`) com `ResponseContentDisposition: attachment; filename="..."`. É anônimo e só atende vídeos `ready`. Plano B (revisão do TD-12): se o RustFS não honrar `response-content-disposition`, o mesmo caminho responde `200` em stream com `Content-Disposition: attachment`.

## Test Scenarios

### 1. GET /videos/public/:publicId/download

**Setup:** `beforeAll`: `Test.createTestingModule({ imports: [AppModule] })` com `testStorageConfig()` (endpoint público igual ao interno, para o teste seguir o redirect de dentro do container) e `testQueueConfig()`, `ValidationPipe` e filtros globais como em `test/auth.e2e-spec.ts`; gerar um vídeo de 2 s com `generateSampleVideo` e ler seus bytes. `beforeEach`: `cleanAllTables(dataSource)`, registro e confirmação de um usuário, `putObject` do vídeo em `videos/{id}/original` no bucket de teste e inserção pelo repositório `Video` de um vídeo `ready` com `original_filename = 'meu-video.mp4'`. `afterAll`: `emptyTestBucket()`, `obliterateTestQueues()`, remoção do arquivo temporário e `app.close()`. Os cenários 1.1 e 1.2 descrevem o caminho padrão (302); se o `progress.md` registrar a adoção do plano B, o cenário 1.3 substitui os dois.

#### 1.1. redireciona-para-url-pre-assinada

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. GET /videos/public/{public_id}/download sem `Authorization` e sem seguir redirects
    - expect: status `302`
    - expect: `Location` começa com o `STORAGE_PUBLIC_ENDPOINT` configurado (no teste, o endpoint interno) e contém o caminho do bucket de teste e `videos/{id}/original`
    - expect: a query string de `Location` contém `response-content-disposition` e `X-Amz-Expires=300`

#### 1.2. url-do-location-entrega-o-arquivo-como-attachment

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. GET /videos/public/{public_id}/download sem seguir redirects e capturar `Location`
    - expect: status `302`
  2. `fetch(Location)` direto ao RustFS, lendo o corpo como buffer
    - expect: status `200`
    - expect: `Content-Disposition` começa com `attachment` e contém `filename="meu-video.mp4"`
    - expect: o corpo é byte a byte idêntico ao arquivo gerado

#### 1.3. plano-b-responde-200-com-attachment

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. (Só se o plano B foi adotado e registrado no `progress.md`.) GET /videos/public/{public_id}/download lendo o corpo como buffer
    - expect: status `200`
    - expect: `Content-Disposition` começa com `attachment` e contém `filename="meu-video.mp4"`, `Content-Type = video/mp4` e `Content-Length` igual ao tamanho do arquivo
    - expect: o corpo é idêntico ao arquivo gerado

#### 1.4. video-fora-de-ready-ou-inexistente-recebe-404

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Atualizar o vídeo para `status = 'processing'`
  2. GET /videos/public/{public_id}/download sem seguir redirects
    - expect: status `404` e `error = "VIDEO_NOT_FOUND"` (sem `Location`)
  3. GET /videos/public/AAAAAAAAAAA/download (inexistente)
    - expect: status `404` e `error = "VIDEO_NOT_FOUND"`

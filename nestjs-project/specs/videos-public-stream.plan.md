---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.14
target_file: test/videos-public-stream.e2e-spec.ts
---

# Streaming e thumbnail (GET /videos/public/:publicId/stream e /thumbnail) Test Plan

## Application Overview

`GET /videos/public/:publicId/stream` entrega a reprodução sem download completo: a API repassa o cabeçalho `Range` do cliente ao `GetObject` do RustFS e responde `206 Partial Content` com `Content-Range`, ou `200` com o arquivo inteiro em stream quando não há `Range`; intervalo fora do tamanho responde `416` com `Content-Range: bytes */{size}`. `GET /videos/public/:publicId/thumbnail` serve a thumbnail JPEG gerada pelo worker. Ambos são anônimos e só atendem vídeos `ready`.

## Test Scenarios

### 1. GET /videos/public/:publicId/stream

**Setup:** `beforeAll`: `Test.createTestingModule({ imports: [AppModule] })` com `testStorageConfig()` e `testQueueConfig()`, `ValidationPipe` e filtros globais como em `test/auth.e2e-spec.ts`; gerar um vídeo de 2 s com `generateSampleVideo` (`src/test/fixtures.ts`) e ler seus bytes para comparação. `beforeEach`: `cleanAllTables(dataSource)`, registro e confirmação de um usuário (dono do canal), `putObject` do vídeo gerado em `videos/{id}/original` e de um JPEG (frame extraído com `ffmpeg` no `beforeAll`) em `videos/{id}/thumbnail.jpg` no bucket de teste, e inserção pelo repositório `Video` de um vídeo `ready` com `metadata.size_bytes` igual ao tamanho do arquivo e `thumbnail_key` preenchido. `afterAll`: `emptyTestBucket()`, `obliterateTestQueues()`, remoção dos arquivos temporários e `app.close()`.

#### 1.1. range-responde-206-com-trecho-exato

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. GET /videos/public/{public_id}/stream sem `Authorization`, com `Range: bytes=0-1023`, lendo o corpo como buffer
    - expect: status `206`
    - expect: `Content-Range = bytes 0-1023/{size}`, `Content-Length = 1024`, `Accept-Ranges = bytes`, `Content-Type = video/mp4` e `ETag` presente
    - expect: o corpo tem 1024 bytes idênticos aos 1024 primeiros bytes do arquivo gerado

#### 1.2. range-aberto-e-sufixo

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. GET /videos/public/{public_id}/stream com `Range: bytes=-500`
    - expect: status `206`, `Content-Range = bytes {size-500}-{size-1}/{size}` e corpo igual aos 500 últimos bytes do arquivo
  2. GET /videos/public/{public_id}/stream com `Range: bytes={size-10}-`
    - expect: status `206`, `Content-Length = 10` e corpo igual aos 10 últimos bytes do arquivo

#### 1.3. sem-range-responde-200-com-arquivo-inteiro

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. GET /videos/public/{public_id}/stream sem `Range`, lendo o corpo como buffer
    - expect: status `200`
    - expect: `Content-Length` igual ao tamanho do arquivo, `Accept-Ranges = bytes`, `Content-Type = video/mp4`
    - expect: o corpo é byte a byte idêntico ao arquivo gerado

#### 1.4. range-fora-do-tamanho-responde-416

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. GET /videos/public/{public_id}/stream com `Range: bytes={size}-`
    - expect: status `416`
    - expect: `error = "RANGE_NOT_SATISFIABLE"` no envelope `{ statusCode, error, message }`
    - expect: cabeçalho `Content-Range = bytes */{size}`

#### 1.5. abortar-conexao-nao-deixa-sockets-pendentes

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Abrir a API em porta efêmera (`app.listen(0)`), iniciar `http.get` de `/videos/public/{public_id}/stream` sem `Range` e destruir o socket do cliente ao receber o primeiro chunk; repetir 20 vezes em sequência
    - expect: nenhuma exceção não tratada e o processo de teste continua saudável
  2. GET /videos/public/{public_id}/stream com `Range: bytes=0-1023` logo depois das 20 interrupções
    - expect: status `206` com os 1024 bytes corretos, respondido dentro do timeout padrão do Jest (o pool de sockets do cliente S3 não ficou esgotado)

#### 1.6. video-fora-de-ready-recebe-404

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Atualizar o vídeo para `status = 'processing'`
  2. GET /videos/public/{public_id}/stream com `Range: bytes=0-1023`
    - expect: status `404` e `error = "VIDEO_NOT_FOUND"`

### 2. GET /videos/public/:publicId/thumbnail

**Setup:** mesmo módulo e semeadura do grupo 1.

#### 2.1. thumbnail-de-video-ready

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. GET /videos/public/{public_id}/thumbnail sem `Authorization`, lendo o corpo como buffer
    - expect: status `200`
    - expect: `Content-Type = image/jpeg`, `Cache-Control = public, max-age=300`, `Content-Length` igual ao tamanho do JPEG semeado
    - expect: o corpo começa com os bytes `FF D8` e é idêntico ao JPEG semeado

#### 2.2. thumbnail-de-video-processing-recebe-404

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-20T03:29:19Z

**Steps:**
  1. Atualizar o vídeo para `status = 'processing'`
  2. GET /videos/public/{public_id}/thumbnail
    - expect: status `404` e `error = "VIDEO_NOT_FOUND"`
  3. Restaurar `status = 'ready'` com `thumbnail_key = null` e repetir o GET
    - expect: status `404` e `error = "VIDEO_NOT_FOUND"`

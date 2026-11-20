---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-11-19T23:17:58-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-20T00:13:41-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-11-20T00:16:01-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-11-19T23:33:58-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-11-19T23:33:58-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-11-19T23:33:58-03:00"
  docs/phases/phase-02-auth/context.md: "2026-11-19T23:33:58-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-11-19T23:33:58-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-11-19T23:17:58-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified._

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** _None named explicitly in the phase body._

**Deferred subprojects:** _None._

**Sequencing notes:** "> Depende de: Fase 01, Fase 02". Intro sentence: "Upload de arquivos grandes sem travar o sistema, processamento automático do vídeo e geração de URL única."

**Neighbors (for boundary detection only):**

- **Phase 02:** Cadastro, Login e Gerenciamento de Conta (Depende de: Fase 01)
- **Phase 04:** Gerenciamento de Vídeos e Canal (Depende de: Fase 02, Fase 03)

## Decisions Index

| Ref | Source | Scope | Topic | Capability | Status | Decision | Libraries |
|-----|--------|-------|-------|------------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Servidor de object storage no ambiente e SDK de acesso | Serviço de armazenamento de arquivos (vídeos e thumbnails) | decided | C | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
|     └─ Last revision: 2026-11-20 — Maestro escolheu a Option C (RustFS) no lugar da recomendação A: imagem `rustfs… | | | | | | | |
| phase-03-videos/TD-02 | phase | Backend | Organização de buckets, chaves e endpoints (interno e público) | Serviço de armazenamento de arquivos (vídeos e thumbnails) | decided | A | — |
| phase-03-videos/TD-03 | phase | Backend | Fila de processamento em segundo plano | Serviço de processamento em segundo plano (filas) | decided | A | @nestjs/bullmq, bullmq |
|     └─ Last revision: 2026-11-20 — Servidor da fila definido como Valkey com tag fixa (preferencialmente fixada po… | | | | | | | |
| phase-03-videos/TD-04 | phase | Backend | Protocolo de upload de arquivos de até 10GB | Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | decided | A | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
|     └─ Last revision: 2026-11-20 — Validação do arquivo no upload (MD-1): MIME declarado no início restrito a `vid… | | | | | | | |
| phase-03-videos/TD-05 | phase | Backend | Ciclo de status do vídeo e relação com o rascunho da Fase 04 | Transversal — covers: Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Processamento automático do vídeo após upload (extração de duração e metadados) | decided | A | — |
|     └─ Last revision: 2026-11-20 — Modelo de dados do vídeo (AMB-1): duração em coluna própria (segundos) e coluna… | | | | | | | |
| phase-03-videos/TD-06 | phase | Backend | Tratamento de uploads abandonados | Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | decided | A | — |
| phase-03-videos/TD-07 | phase | Backend | Topologia do worker e invocação do FFmpeg | Transversal — covers: Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo | decided | A | — |
|     └─ Last revision: 2026-11-20 — Extração do worker (AMB-1): `ffprobe -print_format json` fornece a duração (seg… | | | | | | | |
| phase-03-videos/TD-08 | phase | Backend | Como o worker lê o vídeo original no storage | Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo | decided | A | — |
| phase-03-videos/TD-09 | phase | Backend | Retentativas, idempotência e registro de falha do processamento | Processamento automático do vídeo após upload (extração de duração e metadados) | decided | A | — |
|     └─ Last revision: 2026-11-20 — Arquivo inválido (MD-1): arquivo que o `ffprobe` não reconhece como vídeo é fal… | | | | | | | |
| phase-03-videos/TD-10 | phase | Backend | Geração do identificador público único do vídeo | URL única por vídeo, sem conflito com outros vídeos | decided | A | — |
| phase-03-videos/TD-11 | phase | Backend | Estratégia de entrega para reprodução via streaming | Reprodução via streaming (sem necessidade de download completo) | decided | A | — |
| phase-03-videos/TD-12 | phase | Backend | Estratégia de download do vídeo | Download do vídeo pelo usuário | decided | A | — |
|     └─ Last revision: 2026-11-20 — Plano B condicionado ao storage: se o RustFS (TD-01) não honrar `response-conte… | | | | | | | |
| phase-03-videos/TD-13 | phase | Backend | Política de acesso a streaming e download nesta fase | Transversal — covers: Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário | decided | A | — |
| phase-03-videos/TD-14 | phase | Backend | Isolamento de fila e storage nos testes e execução do worker nas suítes | Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails); Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados) | decided | A | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

_Correlated (origin 3, `related_phases: []`) docs incluídos em `## Inherited Decisions Detail`:_ `openapi-docs-nestjs` e `next-frontend-config-base` (ambos ranqueados `medium` pelo correlator; nenhum `high`). Seleção feita em modo não interativo com autorização do maestro (Diego), porque o próprio decisions doc da fase cita `openapi-docs-nestjs/TD-01..02` e `next-frontend-config-base/TD-03` como decisões herdadas não reabertas. Descartados: `next-frontend-msw-foundation` e `next-frontend-openapi-typing` (`low`, só frontend).

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-01, phase-03-videos/TD-02, phase-03-videos/TD-14 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-03, phase-03-videos/TD-07, phase-03-videos/TD-14 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-04 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-05, phase-03-videos/TD-06 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-05, phase-03-videos/TD-07, phase-03-videos/TD-08, phase-03-videos/TD-09, phase-03-videos/TD-14 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-07, phase-03-videos/TD-08 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-10 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-11, phase-03-videos/TD-13 |
| Download do vídeo pelo usuário | phase-03-videos/TD-12, phase-03-videos/TD-13 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** mantém a preferência do maestro e oferece a compatibilidade S3 mais completa para os três fluxos críticos da fase (multipart pré-assinado, Range e `response-content-disposition`); o risco de manutenção do fork é contido porque o código depende só da API S3 (trocar para SeaweedFS ou AWS S3 é mudança de Compose e de variáveis, não de código), e esse risco deve ficar registrado no plano.
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

**Revisions:**
- 2026-11-20 — Maestro escolheu a Option C (RustFS) no lugar da recomendação A: imagem `rustfs/rustfs:1.0.5@sha256:b81d16a90ee25bd9511280127ca1471788c6e874cf0f0da759645f46b2dc1d74` (fixada por digest, publicada em 2026-11-10, cumpre o cooldown de 7 dias), portas 9000 (S3) e 9001 (console), credenciais via `RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY` ou as variáveis indicadas no README da imagem (confirmar na implementação); o código fala só a API S3 com `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner`, então trocar por S3 em produção não muda código. Rationale: scan Trivy de 2026-11-20 (`--severity HIGH,CRITICAL --ignore-unfixed`) reprovou `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` (52 HIGH e 3 CRITICAL com correção disponível) e aprovou `rustfs/rustfs:1.0.5` (nenhum HIGH/CRITICAL com correção); a imagem oficial `minio/minio` não existe mais no Docker Hub; se algum recurso S3 (ex.: `response-content-disposition`) falhar no RustFS, registrar no `progress.md` e usar a alternativa equivalente do TD-12 (decisão do maestro).
- 2026-11-20 (revisão após a implementação): maestro voltou para a Option A (MinIO via `pgsty/minio:RELEASE.2026-08-04T00-00-00Z@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372`, serviço `minio`), como pede o enunciado; CVEs da imagem aceitos por ser ambiente local/lab. Detalhes no TD-01 de `docs/decisions/technical-decisions-phase-03-videos.md`.

### phase-03-videos/TD-02

**Recommendation:** bucket único privado com chaves `videos/{videoId}/...` e endpoints interno/público separados (preferência do maestro), porque mantém toda a autorização na API até as fases de visibilidade (04/05) e resolve o problema do `Host` assinado sem gambiarras de reescrita de URL.
**Libraries:** —

### phase-03-videos/TD-03

**Recommendation:** coincide com a preferência do maestro; entrega retentativa com backoff e jobs repetíveis (úteis em TD-06) sem código de infraestrutura próprio, e não polui o schema controlado por migrations. A falta de atomicidade com o Postgres é tratada pela idempotência do job (TD-09). Sobre a imagem: Valkey (BSD, já no cache local como `valkey/valkey:9.1.2-alpine`) evita a licença AGPL/RSAL do Redis 8 e é compatível com o protocolo; se o plano preferir aderência literal ao nome, `redis:8.8.4-alpine` com tag fixa também atende. Em ambos, configurar `maxmemory-policy noeviction`, exigido pela BullMQ.
**Libraries:** @nestjs/bullmq, bullmq

**Revisions:**
- 2026-11-20 — Servidor da fila definido como Valkey com tag fixa (preferencialmente fixada por digest e publicada há pelo menos 7 dias), com `maxmemory-policy noeviction`; a imagem passa por `trivy image --severity HIGH,CRITICAL --ignore-unfixed` antes de entrar no `compose.yaml`. Rationale: escolha do maestro (licença BSD e gate de segurança de imagens).

### phase-03-videos/TD-04

**Recommendation:** coincide com a preferência do maestro e é a única opção que satisfaz ao mesmo tempo "não passa pela API" e "retomar após falha". Parâmetros a fixar no plano: tamanho máximo 10 GiB validado no início (tamanho declarado) e na conclusão (`HeadObject`, apagando e falhando se exceder); tamanho de parte fixo calculado pela API (ex.: 64 MiB, cerca de 160 partes para 10 GiB, dentro dos limites S3 de 5 MiB a 5 GiB por parte e 10.000 partes); expiração curta das URLs de parte (ex.: 1 h, reassináveis); `Content-Type` declarado restrito a `video/*`, com validação real feita pelo ffprobe no worker.
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

**Revisions:**
- 2026-11-20 — Validação do arquivo no upload (MD-1): MIME declarado no início restrito a `video/mp4`, `video/webm`, `video/quicktime` e `video/x-matroska` (outro MIME é rejeitado pela validação de DTO da API com 400/422); limite de 10GB (10 737 418 240 bytes) validado no início pelo tamanho declarado, que também define a quantidade de partes; na conclusão a API confere o tamanho real do objeto (`HeadObject`) e, se passar do limite ou divergir do declarado, aborta e marca o vídeo `failed` com motivo. Rationale: resposta do maestro ao MD-1 do validation.md (substitui o `video/*` genérico da recomendação).

### phase-03-videos/TD-05

**Recommendation:** adota o ciclo do maestro, que bate com o texto da capability, e mantém a publicação da Fase 04 em campo separado; o plano deve documentar que `draft` significa "pré-cadastro com upload ainda não concluído" e que todo vídeo permanece não publicado até a Fase 04.
**Libraries:** —

**Revisions:**
- 2026-11-20 — Modelo de dados do vídeo (AMB-1): duração em coluna própria (segundos) e coluna `metadata` (jsonb) com largura, altura, codec de vídeo, codec de áudio (ou nulo), bitrate, formato do container, frame rate e tamanho em bytes. Rationale: resposta do maestro ao AMB-1 do validation.md.

### phase-03-videos/TD-06

**Recommendation:** reaproveita a fila escolhida em TD-03, fecha o ciclo do status (TD-05) com um estado final explícito e não depende de recursos específicos do servidor S3; o limite de expiração entra como variável de ambiente.
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** preferência do maestro, alinhada ao diagrama; isola o custo de processamento sem duplicar código e coloca o ffmpeg na mesma imagem usada pelos testes, que precisam gerar o vídeo de exemplo. Binários estáticos via npm (`ffmpeg-static`) foram descartados porque baixam o binário em script de pós-instalação, conflitando com a política `--ignore-scripts`.
**Libraries:** —

**Revisions:**
- 2026-11-20 — Extração do worker (AMB-1): `ffprobe -print_format json` fornece a duração (segundos) e os campos de `metadata` (largura, altura, codec de vídeo, codec de áudio ou nulo, bitrate, formato do container, frame rate, tamanho em bytes); a imagem base do worker com FFmpeg passa por `trivy image --severity HIGH,CRITICAL --ignore-unfixed` e usa tag fixa (preferencialmente por digest, publicada há pelo menos 7 dias). Rationale: resposta do maestro ao AMB-1 e gate de segurança de imagens.

### phase-03-videos/TD-08

**Recommendation:** para extrair duração, metadados e um frame, ler por Range via URL pré-assinada interna evita transferir 10GB por job e dispensa volume temporário; se algum formato falhar por leitura remota, o motivo vai para `failure_reason` e a Option B fica como alternativa futura.
**Libraries:** —

### phase-03-videos/TD-09

**Recommendation:** concretiza a preferência do maestro (backoff na fila e `failed` com motivo ao esgotar) e acrescenta a distinção transitório/permanente e a deduplicação por `jobId`, que custam pouco e eliminam os dois modos de falha mais comuns desse fluxo.
**Libraries:** —

**Revisions:**
- 2026-11-20 — Arquivo inválido (MD-1): arquivo que o `ffprobe` não reconhece como vídeo é falha permanente no worker (`UnrecoverableError`, `failed` com motivo, sem gastar retentativas); divergência ou excesso de tamanho detectado na conclusão do upload é marcado `failed` pela própria API (TD-04), sem enfileirar job. Rationale: resposta do maestro ao MD-1 do validation.md.

### phase-03-videos/TD-10

**Recommendation:** coincide com a preferência do maestro; 64 bits aleatórios com `UNIQUE` no banco garantem "nunca conflita" de forma verificável, sem dependência nova e sem permitir enumeração, o que protege os vídeos unlisted da Fase 05.
**Libraries:** —

### phase-03-videos/TD-11

**Recommendation:** mantém a preferência do maestro porque a fase é só backend e as Fases 04/05 trarão regras de visibilidade (unlisted, público) que ficam naturalmente na API a cada request, sem URL que expire no meio do vídeo; o custo de banda é linear e tratável com streams. O plano deve registrar a divergência com o diagrama e que a Option B continua sendo adição não quebrável caso a banda pela API/BFF vire gargalo.
**Libraries:** —

### phase-03-videos/TD-12

**Recommendation:** as duas formas foram aceitas pelo maestro; o redirect pré-assinado retira da API o maior volume de bytes da fase, e o controle de acesso continua no endpoint que emite a URL, que pode ter expiração curta porque o download não depende de seek prolongado como a reprodução.
**Libraries:** —

**Revisions:**
- 2026-11-20 — Plano B condicionado ao storage: se o RustFS (TD-01) não honrar `response-content-disposition` na URL pré-assinada, registrar no `progress.md` e servir o download pela Option B (proxy na API com `Content-Disposition: attachment`), sem mudar o contrato do endpoint. Rationale: condição registrada pelo maestro ao escolher o RustFS.

### phase-03-videos/TD-13

**Recommendation:** é a única que funciona com player nativo dado o Bearer em header, antecipa o acesso anônimo da Fase 05 e protege por não enumerabilidade do `publicId`; a exposição tipo unlisted antes da Fase 04 é aceitável em ambiente de desenvolvimento e deve ser registrada no plano.
**Libraries:** —

### phase-03-videos/TD-14

**Recommendation:** atende a exigência do maestro de testar upload multipart real, processamento pelo worker com vídeo gerado por ffmpeg e streaming com `206`, sem acoplar os testes ao estado do container de desenvolvimento; a separação por prefixo e bucket é o mesmo contrato de variáveis que já isola ambientes em produção.
**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.

**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.

**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.

**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.

**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.

**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.

**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.

**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.

**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.

**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority — Auth.js's value (DB adapters, OAuth providers, magic-link, `getServerSession` helpers) is mostly unused in this configuration. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern; a misconfigured Auth.js callback is a longer fault-isolation loop. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use; Auth.js v5 versions track Next.js majors with a lag, adding compatibility risk that Option A does not have. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. (2) **Single cookie to manage** simplifies logout (one `session.destroy()` call) and avoids the orphan-cookie failure mode of Option A. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome (avatar, channel name) without a per-render `/auth/me` round-trip — Phase 04+ gains compound here. Option A is a viable downgrade if the team rejects `iron-session` for any reason; the migration A→B (or B→A) is a one-Route-Handler refactor with no test changes downstream because the BFF interface is unchanged. Option C is rejected: it solves a problem (server-side revocation) the project does not have at the cost of infrastructure the project does not own.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh) — adopting B means doing both. Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving and force a `"use client"` shell near the root.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions; the form code does not change if TD-05 is revisited later. (2) **Aligned with shadcn's canonical form primitive** — the project already commits to `radix-nova` shadcn (`components.json`); `npx shadcn@latest add form` produces react-hook-form wrappers; choosing react-hook-form means using the supported primitive instead of hand-rolling around it. (3) **Zod-first developer ergonomics match the rest of the FE foundation** — `next-frontend-config-base/TD-01` chose Zod 4 for env; the same schemas-as-source-of-truth pattern carries to forms with zero new validator paradigm. Option B is rejected for impedance with shadcn's primitive and for over-investing in progressive-enhancement that the strict-BFF model does not require. Option C is rejected for the per-field boilerplate and the loss of client-side feedback on a project that values quick, type-safe form iteration.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment.** `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface; Option A keeps every mutation visible under `app/api/**`. (2) **Test scaffold already exists** — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` were authored for Route-Handlers-as-functions; Option A reuses them with zero invention. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking when the cost of inconsistency compounds (Option C). Option B has real ergonomic appeal for the simplest forms but fragments the BFF surface and forces test-pattern reinvention; if the team later wants progressive enhancement for specific forms, the migration A→B is per-form and doesn't require touching unrelated routes — A is the safer default and the cheaper baseline.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state; users never see "Login" briefly turn into their avatar. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it; the BFF surface stays minimal. The `router.refresh()` requirement after mid-session mutations is a small price (one line in the relevant mutation handler) for the structural benefits. Option B is rejected for the double-read-and-flicker; Option C is dominated by Option B and rejected.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) **Single integration pattern across both flows** — confirmation is RSC-only; reset is RSC + Client form (TD-04, TD-05 patterns reused) — both share the "RSC owns the token, Client Component owns the input" split. (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level (a small note for `/plan-build` to confirm; not a separate TD). Option B's Route-Handler-as-link-target adds redirects for no clean gain. Option C is dominated.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.
**Libraries:** @nestjs/swagger
**Revisions:**

- 2026-05-12 — Esclarece que o CLI plugin (`classValidatorShim: true`) cobre apenas inferência de schemas de DTOs a partir de `class-validator`; documentação de operações, respostas tipadas por status code, contratos de erro (alinhados ao envelope de phase-02-auth/TD-07) e exemplos exigem decoradores explícitos (`@ApiOperation`, `@ApiResponse`, `@ApiBody`, `@ApiParam`, `@ApiQuery`, `@ApiExtraModels`). _Rationale:_ openapi.json gerado pelo bootstrap atual está genérico — sem detalhes de parâmetros, schemas de retorno por status, nem contratos de erro — porque a base instalada se apoiou só na introspecção automática. Esta revisão fixa que enriquecimento via decoradores explícitos faz parte da Option A escolhida, não é trabalho fora do escopo do TD.

### openapi-docs-nestjs/TD-02

**Recommendation:** o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro. Combinar é dominante.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.
**Libraries:** —

### next-frontend-config-base/TD-01

**Recommendation:** Three converging reasons: (1) **Type-inference matches the FE's strict-TS culture** — `lib/env.ts` exports a typed `env` object with no `as` casts, satisfying the project's "Type Safety" working principle. (2) **Ecosystem gravity in Next.js / React 19** — Zod is the de-facto schema language for App Router (Server Actions inputs, form resolvers, future contract validation), so introducing it once at the env layer compounds value for forms in Phase 02+. (3) **Direct enablement of TD-02 Option A (`@t3-oss/env-nextjs`)** — t3-env's first-citizen validator. Backend parity with Joi is not load-bearing: env schemas are not shared FE↔BE (different runtimes, different key sets); two validators across two subprojects is a bounded cost.
**Libraries:** zod

### next-frontend-config-base/TD-02

**Recommendation:** The only option that combines (i) **type-level NEXT_PUBLIC_ prefix enforcement**, (ii) **runtime Proxy-based leak detection**, and (iii) **single-file, single-import-path consumer ergonomics**. Option B reaches roughly the same _structural_ outcome at higher implementation and maintenance cost, with a weaker guarantee (no prefix enforcement, no proxy). Option C is unsafe at any non-trivial team size. The marginal cost over B is one ~3KB dep — well-spent for the strongest boundary among the three.
**Libraries:** @t3-oss/env-nextjs

### next-frontend-config-base/TD-03

**Recommendation:** Aligned with the BFF testing strategy and architectural commitment already documented in `next-frontend/CLAUDE.md` (Route Handlers as the only NestJS caller; BFF tests stub `fetch` via MSW). Eliminates CORS, eliminates public exposure of the backend URL, and produces the smallest correct foundation. Option B's `NEXT_PUBLIC_API_URL` is a future-proofing concession with no current consumer — and adding a public key later is a non-breaking change, while removing one is breaking. Option C ties a foundational decision to infra work explicitly deferred elsewhere. The Docker networking gap (how server-in-container resolves the backend) is a separate orthogonal decision, surfaced below.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, ...`... _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function... _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule`... _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | a tela de confirmação da conta não será implementada nesta fase corrente, será adiada — the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per Non-UI rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to Passport) | E2E only |
| Strategy (Passport) | E2E via guard |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |

_Source: `.claude/skills/testing-guide-nestjs-project/SKILL.md` §3 (Feature Implementation Checklist). Artefatos previstos ainda não presentes no projeto (processors de fila, adapters de storage) seguem `artifacts/future-types.md` do mesmo guia._

### next-frontend

_Fora do escopo desta fase por decisão do maestro (fase só backend, sem inventário de UI). Nenhum requisito de teste de frontend se aplica._

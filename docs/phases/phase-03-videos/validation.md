---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-11-20T00:16:09-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-20T00:13:41-03:00"
issues:
  - id: AMB-1
    status: resolved
    summary: "Conjunto de \"metadados\" extraídos no processamento não está definido"
    resolved_by: "phase-03-videos/TD-05, phase-03-videos/TD-07"
  - id: MD-1
    status: resolved
    summary: "Formatos aceitos e verificação do limite de 10GB do arquivo sem TD explícito"
    resolved_by: "phase-03-videos/TD-04, phase-03-videos/TD-09"
  - id: OQ-1
    status: resolved
    summary: "TD-01 pending: servidor de object storage no ambiente e SDK de acesso"
    resolved_by: "phase-03-videos/TD-01"
  - id: OQ-2
    status: resolved
    summary: "TD-02 pending: organização de buckets, chaves e endpoints interno/público"
    resolved_by: "phase-03-videos/TD-02"
  - id: OQ-3
    status: resolved
    summary: "TD-03 pending: fila de processamento em segundo plano"
    resolved_by: "phase-03-videos/TD-03"
  - id: OQ-4
    status: resolved
    summary: "TD-04 pending: protocolo de upload de arquivos de até 10GB"
    resolved_by: "phase-03-videos/TD-04"
  - id: OQ-5
    status: resolved
    summary: "TD-05 pending: ciclo de status do vídeo e relação com o rascunho da Fase 04"
    resolved_by: "phase-03-videos/TD-05"
  - id: OQ-6
    status: resolved
    summary: "TD-06 pending: tratamento de uploads abandonados"
    resolved_by: "phase-03-videos/TD-06"
  - id: OQ-7
    status: resolved
    summary: "TD-07 pending: topologia do worker e invocação do FFmpeg"
    resolved_by: "phase-03-videos/TD-07"
  - id: OQ-8
    status: resolved
    summary: "TD-08 pending: como o worker lê o vídeo original no storage"
    resolved_by: "phase-03-videos/TD-08"
  - id: OQ-9
    status: resolved
    summary: "TD-09 pending: retentativas, idempotência e registro de falha"
    resolved_by: "phase-03-videos/TD-09"
  - id: OQ-10
    status: resolved
    summary: "TD-10 pending: geração do identificador público único do vídeo"
    resolved_by: "phase-03-videos/TD-10"
  - id: OQ-11
    status: resolved
    summary: "TD-11 pending: estratégia de entrega para reprodução via streaming"
    resolved_by: "phase-03-videos/TD-11"
  - id: OQ-12
    status: resolved
    summary: "TD-12 pending: estratégia de download do vídeo"
    resolved_by: "phase-03-videos/TD-12"
  - id: OQ-13
    status: resolved
    summary: "TD-13 pending: política de acesso a streaming e download nesta fase"
    resolved_by: "phase-03-videos/TD-13"
  - id: OQ-14
    status: resolved
    summary: "TD-14 pending: isolamento de fila/storage nos testes e worker nas suítes"
    resolved_by: "phase-03-videos/TD-14"
advisories: []
---

# phase-03-videos: Validation

_Revalidação após `/plan-resolve 03` (2026-11-20): `context.md` regenerado não está desatualizado em relação às fontes; os 14 TDs estão `decided` e as revisões de TD-01, TD-03, TD-04, TD-05, TD-07, TD-09 e TD-12 não introduziram inconsistências nem conflitos com decisões e convenções herdadas (o formato de erro segue phase-02-auth/TD-07 e a validação de DTO segue phase-02-auth/TD-06). Status: `clean`._

_Execução não interativa conduzida pelo maestro (Diego). Fase monolítica (um único decisions doc `scope_type: phase` com `related_phases: [3]`), portanto a Check 8 (cross-slice) foi suprimida. Não há regras customizadas em `docs/rules/plan-validate/`. Sem escopo de UI (`## UI Inventory` ausente), então UIG-N e a verificação de sincronização de contratos FE↔BE (Decisão #29) não se aplicam._

## Findings

### Inconsistencies

_None._

### Ambiguities

_None._

### Missing Decisions

_None._

### Dependency Gaps

_None._

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

_None._

### UI Coverage Gaps

_None._ _(Sem escopo de UI nesta fase: `## UI Inventory` ausente.)_

## Resolved Issues

_Resolvido por `/plan-resolve 03` em 2026-11-20, em modo não interativo: as escolhas vieram das respostas do maestro (Diego) registradas nas instruções da execução, sem `AskUserQuestion`._

- **AMB-1** ("metadados" não definidos): resolvido como revisão de `phase-03-videos/TD-05` (modelo: duração em coluna própria, em segundos, e coluna `metadata` jsonb com largura, altura, codec de vídeo, codec de áudio ou nulo, bitrate, formato do container, frame rate e tamanho em bytes) e de `phase-03-videos/TD-07` (o worker extrai esses campos com `ffprobe -print_format json`). resolved_by: phase-03-videos/TD-05, phase-03-videos/TD-07 (Append revision; decisão do maestro).
- **MD-1** (formatos aceitos e limite de 10GB): em vez de um TD novo (vedado em phase mode), resolvido pela alternativa explícita do próprio achado, revisões de `phase-03-videos/TD-04` (MIME declarado restrito a `video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska`, outro MIME rejeitado com 400/422; limite de 10 737 418 240 bytes validado no início pelo tamanho declarado, que define a quantidade de partes; `HeadObject` na conclusão, abortando e marcando `failed` se exceder ou divergir) e de `phase-03-videos/TD-09` (arquivo não reconhecido pelo `ffprobe` é falha permanente, `failed` com motivo e sem retentativas). resolved_by: phase-03-videos/TD-04, phase-03-videos/TD-09 (Append revision; decisão do maestro).
- **OQ-1** (TD-01 pending: servidor de object storage no ambiente e SDK de acesso): **Decision:** C preenchido. Escolha do maestro contra a recomendação A: o scan Trivy (2026-11-20, `--severity HIGH,CRITICAL --ignore-unfixed`) reprovou `pgsty/minio` (52 HIGH e 3 CRITICAL com correção) e aprovou `rustfs/rustfs:1.0.5` (fixada por digest); motivo e imagem registrados no bloco `**Revisions:**` do TD-01. resolved_by: phase-03-videos/TD-01 (decisão do maestro).
- **OQ-2** (TD-02 pending: organização de buckets, chaves e endpoints interno/público): **Decision:** A preenchido. resolved_by: phase-03-videos/TD-02 (decisão do maestro).
- **OQ-3** (TD-03 pending: fila de processamento em segundo plano): **Decision:** A preenchido. Valkey com tag fixa e gate Trivy registrados em revisão. resolved_by: phase-03-videos/TD-03 (decisão do maestro).
- **OQ-4** (TD-04 pending: protocolo de upload de arquivos de até 10GB): **Decision:** A preenchido. resolved_by: phase-03-videos/TD-04 (decisão do maestro).
- **OQ-5** (TD-05 pending: ciclo de status do vídeo e relação com o rascunho da Fase 04): **Decision:** A preenchido. resolved_by: phase-03-videos/TD-05 (decisão do maestro).
- **OQ-6** (TD-06 pending: tratamento de uploads abandonados): **Decision:** A preenchido. resolved_by: phase-03-videos/TD-06 (decisão do maestro).
- **OQ-7** (TD-07 pending: topologia do worker e invocação do FFmpeg): **Decision:** A preenchido. resolved_by: phase-03-videos/TD-07 (decisão do maestro).
- **OQ-8** (TD-08 pending: como o worker lê o vídeo original no storage): **Decision:** A preenchido. resolved_by: phase-03-videos/TD-08 (decisão do maestro).
- **OQ-9** (TD-09 pending: retentativas, idempotência e registro de falha): **Decision:** A preenchido. resolved_by: phase-03-videos/TD-09 (decisão do maestro).
- **OQ-10** (TD-10 pending: geração do identificador público único do vídeo): **Decision:** A preenchido. resolved_by: phase-03-videos/TD-10 (decisão do maestro).
- **OQ-11** (TD-11 pending: estratégia de entrega para reprodução via streaming): **Decision:** A preenchido. resolved_by: phase-03-videos/TD-11 (decisão do maestro).
- **OQ-12** (TD-12 pending: estratégia de download do vídeo): **Decision:** A preenchido. Plano B (proxy com `Content-Disposition: attachment`) registrado em revisão caso o RustFS não honre `response-content-disposition`. resolved_by: phase-03-videos/TD-12 (decisão do maestro).
- **OQ-13** (TD-13 pending: política de acesso a streaming e download nesta fase): **Decision:** A preenchido. Acesso público por link a vídeos `ready` nesta fase. resolved_by: phase-03-videos/TD-13 (decisão do maestro).
- **OQ-14** (TD-14 pending: isolamento de fila/storage nos testes e worker nas suítes): **Decision:** A preenchido. resolved_by: phase-03-videos/TD-14 (decisão do maestro).

_Bibliotecas decididas e documentadas via context7 em `library-refs.md`: `@aws-sdk/client-s3` 3.1168.0, `@aws-sdk/s3-request-presigner` 3.1168.0, `@nestjs/bullmq` 12.0.1, `bullmq` 6.7.6 (mais recentes com pelo menos 7 dias de publicação)._

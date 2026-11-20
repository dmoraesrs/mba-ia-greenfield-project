---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-11-20
scope_description: "Backend da Fase 03: object storage, fila e worker de processamento, upload multipart pré-assinado de até 10GB, ciclo de status do vídeo, URL única, streaming com Range e download."
---

# Technical Decisions: Fase 03, Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/`: recebe todos os TDs deste documento: módulo `videos/`, integração com object storage e fila, entrypoint do worker, novos serviços no `compose.yaml` (storage S3, Redis/Valkey, `video-worker`), variáveis novas no Joi + `.env.example`, migrations e testes com infraestrutura real.
- `next-frontend/`: fora do escopo por decisão do maestro (fase só backend, sem inventário de UI). Sem TD aberto aqui. Os contratos que o frontend consumirá depois (upload direto ao storage, endpoint de streaming, download) ficam definidos pelos TDs Backend abaixo e respeitam o BFF estrito já decidido em `next-frontend-config-base/TD-03`, que antecipou explicitamente que vídeos usariam URLs pré-assinadas do storage e não a URL do backend.

> **Origem das respostas:** execução não interativa. As preferências técnicas do maestro (Diego) foram tratadas como hipótese a validar; cada TD avalia alternativas reais e registra quando a recomendação coincide ou diverge dessas preferências. Decisões herdadas e não reabertas: `@nestjs/config` + Joi + `registerAs` (`phase-01-configuracao-base/TD-01..04`), guards próprios com `@nestjs/jwt` e `Authorization: Bearer` (`phase-02-auth/TD-02`), class-validator (`phase-02-auth/TD-06`), envelope de erro de domínio (`phase-02-auth/TD-07`), `@nestjs/throttler` (`phase-02-auth/TD-08`), `@nestjs/swagger` + `openapi.json` exportado (`openapi-docs-nestjs/TD-01..02`), BFF estrito (`next-frontend-config-base/TD-03`). Os slugs da fase (`videos`, pasta `docs/phases/phase-03-videos/`) e a decisão de seguir sem perguntas também vieram do maestro.
>
> **Nota de formato:** o marcador `Transversal — covers:` mantém o travessão porque é o token literal que `plan-context` e `plan-validate` usam para casar capabilities; fora dele, o documento não usa travessão. O mesmo vale para o separador `YYYY-MM-DD — ` dos blocos `**Revisions:**`, exigido literalmente pelo parser do `decisions-reader`.
>
> **Resolução (2026-11-20, `/plan-resolve 03`, não interativa):** decisões preenchidas com as respostas do maestro (Diego): Option A em TD-02 a TD-14 e Option C (RustFS) em TD-01; AMB-1 e MD-1 do `validation.md` registrados como revisões de TD-04, TD-05, TD-07 e TD-09.

> **Achados de pesquisa relevantes (2026-11-20):**
> - A imagem oficial `minio/minio` não existe mais no Docker Hub (API retorna "object not found") e `quay.io/minio/minio` não resolve manifest para nenhuma tag testada. A distribuição comunitária ativa é o fork `pgsty/minio` (última release `RELEASE.2026-08-04T00-00-00Z`, cerca de 4,9 milhões de pulls, já presente no cache local). Isso afeta TD-01.
> - `fluent-ffmpeg` está marcado como `deprecated` no npm (2.1.3). Afeta TD-07.
> - O presigner do `@aws-sdk/s3-request-presigner` assina `UploadPartCommand` com `UNSIGNED-PAYLOAD`: a integridade de cada parte não é verificada pela assinatura, só por `ETag`/checksum. Afeta TD-04.
> - `@nestjs/bullmq` 12.x declara peer `@nestjs/core ^10 || ^11 || ^12` e `bullmq ^3..^6`, compatível com o Nest 11.1.16 instalado.
> - Portas do host livres no momento da pesquisa (`lsof` + `docker ps`): 6379, 9000, 9001. Portas 1025/8025 seguem ocupadas por outro projeto (já remapeadas via `compose.override.yaml` local).

---

## TD-01: Servidor de object storage no ambiente e SDK de acesso

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** A API, o worker e (no futuro) o navegador precisam de um storage de objetos compatível com S3 que suporte multipart upload, URLs pré-assinadas e GET com `Range`. O código deve falar apenas a API S3 (via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`), de modo que o servidor do ambiente local seja substituível por AWS S3 ou outro compatível em produção. A escolha aqui é qual servidor S3 roda no Compose, dado que a imagem oficial do MinIO deixou de ser distribuída.

**Options:**

### Option A: MinIO via fork comunitário `pgsty/minio` (tag fixa)
- Mesmo binário e mesma API do MinIO, com console web; tag de release fixa (`RELEASE.2026-08-04T00-00-00Z`). Cliente `mc` disponível no fork `pgsty/mc` (apenas `latest` publicado, então criação de bucket deve ser feita pela própria aplicação ou com outra imagem fixada).
- **Pros:** Compatibilidade S3 mais completa entre as opções locais (multipart, presign, Range, CORS, lifecycle). Documentação e exemplos abundantes. Alinha com a preferência do maestro e com o diagrama (`S3 or MinIO`).
- **Cons:** Mantido por terceiros, não pelo fornecedor original; cadência de releases incerta (última há cerca de 3,5 meses). Risco de supply-chain maior que o de uma imagem oficial.

### Option B: SeaweedFS (`chrislusf/seaweedfs`) com gateway S3
- Storage distribuído Apache-2.0, ativo, com endpoint S3 (`weed server -s3`). Suporta multipart e presign.
- **Pros:** Projeto ativo e oficial do mantenedor; licença permissiva; leve.
- **Cons:** Compatibilidade S3 menos completa (lacunas históricas em CORS e cabeçalhos de resposta como `response-content-disposition`); configuração de credenciais via arquivo JSON; menos material de referência.

### Option C: RustFS (`rustfs/rustfs`)
- Servidor S3 Apache-2.0 escrito em Rust, posicionado como substituto do MinIO, release 1.0.6 recente.
- **Pros:** Ativo, imagem oficial com tag fixa, API e console semelhantes ao MinIO.
- **Cons:** Projeto jovem (1.0 recente); menos histórico de compatibilidade em multipart grande e presign; risco de comportamento divergente em casos de borda.

**Recommendation:** **Option A (MinIO via `pgsty/minio` com tag fixa)**: mantém a preferência do maestro e oferece a compatibilidade S3 mais completa para os três fluxos críticos da fase (multipart pré-assinado, Range e `response-content-disposition`); o risco de manutenção do fork é contido porque o código depende só da API S3 (trocar para SeaweedFS ou AWS S3 é mudança de Compose e de variáveis, não de código), e esse risco deve ficar registrado no plano.

**Decision:** C
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

**Revisions:**
- 2026-11-20 — Maestro escolheu a Option C (RustFS) no lugar da recomendação A: imagem `rustfs/rustfs:1.0.5@sha256:b81d16a90ee25bd9511280127ca1471788c6e874cf0f0da759645f46b2dc1d74` (fixada por digest, publicada em 2026-11-10, cumpre o cooldown de 7 dias), portas 9000 (S3) e 9001 (console), credenciais via `RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY` ou as variáveis indicadas no README da imagem (confirmar na implementação); o código fala só a API S3 com `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner`, então trocar por S3 em produção não muda código. Rationale: scan Trivy de 2026-11-20 (`--severity HIGH,CRITICAL --ignore-unfixed`) reprovou `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` (52 HIGH e 3 CRITICAL com correção disponível) e aprovou `rustfs/rustfs:1.0.5` (nenhum HIGH/CRITICAL com correção); a imagem oficial `minio/minio` não existe mais no Docker Hub; se algum recurso S3 (ex.: `response-content-disposition`) falhar no RustFS, registrar no `progress.md` e usar a alternativa equivalente do TD-12 (decisão do maestro).

---

## TD-02: Organização de buckets, chaves e endpoints (interno e público)

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** O layout de buckets/chaves e o par de endpoints é um contrato entre Joi, `compose.yaml`, `.env.example`, API, worker e cliente. Dentro da rede Docker o storage é `http://minio:9000`; o cliente (navegador, testes de upload direto) precisa de um host roteável. Como a assinatura SigV4 inclui o `Host`, a URL pré-assinada tem de ser gerada já com o endpoint público, não reescrita depois.

**Options:**

### Option A: Bucket único privado com prefixos por vídeo + dois clientes S3 (interno e de assinatura pública)
- Um bucket (ex.: `streamtube-videos`) privado; chaves `videos/{videoId}/original` e `videos/{videoId}/thumbnail.jpg`. A API usa um `S3Client` com `S3_ENDPOINT` (interno) para operações servidor-a-servidor e outro com `S3_PUBLIC_ENDPOINT` apenas para gerar URLs pré-assinadas entregues ao cliente. `forcePathStyle: true`.
- **Pros:** Uma única política de acesso (tudo privado); remoção de um vídeo é apagar um prefixo; assinatura correta para cada audiência; funciona igual em S3 real (onde os dois endpoints podem coincidir).
- **Cons:** Thumbnails também exigem URL assinada ou proxy para serem exibidas (custo pequeno, resolvido em fases de UI).

### Option B: Dois buckets (originais privado, thumbnails público para leitura)
- `streamtube-originals` privado e `streamtube-thumbnails` com política `public-read`.
- **Pros:** Thumbnails servidas por URL estável e cacheável, sem assinatura.
- **Cons:** Duas políticas e mais variáveis; expõe thumbnails de vídeos ainda em rascunho para qualquer um que adivinhe a chave (o `videoId` é UUID, mas a chave pública vaza a existência do vídeo); decisões de visibilidade da Fase 04/05 passam a depender de política de bucket.

**Recommendation:** **Option A**: bucket único privado com chaves `videos/{videoId}/...` e endpoints interno/público separados (preferência do maestro), porque mantém toda a autorização na API até as fases de visibilidade (04/05) e resolve o problema do `Host` assinado sem gambiarras de reescrita de URL.

**Decision:** A

---

## TD-03: Fila de processamento em segundo plano

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** A API publica jobs de processamento e o worker os consome. A fila precisa de retentativa com backoff, visibilidade de falhas e integração com NestJS 11. O diagrama marca a fila como `TBD`. Depende de: TD-07 (topologia do worker).

**Options:**

### Option A: BullMQ sobre Redis/Valkey (`@nestjs/bullmq` + `bullmq`)
- Fila baseada em Redis com `Queue` (produtor na API) e `WorkerHost`/`@Processor` (consumidor no worker). `attempts` + `backoff: { type: 'exponential' }` nativos; eventos `failed`/`completed`; job schedulers para tarefas repetíveis.
- **Pros:** Integração oficial NestJS (`@nestjs/bullmq` 12.x compatível com Nest 11); retentativa, concorrência, rate limit e jobs repetíveis prontos; muito material de referência; servidor pode ser Redis ou Valkey (BSD), mantendo licença permissiva.
- **Cons:** Novo serviço de infraestrutura (Redis/Valkey) para operar e testar; enfileirar não é transacional com o Postgres (exige ordem cuidadosa: persistir status e então enfileirar, com o job idempotente).

### Option B: pg-boss sobre o PostgreSQL existente
- Fila armazenada no próprio Postgres (`pg-boss` 12.x), com `retryLimit`, `retryBackoff`, dead letter e `send` dentro da mesma transação do banco (via `db` customizado).
- **Pros:** Zero serviço novo; enfileirar pode ser atômico com a mudança de status do vídeo (elimina a janela "status mudou e job não foi publicado").
- **Cons:** Sem integração oficial NestJS (módulo próprio a escrever); polling sobre o banco de produção, que também atende usuários; cria um schema próprio fora das migrations TypeORM (convive mal com a suíte de migrations que espera banco zerado).

### Option C: RabbitMQ (`amqplib` ou `@nestjs/microservices`)
- Broker AMQP dedicado, com filas duráveis, DLX e TTL para retentativa.
- **Pros:** Broker robusto e padrão de mercado; bom para múltiplos consumidores e roteamento.
- **Cons:** Retentativa com backoff exige montar DLX + TTL manualmente; operação mais pesada; recursos de roteamento sem consumidor nesta fase.

**Recommendation:** **Option A (BullMQ sobre Valkey ou Redis com tag fixa)**: coincide com a preferência do maestro; entrega retentativa com backoff e jobs repetíveis (úteis em TD-06) sem código de infraestrutura próprio, e não polui o schema controlado por migrations. A falta de atomicidade com o Postgres é tratada pela idempotência do job (TD-09). Sobre a imagem: Valkey (BSD, já no cache local como `valkey/valkey:9.1.2-alpine`) evita a licença AGPL/RSAL do Redis 8 e é compatível com o protocolo; se o plano preferir aderência literal ao nome, `redis:8.8.4-alpine` com tag fixa também atende. Em ambos, configurar `maxmemory-policy noeviction`, exigido pela BullMQ.

**Decision:** A
**Libraries:** @nestjs/bullmq, bullmq

**Revisions:**
- 2026-11-20 — Servidor da fila definido como Valkey com tag fixa (preferencialmente fixada por digest e publicada há pelo menos 7 dias), com `maxmemory-policy noeviction`; a imagem passa por `trivy image --severity HIGH,CRITICAL --ignore-unfixed` antes de entrar no `compose.yaml`. Rationale: escolha do maestro (licença BSD e gate de segurança de imagens).

---

## TD-04: Protocolo de upload de arquivos de até 10GB

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** O upload de 10GB não pode ocupar memória, CPU ou conexões da API por muito tempo e, pelos pontos de atenção do plano, deve permitir retomar após queda de conexão. É um contrato com o cliente (sequência de chamadas), mesmo que o frontend esteja fora desta fase. Depende de: TD-01, TD-02.

**Options:**

### Option A: Multipart S3 com URLs pré-assinadas por parte (upload direto ao storage)
- A API cria o rascunho e o `CreateMultipartUpload`, devolve `uploadId`, tamanho de parte e URLs pré-assinadas de `UploadPart` (sob demanda ou em lotes); o cliente envia as partes direto ao storage e informa os `ETag`; a API chama `CompleteMultipartUpload`. Retomar = `ListParts` + reassinar as partes faltantes.
- **Pros:** Nenhum byte do vídeo passa pela API; paralelismo e retomada nativos do S3; padrão de mercado; funciona igual em MinIO e S3.
- **Cons:** Mais chamadas de orquestração (iniciar, assinar, concluir, abortar); a assinatura não valida o conteúdo da parte (`UNSIGNED-PAYLOAD`), então tamanho total e tipo real precisam ser verificados depois (`HeadObject` e ffprobe); exige CORS no bucket expondo `ETag` para clientes de navegador.

### Option B: Protocolo tus via API (`@tus/server` + `@tus/s3-store`)
- A API expõe um endpoint tus; o cliente envia chunks para a API, que os repassa ao S3 como multipart.
- **Pros:** Protocolo aberto e retomável com clientes prontos (`tus-js-client`, Uppy).
- **Cons:** Todos os 10GB atravessam a API (CPU, rede e conexões longas no processo Nest), contrariando "sem impacto na performance"; nova dependência de servidor tus e integração com Express/Nest manual.

### Option C: Upload streaming único pela API (multipart/form-data repassado ao S3)
- O cliente envia um único request à API, que faz pipe para o storage via `@aws-sdk/lib-storage`.
- **Pros:** Implementação mais simples para o cliente.
- **Cons:** Sem retomada; conexão de horas segurando um worker HTTP da API; falha no fim perde tudo. Inadequado para 10GB.

**Recommendation:** **Option A (multipart S3 pré-assinado, upload direto)**: coincide com a preferência do maestro e é a única opção que satisfaz ao mesmo tempo "não passa pela API" e "retomar após falha". Parâmetros a fixar no plano: tamanho máximo 10 GiB validado no início (tamanho declarado) e na conclusão (`HeadObject`, apagando e falhando se exceder); tamanho de parte fixo calculado pela API (ex.: 64 MiB, cerca de 160 partes para 10 GiB, dentro dos limites S3 de 5 MiB a 5 GiB por parte e 10.000 partes); expiração curta das URLs de parte (ex.: 1 h, reassináveis); `Content-Type` declarado restrito a `video/*`, com validação real feita pelo ffprobe no worker.

**Decision:** A
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

**Revisions:**
- 2026-11-20 — Validação do arquivo no upload (MD-1): MIME declarado no início restrito a `video/mp4`, `video/webm`, `video/quicktime` e `video/x-matroska` (outro MIME é rejeitado pela validação de DTO da API com 400/422); limite de 10GB (10 737 418 240 bytes) validado no início pelo tamanho declarado, que também define a quantidade de partes; na conclusão a API confere o tamanho real do objeto (`HeadObject`) e, se passar do limite ou divergir do declarado, aborta e marca o vídeo `failed` com motivo. Rationale: resposta do maestro ao MD-1 do validation.md (substitui o `video/*` genérico da recomendação).

---

## TD-05: Ciclo de status do vídeo e relação com o rascunho da Fase 04

**Scope:** Backend

**Capability:** Transversal — covers: Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** O vídeo nasce no início do upload e passa por upload, processamento e conclusão ou falha. A Fase 04 traz "Fluxo de rascunho → publicação" e a palavra "rascunho" aparece nas duas fases com sentidos diferentes (aqui: pré-cadastro com upload pendente; lá: não publicado). O formato do status é contrato entre entidade, migration, API, worker e a Fase 04.

**Options:**

### Option A: Enum único de processamento `draft → processing → ready | failed` + `failure_reason`, com publicação em campo separado na Fase 04
- `status` cobre só o ciclo técnico: `draft` (criado ao iniciar o upload), `processing` (upload concluído e job enfileirado), `ready` ou `failed` (com motivo). A Fase 04 adiciona um campo próprio de publicação (ex.: `published_at`/visibilidade), sem tocar neste enum.
- **Pros:** Preferência do maestro; simples; cada fase dona do seu campo.
- **Cons:** O valor `draft` aqui significa "upload pendente", e a Fase 04 chamará de rascunho um vídeo `ready` não publicado; exige registrar essa semântica no plano para não confundir.

### Option B: Enum único estendido `uploading → processing → ready | failed` (sem `draft`) e "rascunho" reservado à publicação
- Mesmo ciclo da Option A, com o primeiro estado renomeado para `uploading`; "rascunho" vira exclusivamente o estado de publicação da Fase 04.
- **Pros:** Elimina a ambiguidade de vocabulário entre fases.
- **Cons:** Diverge do texto literal da capability ("pré-cadastro como rascunho") e da preferência do maestro.

### Option C: Enum único cobrindo processamento e publicação (`draft → processing → ready → published | failed`)
- Um só campo para todo o ciclo de vida.
- **Pros:** Uma coluna só.
- **Cons:** Mistura duas dimensões ortogonais; a visibilidade público/unlisted da Fase 04 e reprocessamentos futuros tornam as transições confusas; antecipa decisão da Fase 04.

**Recommendation:** **Option A**: adota o ciclo do maestro, que bate com o texto da capability, e mantém a publicação da Fase 04 em campo separado; o plano deve documentar que `draft` significa "pré-cadastro com upload ainda não concluído" e que todo vídeo permanece não publicado até a Fase 04.

**Decision:** A

**Revisions:**
- 2026-11-20 — Modelo de dados do vídeo (AMB-1): duração em coluna própria (segundos) e coluna `metadata` (jsonb) com largura, altura, codec de vídeo, codec de áudio (ou nulo), bitrate, formato do container, frame rate e tamanho em bytes. Rationale: resposta do maestro ao AMB-1 do validation.md.

---

## TD-06: Tratamento de uploads abandonados

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** Como o rascunho é criado antes do upload, uploads interrompidos e nunca retomados deixam linhas `draft` e partes multipart órfãs ocupando espaço no storage (ponto de atenção "custos de armazenamento"). O mecanismo de limpeza envolve banco, storage e possivelmente a fila. Depende de: TD-03, TD-04, TD-05.

**Options:**

### Option A: Job repetível na fila (BullMQ job scheduler) que expira rascunhos antigos
- Um job periódico busca vídeos `draft` com `created_at` acima de um limite (ex.: 24 h), chama `AbortMultipartUpload` e marca `failed` com motivo `upload_expired`.
- **Pros:** Independe do servidor de storage; banco e storage ficam consistentes; testável com infraestrutura real.
- **Cons:** Mais um processador e um parâmetro de configuração.

### Option B: Regra do próprio storage (lifecycle `AbortIncompleteMultipartUpload` no S3, expiração de uploads parados no MinIO)
- O storage descarta partes órfãs sozinho; o banco não é tocado.
- **Pros:** Zero código.
- **Cons:** Comportamento varia por servidor (regra de lifecycle no S3, configuração global no MinIO); linhas `draft` ficam eternas no banco e o usuário não recebe estado final.

### Option C: Não tratar nesta fase
- **Pros:** Menor escopo.
- **Cons:** Acúmulo silencioso de lixo no storage e no banco; resolver depois exige migração de dados.

**Recommendation:** **Option A**: reaproveita a fila escolhida em TD-03, fecha o ciclo do status (TD-05) com um estado final explícito e não depende de recursos específicos do servidor S3; o limite de expiração entra como variável de ambiente.

**Decision:** A

---

## TD-07: Topologia do worker e invocação do FFmpeg

**Scope:** Backend

**Capability:** Transversal — covers: Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** O processamento é pesado (CPU e I/O) e não pode competir com a API. O diagrama já prevê um container `Video Worker (FFmpeg)`. Decide-se onde o consumidor roda, como o binário FFmpeg chega à imagem e como é chamado. Afeta `compose.yaml`, Dockerfile, entrypoints e testes (os testes rodam dentro de `nestjs-api` e precisam gerar um vídeo com ffmpeg).

**Options:**

### Option A: Container `video-worker` com o mesmo código Nest e entrypoint próprio; FFmpeg do apt na imagem; chamada via `child_process.spawn`
- Novo `src/worker.ts` cria um contexto Nest (`NestFactory.createApplicationContext`) com um `WorkerModule` que registra apenas o processador e o que ele usa. A imagem de desenvolvimento ganha `ffmpeg` via `apt` (Debian da `node:25.6.0-slim`), usada por `nestjs-api` e `video-worker`. `ffprobe -print_format json` e `ffmpeg -frames:v 1` chamados com `spawn` e argumentos em array.
- **Pros:** Isolamento de CPU/memória e escala independente; reaproveita entidades, configuração e repositórios; um único Dockerfile; ffmpeg disponível também para os testes; sem dependência npm em wrapper (o `fluent-ffmpeg` está deprecated).
- **Cons:** Dois processos para subir no ambiente; imagem maior (pacote ffmpeg); parsing do JSON do ffprobe tipado à mão.

### Option B: Processador dentro do processo da API
- `@Processor` registrado no `AppModule`, consumindo no mesmo processo que atende HTTP.
- **Pros:** Um processo só; setup mínimo.
- **Cons:** FFmpeg e I/O pesado disputam CPU com as requisições, contrariando "sem impacto na performance"; não escala separado; diverge do diagrama.

### Option C: Subprojeto separado para o worker (outro package/serviço)
- Novo diretório com seu próprio `package.json`, compartilhando código via pacote interno.
- **Pros:** Separação máxima de dependências.
- **Cons:** Exige tooling de monorepo/compartilhamento que o projeto não tem; duplicação de entidades e configuração.

**Recommendation:** **Option A**: preferência do maestro, alinhada ao diagrama; isola o custo de processamento sem duplicar código e coloca o ffmpeg na mesma imagem usada pelos testes, que precisam gerar o vídeo de exemplo. Binários estáticos via npm (`ffmpeg-static`) foram descartados porque baixam o binário em script de pós-instalação, conflitando com a política `--ignore-scripts`.

**Decision:** A

**Revisions:**
- 2026-11-20 — Extração do worker (AMB-1): `ffprobe -print_format json` fornece a duração (segundos) e os campos de `metadata` (largura, altura, codec de vídeo, codec de áudio ou nulo, bitrate, formato do container, frame rate, tamanho em bytes); a imagem base do worker com FFmpeg passa por `trivy image --severity HIGH,CRITICAL --ignore-unfixed` e usa tag fixa (preferencialmente por digest, publicada há pelo menos 7 dias). Rationale: resposta do maestro ao AMB-1 e gate de segurança de imagens.

---

## TD-08: Como o worker lê o vídeo original no storage

**Scope:** Backend

**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** O original pode ter 10GB. Baixar tudo para o disco do worker antes de rodar o ffprobe custa tempo, rede e espaço em volume. FFmpeg e ffprobe leem HTTP com seek por `Range`. Depende de: TD-01, TD-02, TD-07.

**Options:**

### Option A: ffprobe/ffmpeg leem direto de uma URL pré-assinada de GET (endpoint interno)
- O worker gera uma URL de GET curta com o endpoint interno (`http://minio:9000`) e a passa como input; o ffprobe lê só os cabeçalhos/átomos necessários e o ffmpeg faz seek até o frame da thumbnail.
- **Pros:** Lê apenas os bytes necessários (MB, não GB); sem volume temporário; tempo de processamento quase independente do tamanho do arquivo.
- **Cons:** Arquivos MP4 com `moov` no fim exigem alguns requests extras de Range (ainda pequenos); a URL precisa durar o processamento.

### Option B: Download completo para diretório temporário e processamento local
- `GetObject` em stream para arquivo temporário, ffprobe/ffmpeg locais, remoção ao final.
- **Pros:** Comportamento previsível do ffmpeg com arquivo local; sem dependência de rede durante o processamento.
- **Cons:** Até 10GB de rede e disco por job; volume dimensionado para o pior caso vezes a concorrência; processamento lento para arquivos grandes.

### Option C: Pipe do `GetObject` para o stdin do ffmpeg
- **Pros:** Sem disco.
- **Cons:** Stdin não permite seek: formatos com índice no fim falham ou exigem ler o arquivo inteiro; inadequado para extrair frame no meio.

**Recommendation:** **Option A**: para extrair duração, metadados e um frame, ler por Range via URL pré-assinada interna evita transferir 10GB por job e dispensa volume temporário; se algum formato falhar por leitura remota, o motivo vai para `failure_reason` e a Option B fica como alternativa futura.

**Decision:** A

---

## TD-09: Retentativas, idempotência e registro de falha do processamento

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Falhas transitórias (storage indisponível, worker reiniciado) devem ser retentadas; falhas permanentes (arquivo que não é vídeo) não devem desperdiçar tentativas. O job pode ser entregue mais de uma vez e o enfileiramento não é transacional com o banco (TD-03). A política envolve opções da fila, entidade (`failure_reason`) e worker. Depende de: TD-03, TD-05.

**Options:**

### Option A: Retentativa com backoff exponencial na fila + erro "não retentável" para falhas permanentes + job idempotente com `jobId` = `videoId`
- `attempts` (ex.: 3) com `backoff` exponencial; erros de conteúdo inválido lançados como `UnrecoverableError` (BullMQ) para ir direto a `failed`; no evento final de falha o worker grava `failed` + `failure_reason`. `jobId` determinístico evita jobs duplicados para o mesmo vídeo; reprocessar sobrescreve duração, metadados e thumbnail.
- **Pros:** Usa recursos nativos da fila; não gasta tentativas com arquivo inválido; reenvio do "concluir upload" não duplica trabalho.
- **Cons:** Exige classificar erros no worker.

### Option B: Retentativa uniforme para qualquer erro
- `attempts` + backoff para tudo, `failed` após esgotar.
- **Pros:** Mais simples.
- **Cons:** Arquivo inválido gasta todas as tentativas e atrasa o feedback; sem deduplicação, cliques repetidos geram jobs duplicados.

**Recommendation:** **Option A**: concretiza a preferência do maestro (backoff na fila e `failed` com motivo ao esgotar) e acrescenta a distinção transitório/permanente e a deduplicação por `jobId`, que custam pouco e eliminam os dois modos de falha mais comuns desse fluxo.

**Decision:** A

**Revisions:**
- 2026-11-20 — Arquivo inválido (MD-1): arquivo que o `ffprobe` não reconhece como vídeo é falha permanente no worker (`UnrecoverableError`, `failed` com motivo, sem gastar retentativas); divergência ou excesso de tamanho detectado na conclusão do upload é marcado `failed` pela própria API (TD-04), sem enfileirar job. Rationale: resposta do maestro ao MD-1 do validation.md.

---

## TD-10: Geração do identificador público único do vídeo

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Cada vídeo precisa de uma URL curta que nunca conflite (ponto de atenção do plano). O identificador aparece na rota pública, no banco (constraint) e nos contratos futuros do frontend. Também funciona como barreira contra enumeração, relevante para vídeos unlisted da Fase 05.

**Options:**

### Option A: 11 caracteres base64url aleatórios (`crypto.randomBytes(8)`) + `UNIQUE` + nova tentativa em colisão
- 64 bits de entropia gerados com o módulo nativo `crypto`; colisão detectada pela violação de unicidade no insert e resolvida com nova geração (limite de tentativas).
- **Pros:** Sem dependência; curto; não enumerável; a garantia de unicidade fica no banco.
- **Cons:** Precisa de laço de retentativa no repositório/serviço (probabilidade de colisão desprezível na escala do projeto).

### Option B: `nanoid` com alfabeto e tamanho customizados
- Mesma ideia via biblioteca.
- **Pros:** API pronta para alfabetos customizados.
- **Cons:** Dependência extra para algo que o `crypto` nativo resolve; versões recentes são ESM-only, exigindo atenção com a compilação CommonJS do projeto.

### Option C: Codificar o id sequencial (Sqids/Hashids)
- **Pros:** Unicidade garantida sem colisão.
- **Cons:** Reversível e enumerável (vaza volume de vídeos e permite varrer unlisted); exige id sequencial além do UUID atual.

**Recommendation:** **Option A**: coincide com a preferência do maestro; 64 bits aleatórios com `UNIQUE` no banco garantem "nunca conflita" de forma verificável, sem dependência nova e sem permitir enumeração, o que protege os vídeos unlisted da Fase 05.

**Decision:** A

---

## TD-11: Estratégia de entrega para reprodução via streaming

**Scope:** Backend

**Capability:** Reprodução via streaming (sem necessidade de download completo)

**Context:** O player precisa começar a tocar e buscar posições sem baixar o arquivo inteiro, o que exige respostas `206 Partial Content` a requests com `Range`. Há tensão entre a preferência do maestro (API repassando o Range) e o diagrama (frontend faz stream direto do storage), somada ao BFF estrito (`next-frontend-config-base/TD-03`): se a API fizer proxy, os bytes também passam pelo Route Handler do Next. Depende de: TD-01, TD-02, TD-13.

**Options:**

### Option A: Endpoint da API com proxy de `Range` para o storage (`206`)
- `GET /videos/:publicId/stream` repassa o `Range` ao `GetObject` e devolve `206` com `Content-Range`, `Accept-Ranges` e `Content-Length`, em stream com backpressure.
- **Pros:** URL estável, sem expiração no meio da reprodução; autorização e regras de visibilidade (Fases 04/05) aplicadas a cada request; storage nunca exposto ao player; contagem de visualização possível no futuro; testável integralmente no backend.
- **Cons:** Todo byte reproduzido passa pela API (e pelo BFF no Next, que precisa repassar o corpo em stream); diverge da seta do diagrama.

### Option B: API devolve URL pré-assinada de GET (endpoint público) e o player lê direto do storage
- `GET /videos/:publicId/playback` responde com a URL (ou `302`); o storage responde `206` nativamente.
- **Pros:** Zero banda na API e no BFF; alinhado ao diagrama e à observação de `next-frontend-config-base/TD-03`.
- **Cons:** URL expira (seek após a expiração falha e o player precisa renovar); URL compartilhável enquanto válida; exige CORS no storage para o player.

### Option C: Transcodificação para HLS/DASH com segmentos
- **Pros:** Bitrate adaptativo, padrão de plataformas grandes.
- **Cons:** Custo de CPU e storage muito maior; fora das capabilities da fase (só duração, metadados e thumbnail).

**Recommendation:** **Option A (proxy com Range e 206)**: mantém a preferência do maestro porque a fase é só backend e as Fases 04/05 trarão regras de visibilidade (unlisted, público) que ficam naturalmente na API a cada request, sem URL que expire no meio do vídeo; o custo de banda é linear e tratável com streams. O plano deve registrar a divergência com o diagrama e que a Option B continua sendo adição não quebrável caso a banda pela API/BFF vire gargalo.

**Decision:** A

---

## TD-12: Estratégia de download do vídeo

**Scope:** Backend

**Capability:** Download do vídeo pelo usuário

**Context:** O download entrega o arquivo inteiro (até 10GB) com `Content-Disposition: attachment`. Diferente do streaming, não há seek contínuo durante minutos e o custo de passar 10GB pela API e pelo BFF é alto. Depende de: TD-02, TD-11, TD-13.

**Options:**

### Option A: `302` para URL pré-assinada de GET com `ResponseContentDisposition: attachment`
- `GET /videos/:publicId/download` valida acesso e redireciona para uma URL pré-assinada (endpoint público) com o cabeçalho de resposta sobrescrito e nome de arquivo derivado do título.
- **Pros:** Nenhum byte pela API/BFF; o storage cuida de retomada de download (`Range`); simples.
- **Cons:** URL válida por um período (curto); depende de o servidor S3 honrar `response-content-disposition` (MinIO honra).

### Option B: Proxy pela API com `Content-Disposition: attachment`
- Mesmo mecanismo do streaming, com o arquivo inteiro.
- **Pros:** Mesma infraestrutura do TD-11; storage nunca exposto.
- **Cons:** 10GB por download atravessando API e BFF; conexões longas no processo Nest.

**Recommendation:** **Option A**: as duas formas foram aceitas pelo maestro; o redirect pré-assinado retira da API o maior volume de bytes da fase, e o controle de acesso continua no endpoint que emite a URL, que pode ter expiração curta porque o download não depende de seek prolongado como a reprodução.

**Decision:** A

**Revisions:**
- 2026-11-20 — Plano B condicionado ao storage: se o RustFS (TD-01) não honrar `response-content-disposition` na URL pré-assinada, registrar no `progress.md` e servir o download pela Option B (proxy na API com `Content-Disposition: attachment`), sem mudar o contrato do endpoint. Rationale: condição registrada pelo maestro ao escolher o RustFS.

---

## TD-13: Política de acesso a streaming e download nesta fase

**Scope:** Backend

**Capability:** Transversal — covers: Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** Publicação e visibilidade só chegam na Fase 04 e o acesso anônimo à visualização na Fase 05. Na Fase 03 é preciso decidir quem pode tocar e baixar um vídeo. Restrição técnica: um elemento `<video src>` não envia `Authorization: Bearer` (`phase-02-auth/TD-02`), então streaming autenticado por header não funciona em player nativo sem mecanismo extra.

**Options:**

### Option A: Acesso público por `publicId` a vídeos `ready`; demais estados respondem 404
- Endpoints `@Public()`; o `publicId` não enumerável (TD-10) funciona como link não listado provisório. Fases 04/05 acrescentam filtros de publicação/visibilidade sem mudar a rota.
- **Pros:** Compatível com player nativo e com o acesso anônimo planejado na Fase 05; testável sem token; não vaza rascunhos sem upload concluído.
- **Cons:** Vídeos processados ficam acessíveis a quem tiver o link antes da Fase 04 existir (equivalente a unlisted).

### Option B: Somente o dono autenticado acessa até a Fase 04/05
- Endpoints com o guard JWT e checagem de dono.
- **Pros:** Nada exposto antes das regras de publicação.
- **Cons:** Não funciona em `<video>` sem token na URL ou cookie, decisões que o projeto não tomou; a Fase 05 reabriria a política de qualquer forma.

### Option C: Dono sempre, anônimo apenas se `ready` (acesso opcional)
- Guard opcional que identifica o dono quando há token.
- **Pros:** Dono pode acessar antes do `ready` (ex.: depurar).
- **Cons:** Mais complexidade de guard sem ganho real nesta fase (não há o que tocar antes do `ready`).

**Recommendation:** **Option A**: é a única que funciona com player nativo dado o Bearer em header, antecipa o acesso anônimo da Fase 05 e protege por não enumerabilidade do `publicId`; a exposição tipo unlisted antes da Fase 04 é aceitável em ambiente de desenvolvimento e deve ser registrada no plano.

**Decision:** A

---

## TD-14: Isolamento de fila e storage nos testes e execução do worker nas suítes

**Scope:** Backend

**Capability:** Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails); Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Os testes rodam no container `nestjs-api` contra a infraestrutura real do Compose. Se o container `video-worker` de desenvolvimento estiver ligado, ele consumiria os jobs enfileirados pelos testes usando o banco e o bucket de desenvolvimento, gerando resultados não determinísticos. O isolamento envolve variáveis de ambiente (Joi, `.env.example`), nomes de fila/prefixo e bucket, e a forma como o e2e sobe o worker. A suíte de migrations exige banco zerado e as suítes rodam com `--runInBand`.

**Options:**

### Option A: Prefixo BullMQ e bucket próprios de teste + worker in-process nas suítes
- Variáveis como `QUEUE_PREFIX` e `S3_BUCKET` recebem valores de teste; o e2e sobe o mesmo `WorkerModule` usado pelo entrypoint do container dentro do processo do Jest, gera um vídeo pequeno com ffmpeg, faz upload multipart real no storage, espera o `ready` e valida `206` no streaming.
- **Pros:** Determinístico mesmo com o `video-worker` de desenvolvimento ligado; exercita o código real do worker contra Postgres, Valkey/Redis e storage reais; sem orquestrar containers a partir do teste.
- **Cons:** Não testa o entrypoint do container em si (coberto por um smoke de inicialização do contexto do worker).

### Option B: Testes dependem do container `video-worker` apontado para o ambiente de teste
- O worker do Compose consome os jobs dos testes.
- **Pros:** Exercita exatamente o processo implantado.
- **Cons:** O container teria de usar banco/bucket de teste, conflitando com o uso de desenvolvimento; testes passam a depender do estado de outro container e de tempos de polling; difícil limpar entre suítes.

**Recommendation:** **Option A**: atende a exigência do maestro de testar upload multipart real, processamento pelo worker com vídeo gerado por ffmpeg e streaming com `206`, sem acoplar os testes ao estado do container de desenvolvimento; a separação por prefixo e bucket é o mesmo contrato de variáveis que já isola ambientes em produção.

**Decision:** A

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Servidor de object storage no ambiente e SDK | A (MinIO via `pgsty/minio` com tag fixa + `@aws-sdk/client-s3`) | C |
| TD-02 | Backend | Buckets, chaves e endpoints interno/público | A (bucket único privado, `videos/{videoId}/...`, dois clientes S3) | A |
| TD-03 | Backend | Fila de processamento | A (BullMQ sobre Valkey/Redis) | A |
| TD-04 | Backend | Protocolo de upload de até 10GB | A (multipart S3 pré-assinado, upload direto) | A |
| TD-05 | Backend | Ciclo de status do vídeo | A (`draft → processing → ready/failed`, publicação separada na Fase 04) | A |
| TD-06 | Backend | Uploads abandonados | A (job repetível que expira rascunhos e aborta multipart) | A |
| TD-07 | Backend | Topologia do worker e FFmpeg | A (container `video-worker`, mesmo código, ffmpeg do apt, `spawn`) | A |
| TD-08 | Backend | Leitura do original pelo worker | A (ffprobe/ffmpeg via URL pré-assinada interna) | A |
| TD-09 | Backend | Retentativas, idempotência e falha | A (backoff exponencial + erro não retentável + `jobId` = `videoId`) | A |
| TD-10 | Backend | Identificador público único | A (11 caracteres base64url de `crypto.randomBytes` + `UNIQUE`) | A |
| TD-11 | Backend | Entrega para streaming | A (proxy de Range na API, `206`) | A |
| TD-12 | Backend | Estratégia de download | A (`302` para URL pré-assinada com `attachment`) | A |
| TD-13 | Backend | Acesso a streaming e download nesta fase | A (público por `publicId` para vídeos `ready`) | A |
| TD-14 | Backend | Isolamento de testes e worker nas suítes | A (prefixo/bucket de teste + worker in-process) | A |

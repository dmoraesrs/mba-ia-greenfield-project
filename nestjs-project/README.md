<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Vídeos: upload, processamento e streaming (Fase 03)

### Infraestrutura no Compose

| Serviço | Papel | Porta no host |
|---------|-------|---------------|
| `minio` | Object storage compatível com S3 (vídeos e thumbnails), imagem `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` (fork comunitário do MinIO) fixada por digest | `9000` (API S3) e `9001` (console) |
| `valkey` | Servidor da fila BullMQ (`maxmemory-policy noeviction`) | nenhuma: acesso só pela rede do Compose (`QUEUE_HOST=valkey`) |
| `video-worker` | Mesmo código da API com entrypoint `src/worker.ts`; consome as filas e roda FFmpeg | nenhuma |

As credenciais do storage (`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`) vêm do `.env` (veja `.env.example`). A API e o worker falam com o storage por `STORAGE_ENDPOINT=http://minio:9000`; as URLs pré-assinadas entregues ao cliente usam `STORAGE_PUBLIC_ENDPOINT` (em desenvolvimento, `http://localhost:9000`). Logs do worker: `docker compose logs video-worker`.

### Fluxo de upload (o arquivo nunca passa pela API)

1. `POST /videos` com `{ filename, mime_type, size_bytes }` (MP4, WebM, QuickTime ou Matroska, até 10 GiB): cria o vídeo como `draft` e devolve as URLs pré-assinadas das partes (64 MiB cada).
2. O cliente envia cada parte com `PUT {url}` direto ao storage e guarda o cabeçalho `ETag`. Para retomar: `GET /videos/:id/upload/parts` lista o que já chegou e `POST /videos/:id/upload/parts` reassina partes.
3. `POST /videos/:id/upload/complete` com `{ parts: [{ part_number, etag }] }`: confere o tamanho real e enfileira o processamento (`processing`).
4. O `video-worker` extrai duração e metadados com `ffprobe`, gera a thumbnail com `ffmpeg` e marca `ready` (ou `failed` com motivo). Acompanhe por `GET /videos/:id`.
5. Reprodução e download pela URL única: `GET /videos/public/:publicId`, `.../stream` (suporta `Range`, responde `206`), `.../thumbnail` e `.../download` (redirect `302` para URL pré-assinada com `Content-Disposition: attachment`).

Rascunhos não concluídos em `UPLOAD_EXPIRATION_HOURS` (padrão 24 h) são expirados por um job agendado (`failed`, `upload_expired`).

### Riscos e decisões registrados

- **Servidor S3 trocável por configuração** (`phase-03-videos/TD-01`): o MinIO roda pelo fork comunitário `pgsty/minio` (a imagem oficial saiu do Docker Hub) e a imagem tem CVEs conhecidos aceitos por ser ambiente local/lab; o código usa só a API S3 (`@aws-sdk/client-s3`), então trocar por S3 ou outro servidor compatível é questão de variáveis de ambiente.
- **Streaming pela API** (`phase-03-videos/TD-11`): o diagrama de arquitetura prevê o frontend lendo direto do storage; nesta fase o streaming passa pela API (proxy com `Range`), o que consome banda e conexões da API.
- **Acesso por link a vídeos `ready`** (`phase-03-videos/TD-13`): até a Fase 04 introduzir publicação e visibilidade, qualquer pessoa com o `public_id` acessa um vídeo pronto (equivalente a "não listado"), protegido apenas pela não enumerabilidade do identificador.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

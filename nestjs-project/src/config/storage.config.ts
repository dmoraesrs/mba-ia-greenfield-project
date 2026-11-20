import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  /** Endpoint interno (nome do serviço do Compose), usado pela API e pelo worker. */
  endpoint: process.env.STORAGE_ENDPOINT ?? 'http://rustfs:9000',
  /** Endpoint público, usado só para assinar URLs entregues ao cliente. */
  publicEndpoint:
    process.env.STORAGE_PUBLIC_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.STORAGE_REGION ?? 'us-east-1',
  bucket: process.env.STORAGE_BUCKET ?? '',
  accessKeyId: process.env.STORAGE_ACCESS_KEY ?? '',
  secretAccessKey: process.env.STORAGE_SECRET_KEY ?? '',
}));

/**
 * Erros internos da camada de storage. Não são exceções HTTP: o serviço de vídeos
 * os traduz para os códigos do Error Catalog da fase.
 */
export abstract class StorageError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = this.constructor.name;
  }
}

export class StorageObjectNotFoundError extends StorageError {
  constructor(cause?: unknown) {
    super('Storage object not found', cause);
  }
}

export class StorageUploadNotFoundError extends StorageError {
  constructor(cause?: unknown) {
    super('Multipart upload not found', cause);
  }
}

export class StorageInvalidPartsError extends StorageError {
  constructor(cause?: unknown) {
    super('Multipart upload parts are invalid or incomplete', cause);
  }
}

export class StorageRangeNotSatisfiableError extends StorageError {
  constructor(cause?: unknown) {
    super('Requested range not satisfiable', cause);
  }
}

interface SdkServiceErrorLike {
  name: string;
  $metadata?: { httpStatusCode?: number };
}

function isSdkServiceError(err: unknown): err is SdkServiceErrorLike {
  return (
    typeof err === 'object' &&
    err !== null &&
    '$metadata' in err &&
    typeof (err as { name?: unknown }).name === 'string'
  );
}

const OBJECT_NOT_FOUND = new Set(['NoSuchKey', 'NotFound']);
const UPLOAD_NOT_FOUND = new Set(['NoSuchUpload']);
const INVALID_PARTS = new Set([
  'InvalidPart',
  'InvalidPartOrder',
  'EntityTooSmall',
]);
const RANGE_NOT_SATISFIABLE = new Set(['InvalidRange']);

/**
 * Converte um erro do SDK S3 no erro de domínio correspondente. Erros sem
 * mapeamento são devolvidos sem alteração, para propagarem como 500.
 */
export function mapStorageError(err: unknown): unknown {
  if (!isSdkServiceError(err)) return err;
  const { name } = err;
  const status = err.$metadata?.httpStatusCode;

  if (UPLOAD_NOT_FOUND.has(name)) return new StorageUploadNotFoundError(err);
  if (OBJECT_NOT_FOUND.has(name)) return new StorageObjectNotFoundError(err);
  if (INVALID_PARTS.has(name)) return new StorageInvalidPartsError(err);
  if (RANGE_NOT_SATISFIABLE.has(name) || status === 416) {
    return new StorageRangeNotSatisfiableError(err);
  }
  return err;
}

import {
  mapStorageError,
  StorageInvalidPartsError,
  StorageObjectNotFoundError,
  StorageRangeNotSatisfiableError,
  StorageUploadNotFoundError,
} from './storage.errors';

const sdkError = (name: string, httpStatusCode: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });

describe('mapStorageError', () => {
  it.each([
    ['NoSuchKey', 404, StorageObjectNotFoundError],
    ['NotFound', 404, StorageObjectNotFoundError],
    ['NoSuchUpload', 404, StorageUploadNotFoundError],
    ['InvalidPart', 400, StorageInvalidPartsError],
    ['InvalidPartOrder', 400, StorageInvalidPartsError],
    ['EntityTooSmall', 400, StorageInvalidPartsError],
    ['InvalidRange', 416, StorageRangeNotSatisfiableError],
  ])('should map SDK error %s to its domain error', (name, status, type) => {
    const original = sdkError(name, status);

    const mapped = mapStorageError(original);

    expect(mapped).toBeInstanceOf(type);
    expect((mapped as Error).cause).toBe(original);
  });

  it('should map any 416 response to StorageRangeNotSatisfiableError', () => {
    const mapped = mapStorageError(sdkError('UnknownError', 416));

    expect(mapped).toBeInstanceOf(StorageRangeNotSatisfiableError);
  });

  it('should return unmapped SDK errors unchanged', () => {
    const original = sdkError('AccessDenied', 403);

    expect(mapStorageError(original)).toBe(original);
  });

  it('should return non-SDK errors unchanged', () => {
    const original = new Error('socket hang up');

    expect(mapStorageError(original)).toBe(original);
  });
});

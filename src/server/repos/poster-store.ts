/**
 * Poster files (SPEC §4.7): '<key>' (full size) and '<key>/thumb' in R2.
 * Keys are '<eventId>/<ulid>': a new one on every upload, so files never change.
 */
export type PosterVariant = 'full' | 'thumb';

export interface PosterFile {
  body: ReadableStream;
  contentType: string;
  size: number;
}

export interface PosterStore {
  put(key: string, full: Uint8Array, thumb: Uint8Array, contentType: string): Promise<void>;
  get(key: string, variant: PosterVariant): Promise<PosterFile | null>;
  /** Deletes both files; missing ones are ignored. */
  delete(key: string): Promise<void>;
}

const objectKey = (key: string, variant: PosterVariant) =>
  variant === 'thumb' ? `${key}/thumb` : key;

export function r2PosterStore(bucket: R2Bucket): PosterStore {
  return {
    async put(key, full, thumb, contentType) {
      const httpMetadata = { contentType };
      await Promise.all([
        bucket.put(objectKey(key, 'full'), full, { httpMetadata }),
        bucket.put(objectKey(key, 'thumb'), thumb, { httpMetadata }),
      ]);
    },
    async get(key, variant) {
      const obj = await bucket.get(objectKey(key, variant));
      if (!obj) return null;
      return {
        body: obj.body,
        contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream',
        size: obj.size,
      };
    },
    async delete(key) {
      await bucket.delete([objectKey(key, 'full'), objectKey(key, 'thumb')]);
    },
  };
}

/**
 * Images resized in the browser (SPEC §4.7): drawing on a canvas and encoding
 * again keeps only the pixels, so the photo's metadata (EXIF, GPS) never
 * leaves the device. createImageBitmap applies the EXIF orientation first.
 */
import { LIMITS } from '../../config/app';

async function draw(file: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  // White under transparent areas: JPEG has no alpha (it would turn black).
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export interface Encoded {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * WebP (JPEG where the browser cannot encode WebP), longest side ≤ maxSide,
 * at most maxBytes: lowers the quality, then the size, until it fits.
 */
export async function encodeImage(
  file: Blob,
  maxSide: number,
  maxBytes: number,
  type?: 'image/webp' | 'image/jpeg',
): Promise<Encoded> {
  let side = maxSide;
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = await draw(file, side);
    for (const quality of [0.85, 0.75, 0.65, 0.5]) {
      let blob = await toBlob(canvas, type ?? 'image/webp', quality);
      // Safari answers PNG when asked for WebP.
      if (blob && blob.type !== (type ?? 'image/webp')) {
        blob = await toBlob(canvas, 'image/jpeg', quality);
      }
      if (blob && blob.size <= maxBytes) {
        return { blob, width: canvas.width, height: canvas.height };
      }
    }
    side = Math.round(side * 0.8);
  }
  throw new Error('too_large');
}

export interface PreparedPoster {
  image: Blob;
  thumb: Blob;
  width: number;
  height: number;
  /** blob: URL for the preview; revoke it when done. */
  preview: string;
}

/** The poster and its thumbnail, ready for PUT …/poster. */
export async function preparePoster(file: Blob): Promise<PreparedPoster> {
  const full = await encodeImage(file, LIMITS.posterMaxSide, LIMITS.posterMaxBytes - 20_000);
  // Same type as the poster (the server wants both alike).
  const type = full.blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  const thumb = await encodeImage(
    full.blob,
    LIMITS.posterThumbMaxSide,
    LIMITS.posterThumbMaxBytes - 5_000,
    type,
  );
  return {
    image: full.blob,
    thumb: thumb.blob,
    width: full.width,
    height: full.height,
    preview: URL.createObjectURL(full.blob),
  };
}

/** Base64 JPEG for the admin import (Claude reads JPEG well; ≤ 1568 px costs less). */
export async function toBase64Jpeg(
  file: Blob,
  maxSide: number,
): Promise<{ mediaType: 'image/jpeg'; data: string; preview: string }> {
  const canvas = await draw(file, maxSide);
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return { mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1), preview: url };
}

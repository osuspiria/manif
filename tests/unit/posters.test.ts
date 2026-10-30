import { describe, expect, it } from 'vitest';
import { checkPoster, sniffImage } from '../../src/server/services/image-check';
import { jpeg, padded, png, webpExtended, webpLossless, webpLossy } from '../image-fixtures';

describe('sniffImage', () => {
  it('reads PNG, JPEG and WebP dimensions from the bytes', () => {
    expect(sniffImage(png(1200, 630))).toEqual({
      type: 'image/png',
      width: 1200,
      height: 630,
      exif: false,
    });
    expect(sniffImage(jpeg(1131, 1600))).toMatchObject({
      type: 'image/jpeg',
      width: 1131,
      height: 1600,
    });
    expect(sniffImage(webpLossy(800, 1000))).toMatchObject({
      type: 'image/webp',
      width: 800,
      height: 1000,
    });
    expect(sniffImage(webpLossless(321, 4097))).toMatchObject({ width: 321, height: 4097 });
    expect(sniffImage(webpExtended(1600, 900))).toMatchObject({ width: 1600, height: 900 });
  });

  it('detects EXIF in each format', () => {
    expect(sniffImage(png(10, 10, { exif: true }))?.exif).toBe(true);
    expect(sniffImage(jpeg(10, 10, { exif: true }))?.exif).toBe(true);
    expect(sniffImage(webpExtended(10, 10, { exif: true }))?.exif).toBe(true);
    expect(sniffImage(jpeg(10, 10))?.exif).toBe(false);
    expect(sniffImage(webpExtended(10, 10))?.exif).toBe(false);
  });

  it('rejects other files, truncated headers and zero sizes', () => {
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(
      null,
    );
    expect(sniffImage(new TextEncoder().encode('GIF89a'))).toBe(null);
    expect(sniffImage(new Uint8Array())).toBe(null);
    expect(sniffImage(jpeg(100, 100).subarray(0, 12))).toBe(null);
    expect(sniffImage(png(0, 10))).toBe(null);
  });
});

describe('checkPoster', () => {
  const ok = { image: webpLossy(1131, 1600), thumb: webpLossy(226, 320), alt: null };

  it('accepts a poster and its thumbnail of the same type', () => {
    expect(checkPoster(ok)).toMatchObject({ type: 'image/webp', width: 1131, height: 1600 });
  });

  it('rejects oversized files and dimensions', () => {
    expect(checkPoster({ ...ok, image: padded(webpLossy(800, 800), 600_001) })).toBe(
      'image_too_large',
    );
    expect(checkPoster({ ...ok, image: webpLossy(1601, 900) })).toBe('image_too_large');
    expect(checkPoster({ ...ok, thumb: webpLossy(321, 200) })).toBe('image_too_large');
    expect(checkPoster({ ...ok, thumb: padded(webpLossy(200, 200), 60_001) })).toBe(
      'image_too_large',
    );
  });

  it('rejects EXIF, unknown types and mixed types', () => {
    expect(checkPoster({ ...ok, image: webpExtended(800, 800, { exif: true }) })).toBe(
      'exif_not_allowed',
    );
    expect(checkPoster({ ...ok, image: new TextEncoder().encode('não é uma imagem') })).toBe(
      'invalid_image',
    );
    expect(checkPoster({ ...ok, thumb: jpeg(200, 200) })).toBe('invalid_image');
  });
});

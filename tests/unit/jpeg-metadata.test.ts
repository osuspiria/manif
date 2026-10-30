import { describe, expect, it } from 'vitest';
import { stripJpegMetadata } from '../../src/components/forms/jpeg-metadata';
import { checkPoster, sniffImage } from '../../src/server/services/image-check';
import { jpeg, png } from '../image-fixtures';

describe('stripJpegMetadata', () => {
  it('drops the EXIF block that WebKit canvas output carries', () => {
    const withExif = jpeg(1170, 1457, { exif: true });
    expect(sniffImage(withExif)?.exif).toBe(true);
    const stripped = stripJpegMetadata(withExif);
    expect(sniffImage(stripped)).toEqual({
      type: 'image/jpeg',
      width: 1170,
      height: 1457,
      exif: false,
    });
    // Same bytes as a JPEG that never had EXIF: only the segment goes.
    expect(stripped).toEqual(jpeg(1170, 1457));
  });

  it('then passes the server check (poster and thumbnail)', () => {
    const upload = {
      image: stripJpegMetadata(jpeg(1170, 1457, { exif: true })),
      thumb: stripJpegMetadata(jpeg(257, 320, { exif: true })),
      alt: null,
    };
    expect(checkPoster(upload)).toMatchObject({ type: 'image/jpeg', exif: false });
  });

  it('returns other bytes unchanged', () => {
    const clean = jpeg(10, 10);
    expect(stripJpegMetadata(clean)).toBe(clean);
    const notJpeg = png(10, 10);
    expect(stripJpegMetadata(notJpeg)).toBe(notJpeg);
    const truncated = jpeg(10, 10, { exif: true }).subarray(0, 12);
    expect(stripJpegMetadata(truncated)).toBe(truncated);
  });
});

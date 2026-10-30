/**
 * Poster file checks (SPEC §4.7). The browser already resized the images and
 * dropped their metadata; here we only accept what we expect: the type read
 * from the bytes, size, dimensions, no EXIF. Pure functions.
 */
import { LIMITS } from '../../config/app';

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageInfo {
  type: ImageType;
  width: number;
  height: number;
  /** Carries EXIF metadata (which may include the GPS position of the photo). */
  exif: boolean;
}

const ascii = (b: Uint8Array, at: number, len: number) =>
  at + len <= b.length ? String.fromCharCode(...b.subarray(at, at + len)) : '';
const u16be = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u32be = (b: Uint8Array, at: number) => u16be(b, at) * 0x10000 + u16be(b, at + 2);
const u16le = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, at: number) => u16le(b, at) | ((b[at + 2] ?? 0) << 16);
const u32le = (b: Uint8Array, at: number) => u16le(b, at) + u16le(b, at + 2) * 0x10000;

function sniffPng(b: Uint8Array): ImageInfo | null {
  if (ascii(b, 12, 4) !== 'IHDR') return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  let exif = false;
  for (let at = 8; at + 8 <= b.length;) {
    const len = u32be(b, at);
    const type = ascii(b, at + 4, 4);
    if (type === 'eXIf') exif = true;
    if (type === 'IEND') break;
    at += 12 + len;
  }
  return { type: 'image/png', width, height, exif };
}

/** Start-of-frame markers (baseline, progressive, …); not DHT (C4), JPG (C8) or DAC (CC). */
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function sniffJpeg(b: Uint8Array): ImageInfo | null {
  let exif = false;
  let size: { width: number; height: number } | null = null;
  for (let at = 2; at + 4 <= b.length;) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2; // no length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan
    const len = u16be(b, at + 2);
    if (len < 2) return null;
    if (marker === 0xe1 && ascii(b, at + 4, 4) === 'Exif') exif = true;
    if (isSof(marker) && !size) size = { height: u16be(b, at + 5), width: u16be(b, at + 7) };
    at += 2 + len;
  }
  return size ? { type: 'image/jpeg', ...size, exif } : null;
}

function sniffWebp(b: Uint8Array): ImageInfo | null {
  let exif = false;
  let size: { width: number; height: number } | null = null;
  for (let at = 12; at + 8 <= b.length;) {
    const fourcc = ascii(b, at, 4);
    const len = u32le(b, at + 4);
    const data = at + 8;
    if (fourcc === 'EXIF') exif = true;
    if (fourcc === 'VP8X' && len >= 10) {
      if (((b[data] ?? 0) & 0x08) !== 0) exif = true;
      size = { width: u24le(b, data + 4) + 1, height: u24le(b, data + 7) + 1 };
    }
    if (fourcc === 'VP8 ' && !size && len >= 10) {
      if (b[data + 3] !== 0x9d || b[data + 4] !== 0x01 || b[data + 5] !== 0x2a) return null;
      size = { width: u16le(b, data + 6) & 0x3fff, height: u16le(b, data + 8) & 0x3fff };
    }
    if (fourcc === 'VP8L' && !size && len >= 5) {
      if (b[data] !== 0x2f) return null;
      const b1 = b[data + 1] ?? 0;
      const b2 = b[data + 2] ?? 0;
      const b3 = b[data + 3] ?? 0;
      const b4 = b[data + 4] ?? 0;
      size = {
        width: 1 + (b1 | ((b2 & 0x3f) << 8)),
        height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
      };
    }
    at = data + len + (len % 2); // chunks are padded to an even size
  }
  return size ? { type: 'image/webp', ...size, exif } : null;
}

/** Type, dimensions and EXIF presence read from the file's own bytes, or null if not an image we accept. */
export function sniffImage(b: Uint8Array): ImageInfo | null {
  let info: ImageInfo | null = null;
  if (u32be(b, 0) === 0x89504e47 && u32be(b, 4) === 0x0d0a1a0a) info = sniffPng(b);
  else if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) info = sniffJpeg(b);
  else if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') info = sniffWebp(b);
  return info && info.width > 0 && info.height > 0 ? info : null;
}

export interface PosterUpload {
  image: Uint8Array;
  thumb: Uint8Array;
  /** Already validated (PosterAltSchema). */
  alt: string | null;
}

type PosterError = 'invalid_image' | 'image_too_large' | 'exif_not_allowed';

function checkFile(b: Uint8Array, maxBytes: number, maxSide: number): ImageInfo | PosterError {
  if (b.length > maxBytes) return 'image_too_large';
  const info = sniffImage(b);
  if (!info) return 'invalid_image';
  if (info.exif) return 'exif_not_allowed';
  if (Math.max(info.width, info.height) > maxSide) return 'image_too_large';
  return info;
}

/** Checks both files: same type, within the limits, no EXIF. */
export function checkPoster(upload: PosterUpload): ImageInfo | PosterError {
  const image = checkFile(upload.image, LIMITS.posterMaxBytes, LIMITS.posterMaxSide);
  if (typeof image === 'string') return image;
  const thumb = checkFile(upload.thumb, LIMITS.posterThumbMaxBytes, LIMITS.posterThumbMaxSide);
  if (typeof thumb === 'string') return thumb;
  return thumb.type === image.type ? image : 'invalid_image';
}

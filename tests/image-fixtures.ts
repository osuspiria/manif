/**
 * Minimal image headers for the poster checks (src/server/services/posters.ts).
 * Not decodable images: only what sniffImage reads (signature, size, chunks).
 */
const bytes = (...parts: (number[] | Uint8Array | string)[]) => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...p);
  }
  return new Uint8Array(out);
};
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [...be16(Math.floor(n / 0x10000)), ...be16(n & 0xffff)];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n: number) => [...le16(n & 0xffff), (n >> 16) & 0xff];
const le32 = (n: number) => [...le16(n & 0xffff), ...le16(Math.floor(n / 0x10000))];

interface Opts {
  exif?: boolean;
}

function pngChunk(type: string, data: Uint8Array) {
  return bytes(be32(data.length), type, data, [0, 0, 0, 0]);
}

export function png(width: number, height: number, o: Opts = {}): Uint8Array<ArrayBuffer> {
  const ihdr = bytes(be32(width), be32(height), [8, 6, 0, 0, 0]);
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk('IHDR', ihdr),
    o.exif ? pngChunk('eXIf', bytes('MM', [0, 42, 0, 0, 0, 8])) : [],
    pngChunk('IDAT', bytes([0, 0, 0, 0])),
    pngChunk('IEND', new Uint8Array()),
  );
}

export function jpeg(width: number, height: number, o: Opts = {}): Uint8Array<ArrayBuffer> {
  const app1 = bytes('Exif', [0, 0], 'MM', [0, 42, 0, 0, 0, 8]);
  const app0 = bytes('JFIF', [0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = bytes([8], be16(height), be16(width), [1, 1, 0x11, 0]);
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe0],
    be16(app0.length + 2),
    app0,
    o.exif ? bytes([0xff, 0xe1], be16(app1.length + 2), app1) : [],
    [0xff, 0xc0],
    be16(sof.length + 2),
    sof,
    [0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0],
    [0x12, 0x34],
    [0xff, 0xd9],
  );
}

function riff(chunks: Uint8Array) {
  return bytes('RIFF', le32(chunks.length + 4), 'WEBP', chunks);
}

function webpChunk(fourcc: string, data: Uint8Array) {
  return bytes(fourcc, le32(data.length), data, data.length % 2 ? [0] : []);
}

export function webpLossy(width: number, height: number): Uint8Array<ArrayBuffer> {
  return riff(webpChunk('VP8 ', bytes([0, 0, 0, 0x9d, 0x01, 0x2a], le16(width), le16(height))));
}

export function webpLossless(width: number, height: number): Uint8Array<ArrayBuffer> {
  const w = width - 1;
  const h = height - 1;
  const data = bytes([
    0x2f,
    w & 0xff,
    ((w >> 8) & 0x3f) | ((h & 0x03) << 6),
    (h >> 2) & 0xff,
    (h >> 10) & 0x0f,
  ]);
  return riff(webpChunk('VP8L', data));
}

export function webpExtended(width: number, height: number, o: Opts = {}): Uint8Array<ArrayBuffer> {
  const vp8x = bytes([o.exif ? 0x08 : 0, 0, 0, 0], le24(width - 1), le24(height - 1));
  return riff(
    bytes(
      webpChunk('VP8X', vp8x),
      webpChunk('VP8 ', bytes([0, 0, 0, 0x9d, 0x01, 0x2a], le16(width), le16(height))),
      o.exif ? webpChunk('EXIF', bytes('MM', [0, 42, 0, 0, 0, 8])) : new Uint8Array(),
    ),
  );
}

/** `img` padded with zeros up to `size` bytes (to test size limits). */
export function padded(img: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  out.set(img);
  return out;
}

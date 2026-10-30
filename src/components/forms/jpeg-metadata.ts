/**
 * Drops the APP1 (EXIF, XMP) and COM segments of a JPEG. Canvas output in
 * WebKit (every browser on iPhone) carries a small EXIF block, which the
 * server rejects (SPEC §4.7). Pure: bytes in, bytes out; anything that does
 * not parse as JPEG comes back unchanged.
 */
export function stripJpegMetadata(b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (b[0] !== 0xff || b[1] !== 0xd8) return b;
  const keep: Uint8Array<ArrayBuffer>[] = [b.subarray(0, 2)];
  let dropped = false;
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return b;
    const marker = b[at + 1] ?? 0;
    // Start of scan (or end of image): the rest is image data, kept as it is.
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) return b;
    const end = at + 2 + (((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0));
    if (end > b.length || end < at + 4) return b;
    if (marker === 0xe1 || marker === 0xfe) dropped = true;
    else keep.push(b.subarray(at, end));
    at = end;
  }
  if (!dropped) return b;
  keep.push(b.subarray(at));
  const out = new Uint8Array(keep.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of keep) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

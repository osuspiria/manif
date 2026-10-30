/** Poster uploads (multipart) and downloads, shared by the owner, admin and public routes. */
import { LIMITS } from '../../config/app';
import { PosterAltSchema } from '../../shared/schemas';
import type { PosterStore, PosterVariant } from '../repos/poster-store';
import type { PosterUpload } from '../services/posters';

/** Room for the multipart boundaries and the alt text. */
const MAX_BODY = LIMITS.posterMaxBytes + LIMITS.posterThumbMaxBytes + 16_000;

/** Reads `image`, `thumb` and `alt` from a multipart body; the bytes are checked by setPoster. */
export async function readPosterUpload(
  req: Request,
): Promise<{ ok: true; upload: PosterUpload } | { ok: false; error: string }> {
  const length = Number(req.headers.get('Content-Length') ?? 0);
  if (length > MAX_BODY) return { ok: false, error: 'image_too_large' };
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { ok: false, error: 'invalid_image' };
  }
  const image = form.get('image');
  const thumb = form.get('thumb');
  if (!(image instanceof File) || !(thumb instanceof File)) {
    return { ok: false, error: 'invalid_image' };
  }
  const alt = PosterAltSchema.safeParse(form.get('alt') ?? null);
  if (!alt.success) return { ok: false, error: 'alt_too_long' };
  return {
    ok: true,
    upload: {
      image: new Uint8Array(await image.arrayBuffer()),
      thumb: new Uint8Array(await thumb.arrayBuffer()),
      alt: alt.data,
    },
  };
}

/** The poster file as a response, or null when it is missing from the store. */
export async function posterResponse(
  store: PosterStore,
  key: string,
  variant: PosterVariant,
  cacheControl: string,
): Promise<Response | null> {
  const file = await store.get(key, variant);
  if (!file) return null;
  return new Response(file.body, {
    headers: {
      'Content-Type': file.contentType,
      'Content-Length': String(file.size),
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

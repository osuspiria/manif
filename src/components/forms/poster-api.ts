/** Poster upload (PUT …/poster, multipart), shared by the add flow, the edit page and the admin. */
import type { PreparedPoster } from './image';

export interface PosterDraft {
  prepared: PreparedPoster;
  alt: string;
}

export function posterFormData(p: PosterDraft): FormData {
  const ext = p.prepared.image.type === 'image/webp' ? 'webp' : 'jpg';
  const body = new FormData();
  body.set('image', p.prepared.image, `cartaz.${ext}`);
  body.set('thumb', p.prepared.thumb, `miniatura.${ext}`);
  body.set('alt', p.alt.trim());
  return body;
}

/** Owner upload with the edit token. Resolves to null on success, else an error code. */
export async function uploadOwnerPoster(
  eventId: string,
  token: string,
  p: PosterDraft,
): Promise<string | null> {
  try {
    const res = await fetch(`/api/events/${eventId}/poster`, {
      method: 'PUT',
      headers: { 'X-Edit-Token': token },
      body: posterFormData(p),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? 'generic';
  } catch {
    return 'network';
  }
}

export async function removeOwnerPoster(eventId: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/events/${eventId}/poster`, {
      method: 'DELETE',
      headers: { 'X-Edit-Token': token },
    });
    return res.ok;
  } catch {
    return false;
  }
}

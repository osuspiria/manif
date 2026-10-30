/**
 * Event posters (SPEC §4.7): stores checked uploads (see image-check.ts) and
 * removes them. Knows nothing about Hono, D1 or R2 (receives a repo and a store).
 */
import { nowIso } from '../../shared/dates';
import type { EventsWriteRepo, PosterStatus } from '../repos/events-repo';
import type { PosterStore } from '../repos/poster-store';
import type { ServiceResult } from './event-submission';
import { checkPoster, type PosterUpload } from './image-check';

export type { PosterUpload };

// --- upload ----------------------------------------------------------------------

export interface PosterDeps {
  write: EventsWriteRepo;
  store: PosterStore;
  newId: () => string;
  now: Date;
}

const fail = (status: 400 | 404, error: string) => ({ ok: false, status, error }) as const;

/**
 * Stores a new poster for an existing event, replacing any previous one. Owner
 * uploads wait for moderation; the moderation's are approved at once.
 * Order: new files, then the row, then the old files — a failure leaves at
 * worst an orphan file, never a row pointing at nothing.
 */
export async function setPoster(
  eventId: string,
  previousKey: string | null,
  upload: PosterUpload,
  opts: { approved: boolean },
  d: PosterDeps,
): Promise<ServiceResult<{ status: PosterStatus }>> {
  const info = checkPoster(upload);
  if (typeof info === 'string') return fail(400, info);
  const key = `${eventId}/${d.newId()}`;
  const status: PosterStatus = opts.approved ? 'approved' : 'pending';
  await d.store.put(key, upload.image, upload.thumb, info.type);
  await d.write.setPoster(
    eventId,
    { key, status, width: info.width, height: info.height, alt: upload.alt },
    nowIso(d.now),
  );
  if (previousKey) await d.store.delete(previousKey);
  return { ok: true, value: { status } };
}

/** Removes the poster (no-op without one). */
export async function removePoster(
  eventId: string,
  key: string | null,
  d: Pick<PosterDeps, 'write' | 'store' | 'now'>,
): Promise<void> {
  if (!key) return;
  await d.write.setPoster(eventId, null, nowIso(d.now));
  await d.store.delete(key);
}

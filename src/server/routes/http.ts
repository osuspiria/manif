/** Small helpers shared by the API routes. */
import type { Context } from 'hono';
import type { ApiIssue } from '../../shared/schemas';
import type { Env } from '../env';

export type C = Context<{ Bindings: Env }>;

export function zodIssues(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): ApiIssue[] {
  return error.issues.map((i) => ({
    path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
    code: i.message,
  }));
}

export async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

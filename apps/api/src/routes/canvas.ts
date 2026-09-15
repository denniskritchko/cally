import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { CanvasClient, bearerFetch } from '@cally/core';
import { db, schema } from '../db/client.js';
import { env } from '../env.js';
import { encrypt } from '../crypto.js';
import { requireUser } from '../auth/session.js';
import { enqueueUserSync } from '../sync/jobs.js';

export const canvasRoutes = new Hono();
canvasRoutes.use('*', requireUser);

const tokenBody = z.object({ token: z.string().min(20).max(500) });
const feedBody = z.object({ feedUrl: z.string().url().max(1000) });

function assertCanvasHost(url: string) {
  const allowed = new URL(env.CANVAS_BASE_URL).host;
  if (new URL(url).host !== allowed) throw new Error(`Only ${allowed} is supported`);
}

/** Connect with a personal access token (Account → Settings → New Access Token). */
canvasRoutes.post('/token', async (c) => {
  const parsed = tokenBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'token required' }, 400);
  const client = new CanvasClient({ baseUrl: env.CANVAS_BASE_URL, fetch: bearerFetch(parsed.data.token) });
  let name: string;
  try {
    name = (await client.self()).name;
  } catch (e) {
    return c.json({ error: `Canvas rejected the token: ${e instanceof Error ? e.message : e}` }, 400);
  }
  await upsertConnection(c.get('user').id, { kind: 'token', tokenEnc: encrypt(parsed.data.token), feedUrlEnc: null, canvasUserName: name });
  await enqueueUserSync(c.get('user').id);
  return c.json({ ok: true, canvasUserName: name });
});

/** Connect with the ICS "Calendar Feed" URL from the Canvas calendar page. */
canvasRoutes.post('/feed', async (c) => {
  const parsed = feedBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'feedUrl required' }, 400);
  const url = parsed.data.feedUrl.replace(/^webcal:/i, 'https:');
  try {
    assertCanvasHost(url);
    const res = await fetch(url, { headers: { Accept: 'text/calendar' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const head = (await res.text()).slice(0, 200);
    if (!head.includes('BEGIN:VCALENDAR')) throw new Error('not an ICS feed');
  } catch (e) {
    return c.json({ error: `Could not read that feed: ${e instanceof Error ? e.message : e}` }, 400);
  }
  await upsertConnection(c.get('user').id, { kind: 'feed', tokenEnc: null, feedUrlEnc: encrypt(url), canvasUserName: null });
  await enqueueUserSync(c.get('user').id);
  return c.json({ ok: true });
});

canvasRoutes.delete('/', async (c) => {
  await db.delete(schema.canvasConnections).where(eq(schema.canvasConnections.userId, c.get('user').id));
  return c.json({ ok: true });
});

export async function upsertConnection(
  userId: string,
  values: Pick<typeof schema.canvasConnections.$inferInsert, 'kind' | 'tokenEnc' | 'feedUrlEnc' | 'canvasUserName'>,
) {
  await db
    .insert(schema.canvasConnections)
    .values({ userId, baseUrl: env.CANVAS_BASE_URL, ...values, lastError: null })
    .onConflictDoUpdate({ target: schema.canvasConnections.userId, set: { ...values, baseUrl: env.CANVAS_BASE_URL, lastError: null } });
}

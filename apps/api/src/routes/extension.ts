import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gt } from 'drizzle-orm';
import { normalizePlannerItems, type CanvasPlannerItem } from '@cally/core';
import { db, schema } from '../db/client.js';
import { env } from '../env.js';
import { pairingCode, randomToken, sha256 } from '../crypto.js';
import { requireUser } from '../auth/session.js';
import { applySnapshot } from '../sync/snapshot.js';
import { enqueueUserSync } from '../sync/jobs.js';
import { upsertConnection } from './canvas.js';

export const extensionRoutes = new Hono();

/* ---------- browser-session side (dashboard) ---------- */

/** Mint a short-lived pairing code the user types into the extension popup. */
extensionRoutes.post('/pair/start', requireUser, async (c) => {
  const code = pairingCode();
  await db.insert(schema.extensionPairings).values({ code, userId: c.get('user').id, expiresAt: new Date(Date.now() + 10 * 60_000) });
  return c.json({ code, expiresInSeconds: 600 });
});

extensionRoutes.delete('/devices/:id', requireUser, async (c) => {
  await db
    .delete(schema.extensionDevices)
    .where(and(eq(schema.extensionDevices.id, c.req.param('id')), eq(schema.extensionDevices.userId, c.get('user').id)));
  return c.json({ ok: true });
});

/* ---------- extension side (device token) ---------- */

const pairBody = z.object({ code: z.string().min(6).max(8), label: z.string().max(100).optional() });

/** Exchange a pairing code for a long-lived device token. One shot. */
extensionRoutes.post('/pair/complete', async (c) => {
  const parsed = pairBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'code required' }, 400);
  const code = parsed.data.code.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{3})(.{3})$/, '$1-$2');

  const [pairing] = await db
    .delete(schema.extensionPairings)
    .where(and(eq(schema.extensionPairings.code, code), gt(schema.extensionPairings.expiresAt, new Date())))
    .returning();
  if (!pairing) return c.json({ error: 'Invalid or expired code' }, 400);

  const token = randomToken(32);
  const id = randomToken(8);
  await db.insert(schema.extensionDevices).values({ id, userId: pairing.userId, tokenHash: sha256(token), label: parsed.data.label ?? null, lastSeenAt: new Date() });
  const [user] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, pairing.userId));
  return c.json({ deviceToken: token, deviceId: id, email: user?.email, canvasBaseUrl: env.CANVAS_BASE_URL });
});

async function deviceFromBearer(c: { req: { header: (n: string) => string | undefined } }) {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const [device] = await db.select().from(schema.extensionDevices).where(eq(schema.extensionDevices.tokenHash, sha256(token)));
  return device ?? null;
}

extensionRoutes.get('/status', async (c) => {
  const device = await deviceFromBearer(c);
  if (!device) return c.json({ error: 'unauthenticated' }, 401);
  await db.update(schema.extensionDevices).set({ lastSeenAt: new Date() }).where(eq(schema.extensionDevices.id, device.id));
  const [user] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, device.userId));
  return c.json({ ok: true, email: user?.email, lastPushAt: device.lastPushAt, lastPushCount: device.lastPushCount, canvasBaseUrl: env.CANVAS_BASE_URL });
});

const ingestBody = z.object({
  baseUrl: z.string().url(),
  window: z.object({ start: z.string().datetime(), end: z.string().datetime() }),
  items: z.array(z.record(z.unknown())).max(5000),
  canvasUserName: z.string().max(200).optional(),
});

/**
 * The extension pulled the planner with the user's Canvas session and hands us
 * the raw items. We normalize server-side so fixes ship without an extension update.
 */
extensionRoutes.post('/ingest', async (c) => {
  const device = await deviceFromBearer(c);
  if (!device) return c.json({ error: 'unauthenticated' }, 401);
  const parsed = ingestBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad payload', issues: parsed.error.issues.slice(0, 3) }, 400);
  const { baseUrl, window, items, canvasUserName } = parsed.data;
  if (new URL(baseUrl).host !== new URL(env.CANVAS_BASE_URL).host) return c.json({ error: `Only ${env.CANVAS_BASE_URL} is supported` }, 400);

  const base = baseUrl.replace(/\/+$/, '');
  const events = normalizePlannerItems(items as unknown as CanvasPlannerItem[], {
    host: new URL(base).host,
    absoluteUrl: (p) => (!p ? undefined : /^https?:/i.test(p) ? p : `${base}${p.startsWith('/') ? '' : '/'}${p}`),
  });

  const applied = await applySnapshot(device.userId, events, window);
  await upsertConnection(device.userId, { kind: 'extension', tokenEnc: null, feedUrlEnc: null, canvasUserName: canvasUserName ?? null });
  await db.update(schema.canvasConnections).set({ lastSyncedAt: new Date() }).where(eq(schema.canvasConnections.userId, device.userId));
  await db
    .update(schema.extensionDevices)
    .set({ lastSeenAt: new Date(), lastPushAt: new Date(), lastPushCount: events.length })
    .where(eq(schema.extensionDevices.id, device.id));
  await db.insert(schema.syncRuns).values({ id: randomToken(12), userId: device.userId, stage: 'pull', ok: true, detail: { via: 'extension', ...applied }, startedAt: new Date(), finishedAt: new Date() });

  // Fan out to Google without waiting.
  await enqueueUserSync(device.userId);
  return c.json({ ok: true, ...applied });
});

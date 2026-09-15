import { and, eq, isNull, sql as dsql } from 'drizzle-orm';
import {
  CanvasApiSource,
  CanvasClient,
  CanvasFeedSource,
  GoogleCalendarClient,
  GoogleCalendarSink,
  GoogleHttpError,
  bearerFetch,
  defaultWindow,
} from '@cally/core';
import { db, schema } from '../db/client.js';
import { decrypt, randomToken } from '../crypto.js';
import { GoogleAuthError, refreshAccessToken } from '../auth/google.js';
import { applySnapshot, purgeTombstones, rowToEvent } from './snapshot.js';

const log = (userId: string, msg: string, extra?: unknown) =>
  console.log(`[sync ${userId.slice(0, 8)}] ${msg}`, extra !== undefined ? JSON.stringify(extra) : '');

async function recordRun(userId: string, stage: 'pull' | 'push', startedAt: Date, ok: boolean, detail: unknown) {
  await db.insert(schema.syncRuns).values({ id: randomToken(12), userId, stage, ok, detail, startedAt, finishedAt: new Date() });
  // Keep the table bounded: last 50 runs per user.
  await db.execute(dsql`
    delete from sync_runs where user_id = ${userId} and id not in (
      select id from sync_runs where user_id = ${userId} order by started_at desc limit 50
    )`);
}

/** Stage 1: Canvas -> events table. No-op for extension-fed users (they push). */
export async function pullForUser(userId: string): Promise<void> {
  const [conn] = await db.select().from(schema.canvasConnections).where(eq(schema.canvasConnections.userId, userId));
  if (!conn || conn.kind === 'extension') return;

  const startedAt = new Date();
  try {
    const source =
      conn.kind === 'token'
        ? new CanvasApiSource(new CanvasClient({ baseUrl: conn.baseUrl, fetch: bearerFetch(decrypt(conn.tokenEnc!)) }))
        : new CanvasFeedSource(decrypt(conn.feedUrlEnc!));
    const result = await source.pull(defaultWindow());
    const applied = await applySnapshot(userId, result.events, result.window);
    await db
      .update(schema.canvasConnections)
      .set({ lastSyncedAt: new Date(), lastError: null })
      .where(eq(schema.canvasConnections.userId, userId));
    await recordRun(userId, 'pull', startedAt, true, applied);
    log(userId, `pull ok via ${conn.kind}`, applied);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(schema.canvasConnections).set({ lastError: message }).where(eq(schema.canvasConnections.userId, userId));
    await recordRun(userId, 'pull', startedAt, false, { error: message });
    log(userId, `pull failed: ${message}`);
  }
}

/** Stage 2: events table -> Google Calendar (diffed against sink_state). */
export async function pushGoogleForUser(userId: string): Promise<void> {
  const [conn] = await db.select().from(schema.googleConnections).where(eq(schema.googleConnections.userId, userId));
  if (!conn) return;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return;

  const startedAt = new Date();
  const refreshToken = decrypt(conn.refreshTokenEnc);
  let cached: { token: string; exp: number } | null = null;
  const tokenProvider = async () => {
    if (cached && cached.exp > Date.now() + 60_000) return cached.token;
    const t = await refreshAccessToken(refreshToken);
    cached = { token: t.access_token, exp: Date.now() + t.expires_in * 1000 };
    return cached.token;
  };
  const client = new GoogleCalendarClient(tokenProvider);

  try {
    const [rows, states] = await Promise.all([
      db.select().from(schema.events).where(eq(schema.events.userId, userId)),
      db.select().from(schema.sinkState).where(and(eq(schema.sinkState.userId, userId), eq(schema.sinkState.sink, 'google'))),
    ]);
    const stateByUid = new Map(states.map((s) => [s.uid, s]));

    let toUpsert = rows.filter((r) => !r.deletedAt && stateByUid.get(r.uid)?.syncedHash !== r.contentHash);
    let toRemove = rows.filter((r) => r.deletedAt && stateByUid.has(r.uid));

    // Nothing to say and nothing to set up: don't even refresh the token.
    if (conn.calendarId && !conn.lastError && toUpsert.length === 0 && toRemove.length === 0) return;

    // Ensure our calendar exists (user may have deleted it).
    let calendarId = conn.calendarId;
    if (!calendarId || !(await client.calendarExists(calendarId))) {
      calendarId = await client.createCalendar('Canvas (SFU)', user.timezone);
      await db.update(schema.googleConnections).set({ calendarId }).where(eq(schema.googleConnections.userId, userId));
      // New calendar = nothing has been pushed to it. Forget prior state and push everything live.
      await db.delete(schema.sinkState).where(and(eq(schema.sinkState.userId, userId), eq(schema.sinkState.sink, 'google')));
      stateByUid.clear();
      toUpsert = rows.filter((r) => !r.deletedAt);
      toRemove = [];
      log(userId, `created google calendar ${calendarId}`);
    }

    const outcome = { created: 0, updated: 0, removed: 0, errors: 0 };
    const rowByUid = new Map(rows.map((r) => [r.uid, r]));
    const sink = new GoogleCalendarSink(client, {
      calendarId,
      timeZone: user.timezone,
      // Persist per event, so a partial run doesn't redo finished work.
      onResult: async (uid, result, err) => {
        if (result === 'created' || result === 'updated') {
          const r = rowByUid.get(uid)!;
          await db
            .insert(schema.sinkState)
            .values({ userId, sink: 'google', uid, externalId: r.externalId, syncedHash: r.contentHash, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: [schema.sinkState.userId, schema.sinkState.sink, schema.sinkState.uid],
              set: { syncedHash: r.contentHash, updatedAt: new Date() },
            });
          outcome[result]++;
        } else if (result === 'removed') {
          await db.delete(schema.sinkState).where(and(eq(schema.sinkState.userId, userId), eq(schema.sinkState.sink, 'google'), eq(schema.sinkState.uid, uid)));
          outcome.removed++;
        } else {
          outcome.errors++;
          log(userId, `google error for ${uid}: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });

    await sink.upsert(toUpsert.map(rowToEvent));
    await sink.remove(toRemove.map((r) => r.uid));

    await db.update(schema.googleConnections).set({ lastSyncedAt: new Date(), lastError: null }).where(eq(schema.googleConnections.userId, userId));
    await recordRun(userId, 'push', startedAt, outcome.errors === 0, outcome);
    log(userId, 'push ok', outcome);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const revoked = (err instanceof GoogleAuthError && err.revoked) || (err instanceof GoogleHttpError && err.status === 401);
    await db
      .update(schema.googleConnections)
      .set({ lastError: revoked ? 'Google access was revoked. Reconnect Google Calendar.' : message })
      .where(eq(schema.googleConnections.userId, userId));
    await recordRun(userId, 'push', startedAt, false, { error: message });
    log(userId, `push failed: ${message}`);
  }
}

export async function syncUser(userId: string): Promise<void> {
  await pullForUser(userId);
  await pushGoogleForUser(userId);
  const purged = await purgeTombstones(userId);
  if (purged) log(userId, `purged ${purged} tombstones`);
}

/** Users with anything to do on a scheduled tick. */
export async function usersNeedingSync(): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(dsql`
    select u.id from users u
    where exists (select 1 from canvas_connections c where c.user_id = u.id and c.kind <> 'extension')
       or exists (select 1 from google_connections g where g.user_id = u.id)`);
  return rows.map((r) => r.id);
}

export { isNull };

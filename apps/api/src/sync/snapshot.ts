import { and, eq, gte, inArray, isNull, lte, notInArray, sql as dsql } from 'drizzle-orm';
import type { NormalizedEvent, SyncWindow } from '@cally/core';
import { db, schema } from '../db/client.js';
import { sha256 } from '../crypto.js';

/** Everything a sink cares about. Changing any of these re-pushes the event. */
export function contentHash(ev: NormalizedEvent): string {
  return sha256(
    JSON.stringify([ev.title, ev.description ?? '', ev.url ?? '', ev.start, ev.end ?? '', ev.allDay, ev.completed ?? false, ev.kind]),
  );
}

export interface SnapshotResult {
  received: number;
  upserted: number;
  tombstoned: number;
}

/**
 * Apply an authoritative snapshot for `window`: upsert what's in it, tombstone
 * anything we previously had inside the window that's now missing. Events
 * outside the window are untouched (history stays).
 */
export async function applySnapshot(userId: string, incoming: NormalizedEvent[], window: SyncWindow): Promise<SnapshotResult> {
  const now = new Date();
  const rows = incoming.map((ev) => ({
    uid: ev.uid,
    userId,
    source: ev.source,
    externalId: ev.externalId,
    kind: ev.kind,
    title: ev.title,
    description: ev.description ?? null,
    courseId: ev.courseId ?? null,
    courseName: ev.courseName ?? null,
    url: ev.url ?? null,
    startAt: new Date(ev.start),
    endAt: ev.end ? new Date(ev.end) : null,
    allDay: ev.allDay,
    completed: ev.completed ?? false,
    upstreamUpdatedAt: ev.updatedAt ? new Date(ev.updatedAt) : null,
    contentHash: contentHash(ev),
    deletedAt: null,
    updatedAt: now,
  }));

  return db.transaction(async (tx) => {
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const res = await tx
        .insert(schema.events)
        .values(chunk)
        .onConflictDoUpdate({
          target: [schema.events.userId, schema.events.uid],
          set: {
            kind: dsql`excluded.kind`,
            title: dsql`excluded.title`,
            description: dsql`excluded.description`,
            courseId: dsql`excluded.course_id`,
            courseName: dsql`excluded.course_name`,
            url: dsql`excluded.url`,
            startAt: dsql`excluded.start_at`,
            endAt: dsql`excluded.end_at`,
            allDay: dsql`excluded.all_day`,
            completed: dsql`excluded.completed`,
            upstreamUpdatedAt: dsql`excluded.upstream_updated_at`,
            contentHash: dsql`excluded.content_hash`,
            deletedAt: null,
            updatedAt: now,
          },
          // Only touch rows that actually changed, so updated_at stays meaningful.
          setWhere: dsql`${schema.events.contentHash} is distinct from excluded.content_hash or ${schema.events.deletedAt} is not null`,
        })
        .returning({ uid: schema.events.uid });
      upserted += res.length;
    }

    const keep = rows.map((r) => r.uid);
    const tombstoneWhere = and(
      eq(schema.events.userId, userId),
      isNull(schema.events.deletedAt),
      gte(schema.events.startAt, new Date(window.start)),
      lte(schema.events.startAt, new Date(window.end)),
      keep.length ? notInArray(schema.events.uid, keep) : undefined,
    );
    const tomb = await tx.update(schema.events).set({ deletedAt: now, updatedAt: now }).where(tombstoneWhere).returning({ uid: schema.events.uid });

    return { received: incoming.length, upserted, tombstoned: tomb.length };
  });
}

/** Drop tombstones no sink still needs to hear about. */
export async function purgeTombstones(userId: string): Promise<number> {
  const referenced = db
    .select({ uid: schema.sinkState.uid })
    .from(schema.sinkState)
    .where(eq(schema.sinkState.userId, userId));
  const res = await db
    .delete(schema.events)
    .where(and(eq(schema.events.userId, userId), dsql`${schema.events.deletedAt} is not null`, notInArray(schema.events.uid, referenced)))
    .returning({ uid: schema.events.uid });
  return res.length;
}

export function rowToEvent(r: typeof schema.events.$inferSelect): NormalizedEvent {
  return {
    uid: r.uid,
    source: r.source as NormalizedEvent['source'],
    externalId: r.externalId,
    kind: r.kind as NormalizedEvent['kind'],
    title: r.title,
    description: r.description ?? undefined,
    courseId: r.courseId ?? undefined,
    courseName: r.courseName ?? undefined,
    url: r.url ?? undefined,
    start: r.startAt.toISOString(),
    end: r.endAt?.toISOString(),
    allDay: r.allDay,
    completed: r.completed,
    updatedAt: r.upstreamUpdatedAt?.toISOString(),
  };
}

export async function liveEvents(userId: string) {
  return db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.userId, userId), isNull(schema.events.deletedAt)))
    .orderBy(schema.events.startAt);
}

export async function eventsByUids(userId: string, uids: string[]) {
  if (!uids.length) return [];
  return db.select().from(schema.events).where(and(eq(schema.events.userId, userId), inArray(schema.events.uid, uids)));
}

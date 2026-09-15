import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  googleSub: text('google_sub').notNull().unique(),
  name: text('name'),
  /** Opaque secret in the webcal URL. Rotatable. */
  feedToken: text('feed_token').notNull().unique(),
  timezone: text('timezone').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** How the user's Canvas data reaches us. One per user; replacing it re-syncs. */
export const canvasConnections = pgTable('canvas_connections', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['extension', 'token', 'feed'] }).notNull(),
  baseUrl: text('base_url').notNull(),
  /** Encrypted personal access token (kind=token). */
  tokenEnc: text('token_enc'),
  /** ICS feed URL (kind=feed). Treated as a secret: it grants read access to the calendar. */
  feedUrlEnc: text('feed_url_enc'),
  canvasUserName: text('canvas_user_name'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const googleConnections = pgTable('google_connections', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  /** Google calendar we own. Created lazily on first push. */
  calendarId: text('calendar_id'),
  scopes: text('scopes').notNull(),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Materialized, normalized snapshot of upstream. The feed and every sink read from here. */
export const events = pgTable(
  'events',
  {
    uid: text('uid').notNull(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    courseId: text('course_id'),
    courseName: text('course_name'),
    url: text('url'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }),
    allDay: boolean('all_day').notNull().default(false),
    completed: boolean('completed').notNull().default(false),
    upstreamUpdatedAt: timestamp('upstream_updated_at', { withTimezone: true }),
    /** Hash of the normalized payload; sinks use it to skip unchanged events. */
    contentHash: text('content_hash').notNull(),
    /** Tombstone. Kept so sinks can propagate the delete, then purged. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.uid] }),
    byStart: index('events_user_start_idx').on(t.userId, t.startAt),
  }),
);

/** What each sink last saw for each event. */
export const sinkState = pgTable(
  'sink_state',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    sink: text('sink').notNull(),
    uid: text('uid').notNull(),
    externalId: text('external_id').notNull(),
    syncedHash: text('synced_hash').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.sink, t.uid] }) }),
);

export const extensionPairings = pgTable('extension_pairings', {
  code: text('code').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const extensionDevices = pgTable(
  'extension_devices',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    label: text('label'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastPushAt: timestamp('last_push_at', { withTimezone: true }),
    lastPushCount: integer('last_push_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byToken: uniqueIndex('extension_devices_token_idx').on(t.tokenHash) }),
);

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    stage: text('stage', { enum: ['pull', 'push'] }).notNull(),
    ok: boolean('ok').notNull(),
    detail: jsonb('detail'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  },
  (t) => ({ byUser: index('sync_runs_user_idx').on(t.userId, t.startedAt) }),
);

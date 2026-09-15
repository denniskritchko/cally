import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { generateIcs } from '@cally/core';
import { db, schema } from '../db/client.js';
import { sha256 } from '../crypto.js';
import { liveEvents, rowToEvent } from '../sync/snapshot.js';

export const feedRoutes = new Hono();

/**
 * The merged calendar. Subscribe to this from Apple Calendar, Google Calendar,
 * Notion Calendar, Outlook — anything that speaks webcal.
 */
feedRoutes.get('/:token{.+\\.ics}', async (c) => {
  const token = c.req.param('token').replace(/\.ics$/, '');
  const [user] = await db.select().from(schema.users).where(eq(schema.users.feedToken, token));
  if (!user) return c.text('Not found', 404);

  const rows = await liveEvents(user.id);
  const events = rows.map(rowToEvent);
  // Stable DTSTAMP-independent ETag: clients that send If-None-Match skip the body when nothing changed.
  const etag = `"${sha256(rows.map((r) => `${r.uid}:${r.contentHash}`).join('|')).slice(0, 32)}"`;
  if (c.req.header('if-none-match') === etag) return c.body(null, 304);

  const ics = generateIcs(events, { calendarName: 'Canvas (SFU)', timezone: user.timezone, refreshMinutes: 30 }, rows[0]?.updatedAt.toISOString());
  c.header('Content-Type', 'text/calendar; charset=utf-8');
  c.header('Content-Disposition', 'inline; filename="canvas.ics"');
  c.header('Cache-Control', 'private, max-age=300');
  c.header('ETag', etag);
  return c.body(ics);
});

import { and, eq, gt } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { db, schema } from '../db/client.js';
import { isProd } from '../env.js';
import { randomToken } from '../crypto.js';

const COOKIE = 'cally_session';
const TTL_DAYS = 60;

export type User = typeof schema.users.$inferSelect;

export async function createSession(c: Context, userId: string): Promise<void> {
  const id = randomToken(32);
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({ id, userId, expiresAt });
  setCookie(c, COOKIE, id, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(c: Context): Promise<void> {
  const id = getCookie(c, COOKIE);
  if (id) await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
  deleteCookie(c, COOKIE, { path: '/' });
}

export async function userFromSession(c: Context): Promise<User | null> {
  const id = getCookie(c, COOKIE);
  if (!id) return null;
  const rows = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user ?? null;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: User;
  }
}

/** Requires a logged-in browser session. */
export const requireUser: MiddlewareHandler = async (c, next) => {
  const user = await userFromSession(c);
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  c.set('user', user);
  await next();
};

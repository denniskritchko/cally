import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { env, googleEnabled, isProd } from '../env.js';
import { encrypt, randomToken } from '../crypto.js';
import { SCOPES, authorizationUrl, decodeIdToken, exchangeCode } from '../auth/google.js';
import { createSession, destroySession, requireUser, userFromSession } from '../auth/session.js';
import { enqueueUserSync } from '../sync/jobs.js';

export const authRoutes = new Hono();

const STATE_COOKIE = 'cally_oauth';

function beginOAuth(c: Parameters<typeof getCookie>[0], intent: 'login' | 'calendar', loginHint?: string) {
  if (!googleEnabled) return c.json({ error: 'Google OAuth is not configured (GOOGLE_CLIENT_ID/SECRET).' }, 503);
  const state = `${intent}.${randomToken(16)}`;
  setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure: isProd, sameSite: 'Lax', path: '/api/auth', maxAge: 600 });
  const scopes = intent === 'calendar' ? [...SCOPES.login, ...SCOPES.calendar] : SCOPES.login;
  return c.redirect(authorizationUrl(state, scopes, loginHint));
}

/** Sign in (identity only). */
authRoutes.get('/google', (c) => beginOAuth(c, 'login'));

/** Incremental consent for calendar access. Must already be signed in. */
authRoutes.get('/google/calendar', requireUser, (c) => beginOAuth(c, 'calendar', c.get('user').email));

authRoutes.get('/google/callback', async (c) => {
  const { code, state, error } = c.req.query();
  const expected = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/api/auth' });
  if (error) return c.redirect(`/?error=${encodeURIComponent(error)}`);
  if (!code || !state || state !== expected) return c.redirect('/?error=bad_state');

  const intent = state.split('.')[0] as 'login' | 'calendar';
  const tokens = await exchangeCode(code);
  if (!tokens.id_token) return c.redirect('/?error=no_id_token');
  const claims = decodeIdToken(tokens.id_token);

  // Find or create the user.
  let [user] = await db.select().from(schema.users).where(eq(schema.users.googleSub, claims.sub));
  if (!user) {
    [user] = await db
      .insert(schema.users)
      .values({
        id: randomToken(12),
        email: claims.email,
        googleSub: claims.sub,
        name: claims.name ?? null,
        feedToken: randomToken(24),
        timezone: env.DEFAULT_TIMEZONE,
      })
      .returning();
  }
  const current = await userFromSession(c);
  if (!current || current.id !== user!.id) await createSession(c, user!.id);

  // Store calendar access if it was granted (regardless of which intent started the flow).
  const granted = tokens.scope.split(' ');
  if (tokens.refresh_token && SCOPES.calendar.every((s) => granted.includes(s))) {
    await db
      .insert(schema.googleConnections)
      .values({ userId: user!.id, refreshTokenEnc: encrypt(tokens.refresh_token), scopes: tokens.scope, lastError: null })
      .onConflictDoUpdate({
        target: schema.googleConnections.userId,
        set: { refreshTokenEnc: encrypt(tokens.refresh_token), scopes: tokens.scope, lastError: null },
      });
    await enqueueUserSync(user!.id);
  } else if (intent === 'calendar') {
    return c.redirect('/?error=calendar_scope_denied');
  }

  return c.redirect('/');
});

authRoutes.post('/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

/**
 * Dev only: create (or reuse) a local user and print a session cookie, so the
 * dashboard and extension pairing can be tried without Google OAuth.
 *
 *   pnpm --filter @cally/api dev:session you@sfu.ca
 */
import { eq } from 'drizzle-orm';
import { db, schema, sql } from '../src/db/client.js';
import { randomToken } from '../src/crypto.js';
import { env } from '../src/env.js';

const email = process.argv[2] ?? 'dev@sfu.ca';
let [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
if (!user) {
  [user] = await db
    .insert(schema.users)
    .values({ id: randomToken(12), email, googleSub: `dev:${email}`, name: 'Dev', feedToken: randomToken(24), timezone: env.DEFAULT_TIMEZONE })
    .returning();
}
const id = randomToken(32);
await db.insert(schema.sessions).values({ id, userId: user!.id, expiresAt: new Date(Date.now() + 30 * 86_400_000) });
await sql.end();

console.log(`
User:     ${user!.email} (${user!.id})
Feed:     ${env.APP_URL}/f/${user!.feedToken}.ics

In the browser devtools console on ${env.APP_URL}:
  document.cookie = "cally_session=${id}; path=/"
then reload.  Or with curl:
  curl -b cally_session=${id} ${env.APP_URL}/api/me
`);

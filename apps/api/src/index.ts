import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, googleEnabled, isProd } from './env.js';
import { sql } from './db/client.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { canvasRoutes } from './routes/canvas.js';
import { feedRoutes } from './routes/feed.js';
import { extensionRoutes } from './routes/extension.js';
import { startJobs, stopJobs } from './sync/jobs.js';

const app = new Hono();

app.use('*', logger());
app.use('*', secureHeaders({ crossOriginResourcePolicy: false }));
// The extension calls /api/extension/* from a chrome-extension:// origin with a bearer token, no cookies.
app.use('/api/extension/*', cors({ origin: (o) => (o?.startsWith('chrome-extension://') || o?.startsWith('moz-extension://') ? o : null) }));

app.get('/api/health', (c) => c.json({ ok: true, google: googleEnabled, dev: !isProd, canvas: env.CANVAS_BASE_URL }));
app.route('/api/auth', authRoutes);
app.route('/api/me', meRoutes);
app.route('/api/canvas', canvasRoutes);
app.route('/api/extension', extensionRoutes);
app.route('/f', feedRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message ?? 'internal error' }, 500);
});

// Serve the built dashboard (apps/web/dist) when present; in dev, Vite proxies to us instead.
const here = dirname(fileURLToPath(import.meta.url));
const webDist = [resolve(here, '../../web/dist'), resolve(here, '../../../apps/web/dist'), resolve(process.cwd(), 'apps/web/dist')].find(existsSync);
if (webDist) {
  const root = webDist.startsWith(process.cwd()) ? webDist.slice(process.cwd().length + 1) : webDist;
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
  console.log(`serving dashboard from ${webDist}`);
}

const boss = await startJobs();
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`cally api on http://localhost:${info.port}  (APP_URL=${env.APP_URL})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    console.log(`\n${sig}: shutting down`);
    server.close();
    await stopJobs().catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(0);
  });
}
void boss;

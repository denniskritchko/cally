import PgBoss from 'pg-boss';
import { env } from '../env.js';
import { syncUser, usersNeedingSync } from './engine.js';

const SYNC_ALL = 'sync-all';
const SYNC_USER = 'sync-user';

let boss: PgBoss | null = null;

export async function startJobs(): Promise<PgBoss> {
  boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' });
  boss.on('error', (e) => console.error('[pg-boss]', e));
  await boss.start();

  await boss.createQueue(SYNC_ALL);
  await boss.createQueue(SYNC_USER);

  await boss.work<{ userId: string }>(SYNC_USER, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await syncUser(job.data.userId);
  });

  await boss.work(SYNC_ALL, async () => {
    const ids = await usersNeedingSync();
    console.log(`[sync-all] enqueueing ${ids.length} users`);
    for (const userId of ids) await enqueueUserSync(userId);
  });

  await boss.schedule(SYNC_ALL, env.SYNC_CRON, {}, { tz: 'UTC' });
  console.log(`[pg-boss] started; ${SYNC_ALL} on "${env.SYNC_CRON}"`);
  return boss;
}

/** Idempotent: one queued sync per user at a time. */
export async function enqueueUserSync(userId: string): Promise<void> {
  if (!boss) throw new Error('jobs not started');
  await boss.send(SYNC_USER, { userId }, { singletonKey: userId, retryLimit: 2, retryDelay: 30, expireInSeconds: 600 });
}

export async function stopJobs(): Promise<void> {
  await boss?.stop({ graceful: true, timeout: 10_000 });
}

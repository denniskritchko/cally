import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.DATABASE_URL ??= 'postgres://localhost:5432/cally';
process.env.ENCRYPTION_KEY ??= '00'.repeat(32);
process.env.GOOGLE_CLIENT_ID ??= 'test';
process.env.GOOGLE_CLIENT_SECRET ??= 'test';

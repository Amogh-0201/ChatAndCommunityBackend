import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

const testEnvPath = resolve(process.cwd(), '.env.test');

if (existsSync(testEnvPath)) {
  const result = config({ path: testEnvPath });
  if (result.error) {
    throw result.error;
  }
}

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration tests require TEST_DATABASE_URL. Configure it in .env.test or the environment.',
  );
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString('hex');
process.env.JWT_ISSUER = 'chat-community-integration-tests';
process.env.JWT_AUDIENCE = 'chat-community-integration-tests';

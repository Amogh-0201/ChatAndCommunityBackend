import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { testUsers } from '../k6_tests/test-users.js';

export { testUsers };
export const targetUserCount = 11_000;
export const groupCount = 5_500;
export const confirmation = 'I_CONFIRMED_THIS_IS_THE_ISOLATED_TEST_DATABASE';
export const baseUrl = (
  process.env.BASE_URL || 'http://localhost:3000'
).replace(/\/+$/, '');
export const tokenPoolPath = path.resolve(
  process.env.TOKEN_POOL_FILE || 'scripts/.auth-token-pool.json',
);
export const userDataPath = path.resolve(
  'scripts/.conversation-test-users.json',
);
export const groupDataPath = path.resolve(
  'scripts/.conversation-test-groups.json',
);
export const joinRequestDataPath = path.resolve(
  'scripts/.conversation-test-join-requests.json',
);
export const directDataPath = path.resolve(
  'scripts/.conversation-test-direct.json',
);

export function assertLocalApi() {
  const apiUrl = new URL(baseUrl);
  if (
    !['http:', 'https:'].includes(apiUrl.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(apiUrl.hostname)
  ) {
    throw new Error('BASE_URL must point to a local API host.');
  }
}

export function requireDatabaseConfirmation() {
  if (process.env.SEED_TEST_DATABASE !== confirmation) {
    throw new Error(
      `Set SEED_TEST_DATABASE=${confirmation} only after confirming the API is connected to your isolated test database.`,
    );
  }
}

export async function readJson(filePath) {
  let contents;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }

  try {
    return JSON.parse(contents);
  } catch {
    throw new Error(`File is not valid JSON: ${filePath}`);
  }
}

export async function writeJsonAtomically(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function withFileLock(filePath, callback) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(
        `Another operation may be running (lock file: ${lockPath}).`,
      );
    }
    throw error;
  }

  try {
    return await callback();
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

export async function loadTokenPool() {
  const pool = await readJson(tokenPoolPath);
  if (
    !Array.isArray(pool) ||
    pool.some(
      (entry) =>
        !entry ||
        typeof entry.username !== 'string' ||
        typeof entry.accessToken !== 'string' ||
        typeof entry.refreshToken !== 'string',
    )
  ) {
    throw new Error(
      `Token pool is missing or invalid: ${tokenPoolPath}. Run scripts/auth-token-pool.mjs login first.`,
    );
  }

  const tokensByUsername = new Map(
    pool.map((entry) => [entry.username, entry]),
  );
  const missingUsernames = testUsers
    .slice(0, targetUserCount)
    .filter((user) => !tokensByUsername.has(user.username))
    .slice(0, 5)
    .map((user) => user.username);

  if (missingUsernames.length > 0) {
    throw new Error(
      `Token pool must include the first ${targetUserCount} load-test users; missing: ${missingUsernames.join(', ')}. Run scripts/auth-token-pool.mjs login ${targetUserCount}.`,
    );
  }

  return tokensByUsername;
}

export async function apiRequest(route, token, options = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${route}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
  } catch (error) {
    throw new Error(
      `Request to ${route} could not reach the API: ${error.message}`,
    );
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `API returned non-JSON for ${route} (HTTP ${response.status}).`,
    );
  }

  if (!response.ok) {
    const detail =
      typeof body?.message === 'string'
        ? body.message
        : JSON.stringify(body?.message ?? body);
    throw new Error(`${route} failed (HTTP ${response.status}): ${detail}`);
  }

  return body;
}

export function getTargetUsersByUsername(users) {
  if (
    !Array.isArray(users) ||
    users.length !== targetUserCount ||
    users.some(
      (user) =>
        !user ||
        typeof user.id !== 'string' ||
        typeof user.username !== 'string',
    )
  ) {
    throw new Error(
      `User data must contain exactly ${targetUserCount} users with IDs and usernames.`,
    );
  }

  return new Map(users.map((user) => [user.username, user]));
}

export async function forEachConcurrent(items, concurrency, callback) {
  let nextIndex = 0;
  let firstError;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (!firstError) {
        const index = nextIndex++;
        if (index >= items.length) return;
        try {
          await callback(items[index], index);
        } catch (error) {
          firstError ??= error;
        }
      }
    }),
  );

  if (firstError) throw firstError;
}

export function getConcurrency() {
  const concurrency = Number(process.env.CONCURRENCY || 5);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
    throw new Error('CONCURRENCY must be an integer from 1 to 50.');
  }
  return concurrency;
}

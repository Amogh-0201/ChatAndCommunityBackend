import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { testUsers } from '../k6_tests/test-users.js';

const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(
  /\/$/,
  '',
);
const userCount = Number(process.env.USER_COUNT || testUsers.length);
const concurrency = Number(process.env.CONCURRENCY || 5);
const tokenPoolPath = path.resolve(
  process.env.TOKEN_POOL_FILE || 'scripts/.auth-token-pool.json',
);
const tokenPoolLockPath = `${tokenPoolPath}.lock`;
const confirmation = 'I_CONFIRMED_THIS_IS_THE_ISOLATED_TEST_DATABASE';
const saveInterval = 500;

if (process.env.SEED_TEST_DATABASE !== confirmation) {
  throw new Error(
    `Set SEED_TEST_DATABASE=${confirmation} only after confirming the API is connected to your isolated test database.`,
  );
}

const apiUrl = new URL(baseUrl);
if (
  !['http:', 'https:'].includes(apiUrl.protocol) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(apiUrl.hostname)
) {
  throw new Error('BASE_URL must point to a local API host.');
}

if (
  !Number.isInteger(userCount) ||
  userCount < 1 ||
  userCount > testUsers.length
) {
  throw new Error(
    `USER_COUNT must be an integer from 1 to ${testUsers.length}.`,
  );
}

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
  throw new Error('CONCURRENCY must be an integer from 1 to 50.');
}

await mkdir(path.dirname(tokenPoolPath), { recursive: true });

let tokenPoolLock;
try {
  tokenPoolLock = await open(tokenPoolLockPath, 'wx');
} catch (error) {
  if (error.code === 'EEXIST') {
    throw new Error(
      `Another token-pool operation may be running (lock file: ${tokenPoolLockPath}).`,
    );
  }
  throw error;
}

let nextUserIndex = 0;
let registeredCount = 0;
let firstError;
const tokenPool = new Map();
let tokenPoolWriteNumber = 0;

async function registerUsers() {
  while (!firstError) {
    const userIndex = nextUserIndex++;
    if (userIndex >= userCount) return;

    const user = testUsers[userIndex];
    let response;
    let responseText;

    try {
      response = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
      });
      responseText = await response.text();
    } catch (error) {
      firstError = new Error(
        `Request failed while registering ${user.username}: ${error.message}`,
      );
      return;
    }

    let body;
    try {
      body = JSON.parse(responseText);
    } catch {
      firstError = new Error(
        `API returned non-JSON for ${user.username} (HTTP ${response.status}).`,
      );
      return;
    }

    if (
      response.status !== 201 ||
      body?.user?.username !== user.username ||
      typeof body?.accessToken !== 'string' ||
      typeof body?.refreshToken !== 'string'
    ) {
      const detail =
        typeof body?.message === 'string'
          ? body.message
          : JSON.stringify(body?.message ?? body);
      firstError = new Error(
        `Could not register ${user.username} (HTTP ${response.status}): ${detail}. ` +
          'If accounts were created by an earlier/partial run, use a fresh isolated test database before seeding again.',
      );
      return;
    }

    tokenPool.set(user.username, {
      username: user.username,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      refreshTokenExpiresAt: body.refreshTokenExpiresAt,
      sessionExpiresAt: body.sessionExpiresAt,
    });

    registeredCount++;
    if (registeredCount % saveInterval === 0) {
      try {
        await writeTokenPool([...tokenPool.values()]);
      } catch (error) {
        firstError = new Error(
          `Could not persist the auth token pool: ${error.message}`,
        );
        return;
      }
    }

    if (registeredCount % 100 === 0 || registeredCount === userCount) {
      console.log(`Registered ${registeredCount}/${userCount} users.`);
    }
  }
}

console.log(
  `Registering ${userCount} test users at ${baseUrl} with concurrency ${concurrency}; ` +
    `saving auth tokens to ${tokenPoolPath}.`,
);

try {
  await writeTokenPool([]);

  await Promise.all(
    Array.from({ length: Math.min(concurrency, userCount) }, () =>
      registerUsers(),
    ),
  );

  await writeTokenPool([...tokenPool.values()]);

  if (firstError) {
    throw new Error(
      `${firstError.message} Successfully registered ${registeredCount} users; ` +
        `${tokenPool.size} token pairs were saved to ${tokenPoolPath}.`,
    );
  }

  console.log(
    `Finished: registered ${registeredCount} users and saved ${tokenPool.size} token pairs.`,
  );
} finally {
  await tokenPoolLock.close();
  await unlink(tokenPoolLockPath);
}

async function writeTokenPool(entries) {
  const temporaryPath = `${tokenPoolPath}.${process.pid}.${tokenPoolWriteNumber++}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(entries, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    await rename(temporaryPath, tokenPoolPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

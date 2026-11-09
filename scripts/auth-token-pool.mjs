import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { testUsers } from '../k6_tests/test-users.js';

const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(
  /\/+$/,
  '',
);
const tokenPoolPath = path.resolve(
  process.env.TOKEN_POOL_FILE || 'scripts/.auth-token-pool.json',
);
const concurrency = Number(process.env.CONCURRENCY || 5);
const command = process.argv[2];
const countArgument = process.argv[3];

if (!['login', 'refresh', 'logout'].includes(command)) {
  throw new Error(
    'Usage: node scripts/auth-token-pool.mjs <login|refresh|logout> [user-count]',
  );
}

if (process.argv.length > 4) {
  throw new Error(
    'Usage: node scripts/auth-token-pool.mjs <login|refresh|logout> [user-count]',
  );
}

if (command === 'logout' && countArgument !== undefined) {
  throw new Error('The logout command does not accept a user count.');
}

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
  throw new Error('CONCURRENCY must be an integer from 1 to 50.');
}

const apiUrl = new URL(baseUrl);
if (
  !['http:', 'https:'].includes(apiUrl.protocol) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(apiUrl.hostname)
) {
  throw new Error('BASE_URL must point to a local API host.');
}

const lockPath = `${tokenPoolPath}.lock`;
let lock;

try {
  await mkdir(path.dirname(tokenPoolPath), { recursive: true });
  lock = await open(lockPath, 'wx');
} catch (error) {
  if (error.code === 'EEXIST') {
    throw new Error(
      `Another token-pool operation may be running (lock file: ${lockPath}).`,
    );
  }
  throw error;
}

try {
  const existingPool = await readPool();

  if (command === 'login') {
    const userCount = await getUserCount(countArgument, testUsers.length);
    const usersToLogin = testUsers.slice(0, userCount);
    const selectedUsernames = new Set(
      usersToLogin.map((user) => user.username),
    );
    const previousPool = new Map(
      existingPool.map((entry) => [entry.username, entry]),
    );
    const newPool = new Map();
    const errors = [];
    let completed = 0;

    const unselectedEntries = existingPool.filter(
      (entry) => !selectedUsernames.has(entry.username),
    );
    await forEachConcurrent(unselectedEntries, async (entry) => {
      try {
        await postJson('/auth/logout', {
          refreshToken: entry.refreshToken,
        });
      } catch (error) {
        errors.push(
          `${entry.username}: unselected session cleanup failed (${error.message})`,
        );
        newPool.set(entry.username, entry);
      }
    });

    await forEachConcurrent(usersToLogin, async (user) => {
      const previous = previousPool.get(user.username);
      if (previous?.refreshToken) {
        try {
          await postJson('/auth/logout', {
            refreshToken: previous.refreshToken,
          });
          newPool.delete(user.username);
        } catch (error) {
          errors.push(
            `${user.username}: existing session cleanup failed (${error.message})`,
          );
          newPool.set(user.username, previous);
        }
      }

      try {
        const response = await postJson('/auth/login', {
          username: user.username,
          password: user.password,
        });
        const entry = tokenEntry(user.username, response);
        newPool.set(user.username, entry);
      } catch (error) {
        errors.push(`${user.username}: login failed (${error.message})`);
      }

      completed++;
      logProgress(completed, usersToLogin.length);
    });

    await writePool([...newPool.values()]);
    console.log(
      `Logged in ${userCount} users; saved ${newPool.size} token pairs.`,
    );
    reportErrors(errors);
  } else if (command === 'refresh') {
    if (existingPool.length === 0) {
      throw new Error(
        `Token pool is empty: ${tokenPoolPath}. Run the login command first.`,
      );
    }

    const userCount = await getUserCount(countArgument, existingPool.length);
    const selectedEntries = existingPool.slice(0, userCount);
    const updatedPool = new Map(
      existingPool.map((entry) => [entry.username, entry]),
    );
    const usersByUsername = new Map(
      testUsers.map((user) => [user.username, user]),
    );
    const errors = [];
    let loggedInAgain = 0;
    let completed = 0;

    await forEachConcurrent(selectedEntries, async (entry) => {
      const user = usersByUsername.get(entry.username);
      if (!user) {
        errors.push(`${entry.username}: account is not in test-users.js`);
        return;
      }

      try {
        let response;
        try {
          response = await postJson('/auth/refresh', {
            refreshToken: entry.refreshToken,
          });
        } catch (error) {
          if (error.status !== 401) throw error;
          response = await postJson('/auth/login', {
            username: user.username,
            password: user.password,
          });
          loggedInAgain++;
        }
        updatedPool.set(entry.username, tokenEntry(entry.username, response));
      } catch (error) {
        errors.push(`${entry.username}: refresh failed (${error.message})`);
      }

      completed++;
      logProgress(completed, selectedEntries.length);
    });

    await writePool([...updatedPool.values()]);
    console.log(
      `Refreshed ${userCount} users; saved ${updatedPool.size} token pairs. ` +
        `Logged in again for ${loggedInAgain} rejected refresh tokens.`,
    );
    reportErrors(errors);
  } else {
    if (existingPool.length === 0) {
      console.log('Token pool is empty; there are no sessions to log out.');
    } else {
      const errors = [];
      let completed = 0;

      await forEachConcurrent(existingPool, async (entry) => {
        try {
          await postJson('/auth/logout', {
            refreshToken: entry.refreshToken,
          });
        } catch (error) {
          errors.push(`${entry.username}: logout failed (${error.message})`);
        }

        completed++;
        logProgress(completed, existingPool.length);
      });

      if (errors.length === 0) {
        await unlink(tokenPoolPath);
        console.log(
          `Logged out ${existingPool.length} sessions and removed the token pool.`,
        );
      } else {
        throw new Error(
          `${errors.length} logout operation(s) failed:\n${errors.join('\n')}\nThe token pool was kept so you can retry.`,
        );
      }
    }
  }
} finally {
  await lock.close();
  await unlink(lockPath);
}

async function readPool() {
  let contents;
  try {
    contents = await readFile(tokenPoolPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  let pool;
  try {
    pool = JSON.parse(contents);
  } catch {
    throw new Error(`Token pool is not valid JSON: ${tokenPoolPath}`);
  }

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
    throw new Error(`Token pool has an invalid format: ${tokenPoolPath}`);
  }
  return pool;
}

async function getUserCount(argument, maximum) {
  if (argument !== undefined) {
    const count = Number(argument);
    if (!Number.isSafeInteger(count) || count < 1 || count > maximum) {
      throw new Error(`User count must be an integer from 1 to ${maximum}.`);
    }
    return count;
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(
      `Specify a user count from 1 to ${maximum} when running non-interactively.`,
    );
  }

  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await prompt.question(
      `How many users? (1-${maximum}, default ${maximum}): `,
    );
    const count = answer.trim() === '' ? maximum : Number(answer);
    if (!Number.isSafeInteger(count) || count < 1 || count > maximum) {
      throw new Error(`User count must be an integer from 1 to ${maximum}.`);
    }
    return count;
  } finally {
    prompt.close();
  }
}

async function postJson(route, payload) {
  let response;
  try {
    response = await fetch(`${baseUrl}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('request could not reach the API');
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`API returned non-JSON (HTTP ${response.status})`);
  }

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function tokenEntry(username, response) {
  if (
    response?.user?.username !== username ||
    typeof response.accessToken !== 'string' ||
    typeof response.refreshToken !== 'string'
  ) {
    throw new Error('API response did not contain the expected token pair');
  }

  return {
    username,
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    refreshTokenExpiresAt: response.refreshTokenExpiresAt,
    sessionExpiresAt: response.sessionExpiresAt,
  };
}

async function writePool(pool) {
  const temporaryPath = `${tokenPoolPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(pool, null, 2)}\n`, {
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

async function forEachConcurrent(items, callback) {
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        await callback(items[index], index);
      }
    }),
  );
}

function logProgress(completed, total) {
  if (completed % 100 === 0 || completed === total) {
    console.log(`Processed ${completed}/${total} users.`);
  }
}

function reportErrors(errors) {
  if (errors.length > 0) {
    throw new Error(
      `${errors.length} token-pool operation(s) failed:\n${errors.join('\n')}`,
    );
  }
}

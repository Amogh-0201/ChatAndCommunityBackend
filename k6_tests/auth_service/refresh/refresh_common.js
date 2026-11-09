import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const tokenPoolPath =
  __ENV.TOKEN_POOL_FILE || '../../../scripts/.auth-token-pool.json';
const tokenPool = new SharedArray('auth-token-pool', () => {
  const pool = JSON.parse(open(tokenPoolPath));
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
    throw new Error(`Invalid token pool file: ${tokenPoolPath}`);
  }
  return pool;
});

let vuTokens;
let vuUsernames;

export function refreshUser(maxVus) {
  if (!Number.isSafeInteger(maxVus) || maxVus < 1) {
    throw new Error(`maxVus must be a positive integer; received ${maxVus}.`);
  }

  if (exec.vu.idInTest > maxVus) {
    throw new Error(
      `VU ${exec.vu.idInTest} exceeds the configured shard count ${maxVus}. ` +
        'Pass the profile maximum VU count to refreshUser().',
    );
  }

  if (tokenPool.length < maxVus) {
    throw new Error(
      `Token pool contains ${tokenPool.length} users, fewer than the ${maxVus} ` +
        'VUs configured for this profile.',
    );
  }

  if (!vuTokens) {
    const vuIndex = exec.vu.idInTest - 1;
    vuTokens = new Map();

    for (
      let userIndex = vuIndex;
      userIndex < tokenPool.length;
      userIndex += maxVus
    ) {
      const entry = tokenPool[userIndex];
      vuTokens.set(entry.username, {
        username: entry.username,
        accessToken: entry.accessToken,
        refreshToken: entry.refreshToken,
        unusable: false,
      });
    }

    vuUsernames = Array.from(vuTokens.keys());
  }

  if (vuUsernames.length === 0) {
    throw new Error(
      `No token-pool users assigned to VU ${exec.vu.idInTest}; ` +
        `pool has ${tokenPool.length} entries and profile supports ${maxVus} VUs.`,
    );
  }

  const username =
    vuUsernames[exec.vu.iterationInScenario % vuUsernames.length];
  const entry = vuTokens.get(username);
  if (entry.unusable) return;

  const previousRefreshToken = entry.refreshToken;
  const response = http.post(
    `${baseUrl}/auth/refresh`,
    JSON.stringify({ refreshToken: previousRefreshToken }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'auth_refresh' },
    },
  );

  let body;
  try {
    body = response.json();
  } catch {
    body = null;
  }

  const validRotation =
    response.status === 200 &&
    body?.user?.username === entry.username &&
    typeof body.accessToken === 'string' &&
    typeof body.refreshToken === 'string' &&
    body.refreshToken !== previousRefreshToken;

  check(response, {
    'refresh returns 200 and rotated token pair': () => validRotation,
  });

  if (validRotation) {
    entry.accessToken = body.accessToken;
    entry.refreshToken = body.refreshToken;
  } else {
    entry.unusable = true;
    console.error(
      `Refresh failed for ${entry.username}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `error=${response.error || 'none'}. This user's token will not be reused.`,
    );
  }
}

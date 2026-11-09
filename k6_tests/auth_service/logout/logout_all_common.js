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
        typeof entry.accessToken !== 'string',
    )
  ) {
    throw new Error(`Invalid token pool file: ${tokenPoolPath}`);
  }
  return pool;
});

export function logoutAllUser(maxVus) {
  if (!Number.isSafeInteger(maxVus) || maxVus < 1) {
    throw new Error(`maxVus must be a positive integer; received ${maxVus}.`);
  }

  if (exec.vu.idInTest > maxVus) {
    throw new Error(
      `VU ${exec.vu.idInTest} exceeds the configured shard count ${maxVus}. ` +
        'Pass the profile maximum VU count to logoutAllUser().',
    );
  }

  if (tokenPool.length < maxVus) {
    throw new Error(
      `Token pool contains ${tokenPool.length} users, fewer than the ${maxVus} ` +
        'VUs configured for this profile.',
    );
  }

  const userIndex = exec.vu.iterationInScenario * maxVus + exec.vu.idInTest - 1;
  const entry = tokenPool[userIndex];

  if (!entry) return;

  const response = http.post(`${baseUrl}/auth/logout-all`, null, {
    headers: {
      Authorization: `Bearer ${entry.accessToken}`,
    },
    tags: { endpoint: 'auth_logout_all' },
  });

  if (response.status !== 200) {
    console.error(
      `Logout-all failed for ${entry.username}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `error=${response.error || 'none'}`,
    );
  }

  check(response, {
    'logout-all returns 200 and success': (res) => {
      if (res.status !== 200) return false;
      try {
        return res.json()?.success === true;
      } catch {
        return false;
      }
    },
  });
}

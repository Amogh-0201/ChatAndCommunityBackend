import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const tokenPoolPath =
  __ENV.TOKEN_POOL_FILE || '../../../scripts/.auth-token-pool.json';
const pageLimit = 50;
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
  if (pool.length === 0) {
    throw new Error(`Token pool is empty: ${tokenPoolPath}`);
  }
  return pool;
});

export function findAllUsers(maxVus) {
  if (!Number.isSafeInteger(maxVus) || maxVus < 1) {
    throw new Error(`maxVus must be a positive integer; received ${maxVus}.`);
  }

  if (exec.vu.idInTest > maxVus) {
    throw new Error(
      `VU ${exec.vu.idInTest} exceeds the configured profile maximum of ${maxVus} VUs.`,
    );
  }

  const requestIndex =
    (exec.vu.iterationInScenario * maxVus + exec.vu.idInTest - 1) %
    tokenPool.length;
  const entry = tokenPool[requestIndex];
  const response = http.get(`${baseUrl}/user?limit=${pageLimit}`, {
    headers: { Authorization: `Bearer ${entry.accessToken}` },
    tags: { endpoint: 'user_find_all' },
  });

  let body;
  try {
    body = response.json();
  } catch {
    body = null;
  }

  if (response.status !== 200) {
    console.error(
      `Find-all-users failed for ${entry.username}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `error=${response.error || 'none'}`,
    );
  }

  check(response, {
    'find-all-users returns a valid first page': () =>
      response.status === 200 &&
      Array.isArray(body?.data) &&
      body.data.length <= pageLimit &&
      typeof body?.meta?.totalUsers === 'number' &&
      body.meta.currentPage === 1 &&
      body.meta.limit === pageLimit &&
      typeof body.meta.totalPages === 'number' &&
      typeof body.meta.hasNextPage === 'boolean' &&
      body.meta.hasPreviousPage === false &&
      body.data.every(
        (user) =>
          user !== null &&
          typeof user === 'object' &&
          typeof user.id === 'string' &&
          typeof user.name === 'string' &&
          typeof user.username === 'string' &&
          typeof user.createdAt === 'string',
      ),
  });
}

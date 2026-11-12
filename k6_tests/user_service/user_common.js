import exec from 'k6/execution';
import { SharedArray } from 'k6/data';

const tokenPoolPath =
  __ENV.TOKEN_POOL_FILE || '../../scripts/.auth-token-pool.json';
export const tokenPool = new SharedArray('user-service-auth-token-pool', () => {
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

export const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000').replace(
  /\/+$/,
  '',
);

export function getUserToken(maxVus) {
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
  return tokenPool[requestIndex];
}

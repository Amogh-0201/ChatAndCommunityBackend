import http from 'k6/http';
import { check } from 'k6';
import { baseUrl, getUserToken } from '../user_common.js';
const pageLimit = 50;

export function findAllUsers(maxVus) {
  const entry = getUserToken(maxVus);
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

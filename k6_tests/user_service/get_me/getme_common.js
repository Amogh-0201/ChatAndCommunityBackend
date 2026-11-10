import http from 'k6/http';
import { check } from 'k6';
import { baseUrl, getUserToken } from '../user_common.js';

export function getMe(maxVus) {
  const entry = getUserToken(maxVus);
  const expectedUser = profileForUsername(entry.username);
  const response = http.get(`${baseUrl}/user/me`, {
    headers: { Authorization: `Bearer ${entry.accessToken}` },
    tags: { endpoint: 'user_get_me' },
  });

  let body;
  try {
    body = response.json();
  } catch {
    body = null;
  }

  if (response.status !== 200) {
    console.error(
      `Get-me failed for ${entry.username}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `error=${response.error || 'none'}`,
    );
  }

  check(response, {
    'get-me returns the authenticated user profile': () =>
      response.status === 200 &&
      body !== null &&
      typeof body === 'object' &&
      typeof body.id === 'string' &&
      body.name === expectedUser.name &&
      body.username === expectedUser.username &&
      typeof body.phoneNumber === 'string' &&
      typeof body.createdAt === 'string',
  });
}

function profileForUsername(username) {
  const match = /^loadtest_user_(\d{3,})$/.exec(username);
  if (!match) {
    throw new Error(
      `Token-pool username "${username}" is not a generated load-test user.`,
    );
  }

  return {
    name: `Load Test User ${match[1]}`,
    username,
  };
}

import http from 'k6/http';
import { check } from 'k6';
import { baseUrl, getUserToken } from '../user_common.js';

export function updateUser(maxVus) {
  const entry = getUserToken(maxVus);
  const expectedUser = profileForUsername(entry.username);
  const body = updateBody(expectedUser);
  const response = http.patch(`${baseUrl}/user`, JSON.stringify(body), {
    headers: {
      Authorization: `Bearer ${entry.accessToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'user_update' },
  });

  let result;
  try {
    result = response.json();
  } catch {
    result = null;
  }

  if (response.status !== 200) {
    console.error(
      `Update-user failed for ${entry.username}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `error=${response.error || 'none'}`,
    );
  }

  check(response, {
    'update-user preserves the current profile': () =>
      response.status === 200 &&
      result !== null &&
      typeof result === 'object' &&
      typeof result.id === 'string' &&
      result.name === expectedUser.name &&
      result.username === expectedUser.username &&
      typeof result.phoneNumber === 'string' &&
      typeof result.createdAt === 'string' &&
      typeof result.updatedAt === 'string',
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

function updateBody(user) {
  switch (Math.floor(Math.random() * 3)) {
    case 0:
      return { name: user.name };
    case 1:
      return { username: user.username };
    default:
      return { name: user.name, username: user.username };
  }
}

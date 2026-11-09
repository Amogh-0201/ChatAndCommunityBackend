import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { testUsers } from '../../test-users.js';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

export function loginUser() {
  const userIndex = ((exec.vu.idInTest - 1) % testUsers.length);
  const user = testUsers[userIndex];

  if (!user) {
    throw new Error(
      `No test account exists for VU ${exec.vu.idInTest}; ` +
        `test-users.js contains ${testUsers.length} users.`,
    );
  }

  const response = http.post(
    `${baseUrl}/auth/login`,
    JSON.stringify({ username: user.username, password: user.password }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'auth_login' },
    },
  );

  if (response.status !== 200) {
    console.error(
      `Login failed for ${user.username}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `error=${response.error || 'none'}`,
    );
  }

  check(response, {
    'login returns 200 and expected user tokens': (res) => {
      if (res.status !== 200) return false;

      try {
        const body = res.json();
        return (
          body?.user?.username === user.username &&
          Boolean(body?.accessToken) &&
          Boolean(body?.refreshToken)
        );
      } catch {
        return false;
      }
    },
  });
}

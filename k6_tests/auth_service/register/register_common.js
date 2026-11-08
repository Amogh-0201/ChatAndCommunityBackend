import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const runId = String(__ENV.RUN_ID || Date.now().toString(36).slice(-8));

if (!/^[a-zA-Z0-9]{1,8}$/.test(runId)) {
  throw new Error('RUN_ID must be 1-8 letters or numbers.');
}

export function registerUser(profile) {
  const vuId = exec.vu.idInTest;
  const iteration = exec.vu.iterationInScenario;
  const username = `k6${profile}${runId}_${vuId}_${iteration}`;
  const phoneNumber = `+1${String(
    Math.floor(Math.random() * 1e13),
  ).padStart(13, '0')}`;
  const user = {
    name: `K6 Load User ${vuId}`,
    username,
    phoneNumber,
    password: 'LoadTest123!',
  };

  const response = http.post(
    `${baseUrl}/auth/register`,
    JSON.stringify(user),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'auth_register' },
    },
  );

  check(response, {
    'registration returns 201': (res) => res.status === 201,
  });
}

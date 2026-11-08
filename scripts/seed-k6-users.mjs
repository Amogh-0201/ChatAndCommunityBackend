import { testUsers } from '../k6_tests/test-users.js';

const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(
  /\/$/,
  '',
);
const userCount = Number(process.env.USER_COUNT || testUsers.length);
const concurrency = Number(process.env.CONCURRENCY || 5);
const confirmation = 'I_CONFIRMED_THIS_IS_THE_ISOLATED_TEST_DATABASE';

if (process.env.SEED_TEST_DATABASE !== confirmation) {
  throw new Error(
    `Set SEED_TEST_DATABASE=${confirmation} only after confirming the API is connected to your isolated test database.`,
  );
}

const apiUrl = new URL(baseUrl);
if (
  !['http:', 'https:'].includes(apiUrl.protocol) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(apiUrl.hostname)
) {
  throw new Error('BASE_URL must point to a local API host.');
}

if (
  !Number.isInteger(userCount) ||
  userCount < 1 ||
  userCount > testUsers.length
) {
  throw new Error(
    `USER_COUNT must be an integer from 1 to ${testUsers.length}.`,
  );
}

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
  throw new Error('CONCURRENCY must be an integer from 1 to 50.');
}

let nextUserIndex = 0;
let registeredCount = 0;
let firstError;

async function registerUsers() {
  while (!firstError) {
    const userIndex = nextUserIndex++;
    if (userIndex >= userCount) return;

    const user = testUsers[userIndex];
    let response;
    let responseText;

    try {
      response = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
      });
      responseText = await response.text();
    } catch (error) {
      firstError = new Error(
        `Request failed while registering ${user.username}: ${error.message}`,
      );
      return;
    }

    let body;
    try {
      body = JSON.parse(responseText);
    } catch {
      firstError = new Error(
        `API returned non-JSON for ${user.username} (HTTP ${response.status}).`,
      );
      return;
    }

    if (
      response.status !== 201 ||
      body?.user?.username !== user.username ||
      !body?.accessToken
    ) {
      const detail =
        typeof body?.message === 'string'
          ? body.message
          : JSON.stringify(body?.message ?? body);
      firstError = new Error(
        `Could not register ${user.username} (HTTP ${response.status}): ${detail}. ` +
          'If accounts were created by an earlier/partial run, use a fresh isolated test database before seeding again.',
      );
      return;
    }

    registeredCount++;
    if (registeredCount % 100 === 0 || registeredCount === userCount) {
      console.log(`Registered ${registeredCount}/${userCount} users.`);
    }
  }
}

console.log(
  `Registering ${userCount} test users at ${baseUrl} with concurrency ${concurrency}.`,
);

await Promise.all(
  Array.from({ length: Math.min(concurrency, userCount) }, () =>
    registerUsers(),
  ),
);

if (firstError) {
  throw new Error(
    `${firstError.message} Successfully registered ${registeredCount} users before stopping.`,
  );
}

console.log(`Finished: registered ${registeredCount} test users.`);

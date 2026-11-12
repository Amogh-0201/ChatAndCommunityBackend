import {
  apiRequest,
  assertLocalApi,
  getTargetUsersByUsername,
  loadTokenPool,
  targetUserCount,
  testUsers,
  tokenPoolPath,
  userDataPath,
  withFileLock,
  writeJsonAtomically,
} from './conversation-test-data.mjs';

assertLocalApi();

await withFileLock(userDataPath, async () => {
  const tokensByUsername = await loadTokenPool();
  const firstUser = testUsers[0];
  const token = tokensByUsername.get(firstUser.username);
  const currentUser = await apiRequest('/user/me', token.accessToken);

  if (
    typeof currentUser?.id !== 'string' ||
    typeof currentUser.username !== 'string'
  ) {
    throw new Error('GET /user/me did not return the expected user profile.');
  }

  const targetUsernames = new Set(
    testUsers.slice(0, targetUserCount).map((user) => user.username),
  );
  const usersByUsername = new Map();
  if (targetUsernames.has(currentUser.username)) {
    usersByUsername.set(currentUser.username, currentUser);
  }

  let page = 1;
  let totalPages;
  while (usersByUsername.size < targetUsernames.size) {
    const result = await apiRequest(
      `/user?page=${page}&limit=100`,
      token.accessToken,
    );

    if (
      !Array.isArray(result?.data) ||
      !Number.isInteger(result?.meta?.totalPages) ||
      result.meta.currentPage !== page ||
      result.meta.limit !== 100
    ) {
      throw new Error(`GET /user page ${page} returned an invalid response.`);
    }

    totalPages = result.meta.totalPages;
    for (const user of result.data) {
      if (targetUsernames.has(user?.username) && typeof user.id === 'string') {
        usersByUsername.set(user.username, user);
      }
    }

    console.log(
      `Found ${usersByUsername.size}/${targetUsernames.size} target users (page ${page}/${totalPages}).`,
    );

    if (page >= totalPages) break;
    page++;
  }

  if (usersByUsername.size !== targetUserCount) {
    const missing = testUsers
      .slice(0, targetUserCount)
      .filter((user) => !usersByUsername.has(user.username))
      .slice(0, 10)
      .map((user) => user.username);
    throw new Error(
      `Found ${usersByUsername.size}/${targetUserCount} target users. Missing: ${missing.join(', ')}. Confirm that all accounts are registered and that ${tokenPoolPath} contains their tokens.`,
    );
  }

  const users = testUsers.slice(0, targetUserCount).map(({ username }) => {
    const user = usersByUsername.get(username);
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      createdAt: user.createdAt,
    };
  });

  await writeJsonAtomically(userDataPath, {
    generatedAt: new Date().toISOString(),
    count: users.length,
    users,
  });
  console.log(`Saved ${users.length} user IDs to ${userDataPath}.`);
});

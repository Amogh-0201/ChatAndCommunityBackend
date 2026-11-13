import {
  apiRequest,
  assertLocalApi,
  forEachConcurrent,
  getConcurrency,
  getTargetUsersByUsername,
  leaveGroupDataPath,
  loadTokenPool,
  readJson,
  targetUserCount,
  testUsers,
  userDataPath,
  withFileLock,
  writeJsonAtomically,
} from './conversation-test-data.mjs';

assertLocalApi();
const concurrency = getConcurrency();

await withFileLock(leaveGroupDataPath, async () => {
  const userData = await readJson(userDataPath);
  const usersByUsername = getTargetUsersByUsername(userData?.users);
  if (usersByUsername.size !== targetUserCount) {
    throw new Error(
      `User data must contain ${targetUserCount} unique users: ${userDataPath}`,
    );
  }

  const users = testUsers
    .slice(0, targetUserCount)
    .map(({ username }) => usersByUsername.get(username));
  if (users.some((user) => !user)) {
    throw new Error(
      `User data is missing one or more expected load-test users: ${userDataPath}`,
    );
  }

  const tokensByUsername = await loadTokenPool();
  const collectedUsers = new Array(users.length);
  const generatedAt = new Date().toISOString();
  let completed = 0;
  let membershipCount = 0;
  let writeQueue = Promise.resolve();

  const saveProgress = (complete) => {
    writeQueue = writeQueue.then(() =>
      writeJsonAtomically(leaveGroupDataPath, {
        generatedAt,
        complete,
        count: completed,
        expectedUserCount: targetUserCount,
        membershipCount,
        users: collectedUsers.filter(Boolean),
      }),
    );
    return writeQueue;
  };

  console.log(
    `Fetching group memberships for ${users.length} users with concurrency ${concurrency}; saving to ${leaveGroupDataPath}.`,
  );
  await saveProgress(false);

  let succeeded = false;
  try {
    await forEachConcurrent(users, concurrency, async (user, index) => {
      const token = tokensByUsername.get(user.username);
      const conversations = await apiRequest(
        '/conversations',
        token.accessToken,
      );

      if (
        !Array.isArray(conversations) ||
        conversations.some(
          (conversation) =>
            !conversation ||
            typeof conversation.id !== 'string' ||
            typeof conversation.type !== 'string' ||
            !Array.isArray(conversation.members),
        )
      ) {
        throw new Error(
          `GET /conversations for ${user.username} returned an invalid response.`,
        );
      }

      const groups = conversations
        .filter((conversation) => conversation.type === 'GROUP')
        .map((conversation) => {
          const membership = conversation.members.find(
            (member) => member?.userId === user.id,
          );
          if (!membership || typeof membership.role !== 'string') {
            throw new Error(
              `Group ${conversation.id} did not include expected member ${user.username}.`,
            );
          }

          return {
            conversationId: conversation.id,
            conversationName: conversation.name,
            role: membership.role,
          };
        });

      collectedUsers[index] = {
        id: user.id,
        username: user.username,
        groups,
      };
      completed++;
      membershipCount += groups.length;

      if (completed % 100 === 0 || completed === users.length) {
        await saveProgress(false);
        console.log(
          `Fetched group memberships for ${completed}/${users.length} users (${membershipCount} memberships).`,
        );
      }
    });

    if (completed !== targetUserCount) {
      throw new Error(
        `Fetched conversations for ${completed}/${targetUserCount} users.`,
      );
    }

    await saveProgress(true);
    succeeded = true;
    console.log(
      `Saved ${membershipCount} group memberships for ${completed} users to ${leaveGroupDataPath}.`,
    );
  } finally {
    if (!succeeded) await saveProgress(false);
  }
});

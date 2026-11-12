import {
  apiRequest,
  assertLocalApi,
  directDataPath,
  forEachConcurrent,
  getConcurrency,
  getTargetUsersByUsername,
  groupCount,
  loadTokenPool,
  readJson,
  requireDatabaseConfirmation,
  testUsers,
  userDataPath,
  withFileLock,
  writeJsonAtomically,
} from './conversation-test-data.mjs';

assertLocalApi();
requireDatabaseConfirmation();
const concurrency = getConcurrency();

await withFileLock(directDataPath, async () => {
  const userData = await readJson(userDataPath);
  const usersByUsername = getTargetUsersByUsername(userData?.users);
  const tokensByUsername = await loadTokenPool();
  const existing = await readJson(directDataPath);
  if (
    existing !== null &&
    (!Array.isArray(existing.conversations) ||
      existing.conversations.some(
        (entry) =>
          typeof entry?.userAId !== 'string' ||
          typeof entry?.userBId !== 'string' ||
          typeof entry?.id !== 'string',
      ))
  ) {
    throw new Error(
      `Direct conversation data has an invalid format: ${directDataPath}`,
    );
  }

  const conversationsByPair = new Map(
    (existing?.conversations ?? []).map((entry) => [
      `${entry.userAId}:${entry.userBId}`,
      entry,
    ]),
  );
  const pairs = Array.from({ length: groupCount }, (_, index) => {
    const userA = usersByUsername.get(testUsers[index].username);
    const userB = usersByUsername.get(testUsers[index + groupCount].username);
    if (!userA || !userB) {
      throw new Error(
        `Missing a user ID for direct conversation pair ${index + 1}.`,
      );
    }
    return { userA, userB, index };
  });
  const pendingPairs = pairs.filter(
    ({ userA, userB }) => !conversationsByPair.has(`${userA.id}:${userB.id}`),
  );
  let completed = conversationsByPair.size;
  let writeQueue = Promise.resolve();

  const saveProgress = () => {
    writeQueue = writeQueue.then(() =>
      writeJsonAtomically(directDataPath, {
        generatedAt: new Date().toISOString(),
        count: conversationsByPair.size,
        conversations: pairs
          .map(({ userA, userB }) =>
            conversationsByPair.get(`${userA.id}:${userB.id}`),
          )
          .filter(Boolean),
      }),
    );
    return writeQueue;
  };

  console.log(
    `Creating or retrieving ${pendingPairs.length} remaining direct conversations with concurrency ${concurrency}; saving to ${directDataPath}.`,
  );

  try {
    await forEachConcurrent(
      pendingPairs,
      concurrency,
      async ({ userA, userB, index }) => {
        const token = tokensByUsername.get(userA.username);
        const conversation = await apiRequest(
          `/conversations/direct/${encodeURIComponent(userB.id)}`,
          token.accessToken,
          { method: 'POST' },
        );

        if (
          typeof conversation?.id !== 'string' ||
          conversation.type !== 'DIRECT' ||
          !Array.isArray(conversation.members) ||
          !conversation.members.some((member) => member.userId === userA.id) ||
          !conversation.members.some((member) => member.userId === userB.id)
        ) {
          throw new Error(
            `Creating direct conversation for pair ${index + 1} returned an unexpected response.`,
          );
        }

        conversationsByPair.set(`${userA.id}:${userB.id}`, {
          ...conversation,
          pairNumber: index + 1,
          userAId: userA.id,
          userAUsername: userA.username,
          userBId: userB.id,
          userBUsername: userB.username,
        });
        completed++;
        if (completed % 100 === 0 || completed === groupCount) {
          await saveProgress();
          console.log(
            `Created or retrieved ${completed}/${groupCount} conversations.`,
          );
        }
      },
    );
  } finally {
    await saveProgress();
  }

  if (conversationsByPair.size !== groupCount) {
    throw new Error(
      `Created or recovered ${conversationsByPair.size}/${groupCount} direct conversations; rerun the script to resume.`,
    );
  }
  console.log(
    `Saved ${conversationsByPair.size} direct conversations to ${directDataPath}.`,
  );
});

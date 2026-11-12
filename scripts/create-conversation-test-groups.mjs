import {
  apiRequest,
  assertLocalApi,
  forEachConcurrent,
  getConcurrency,
  getTargetUsersByUsername,
  groupCount,
  groupDataPath,
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

await withFileLock(groupDataPath, async () => {
  const userData = await readJson(userDataPath);
  const usersByUsername = getTargetUsersByUsername(userData?.users);
  const tokensByUsername = await loadTokenPool();
  const existing = await readJson(groupDataPath);
  if (
    existing !== null &&
    (!Array.isArray(existing.groups) ||
      existing.groups.some(
        (group) =>
          typeof group?.ownerId !== 'string' || typeof group?.id !== 'string',
      ))
  ) {
    throw new Error(`Group data has an invalid format: ${groupDataPath}`);
  }

  const groupsByOwner = new Map(
    (existing?.groups ?? []).map((group) => [group.ownerId, group]),
  );
  const owners = testUsers.slice(0, groupCount).map(({ username }, index) => {
    const owner = usersByUsername.get(username);
    if (!owner) throw new Error(`Missing user ID for ${username}.`);
    return { owner, index };
  });
  const pendingOwners = owners.filter(
    ({ owner }) => !groupsByOwner.has(owner.id),
  );
  let completed = groupsByOwner.size;
  let writeQueue = Promise.resolve();

  const saveProgress = () => {
    writeQueue = writeQueue.then(() =>
      writeJsonAtomically(groupDataPath, {
        generatedAt: new Date().toISOString(),
        count: groupsByOwner.size,
        groups: owners
          .map(({ owner }) => groupsByOwner.get(owner.id))
          .filter(Boolean),
      }),
    );
    return writeQueue;
  };

  console.log(
    `Creating ${pendingOwners.length} remaining groups with concurrency ${concurrency}; saving to ${groupDataPath}.`,
  );

  try {
    await forEachConcurrent(
      pendingOwners,
      concurrency,
      async ({ owner, index }) => {
        const token = tokensByUsername.get(owner.username);
        const group = await apiRequest(
          '/conversations/groups',
          token.accessToken,
          {
            method: 'POST',
            body: JSON.stringify({ name: `Load Test Group ${index + 1}` }),
          },
        );

        if (
          typeof group?.id !== 'string' ||
          group.type !== 'GROUP' ||
          group.createdById !== owner.id
        ) {
          throw new Error(
            `Creating group for ${owner.username} returned an unexpected response.`,
          );
        }

        groupsByOwner.set(owner.id, {
          ...group,
          ownerId: owner.id,
          ownerUsername: owner.username,
        });
        completed++;
        if (completed % 100 === 0 || completed === groupCount) {
          await saveProgress();
          console.log(`Created ${completed}/${groupCount} groups.`);
        }
      },
    );
  } finally {
    await saveProgress();
  }

  if (groupsByOwner.size !== groupCount) {
    throw new Error(
      `Created or recovered ${groupsByOwner.size}/${groupCount} groups; rerun the script to resume.`,
    );
  }
  console.log(`Saved ${groupsByOwner.size} groups to ${groupDataPath}.`);
});

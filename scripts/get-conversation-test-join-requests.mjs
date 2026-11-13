import {
  apiRequest,
  assertLocalApi,
  forEachConcurrent,
  getConcurrency,
  groupDataPath,
  joinRequestDataPath,
  loadTokenPool,
  readJson,
  requireDatabaseConfirmation,
  withFileLock,
  writeJsonAtomically,
} from './conversation-test-data.mjs';

assertLocalApi();
requireDatabaseConfirmation();
const concurrency = getConcurrency();

await withFileLock(joinRequestDataPath, async () => {
  const groupData = await readJson(groupDataPath);
  if (
    !groupData ||
    groupData.count !== 5_500 ||
    !Array.isArray(groupData.groups) ||
    groupData.groups.length !== 5_500 ||
    groupData.groups.some(
      (group) =>
        !group ||
        typeof group.id !== 'string' ||
        typeof group.ownerId !== 'string' ||
        typeof group.ownerUsername !== 'string',
    )
  ) {
    throw new Error(`Group data has an invalid format: ${groupDataPath}`);
  }

  const tokensByUsername = await loadTokenPool();
  const requestsByGroupId = new Map();
  let completed = 0;
  let totalJoinRequests = 0;
  let writeQueue = Promise.resolve();

  const saveProgress = () => {
    writeQueue = writeQueue.then(() =>
      writeJsonAtomically(joinRequestDataPath, {
        generatedAt: new Date().toISOString(),
        count: requestsByGroupId.size,
        joinRequestCount: totalJoinRequests,
        groups: groupData.groups
          .filter((group) => requestsByGroupId.has(group.id))
          .map((group) => ({
            ...group,
            joinRequests: requestsByGroupId.get(group.id),
          })),
      }),
    );
    return writeQueue;
  };

  console.log(
    `Fetching join requests for ${groupData.groups.length} groups with concurrency ${concurrency}; saving to ${joinRequestDataPath}.`,
  );

  try {
    await forEachConcurrent(groupData.groups, concurrency, async (group) => {
      const token = tokensByUsername.get(group.ownerUsername);
      if (!token) {
        throw new Error(
          `Missing auth token for group owner ${group.ownerUsername}.`,
        );
      }

      const joinRequests = await apiRequest(
        `/conversations/${encodeURIComponent(group.id)}/join-requests`,
        token.accessToken,
      );
      if (
        !Array.isArray(joinRequests) ||
        joinRequests.some(
          (request) =>
            !request ||
            typeof request.id !== 'string' ||
            typeof request.requesterId !== 'string' ||
            request.status !== 'PENDING' ||
            request.requester?.id !== request.requesterId ||
            typeof request.requester?.username !== 'string',
        )
      ) {
        throw new Error(
          `Join requests for group ${group.id} returned an unexpected response.`,
        );
      }

      requestsByGroupId.set(group.id, joinRequests);
      completed++;
      totalJoinRequests += joinRequests.length;
      if (completed % 100 === 0 || completed === groupData.groups.length) {
        await saveProgress();
        console.log(
          `Fetched requests for ${completed}/${groupData.groups.length} groups (${totalJoinRequests} join requests).`,
        );
      }
    });
  } finally {
    await saveProgress();
  }

  if (requestsByGroupId.size !== groupData.groups.length) {
    throw new Error(
      `Fetched requests for ${requestsByGroupId.size}/${groupData.groups.length} groups; rerun the script to retry.`,
    );
  }
  console.log(
    `Saved ${totalJoinRequests} pending join requests across ${requestsByGroupId.size} groups to ${joinRequestDataPath}.`,
  );
});

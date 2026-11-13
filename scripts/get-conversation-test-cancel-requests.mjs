import {
  apiRequest,
  assertLocalApi,
  cancelRequestCount,
  cancelRequestDataPath,
  cancelRequestPlanPath,
  forEachConcurrent,
  getConcurrency,
  getTargetUsersByUsername,
  groupCount,
  groupDataPath,
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

await withFileLock(cancelRequestDataPath, async () => {
  const [plan, groupData, userData] = await Promise.all([
    readJson(cancelRequestPlanPath),
    readJson(groupDataPath),
    readJson(userDataPath),
  ]);
  if (
    !plan ||
    plan.complete !== true ||
    plan.count !== cancelRequestCount ||
    plan.requests?.length !== cancelRequestCount ||
    !Array.isArray(plan.requests) ||
    plan.requests.length !== cancelRequestCount
  ) {
    throw new Error(
      `A complete ${cancelRequestCount}-request generation plan is required: ${cancelRequestPlanPath}`,
    );
  }

  if (
    !groupData ||
    groupData.count !== groupCount ||
    !Array.isArray(groupData.groups) ||
    groupData.groups.length !== groupCount ||
    groupData.groups.some(
      (group) =>
        !group ||
        typeof group.id !== 'string' ||
        typeof group.ownerUsername !== 'string',
    )
  ) {
    throw new Error(`Group data has an invalid format: ${groupDataPath}`);
  }

  const usersByUsername = getTargetUsersByUsername(userData?.users);
  if (usersByUsername.size !== targetUserCount) {
    throw new Error(
      `User data must contain ${targetUserCount} unique users: ${userDataPath}`,
    );
  }

  const requesterUsers = testUsers
    .slice(groupCount, targetUserCount)
    .map(({ username }) => usersByUsername.get(username));
  if (
    requesterUsers.length !== groupCount ||
    requesterUsers.some((user) => !user)
  ) {
    throw new Error(
      `User data must include load-test users ${groupCount + 1}-${targetUserCount}.`,
    );
  }

  const usersById = new Map(requesterUsers.map((user) => [user.id, user]));
  const groupsById = new Map(
    groupData.groups.map((group) => [group.id, group]),
  );
  const requestersByGroupId = new Map();
  const expectedPairs = new Set();

  for (const request of plan.requests) {
    const user = usersById.get(request?.userId);
    if (
      !user ||
      user.username !== request.username ||
      request.status !== 'PENDING' ||
      !groupsById.has(request.conversationId)
    ) {
      throw new Error(
        `Generation plan contains an invalid request: ${cancelRequestPlanPath}`,
      );
    }

    const pairKey = `${request.userId}\u0000${request.conversationId}`;
    if (expectedPairs.has(pairKey)) {
      throw new Error(
        `Generation plan contains duplicate user/group pairs: ${cancelRequestPlanPath}`,
      );
    }
    expectedPairs.add(pairKey);

    if (!requestersByGroupId.has(request.conversationId)) {
      requestersByGroupId.set(request.conversationId, new Set());
    }
    requestersByGroupId.get(request.conversationId).add(request.userId);
  }

  const groupsToFetch = groupData.groups.filter((group) =>
    requestersByGroupId.has(group.id),
  );
  const tokensByUsername = await loadTokenPool();
  const requestsByUserId = new Map(requesterUsers.map((user) => [user.id, []]));
  const foundPairs = new Set();
  const generatedAt = new Date().toISOString();
  let completedGroups = 0;
  let writeQueue = Promise.resolve();

  const saveProgress = (complete) => {
    writeQueue = writeQueue.then(() =>
      writeJsonAtomically(cancelRequestDataPath, {
        generatedAt,
        complete,
        count: requesterUsers.length,
        expectedUserCount: groupCount,
        requestCount: foundPairs.size,
        expectedRequestCount: cancelRequestCount,
        completedGroups,
        expectedGroupCount: groupsToFetch.length,
        users: requesterUsers.map((user) => ({
          id: user.id,
          username: user.username,
          requests: requestsByUserId.get(user.id),
        })),
      }),
    );
    return writeQueue;
  };

  console.log(
    `Fetching ${cancelRequestCount} planned requests from ${groupsToFetch.length} groups with concurrency ${concurrency}; saving to ${cancelRequestDataPath}.`,
  );
  await saveProgress(false);

  let succeeded = false;
  try {
    await forEachConcurrent(groupsToFetch, concurrency, async (group) => {
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

      const plannedUserIds = requestersByGroupId.get(group.id);
      for (const request of joinRequests) {
        if (!plannedUserIds.has(request.requesterId)) continue;

        const user = usersById.get(request.requesterId);
        const pairKey = `${request.requesterId}\u0000${group.id}`;
        if (!user || request.requester.username !== user.username) {
          throw new Error(
            `Join request ${request.id} does not match the expected requester for group ${group.id}.`,
          );
        }
        if (foundPairs.has(pairKey)) {
          throw new Error(
            `Duplicate pending request found for ${user.username} in group ${group.id}.`,
          );
        }

        foundPairs.add(pairKey);
        requestsByUserId.get(user.id).push({
          conversationId: group.id,
          conversationName: group.name,
          requestId: request.id,
          createdAt: request.createdAt,
        });
      }

      completedGroups++;
      if (
        completedGroups % 100 === 0 ||
        completedGroups === groupsToFetch.length
      ) {
        await saveProgress(false);
        console.log(
          `Fetched ${completedGroups}/${groupsToFetch.length} groups (${foundPairs.size}/${cancelRequestCount} requests).`,
        );
      }
    });

    if (foundPairs.size !== expectedPairs.size) {
      const missingCount = expectedPairs.size - foundPairs.size;
      throw new Error(
        `Found ${foundPairs.size}/${expectedPairs.size} planned pending requests; ${missingCount} are missing or no longer pending.`,
      );
    }

    for (const requests of requestsByUserId.values()) {
      requests.sort((left, right) =>
        left.conversationId.localeCompare(right.conversationId),
      );
    }

    await saveProgress(true);
    succeeded = true;
    console.log(
      `Saved ${foundPairs.size} pending requests for ${requesterUsers.length} users to ${cancelRequestDataPath}.`,
    );
  } finally {
    if (!succeeded) await saveProgress(false);
  }
});

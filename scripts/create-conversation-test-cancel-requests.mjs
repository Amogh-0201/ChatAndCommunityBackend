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
  requireDatabaseConfirmation,
  targetUserCount,
  testUsers,
  userDataPath,
  withFileLock,
  writeJsonAtomically,
} from './conversation-test-data.mjs';

const pendingConflictMessage =
  'You already have a pending join request for this group';
const unavailablePairMessages = new Set([
  'Your join request has already been approved',
  'You are already a member of this group',
]);
const maximumAttemptsPerRequest = 100;

assertLocalApi();
requireDatabaseConfirmation();
const concurrency = getConcurrency();
if (cancelRequestPlanPath === cancelRequestDataPath) {
  throw new Error(
    'CONVERSATION_CANCEL_REQUEST_PLAN_FILE and CONVERSATION_CANCEL_REQUESTS_FILE must use different paths.',
  );
}

const [userData, groupData] = await Promise.all([
  readJson(userDataPath),
  readJson(groupDataPath),
]);
const usersByUsername = getTargetUsersByUsername(userData?.users);
if (usersByUsername.size !== targetUserCount) {
  throw new Error(
    `User data must contain ${targetUserCount} unique users: ${userDataPath}`,
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
      typeof group.ownerId !== 'string' ||
      typeof group.ownerUsername !== 'string' ||
      group.joinPolicy !== 'REQUEST',
  )
) {
  throw new Error(
    `Group data must contain ${groupCount} REQUEST groups: ${groupDataPath}`,
  );
}

const targetUsers = testUsers
  .slice(groupCount, targetUserCount)
  .map(({ username }) => usersByUsername.get(username));
if (targetUsers.length !== groupCount || targetUsers.some((user) => !user)) {
  throw new Error(
    `User data must include load-test users ${groupCount + 1}-${targetUserCount}.`,
  );
}

const tokensByUsername = await loadTokenPool();
const groupsById = new Map(groupData.groups.map((group) => [group.id, group]));
if (groupsById.size !== groupCount) {
  throw new Error(`Group data contains duplicate IDs: ${groupDataPath}`);
}

await withFileLock(cancelRequestPlanPath, async () => {
  let plan = await readJson(cancelRequestPlanPath);
  if (plan?.complete === true) plan = null;

  if (plan === null) {
    const shuffledUsers = [...targetUsers];
    for (let index = shuffledUsers.length - 1; index > 0; index--) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [shuffledUsers[index], shuffledUsers[randomIndex]] = [
        shuffledUsers[randomIndex],
        shuffledUsers[index],
      ];
    }

    plan = {
      generatedAt: new Date().toISOString(),
      complete: false,
      targetCount: cancelRequestCount,
      count: 0,
      userTargets: shuffledUsers.map((user, index) => ({
        id: user.id,
        username: user.username,
        requestCount: 5 + (index < cancelRequestCount % groupCount ? 1 : 0),
      })),
      requests: [],
    };
  }

  if (
    plan.complete !== false ||
    plan.targetCount !== cancelRequestCount ||
    plan.count !== plan.requests?.length ||
    !Array.isArray(plan.userTargets) ||
    plan.userTargets.length !== groupCount ||
    !Array.isArray(plan.requests) ||
    plan.requests.length > cancelRequestCount
  ) {
    throw new Error(
      `Cancel-request generation plan is invalid: ${cancelRequestPlanPath}`,
    );
  }

  const userTargetsById = new Map();
  const expectedUsersById = new Map(targetUsers.map((user) => [user.id, user]));
  for (const target of plan.userTargets) {
    const user = expectedUsersById.get(target?.id);
    if (
      !user ||
      user.username !== target.username ||
      !Number.isInteger(target.requestCount) ||
      target.requestCount < 5 ||
      target.requestCount > 6 ||
      userTargetsById.has(target.id)
    ) {
      throw new Error(
        `Cancel-request user targets are invalid: ${cancelRequestPlanPath}`,
      );
    }
    userTargetsById.set(target.id, target);
  }

  if (
    [...userTargetsById.values()].reduce(
      (total, target) => total + target.requestCount,
      0,
    ) !== cancelRequestCount
  ) {
    throw new Error(
      `Cancel-request user targets must sum to ${cancelRequestCount}.`,
    );
  }

  const requestsByPair = new Map();
  const attemptedPairs = new Set();
  const requestsByUserId = new Map();
  for (const request of plan.requests) {
    const target = userTargetsById.get(request?.userId);
    if (
      !target ||
      target.username !== request.username ||
      !groupsById.has(request.conversationId) ||
      request.status !== 'PENDING' ||
      (request.requestId !== null && typeof request.requestId !== 'string')
    ) {
      throw new Error(
        `Cancel-request plan contains an invalid request: ${cancelRequestPlanPath}`,
      );
    }
    const pairKey = `${request.userId}\u0000${request.conversationId}`;
    if (requestsByPair.has(pairKey)) {
      throw new Error(
        `Cancel-request plan contains duplicate pairs: ${cancelRequestPlanPath}`,
      );
    }
    requestsByPair.set(pairKey, request);
    attemptedPairs.add(pairKey);
    requestsByUserId.set(
      request.userId,
      (requestsByUserId.get(request.userId) || 0) + 1,
    );
  }

  for (const [userId, count] of requestsByUserId) {
    if (count > userTargetsById.get(userId).requestCount) {
      throw new Error(
        `Cancel-request plan exceeds the target for user ${userTargetsById.get(userId).username}.`,
      );
    }
  }

  const requesterSlots = [];
  for (const target of plan.userTargets) {
    const existingCount = requestsByUserId.get(target.id) || 0;
    for (let index = existingCount; index < target.requestCount; index++) {
      requesterSlots.push(target);
    }
  }

  let writeQueue = Promise.resolve();
  const savePlan = (complete) => {
    plan = {
      ...plan,
      complete,
      count: requestsByPair.size,
      requests: [...requestsByPair.values()],
    };
    writeQueue = writeQueue.then(() =>
      writeJsonAtomically(cancelRequestPlanPath, plan),
    );
    return writeQueue;
  };

  console.log(
    `Creating ${requesterSlots.length} remaining pending requests with concurrency ${concurrency}; target ${cancelRequestCount}.`,
  );
  await writeJsonAtomically(cancelRequestDataPath, {
    generatedAt: new Date().toISOString(),
    complete: false,
    count: 0,
    expectedUserCount: groupCount,
    requestCount: 0,
    expectedRequestCount: cancelRequestCount,
    users: [],
  });
  await savePlan(false);

  let succeeded = false;
  try {
    await forEachConcurrent(requesterSlots, concurrency, async (target) => {
      let attempts = 0;
      while (attempts < maximumAttemptsPerRequest) {
        attempts++;
        const group =
          groupData.groups[Math.floor(Math.random() * groupData.groups.length)];
        const pairKey = `${target.id}\u0000${group.id}`;
        if (attemptedPairs.has(pairKey)) continue;
        attemptedPairs.add(pairKey);

        const result = await apiRequest(
          `/conversations/${encodeURIComponent(group.id)}/join`,
          tokensByUsername.get(target.username).accessToken,
          {
            method: 'POST',
            acceptedStatuses: [409],
          },
        );

        let request;
        if (result?.status === 'PENDING') {
          if (
            typeof result.id !== 'string' ||
            result.conversationId !== group.id ||
            result.requesterId !== target.id
          ) {
            throw new Error(
              `Join request for ${target.username} and group ${group.id} returned an unexpected response.`,
            );
          }
          request = {
            userId: target.id,
            username: target.username,
            conversationId: group.id,
            requestId: result.id,
            status: 'PENDING',
          };
        } else if (result?.message === pendingConflictMessage) {
          request = {
            userId: target.id,
            username: target.username,
            conversationId: group.id,
            requestId: null,
            status: 'PENDING',
          };
        } else if (unavailablePairMessages.has(result?.message)) {
          continue;
        } else {
          throw new Error(
            `Join request for ${target.username} and group ${group.id} returned an unexpected response.`,
          );
        }

        requestsByPair.set(pairKey, request);
        requestsByUserId.set(
          target.id,
          (requestsByUserId.get(target.id) || 0) + 1,
        );
        if (
          requestsByPair.size % 100 === 0 ||
          requestsByPair.size === cancelRequestCount
        ) {
          await savePlan(false);
          console.log(
            `Prepared ${requestsByPair.size}/${cancelRequestCount} pending requests.`,
          );
        }
        return;
      }

      throw new Error(
        `Could not create a pending request for ${target.username} after ${maximumAttemptsPerRequest} different groups.`,
      );
    });

    if (requestsByPair.size !== cancelRequestCount) {
      throw new Error(
        `Prepared ${requestsByPair.size}/${cancelRequestCount} pending requests.`,
      );
    }

    await savePlan(true);
    succeeded = true;
    console.log(
      `Prepared ${requestsByPair.size} pending requests across ${groupCount} users and ${new Set([...requestsByPair.values()].map((request) => request.conversationId)).size} groups in ${cancelRequestPlanPath}.`,
    );
  } finally {
    if (!succeeded) await savePlan(false);
  }
});

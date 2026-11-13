import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import { baseUrl, tokenPool } from '../user_service/user_common.js';

const userDataPath =
  __ENV.CONVERSATION_USERS_FILE ||
  '../../scripts/.conversation-test-users.json';
const conversationUsers = new SharedArray('conversation-test-users', () => {
  const data = JSON.parse(open(userDataPath));
  if (
    !data ||
    data.count !== 11_000 ||
    !Array.isArray(data.users) ||
    data.users.length !== 11_000 ||
    data.users.some(
      (user) =>
        !user ||
        typeof user.id !== 'string' ||
        typeof user.username !== 'string',
    )
  ) {
    throw new Error(
      `Invalid conversation test user data file: ${userDataPath}`,
    );
  }
  return data.users;
});
const conversationTokenPool = new SharedArray(
  'conversation-test-auth-token-pool',
  () => {
    const entries = [];
    for (const entry of tokenPool) {
      if (getUserIndex(entry.username) >= 0) entries.push(entry);
    }
    if (entries.length === 0) {
      throw new Error(
        'The auth token pool does not include any users in the conversation test user file.',
      );
    }
    return entries.sort(
      (left, right) =>
        getUserIndex(left.username) - getUserIndex(right.username),
    );
  },
);

export { baseUrl };

export function getConversationUserToken(maxVus) {
  if (!Number.isSafeInteger(maxVus) || maxVus < 1) {
    throw new Error(`maxVus must be a positive integer; received ${maxVus}.`);
  }

  if (exec.vu.idInTest > maxVus) {
    throw new Error(
      `VU ${exec.vu.idInTest} exceeds the configured profile maximum of ${maxVus} VUs.`,
    );
  }

  const tokenIndex = Math.floor(Math.random() * conversationTokenPool.length);
  return conversationTokenPool[tokenIndex];
}

export function getConversationUserTokenById(userId, username) {
  const userIndex = getUserIndex(username);
  const user = conversationUsers[userIndex];
  if (!user || user.id !== userId || user.username !== username) {
    throw new Error(
      `Conversation test user ID "${userId}" does not match username "${username}" in ${userDataPath}.`,
    );
  }

  let low = 0;
  let high = conversationTokenPool.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const entry = conversationTokenPool[middle];
    const entryIndex = getUserIndex(entry.username);
    if (entryIndex === userIndex) return entry;
    if (entryIndex < userIndex) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  throw new Error(
    `The auth token pool does not include conversation test user "${username}".`,
  );
}

export function getConversationUserForIteration(iteration) {
  if (!Number.isSafeInteger(iteration) || iteration < 0) {
    throw new Error(
      `iteration must be a non-negative integer; received ${iteration}.`,
    );
  }

  const user = conversationUsers[iteration % conversationUsers.length];
  return {
    user,
    token: getConversationUserTokenById(user.id, user.username),
  };
}

export function getUserForToken(entry) {
  const index = getUserIndex(entry.username);
  if (index < 0 || conversationUsers[index]?.username !== entry.username) {
    throw new Error(
      `Token-pool username "${entry.username}" is missing from ${userDataPath}.`,
    );
  }

  return conversationUsers[index];
}

export function getRandomConversationPair(entry) {
  const user = getUserForToken(entry);
  const userIndex = getUserIndex(entry.username);
  let otherUserIndex = Math.floor(
    Math.random() * (conversationUsers.length - 1),
  );
  if (otherUserIndex >= userIndex) otherUserIndex++;

  return {
    user,
    otherUser: conversationUsers[otherUserIndex],
  };
}

function getUserIndex(username) {
  const match = /^loadtest_user_(\d+)$/.exec(username);
  if (!match) return -1;

  const index = Number(match[1]) - 1;
  return Number.isSafeInteger(index) && index >= 0 && index < 11_000
    ? index
    : -1;
}

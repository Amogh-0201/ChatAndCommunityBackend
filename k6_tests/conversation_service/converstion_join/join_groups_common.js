import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import {
  baseUrl,
  getConversationUserToken,
  getUserForToken,
} from '../conversation_common.js';

const expectedJoinResponse = http.expectedStatuses(201, 409);
const expectedConflictMessages = new Set([
  'You already have a pending join request for this group',
  'Your join request has already been approved',
  'You are already a member of this group',
]);

const groupDataPath =
  __ENV.CONVERSATION_GROUPS_FILE ||
  '../../../scripts/.conversation-test-groups.json';
const groups = new SharedArray('conversation-join-groups', () => {
  const data = JSON.parse(open(groupDataPath));
  if (
    !data ||
    data.count !== 5_500 ||
    !Array.isArray(data.groups) ||
    data.groups.length !== 5_500 ||
    data.groups.some(
      (group) =>
        !group ||
        typeof group.id !== 'string' ||
        group.joinPolicy !== 'REQUEST',
    )
  ) {
    throw new Error(
      `Invalid conversation test group data file: ${groupDataPath}`,
    );
  }
  return data.groups;
});

export function joinGroup(maxVus) {
  const token = getConversationUserToken(maxVus);
  const user = getUserForToken(token);
  const group = groups[Math.floor(Math.random() * groups.length)];
  const response = http.post(
    `${baseUrl}/conversations/${encodeURIComponent(group.id)}/join`,
    null,
    {
      headers: { Authorization: `Bearer ${token.accessToken}` },
      tags: { endpoint: 'conversation_join_group' },
      responseCallback: expectedJoinResponse,
    },
  );

  let body;
  try {
    body = response.json();
  } catch {
    body = null;
  }

  const createdRequest =
    response.status === 201 &&
    body !== null &&
    typeof body === 'object' &&
    body.conversationId === group.id &&
    body.requesterId === user.id &&
    body.status === 'PENDING';
  const expectedConflict =
    response.status === 409 &&
    typeof body?.message === 'string' &&
    expectedConflictMessages.has(body.message);

  if (!createdRequest && !expectedConflict) {
    console.error(
      `Join-group failed for ${token.username}, group ${group.id}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `message=${body?.message || response.error || 'none'}`,
    );
  }

  check(response, {
    'join route creates a request or returns an expected conflict': () =>
      createdRequest || expectedConflict,
  });
}

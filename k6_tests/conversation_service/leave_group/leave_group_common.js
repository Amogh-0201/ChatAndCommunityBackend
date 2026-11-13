import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import {
  baseUrl,
  getConversationUserTokenById,
} from '../conversation_common.js';

const leaveGroupDataPath =
  __ENV.CONVERSATION_LEAVE_GROUPS_FILE ||
  '../../../scripts/.conversation-test-leave-groups.json';
const memberships = new SharedArray(
  'conversation-leave-group-memberships',
  () => {
    const data = JSON.parse(open(leaveGroupDataPath));
    if (
      !data ||
      data.complete !== true ||
      data.count !== 11_000 ||
      data.expectedUserCount !== 11_000 ||
      !Array.isArray(data.users) ||
      data.users.length !== 11_000 ||
      data.users.some(
        (user) =>
          !user ||
          typeof user.id !== 'string' ||
          typeof user.username !== 'string' ||
          !Array.isArray(user.groups),
      )
    ) {
      throw new Error(
        `Invalid or incomplete leave-group test data file: ${leaveGroupDataPath}`,
      );
    }

    const owners = [];
    const members = [];
    for (const user of data.users) {
      for (const group of user.groups) {
        if (
          !group ||
          typeof group.conversationId !== 'string' ||
          !['OWNER', 'MEMBER'].includes(group.role)
        ) {
          throw new Error(
            `Invalid group membership for ${user.username} in ${leaveGroupDataPath}.`,
          );
        }

        const membership = {
          userId: user.id,
          username: user.username,
          conversationId: group.conversationId,
          role: group.role,
        };
        if (group.role === 'OWNER') owners.push(membership);
        else members.push(membership);
      }
    }

    if (owners.length === 0) {
      throw new Error(
        `No owner memberships were found in ${leaveGroupDataPath}.`,
      );
    }
    if (data.membershipCount !== owners.length + members.length) {
      throw new Error(
        `Membership count does not match the data in ${leaveGroupDataPath}.`,
      );
    }

    return [...owners, ...members];
  },
);

let ownerCount = 0;
while (
  ownerCount < memberships.length &&
  memberships[ownerCount].role === 'OWNER'
) {
  ownerCount++;
}

const expectedStatuses = http.expectedStatuses(200, 403);
const ownerForbiddenMessage =
  'The group owner cannot leave the group. Transfer ownership or delete the group instead.';
const leaveSuccessMessage = 'You have successfully left the group';

export function leaveGroup() {
  const iteration = exec.scenario.iterationInTest;
  const pairIndex = Math.floor(iteration / 2);
  const membership =
    iteration % 2 === 0 || pairIndex >= memberships.length - ownerCount
      ? memberships[pairIndex % ownerCount]
      : memberships[ownerCount + pairIndex];
  const token = getConversationUserTokenById(
    membership.userId,
    membership.username,
  );
  const response = http.del(
    `${baseUrl}/conversations/${encodeURIComponent(membership.conversationId)}/leave`,
    null,
    {
      headers: { Authorization: `Bearer ${token.accessToken}` },
      tags: { endpoint: 'conversation_leave_group' },
      responseCallback: expectedStatuses,
    },
  );

  let body;
  try {
    body = response.json();
  } catch {
    body = null;
  }

  const leftGroup =
    response.status === 200 && body?.message === leaveSuccessMessage;
  const ownerCannotLeave =
    membership.role === 'OWNER' &&
    response.status === 403 &&
    body?.message === ownerForbiddenMessage;
  const expectedResponse = leftGroup || ownerCannotLeave;

  if (!expectedResponse) {
    console.error(
      `Leave-group failed for ${membership.username}, group ${membership.conversationId}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `message=${body?.message || response.error || 'none'}`,
    );
  }

  check(response, {
    'leave-group succeeds or returns the expected owner denial': () =>
      expectedResponse,
  });
}

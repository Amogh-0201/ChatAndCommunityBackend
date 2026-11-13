import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import {
  baseUrl,
  getConversationUserTokenById,
} from '../conversation_common.js';

const cancelRequestDataPath =
  __ENV.CONVERSATION_CANCEL_REQUESTS_FILE ||
  '../../../scripts/.conversation-test-cancel-requests.json';
const cancelRequests = new SharedArray(
  'conversation-cancel-join-requests',
  () => {
    const data = JSON.parse(open(cancelRequestDataPath));
    if (
      !data ||
      data.complete !== true ||
      data.count !== 5_500 ||
      data.expectedUserCount !== 5_500 ||
      data.requestCount !== 30_000 ||
      data.expectedRequestCount !== 30_000 ||
      !Array.isArray(data.users) ||
      data.users.length !== 5_500
    ) {
      throw new Error(
        `Invalid or incomplete cancel-join-request data file: ${cancelRequestDataPath}`,
      );
    }

    const requests = [];
    const userIds = new Set();
    const usernames = new Set();
    const requestKeys = new Set();
    for (const user of data.users) {
      const usernameMatch = /^loadtest_user_(\d+)$/.exec(user?.username);
      const userNumber = usernameMatch ? Number(usernameMatch[1]) : 0;
      if (
        !user ||
        typeof user.id !== 'string' ||
        !Number.isInteger(userNumber) ||
        userNumber < 5_501 ||
        userNumber > 11_000 ||
        userIds.has(user.id) ||
        usernames.has(user.username) ||
        !Array.isArray(user.requests)
      ) {
        throw new Error(`Invalid requester entry in ${cancelRequestDataPath}.`);
      }
      userIds.add(user.id);
      usernames.add(user.username);

      const userConversationIds = new Set();
      for (const request of user.requests) {
        if (
          !request ||
          typeof request.conversationId !== 'string' ||
          typeof request.requestId !== 'string' ||
          userConversationIds.has(request.conversationId) ||
          requestKeys.has(request.requestId)
        ) {
          throw new Error(
            `Invalid or duplicate join request for ${user.username} in ${cancelRequestDataPath}.`,
          );
        }
        userConversationIds.add(request.conversationId);
        requestKeys.add(request.requestId);
        requests.push({
          userId: user.id,
          username: user.username,
          conversationId: request.conversationId,
          requestId: request.requestId,
        });
      }
    }

    if (requests.length !== data.requestCount) {
      throw new Error(
        `Request count does not match the data file: ${cancelRequestDataPath}`,
      );
    }
    return requests;
  },
);
const expectedCancelStatuses = http.expectedStatuses(200, 409);
const alreadyCancelledMessage = 'Only pending join requests can be cancelled';

export function cancelJoinRequest() {
  const request =
    cancelRequests[exec.scenario.iterationInTest % cancelRequests.length];
  const token = getConversationUserTokenById(request.userId, request.username);
  const response = http.del(
    `${baseUrl}/conversations/${encodeURIComponent(request.conversationId)}/join-requests/me`,
    null,
    {
      headers: { Authorization: `Bearer ${token.accessToken}` },
      tags: { endpoint: 'conversation_cancel_join_request' },
      responseCallback: expectedCancelStatuses,
    },
  );

  let body;
  try {
    body = response.json();
  } catch {
    body = null;
  }

  const cancelled =
    response.status === 200 &&
    body !== null &&
    body.id === request.requestId &&
    body.status === 'CANCELLED';
  const alreadyCancelled =
    response.status === 409 && body?.message === alreadyCancelledMessage;

  if (!cancelled && !alreadyCancelled) {
    console.error(
      `Cancel-join-request failed for ${request.username}, ` +
        `group ${request.conversationId}, request ${request.requestId}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `message=${body?.message || response.error || 'none'}`,
    );
  }

  check(response, {
    'cancel-join-request succeeds or returns an already-cancelled conflict':
      () => cancelled || alreadyCancelled,
  });
}

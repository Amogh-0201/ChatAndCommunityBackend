import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import {
  baseUrl,
  getConversationUserTokenById,
} from '../conversation_common.js';

const joinRequestDataPath =
  __ENV.CONVERSATION_JOIN_REQUESTS_FILE ||
  '../../../scripts/.conversation-test-join-requests.json';
const joinRequests = new SharedArray(
  'conversation-review-join-requests',
  () => {
    const data = JSON.parse(open(joinRequestDataPath));
    if (
      !data ||
      data.count !== 5_500 ||
      !Number.isSafeInteger(data.joinRequestCount) ||
      data.joinRequestCount < 1 ||
      !Array.isArray(data.groups) ||
      data.groups.length !== 5_500 ||
      data.groups.some(
        (group) =>
          !group ||
          typeof group.id !== 'string' ||
          typeof group.ownerId !== 'string' ||
          typeof group.ownerUsername !== 'string' ||
          !Array.isArray(group.joinRequests) ||
          group.joinRequests.some(
            (request) =>
              !request ||
              typeof request.id !== 'string' ||
              typeof request.requesterId !== 'string' ||
              request.status !== 'PENDING',
          ),
      )
    ) {
      throw new Error(
        `Invalid conversation test join-request data file: ${joinRequestDataPath}`,
      );
    }

    const requests = data.groups.flatMap((group) =>
      group.joinRequests.map((request) => ({
        ...request,
        conversationId: group.id,
        ownerId: group.ownerId,
        ownerUsername: group.ownerUsername,
      })),
    );
    if (requests.length !== data.joinRequestCount) {
      throw new Error(
        `Join-request count does not match the data file: ${joinRequestDataPath}`,
      );
    }

    return requests;
  },
);
const expectedReviewStatuses = http.expectedStatuses(200, 409);

export function reviewConversationJoinRequest() {
  const request =
    joinRequests[exec.scenario.iterationInTest % joinRequests.length];
  const token = getConversationUserTokenById(
    request.ownerId,
    request.ownerUsername,
  );
  const action = Math.random() < 0.5 ? 'APPROVE' : 'REJECT';
  const expectedStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const response = http.patch(
    `${baseUrl}/conversations/${encodeURIComponent(request.conversationId)}` +
      `/join-requests/${encodeURIComponent(request.id)}`,
    JSON.stringify({ action }),
    {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      tags: { endpoint: 'conversation_review_join_request' },
      responseCallback: expectedReviewStatuses,
    },
  );

  let body;
  try {
    body = response.json();
  } catch {
    body = null;
  }

  const reviewed =
    response.status === 200 &&
    body !== null &&
    body.id === request.id &&
    body.conversationId === request.conversationId &&
    body.requesterId === request.requesterId &&
    body.reviewedById === request.ownerId &&
    body.status === expectedStatus;
  const alreadyReviewed =
    response.status === 409 &&
    body?.message === 'This join request has already been reviewed';

  if (!reviewed && !alreadyReviewed) {
    console.error(
      `Review-join-request failed for group ${request.conversationId}, ` +
        `request ${request.id}: HTTP ${response.status || 'no response'}; ` +
        `message=${body?.message || response.error || 'none'}`,
    );
  }

  check(response, {
    'review-join-request succeeds or returns an already-reviewed conflict':
      () => reviewed || alreadyReviewed,
  });
}

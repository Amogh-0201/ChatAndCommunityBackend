import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import {
  baseUrl,
  getConversationUserTokenById,
} from '../conversation_common.js';

const groupDataPath =
  __ENV.CONVERSATION_GROUPS_FILE ||
  '../../../scripts/.conversation-test-groups.json';
const groups = new SharedArray('conversation-join-request-groups', () => {
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
        typeof group.ownerId !== 'string' ||
        typeof group.ownerUsername !== 'string',
    )
  ) {
    throw new Error(
      `Invalid conversation test group data file: ${groupDataPath}`,
    );
  }
  return data.groups;
});

export function getConversationJoinRequests() {
  const groupIndex = exec.scenario.iterationInTest % groups.length;
  const group = groups[groupIndex];
  const token = getConversationUserTokenById(
    group.ownerId,
    group.ownerUsername,
  );
  const response = http.get(
    `${baseUrl}/conversations/${encodeURIComponent(group.id)}/join-requests`,
    {
      headers: { Authorization: `Bearer ${token.accessToken}` },
      tags: { endpoint: 'conversation_get_join_requests' },
    },
  );

  let body;
  try {
    body = response.json();
  } catch {
    body = null;
  }

  if (response.status !== 200) {
    console.error(
      `Get-join-requests failed for group ${group.id}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `error=${response.error || 'none'}`,
    );
  }

  check(response, {
    'get-join-requests returns a list for the group owner': () =>
      response.status === 200 && Array.isArray(body),
  });
}

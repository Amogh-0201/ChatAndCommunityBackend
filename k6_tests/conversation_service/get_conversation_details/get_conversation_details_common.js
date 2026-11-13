import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import {
  baseUrl,
  getConversationUserForIteration,
} from '../conversation_common.js';

const groupDataPath =
  __ENV.CONVERSATION_GROUPS_FILE ||
  '../../../scripts/.conversation-test-groups.json';
const groups = new SharedArray('conversation-detail-groups', () => {
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
        typeof group.ownerUsername !== 'string' ||
        typeof group.name !== 'string' ||
        group.joinPolicy !== 'REQUEST',
    )
  ) {
    throw new Error(
      `Invalid conversation test group data file: ${groupDataPath}`,
    );
  }
  return data.groups;
});

export function getConversationDetails() {
  const iteration = exec.scenario.iterationInTest;
  const group = groups[iteration % groups.length];
  const { user, token } = getConversationUserForIteration(iteration);
  const response = http.get(
    `${baseUrl}/conversations/${encodeURIComponent(group.id)}`,
    {
      headers: { Authorization: `Bearer ${token.accessToken}` },
      tags: { endpoint: 'conversation_get_details' },
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
      `Get-conversation-details failed for ${user.username}, ` +
        `group ${group.id}: HTTP ${response.status || 'no response'}; ` +
        `error=${response.error || 'none'}`,
    );
  }

  check(response, {
    'get-conversation-details returns the selected group': () =>
      response.status === 200 &&
      body !== null &&
      body.id === group.id &&
      body.type === 'GROUP' &&
      body.name === group.name &&
      body.createdById === group.ownerId &&
      body.joinPolicy === group.joinPolicy &&
      Array.isArray(body.members),
  });
}

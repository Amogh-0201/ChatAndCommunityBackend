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
const groups = new SharedArray('conversation-update-groups', () => {
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

export function updateGroup() {
  const group = groups[exec.scenario.iterationInTest % groups.length];
  const token = getConversationUserTokenById(
    group.ownerId,
    group.ownerUsername,
  );
  const response = http.patch(
    `${baseUrl}/conversations/${encodeURIComponent(group.id)}`,
    JSON.stringify({ name: group.name, joinPolicy: group.joinPolicy }),
    {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      tags: { endpoint: 'conversation_update_group' },
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
      `Update-group failed for ${group.ownerUsername}, group ${group.id}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `error=${response.error || 'none'}`,
    );
  }

  check(response, {
    'update-group keeps the selected group settings': () =>
      response.status === 200 &&
      body !== null &&
      body.id === group.id &&
      body.name === group.name &&
      body.joinPolicy === group.joinPolicy,
  });
}

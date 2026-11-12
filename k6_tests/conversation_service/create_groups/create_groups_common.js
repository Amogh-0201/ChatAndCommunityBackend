import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import {
  baseUrl,
  getConversationUserToken,
  getUserForToken,
} from '../conversation_common.js';

export function createGroup(maxVus) {
  const entry = getConversationUserToken(maxVus);
  const user = getUserForToken(entry);
  const name =
    `Conversation API Load Test ${entry.username} ` +
    `${exec.vu.idInTest}-${exec.vu.iterationInScenario}`;
  const response = http.post(
    `${baseUrl}/conversations/groups`,
    JSON.stringify({ name }),
    {
      headers: {
        Authorization: `Bearer ${entry.accessToken}`,
        'Content-Type': 'application/json',
      },
      tags: { endpoint: 'conversation_create_group' },
    },
  );

  let body;
  try {
    body = response.json();
  } catch {
    body = null;
  }

  if (response.status !== 201) {
    console.error(
      `Create-group failed for ${entry.username}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `error=${response.error || 'none'}`,
    );
  }

  check(response, {
    'group route creates a group owned by the authenticated user': () =>
      response.status === 201 &&
      body !== null &&
      typeof body === 'object' &&
      typeof body.id === 'string' &&
      body.type === 'GROUP' &&
      body.name === name &&
      body.createdById === user.id &&
      Array.isArray(body.members) &&
      body.members.length === 1 &&
      body.members[0].userId === user.id &&
      body.members[0].role === 'OWNER',
  });
}

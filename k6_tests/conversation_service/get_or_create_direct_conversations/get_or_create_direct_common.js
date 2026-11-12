import http from 'k6/http';
import { check } from 'k6';
import {
  baseUrl,
  getConversationUserToken,
  getRandomConversationPair,
} from '../conversation_common.js';

export function getOrCreateDirectConversation(maxVus) {
  const entry = getConversationUserToken(maxVus);
  const { user, otherUser } = getRandomConversationPair(entry);
  const response = http.post(
    `${baseUrl}/conversations/direct/${encodeURIComponent(otherUser.id)}`,
    null,
    {
      headers: { Authorization: `Bearer ${entry.accessToken}` },
      tags: { endpoint: 'conversation_get_or_create_direct' },
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
      `Get-or-create-direct failed for ${entry.username}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `error=${response.error || 'none'}`,
    );
  }

  check(response, {
    'direct route returns a conversation for both users': () =>
      response.status === 201 &&
      body !== null &&
      typeof body === 'object' &&
      typeof body.id === 'string' &&
      body.type === 'DIRECT' &&
      Array.isArray(body.members) &&
      body.members.length === 2 &&
      body.members.some((member) => member.userId === user.id) &&
      body.members.some((member) => member.userId === otherUser.id),
  });
}

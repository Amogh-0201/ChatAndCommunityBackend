import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import {
  baseUrl,
  getConversationUserForIteration,
} from '../conversation_common.js';

export function getMyConversations() {
  const { user, token } = getConversationUserForIteration(
    exec.scenario.iterationInTest,
  );
  const response = http.get(`${baseUrl}/conversations`, {
    headers: { Authorization: `Bearer ${token.accessToken}` },
    tags: { endpoint: 'conversation_get_my_conversations' },
  });

  let body;
  try {
    body = response.json();
  } catch {
    body = null;
  }

  if (response.status !== 200) {
    console.error(
      `Get-my-conversations failed for ${user.username}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `error=${response.error || 'none'}`,
    );
  }

  check(response, {
    'get-my-conversations returns a conversation list': () =>
      response.status === 200 &&
      Array.isArray(body) &&
      body.every(
        (conversation) =>
          conversation &&
          typeof conversation.id === 'string' &&
          typeof conversation.type === 'string',
      ),
  });
}

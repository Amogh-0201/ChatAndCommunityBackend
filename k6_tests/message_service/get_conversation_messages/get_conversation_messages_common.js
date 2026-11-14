import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import {
  baseUrl,
  getConversationUserTokenById,
} from '../../conversation_service/conversation_common.js';

const directDataPath =
  __ENV.CONVERSATION_DIRECT_FILE ||
  '../../../scripts/.conversation-test-direct.json';
const conversations = new SharedArray(
  'message-service-direct-conversations',
  () => {
    const data = JSON.parse(open(directDataPath));
    if (
      !data ||
      data.count !== 5_500 ||
      !Array.isArray(data.conversations) ||
      data.conversations.length !== 5_500 ||
      data.conversations.some(
        (conversation) =>
          !conversation ||
          typeof conversation.id !== 'string' ||
          conversation.type !== 'DIRECT' ||
          typeof conversation.userAId !== 'string' ||
          typeof conversation.userAUsername !== 'string' ||
          !Array.isArray(conversation.members) ||
          !conversation.members.some(
            (member) => member && member.userId === conversation.userAId,
          ),
      )
    ) {
      throw new Error(
        `Invalid direct conversation test data file: ${directDataPath}`,
      );
    }
    return data.conversations;
  },
);

const messageLimit = 50;

export function getConversationMessages() {
  const iteration = exec.scenario.iterationInTest;
  const conversation = conversations[iteration % conversations.length];
  const token = getConversationUserTokenById(
    conversation.userAId,
    conversation.userAUsername,
  );
  const response = http.get(
    `${baseUrl}/conversations/${encodeURIComponent(conversation.id)}/messages?limit=${messageLimit}`,
    {
      headers: { Authorization: `Bearer ${token.accessToken}` },
      tags: { endpoint: 'message_get_conversation_messages' },
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
      `Get-conversation-messages failed for ${conversation.userAUsername}, ` +
        `conversation ${conversation.id}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `error=${response.error || 'none'}`,
    );
  }

  check(response, {
    'get-conversation-messages returns a valid page': () =>
      response.status === 200 &&
      body !== null &&
      Array.isArray(body.messages) &&
      body.messages.length <= messageLimit &&
      body.messages.every(
        (message) =>
          message &&
          typeof message.id === 'string' &&
          typeof message.senderId === 'string' &&
          message.conversationId === conversation.id &&
          typeof message.content === 'string' &&
          typeof message.createdAt === 'string',
      ) &&
      typeof body.hasMore === 'boolean' &&
      (body.nextCursor === null || typeof body.nextCursor === 'string'),
  });
}

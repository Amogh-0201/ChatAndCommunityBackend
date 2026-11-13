import { reviewConversationJoinRequest } from './review_conversation_join_req_common.js';

export const options = {
  stages: [
    { duration: '15s', target: 450 },
    { duration: '15s', target: 450 },
  ],
};

export default function () {
  reviewConversationJoinRequest();
}

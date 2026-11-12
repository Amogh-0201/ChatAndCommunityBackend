import { getOrCreateDirectConversation } from './get_or_create_direct_common.js';

export const options = {
  stages: [
    { duration: '15s', target: 450 },
    { duration: '15s', target: 450 },
  ],
};

export default function () {
  getOrCreateDirectConversation(450);
}

import { getOrCreateDirectConversation } from './get_or_create_direct_common.js';

export const options = {
  stages: [
    { duration: '3s', target: 200 },
    { duration: '2s', target: 200 },
    { duration: '3s', target: 1000 },
    { duration: '2s', target: 1000 },
    { duration: '5s', target: 200 },
  ],
};

export default function () {
  getOrCreateDirectConversation(1000);
}

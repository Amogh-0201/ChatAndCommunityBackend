import { getOrCreateDirectConversation } from './get_or_create_direct_common.js';

export const options = {
  stages: [
    { duration: '5s', target: 100 },
    { duration: '2s', target: 100 },
    { duration: '5s', target: 200 },
    { duration: '5s', target: 400 },
    { duration: '3s', target: 400 },
    { duration: '5s', target: 800 },
    { duration: '5s', target: 800 },
    { duration: '10s', target: 200 },
  ],
};

export default function () {
  getOrCreateDirectConversation(800);
}

import { getMe } from './getme_common.js';

export const options = {
  stages: [
    { duration: '4s', target: 400 },
    { duration: '2s', target: 400 },
    { duration: '4s', target: 1500 },
    { duration: '2s', target: 1500 },
    { duration: '4s', target: 400 },
  ],
};

export default function () {
  getMe(1500);
}

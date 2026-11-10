import { getMe } from './getme_common.js';

export const options = {
  stages: [
    { duration: '5s', target: 200 },
    { duration: '5s', target: 200 },
    { duration: '5s', target: 400 },
    { duration: '5s', target: 400 },
    { duration: '10s', target: 900 },
    { duration: '5s', target: 900 },
    { duration: '5s', target: 400 },
    { duration: '2s', target: 400 },
    { duration: '5s', target: 200 },
  ],
};

export default function () {
  getMe(900);
}

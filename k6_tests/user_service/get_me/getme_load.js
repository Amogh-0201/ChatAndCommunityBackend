import { getMe } from './getme_common.js';

export const options = {
  stages: [
    { duration: '15s', target: 500 },
    { duration: '15s', target: 500 }
  ],
};

export default function () {
  getMe(500);
}

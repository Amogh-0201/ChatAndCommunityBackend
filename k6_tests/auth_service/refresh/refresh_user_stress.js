import { refreshUser } from './refresh_common.js';

export const options = {
  stages: [
    { duration: '5s', target: 100 },
    { duration: '5s', target: 200 },
    { duration: '5s', target: 400 },
    { duration: '5s', target: 600 },
    { duration: '5s', target: 100 },
  ],
};

export default function () {
  refreshUser(600);
}

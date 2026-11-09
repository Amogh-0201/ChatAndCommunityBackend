import { refreshUser } from './refresh_common.js';

export const options = {
  stages: [
    { duration: '5s', target: 100 },
    { duration: '2s', target: 1000 },
    { duration: '5s', target: 100 },
  ],
};

export default function () {
  refreshUser(1000);
}

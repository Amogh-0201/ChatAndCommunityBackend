import { findAllUsers } from './findall_common.js';

export const options = {
  stages: [
    { duration: '5s', target: 200 },
    { duration: '2s', target: 1000 },
    { duration: '5s', target: 200 },
  ],
};

export default function () {
  findAllUsers(1000);
}

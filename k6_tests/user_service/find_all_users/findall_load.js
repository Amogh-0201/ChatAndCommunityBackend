import { findAllUsers } from './findall_common.js';

export const options = {
  stages: [{ duration: '30s', target: 450 }],
};

export default function () {
  findAllUsers(450);
}

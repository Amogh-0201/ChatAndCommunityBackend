import { cancelJoinRequest } from './cancel_join_request_common.js';

export const options = {
  stages: [
    { duration: '3s', target: 200 },
    { duration: '2s', target: 200 },
    { duration: '3s', target: 1_000 },
    { duration: '2s', target: 1_000 },
    { duration: '5s', target: 200 },
  ],
};

export default function () {
  cancelJoinRequest();
}

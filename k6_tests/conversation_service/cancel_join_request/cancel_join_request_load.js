import { cancelJoinRequest } from './cancel_join_request_common.js';

export const options = {
  stages: [
    { duration: '15s', target: 450 },
    { duration: '15s', target: 450 },
  ],
};

export default function () {
  cancelJoinRequest();
}

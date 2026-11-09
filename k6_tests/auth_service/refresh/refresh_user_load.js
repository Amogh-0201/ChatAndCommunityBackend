import { refreshUser } from './refresh_common.js';

export const options = {
  stages: [{ duration: '30s', target: 200 }],
};

export default function () {
  refreshUser(200);
}

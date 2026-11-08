import { registerUser } from './register_common.js';

export const options = {
  stages: [
    { duration: '15s', target: 5 },
    { duration: '2s', target: 400 },
    { duration: '15s', target: 5 },
  ],
  /*thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
    checks: ['rate>0.95'],
  },*/
};

export default function () {
  registerUser('spike');
}
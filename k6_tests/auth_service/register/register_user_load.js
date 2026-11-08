import { registerUser } from './register_common.js';

export const options = {
  stages: [
    { duration: '30s', target: 50 }
  ],
  /*thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
    checks: ['rate>0.95'],
  },*/
};

export default function () {
  registerUser('load');
}
import { loginUser } from './login_common.js';

export const options = {
  stages: [
    { duration: '15s', target: 20 },
    { duration: '15s', target: 50 },
    { duration: '15s', target: 100 },
    { duration: '15s', target: 150 },
    { duration: '10s', target: 200 },
    { duration: '10s', target: 0 },
  ],
  /*thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
    checks: ['rate>0.95'],
  },*/
};

export default function () {
  loginUser();
}
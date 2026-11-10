import { runFindAllGetMeUpdateUserGetMe } from './findall_getme_updateuser_getme_common.js';

export const options = {
  stages: [
    { duration: '5s', target: 200 },
    { duration: '5s', target: 200 },
    { duration: '5s', target: 400 },
    { duration: '5s', target: 400 },
    { duration: '10s', target: 800 },
    { duration: '5s', target: 800 },
    { duration: '10s', target: 200 },
  ],
};

export default function () {
  runFindAllGetMeUpdateUserGetMe(800);
}

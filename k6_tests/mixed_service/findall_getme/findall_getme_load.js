import { runFindAllGetMe } from './findall_getme_common.js';

export const options = {
  stages: [
    { duration: '15s', target: 450 },
    { duration: '15s', target: 450 },
  ],
};

export default function () {
  runFindAllGetMe(450);
}

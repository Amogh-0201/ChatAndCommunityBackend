import { findAllUsers, getMe, getUserToken } from '../mixed_common.js';

const flowName = 'findall_getme';

export function runFindAllGetMe(maxVus) {
  const entry = getUserToken(maxVus);
  if (!findAllUsers(entry, flowName)) return;

  getMe(entry, flowName);
}

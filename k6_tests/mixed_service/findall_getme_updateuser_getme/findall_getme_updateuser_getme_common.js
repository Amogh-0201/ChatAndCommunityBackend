import {
  findAllUsers,
  getMe,
  getUserToken,
  updateUser,
} from '../mixed_common.js';

const flowName = 'findall_getme_updateuser_getme';

export function runFindAllGetMeUpdateUserGetMe(maxVus) {
  const entry = getUserToken(maxVus);
  if (!findAllUsers(entry, flowName)) return;

  const initialProfile = getMe(entry, flowName);
  if (!initialProfile) return;

  const updatedProfile = updateUser(entry, initialProfile, flowName);
  if (!updatedProfile) return;

  getMe(entry, flowName, updatedProfile);
}

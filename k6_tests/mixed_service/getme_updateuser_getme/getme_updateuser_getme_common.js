import { getMe, getUserToken, updateUser } from '../mixed_common.js';

const flowName = 'getme_updateuser_getme';

export function runGetMeUpdateUserGetMe(maxVus) {
  const entry = getUserToken(maxVus);
  const initialProfile = getMe(entry, flowName);
  if (!initialProfile) return;

  const updatedProfile = updateUser(entry, initialProfile, flowName);
  if (!updatedProfile) return;

  getMe(entry, flowName, updatedProfile);
}

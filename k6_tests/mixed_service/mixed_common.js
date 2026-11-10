import http from 'k6/http';
import { check } from 'k6';
import { baseUrl, getUserToken } from '../user_service/user_common.js';

const pageLimit = 50;

export { getUserToken };

export function getMe(entry, flowName, expectedProfile) {
  const response = http.get(`${baseUrl}/user/me`, {
    headers: { Authorization: `Bearer ${entry.accessToken}` },
    tags: { endpoint: 'user_get_me', flow: flowName },
  });
  const profile = parseResponse(response);
  const validProfile =
    response.status === 200 &&
    isProfile(profile) &&
    profile.username === entry.username &&
    (!expectedProfile ||
      (profile.id === expectedProfile.id &&
        profile.name === expectedProfile.name &&
        profile.username === expectedProfile.username &&
        profile.phoneNumber === expectedProfile.phoneNumber &&
        profile.createdAt === expectedProfile.createdAt));

  logFailure(response, entry.username, flowName, 'get-me');
  check(response, {
    [`${flowName}: get-me returns the expected profile`]: () => validProfile,
  });

  return validProfile ? profile : null;
}

export function updateUser(entry, profile, flowName) {
  const response = http.patch(
    `${baseUrl}/user`,
    JSON.stringify({ name: profile.name }),
    {
      headers: {
        Authorization: `Bearer ${entry.accessToken}`,
        'Content-Type': 'application/json',
      },
      tags: { endpoint: 'user_update', flow: flowName },
    },
  );
  const updatedProfile = parseResponse(response);
  const validUpdate =
    response.status === 200 &&
    isProfile(updatedProfile) &&
    updatedProfile.id === profile.id &&
    updatedProfile.name === profile.name &&
    updatedProfile.username === profile.username &&
    updatedProfile.phoneNumber === profile.phoneNumber &&
    updatedProfile.createdAt === profile.createdAt &&
    typeof updatedProfile.updatedAt === 'string';

  logFailure(response, entry.username, flowName, 'update-user');
  check(response, {
    [`${flowName}: update-user preserves the expected profile`]: () =>
      validUpdate,
  });

  return validUpdate ? updatedProfile : null;
}

export function findAllUsers(entry, flowName) {
  const response = http.get(`${baseUrl}/user?limit=${pageLimit}`, {
    headers: { Authorization: `Bearer ${entry.accessToken}` },
    tags: { endpoint: 'user_find_all', flow: flowName },
  });
  const body = parseResponse(response);
  const validPage =
    response.status === 200 &&
    Array.isArray(body?.data) &&
    body.data.length <= pageLimit &&
    typeof body?.meta?.totalUsers === 'number' &&
    body.meta.currentPage === 1 &&
    body.meta.limit === pageLimit &&
    typeof body.meta.totalPages === 'number' &&
    typeof body.meta.hasNextPage === 'boolean' &&
    body.meta.hasPreviousPage === false &&
    body.data.every(
      (user) =>
        user !== null &&
        typeof user === 'object' &&
        typeof user.id === 'string' &&
        typeof user.name === 'string' &&
        typeof user.username === 'string' &&
        user.username !== entry.username &&
        typeof user.createdAt === 'string',
    );

  logFailure(response, entry.username, flowName, 'find-all-users');
  check(response, {
    [`${flowName}: find-all-users returns a valid page excluding self`]: () =>
      validPage,
  });

  return validPage;
}

function isProfile(profile) {
  return (
    profile !== null &&
    typeof profile === 'object' &&
    typeof profile.id === 'string' &&
    typeof profile.name === 'string' &&
    typeof profile.username === 'string' &&
    typeof profile.phoneNumber === 'string' &&
    typeof profile.createdAt === 'string'
  );
}

function parseResponse(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}

function logFailure(response, username, flowName, operation) {
  if (response.status !== 200) {
    console.error(
      `${flowName} ${operation} failed for ${username}: ` +
        `HTTP ${response.status || 'no response'}; ` +
        `error=${response.error || 'none'}`,
    );
  }
}

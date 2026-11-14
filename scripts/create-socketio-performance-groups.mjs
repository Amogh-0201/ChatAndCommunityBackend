import path from 'node:path';
import {
  apiRequest,
  assertLocalApi,
  getTargetUsersByUsername,
  loadTokenPool,
  readJson,
  requireDatabaseConfirmation,
  testUsers,
  userDataPath,
  withFileLock,
  writeJsonAtomically,
} from './conversation-test-data.mjs';

const groupSizes = [2, 5, 10, 25, 50];
const groupFile = path.resolve(
  process.env.SOCKETIO_GROUP_FIXTURE_FILE ||
    'scripts/.socketio-performance-groups.json',
);

assertLocalApi();
requireDatabaseConfirmation();

await withFileLock(groupFile, async () => {
  const userData = await readJson(userDataPath);
  const usersByUsername = getTargetUsersByUsername(userData?.users);
  const tokensByUsername = await loadTokenPool();
  const existing = await readJson(groupFile);
  if (
    existing !== null &&
    (!Array.isArray(existing.groups) ||
      existing.groups.some(
        (group) =>
          !Number.isInteger(group?.size) ||
          typeof group?.id !== 'string' ||
          !Array.isArray(group?.members),
      ))
  ) {
    throw new Error(`Socket.IO group fixture data is invalid: ${groupFile}`);
  }

  const ownerUsername = testUsers[0].username;
  const owner = usersByUsername.get(ownerUsername);
  const ownerToken = tokensByUsername.get(ownerUsername)?.accessToken;
  if (!owner || !ownerToken) {
    throw new Error(
      `Missing user ID or token for group owner ${ownerUsername}.`,
    );
  }

  const groupBySize = new Map(
    (existing?.groups ?? []).map((group) => [group.size, group]),
  );
  const selectedUsers = groupSizes.map((size) =>
    testUsers.slice(0, size).map(({ username }) => {
      const user = usersByUsername.get(username);
      const token = tokensByUsername.get(username)?.accessToken;
      if (!user || !token) {
        throw new Error(`Missing user ID or token for ${username}.`);
      }
      return { id: user.id, username, token };
    }),
  );
  const save = () =>
    writeJsonAtomically(groupFile, {
      generatedAt: new Date().toISOString(),
      groupSizes,
      groups: groupSizes.map((size) => groupBySize.get(size)).filter(Boolean),
    });

  console.log(
    `Preparing OPEN Socket.IO groups with ${groupSizes.join(', ')} members; saving to ${groupFile}.`,
  );
  try {
    for (let sizeIndex = 0; sizeIndex < groupSizes.length; sizeIndex++) {
      const size = groupSizes[sizeIndex];
      let group = groupBySize.get(size);
      if (!group) {
        const created = await apiRequest('/conversations/groups', ownerToken, {
          method: 'POST',
          body: JSON.stringify({
            name: `Socket.IO Performance Group ${size}`,
            joinPolicy: 'OPEN',
          }),
        });
        if (
          typeof created?.id !== 'string' ||
          created.type !== 'GROUP' ||
          created.joinPolicy !== 'OPEN' ||
          created.createdById !== owner.id
        ) {
          throw new Error(
            `Creating the ${size}-member group returned an unexpected response.`,
          );
        }
        group = {
          size,
          id: created.id,
          name: created.name,
          type: 'GROUP',
          joinPolicy: 'OPEN',
          ownerId: owner.id,
          ownerUsername,
          members: [],
        };
        groupBySize.set(size, group);
        await save();
      }

      const detail = await apiRequest(
        `/conversations/${encodeURIComponent(group.id)}`,
        ownerToken,
      );
      if (
        detail?.id !== group.id ||
        detail.type !== 'GROUP' ||
        detail.joinPolicy !== 'OPEN' ||
        detail.createdById !== owner.id
      ) {
        throw new Error(
          `Existing fixture group ${group.id} is not the expected OPEN group owned by ${ownerUsername}.`,
        );
      }

      const joinedIds = new Set(
        Array.isArray(detail.members)
          ? detail.members.map((member) => member.userId)
          : [],
      );
      const members = selectedUsers[sizeIndex];
      if (!joinedIds.has(owner.id)) {
        throw new Error(`Owner is not a member of group ${group.id}.`);
      }

      for (const member of members) {
        if (!joinedIds.has(member.id)) {
          const joined = await apiRequest(
            `/conversations/${encodeURIComponent(group.id)}/join`,
            member.token,
            { method: 'POST' },
          );
          if (
            joined?.conversationId !== group.id ||
            joined?.userId !== member.id
          ) {
            throw new Error(
              `Joining ${member.username} to group ${group.id} returned an unexpected response.`,
            );
          }
          joinedIds.add(member.id);
        }
      }

      if (
        joinedIds.size !== size ||
        members.some((member) => !joinedIds.has(member.id))
      ) {
        throw new Error(
          `Group ${group.id} has ${joinedIds.size} members; expected exactly ${size}.`,
        );
      }
      group.members = members.map(({ id, username }) => ({
        userId: id,
        username,
      }));
      await save();
      console.log(`Prepared OPEN group ${size}/${size} members.`);
    }
  } finally {
    await save();
  }

  console.log(`Saved OPEN group fixtures to ${groupFile}.`);
});

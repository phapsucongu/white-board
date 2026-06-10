import { RoomRole } from '@prisma/client';
import type { PublicUser } from '../users/users.service';
import { PresenceService } from './presence.service';

function createUser(id: string): PublicUser {
  return {
    id,
    email: `${id}@example.com`,
    displayName: id,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z')
  };
}

describe('PresenceService', () => {
  it('tracks users per room and keeps a user present while one socket remains', () => {
    const presence = new PresenceService();
    const user = createUser('user-1');

    presence.addUser('room-a', user, 'socket-1', RoomRole.EDITOR);
    presence.addUser('room-a', user, 'socket-2', RoomRole.EDITOR);

    expect(presence.getUsers('room-a')).toMatchObject([
      {
        userId: 'user-1',
        email: 'user-1@example.com',
        role: RoomRole.EDITOR,
        socketIds: ['socket-1', 'socket-2']
      }
    ]);

    const firstUpdates = presence.removeSocket('socket-1');

    expect(firstUpdates).toHaveLength(1);
    expect(firstUpdates[0].users[0].socketIds).toEqual(['socket-2']);
    expect(presence.getUsers('room-a')).toHaveLength(1);

    const secondUpdates = presence.removeSocket('socket-2');

    expect(secondUpdates).toEqual([
      {
        roomId: 'room-a',
        users: []
      }
    ]);
    expect(presence.getUsers('room-a')).toEqual([]);
  });

  it('removes one socket from every room it joined', () => {
    const presence = new PresenceService();
    const user = createUser('user-1');

    presence.addUser('room-a', user, 'socket-1', RoomRole.OWNER);
    presence.addUser('room-b', user, 'socket-1', RoomRole.VIEWER);

    const updates = presence.removeSocket('socket-1');

    expect(updates.map((update) => update.roomId).sort()).toEqual(['room-a', 'room-b']);
    expect(presence.getUsers('room-a')).toEqual([]);
    expect(presence.getUsers('room-b')).toEqual([]);
  });
});

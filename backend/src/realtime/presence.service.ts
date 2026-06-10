import { Injectable } from '@nestjs/common';
import type { RoomRole } from '@prisma/client';
import type { PublicUser } from '../users/users.service';

export type PresenceUser = {
  userId: string;
  email: string;
  displayName: string | null;
  role: RoomRole;
  socketIds: string[];
  joinedAt: string;
};

type PresenceRecord = Omit<PresenceUser, 'socketIds'> & {
  socketIds: Set<string>;
};

@Injectable()
export class PresenceService {
  private readonly rooms = new Map<string, Map<string, PresenceRecord>>();

  addUser(roomId: string, user: PublicUser, socketId: string, role: RoomRole): PresenceUser[] {
    let roomPresence = this.rooms.get(roomId);

    if (!roomPresence) {
      roomPresence = new Map<string, PresenceRecord>();
      this.rooms.set(roomId, roomPresence);
    }

    const existing = roomPresence.get(user.id);

    if (existing) {
      existing.socketIds.add(socketId);
      existing.role = role;
    } else {
      roomPresence.set(user.id, {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        role,
        socketIds: new Set([socketId]),
        joinedAt: new Date().toISOString()
      });
    }

    return this.getUsers(roomId);
  }

  removeSocket(socketId: string): Array<{ roomId: string; users: PresenceUser[] }> {
    const updates: Array<{ roomId: string; users: PresenceUser[] }> = [];

    for (const [roomId, roomPresence] of this.rooms.entries()) {
      let changed = false;

      for (const [userId, user] of roomPresence.entries()) {
        if (!user.socketIds.delete(socketId)) {
          continue;
        }

        changed = true;

        if (user.socketIds.size === 0) {
          roomPresence.delete(userId);
        }
      }

      if (!changed) {
        continue;
      }

      if (roomPresence.size === 0) {
        this.rooms.delete(roomId);
      }

      updates.push({
        roomId,
        users: this.getUsers(roomId)
      });
    }

    return updates;
  }

  getUsers(roomId: string): PresenceUser[] {
    const roomPresence = this.rooms.get(roomId);

    if (!roomPresence) {
      return [];
    }

    return Array.from(roomPresence.values()).map((user) => ({
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      socketIds: Array.from(user.socketIds).sort(),
      joinedAt: user.joinedAt
    }));
  }
}

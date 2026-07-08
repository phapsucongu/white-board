import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Room, RoomMember, User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RoomRole } from '../permissions/room-role.enum';
import type { AddRoomMemberDto } from './dto/add-room-member.dto';
import type { CreateRoomDto } from './dto/create-room.dto';
import type { UpdateRoomMemberDto } from './dto/update-room-member.dto';
import type { UpdateRoomDto } from './dto/update-room.dto';

type RoomWithRole = Room & {
  role: RoomRole;
};

type RoomMemberWithUser = RoomMember & {
  user: Pick<User, 'id' | 'email' | 'displayName'>;
};

export type RoomMemberResponse = {
  userId: string;
  email: string;
  displayName: string | null;
  role: RoomRole;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async createRoom(userId: string, dto: CreateRoomDto): Promise<RoomWithRole> {
    const room = await this.prisma.$transaction(async (tx) => {
      const createdRoom = await tx.room.create({
        data: {
          name: dto.name.trim(),
          ownerId: userId,
          inviteCode: generateInviteCode()
        }
      });

      await tx.roomMember.create({
        data: {
          roomId: createdRoom.id,
          userId,
          role: RoomRole.OWNER
        }
      });

      await tx.boardState.create({
        data: {
          roomId: createdRoom.id,
          version: 0,
          snapshotJson: {
            objects: {}
          } satisfies Prisma.InputJsonValue
        }
      });

      return createdRoom;
    });

    return this.toRoomWithRole(room, RoomRole.OWNER);
  }

  async listRoomsForUser(userId: string): Promise<RoomWithRole[]> {
    const memberships = await this.prisma.roomMember.findMany({
      where: {
        userId
      },
      include: {
        room: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return memberships.map((membership) =>
      this.toRoomWithRole(membership.room, membership.role as RoomRole)
    );
  }

  async getRoomForMember(roomId: string, userId: string): Promise<RoomWithRole> {
    const membership = await this.prisma.roomMember.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId
        }
      },
      include: {
        room: true
      }
    });

    if (!membership) {
      throw new NotFoundException('Room not found');
    }

    return this.toRoomWithRole(membership.room, membership.role as RoomRole);
  }

  async joinByInviteCode(inviteCode: string, userId: string): Promise<RoomWithRole> {
    const room = await this.prisma.room.findFirst({
      where: { inviteCode }
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const existingMember = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId } }
    });

    if (existingMember) {
      return this.toRoomWithRole(room, existingMember.role as RoomRole);
    }

    await this.prisma.roomMember.create({
      data: { roomId: room.id, userId, role: RoomRole.VIEWER }
    });

    return this.toRoomWithRole(room, RoomRole.VIEWER);
  }

  async updateRoom(roomId: string, dto: UpdateRoomDto): Promise<Room> {
    return this.prisma.room.update({
      where: {
        id: roomId
      },
      data: {
        name: dto.name.trim()
      }
    });
  }

  async deleteRoom(roomId: string): Promise<{ success: true }> {
    await this.prisma.room.delete({
      where: {
        id: roomId
      }
    });

    return {
      success: true
    };
  }

  async listMembers(roomId: string): Promise<RoomMemberResponse[]> {
    const members = await this.prisma.roomMember.findMany({
      where: {
        roomId
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    return members.map((member) => this.toRoomMemberResponse(member as RoomMemberWithUser));
  }

  async addMember(roomId: string, dto: AddRoomMemberDto): Promise<RoomMemberResponse> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: dto.userId
      },
      select: {
        id: true,
        email: true,
        displayName: true
      }
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const existingMember = await this.prisma.roomMember.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId: dto.userId
        }
      }
    });

    if (existingMember) {
      throw new ConflictException('User is already a room member');
    }

    const member = await this.prisma.roomMember.create({
      data: {
        roomId,
        userId: dto.userId,
        role: dto.role
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true
          }
        }
      }
    });

    return this.toRoomMemberResponse(member as RoomMemberWithUser);
  }

  async updateMemberRole(
    roomId: string,
    targetUserId: string,
    currentUserId: string,
    dto: UpdateRoomMemberDto
  ): Promise<RoomMemberResponse> {
    if (targetUserId === currentUserId) {
      throw new BadRequestException('Ownership transfer is not implemented');
    }

    const existingMember = await this.prisma.roomMember.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId: targetUserId
        }
      }
    });

    if (!existingMember) {
      throw new NotFoundException('Room member not found');
    }

    const member = await this.prisma.roomMember.update({
      where: {
        roomId_userId: {
          roomId,
          userId: targetUserId
        }
      },
      data: {
        role: dto.role
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true
          }
        }
      }
    });

    return this.toRoomMemberResponse(member as RoomMemberWithUser);
  }

  async removeMember(
    roomId: string,
    targetUserId: string,
    currentUserId: string
  ): Promise<{ success: true }> {
    if (targetUserId === currentUserId) {
      throw new BadRequestException('Ownership transfer is required before removing yourself');
    }

    const existingMember = await this.prisma.roomMember.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId: targetUserId
        }
      }
    });

    if (!existingMember) {
      throw new NotFoundException('Room member not found');
    }

    await this.prisma.roomMember.delete({
      where: {
        roomId_userId: {
          roomId,
          userId: targetUserId
        }
      }
    });

    return {
      success: true
    };
  }

  private toRoomWithRole(room: Room, role: RoomRole): RoomWithRole {
    return {
      ...room,
      role
    };
  }

  private toRoomMemberResponse(member: RoomMemberWithUser): RoomMemberResponse {
    return {
      userId: member.user.id,
      email: member.user.email,
      displayName: member.user.displayName,
      role: member.role as RoomRole,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt
    };
  }
}

function generateInviteCode(): string {
  // 16 random bytes (128 bits) as a case-sensitive base64url string. The previous
  // 32-bit, uppercased, 8-char code was brute-forceable against the (unauthenticated
  // membership-granting) join route. Do NOT uppercase — that collapses the alphabet
  // and throws away entropy.
  return randomBytes(16).toString('base64url');
}

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { BoardState, Room, RoomMember, User } from '@prisma/client';
import { Prisma, RoomRole as PrismaRoomRole } from '@prisma/client';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardService } from '../board/board.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoomMemberGuard } from '../permissions/room-member.guard';
import { UsersService } from '../users/users.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

const jwtSecret = 'test-room-api-secret-with-enough-length';

type UserFindUniqueArgs = {
  where: {
    email?: string;
    id?: string;
  };
};

type RoomCreateArgs = {
  data: {
    name: string;
    ownerId: string;
  };
};

type RoomUpdateArgs = {
  where: {
    id: string;
  };
  data: {
    name: string;
  };
};

type RoomDeleteArgs = {
  where: {
    id: string;
  };
};

type RoomMemberCreateArgs = {
  data: {
    roomId: string;
    userId: string;
    role: PrismaRoomRole;
  };
  include?: {
    user?: {
      select: {
        id: boolean;
        email: boolean;
        displayName: boolean;
      };
    };
  };
};

type RoomMemberFindUniqueArgs = {
  where: {
    roomId_userId: {
      roomId: string;
      userId: string;
    };
  };
  include?: {
    room?: boolean;
    user?: {
      select: {
        id: boolean;
        email: boolean;
        displayName: boolean;
      };
    };
  };
  select?: {
    roomId?: boolean;
    role?: boolean;
  };
};

type RoomMemberFindManyArgs = {
  where: {
    roomId?: string;
    userId?: string;
  };
  include?: {
    room?: boolean;
    user?: {
      select: {
        id: boolean;
        email: boolean;
        displayName: boolean;
      };
    };
  };
  orderBy?: {
    createdAt: 'asc' | 'desc';
  };
};

type RoomMemberUpdateArgs = {
  where: {
    roomId_userId: {
      roomId: string;
      userId: string;
    };
  };
  data: {
    role: PrismaRoomRole;
  };
  include?: {
    user?: {
      select: {
        id: boolean;
        email: boolean;
        displayName: boolean;
      };
    };
  };
};

type RoomMemberDeleteArgs = {
  where: {
    roomId_userId: {
      roomId: string;
      userId: string;
    };
  };
};

type BoardStateCreateArgs = {
  data: {
    roomId: string;
    version: number;
    snapshotJson: Prisma.InputJsonValue;
  };
};

type BoardStateFindUniqueArgs = {
  where: {
    roomId: string;
  };
};

type RoomMemberWithRoom = RoomMember & {
  room: Room;
};

type RoomMemberWithUser = RoomMember & {
  user: Pick<User, 'id' | 'email' | 'displayName'>;
};

type PrismaMock = {
  user: {
    findUnique: jest.Mock<Promise<User | null>, [UserFindUniqueArgs]>;
  };
  room: {
    create: jest.Mock<Promise<Room>, [RoomCreateArgs]>;
    update: jest.Mock<Promise<Room>, [RoomUpdateArgs]>;
    delete: jest.Mock<Promise<Room>, [RoomDeleteArgs]>;
  };
  roomMember: {
    create: jest.Mock<Promise<RoomMember>, [RoomMemberCreateArgs]>;
    findUnique: jest.Mock<
      Promise<RoomMember | RoomMemberWithRoom | RoomMemberWithUser | null>,
      [RoomMemberFindUniqueArgs]
    >;
    findMany: jest.Mock<Promise<Array<RoomMemberWithRoom | RoomMemberWithUser>>, [RoomMemberFindManyArgs]>;
    update: jest.Mock<Promise<RoomMember>, [RoomMemberUpdateArgs]>;
    delete: jest.Mock<Promise<RoomMember>, [RoomMemberDeleteArgs]>;
  };
  boardState: {
    create: jest.Mock<Promise<BoardState>, [BoardStateCreateArgs]>;
    findUnique: jest.Mock<Promise<BoardState | null>, [BoardStateFindUniqueArgs]>;
  };
  $transaction: jest.Mock<Promise<Room>, [(tx: PrismaMock) => Promise<Room>]>;
  seedUser: (id: string, email: string) => User;
  seedRoom: (id: string, ownerId: string, name?: string) => Room;
  seedMembership: (roomId: string, userId: string, role: PrismaRoomRole) => RoomMember;
  seedBoardState: (
    roomId: string,
    version: number,
    snapshotJson: Prisma.InputJsonValue
  ) => BoardState;
};

function createPrismaMock(): PrismaMock {
  const users: User[] = [];
  const rooms: Room[] = [];
  const memberships: RoomMember[] = [];
  const boardStates: BoardState[] = [];
  let roomCount = 0;
  let membershipCount = 0;
  let boardStateCount = 0;

  const seedUser = (id: string, email: string): User => {
    const now = new Date();
    const user: User = {
      id,
      email,
      passwordHash: 'not-used',
      displayName: null,
      createdAt: now,
      updatedAt: now
    };

    users.push(user);

    return user;
  };

  const seedRoom = (id: string, ownerId: string, name = 'Seed Room'): Room => {
    const now = new Date();
    const room: Room = {
      id,
      name,
      ownerId,
      inviteCode: null,
      createdAt: now,
      updatedAt: now
    };

    rooms.push(room);

    return room;
  };

  const seedMembership = (roomId: string, userId: string, role: PrismaRoomRole): RoomMember => {
    membershipCount += 1;

    const now = new Date();
    const membership: RoomMember = {
      id: `membership-${membershipCount}`,
      roomId,
      userId,
      role,
      createdAt: now,
      updatedAt: now
    };

    memberships.push(membership);

    return membership;
  };

  const seedBoardState = (
    roomId: string,
    version: number,
    snapshotJson: Prisma.InputJsonValue
  ): BoardState => {
    boardStateCount += 1;

    const existingIndex = boardStates.findIndex((item) => item.roomId === roomId);
    const boardState: BoardState = {
      id: `board-state-${boardStateCount}`,
      roomId,
      version,
      snapshotJson: snapshotJson as Prisma.JsonValue,
      updatedAt: new Date('2026-06-10T00:00:00.000Z')
    };

    if (existingIndex >= 0) {
      boardStates[existingIndex] = boardState;
    } else {
      boardStates.push(boardState);
    }

    return boardState;
  };

  const prisma: PrismaMock = {
    user: {
      findUnique: jest.fn(async ({ where }: UserFindUniqueArgs) => {
        return users.find((user) => user.email === where.email || user.id === where.id) ?? null;
      })
    },
    room: {
      create: jest.fn(async ({ data }: RoomCreateArgs) => {
        roomCount += 1;

        return seedRoom(`room-${roomCount}`, data.ownerId, data.name);
      }),
      update: jest.fn(async ({ where, data }: RoomUpdateArgs) => {
        const room = rooms.find((item) => item.id === where.id);

        if (!room) {
          throw new Error('Room not found');
        }

        room.name = data.name;
        room.updatedAt = new Date();

        return room;
      }),
      delete: jest.fn(async ({ where }: RoomDeleteArgs) => {
        const roomIndex = rooms.findIndex((item) => item.id === where.id);

        if (roomIndex < 0) {
          throw new Error('Room not found');
        }

        const [room] = rooms.splice(roomIndex, 1);

        for (let index = memberships.length - 1; index >= 0; index -= 1) {
          if (memberships[index].roomId === where.id) {
            memberships.splice(index, 1);
          }
        }

        return room;
      })
    },
    roomMember: {
      create: jest.fn(async ({ data, include }: RoomMemberCreateArgs) => {
        const membership = seedMembership(data.roomId, data.userId, data.role);

        if (include?.user) {
          const user = users.find((item) => item.id === membership.userId);

          return user ? { ...membership, user } : membership;
        }

        return membership;
      }),
      findUnique: jest.fn(async ({ where, include, select }: RoomMemberFindUniqueArgs) => {
        const membership =
          memberships.find(
            (item) =>
              item.roomId === where.roomId_userId.roomId && item.userId === where.roomId_userId.userId
          ) ?? null;

        if (!membership) {
          return null;
        }

        if (include?.room) {
          const room = rooms.find((item) => item.id === membership.roomId);

          return room ? { ...membership, room } : null;
        }

        if (include?.user) {
          const user = users.find((item) => item.id === membership.userId);

          return user ? { ...membership, user } : null;
        }

        if (select?.roomId || select?.role) {
          return {
            ...membership,
            roomId: membership.roomId,
            role: membership.role
          };
        }

        return membership;
      }),
      findMany: jest.fn(async ({ where, include, orderBy }: RoomMemberFindManyArgs) => {
        const rows: Array<RoomMemberWithRoom | RoomMemberWithUser> = [];

        for (const membership of memberships) {
          if (
            (where.userId && membership.userId !== where.userId) ||
            (where.roomId && membership.roomId !== where.roomId)
          ) {
            continue;
          }

          const room = rooms.find((item) => item.id === membership.roomId);
          const user = users.find((item) => item.id === membership.userId);

          if (room && include?.room) {
            rows.push({ ...membership, room });
          }

          if (user && include?.user) {
            rows.push({
              ...membership,
              user: {
                id: user.id,
                email: user.email,
                displayName: user.displayName
              }
            });
          }
        }

        return orderBy?.createdAt === 'asc' ? rows : rows.reverse();
      }),
      update: jest.fn(async ({ where, data, include }: RoomMemberUpdateArgs) => {
        const membership = memberships.find(
          (item) =>
            item.roomId === where.roomId_userId.roomId && item.userId === where.roomId_userId.userId
        );

        if (!membership) {
          throw new Error('Membership not found');
        }

        membership.role = data.role;
        membership.updatedAt = new Date();

        if (include?.user) {
          const user = users.find((item) => item.id === membership.userId);

          return user ? { ...membership, user } : membership;
        }

        return membership;
      }),
      delete: jest.fn(async ({ where }: RoomMemberDeleteArgs) => {
        const membershipIndex = memberships.findIndex(
          (item) =>
            item.roomId === where.roomId_userId.roomId && item.userId === where.roomId_userId.userId
        );

        if (membershipIndex < 0) {
          throw new Error('Membership not found');
        }

        const [membership] = memberships.splice(membershipIndex, 1);

        return membership;
      })
    },
    boardState: {
      create: jest.fn(async ({ data }: BoardStateCreateArgs) => {
        return seedBoardState(data.roomId, data.version, data.snapshotJson);
      }),
      findUnique: jest.fn(async ({ where }: BoardStateFindUniqueArgs) => {
        return boardStates.find((item) => item.roomId === where.roomId) ?? null;
      })
    },
    $transaction: jest.fn((callback: (tx: PrismaMock) => Promise<Room>) => callback(prisma)),
    seedUser,
    seedRoom,
    seedMembership,
    seedBoardState
  };

  return prisma;
}

describe('RoomsController', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = createPrismaMock();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              JWT_ACCESS_SECRET: jwtSecret,
              JWT_ACCESS_TTL: '15m'
            })
          ]
        }),
        JwtModule.register({})
      ],
      controllers: [RoomsController],
      providers: [
        JwtAuthGuard,
        Reflector,
        RoomMemberGuard,
        BoardService,
        RoomsService,
        UsersService,
        {
          provide: PrismaService,
          useValue: prisma
        }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true
      })
    );
    jwt = moduleRef.get(JwtService);

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function seedUserWithToken(id: string, email: string): string {
    prisma.seedUser(id, email);

    return jwt.sign(
      {
        sub: id,
        email
      },
      {
        secret: jwtSecret,
        expiresIn: '15m'
      }
    );
  }

  it('creates a room and makes the current user owner', async () => {
    const ownerToken = seedUserWithToken('owner-1', 'owner@example.com');

    const response = await request(app.getHttpServer())
      .post('/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Planning Room'
      })
      .expect(201);

    expect(response.body).toMatchObject({
      id: 'room-1',
      name: 'Planning Room',
      ownerId: 'owner-1',
      role: PrismaRoomRole.OWNER
    });
    expect(prisma.roomMember.create).toHaveBeenCalledWith({
      data: {
        roomId: 'room-1',
        userId: 'owner-1',
        role: PrismaRoomRole.OWNER
      }
    });
    expect(prisma.boardState.create).toHaveBeenCalled();
  });

  it('lists rooms for the current member', async () => {
    const ownerToken = seedUserWithToken('owner-1', 'owner@example.com');
    prisma.seedRoom('room-a', 'owner-1', 'Alpha');
    prisma.seedRoom('room-b', 'owner-1', 'Beta');
    prisma.seedMembership('room-a', 'owner-1', PrismaRoomRole.OWNER);
    prisma.seedMembership('room-b', 'owner-1', PrismaRoomRole.EDITOR);

    const response = await request(app.getHttpServer())
      .get('/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(response.body).toHaveLength(2);
    expect(response.body.map((room: { name: string }) => room.name)).toEqual(['Beta', 'Alpha']);
  });

  it('allows owner, editor, and viewer to view room details', async () => {
    const ownerToken = seedUserWithToken('owner-1', 'owner@example.com');
    const editorToken = seedUserWithToken('editor-1', 'editor@example.com');
    const viewerToken = seedUserWithToken('viewer-1', 'viewer@example.com');
    prisma.seedRoom('room-a', 'owner-1', 'Alpha');
    prisma.seedMembership('room-a', 'owner-1', PrismaRoomRole.OWNER);
    prisma.seedMembership('room-a', 'editor-1', PrismaRoomRole.EDITOR);
    prisma.seedMembership('room-a', 'viewer-1', PrismaRoomRole.VIEWER);

    for (const token of [ownerToken, editorToken, viewerToken]) {
      await request(app.getHttpServer())
        .get('/rooms/room-a')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          expect(response.body.id).toBe('room-a');
        });
    }
  });

  it('allows owner, editor, and viewer to load the latest board snapshot', async () => {
    const ownerToken = seedUserWithToken('owner-1', 'owner@example.com');
    const editorToken = seedUserWithToken('editor-1', 'editor@example.com');
    const viewerToken = seedUserWithToken('viewer-1', 'viewer@example.com');
    prisma.seedRoom('room-a', 'owner-1', 'Alpha');
    prisma.seedMembership('room-a', 'owner-1', PrismaRoomRole.OWNER);
    prisma.seedMembership('room-a', 'editor-1', PrismaRoomRole.EDITOR);
    prisma.seedMembership('room-a', 'viewer-1', PrismaRoomRole.VIEWER);
    prisma.seedBoardState('room-a', 7, {
      objects: {
        'rect-1': {
          id: 'rect-1',
          roomId: 'room-a',
          type: 'rectangle',
          x: 12,
          y: 24,
          rotation: 0,
          version: 2,
          createdBy: 'owner-1',
          updatedBy: 'editor-1',
          createdAt: '2026-06-10T00:00:00.000Z',
          updatedAt: '2026-06-10T01:00:00.000Z',
          deleted: false,
          props: {
            width: 80,
            height: 40
          }
        }
      }
    });

    for (const token of [ownerToken, editorToken, viewerToken]) {
      await request(app.getHttpServer())
        .get('/rooms/room-a/board')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({
            roomId: 'room-a',
            version: 7,
            updatedAt: '2026-06-10T00:00:00.000Z',
            objects: {
              'rect-1': {
                id: 'rect-1',
                roomId: 'room-a',
                type: 'rectangle',
                x: 12,
                y: 24,
                props: {
                  width: 80,
                  height: 40
                }
              }
            }
          });
        });
    }
  });

  it('returns an empty board snapshot when a member room has no BoardState row', async () => {
    const ownerToken = seedUserWithToken('owner-1', 'owner@example.com');
    prisma.seedRoom('room-a', 'owner-1', 'Alpha');
    prisma.seedMembership('room-a', 'owner-1', PrismaRoomRole.OWNER);

    await request(app.getHttpServer())
      .get('/rooms/room-a/board')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)
      .expect({
        roomId: 'room-a',
        version: 0,
        objects: {},
        updatedAt: null
      });
  });

  it('prevents non-members from viewing private rooms', async () => {
    const outsiderToken = seedUserWithToken('outsider-1', 'outsider@example.com');
    prisma.seedUser('owner-1', 'owner@example.com');
    prisma.seedRoom('room-a', 'owner-1', 'Alpha');
    prisma.seedMembership('room-a', 'owner-1', PrismaRoomRole.OWNER);

    await request(app.getHttpServer())
      .get('/rooms/room-a')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);
  });

  it('prevents non-members from loading a private room board snapshot', async () => {
    const outsiderToken = seedUserWithToken('outsider-1', 'outsider@example.com');
    prisma.seedUser('owner-1', 'owner@example.com');
    prisma.seedRoom('room-a', 'owner-1', 'Alpha');
    prisma.seedMembership('room-a', 'owner-1', PrismaRoomRole.OWNER);

    await request(app.getHttpServer())
      .get('/rooms/room-a/board')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);
  });

  it('allows only owner to update a room', async () => {
    const ownerToken = seedUserWithToken('owner-1', 'owner@example.com');
    const editorToken = seedUserWithToken('editor-1', 'editor@example.com');
    const viewerToken = seedUserWithToken('viewer-1', 'viewer@example.com');
    const outsiderToken = seedUserWithToken('outsider-1', 'outsider@example.com');
    prisma.seedRoom('room-a', 'owner-1', 'Alpha');
    prisma.seedMembership('room-a', 'owner-1', PrismaRoomRole.OWNER);
    prisma.seedMembership('room-a', 'editor-1', PrismaRoomRole.EDITOR);
    prisma.seedMembership('room-a', 'viewer-1', PrismaRoomRole.VIEWER);

    await request(app.getHttpServer())
      .patch('/rooms/room-a')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Updated Alpha'
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.name).toBe('Updated Alpha');
      });

    await request(app.getHttpServer())
      .patch('/rooms/room-a')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        name: 'Editor Update'
      })
      .expect(403);

    await request(app.getHttpServer())
      .patch('/rooms/room-a')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        name: 'Viewer Update'
      })
      .expect(403);

    await request(app.getHttpServer())
      .patch('/rooms/room-a')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({
        name: 'Outsider Update'
      })
      .expect(404);
  });

  it('allows only owner to delete a room', async () => {
    const ownerToken = seedUserWithToken('owner-1', 'owner@example.com');
    const viewerToken = seedUserWithToken('viewer-1', 'viewer@example.com');
    prisma.seedRoom('room-a', 'owner-1', 'Alpha');
    prisma.seedMembership('room-a', 'owner-1', PrismaRoomRole.OWNER);
    prisma.seedMembership('room-a', 'viewer-1', PrismaRoomRole.VIEWER);

    await request(app.getHttpServer())
      .delete('/rooms/room-a')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete('/rooms/room-a')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)
      .expect({
        success: true
      });

    await request(app.getHttpServer())
      .get('/rooms/room-a')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });

  it('allows room members to list members', async () => {
    const ownerToken = seedUserWithToken('owner-1', 'owner@example.com');
    const viewerToken = seedUserWithToken('viewer-1', 'viewer@example.com');
    prisma.seedRoom('room-a', 'owner-1', 'Alpha');
    prisma.seedMembership('room-a', 'owner-1', PrismaRoomRole.OWNER);
    prisma.seedMembership('room-a', 'viewer-1', PrismaRoomRole.VIEWER);

    for (const token of [ownerToken, viewerToken]) {
      await request(app.getHttpServer())
        .get('/rooms/room-a/members')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toHaveLength(2);
          expect(response.body.map((member: { email: string }) => member.email)).toEqual([
            'owner@example.com',
            'viewer@example.com'
          ]);
          expect(response.body[0].passwordHash).toBeUndefined();
        });
    }
  });

  it('allows owner to add a member', async () => {
    const ownerToken = seedUserWithToken('owner-1', 'owner@example.com');
    prisma.seedUser('editor-1', 'editor@example.com');
    prisma.seedRoom('room-a', 'owner-1', 'Alpha');
    prisma.seedMembership('room-a', 'owner-1', PrismaRoomRole.OWNER);

    await request(app.getHttpServer())
      .post('/rooms/room-a/members')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        userId: 'editor-1',
        role: PrismaRoomRole.EDITOR
      })
      .expect(201)
      .expect((response) => {
        expect(response.body).toMatchObject({
          userId: 'editor-1',
          email: 'editor@example.com',
          role: PrismaRoomRole.EDITOR
        });
      });

    await request(app.getHttpServer())
      .get('/rooms/room-a/members')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.map((member: { userId: string }) => member.userId)).toContain(
          'editor-1'
        );
      });
  });

  it('prevents editor, viewer, and non-member from adding members', async () => {
    const editorToken = seedUserWithToken('editor-1', 'editor@example.com');
    const viewerToken = seedUserWithToken('viewer-1', 'viewer@example.com');
    const outsiderToken = seedUserWithToken('outsider-1', 'outsider@example.com');
    prisma.seedUser('owner-1', 'owner@example.com');
    prisma.seedUser('new-user-1', 'new-user@example.com');
    prisma.seedRoom('room-a', 'owner-1', 'Alpha');
    prisma.seedMembership('room-a', 'owner-1', PrismaRoomRole.OWNER);
    prisma.seedMembership('room-a', 'editor-1', PrismaRoomRole.EDITOR);
    prisma.seedMembership('room-a', 'viewer-1', PrismaRoomRole.VIEWER);

    for (const token of [editorToken, viewerToken]) {
      await request(app.getHttpServer())
        .post('/rooms/room-a/members')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: 'new-user-1',
          role: PrismaRoomRole.VIEWER
        })
        .expect(403);
    }

    await request(app.getHttpServer())
      .post('/rooms/room-a/members')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({
        userId: 'new-user-1',
        role: PrismaRoomRole.VIEWER
      })
      .expect(404);
  });

  it('allows owner to change member roles and persists the change', async () => {
    const ownerToken = seedUserWithToken('owner-1', 'owner@example.com');
    prisma.seedUser('viewer-1', 'viewer@example.com');
    prisma.seedRoom('room-a', 'owner-1', 'Alpha');
    prisma.seedMembership('room-a', 'owner-1', PrismaRoomRole.OWNER);
    prisma.seedMembership('room-a', 'viewer-1', PrismaRoomRole.VIEWER);

    await request(app.getHttpServer())
      .patch('/rooms/room-a/members/viewer-1')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        role: PrismaRoomRole.EDITOR
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.role).toBe(PrismaRoomRole.EDITOR);
      });

    await request(app.getHttpServer())
      .get('/rooms/room-a/members')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)
      .expect((response) => {
        const changedMember = response.body.find(
          (member: { userId: string }) => member.userId === 'viewer-1'
        );
        expect(changedMember.role).toBe(PrismaRoomRole.EDITOR);
      });
  });

  it('prevents owner from changing their own role without ownership transfer', async () => {
    const ownerToken = seedUserWithToken('owner-1', 'owner@example.com');
    prisma.seedRoom('room-a', 'owner-1', 'Alpha');
    prisma.seedMembership('room-a', 'owner-1', PrismaRoomRole.OWNER);

    await request(app.getHttpServer())
      .patch('/rooms/room-a/members/owner-1')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        role: PrismaRoomRole.VIEWER
      })
      .expect(400);
  });

  it('allows owner to remove a member but not themselves', async () => {
    const ownerToken = seedUserWithToken('owner-1', 'owner@example.com');
    prisma.seedUser('viewer-1', 'viewer@example.com');
    prisma.seedRoom('room-a', 'owner-1', 'Alpha');
    prisma.seedMembership('room-a', 'owner-1', PrismaRoomRole.OWNER);
    prisma.seedMembership('room-a', 'viewer-1', PrismaRoomRole.VIEWER);

    await request(app.getHttpServer())
      .delete('/rooms/room-a/members/viewer-1')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)
      .expect({
        success: true
      });

    await request(app.getHttpServer())
      .get('/rooms/room-a/members')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.map((member: { userId: string }) => member.userId)).not.toContain(
          'viewer-1'
        );
      });

    await request(app.getHttpServer())
      .delete('/rooms/room-a/members/owner-1')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
  });

  it('requires JWT auth for room APIs', async () => {
    await request(app.getHttpServer()).get('/rooms').expect(401);
  });
});

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { BoardEvent, BoardState, RoomMember, User, VersionTag } from '@prisma/client';
import { Prisma, RoomRole as PrismaRoomRole } from '@prisma/client';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoomMemberGuard } from '../permissions/room-member.guard';
import { BoardService } from '../board/board.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { VersionHistoryController } from './version-history.controller';
import { VersionHistoryService } from './version-history.service';

const jwtSecret = 'test-version-api-secret-with-enough-length';

type UserFindUniqueArgs = {
  where: {
    id?: string;
  };
};

type RoomMemberFindUniqueArgs = {
  where: {
    roomId_userId: {
      roomId: string;
      userId: string;
    };
  };
  select?: {
    roomId?: boolean;
    role?: boolean;
  };
};

type BoardStateFindUniqueArgs = {
  where: {
    roomId: string;
  };
  select?: {
    version?: boolean;
  };
};

type BoardEventFindManyArgs = {
  where: {
    roomId: string;
  };
  orderBy: {
    version: 'asc' | 'desc';
  };
  take?: number;
};

type BoardEventFindUniqueArgs = {
  where: {
    roomId_version: {
      roomId: string;
      version: number;
    };
  };
};

type VersionTagFindManyArgs = {
  where: {
    roomId: string;
    version?: number;
  };
  orderBy:
    | {
        createdAt: 'asc' | 'desc';
      }
    | Array<{
        version?: 'asc' | 'desc';
        createdAt?: 'asc' | 'desc';
      }>;
};

type VersionTagCreateArgs = {
  data: {
    roomId: string;
    version: number;
    label: string;
  };
};

type PrismaMock = {
  user: {
    findUnique: jest.Mock<Promise<User | null>, [UserFindUniqueArgs]>;
  };
  roomMember: {
    findUnique: jest.Mock<Promise<Pick<RoomMember, 'roomId' | 'role'> | null>, [RoomMemberFindUniqueArgs]>;
  };
  boardState: {
    findUnique: jest.Mock<Promise<Pick<BoardState, 'version'> | null>, [BoardStateFindUniqueArgs]>;
  };
  boardEvent: {
    findMany: jest.Mock<Promise<BoardEvent[]>, [BoardEventFindManyArgs]>;
    findUnique: jest.Mock<Promise<BoardEvent | null>, [BoardEventFindUniqueArgs]>;
  };
  versionTag: {
    create: jest.Mock<Promise<VersionTag>, [VersionTagCreateArgs]>;
    findMany: jest.Mock<Promise<VersionTag[]>, [VersionTagFindManyArgs]>;
  };
  seedUser: (id: string, email: string) => User;
  seedMembership: (roomId: string, userId: string, role: PrismaRoomRole) => RoomMember;
  seedBoardState: (roomId: string, version: number) => BoardState;
  seedBoardEvent: (roomId: string, version: number, actorId: string, eventType?: string) => BoardEvent;
  seedVersionTag: (roomId: string, version: number, label: string) => VersionTag;
};

function createPrismaMock(): PrismaMock {
  const users: User[] = [];
  const memberships: RoomMember[] = [];
  const boardStates: BoardState[] = [];
  const boardEvents: BoardEvent[] = [];
  const versionTags: VersionTag[] = [];
  let tagCount = 0;

  const seedUser = (id: string, email: string): User => {
    const now = new Date('2026-06-10T00:00:00.000Z');
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

  const seedMembership = (roomId: string, userId: string, role: PrismaRoomRole): RoomMember => {
    const now = new Date('2026-06-10T00:00:00.000Z');
    const membership: RoomMember = {
      id: `${roomId}-${userId}`,
      roomId,
      userId,
      role,
      createdAt: now,
      updatedAt: now
    };

    memberships.push(membership);

    return membership;
  };

  const seedBoardState = (roomId: string, version: number): BoardState => {
    const boardState: BoardState = {
      id: `board-state-${roomId}`,
      roomId,
      version,
      snapshotJson: {
        objects: {}
      } as Prisma.JsonValue,
      updatedAt: new Date('2026-06-10T00:00:00.000Z')
    };

    boardStates.push(boardState);

    return boardState;
  };

  const seedBoardEvent = (
    roomId: string,
    version: number,
    actorId: string,
    eventType = 'object:create'
  ): BoardEvent => {
    const event: BoardEvent = {
      id: `event-${roomId}-${version}`,
      roomId,
      version,
      eventType,
      payloadJson: {
        version
      } as Prisma.JsonValue,
      actorId,
      clientOpId: null,
      createdAt: new Date(`2026-06-10T00:00:0${version}.000Z`)
    };

    boardEvents.push(event);

    return event;
  };

  const seedVersionTag = (roomId: string, version: number, label: string): VersionTag => {
    tagCount += 1;

    const tag: VersionTag = {
      id: `tag-${tagCount}`,
      roomId,
      version,
      label,
      createdAt: new Date(`2026-06-10T00:01:0${tagCount}.000Z`)
    };

    versionTags.push(tag);

    return tag;
  };

  return {
    user: {
      findUnique: jest.fn(async ({ where }: UserFindUniqueArgs) => {
        return users.find((user) => user.id === where.id) ?? null;
      })
    },
    roomMember: {
      findUnique: jest.fn(async ({ where }: RoomMemberFindUniqueArgs) => {
        const membership =
          memberships.find(
            (item) =>
              item.roomId === where.roomId_userId.roomId && item.userId === where.roomId_userId.userId
          ) ?? null;

        return membership
          ? {
              roomId: membership.roomId,
              role: membership.role
            }
          : null;
      })
    },
    boardState: {
      findUnique: jest.fn(async ({ where }: BoardStateFindUniqueArgs) => {
        const boardState = boardStates.find((item) => item.roomId === where.roomId);

        return boardState
          ? {
              version: boardState.version
            }
          : null;
      })
    },
    boardEvent: {
      findMany: jest.fn(async ({ where, orderBy, take }: BoardEventFindManyArgs) => {
        const events = boardEvents.filter((event) => event.roomId === where.roomId);
        const sorted = events.sort((first, second) =>
          orderBy.version === 'desc'
            ? second.version - first.version
            : first.version - second.version
        );

        return typeof take === 'number' ? sorted.slice(0, take) : sorted;
      }),
      findUnique: jest.fn(async ({ where }: BoardEventFindUniqueArgs) => {
        return (
          boardEvents.find(
            (event) =>
              event.roomId === where.roomId_version.roomId &&
              event.version === where.roomId_version.version
          ) ?? null
        );
      })
    },
    versionTag: {
      create: jest.fn(async ({ data }: VersionTagCreateArgs) => {
        const duplicate = versionTags.some(
          (tag) =>
            tag.roomId === data.roomId && tag.version === data.version && tag.label === data.label
        );

        if (duplicate) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            clientVersion: 'test',
            code: 'P2002'
          });
        }

        return seedVersionTag(data.roomId, data.version, data.label);
      }),
      findMany: jest.fn(async ({ where, orderBy }: VersionTagFindManyArgs) => {
        const tags = versionTags.filter(
          (tag) =>
            tag.roomId === where.roomId &&
            (where.version === undefined || tag.version === where.version)
        );

        if (Array.isArray(orderBy)) {
          return tags.sort((first, second) => second.version - first.version);
        }

        return tags.sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime());
      })
    },
    seedUser,
    seedMembership,
    seedBoardState,
    seedBoardEvent,
    seedVersionTag
  };
}

describe('VersionHistoryController', () => {
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
      controllers: [VersionHistoryController],
      providers: [
        BoardService,
        JwtAuthGuard,
        Reflector,
        RoomMemberGuard,
        UsersService,
        VersionHistoryService,
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

  it('allows room members to list recent versions and tags', async () => {
    const viewerToken = seedUserWithToken('viewer-1', 'viewer@example.com');
    prisma.seedUser('actor-1', 'actor@example.com');
    prisma.seedMembership('room-a', 'viewer-1', PrismaRoomRole.VIEWER);
    prisma.seedBoardState('room-a', 2);
    prisma.seedBoardEvent('room-a', 1, 'actor-1');
    prisma.seedBoardEvent('room-a', 2, 'actor-1', 'object:update');
    prisma.seedVersionTag('room-a', 2, 'Checkpoint');

    const response = await request(app.getHttpServer())
      .get('/rooms/room-a/versions')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      roomId: 'room-a',
      currentVersion: 2,
      events: [
        {
          version: 2,
          eventType: 'object:update'
        },
        {
          version: 1,
          eventType: 'object:create'
        }
      ],
      tags: [
        {
          version: 2,
          label: 'Checkpoint'
        }
      ]
    });
  });

  it('allows owner and editor to create version tags', async () => {
    const ownerToken = seedUserWithToken('owner-1', 'owner@example.com');
    const editorToken = seedUserWithToken('editor-1', 'editor@example.com');
    prisma.seedMembership('room-a', 'owner-1', PrismaRoomRole.OWNER);
    prisma.seedMembership('room-a', 'editor-1', PrismaRoomRole.EDITOR);
    prisma.seedBoardState('room-a', 3);

    for (const [token, label] of [
      [ownerToken, 'Owner tag'],
      [editorToken, 'Editor tag']
    ]) {
      await request(app.getHttpServer())
        .post('/rooms/room-a/versions/tags')
        .set('Authorization', `Bearer ${token}`)
        .send({
          version: 3,
          label
        })
        .expect(201)
        .expect((response) => {
          expect(response.body).toMatchObject({
            roomId: 'room-a',
            version: 3,
            label
          });
        });
    }
  });

  it('prevents viewers and non-members from creating version tags', async () => {
    const viewerToken = seedUserWithToken('viewer-1', 'viewer@example.com');
    const outsiderToken = seedUserWithToken('outsider-1', 'outsider@example.com');
    prisma.seedMembership('room-a', 'viewer-1', PrismaRoomRole.VIEWER);
    prisma.seedBoardState('room-a', 1);

    await request(app.getHttpServer())
      .post('/rooms/room-a/versions/tags')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        version: 1,
        label: 'Nope'
      })
      .expect(403);

    await request(app.getHttpServer())
      .post('/rooms/room-a/versions/tags')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({
        version: 1,
        label: 'Nope'
      })
      .expect(404);
  });

  it('returns version details for room members', async () => {
    const editorToken = seedUserWithToken('editor-1', 'editor@example.com');
    prisma.seedUser('actor-1', 'actor@example.com');
    prisma.seedMembership('room-a', 'editor-1', PrismaRoomRole.EDITOR);
    prisma.seedBoardState('room-a', 2);
    prisma.seedBoardEvent('room-a', 2, 'actor-1', 'object:update');
    prisma.seedVersionTag('room-a', 2, 'Before review');

    const response = await request(app.getHttpServer())
      .get('/rooms/room-a/versions/2')
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      roomId: 'room-a',
      currentVersion: 2,
      version: 2,
      event: {
        version: 2,
        eventType: 'object:update',
        actorId: 'actor-1'
      },
      tags: [
        {
          version: 2,
          label: 'Before review'
        }
      ]
    });
  });

  it('rejects tags for versions newer than the board state', async () => {
    const editorToken = seedUserWithToken('editor-1', 'editor@example.com');
    prisma.seedMembership('room-a', 'editor-1', PrismaRoomRole.EDITOR);
    prisma.seedBoardState('room-a', 2);

    await request(app.getHttpServer())
      .post('/rooms/room-a/versions/tags')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        version: 3,
        label: 'Future'
      })
      .expect(400);
  });
});

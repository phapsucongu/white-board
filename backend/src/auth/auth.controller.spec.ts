import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { RefreshSession, User } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

type UserCreateArgs = {
  data: {
    email: string;
    passwordHash: string;
    displayName?: string | null;
  };
};

type UserFindUniqueArgs = {
  where: {
    email?: string;
    id?: string;
  };
};

type RefreshSessionCreateArgs = {
  data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  };
};

type RefreshSessionFindUniqueArgs = {
  where: {
    id: string;
  };
  include?: {
    user?: boolean;
  };
};

type RefreshSessionUpdateArgs = {
  where: {
    id: string;
  };
  data: {
    revokedAt?: Date;
  };
};

type RefreshSessionWithUser = RefreshSession & {
  user: User;
};

type PrismaMock = {
  user: {
    create: jest.Mock<Promise<User>, [UserCreateArgs]>;
    findUnique: jest.Mock<Promise<User | null>, [UserFindUniqueArgs]>;
  };
  refreshSession: {
    create: jest.Mock<Promise<RefreshSession>, [RefreshSessionCreateArgs]>;
    findUnique: jest.Mock<
      Promise<RefreshSession | RefreshSessionWithUser | null>,
      [RefreshSessionFindUniqueArgs]
    >;
    update: jest.Mock<Promise<RefreshSession>, [RefreshSessionUpdateArgs]>;
  };
  $transaction: jest.Mock<Promise<RefreshSession>, [(tx: PrismaMock) => Promise<RefreshSession>]>;
};

function createPrismaMock(): PrismaMock {
  const users: User[] = [];
  const refreshSessions: RefreshSession[] = [];
  let userCount = 0;
  let sessionCount = 0;

  const prisma: PrismaMock = {
    user: {
      create: jest.fn(async ({ data }: UserCreateArgs) => {
        userCount += 1;

        const now = new Date();
        const user: User = {
          id: `user-${userCount}`,
          email: data.email,
          passwordHash: data.passwordHash,
          displayName: data.displayName ?? null,
          createdAt: now,
          updatedAt: now
        };

        users.push(user);

        return user;
      }),
      findUnique: jest.fn(async ({ where }: UserFindUniqueArgs) => {
        return users.find((user) => user.email === where.email || user.id === where.id) ?? null;
      })
    },
    refreshSession: {
      create: jest.fn(async ({ data }: RefreshSessionCreateArgs) => {
        sessionCount += 1;

        const session: RefreshSession = {
          id: `session-${sessionCount}`,
          userId: data.userId,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          revokedAt: null,
          createdAt: new Date()
        };

        refreshSessions.push(session);

        return session;
      }),
      findUnique: jest.fn(async ({ where, include }: RefreshSessionFindUniqueArgs) => {
        const session = refreshSessions.find((item) => item.id === where.id) ?? null;

        if (!session || !include?.user) {
          return session;
        }

        const user = users.find((item) => item.id === session.userId);

        return user ? { ...session, user } : null;
      }),
      update: jest.fn(async ({ where, data }: RefreshSessionUpdateArgs) => {
        const session = refreshSessions.find((item) => item.id === where.id);

        if (!session) {
          throw new Error('Session not found');
        }

        if (data.revokedAt) {
          session.revokedAt = data.revokedAt;
        }

        return session;
      })
    },
    $transaction: jest.fn((callback: (tx: PrismaMock) => Promise<RefreshSession>) => callback(prisma))
  };

  return prisma;
}

describe('AuthController', () => {
  let app: INestApplication;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = createPrismaMock();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              JWT_ACCESS_SECRET: 'test-access-secret-with-enough-length',
              JWT_ACCESS_TTL: '15m',
              REFRESH_TOKEN_TTL_DAYS: '30'
            })
          ]
        }),
        JwtModule.register({})
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        JwtAuthGuard,
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

    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('registers a user without returning passwordHash', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'Alice@Example.com',
        password: 'StrongPassword#123',
        displayName: 'Alice'
      })
      .expect(201);

    expect(response.body).toMatchObject({
      id: 'user-1',
      email: 'alice@example.com',
      displayName: 'Alice'
    });
    expect(response.body.passwordHash).toBeUndefined();
  });

  it('logs in, returns tokens, rotates refresh tokens, revokes logout, and serves /auth/me', async () => {
    await request(app.getHttpServer()).post('/auth/register').send({
      email: 'alice@example.com',
      password: 'StrongPassword#123',
      displayName: 'Alice'
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'alice@example.com',
        password: 'StrongPassword#123'
      })
      .expect(201);

    expect(loginResponse.body.accessToken).toEqual(expect.any(String));
    expect(loginResponse.body.refreshToken).toEqual(expect.any(String));
    expect(loginResponse.body.user.email).toBe('alice@example.com');
    expect(loginResponse.body.user.passwordHash).toBeUndefined();

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.email).toBe('alice@example.com');
        expect(response.body.passwordHash).toBeUndefined();
      });

    const refreshResponse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken: loginResponse.body.refreshToken
      })
      .expect(201);

    expect(refreshResponse.body.accessToken).toEqual(expect.any(String));
    expect(refreshResponse.body.refreshToken).toEqual(expect.any(String));
    expect(refreshResponse.body.refreshToken).not.toBe(loginResponse.body.refreshToken);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken: loginResponse.body.refreshToken
      })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({
        refreshToken: refreshResponse.body.refreshToken
      })
      .expect(201)
      .expect({
        success: true
      });

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken: refreshResponse.body.refreshToken
      })
      .expect(401);
  });

  it('rejects unauthenticated /auth/me requests', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });
});

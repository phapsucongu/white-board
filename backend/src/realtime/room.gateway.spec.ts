import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RoomRole } from '@prisma/client';
import {
  BoardService,
  type ApplyBoardEventInput,
  type ApplyBoardEventResult,
  type BoardSyncResult
} from '../board/board.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PublicUser } from '../users/users.service';
import { UsersService } from '../users/users.service';
import { PresenceService } from './presence.service';
import { RoomGateway } from './room.gateway';

const jwtSecret = 'test-websocket-secret';

type GatewayClient = Parameters<RoomGateway['handleConnection']>[0];
type RoomJoinPayload = Parameters<RoomGateway['handleRoomJoin']>[1];
type BoardEventPayload = Parameters<RoomGateway['handleBoardEvent']>[1];

type RoomMemberFindUniqueArgs = {
  where: {
    roomId_userId: {
      roomId: string;
      userId: string;
    };
  };
  select: {
    role: true;
  };
};

type PrismaMock = {
  roomMember: {
    findUnique: jest.Mock<Promise<{ role: RoomRole } | null>, [RoomMemberFindUniqueArgs]>;
  };
};

type JwtMock = {
  verifyAsync: jest.Mock<Promise<{ sub: string; email: string }>, [string, { secret: string }]>;
};

type UsersMock = {
  findPublicById: jest.Mock<Promise<PublicUser | null>, [string]>;
};

type BoardMock = {
  applyBoardEvent: jest.Mock<Promise<ApplyBoardEventResult>, [ApplyBoardEventInput]>;
  getReconnectSync: jest.Mock<Promise<BoardSyncResult>, [string, number?]>;
};

type FakeClient = {
  client: GatewayClient;
  emit: jest.Mock<void, [string, unknown]>;
  join: jest.Mock<Promise<void>, [string]>;
  to: jest.Mock<{ emit: jest.Mock<void, [string, unknown]> }, [string]>;
  broadcastEmit: jest.Mock<void, [string, unknown]>;
  disconnect: jest.Mock<void, [boolean]>;
};

function createUser(id = 'user-1'): PublicUser {
  return {
    id,
    email: `${id}@example.com`,
    displayName: id,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z')
  };
}

function createClient(id = 'socket-1', token = 'token-1'): FakeClient {
  const emit = jest.fn<void, [string, unknown]>();
  const join = jest.fn<Promise<void>, [string]>(async () => undefined);
  const broadcastEmit = jest.fn<void, [string, unknown]>();
  const to = jest.fn<{ emit: jest.Mock<void, [string, unknown]> }, [string]>(() => ({
    emit: broadcastEmit
  }));
  const disconnect = jest.fn<void, [boolean]>();
  const client = {
    id,
    data: {},
    handshake: {
      auth: {
        token
      },
      headers: {}
    },
    emit,
    join,
    to,
    disconnect
  } as unknown as GatewayClient;

  return {
    client,
    emit,
    join,
    to,
    broadcastEmit,
    disconnect
  };
}

function createGateway() {
  const user = createUser();
  const board: BoardMock = {
    applyBoardEvent: jest.fn(async (input: ApplyBoardEventInput) => ({
      roomId: input.roomId,
      version: 1,
      eventType: input.eventType,
      payload: input.payload,
      actorId: input.actorId,
      snapshot: {
        objects: {}
      }
    })),
    getReconnectSync: jest.fn<Promise<BoardSyncResult>, [string, number?]>(async () => ({
      syncMode: 'delta',
      missedEvents: [],
      currentVersion: 0
    }))
  };
  const config = new ConfigService({
    JWT_ACCESS_SECRET: jwtSecret
  });
  const jwt: JwtMock = {
    verifyAsync: jest.fn<Promise<{ sub: string; email: string }>, [string, { secret: string }]>(async () => ({
      sub: user.id,
      email: user.email
    }))
  };
  const prisma: PrismaMock = {
    roomMember: {
      findUnique: jest.fn<Promise<{ role: RoomRole } | null>, [RoomMemberFindUniqueArgs]>(async () => ({
        role: RoomRole.EDITOR
      }))
    }
  };
  const users: UsersMock = {
    findPublicById: jest.fn<Promise<PublicUser | null>, [string]>(async () => user)
  };
  const presence = new PresenceService();
  const gateway = new RoomGateway(
    board as unknown as BoardService,
    config,
    jwt as unknown as JwtService,
    prisma as unknown as PrismaService,
    presence,
    users as unknown as UsersService
  );
  const roomEmit = jest.fn<void, [string, unknown]>();
  const to = jest.fn<{ emit: jest.Mock<void, [string, unknown]> }, [string]>(() => ({
    emit: roomEmit
  }));

  Object.defineProperty(gateway, 'server', {
    value: {
      to
    }
  });

  return {
    board,
    gateway,
    jwt,
    prisma,
    roomEmit,
    to,
    user,
    users
  };
}

describe('RoomGateway', () => {
  it('authenticates a socket and lets a room member join', async () => {
    const { board, gateway, prisma, roomEmit, to, users } = createGateway();
    const { client, emit, join } = createClient();

    await gateway.handleConnection(client);
    const result = await gateway.handleRoomJoin(client, {
      roomId: 'room-a',
      lastKnownVersion: 0
    } satisfies RoomJoinPayload);

    expect(users.findPublicById).toHaveBeenCalledWith('user-1');
    expect(prisma.roomMember.findUnique).toHaveBeenCalledWith({
      where: {
        roomId_userId: {
          roomId: 'room-a',
          userId: 'user-1'
        }
      },
      select: {
        role: true
      }
    });
    expect(join).toHaveBeenCalledWith('room:room-a');
    expect(board.getReconnectSync).toHaveBeenCalledWith('room-a', 0);
    expect(emit).toHaveBeenCalledWith('room:joined', {
      roomId: 'room-a',
      role: RoomRole.EDITOR,
      syncMode: 'delta',
      missedEvents: [],
      currentVersion: 0,
      users: [
        expect.objectContaining({
          userId: 'user-1',
          role: RoomRole.EDITOR,
          socketIds: ['socket-1']
        })
      ]
    });
    expect(to).toHaveBeenCalledWith('room:room-a');
    expect(roomEmit).toHaveBeenCalledWith('presence:update', {
      roomId: 'room-a',
      users: [
        expect.objectContaining({
          userId: 'user-1',
          role: RoomRole.EDITOR
        })
      ]
    });
    expect(result).toMatchObject({
      roomId: 'room-a',
      role: RoomRole.EDITOR,
      syncMode: 'delta',
      currentVersion: 0
    });
  });

  it('sends snapshot sync details when joining with an old version', async () => {
    const { board, gateway } = createGateway();
    const { client, emit } = createClient();
    board.getReconnectSync.mockResolvedValueOnce({
      syncMode: 'snapshot',
      snapshot: {
        objects: {}
      },
      currentVersion: 80
    });

    await gateway.handleConnection(client);
    await gateway.handleRoomJoin(client, {
      roomId: 'room-a',
      lastKnownVersion: 10
    });

    expect(board.getReconnectSync).toHaveBeenCalledWith('room-a', 10);
    expect(emit).toHaveBeenCalledWith('room:joined', {
      roomId: 'room-a',
      role: RoomRole.EDITOR,
      users: [
        expect.objectContaining({
          userId: 'user-1'
        })
      ],
      syncMode: 'snapshot',
      snapshot: {
        objects: {}
      },
      currentVersion: 80
    });
  });

  it('rejects room join for non-members', async () => {
    const { gateway, prisma } = createGateway();
    const { client, emit, join } = createClient();
    prisma.roomMember.findUnique.mockResolvedValueOnce(null);

    await gateway.handleConnection(client);
    await gateway.handleRoomJoin(client, {
      roomId: 'room-a'
    });

    expect(join).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('error', {
      code: 'FORBIDDEN',
      message: 'Room membership required'
    });
  });

  it('emits presence updates when joined sockets disconnect', async () => {
    const { gateway, roomEmit } = createGateway();
    const first = createClient('socket-1');
    const second = createClient('socket-2');

    await gateway.handleConnection(first.client);
    await gateway.handleRoomJoin(first.client, {
      roomId: 'room-a'
    });
    await gateway.handleConnection(second.client);
    await gateway.handleRoomJoin(second.client, {
      roomId: 'room-a'
    });

    gateway.handleDisconnect(first.client);

    expect(roomEmit).toHaveBeenLastCalledWith('presence:update', {
      roomId: 'room-a',
      users: [
        expect.objectContaining({
          socketIds: ['socket-2'],
          userId: 'user-1'
        })
      ]
    });
  });

  it('disconnects unauthenticated sockets', async () => {
    const { gateway, jwt } = createGateway();
    const { client, disconnect, emit } = createClient();
    jwt.verifyAsync.mockRejectedValueOnce(new Error('bad token'));

    await gateway.handleConnection(client);

    expect(disconnect).toHaveBeenCalledWith(true);
    expect(emit).toHaveBeenCalledWith('error', {
      code: 'UNAUTHORIZED',
      message: 'Authentication required'
    });
  });

  it('rejects join payloads without roomId', async () => {
    const { gateway } = createGateway();
    const { client, emit, join } = createClient();

    await gateway.handleConnection(client);
    await gateway.handleRoomJoin(client, {});

    expect(join).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('error', {
      code: 'VALIDATION_ERROR',
      message: 'roomId is required'
    });
  });

  it('accepts and broadcasts editor board events after persistence', async () => {
    const { board, gateway } = createGateway();
    const { client, emit, to, broadcastEmit } = createClient();
    const boardEventPayload = {
      roomId: 'room-a',
      eventType: 'object:create',
      baseVersion: 0,
      payload: {
        object: {
          id: 'object-1',
          type: 'rectangle',
          x: 10,
          y: 20
        }
      }
    } satisfies BoardEventPayload;

    await gateway.handleConnection(client);
    const result = await gateway.handleBoardEvent(client, boardEventPayload);

    expect(board.applyBoardEvent).toHaveBeenCalledWith({
      roomId: 'room-a',
      actorId: 'user-1',
      eventType: 'object:create',
      baseVersion: 0,
      payload: boardEventPayload.payload
    });
    expect(emit).toHaveBeenCalledWith('board:event:accepted', {
      roomId: 'room-a',
      version: 1,
      eventType: 'object:create',
      payload: boardEventPayload.payload,
      actorId: 'user-1',
      serverTime: expect.any(String)
    });
    expect(to).toHaveBeenCalledWith('room:room-a');
    expect(broadcastEmit).toHaveBeenCalledWith('board:event:broadcast', {
      roomId: 'room-a',
      version: 1,
      eventType: 'object:create',
      payload: boardEventPayload.payload,
      actorId: 'user-1',
      serverTime: expect.any(String)
    });
    expect(result).toMatchObject({
      roomId: 'room-a',
      version: 1,
      eventType: 'object:create',
      actorId: 'user-1'
    });
  });

  it('allows owners to mutate the board', async () => {
    const { board, gateway, prisma } = createGateway();
    const { client, emit } = createClient();
    prisma.roomMember.findUnique.mockResolvedValueOnce({
      role: RoomRole.OWNER
    });

    await gateway.handleConnection(client);
    await gateway.handleBoardEvent(client, {
      roomId: 'room-a',
      eventType: 'object:delete',
      payload: {
        objectId: 'object-1'
      }
    });

    expect(board.applyBoardEvent).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'board:event:accepted',
      expect.objectContaining({
        eventType: 'object:delete'
      })
    );
  });

  it('rejects viewer board mutations', async () => {
    const { board, gateway, prisma } = createGateway();
    const { client, emit, to } = createClient();
    prisma.roomMember.findUnique.mockResolvedValueOnce({
      role: RoomRole.VIEWER
    });

    await gateway.handleConnection(client);
    await gateway.handleBoardEvent(client, {
      roomId: 'room-a',
      eventType: 'object:create',
      payload: {
        object: {
          id: 'object-1',
          type: 'rectangle',
          x: 10,
          y: 20
        }
      }
    });

    expect(board.applyBoardEvent).not.toHaveBeenCalled();
    expect(to).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('board:event:rejected', {
      roomId: 'room-a',
      eventType: 'object:create',
      reason: 'FORBIDDEN',
      message: 'Editor role is required'
    });
  });

  it('rejects board events from non-members', async () => {
    const { board, gateway, prisma } = createGateway();
    const { client, emit } = createClient();
    prisma.roomMember.findUnique.mockResolvedValueOnce(null);

    await gateway.handleConnection(client);
    await gateway.handleBoardEvent(client, {
      roomId: 'room-a',
      eventType: 'object:update',
      payload: {
        objectId: 'object-1',
        patch: {
          x: 30
        }
      }
    });

    expect(board.applyBoardEvent).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('board:event:rejected', {
      roomId: 'room-a',
      eventType: 'object:update',
      reason: 'FORBIDDEN',
      message: 'Room membership required'
    });
  });
});

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from '@nestjs/websockets';
import { RoomRole } from '@prisma/client';
import type { Server, Socket } from 'socket.io';
import type { AccessTokenPayload } from '../auth/types';
import {
  BOARD_EVENT_TYPES,
  BoardService,
  type ApplyBoardEventInput,
  type BoardEventType,
  type BoardSyncResult
} from '../board/board.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PublicUser } from '../users/users.service';
import { UsersService } from '../users/users.service';
import { PresenceService, type PresenceUser } from './presence.service';

type RoomJoinPayload = {
  roomId?: unknown;
  lastKnownVersion?: unknown;
};

type BoardEventRequestPayload = {
  roomId?: unknown;
  eventType?: unknown;
  payload?: unknown;
  baseVersion?: unknown;
  clientOpId?: unknown;
};

type AuthenticatedSocketData = {
  user?: PublicUser;
};

type AuthenticatedSocket = Socket & {
  data: AuthenticatedSocketData;
};

type RoomJoinedPayload = {
  roomId: string;
  role: RoomRole;
  users: PresenceUser[];
} & BoardSyncResult;

type PresenceUpdatePayload = {
  roomId: string;
  users: PresenceUser[];
};

type BoardEventAcceptedPayload = {
  roomId: string;
  version: number;
  eventType: BoardEventType;
  payload: ApplyBoardEventInput['payload'];
  actorId: string;
  serverTime: string;
};

type BoardEventRejectedPayload = {
  roomId?: string;
  eventType?: BoardEventType;
  reason: 'UNAUTHORIZED' | 'FORBIDDEN' | 'VALIDATION_ERROR' | 'VERSION_CONFLICT' | 'NOT_FOUND';
  message: string;
};

type SocketErrorPayload = {
  code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'VALIDATION_ERROR';
  message: string;
};

const defaultSocketCorsOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function getSocketCorsOrigins(): string[] | boolean {
  const configuredOrigin = process.env.CORS_ORIGIN;

  if (!configuredOrigin) {
    return defaultSocketCorsOrigins;
  }

  const origins = configuredOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : true;
}

@WebSocketGateway({
  cors: {
    origin: getSocketCorsOrigins()
  }
})
export class RoomGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly boardService: BoardService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly usersService: UsersService
  ) {}

  afterInit(server: Server): void {
    server.use(async (client, next) => {
      try {
        const user = await this.authenticateSocket(client as AuthenticatedSocket);
        (client as AuthenticatedSocket).data.user = user;
        next();
      } catch {
        next(new Error('Authentication required'));
      }
    });
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    if (client.data.user) {
      return;
    }

    // Unit tests call lifecycle handlers directly, so keep this fallback outside Socket.IO middleware.
    // Real clients are authenticated in afterInit before receiving the connect event.
    await this.authenticateSocket(client)
      .then((user) => {
        client.data.user = user;
      })
      .catch(() => {
        this.rejectConnection(client);
      });
  }

  private async authenticateSocket(client: AuthenticatedSocket): Promise<PublicUser> {
    const token = this.extractToken(client);

    if (!token) {
      throw new Error('Authentication required');
    }

    const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.getAccessSecret()
    });
    const user = await this.usersService.findPublicById(payload.sub);

    if (!user) {
      throw new Error('Authentication required');
    }

    return user;
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    const updates = this.presence.removeSocket(client.id);

    for (const update of updates) {
      this.emitPresenceUpdate(update.roomId, update.users);
    }
  }

  @SubscribeMessage('room:join')
  async handleRoomJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: RoomJoinPayload
  ): Promise<RoomJoinedPayload | void> {
    const user = client.data.user;

    if (!user) {
      this.emitError(client, 'UNAUTHORIZED', 'Authentication required');
      return;
    }

    const roomId = this.parseRoomId(payload);

    if (!roomId) {
      this.emitError(client, 'VALIDATION_ERROR', 'roomId is required');
      return;
    }

    let lastKnownVersion: number | undefined;

    try {
      lastKnownVersion = this.parseLastKnownVersion(payload.lastKnownVersion);
    } catch (error) {
      this.emitError(
        client,
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'lastKnownVersion must be a number'
      );
      return;
    }

    const membership = await this.prisma.roomMember.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId: user.id
        }
      },
      select: {
        role: true
      }
    });

    if (!membership) {
      this.emitError(client, 'FORBIDDEN', 'Room membership required');
      return;
    }

    await client.join(this.getRoomChannel(roomId));

    const users = this.presence.addUser(roomId, user, client.id, membership.role);
    const sync = await this.boardService.getReconnectSync(roomId, lastKnownVersion);
    const joinedPayload: RoomJoinedPayload = {
      roomId,
      role: membership.role,
      users,
      ...sync
    };

    client.emit('room:joined', joinedPayload);
    this.emitPresenceUpdate(roomId, users);

    return joinedPayload;
  }

  @SubscribeMessage('board:event')
  async handleBoardEvent(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: BoardEventRequestPayload
  ): Promise<BoardEventAcceptedPayload | void> {
    const user = client.data.user;
    const roomId = this.parseRoomId(payload);
    const eventType = this.parseBoardEventType(payload);

    if (!user) {
      this.emitBoardEventRejected(client, {
        roomId: roomId ?? undefined,
        eventType: eventType ?? undefined,
        reason: 'UNAUTHORIZED',
        message: 'Authentication required'
      });
      return;
    }

    if (!roomId || !eventType) {
      this.emitBoardEventRejected(client, {
        roomId: roomId ?? undefined,
        eventType: eventType ?? undefined,
        reason: 'VALIDATION_ERROR',
        message: 'roomId and supported eventType are required'
      });
      return;
    }

    const membership = await this.getRoomMembership(roomId, user.id);

    if (!membership) {
      this.emitBoardEventRejected(client, {
        roomId,
        eventType,
        reason: 'FORBIDDEN',
        message: 'Room membership required'
      });
      return;
    }

    if (!this.canMutateBoard(membership.role)) {
      this.emitBoardEventRejected(client, {
        roomId,
        eventType,
        reason: 'FORBIDDEN',
        message: 'Editor role is required'
      });
      return;
    }

    try {
      const result = await this.boardService.applyBoardEvent({
        roomId,
        actorId: user.id,
        eventType,
        payload: payload.payload as ApplyBoardEventInput['payload'],
        baseVersion: this.parseBaseVersion(payload.baseVersion),
        clientOpId: typeof payload.clientOpId === 'string' ? payload.clientOpId : undefined
      });
      const acceptedPayload: BoardEventAcceptedPayload = {
        roomId: result.roomId,
        version: result.version,
        eventType: result.eventType,
        payload: result.payload,
        actorId: result.actorId,
        serverTime: new Date().toISOString()
      };

      client.emit('board:event:accepted', acceptedPayload);
      client.to(this.getRoomChannel(roomId)).emit('board:event:broadcast', acceptedPayload);

      return acceptedPayload;
    } catch (error) {
      this.emitBoardEventRejected(client, {
        roomId,
        eventType,
        reason: this.getBoardEventRejectionReason(error),
        message: error instanceof HttpException ? error.message : 'Board event rejected'
      });
    }
  }

  @SubscribeMessage('shape:preview')
  handleShapePreview(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { roomId?: unknown; objectId?: unknown; transform?: unknown }
  ): void {
    const user = client.data.user;
    if (!user) return;

    const roomId = typeof payload?.roomId === 'string' ? payload.roomId : null;
    const objectId = typeof payload?.objectId === 'string' ? payload.objectId : null;
    const transform = typeof payload?.transform === 'object' && payload.transform !== null
      ? payload.transform as Record<string, unknown>
      : null;

    if (!roomId || !objectId || !transform) return;

    // Broadcast preview to everyone in the room except sender
    client.to(this.getRoomChannel(roomId)).emit('shape:preview', {
      roomId,
      objectId,
      transform,
      byUser: { id: user.id, displayName: user.displayName }
    });
  }

  private rejectConnection(client: AuthenticatedSocket): void {
    this.emitError(client, 'UNAUTHORIZED', 'Authentication required');
    client.disconnect(true);
  }

  private emitPresenceUpdate(roomId: string, users: PresenceUser[]): void {
    const payload: PresenceUpdatePayload = {
      roomId,
      users
    };

    this.server.to(this.getRoomChannel(roomId)).emit('presence:update', payload);
  }

  private emitError(
    client: AuthenticatedSocket,
    code: SocketErrorPayload['code'],
    message: string
  ): void {
    client.emit('error', {
      code,
      message
    } satisfies SocketErrorPayload);
  }

  private emitBoardEventRejected(
    client: AuthenticatedSocket,
    payload: BoardEventRejectedPayload
  ): void {
    client.emit('board:event:rejected', payload);
  }

  private async getRoomMembership(
    roomId: string,
    userId: string
  ): Promise<{ role: RoomRole } | null> {
    return this.prisma.roomMember.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId
        }
      },
      select: {
        role: true
      }
    });
  }

  private extractToken(client: AuthenticatedSocket): string | null {
    const auth = client.handshake.auth as Record<string, unknown>;
    const authToken = auth.token;

    if (typeof authToken === 'string') {
      return this.stripBearerPrefix(authToken);
    }

    const authorization = client.handshake.headers.authorization;

    if (typeof authorization === 'string') {
      return this.stripBearerPrefix(authorization);
    }

    return null;
  }

  private stripBearerPrefix(value: string): string {
    const [scheme, token] = value.split(' ');

    if (scheme?.toLowerCase() === 'bearer' && token) {
      return token;
    }

    return value;
  }

  private parseRoomId(payload: RoomJoinPayload): string | null {
    return typeof payload?.roomId === 'string' && payload.roomId.trim()
      ? payload.roomId.trim()
      : null;
  }

  private parseBoardEventType(payload: BoardEventRequestPayload): BoardEventType | null {
    return typeof payload?.eventType === 'string' &&
      BOARD_EVENT_TYPES.includes(payload.eventType as BoardEventType)
      ? (payload.eventType as BoardEventType)
      : null;
  }

  private parseBaseVersion(baseVersion: unknown): number | undefined {
    if (baseVersion === undefined) {
      return undefined;
    }

    if (typeof baseVersion !== 'number') {
      throw new BadRequestException('baseVersion must be a number');
    }

    return baseVersion;
  }

  private parseLastKnownVersion(lastKnownVersion: unknown): number | undefined {
    if (lastKnownVersion === undefined) {
      return undefined;
    }

    if (typeof lastKnownVersion !== 'number') {
      throw new BadRequestException('lastKnownVersion must be a number');
    }

    return lastKnownVersion;
  }

  private canMutateBoard(role: RoomRole): boolean {
    return role === RoomRole.OWNER || role === RoomRole.EDITOR;
  }

  private getBoardEventRejectionReason(error: unknown): BoardEventRejectedPayload['reason'] {
    if (error instanceof ConflictException) {
      return 'VERSION_CONFLICT';
    }

    if (error instanceof NotFoundException) {
      return 'NOT_FOUND';
    }

    return 'VALIDATION_ERROR';
  }

  private getRoomChannel(roomId: string): string {
    return `room:${roomId}`;
  }

  private getAccessSecret(): string {
    return this.config.get<string>('JWT_ACCESS_SECRET') ?? 'dev-access-secret-change-me';
  }
}

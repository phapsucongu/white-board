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
import { CollaborationService, type CursorPosition } from '../collaboration/collaboration.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PublicUser } from '../users/users.service';
import { UsersService } from '../users/users.service';
import { PresenceService, type PresenceUser } from './presence.service';
import { RealtimeRoomEventsService } from './realtime-room-events.service';

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

type CursorUpdatePayload = {
  roomId?: unknown;
  position?: unknown;
};

type SelectionUpdatePayload = {
  roomId?: unknown;
  objectIds?: unknown;
  mode?: unknown;
};

type TextObjectPayload = {
  roomId?: unknown;
  objectId?: unknown;
};

type TextYjsUpdatePayload = TextObjectPayload & {
  updateBase64?: unknown;
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
  clientOpId?: string;
};

type BoardEventRejectedPayload = {
  roomId?: string;
  eventType?: BoardEventType;
  reason: 'UNAUTHORIZED' | 'FORBIDDEN' | 'VALIDATION_ERROR' | 'VERSION_CONFLICT' | 'NOT_FOUND' | 'TEXT_LEASE_CONFLICT';
  message: string;
  clientOpId?: string;
  details?: unknown;
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
    private readonly collaboration: CollaborationService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly roomEvents: RealtimeRoomEventsService,
    private readonly usersService: UsersService
  ) {}

  afterInit(server: Server): void {
    this.collaboration.attachSocketAdapter(server);
    this.roomEvents.attachServer(server);

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
    const cursor = this.collaboration.removeSocket(client.id);
    if (cursor) {
      this.server.to(this.getRoomChannel(cursor.roomId)).emit('cursor:remove', {
        roomId: cursor.roomId,
        userId: cursor.userId,
        socketId: cursor.socketId
      });
    }

    const selection = this.collaboration.removeObjectSelection(client.id);
    if (selection) {
      this.server.to(this.getRoomChannel(selection.roomId)).emit('selection:remove', {
        roomId: selection.roomId,
        userId: selection.userId,
        socketId: selection.socketId
      });
    }

    for (const lease of this.collaboration.removeTextLeasesForSocket(client.id)) {
      this.server.to(this.getRoomChannel(lease.roomId)).emit('text:lease:update', {
        roomId: lease.roomId,
        objectId: lease.objectId,
        lease: null
      });
    }

    const updates = this.presence.removeSocket(client.id);

    for (const update of updates) {
      this.emitPresenceUpdate(update.roomId, update.users);
    }
  }

  @SubscribeMessage('selection:update')
  async handleSelectionUpdate(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: SelectionUpdatePayload
  ): Promise<void> {
    const user = client.data.user;
    const roomId = this.parseRoomId(payload);
    const objectIds = this.parseObjectIds(payload.objectIds);
    const mode = this.parseSelectionMode(payload.mode);

    if (!user || !roomId || !mode) {
      return;
    }

    const membership = await this.getRoomMembership(roomId, user.id);
    if (!membership) {
      return;
    }

    if (objectIds.length === 0) {
      const removed = this.collaboration.removeObjectSelection(client.id);
      client.to(this.getRoomChannel(roomId)).emit('selection:remove', {
        roomId,
        userId: removed?.userId ?? user.id,
        socketId: client.id
      });
      return;
    }

    const selection = this.collaboration.recordObjectSelection({
      roomId,
      userId: user.id,
      displayName: user.displayName,
      socketId: client.id,
      objectIds,
      mode
    });

    client.to(this.getRoomChannel(roomId)).emit('selection:broadcast', selection);
  }

  @SubscribeMessage('cursor:update')
  async handleCursorUpdate(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: CursorUpdatePayload
  ): Promise<void> {
    const user = client.data.user;
    const roomId = this.parseRoomId(payload);
    const position = this.parseCursorPosition(payload.position);

    if (!user || !roomId || !position) {
      return;
    }

    const membership = await this.getRoomMembership(roomId, user.id);
    if (!membership) {
      return;
    }

    const cursor = this.collaboration.recordCursor({
      roomId,
      userId: user.id,
      displayName: user.displayName,
      socketId: client.id,
      position
    });

    client.to(this.getRoomChannel(roomId)).emit('cursor:broadcast', cursor);
  }

  @SubscribeMessage('text:lease:claim')
  async handleTextLeaseClaim(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: TextObjectPayload
  ): Promise<void> {
    const user = client.data.user;
    const roomId = this.parseRoomId(payload);
    const objectId = this.parseObjectId(payload.objectId);

    if (!user || !roomId || !objectId) {
      return;
    }

    const membership = await this.getRoomMembership(roomId, user.id);
    if (!membership || !this.canMutateBoard(membership.role)) {
      return;
    }

    const result = this.collaboration.claimTextLease({
      roomId,
      objectId,
      userId: user.id,
      displayName: user.displayName,
      socketId: client.id
    });

    if (!result.acquired) {
      client.emit('text:lease:denied', {
        roomId,
        objectId,
        lease: result.lease,
        message: `${result.lease.displayName || result.lease.userId} is editing this text`
      });
      client.emit('text:lease:update', result.lease);
      return;
    }

    this.server.to(this.getRoomChannel(roomId)).emit('text:lease:update', result.lease);
  }

  @SubscribeMessage('text:lease:release')
  async handleTextLeaseRelease(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: TextObjectPayload
  ): Promise<void> {
    const user = client.data.user;
    const roomId = this.parseRoomId(payload);
    const objectId = this.parseObjectId(payload.objectId);

    if (!user || !roomId || !objectId) {
      return;
    }

    const lease = this.collaboration.releaseTextLease(roomId, objectId, user.id);
    this.server.to(this.getRoomChannel(roomId)).emit('text:lease:update', {
      roomId,
      objectId,
      lease
    });
  }

  @SubscribeMessage('text:yjs:update')
  async handleTextYjsUpdate(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: TextYjsUpdatePayload
  ): Promise<void> {
    const user = client.data.user;
    const roomId = this.parseRoomId(payload);
    const objectId = this.parseObjectId(payload.objectId);
    const updateBase64 = typeof payload.updateBase64 === 'string' ? payload.updateBase64 : null;

    if (!user || !roomId || !objectId || !updateBase64) {
      return;
    }

    const membership = await this.getRoomMembership(roomId, user.id);
    if (!membership || !this.canMutateBoard(membership.role)) {
      return;
    }

    try {
      const result = await this.collaboration.applyTextUpdate({
        roomId,
        objectId,
        actorId: user.id,
        updateBase64
      });
      const serverTime = new Date().toISOString();
      const textPayload = {
        roomId,
        objectId,
        actorId: user.id,
        updateBase64,
        stateBase64: result.stateBase64,
        text: result.text,
        serverTime
      };
      const boardPayload: BoardEventAcceptedPayload = {
        roomId: result.boardEvent.roomId,
        version: result.boardEvent.version,
        eventType: result.boardEvent.eventType,
        payload: result.boardEvent.payload,
        actorId: result.boardEvent.actorId,
        serverTime,
        ...(result.boardEvent.clientOpId ? { clientOpId: result.boardEvent.clientOpId } : {})
      };

      client.emit('text:yjs:accepted', textPayload);
      client.to(this.getRoomChannel(roomId)).emit('text:yjs:broadcast', textPayload);
      client.emit('board:event:accepted', boardPayload);
      client.to(this.getRoomChannel(roomId)).emit('board:event:broadcast', boardPayload);
    } catch (error) {
      this.emitBoardEventRejected(client, {
        roomId,
        eventType: 'object:update',
        reason: this.getBoardEventRejectionReason(error),
        message: this.getHttpExceptionMessage(error, 'Text update rejected'),
        ...(this.getHttpExceptionDetails(error) ? { details: this.getHttpExceptionDetails(error) } : {})
      });
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
    const clientOpId = this.parseClientOpId(payload.clientOpId);

    if (!user) {
      this.emitBoardEventRejected(client, {
        roomId: roomId ?? undefined,
        eventType: eventType ?? undefined,
        reason: 'UNAUTHORIZED',
        message: 'Authentication required',
        ...(clientOpId ? { clientOpId } : {})
      });
      return;
    }

    if (!roomId || !eventType) {
      this.emitBoardEventRejected(client, {
        roomId: roomId ?? undefined,
        eventType: eventType ?? undefined,
        reason: 'VALIDATION_ERROR',
        message: 'roomId and supported eventType are required',
        ...(clientOpId ? { clientOpId } : {})
      });
      return;
    }

    const membership = await this.getRoomMembership(roomId, user.id);

    if (!membership) {
      this.emitBoardEventRejected(client, {
        roomId,
        eventType,
        reason: 'FORBIDDEN',
        message: 'Room membership required',
        ...(clientOpId ? { clientOpId } : {})
      });
      return;
    }

    if (!this.canMutateBoard(membership.role)) {
      this.emitBoardEventRejected(client, {
        roomId,
        eventType,
        reason: 'FORBIDDEN',
        message: 'Editor role is required',
        ...(clientOpId ? { clientOpId } : {})
      });
      return;
    }

    try {
      const eventInput: ApplyBoardEventInput = {
        roomId,
        actorId: user.id,
        eventType,
        payload: payload.payload as ApplyBoardEventInput['payload'],
        baseVersion: this.parseBaseVersion(payload.baseVersion)
      };

      if (clientOpId) {
        eventInput.clientOpId = clientOpId;
      }

      const result = await this.boardService.applyBoardEvent(eventInput);
      const acceptedPayload: BoardEventAcceptedPayload = {
        roomId: result.roomId,
        version: result.version,
        eventType: result.eventType,
        payload: result.payload,
        actorId: result.actorId,
        serverTime: new Date().toISOString(),
        ...(result.clientOpId ? { clientOpId: result.clientOpId } : {})
      };

      client.emit('board:event:accepted', acceptedPayload);
      client.to(this.getRoomChannel(roomId)).emit('board:event:broadcast', acceptedPayload);

      return acceptedPayload;
    } catch (error) {
      const details = this.getHttpExceptionDetails(error);

      this.emitBoardEventRejected(client, {
        roomId,
        eventType,
        reason: this.getBoardEventRejectionReason(error),
        message: this.getHttpExceptionMessage(error, 'Board event rejected'),
        ...(clientOpId ? { clientOpId } : {}),
        ...(details ? { details } : {})
      });
    }
  }

  @SubscribeMessage('comment:new')
  async handleCommentNew(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { roomId?: unknown; comment?: unknown }
  ): Promise<void> {
    const user = client.data.user;
    if (!user) return;

    const roomId = typeof payload?.roomId === 'string' ? payload.roomId : null;
    if (!roomId || !payload?.comment) return;

    const membership = await this.getRoomMembership(roomId, user.id);
    if (!membership) return;

    client.to(this.getRoomChannel(roomId)).emit('comment:new', {
      roomId,
      comment: payload.comment
    });
  }

  @SubscribeMessage('shape:preview')
  async handleShapePreview(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { roomId?: unknown; objectId?: unknown; transform?: unknown }
  ): Promise<void> {
    const user = client.data.user;
    if (!user) return;

    const roomId = typeof payload?.roomId === 'string' ? payload.roomId : null;
    const objectId = typeof payload?.objectId === 'string' ? payload.objectId : null;
    const transform = typeof payload?.transform === 'object' && payload.transform !== null
      ? payload.transform as Record<string, unknown>
      : null;

    if (!roomId || !objectId || !transform) return;

    // Verify room membership before broadcasting
    const membership = await this.getRoomMembership(roomId, user.id);
    if (!membership) return;

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
    client.emit('room:error', {
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

  private parseClientOpId(clientOpId: unknown): string | undefined {
    return typeof clientOpId === 'string' && clientOpId.trim() ? clientOpId.trim() : undefined;
  }

  private parseObjectId(objectId: unknown): string | null {
    return typeof objectId === 'string' && objectId.trim() ? objectId.trim() : null;
  }

  private parseCursorPosition(position: unknown): CursorPosition | null {
    if (typeof position !== 'object' || position === null) {
      return null;
    }

    const candidate = position as Record<string, unknown>;
    return typeof candidate.x === 'number' && typeof candidate.y === 'number'
      ? { x: candidate.x, y: candidate.y }
      : null;
  }

  private parseObjectIds(objectIds: unknown): string[] {
    if (!Array.isArray(objectIds)) {
      return [];
    }

    return objectIds
      .filter((objectId): objectId is string => typeof objectId === 'string' && Boolean(objectId.trim()))
      .map((objectId) => objectId.trim())
      .slice(0, 100);
  }

  private parseSelectionMode(mode: unknown): 'selected' | 'editing' | null {
    return mode === 'selected' || mode === 'editing' ? mode : null;
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
      const response = error.getResponse();
      if (typeof response === 'object' && response !== null && 'reason' in response) {
        const reason = (response as Record<string, unknown>).reason;
        if (typeof reason === 'string' && reason === 'TEXT_LEASE_CONFLICT') {
          return 'TEXT_LEASE_CONFLICT';
        }
      }
      return 'VERSION_CONFLICT';
    }

    if (error instanceof NotFoundException) {
      return 'NOT_FOUND';
    }

    return 'VALIDATION_ERROR';
  }

  private getHttpExceptionMessage(error: unknown, fallback: string): string {
    if (!(error instanceof HttpException)) {
      return fallback;
    }

    const response = error.getResponse();

    if (typeof response === 'string') {
      return response;
    }

    if (typeof response === 'object' && response !== null && 'message' in response) {
      const message = (response as { message?: unknown }).message;

      if (typeof message === 'string') {
        return message;
      }

      if (Array.isArray(message)) {
        return message.join(', ');
      }
    }

    return error.message;
  }

  private getHttpExceptionDetails(error: unknown): unknown {
    if (!(error instanceof HttpException)) {
      return undefined;
    }

    const response = error.getResponse();

    if (typeof response === 'object' && response !== null && 'details' in response) {
      return (response as { details?: unknown }).details;
    }

    return undefined;
  }

  broadcastToRoom(roomId: string, event: string, payload: unknown): void {
    this.server.to(this.getRoomChannel(roomId)).emit(event, payload);
  }

  private getRoomChannel(roomId: string): string {
    return `room:${roomId}`;
  }

  private getAccessSecret(): string {
    return this.config.get<string>('JWT_ACCESS_SECRET') ?? 'dev-access-secret-change-me';
  }
}

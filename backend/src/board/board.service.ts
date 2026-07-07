import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional
} from '@nestjs/common';
import { Prisma, type BoardEvent as PrismaBoardEvent } from '@prisma/client';
import type { BoardObject, BoardObjectId, BoardObjectType, RoomId, UserId } from '@whiteboard/shared';
import { PrismaService } from '../prisma/prisma.service';
import { decodeBoardEventPayload, encodeBoardEventPayload } from './board-event-payload.codec';
import { ConflictResolutionService } from './conflict-resolution.service';

export const BOARD_EVENT_TYPES = ['object:create', 'object:update', 'object:delete'] as const;

const BOARD_OBJECT_TYPES: BoardObjectType[] = ['rectangle', 'circle', 'line', 'text'];
const MAX_DELTA_SYNC_EVENTS = 50;

export type BoardEventType = (typeof BOARD_EVENT_TYPES)[number];

export type BoardSnapshot = {
  objects: Record<BoardObjectId, BoardObject>;
};

export type BoardObjectDraft = {
  id: BoardObjectId;
  type: BoardObjectType;
  x: number;
  y: number;
  rotation?: number;
  props?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type BoardObjectPatch = {
  x?: number;
  y?: number;
  rotation?: number;
  props?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type CreateBoardObjectPayload = {
  object: BoardObjectDraft;
};

export type UpdateBoardObjectPayload = {
  objectId: BoardObjectId;
  expectedVersion?: number;
  patch: BoardObjectPatch;
};

export type DeleteBoardObjectPayload = {
  objectId: BoardObjectId;
  expectedVersion?: number;
};

export type ApplyBoardEventInput = {
  roomId: RoomId;
  actorId: UserId;
  eventType: BoardEventType;
  payload: CreateBoardObjectPayload | UpdateBoardObjectPayload | DeleteBoardObjectPayload;
  baseVersion?: number;
  clientOpId?: string;
};

export type ApplyBoardEventResult = {
  roomId: RoomId;
  version: number;
  eventType: BoardEventType;
  payload: ApplyBoardEventInput['payload'];
  actorId: UserId;
  snapshot: BoardSnapshot;
  clientOpId?: string;
};

export type BoardStateResult = {
  roomId: RoomId;
  version: number;
  snapshot: BoardSnapshot;
};

export type BoardSnapshotResponse = {
  roomId: RoomId;
  version: number;
  objects: Record<BoardObjectId, BoardObject>;
  updatedAt: string | null;
};

export type BoardMissedEvent = {
  id: string;
  roomId: RoomId;
  version: number;
  eventType: string;
  payload: unknown;
  actorId: UserId;
  createdAt: string;
};

export type BoardSyncResult =
  | {
      syncMode: 'delta';
      missedEvents: BoardMissedEvent[];
      currentVersion: number;
    }
  | {
      syncMode: 'snapshot';
      snapshot: BoardSnapshot;
      currentVersion: number;
    };

@Injectable()
export class BoardService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly conflicts: ConflictResolutionService = new ConflictResolutionService()
  ) {}

  async getBoardState(roomId: RoomId): Promise<BoardStateResult> {
    const boardState = await this.prisma.boardState.findUnique({
      where: {
        roomId
      }
    });

    if (!boardState) {
      throw new NotFoundException('Board state not found');
    }

    return {
      roomId,
      version: boardState.version,
      snapshot: this.normalizeSnapshot(boardState.snapshotJson)
    };
  }

  async getBoardSnapshotForRoom(roomId: RoomId): Promise<BoardSnapshotResponse> {
    const boardState = await this.prisma.boardState.findUnique({
      where: {
        roomId
      }
    });

    if (!boardState) {
      return {
        roomId,
        version: 0,
        objects: {},
        updatedAt: null
      };
    }

    return {
      roomId,
      version: boardState.version,
      objects: this.normalizeSnapshot(boardState.snapshotJson).objects,
      updatedAt: boardState.updatedAt.toISOString()
    };
  }

  async getReconnectSync(roomId: RoomId, lastKnownVersion?: number): Promise<BoardSyncResult> {
    const boardState = await this.prisma.boardState.findUnique({
      where: {
        roomId
      }
    });

    if (!boardState) {
      throw new NotFoundException('Board state not found');
    }

    const currentVersion = boardState.version;

    if (
      typeof lastKnownVersion !== 'number' ||
      lastKnownVersion < 0 ||
      lastKnownVersion > currentVersion ||
      currentVersion - lastKnownVersion > MAX_DELTA_SYNC_EVENTS
    ) {
      return {
        syncMode: 'snapshot',
        snapshot: this.normalizeSnapshot(boardState.snapshotJson),
        currentVersion
      };
    }

    const missedEvents = await this.prisma.boardEvent.findMany({
      where: {
        roomId,
        version: {
          gt: lastKnownVersion
        }
      },
      orderBy: {
        version: 'asc'
      }
    });

    return {
      syncMode: 'delta',
      missedEvents: missedEvents.map((event) => this.toMissedEvent(event)),
      currentVersion
    };
  }

  async applyBoardEvent(input: ApplyBoardEventInput): Promise<ApplyBoardEventResult> {
    return this.prisma.$transaction(async (tx) => {
      const currentState = await tx.boardState.findUnique({
        where: {
          roomId: input.roomId
        }
      });
      const currentVersion = currentState?.version ?? 0;
      const currentSnapshot = this.normalizeSnapshot(currentState?.snapshotJson);
      let eventInput = input;

      if (input.clientOpId) {
        const existingEvent = await tx.boardEvent.findFirst({
          where: {
            roomId: input.roomId,
            clientOpId: input.clientOpId
          }
        });

        if (existingEvent) {
          return {
            roomId: input.roomId,
            version: existingEvent.version,
            eventType: existingEvent.eventType as BoardEventType,
            payload: decodeBoardEventPayload(
              existingEvent.eventType,
              existingEvent.payloadJson
            ) as ApplyBoardEventInput['payload'],
            actorId: existingEvent.actorId,
            snapshot: currentSnapshot,
            clientOpId: existingEvent.clientOpId ?? undefined
          };
        }
      }

      if (typeof input.baseVersion === 'number' && input.baseVersion !== currentVersion) {
        const missedEvents = await tx.boardEvent.findMany({
          where: {
            roomId: input.roomId,
            version: {
              gt: input.baseVersion
            }
          },
          orderBy: {
            version: 'asc'
          }
        });

        eventInput = this.conflicts.resolveStaleEvent({
          currentSnapshot,
          currentVersion,
          input,
          missedEvents
        });
      }

      const nextVersion = currentVersion + 1;
      const nextSnapshot = this.applyEventToSnapshot(currentSnapshot, eventInput, new Date());

      await tx.boardEvent.create({
        data: {
          roomId: eventInput.roomId,
          version: nextVersion,
          eventType: eventInput.eventType,
          payloadJson: encodeBoardEventPayload(
            eventInput.eventType,
            eventInput.payload
          ) as unknown as Prisma.InputJsonValue,
          actorId: eventInput.actorId,
          ...(eventInput.clientOpId ? { clientOpId: eventInput.clientOpId } : {})
        }
      });

      await tx.boardState.upsert({
        where: {
          roomId: input.roomId
        },
        create: {
          roomId: input.roomId,
          version: nextVersion,
          snapshotJson: nextSnapshot as unknown as Prisma.InputJsonValue
        },
        update: {
          version: nextVersion,
          snapshotJson: nextSnapshot as unknown as Prisma.InputJsonValue
        }
      });

      return {
        roomId: input.roomId,
        version: nextVersion,
        eventType: eventInput.eventType,
        payload: eventInput.payload,
        actorId: eventInput.actorId,
        snapshot: nextSnapshot,
        clientOpId: eventInput.clientOpId
      };
    });
  }

  applyEventToSnapshot(
    snapshot: BoardSnapshot,
    input: ApplyBoardEventInput,
    now = new Date()
  ): BoardSnapshot {
    const nextSnapshot = this.cloneSnapshot(snapshot);

    switch (input.eventType) {
      case 'object:create':
        this.applyCreate(nextSnapshot, input, now);
        return nextSnapshot;
      case 'object:update':
        this.applyUpdate(nextSnapshot, input, now);
        return nextSnapshot;
      case 'object:delete':
        this.applyDelete(nextSnapshot, input, now);
        return nextSnapshot;
      default:
        throw new BadRequestException('Unsupported board event type');
    }
  }

  private applyCreate(
    snapshot: BoardSnapshot,
    input: ApplyBoardEventInput,
    now: Date
  ): void {
    const payload = this.parseCreatePayload(input.payload);
    const existing = snapshot.objects[payload.object.id];

    if (existing && !existing.deleted) {
      throw new ConflictException('Board object already exists');
    }

    const timestamp = now.toISOString();

    snapshot.objects[payload.object.id] = {
      id: payload.object.id,
      roomId: input.roomId,
      type: payload.object.type,
      x: payload.object.x,
      y: payload.object.y,
      rotation: payload.object.rotation ?? 0,
      version: 1,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
      deleted: false,
      props: payload.object.props ?? {},
      metadata: payload.object.metadata
    };
  }

  private applyUpdate(
    snapshot: BoardSnapshot,
    input: ApplyBoardEventInput,
    now: Date
  ): void {
    const payload = this.parseUpdatePayload(input.payload);
    const existing = snapshot.objects[payload.objectId];

    if (!existing || existing.deleted) {
      throw new NotFoundException('Board object not found');
    }

    this.assertExpectedObjectVersion(existing.version, payload.expectedVersion);

    snapshot.objects[payload.objectId] = {
      ...existing,
      x: payload.patch.x ?? existing.x,
      y: payload.patch.y ?? existing.y,
      rotation: payload.patch.rotation ?? existing.rotation,
      props: payload.patch.props ? { ...existing.props, ...payload.patch.props } : existing.props,
      metadata: payload.patch.metadata
        ? { ...(existing.metadata ?? {}), ...payload.patch.metadata }
        : existing.metadata,
      version: existing.version + 1,
      updatedBy: input.actorId,
      updatedAt: now.toISOString()
    };
  }

  private applyDelete(
    snapshot: BoardSnapshot,
    input: ApplyBoardEventInput,
    now: Date
  ): void {
    const payload = this.parseDeletePayload(input.payload);
    const existing = snapshot.objects[payload.objectId];

    if (!existing || existing.deleted) {
      throw new NotFoundException('Board object not found');
    }

    this.assertExpectedObjectVersion(existing.version, payload.expectedVersion);

    snapshot.objects[payload.objectId] = {
      ...existing,
      deleted: true,
      version: existing.version + 1,
      updatedBy: input.actorId,
      updatedAt: now.toISOString()
    };
  }

  private parseCreatePayload(payload: unknown): CreateBoardObjectPayload {
    if (!this.isRecord(payload) || !this.isRecord(payload.object)) {
      throw new BadRequestException('object:create requires object payload');
    }

    const object = payload.object;

    if (
      typeof object.id !== 'string' ||
      !BOARD_OBJECT_TYPES.includes(object.type as BoardObjectType) ||
      typeof object.x !== 'number' ||
      typeof object.y !== 'number'
    ) {
      throw new BadRequestException('Invalid board object payload');
    }

    return {
      object: {
        id: object.id,
        type: object.type as BoardObjectType,
        x: object.x,
        y: object.y,
        rotation: typeof object.rotation === 'number' ? object.rotation : undefined,
        props: this.optionalRecord(object.props, 'props'),
        metadata: this.optionalRecord(object.metadata, 'metadata')
      }
    };
  }

  private parseUpdatePayload(payload: unknown): UpdateBoardObjectPayload {
    if (
      !this.isRecord(payload) ||
      typeof payload.objectId !== 'string' ||
      !this.isRecord(payload.patch)
    ) {
      throw new BadRequestException('object:update requires objectId and patch');
    }

    const patch: BoardObjectPatch = {};

    if (payload.patch.x !== undefined) {
      patch.x = this.parseOptionalNumber(payload.patch.x, 'x');
    }

    if (payload.patch.y !== undefined) {
      patch.y = this.parseOptionalNumber(payload.patch.y, 'y');
    }

    if (payload.patch.rotation !== undefined) {
      patch.rotation = this.parseOptionalNumber(payload.patch.rotation, 'rotation');
    }

    if (payload.patch.props !== undefined) {
      patch.props = this.optionalRecord(payload.patch.props, 'props');
    }

    if (payload.patch.metadata !== undefined) {
      patch.metadata = this.optionalRecord(payload.patch.metadata, 'metadata');
    }

    return {
      objectId: payload.objectId,
      expectedVersion: this.parseExpectedVersion(payload.expectedVersion),
      patch
    };
  }

  private parseDeletePayload(payload: unknown): DeleteBoardObjectPayload {
    if (!this.isRecord(payload) || typeof payload.objectId !== 'string') {
      throw new BadRequestException('object:delete requires objectId');
    }

    return {
      objectId: payload.objectId,
      expectedVersion: this.parseExpectedVersion(payload.expectedVersion)
    };
  }

  private assertExpectedObjectVersion(currentVersion: number, expectedVersion?: number): void {
    if (typeof expectedVersion === 'number' && expectedVersion !== currentVersion) {
      throw new ConflictException('Board object version conflict');
    }
  }

  private toMissedEvent(event: PrismaBoardEvent): BoardMissedEvent {
    return {
      id: event.id,
      roomId: event.roomId,
      version: event.version,
      eventType: event.eventType,
      payload: decodeBoardEventPayload(event.eventType, event.payloadJson),
      actorId: event.actorId,
      createdAt: event.createdAt.toISOString()
    };
  }

  private normalizeSnapshot(snapshot: unknown): BoardSnapshot {
    if (!this.isRecord(snapshot) || !this.isRecord(snapshot.objects)) {
      return {
        objects: {}
      };
    }

    const objects: Record<BoardObjectId, BoardObject> = {};

    for (const [objectId, object] of Object.entries(snapshot.objects)) {
      if (this.isBoardObject(object)) {
        objects[objectId] = {
          ...object,
          props: { ...object.props },
          metadata: object.metadata ? { ...object.metadata } : undefined
        };
      }
    }

    return {
      objects
    };
  }

  private cloneSnapshot(snapshot: BoardSnapshot): BoardSnapshot {
    return {
      objects: Object.fromEntries(
        Object.entries(snapshot.objects).map(([objectId, object]) => [
          objectId,
          {
            ...object,
            props: { ...object.props },
            metadata: object.metadata ? { ...object.metadata } : undefined
          }
        ])
      )
    };
  }

  private isBoardObject(value: unknown): value is BoardObject {
    return (
      this.isRecord(value) &&
      typeof value.id === 'string' &&
      typeof value.roomId === 'string' &&
      BOARD_OBJECT_TYPES.includes(value.type as BoardObjectType) &&
      typeof value.x === 'number' &&
      typeof value.y === 'number' &&
      typeof value.version === 'number' &&
      typeof value.createdBy === 'string' &&
      typeof value.updatedBy === 'string' &&
      typeof value.createdAt === 'string' &&
      typeof value.updatedAt === 'string' &&
      this.isRecord(value.props)
    );
  }

  private optionalRecord(value: unknown, fieldName: string): Record<string, unknown> | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (!this.isRecord(value)) {
      throw new BadRequestException(`${fieldName} must be an object`);
    }

    return value;
  }

  private parseOptionalNumber(value: unknown, fieldName: string): number {
    if (typeof value !== 'number') {
      throw new BadRequestException(`${fieldName} must be a number`);
    }

    return value;
  }

  private parseExpectedVersion(value: unknown): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new BadRequestException('expectedVersion must be a non-negative integer');
    }

    return value;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

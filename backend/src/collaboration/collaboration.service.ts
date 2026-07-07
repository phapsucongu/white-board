import { ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server } from 'socket.io';
import * as Y from 'yjs';
import { BoardService, type ApplyBoardEventResult } from '../board/board.service';
import { PrismaService } from '../prisma/prisma.service';

export type CursorPosition = {
  x: number;
  y: number;
};

export type LiveCursor = {
  roomId: string;
  userId: string;
  displayName: string | null;
  socketId: string;
  position: CursorPosition;
  updatedAt: string;
};

export type TextLease = {
  roomId: string;
  objectId: string;
  userId: string;
  displayName: string | null;
  socketId?: string;
  expiresAt: string;
};

export type RemoteObjectSelection = {
  roomId: string;
  userId: string;
  displayName: string | null;
  socketId: string;
  objectIds: string[];
  mode: 'selected' | 'editing';
  updatedAt: string;
};

export type TextUpdateResult = {
  roomId: string;
  objectId: string;
  actorId: string;
  updateBase64: string;
  stateBase64: string;
  text: string;
  boardEvent: ApplyBoardEventResult;
};

const CURSOR_TTL_MS = 10_000;
const TEXT_LEASE_TTL_MS = 30_000;
const SELECTION_TTL_MS = 30_000;

@Injectable()
export class CollaborationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CollaborationService.name);
  private readonly cursorsBySocket = new Map<string, LiveCursor>();
  private readonly leasesByObject = new Map<string, TextLease>();
  private readonly selectionsBySocket = new Map<string, RemoteObjectSelection>();
  private redisPub: Redis | null = null;
  private redisSub: Redis | null = null;

  constructor(
    private readonly board: BoardService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  onModuleInit(): void {
    const redisUrl = this.config.get<string>('REDIS_URL');

    if (!redisUrl) {
      return;
    }

    this.redisPub = new Redis(redisUrl, {
      maxRetriesPerRequest: 1
    });
    this.redisSub = this.redisPub.duplicate();

    this.redisPub.on('error', (error) => {
      this.logger.warn(`Redis collaboration connection failed: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.redisPub?.quit().catch(() => undefined),
      this.redisSub?.quit().catch(() => undefined)
    ]);
  }

  attachSocketAdapter(server: Server): void {
    if (!this.redisPub || !this.redisSub) {
      return;
    }

    server.adapter(createAdapter(this.redisPub, this.redisSub));
  }

  recordCursor(input: {
    roomId: string;
    userId: string;
    displayName: string | null;
    socketId: string;
    position: CursorPosition;
  }): LiveCursor {
    const cursor: LiveCursor = {
      ...input,
      updatedAt: new Date().toISOString()
    };

    this.cursorsBySocket.set(input.socketId, cursor);
    void this.redisPub?.set(
      this.cursorKey(input.roomId, input.socketId),
      JSON.stringify(cursor),
      'PX',
      CURSOR_TTL_MS
    );

    return cursor;
  }

  removeSocket(socketId: string): LiveCursor | null {
    const cursor = this.cursorsBySocket.get(socketId) ?? null;
    this.cursorsBySocket.delete(socketId);

    if (cursor) {
      void this.redisPub?.del(this.cursorKey(cursor.roomId, socketId));
    }

    return cursor;
  }

  removeTextLeasesForSocket(socketId: string): TextLease[] {
    const removed: TextLease[] = [];

    for (const [key, lease] of this.leasesByObject.entries()) {
      if (lease.socketId === socketId) {
        this.leasesByObject.delete(key);
        void this.redisPub?.del(key);
        removed.push(lease);
      }
    }

    return removed;
  }

  recordObjectSelection(input: {
    roomId: string;
    userId: string;
    displayName: string | null;
    socketId: string;
    objectIds: string[];
    mode: 'selected' | 'editing';
  }): RemoteObjectSelection {
    const selection: RemoteObjectSelection = {
      ...input,
      objectIds: [...new Set(input.objectIds)].sort(),
      updatedAt: new Date().toISOString()
    };

    this.selectionsBySocket.set(input.socketId, selection);
    void this.redisPub?.set(
      this.selectionKey(input.roomId, input.socketId),
      JSON.stringify(selection),
      'PX',
      SELECTION_TTL_MS
    );

    return selection;
  }

  removeObjectSelection(socketId: string): RemoteObjectSelection | null {
    const selection = this.selectionsBySocket.get(socketId) ?? null;
    this.selectionsBySocket.delete(socketId);

    if (selection) {
      void this.redisPub?.del(this.selectionKey(selection.roomId, socketId));
    }

    return selection;
  }

  claimTextLease(input: {
    roomId: string;
    objectId: string;
    userId: string;
    displayName: string | null;
    socketId: string;
  }): { acquired: boolean; lease: TextLease } {
    const key = this.leaseKey(input.roomId, input.objectId);
    const existing = this.getActiveLease(input.roomId, input.objectId);

    if (existing && existing.userId !== input.userId) {
      return {
        acquired: false,
        lease: existing
      };
    }

    const lease: TextLease = {
      ...input,
      expiresAt: new Date(Date.now() + TEXT_LEASE_TTL_MS).toISOString()
    };

    this.leasesByObject.set(key, lease);
    void this.redisPub?.set(
      key,
      JSON.stringify(lease),
      'PX',
      TEXT_LEASE_TTL_MS
    );

    return {
      acquired: true,
      lease
    };
  }

  releaseTextLease(roomId: string, objectId: string, userId: string): TextLease | null {
    const key = this.leaseKey(roomId, objectId);
    const lease = this.leasesByObject.get(key) ?? null;

    if (lease?.userId !== userId) {
      return lease;
    }

    this.leasesByObject.delete(key);
    void this.redisPub?.del(key);

    return null;
  }

  getActiveLease(roomId: string, objectId: string): TextLease | null {
    const key = this.leaseKey(roomId, objectId);
    const lease = this.leasesByObject.get(key) ?? null;

    if (!lease) {
      return null;
    }

    if (new Date(lease.expiresAt).getTime() <= Date.now()) {
      this.leasesByObject.delete(key);
      void this.redisPub?.del(key);
      return null;
    }

    return lease;
  }

  async applyTextUpdate(input: {
    roomId: string;
    objectId: string;
    actorId: string;
    updateBase64: string;
  }): Promise<TextUpdateResult> {
    const lease = this.getActiveLease(input.roomId, input.objectId);

    if (lease && lease.userId !== input.actorId) {
      throw new ConflictException({
        message: `${lease.displayName || lease.userId} is editing this text`,
        reason: 'TEXT_LEASE_CONFLICT',
        details: {
          currentVersion: 0,
          objectId: input.objectId,
          conflictingFields: ['props.text'],
          currentObject: null,
          lease
        }
      });
    }

    const existing = await this.prisma.textDocument.findUnique({
      where: { objectId: input.objectId }
    });
    const doc = new Y.Doc();

    if (existing) {
      Y.applyUpdate(doc, Buffer.from(existing.ydocBase64, 'base64'));
    }

    const update = Buffer.from(input.updateBase64, 'base64');
    Y.applyUpdate(doc, update);

    const text = doc.getText('content').toString();
    const stateBase64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');

    await this.prisma.textDocument.upsert({
      where: { objectId: input.objectId },
      create: {
        roomId: input.roomId,
        objectId: input.objectId,
        ydocBase64: stateBase64,
        text,
        updatedBy: input.actorId
      },
      update: {
        ydocBase64: stateBase64,
        text,
        updatedBy: input.actorId
      }
    });

    const boardEvent = await this.board.applyBoardEvent({
      roomId: input.roomId,
      actorId: input.actorId,
      eventType: 'object:update',
      payload: {
        objectId: input.objectId,
        patch: {
          props: {
            text
          }
        }
      }
    });

    return {
      ...input,
      stateBase64,
      text,
      boardEvent
    };
  }

  private cursorKey(roomId: string, socketId: string): string {
    return `cursor:${roomId}:${socketId}`;
  }

  private leaseKey(roomId: string, objectId: string): string {
    return `lease:${roomId}:${objectId}`;
  }

  private selectionKey(roomId: string, socketId: string): string {
    return `selection:${roomId}:${socketId}`;
  }
}

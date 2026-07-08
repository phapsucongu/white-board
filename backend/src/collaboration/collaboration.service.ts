import { ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import type { Server } from 'socket.io';
import * as Y from 'yjs';
import { BoardService } from '../board/board.service';
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
};

const CURSOR_TTL_MS = 10_000;
const TEXT_LEASE_TTL_MS = 30_000;
const SELECTION_TTL_MS = 30_000;
// Live typing is relayed per-keystroke over Yjs; the durable board-event (which bumps
// the board version + appends to the event log) is coalesced to at most one per object
// per this window, so a paragraph of typing no longer floods the log with versions.
const TEXT_BOARD_EVENT_DEBOUNCE_MS = 800;

@Injectable()
export class CollaborationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CollaborationService.name);
  private readonly cursorsBySocket = new Map<string, LiveCursor>();
  private readonly leasesByObject = new Map<string, TextLease>();
  private readonly selectionsBySocket = new Map<string, RemoteObjectSelection>();
  // Pending debounced board-event flushes, keyed by roomId:objectId.
  private readonly textFlushTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; actorId: string }>();
  private server: Server | null = null;
  private redisPub: Redis | null = null;
  private redisSub: Redis | null = null;

  constructor(
    private readonly board: BoardService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL');

    if (!redisUrl) {
      return;
    }

    const pub = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      retryStrategy: () => null // Don't retry - Redis is optional
    });
    const sub = pub.duplicate();

    // Both connections MUST have an 'error' listener: an unhandled 'error' event on
    // an ioredis client (e.g. Redis drops after startup) would otherwise crash the
    // whole process, taking down every room — not just collaboration.
    const onError = (error: Error) => {
      this.logger.warn(`Redis collaboration unavailable (non-fatal): ${error.message}`);
    };
    pub.on('error', onError);
    sub.on('error', onError);

    // Await both connections before exposing the clients, so attachSocketAdapter()
    // never wires the Socket.IO adapter to a half-open / already-failed connection.
    try {
      await Promise.all([pub.connect(), sub.connect()]);
      this.redisPub = pub;
      this.redisSub = sub;
    } catch {
      pub.disconnect();
      sub.disconnect();
      this.redisPub = null;
      this.redisSub = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Flush any pending text edits so the final keystrokes aren't lost on shutdown.
    const pending = [...this.textFlushTimers.entries()];
    this.textFlushTimers.clear();
    await Promise.all(
      pending.map(([key, { timer, actorId }]) => {
        clearTimeout(timer);
        const separator = key.indexOf(':');
        const roomId = key.slice(0, separator);
        const objectId = key.slice(separator + 1);
        return this.flushTextBoardEvent(roomId, objectId, actorId).catch(() => undefined);
      })
    );

    await Promise.all([
      this.redisPub?.quit().catch(() => undefined),
      this.redisSub?.quit().catch(() => undefined)
    ]);
  }

  attachSocketAdapter(server: Server): void {
    // Always keep a server reference (used to broadcast debounced text board-events),
    // regardless of whether the Redis adapter is configured.
    this.server = server;

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

    // Serializable read-modify-write with retry so concurrent updates for the same
    // object (same user in two tabs, or two backend instances) can't clobber each
    // other via last-write-wins. Yjs applyUpdate is idempotent, so re-applying the
    // client update after a retry re-read is safe.
    const { text, stateBase64 } = await this.persistTextUpdate(input);

    // Durable board-event write is coalesced (debounced) rather than one-per-keystroke.
    this.scheduleTextBoardEventFlush(input.roomId, input.objectId, input.actorId);

    return {
      roomId: input.roomId,
      objectId: input.objectId,
      actorId: input.actorId,
      updateBase64: input.updateBase64,
      stateBase64,
      text
    };
  }

  private async persistTextUpdate(input: {
    roomId: string;
    objectId: string;
    actorId: string;
    updateBase64: string;
  }): Promise<{ text: string; stateBase64: string }> {
    const MAX_ATTEMPTS = 5;
    const update = Buffer.from(input.updateBase64, 'base64');

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const existing = await tx.textDocument.findUnique({
              where: { objectId: input.objectId }
            });
            const doc = new Y.Doc();

            if (existing) {
              Y.applyUpdate(doc, Buffer.from(existing.ydocBase64, 'base64'));
            }

            Y.applyUpdate(doc, update);

            const text = doc.getText('content').toString();
            const stateBase64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');

            await tx.textDocument.upsert({
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

            return { text, stateBase64 };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
      } catch (error) {
        if (this.isRetryableTransactionError(error) && attempt < MAX_ATTEMPTS) {
          continue;
        }
        throw error;
      }
    }
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return error.code === 'P2002' || error.code === 'P2034';
    }
    return false;
  }

  /** Cancel any pending debounce and write the board-event now (e.g. on lease release). */
  async flushTextBoardEvent(roomId: string, objectId: string, actorId: string): Promise<void> {
    const key = this.textFlushKey(roomId, objectId);
    const pending = this.textFlushTimers.get(key);
    if (pending) {
      clearTimeout(pending.timer);
      this.textFlushTimers.delete(key);
    }

    const doc = await this.prisma.textDocument.findUnique({ where: { objectId } });
    if (!doc) {
      return;
    }

    try {
      const boardEvent = await this.board.applyBoardEvent({
        roomId,
        actorId,
        eventType: 'object:update',
        payload: {
          objectId,
          patch: {
            props: {
              text: doc.text
            }
          }
        }
      });

      const serverTime = new Date().toISOString();
      this.server?.to(this.roomChannel(roomId)).emit('board:event:broadcast', {
        roomId: boardEvent.roomId,
        version: boardEvent.version,
        eventType: boardEvent.eventType,
        payload: boardEvent.payload,
        actorId: boardEvent.actorId,
        serverTime
      });
    } catch (error) {
      this.logger.warn(
        `Failed to flush text board event for object ${objectId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private scheduleTextBoardEventFlush(roomId: string, objectId: string, actorId: string): void {
    const key = this.textFlushKey(roomId, objectId);
    const existing = this.textFlushTimers.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => {
      this.textFlushTimers.delete(key);
      void this.flushTextBoardEvent(roomId, objectId, actorId);
    }, TEXT_BOARD_EVENT_DEBOUNCE_MS);
    // A pending flush should not keep the process alive on shutdown.
    timer.unref?.();

    this.textFlushTimers.set(key, { timer, actorId });
  }

  private textFlushKey(roomId: string, objectId: string): string {
    return `${roomId}:${objectId}`;
  }

  private roomChannel(roomId: string): string {
    return `room:${roomId}`;
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

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { BoardObject, BoardObjectId } from '@whiteboard/shared';
import { io, type Socket } from 'socket.io-client';
import type { RoomRole } from '../api/client';
import { env } from '../config/env';
import {
  useBoardStore,
  type BoardCreateAcceptedEvent,
  type BoardDeleteAcceptedEvent,
  type BoardSnapshot,
  type BoardUpdateAcceptedEvent,
  type CreateBoardObjectPayload,
  type DeleteBoardObjectPayload,
  type UpdateBoardObjectPayload
} from '../board/boardStore';

type BoardEventType = 'object:create' | 'object:update' | 'object:delete';

type BoardMissedEvent = {
  id: string;
  roomId: string;
  version: number;
  eventType: string;
  payload: unknown;
  actorId: string;
  createdAt: string;
};

type RoomJoinedPayload = {
  roomId: string;
  role: RoomRole;
  users?: PresenceUser[];
  currentVersion: number;
  syncMode: 'delta' | 'snapshot';
  missedEvents?: BoardMissedEvent[];
  snapshot?: BoardSnapshot;
};

export type PresenceUser = {
  userId: string;
  email: string;
  displayName: string | null;
  role: RoomRole;
  socketIds: string[];
  joinedAt: string;
};

type PresenceUpdatePayload = {
  roomId: string;
  users: PresenceUser[];
};

type BoardEventRejectedPayload = {
  roomId?: string;
  eventType?: BoardEventType;
  reason: string;
  message: string;
};

type SocketErrorPayload = {
  code: string;
  message: string;
};

type BoardEventRequestPayload = {
  roomId: string;
  eventType: BoardEventType;
  baseVersion: number;
  payload: BoardEventPayload;
  clientOpId: string;
};

type BoardEventPayload =
  | CreateBoardObjectPayload
  | UpdateBoardObjectPayload
  | DeleteBoardObjectPayload;

type BoardAcceptedEvent =
  | BoardCreateAcceptedEvent
  | BoardUpdateAcceptedEvent
  | BoardDeleteAcceptedEvent;

type BoardHistoryOperation = {
  eventType: BoardEventType;
  payload: BoardEventPayload;
};

type BoardHistoryEntry = {
  id: string;
  redo: BoardHistoryOperation;
  undo: BoardHistoryOperation;
};

type PendingHistoryIntent = {
  entry: BoardHistoryEntry;
  kind: 'normal' | 'redo' | 'undo';
};

export type RealtimeStatus = 'idle' | 'connecting' | 'joined' | 'error';

export type ShapePreview = {
  objectId: string;
  transform: Record<string, unknown>;
  byUser: { id: string; displayName: string | null };
};

export function canMutateRoom(role?: RoomRole): boolean {
  return role === 'OWNER' || role === 'EDITOR';
}

export function getPresenceDisplayName(user: PresenceUser): string {
  return user.displayName?.trim() || user.email || user.userId;
}

export function normalizePresenceUsers(users: PresenceUser[]): PresenceUser[] {
  return [...users].sort((first, second) =>
    getPresenceDisplayName(first).localeCompare(getPresenceDisplayName(second), undefined, {
      sensitivity: 'base'
    })
  );
}

export function toCreateBoardObjectPayload(object: BoardObject): CreateBoardObjectPayload {
  return {
    object: {
      id: object.id,
      type: object.type,
      x: object.x,
      y: object.y,
      rotation: object.rotation,
      props: object.props,
      metadata: object.metadata
    }
  };
}

export function toMoveBoardObjectPayload(
  objectId: string,
  position: { x: number; y: number }
): UpdateBoardObjectPayload {
  return {
    objectId,
    patch: {
      x: position.x,
      y: position.y
    }
  };
}

export function toResizeRectanglePayload(
  objectId: string,
  rectangle: { height: number; width: number; x: number; y: number }
): UpdateBoardObjectPayload {
  return {
    objectId,
    patch: {
      x: rectangle.x,
      y: rectangle.y,
      props: {
        height: rectangle.height,
        width: rectangle.width
      }
    }
  };
}

export function toDeleteBoardObjectPayload(
  objectId: BoardObjectId,
  expectedVersion?: number
): DeleteBoardObjectPayload {
  return {
    objectId,
    expectedVersion
  };
}

export function useRoomRealtime({
  accessToken,
  currentUserId,
  enabled,
  roomId
}: {
  accessToken: string | null;
  currentUserId: string | null;
  enabled: boolean;
  roomId: string | null;
}) {
  const socketRef = useRef<Socket | null>(null);
  const pendingHistoryRef = useRef<PendingHistoryIntent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingHistoryCount, setPendingHistoryCount] = useState(0);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [preview, setPreview] = useState<ShapePreview | null>(null);
  const [redoStack, setRedoStack] = useState<BoardHistoryEntry[]>([]);
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const [undoStack, setUndoStack] = useState<BoardHistoryEntry[]>([]);
  const applyAcceptedCreateEvent = useBoardStore((state) => state.applyAcceptedCreateEvent);
  const applyAcceptedDeleteEvent = useBoardStore((state) => state.applyAcceptedDeleteEvent);
  const applyAcceptedUpdateEvent = useBoardStore((state) => state.applyAcceptedUpdateEvent);
  const setBoardSnapshot = useBoardStore((state) => state.setBoardSnapshot);
  const setBoardVersion = useBoardStore((state) => state.setBoardVersion);

  const enqueuePendingHistory = useCallback((intent: PendingHistoryIntent) => {
    pendingHistoryRef.current = [...pendingHistoryRef.current, intent];
    setPendingHistoryCount(pendingHistoryRef.current.length);
  }, []);

  const dequeuePendingHistory = useCallback((): PendingHistoryIntent | null => {
    const [intent, ...rest] = pendingHistoryRef.current;
    pendingHistoryRef.current = rest;
    setPendingHistoryCount(rest.length);
    return intent ?? null;
  }, []);

  const emitBoardEvent = useCallback(
    (operation: BoardHistoryOperation, pendingHistory?: PendingHistoryIntent): boolean => {
      const socket = socketRef.current;

      if (!socket || !roomId || status !== 'joined') {
        setError('Realtime room is not ready');
        return false;
      }

      const request: BoardEventRequestPayload = {
        roomId,
        eventType: operation.eventType,
        baseVersion: useBoardStore.getState().boardVersion,
        payload: operation.payload,
        clientOpId: generateClientOpId()
      };

      socket.emit('board:event', request);

      if (pendingHistory) {
        enqueuePendingHistory(pendingHistory);
      }

      return true;
    },
    [enqueuePendingHistory, roomId, status]
  );

  useEffect(() => {
    if (!enabled || !accessToken || !roomId) {
      pendingHistoryRef.current = [];
      setPendingHistoryCount(0);
      setPresenceUsers([]);
      setRedoStack([]);
      setStatus('idle');
      setUndoStack([]);
      return;
    }

    setError(null);
    pendingHistoryRef.current = [];
    setPendingHistoryCount(0);
    setPresenceUsers([]);
    setRedoStack([]);
    setStatus('connecting');
    setUndoStack([]);

    const socket = io(env.apiBaseUrl, {
      auth: {
        token: accessToken
      },
      transports: ['websocket']
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('room:join', {
        roomId,
        lastKnownVersion: useBoardStore.getState().boardVersion
      });
    });

    socket.on('room:joined', (payload: RoomJoinedPayload) => {
      if (payload.roomId !== roomId) {
        return;
      }

      applyRoomSync(
        payload,
        setBoardSnapshot,
        applyAcceptedCreateEvent,
        applyAcceptedDeleteEvent,
        applyAcceptedUpdateEvent,
        setBoardVersion
      );
      setPresenceUsers(normalizePresenceUsers(payload.users ?? []));
      setStatus('joined');
    });

    socket.on('presence:update', (payload: PresenceUpdatePayload) => {
      if (payload.roomId !== roomId) {
        return;
      }

      setPresenceUsers(normalizePresenceUsers(payload.users));
    });

    socket.on('board:event:accepted', (event: BoardAcceptedEvent) => {
      if (event.roomId !== roomId) {
        return;
      }

      applyAcceptedBoardEvent(
        event,
        applyAcceptedCreateEvent,
        applyAcceptedUpdateEvent,
        applyAcceptedDeleteEvent
      );

      if (event.actorId === currentUserId) {
        completePendingHistory(
          dequeuePendingHistory(),
          setUndoStack,
          setRedoStack
        );
      }
    });

    socket.on('board:event:broadcast', (event: BoardAcceptedEvent) => {
      if (event.roomId !== roomId) {
        return;
      }

      applyAcceptedBoardEvent(
        event,
        applyAcceptedCreateEvent,
        applyAcceptedUpdateEvent,
        applyAcceptedDeleteEvent
      );
    });

    socket.on('board:event:rejected', (payload: BoardEventRejectedPayload) => {
      dequeuePendingHistory();
      setError(payload.message);
    });

    socket.on('error', (payload: SocketErrorPayload) => {
      setError(payload.message);
      setStatus('error');
    });

    socket.on('connect_error', (socketError) => {
      setError(socketError.message);
      setStatus('error');
    });

    socket.on('shape:preview', (payload: ShapePreview) => {
      if (payload.objectId) {
        setPreview(payload);
        // Auto-clear preview after 100ms if no new preview arrives
        setTimeout(() => {
          setPreview((current) =>
            current?.objectId === payload.objectId ? null : current
          );
        }, 100);
      }
    });

    return () => {
      socket.off();
      socket.disconnect();

      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [
    accessToken,
    applyAcceptedCreateEvent,
    applyAcceptedDeleteEvent,
    applyAcceptedUpdateEvent,
    currentUserId,
    dequeuePendingHistory,
    enabled,
    roomId,
    setBoardSnapshot,
    setBoardVersion
  ]);

  const sendRectangleCreate = useCallback(
    (rectangle: BoardObject): boolean => {
      const payload = toCreateBoardObjectPayload(rectangle);
      const entry = createHistoryEntry({
        eventType: 'object:create',
        payload
      });

      return emitBoardEvent(
        {
          eventType: 'object:create',
          payload
        },
        {
          entry,
          kind: 'normal'
        }
      );
    },
    [emitBoardEvent]
  );

  const sendCircleCreate = useCallback(
    (circle: BoardObject): boolean => {
      const payload = toCreateBoardObjectPayload(circle);
      const entry = createHistoryEntry({
        eventType: 'object:create',
        payload
      });

      return emitBoardEvent(
        {
          eventType: 'object:create',
          payload
        },
        {
          entry,
          kind: 'normal'
        }
      );
    },
    [emitBoardEvent]
  );

  const sendLineCreate = useCallback(
    (line: BoardObject): boolean => {
      const payload = toCreateBoardObjectPayload(line);
      const entry = createHistoryEntry({
        eventType: 'object:create',
        payload
      });

      return emitBoardEvent(
        {
          eventType: 'object:create',
          payload
        },
        {
          entry,
          kind: 'normal'
        }
      );
    },
    [emitBoardEvent]
  );

  const sendTextCreate = useCallback(
    (text: BoardObject): boolean => {
      const payload = toCreateBoardObjectPayload(text);
      const entry = createHistoryEntry({
        eventType: 'object:create',
        payload
      });

      return emitBoardEvent(
        {
          eventType: 'object:create',
          payload
        },
        {
          entry,
          kind: 'normal'
        }
      );
    },
    [emitBoardEvent]
  );

  const sendShapePreview = useCallback(
    (objectId: string, transform: Record<string, unknown>) => {
      const socket = socketRef.current;
      if (!socket || !roomId) return;

      socket.emit('shape:preview', {
        roomId,
        objectId,
        transform
      });
    },
    [roomId]
  );

  const sendObjectUpdate = useCallback(
    (payload: UpdateBoardObjectPayload): boolean => {
      const existing = useBoardStore.getState().objects[payload.objectId];

      if (!existing || existing.deleted) {
        setError('Board object is not available for update');
        return false;
      }

      const versionedPayload = {
        ...payload,
        expectedVersion: payload.expectedVersion ?? existing.version
      };
      const entry = createHistoryEntry(
        {
          eventType: 'object:update',
          payload: versionedPayload
        },
        existing
      );

      return emitBoardEvent(
        {
          eventType: 'object:update',
          payload: versionedPayload
        },
        {
          entry,
          kind: 'normal'
        }
      );
    },
    [emitBoardEvent]
  );

  const sendObjectDelete = useCallback(
    (objectId: BoardObjectId): boolean => {
      const existing = useBoardStore.getState().objects[objectId];

      if (!existing || existing.deleted) {
        setError('Board object is not available for delete');
        return false;
      }

      const payload = toDeleteBoardObjectPayload(objectId, existing.version);
      const entry = createHistoryEntry(
        {
          eventType: 'object:delete',
          payload
        },
        existing
      );

      return emitBoardEvent(
        {
          eventType: 'object:delete',
          payload
        },
        {
          entry,
          kind: 'normal'
        }
      );
    },
    [emitBoardEvent]
  );

  const undo = useCallback((): boolean => {
    if (pendingHistoryCount > 0) {
      return false;
    }

    const entry = undoStack.at(-1);

    if (!entry) {
      return false;
    }

    return emitBoardEvent(entry.undo, {
      entry,
      kind: 'undo'
    });
  }, [emitBoardEvent, pendingHistoryCount, undoStack]);

  const redo = useCallback((): boolean => {
    if (pendingHistoryCount > 0) {
      return false;
    }

    const entry = redoStack.at(-1);

    if (!entry) {
      return false;
    }

    return emitBoardEvent(entry.redo, {
      entry,
      kind: 'redo'
    });
  }, [emitBoardEvent, pendingHistoryCount, redoStack]);

  const clearHistory = useCallback(() => {
    pendingHistoryRef.current = [];
    setPendingHistoryCount(0);
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  return {
    canRedo: redoStack.length > 0 && pendingHistoryCount === 0 && status === 'joined',
    canUndo: undoStack.length > 0 && pendingHistoryCount === 0 && status === 'joined',
    clearHistory,
    error,
    pendingHistoryCount,
    presenceUsers,
    preview,
    redo,
    sendCircleCreate,
    sendLineCreate,
    sendObjectDelete,
    sendObjectUpdate,
    sendRectangleCreate,
    sendTextCreate,
    status,
    undo
  };
}

function createHistoryEntry(
  operation: BoardHistoryOperation,
  previousObject?: BoardObject
): BoardHistoryEntry {
  const objectId = getOperationObjectId(operation);

  if (operation.eventType === 'object:create' && isCreateBoardObjectPayload(operation.payload)) {
    return {
      id: createHistoryEntryId(),
      redo: operation,
      undo: {
        eventType: 'object:delete',
        payload: {
          objectId
          // No expectedVersion so undo always succeeds regardless of intermediate operations
        }
      }
    };
  }

  if (
    operation.eventType === 'object:update' &&
    isUpdateBoardObjectPayload(operation.payload) &&
    previousObject
  ) {
    const restorePayload = createRestoreObjectPayload(previousObject, previousObject.version + 1);
    // Remove expectedVersion so undo always succeeds
    delete (restorePayload as { expectedVersion?: number }).expectedVersion;
    return {
      id: createHistoryEntryId(),
      redo: operation,
      undo: {
        eventType: 'object:update',
        payload: restorePayload
      }
    };
  }

  if (
    operation.eventType === 'object:delete' &&
    isDeleteBoardObjectPayload(operation.payload) &&
    previousObject
  ) {
    return {
      id: createHistoryEntryId(),
      redo: operation,
      undo: {
        eventType: 'object:create',
        payload: toCreateBoardObjectPayload(previousObject)
      }
    };
  }

  throw new Error('Unable to create board history entry');
}

function applyRoomSync(
  payload: RoomJoinedPayload,
  setBoardSnapshot: (roomId: string, snapshot: BoardSnapshot, version: number) => void,
  applyAcceptedCreateEvent: (event: BoardCreateAcceptedEvent) => void,
  applyAcceptedDeleteEvent: (event: BoardDeleteAcceptedEvent) => void,
  applyAcceptedUpdateEvent: (event: BoardUpdateAcceptedEvent) => void,
  setBoardVersion: (version: number) => void
) {
  if (payload.syncMode === 'snapshot' && payload.snapshot) {
    setBoardSnapshot(payload.roomId, payload.snapshot, payload.currentVersion);
    return;
  }

  for (const event of payload.missedEvents ?? []) {
    if (event.eventType === 'object:create' && isCreateBoardObjectPayload(event.payload)) {
      applyAcceptedCreateEvent({
        actorId: event.actorId,
        eventType: 'object:create',
        payload: event.payload,
        roomId: event.roomId,
        serverTime: event.createdAt,
        version: event.version
      });
    }

    if (event.eventType === 'object:update' && isUpdateBoardObjectPayload(event.payload)) {
      applyAcceptedUpdateEvent({
        actorId: event.actorId,
        eventType: 'object:update',
        payload: event.payload,
        roomId: event.roomId,
        serverTime: event.createdAt,
        version: event.version
      });
    }

    if (event.eventType === 'object:delete' && isDeleteBoardObjectPayload(event.payload)) {
      applyAcceptedDeleteEvent({
        actorId: event.actorId,
        eventType: 'object:delete',
        payload: event.payload,
        roomId: event.roomId,
        serverTime: event.createdAt,
        version: event.version
      });
    }
  }

  setBoardVersion(payload.currentVersion);
}

function applyAcceptedBoardEvent(
  event: BoardAcceptedEvent,
  applyAcceptedCreateEvent: (event: BoardCreateAcceptedEvent) => void,
  applyAcceptedUpdateEvent: (event: BoardUpdateAcceptedEvent) => void,
  applyAcceptedDeleteEvent: (event: BoardDeleteAcceptedEvent) => void
): void {
  if (event.eventType === 'object:create') {
    applyAcceptedCreateEvent(event);
  }

  if (event.eventType === 'object:update') {
    applyAcceptedUpdateEvent(event);
  }

  if (event.eventType === 'object:delete') {
    applyAcceptedDeleteEvent(event);
  }
}

function completePendingHistory(
  pending: PendingHistoryIntent | null,
  setUndoStack: Dispatch<SetStateAction<BoardHistoryEntry[]>>,
  setRedoStack: Dispatch<SetStateAction<BoardHistoryEntry[]>>
): void {
  if (!pending) {
    return;
  }

  if (pending.kind === 'normal') {
    setUndoStack((stack) => [...stack, pending.entry]);
    setRedoStack([]);
    return;
  }

  if (pending.kind === 'undo') {
    setUndoStack((stack) => removeHistoryEntry(stack, pending.entry));
    setRedoStack((stack) => [...stack, prepareRedoEntryAfterUndo(pending.entry)]);
    return;
  }

  setRedoStack((stack) => removeHistoryEntry(stack, pending.entry));
  setUndoStack((stack) => [...stack, prepareUndoEntryAfterRedo(pending.entry)]);
}

function removeHistoryEntry(
  stack: BoardHistoryEntry[],
  entry: BoardHistoryEntry
): BoardHistoryEntry[] {
  let index = -1;

  for (let candidateIndex = stack.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
    if (stack[candidateIndex].id === entry.id) {
      index = candidateIndex;
      break;
    }
  }

  if (index < 0) {
    return stack;
  }

  return [...stack.slice(0, index), ...stack.slice(index + 1)];
}

// No version math needed — undo/redo payloads don't use expectedVersion
function prepareRedoEntryAfterUndo(entry: BoardHistoryEntry): BoardHistoryEntry {
  return entry;
}

function prepareUndoEntryAfterRedo(entry: BoardHistoryEntry): BoardHistoryEntry {
  return entry;
}

function createRestoreObjectPayload(
  object: BoardObject,
  expectedVersion: number
): UpdateBoardObjectPayload {
  return {
    objectId: object.id,
    expectedVersion,
    patch: {
      x: object.x,
      y: object.y,
      rotation: object.rotation,
      props: { ...object.props },
      metadata: object.metadata ? { ...object.metadata } : undefined
    }
  };
}

function generateClientOpId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getOperationObjectId(operation: BoardHistoryOperation): BoardObjectId {
  if (operation.eventType === 'object:create' && isCreateBoardObjectPayload(operation.payload)) {
    return operation.payload.object.id;
  }

  if (
    (operation.eventType === 'object:update' && isUpdateBoardObjectPayload(operation.payload)) ||
    (operation.eventType === 'object:delete' && isDeleteBoardObjectPayload(operation.payload))
  ) {
    return operation.payload.objectId;
  }

  throw new Error('Board operation is missing an object id');
}

function createHistoryEntryId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `history-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isUpdateBoardObjectPayload(value: unknown): value is UpdateBoardObjectPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'objectId' in value &&
    typeof value.objectId === 'string' &&
    'patch' in value &&
    typeof value.patch === 'object' &&
    value.patch !== null
  );
}

function isCreateBoardObjectPayload(value: unknown): value is CreateBoardObjectPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'object' in value &&
    typeof value.object === 'object' &&
    value.object !== null &&
    'id' in value.object &&
    typeof value.object.id === 'string' &&
    'type' in value.object &&
    ['rectangle', 'circle', 'line', 'text'].includes(value.object.type as string) &&
    'x' in value.object &&
    typeof value.object.x === 'number' &&
    'y' in value.object &&
    typeof value.object.y === 'number'
  );
}

function isDeleteBoardObjectPayload(value: unknown): value is DeleteBoardObjectPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'objectId' in value &&
    typeof value.objectId === 'string'
  );
}

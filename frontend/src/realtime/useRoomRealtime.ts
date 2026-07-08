import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { BoardObject, BoardObjectId } from '@whiteboard/shared';
import { io, type Socket } from 'socket.io-client';
import * as Y from 'yjs';
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
import {
  countPendingOfflineOperations,
  enqueueOfflineOperation,
  listConflictedOfflineOperations,
  listOfflineOperations,
  markOfflineOperationConflicted,
  removeOfflineOperation,
  type QueuedOperation
} from './offlineOutbox';

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

export type BoardConflictDetails = {
  currentVersion: number;
  objectId?: string;
  conflictingFields?: string[];
  clientPatch?: Record<string, unknown>;
  serverPatch?: Record<string, unknown>;
  currentObject?: BoardObject | null;
};

export type BoardEventRejectedPayload = {
  roomId?: string;
  eventType?: BoardEventType;
  reason: string;
  message: string;
  clientOpId?: string;
  details?: BoardConflictDetails;
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
  clientOpId: string;
  entry: BoardHistoryEntry;
  kind: 'normal' | 'redo' | 'undo';
};

type PendingHistoryDraft = Omit<PendingHistoryIntent, 'clientOpId'>;

type BoardSnapshotRestoredPayload = {
  roomId: string;
  version: number;
  restoredFromVersion: number;
  actorId: string;
  snapshot: BoardSnapshot;
  serverTime: string;
};

export type RealtimeStatus = 'idle' | 'connecting' | 'joined' | 'error';

export type ShapePreview = {
  objectId: string;
  transform: Record<string, unknown>;
  byUser: { id: string; displayName: string | null };
};

export type LiveCursor = {
  roomId: string;
  userId: string;
  displayName: string | null;
  socketId: string;
  position: { x: number; y: number };
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

type TextLeaseUpdatePayload =
  | TextLease
  | {
      roomId: string;
      objectId: string;
      lease: TextLease | null;
    };

type TextLeaseDeniedPayload = {
  roomId: string;
  objectId: string;
  lease: TextLease;
  message: string;
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

export function formatBoardEventRejection(payload: BoardEventRejectedPayload): string {
  if (payload.reason !== 'VERSION_CONFLICT') {
    return payload.message;
  }

  const fields = payload.details?.conflictingFields?.filter(Boolean) ?? [];

  if (fields.length === 0) {
    return `${payload.message}. Please refresh and try again.`;
  }

  return `${payload.message}: ${fields.join(', ')}. Please review the latest version.`;
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
  roomId,
  onCommentReceived
}: {
  accessToken: string | null;
  currentUserId: string | null;
  enabled: boolean;
  roomId: string | null;
  onCommentReceived?: (comment: { id: string; body: string; x?: number | null; y?: number | null; objectId?: string | null; authorId: string; createdAt: string }) => void;
}) {
  const socketRef = useRef<Socket | null>(null);
  const optimisticCreatesRef = useRef<Map<string, BoardObjectId>>(new Map());
  const pendingHistoryRef = useRef<PendingHistoryIntent[]>([]);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [lastSnapshotRestore, setLastSnapshotRestore] =
    useState<BoardSnapshotRestoredPayload | null>(null);
  const [pendingHistoryCount, setPendingHistoryCount] = useState(0);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [preview, setPreview] = useState<ShapePreview | null>(null);
  const [liveCursors, setLiveCursors] = useState<LiveCursor[]>([]);
  const [offlineConflicts, setOfflineConflicts] = useState<QueuedOperation[]>([]);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [remoteSelections, setRemoteSelections] = useState<RemoteObjectSelection[]>([]);
  const [redoStack, setRedoStack] = useState<BoardHistoryEntry[]>([]);
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const [textLeases, setTextLeases] = useState<Record<string, TextLease>>({});
  const [undoStack, setUndoStack] = useState<BoardHistoryEntry[]>([]);
  const addObject = useBoardStore((state) => state.addObject);
  const applyAcceptedCreateEvent = useBoardStore((state) => state.applyAcceptedCreateEvent);
  const applyAcceptedDeleteEvent = useBoardStore((state) => state.applyAcceptedDeleteEvent);
  const applyAcceptedUpdateEvent = useBoardStore((state) => state.applyAcceptedUpdateEvent);
  const clearSelection = useBoardStore((state) => state.clearSelection);
  const removeObject = useBoardStore((state) => state.removeObject);
  const setBoardSnapshot = useBoardStore((state) => state.setBoardSnapshot);
  const setBoardVersion = useBoardStore((state) => state.setBoardVersion);

  const enqueuePendingHistory = useCallback((intent: PendingHistoryIntent) => {
    pendingHistoryRef.current = [...pendingHistoryRef.current, intent];
    setPendingHistoryCount(pendingHistoryRef.current.length);
  }, []);

  const removePendingHistory = useCallback((clientOpId?: string): PendingHistoryIntent | null => {
    if (!clientOpId) {
      return null;
    }

    const index = pendingHistoryRef.current.findIndex((intent) => intent.clientOpId === clientOpId);

    if (index < 0) {
      return null;
    }

    const [intent] = pendingHistoryRef.current.splice(index, 1);
    pendingHistoryRef.current = [...pendingHistoryRef.current];
    setPendingHistoryCount(pendingHistoryRef.current.length);
    return intent ?? null;
  }, []);

  const emitBoardEvent = useCallback(
    (operation: BoardHistoryOperation, pendingHistory?: PendingHistoryDraft): boolean => {
      const socket = socketRef.current;

      if (!roomId) {
        setError('Room is not ready');
        return false;
      }

      const request: BoardEventRequestPayload = {
        roomId,
        eventType: operation.eventType,
        baseVersion: useBoardStore.getState().boardVersion,
        payload: operation.payload,
        clientOpId: generateClientOpId()
      };

      if (operation.eventType === 'object:create' && isCreateBoardObjectPayload(operation.payload)) {
        const optimisticObject = createOptimisticObjectFromPayload(
          request.roomId,
          operation.payload,
          currentUserId
        );
        addObject(optimisticObject);
        optimisticCreatesRef.current.set(request.clientOpId, optimisticObject.id);
      }

      if (!socket || !roomId || status !== 'joined') {
        enqueueOfflineOperation({
          id: request.clientOpId,
          roomId: request.roomId,
          eventName: 'board:event',
          payload: request
        }).then(() => setOfflineQueueCount((count) => count + 1))
          .catch((err: unknown) => {
            console.error('Failed to enqueue offline operation:', err);
            setError('Unable to save operation for offline sync');
          });
        setError('Realtime unavailable; operation queued for sync');
        return true;
      }

      if (pendingHistory) {
        enqueuePendingHistory({
          ...pendingHistory,
          clientOpId: request.clientOpId
        });
      }

      socket.emit('board:event', request);

      return true;
    },
    [addObject, currentUserId, enqueuePendingHistory, roomId, status]
  );

  useEffect(() => {
    if (!enabled || !accessToken || !roomId) {
      optimisticCreatesRef.current.clear();
      pendingHistoryRef.current = [];
      setPendingHistoryCount(0);
      setLastSnapshotRestore(null);
      setPresenceUsers([]);
      setLiveCursors([]);
      setOfflineConflicts([]);
      setOfflineQueueCount(0);
      setRemoteSelections([]);
      setRedoStack([]);
      setStatus('idle');
      setTextLeases({});
      setUndoStack([]);
      return;
    }

    setError(null);
    setLastSnapshotRestore(null);
    optimisticCreatesRef.current.clear();
    pendingHistoryRef.current = [];
    setPendingHistoryCount(0);
    setPresenceUsers([]);
    setLiveCursors([]);
    setOfflineConflicts([]);
    setRemoteSelections([]);
    setRedoStack([]);
    setStatus('connecting');
    setTextLeases({});
    setUndoStack([]);

    const socket = io(env.apiBaseUrl, {
      auth: {
        token: accessToken
      },
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
      void replayOfflineOutbox(roomId, socket, setOfflineQueueCount);
      void refreshOfflineState(roomId, setOfflineQueueCount, setOfflineConflicts);
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

      if (event.clientOpId) {
        optimisticCreatesRef.current.delete(event.clientOpId);
        void removeOfflineOperation(event.clientOpId).then(() =>
          refreshOfflineState(roomId, setOfflineQueueCount, setOfflineConflicts)
        );
      }

      if (event.actorId === currentUserId) {
        completePendingHistory(
          removePendingHistory(event.clientOpId),
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
      const optimisticObjectId = payload.clientOpId
        ? optimisticCreatesRef.current.get(payload.clientOpId)
        : undefined;

      if (optimisticObjectId) {
        removeObject(optimisticObjectId);
        optimisticCreatesRef.current.delete(payload.clientOpId ?? '');
      }

      removePendingHistory(payload.clientOpId);
      if (payload.clientOpId) {
        void markOfflineOperationConflicted(payload.clientOpId, payload).then(() =>
          refreshOfflineState(roomId, setOfflineQueueCount, setOfflineConflicts)
        );
      }
      setError(formatBoardEventRejection(payload));
    });

    socket.on('room:error', (payload: SocketErrorPayload) => {
      setError(payload.message);
      setStatus('error');
    });

    socket.on('board:snapshot:restored', (payload: BoardSnapshotRestoredPayload) => {
      if (payload.roomId !== roomId) {
        return;
      }

      optimisticCreatesRef.current.clear();
      pendingHistoryRef.current = [];
      setPendingHistoryCount(0);
      setUndoStack([]);
      setRedoStack([]);
      clearSelection();
      setBoardSnapshot(payload.roomId, payload.snapshot, payload.version);
      setLastSnapshotRestore(payload);
    });

    socket.on('connect_error', (socketError) => {
      setError(socketError.message);
      setStatus('error');
    });

    socket.on('comment:new', (payload: { roomId: string; comment: { id: string; body: string; x?: number | null; y?: number | null; objectId?: string | null; authorId: string; createdAt: string } }) => {
      if (payload.roomId !== roomId) return;
      onCommentReceived?.(payload.comment);
    });

    socket.on('shape:preview', (payload: ShapePreview) => {
      if (payload.objectId) {
        setPreview(payload);
        // Auto-clear preview after 100ms if no new preview arrives
        clearTimeout(previewTimeoutRef.current);
        previewTimeoutRef.current = setTimeout(() => {
          setPreview((current) =>
            current?.objectId === payload.objectId ? null : current
          );
        }, 100);
      }
    });

    socket.on('cursor:broadcast', (payload: LiveCursor) => {
      if (payload.roomId !== roomId || payload.userId === currentUserId) return;
      setLiveCursors((current) => upsertCursor(current, payload));
    });

    socket.on('cursor:remove', (payload: { roomId: string; socketId: string }) => {
      if (payload.roomId !== roomId) return;
      setLiveCursors((current) => current.filter((cursor) => cursor.socketId !== payload.socketId));
    });

    socket.on('selection:broadcast', (payload: RemoteObjectSelection) => {
      if (payload.roomId !== roomId || payload.userId === currentUserId) return;
      setRemoteSelections((current) => upsertSelection(current, payload));
    });

    socket.on('selection:remove', (payload: { roomId: string; socketId: string }) => {
      if (payload.roomId !== roomId) return;
      setRemoteSelections((current) =>
        current.filter((selection) => selection.socketId !== payload.socketId)
      );
    });

    socket.on('text:lease:update', (payload: TextLeaseUpdatePayload) => {
      if ('lease' in payload) {
        if (payload.roomId !== roomId) return;
        setTextLeases((current) => {
          const next = { ...current };
          if (payload.lease) next[payload.objectId] = payload.lease;
          else delete next[payload.objectId];
          return next;
        });
        return;
      }

      if (payload.roomId !== roomId) return;
      setTextLeases((current) => ({ ...current, [payload.objectId]: payload }));
    });

    socket.on('text:lease:denied', (payload: TextLeaseDeniedPayload) => {
      if (payload.roomId !== roomId) return;
      setTextLeases((current) => ({ ...current, [payload.objectId]: payload.lease }));
      setError(payload.message);
    });

    return () => {
      socket.off();
      socket.disconnect();
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = undefined;

      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [
    accessToken,
    applyAcceptedCreateEvent,
    applyAcceptedDeleteEvent,
    applyAcceptedUpdateEvent,
    clearSelection,
    currentUserId,
    enabled,
    removeObject,
    removePendingHistory,
    roomId,
    setBoardSnapshot,
    setBoardVersion
  ]);

  useEffect(() => {
    if (status !== 'joined') return;

    const interval = window.setInterval(() => {
      setTextLeases((current) => removeExpiredLeases(current));
    }, 5_000);

    return () => window.clearInterval(interval);
  }, [status]);

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

  const sendCursorUpdate = useCallback(
    (position: { x: number; y: number }) => {
      const socket = socketRef.current;
      if (!socket || !roomId || status !== 'joined') return;
      socket.emit('cursor:update', { roomId, position });
    },
    [roomId, status]
  );

  const sendSelectionUpdate = useCallback(
    (objectIds: string[], mode: RemoteObjectSelection['mode'] = 'selected') => {
      const socket = socketRef.current;
      if (!socket || !roomId || status !== 'joined') return;
      socket.emit('selection:update', {
        roomId,
        objectIds,
        mode
      });
    },
    [roomId, status]
  );

  const claimTextLease = useCallback(
    (objectId: string): boolean => {
      const socket = socketRef.current;
      if (!socket || !roomId || status !== 'joined') return false;
      const lease = textLeases[objectId];

      if (lease && lease.userId !== currentUserId && isTextLeaseActive(lease)) {
        setError(`${lease.displayName || lease.userId} is editing this text`);
        return false;
      }

      socket.emit('text:lease:claim', { roomId, objectId });
      return true;
    },
    [currentUserId, roomId, status, textLeases]
  );

  const releaseTextLease = useCallback(
    (objectId: string) => {
      const socket = socketRef.current;
      if (!socket || !roomId || status !== 'joined') return;
      socket.emit('text:lease:release', { roomId, objectId });
    },
    [roomId, status]
  );

  const discardOfflineConflict = useCallback(
    async (operationId: string): Promise<void> => {
      await removeOfflineOperation(operationId);

      if (roomId) {
        await refreshOfflineState(roomId, setOfflineQueueCount, setOfflineConflicts);
      }
    },
    [roomId]
  );

  const retryOfflineConflict = useCallback(
    async (operationId: string): Promise<boolean> => {
      const operation = offlineConflicts.find((item) => item.id === operationId);

      if (!operation || !roomId) {
        return false;
      }

      const retryRequest = prepareRetryRequest(operation.payload);

      if (!retryRequest) {
        setError('Unable to retry this conflicted operation');
        return false;
      }

      await removeOfflineOperation(operation.id);

      const socket = socketRef.current;

      if (!socket || status !== 'joined') {
        await enqueueOfflineOperation({
          id: retryRequest.clientOpId,
          roomId: retryRequest.roomId,
          eventName: 'board:event',
          payload: retryRequest,
          status: 'pending'
        });
        setError('Realtime unavailable; retry queued for sync');
      } else {
        socket.emit('board:event', retryRequest);
      }

      await refreshOfflineState(roomId, setOfflineQueueCount, setOfflineConflicts);
      return true;
    },
    [offlineConflicts, roomId, status]
  );

  const sendTextEdit = useCallback(
    (objectId: string, previousText: string, nextText: string): boolean => {
      const socket = socketRef.current;
      if (!socket || !roomId || status !== 'joined') {
        setError('Realtime room is not ready');
        return false;
      }

      const doc = new Y.Doc();
      const text = doc.getText('content');
      text.insert(0, previousText);
      const stateVector = Y.encodeStateVector(doc);
      text.delete(0, previousText.length);
      text.insert(0, nextText);
      const updateBase64 = uint8ToBase64(Y.encodeStateAsUpdate(doc, stateVector));

      socket.emit('text:yjs:update', {
        roomId,
        objectId,
        updateBase64
      });

      return true;
    },
    [roomId, status]
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
    claimTextLease,
    discardOfflineConflict,
    error,
    lastSnapshotRestore,
    liveCursors,
    offlineConflicts,
    offlineQueueCount,
    pendingHistoryCount,
    presenceUsers,
    preview,
    releaseTextLease,
    retryOfflineConflict,
    redo,
    remoteSelections,
    sendCircleCreate,
    sendLineCreate,
    sendObjectDelete,
    sendObjectUpdate,
    sendCursorUpdate,
    sendSelectionUpdate,
    sendRectangleCreate,
    sendTextCreate,
    sendTextEdit,
    sendCommentCreated: useCallback(
      (comment: { id: string; body: string; x?: number | null; y?: number | null; objectId?: string | null; authorId: string; createdAt: string }) => {
        const socket = socketRef.current;
        if (!socket || !roomId) return;
        socket.emit('comment:new', { roomId, comment });
      },
      [roomId]
    ),
    status,
    textLeases,
    undo
  };
}

async function replayOfflineOutbox(
  roomId: string,
  socket: Socket,
  setOfflineQueueCount: Dispatch<SetStateAction<number>>
): Promise<void> {
  const operations = await listOfflineOperations(roomId);
  setOfflineQueueCount(operations.length);

  for (const operation of operations) {
    socket.emit(operation.eventName, operation.payload);
  }
}

async function refreshOfflineState(
  roomId: string,
  setOfflineQueueCount: Dispatch<SetStateAction<number>>,
  setOfflineConflicts: Dispatch<SetStateAction<QueuedOperation[]>>
): Promise<void> {
  const [pendingCount, conflicts] = await Promise.all([
    countPendingOfflineOperations(roomId),
    listConflictedOfflineOperations(roomId)
  ]);
  setOfflineQueueCount(pendingCount);
  setOfflineConflicts(conflicts);
}

function upsertCursor(current: LiveCursor[], cursor: LiveCursor): LiveCursor[] {
  return [
    ...current.filter((item) => item.socketId !== cursor.socketId),
    cursor
  ];
}

function upsertSelection(
  current: RemoteObjectSelection[],
  selection: RemoteObjectSelection
): RemoteObjectSelection[] {
  return [
    ...current.filter((item) => item.socketId !== selection.socketId),
    selection
  ];
}

function createOptimisticObjectFromPayload(
  roomId: string,
  payload: CreateBoardObjectPayload,
  actorId: string | null
): BoardObject {
  const now = new Date().toISOString();

  return {
    id: payload.object.id,
    roomId,
    type: payload.object.type,
    x: payload.object.x,
    y: payload.object.y,
    rotation: payload.object.rotation ?? 0,
    version: 0,
    createdBy: actorId ?? 'local-user',
    updatedBy: actorId ?? 'local-user',
    createdAt: now,
    updatedAt: now,
    deleted: false,
    props: payload.object.props ?? {},
    metadata: payload.object.metadata
  };
}

function isTextLeaseActive(lease: TextLease): boolean {
  return new Date(lease.expiresAt).getTime() > Date.now();
}

function removeExpiredLeases(leases: Record<string, TextLease>): Record<string, TextLease> {
  const next = Object.fromEntries(
    Object.entries(leases).filter(([, lease]) => isTextLeaseActive(lease))
  );

  return Object.keys(next).length === Object.keys(leases).length ? leases : next;
}

function prepareRetryRequest(payload: unknown): BoardEventRequestPayload | null {
  if (!isBoardEventRequestPayload(payload)) {
    return null;
  }

  const state = useBoardStore.getState();
  const retryPayload = prepareRetryPayload(payload.eventType, payload.payload);

  if (!retryPayload) {
    return null;
  }

  return {
    roomId: payload.roomId,
    eventType: payload.eventType,
    baseVersion: state.boardVersion,
    payload: retryPayload,
    clientOpId: generateClientOpId()
  };
}

function prepareRetryPayload(
  eventType: BoardEventType,
  payload: BoardEventPayload
): BoardEventPayload | null {
  const state = useBoardStore.getState();

  if (eventType === 'object:create' && isCreateBoardObjectPayload(payload)) {
    return payload;
  }

  if (eventType === 'object:update' && isUpdateBoardObjectPayload(payload)) {
    const existing = state.objects[payload.objectId];
    if (!existing || existing.deleted) return null;

    return {
      ...payload,
      expectedVersion: existing.version
    };
  }

  if (eventType === 'object:delete' && isDeleteBoardObjectPayload(payload)) {
    const existing = state.objects[payload.objectId];
    if (!existing || existing.deleted) return null;

    return {
      ...payload,
      expectedVersion: existing.version
    };
  }

  return null;
}

function isBoardEventRequestPayload(value: unknown): value is BoardEventRequestPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'roomId' in value &&
    typeof value.roomId === 'string' &&
    'eventType' in value &&
    (value.eventType === 'object:create' ||
      value.eventType === 'object:update' ||
      value.eventType === 'object:delete') &&
    'payload' in value &&
    isRetryableBoardPayload(value.eventType, value.payload)
  );
}

function isRetryableBoardPayload(
  eventType: BoardEventType,
  payload: unknown
): payload is BoardEventPayload {
  return (
    (eventType === 'object:create' && isCreateBoardObjectPayload(payload)) ||
    (eventType === 'object:update' && isUpdateBoardObjectPayload(payload)) ||
    (eventType === 'object:delete' && isDeleteBoardObjectPayload(payload))
  );
}

function uint8ToBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
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
    if (event.eventType === 'history.restore' && isHistoryRestorePayload(event.payload)) {
      setBoardSnapshot(event.roomId, event.payload.restoredSnapshot, event.version);
      continue;
    }

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

function isHistoryRestorePayload(value: unknown): value is { restoredSnapshot: BoardSnapshot } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'restoredSnapshot' in value &&
    typeof value.restoredSnapshot === 'object' &&
    value.restoredSnapshot !== null
  );
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

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardObject } from '@whiteboard/shared';
import { io, type Socket } from 'socket.io-client';
import type { RoomRole } from '../api/client';
import { env } from '../config/env';
import {
  useBoardStore,
  type BoardCreateAcceptedEvent,
  type BoardSnapshot,
  type BoardUpdateAcceptedEvent,
  type CreateBoardObjectPayload,
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
  currentVersion: number;
  syncMode: 'delta' | 'snapshot';
  missedEvents?: BoardMissedEvent[];
  snapshot?: BoardSnapshot;
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
  eventType: 'object:create' | 'object:update';
  baseVersion: number;
  payload: CreateBoardObjectPayload | UpdateBoardObjectPayload;
};

export type RealtimeStatus = 'idle' | 'connecting' | 'joined' | 'error';

export function canMutateRoom(role?: RoomRole): boolean {
  return role === 'OWNER' || role === 'EDITOR';
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

export function useRoomRealtime({
  accessToken,
  enabled,
  roomId
}: {
  accessToken: string | null;
  enabled: boolean;
  roomId: string | null;
}) {
  const socketRef = useRef<Socket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const applyAcceptedCreateEvent = useBoardStore((state) => state.applyAcceptedCreateEvent);
  const applyAcceptedUpdateEvent = useBoardStore((state) => state.applyAcceptedUpdateEvent);
  const setBoardSnapshot = useBoardStore((state) => state.setBoardSnapshot);
  const setBoardVersion = useBoardStore((state) => state.setBoardVersion);

  useEffect(() => {
    if (!enabled || !accessToken || !roomId) {
      setStatus('idle');
      return;
    }

    setError(null);
    setStatus('connecting');

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
        applyAcceptedUpdateEvent,
        setBoardVersion
      );
      setStatus('joined');
    });

    socket.on('board:event:accepted', (event: BoardCreateAcceptedEvent | BoardUpdateAcceptedEvent) => {
      if (event.roomId !== roomId) {
        return;
      }

      if (event.eventType === 'object:create') {
        applyAcceptedCreateEvent(event);
      }

      if (event.eventType === 'object:update') {
        applyAcceptedUpdateEvent(event);
      }
    });

    socket.on('board:event:broadcast', (event: BoardCreateAcceptedEvent | BoardUpdateAcceptedEvent) => {
      if (event.roomId !== roomId) {
        return;
      }

      if (event.eventType === 'object:create') {
        applyAcceptedCreateEvent(event);
      }

      if (event.eventType === 'object:update') {
        applyAcceptedUpdateEvent(event);
      }
    });

    socket.on('board:event:rejected', (payload: BoardEventRejectedPayload) => {
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
    applyAcceptedUpdateEvent,
    enabled,
    roomId,
    setBoardSnapshot,
    setBoardVersion
  ]);

  const sendRectangleCreate = useCallback(
    (rectangle: BoardObject): boolean => {
      const socket = socketRef.current;

      if (!socket || !roomId || status !== 'joined') {
        setError('Realtime room is not ready');
        return false;
      }

      const request: BoardEventRequestPayload = {
        roomId,
        eventType: 'object:create',
        baseVersion: useBoardStore.getState().boardVersion,
        payload: toCreateBoardObjectPayload(rectangle)
      };

      socket.emit('board:event', request);
      return true;
    },
    [roomId, status]
  );

  const sendObjectUpdate = useCallback(
    (payload: UpdateBoardObjectPayload): boolean => {
      const socket = socketRef.current;

      if (!socket || !roomId || status !== 'joined') {
        setError('Realtime room is not ready');
        return false;
      }

      const request: BoardEventRequestPayload = {
        roomId,
        eventType: 'object:update',
        baseVersion: useBoardStore.getState().boardVersion,
        payload
      };

      socket.emit('board:event', request);
      return true;
    },
    [roomId, status]
  );

  return {
    error,
    sendObjectUpdate,
    sendRectangleCreate,
    status
  };
}

function applyRoomSync(
  payload: RoomJoinedPayload,
  setBoardSnapshot: (roomId: string, snapshot: BoardSnapshot, version: number) => void,
  applyAcceptedCreateEvent: (event: BoardCreateAcceptedEvent) => void,
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
  }

  setBoardVersion(payload.currentVersion);
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
    value.object.type === 'rectangle' &&
    'x' in value.object &&
    typeof value.object.x === 'number' &&
    'y' in value.object &&
    typeof value.object.y === 'number'
  );
}

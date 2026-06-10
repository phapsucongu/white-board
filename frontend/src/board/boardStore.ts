import type { BoardObject, BoardObjectId, RoomId } from '@whiteboard/shared';
import { create } from 'zustand';

export type CanvasTool = 'select' | 'pan' | 'rectangle';

export type BoardViewport = {
  x: number;
  y: number;
  scale: number;
};

export type BoardPoint = {
  x: number;
  y: number;
};

export type RectangleGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BoardSnapshot = {
  objects: Record<BoardObjectId, BoardObject>;
};

export type CreateBoardObjectPayload = {
  object: {
    id: BoardObjectId;
    type: BoardObject['type'];
    x: number;
    y: number;
    rotation?: number;
    props?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
};

export type UpdateBoardObjectPayload = {
  objectId: BoardObjectId;
  patch: {
    x?: number;
    y?: number;
    rotation?: number;
    props?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
};

export type BoardCreateAcceptedEvent = {
  actorId: string;
  eventType: 'object:create';
  payload: CreateBoardObjectPayload;
  roomId: RoomId;
  serverTime: string;
  version: number;
};

export type BoardUpdateAcceptedEvent = {
  actorId: string;
  eventType: 'object:update';
  payload: UpdateBoardObjectPayload;
  roomId: RoomId;
  serverTime: string;
  version: number;
};

type CreateLocalRectangleInput = {
  createdBy: string;
  end: BoardPoint;
  id?: BoardObjectId;
  now?: string;
  roomId: RoomId;
  start: BoardPoint;
};

type BoardStore = {
  boardVersion: number;
  objects: Record<BoardObjectId, BoardObject>;
  roomId: RoomId | null;
  selectedObjectId: BoardObjectId | null;
  tool: CanvasTool;
  viewport: BoardViewport;
  addObject: (object: BoardObject) => void;
  applyAcceptedCreateEvent: (event: BoardCreateAcceptedEvent) => void;
  applyAcceptedUpdateEvent: (event: BoardUpdateAcceptedEvent) => void;
  clearSelection: () => void;
  initializeRoom: (roomId: RoomId) => void;
  resetViewport: () => void;
  selectObject: (objectId: BoardObjectId) => void;
  setBoardSnapshot: (roomId: RoomId, snapshot: BoardSnapshot, version: number) => void;
  setBoardVersion: (version: number) => void;
  setTool: (tool: CanvasTool) => void;
  setViewport: (viewport: BoardViewport) => void;
};

const initialViewport: BoardViewport = {
  x: 0,
  y: 0,
  scale: 1
};

const minimumRectangleSize = 4;

export const useBoardStore = create<BoardStore>((set, get) => ({
  boardVersion: 0,
  objects: {},
  roomId: null,
  selectedObjectId: null,
  tool: 'select',
  viewport: initialViewport,
  addObject: (object) =>
    set((state) => ({
      objects: {
        ...state.objects,
        [object.id]: object
      },
      selectedObjectId: object.id
    })),
  applyAcceptedCreateEvent: (event) =>
    set((state) => {
      if (event.version <= state.boardVersion && state.objects[event.payload.object.id]) {
        return {
          boardVersion: Math.max(state.boardVersion, event.version)
        };
      }

      const object = createBoardObjectFromAcceptedCreate(event);

      return {
        boardVersion: Math.max(state.boardVersion, event.version),
        objects: {
          ...state.objects,
          [object.id]: object
        },
        selectedObjectId: state.selectedObjectId === object.id ? object.id : state.selectedObjectId
      };
    }),
  applyAcceptedUpdateEvent: (event) =>
    set((state) => {
      if (event.version <= state.boardVersion) {
        return {
          boardVersion: Math.max(state.boardVersion, event.version)
        };
      }

      const existing = state.objects[event.payload.objectId];

      if (!existing || existing.deleted) {
        return {
          boardVersion: Math.max(state.boardVersion, event.version)
        };
      }

      return {
        boardVersion: event.version,
        objects: {
          ...state.objects,
          [existing.id]: applyObjectPatch(existing, event)
        }
      };
    }),
  clearSelection: () => set({ selectedObjectId: null }),
  initializeRoom: (roomId) => {
    if (get().roomId === roomId) {
      return;
    }

    set({
      objects: {},
      boardVersion: 0,
      roomId,
      selectedObjectId: null,
      tool: 'select',
      viewport: initialViewport
    });
  },
  resetViewport: () => set({ viewport: initialViewport }),
  selectObject: (objectId) => set({ selectedObjectId: objectId, tool: 'select' }),
  setBoardSnapshot: (roomId, snapshot, version) =>
    set({
      boardVersion: version,
      objects: snapshot.objects,
      roomId,
      selectedObjectId: null
    }),
  setBoardVersion: (version) =>
    set((state) => ({
      boardVersion: Math.max(state.boardVersion, version)
    })),
  setTool: (tool) => set({ tool }),
  setViewport: (viewport) => set({ viewport })
}));

export function getVisibleBoardObjects(
  objects: Record<BoardObjectId, BoardObject>
): BoardObject[] {
  return Object.values(objects).filter((object) => !object.deleted);
}

export function normalizeRectangle(start: BoardPoint, end: BoardPoint): RectangleGeometry {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

export function createLocalRectangleObject({
  createdBy,
  end,
  id = createBoardObjectId(),
  now = new Date().toISOString(),
  roomId,
  start
}: CreateLocalRectangleInput): BoardObject | null {
  const geometry = normalizeRectangle(start, end);

  if (geometry.width < minimumRectangleSize || geometry.height < minimumRectangleSize) {
    return null;
  }

  return {
    id,
    roomId,
    type: 'rectangle',
    x: geometry.x,
    y: geometry.y,
    rotation: 0,
    version: 0,
    createdBy,
    updatedBy: createdBy,
    createdAt: now,
    updatedAt: now,
    props: {
      fill: '#dbeafe',
      height: geometry.height,
      stroke: '#1f6feb',
      strokeWidth: 2,
      width: geometry.width
    }
  };
}

function createBoardObjectFromAcceptedCreate(event: BoardCreateAcceptedEvent): BoardObject {
  const { object } = event.payload;

  return {
    id: object.id,
    roomId: event.roomId,
    type: object.type,
    x: object.x,
    y: object.y,
    rotation: object.rotation ?? 0,
    version: 1,
    createdBy: event.actorId,
    updatedBy: event.actorId,
    createdAt: event.serverTime,
    updatedAt: event.serverTime,
    deleted: false,
    props: object.props ?? {},
    metadata: object.metadata
  };
}

function applyObjectPatch(object: BoardObject, event: BoardUpdateAcceptedEvent): BoardObject {
  const patch = event.payload.patch;

  return {
    ...object,
    x: patch.x ?? object.x,
    y: patch.y ?? object.y,
    rotation: patch.rotation ?? object.rotation,
    props: patch.props ? { ...object.props, ...patch.props } : object.props,
    metadata: patch.metadata ? { ...(object.metadata ?? {}), ...patch.metadata } : object.metadata,
    version: object.version + 1,
    updatedBy: event.actorId,
    updatedAt: event.serverTime
  };
}

function createBoardObjectId(): BoardObjectId {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `local-rectangle-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

import type { BoardObject, BoardObjectId, RoomId } from '@whiteboard/shared';
import { create } from 'zustand';

export type CanvasTool = 'select' | 'pan' | 'rectangle' | 'circle' | 'line' | 'text' | 'comment';

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
  expectedVersion?: number;
  patch: {
    x?: number;
    y?: number;
    rotation?: number;
    props?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
};

export type DeleteBoardObjectPayload = {
  objectId: BoardObjectId;
  expectedVersion?: number;
};

export type BoardCreateAcceptedEvent = {
  actorId: string;
  clientOpId?: string;
  eventType: 'object:create';
  payload: CreateBoardObjectPayload;
  roomId: RoomId;
  serverTime: string;
  version: number;
};

export type BoardUpdateAcceptedEvent = {
  actorId: string;
  clientOpId?: string;
  eventType: 'object:update';
  payload: UpdateBoardObjectPayload;
  roomId: RoomId;
  serverTime: string;
  version: number;
};

export type BoardDeleteAcceptedEvent = {
  actorId: string;
  clientOpId?: string;
  eventType: 'object:delete';
  payload: DeleteBoardObjectPayload;
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
  selectedObjectIds: Set<BoardObjectId>;
  tool: CanvasTool;
  viewport: BoardViewport;
  addObject: (object: BoardObject) => void;
  applyAcceptedCreateEvent: (event: BoardCreateAcceptedEvent) => void;
  applyAcceptedDeleteEvent: (event: BoardDeleteAcceptedEvent) => void;
  applyAcceptedUpdateEvent: (event: BoardUpdateAcceptedEvent) => void;
  clearSelection: () => void;
  initializeRoom: (roomId: RoomId) => void;
  resetViewport: () => void;
  removeObject: (objectId: BoardObjectId) => void;
  selectObject: (objectId: BoardObjectId) => void;
  toggleObjectSelection: (objectId: BoardObjectId) => void;
  selectObjectsInRect: (rect: { x: number; y: number; width: number; height: number }) => void;
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
  selectedObjectIds: new Set<BoardObjectId>(),
  tool: 'select',
  viewport: initialViewport,
  addObject: (object) =>
    set((state) => ({
      objects: {
        ...state.objects,
        [object.id]: object
      },
    })),
  applyAcceptedCreateEvent: (event) =>
    set((state) => {
      const existing = state.objects[event.payload.object.id];

      if (event.version <= state.boardVersion && existing && existing.version !== 0) {
        return { boardVersion: Math.max(state.boardVersion, event.version) };
      }

      const object = createBoardObjectFromAcceptedCreate(event);

      return {
        boardVersion: Math.max(state.boardVersion, event.version),
        objects: { ...state.objects, [object.id]: object }
      };
    }),
  applyAcceptedDeleteEvent: (event) =>
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
          [existing.id]: {
            ...existing,
            deleted: true,
            version: existing.version + 1,
            updatedBy: event.actorId,
            updatedAt: event.serverTime
          }
        },
        selectedObjectIds: new Set([...state.selectedObjectIds].filter(id => id !== existing.id))
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
  clearSelection: () => set({ selectedObjectIds: new Set() }),
  initializeRoom: (roomId) => {
    if (get().roomId === roomId) return;
    set({
      objects: {},
      boardVersion: 0,
      roomId,
      selectedObjectIds: new Set(),
      tool: 'select',
      viewport: initialViewport
    });
  },
  resetViewport: () => set({ viewport: initialViewport }),
  removeObject: (objectId) =>
    set((state) => {
      const objects = { ...state.objects };
      delete objects[objectId];
      return {
        objects,
        selectedObjectIds: new Set([...state.selectedObjectIds].filter((id) => id !== objectId))
      };
    }),
  selectObject: (objectId) => set({ selectedObjectIds: new Set([objectId]), tool: 'select' }),
  toggleObjectSelection: (objectId) =>
    set((state) => {
      const next = new Set(state.selectedObjectIds);
      if (next.has(objectId)) next.delete(objectId);
      else next.add(objectId);
      return { selectedObjectIds: next, tool: 'select' };
    }),
  selectObjectsInRect: (rect) =>
    set((state) => {
      const ids = new Set<BoardObjectId>();
      for (const obj of Object.values(state.objects)) {
        if (obj.deleted) continue;
        // Check if object's bounds intersect with selection rect
        const objBounds = getObjectBoundsForSelection(obj);
        if (rectsIntersect(rect, objBounds)) {
          ids.add(obj.id);
        }
      }
      return { selectedObjectIds: ids };
    }),
  setBoardSnapshot: (roomId, snapshot, version) =>
    set({
      boardVersion: version,
      objects: snapshot.objects,
      roomId,
      selectedObjectIds: new Set()
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

  return `local-shape-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getObjectBoundsForSelection(obj: BoardObject): { x: number; y: number; width: number; height: number } {
  if (obj.type === 'circle') {
    const r = typeof obj.props.radius === 'number' ? obj.props.radius : 48;
    return { x: obj.x - r, y: obj.y - r, width: r * 2, height: r * 2 };
  }
  if (obj.type === 'line') {
    const pts = Array.isArray(obj.props.points) ? obj.props.points as number[] : [0, 0, 120, 36];
    const xs = pts.filter((_, i) => i % 2 === 0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    return {
      x: obj.x + Math.min(...xs),
      y: obj.y + Math.min(...ys),
      width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
      height: Math.max(1, Math.max(...ys) - Math.min(...ys))
    };
  }
  const w = typeof obj.props.width === 'number' ? obj.props.width : (obj.type === 'text' ? 220 : 140);
  const h = typeof obj.props.height === 'number' ? obj.props.height : (obj.type === 'text' ? 32 : 90);
  return { x: obj.x, y: obj.y, width: w, height: h };
}

function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function createLocalCircleObject({
  createdBy,
  center,
  id = createBoardObjectId(),
  now = new Date().toISOString(),
  radius,
  roomId
}: {
  createdBy: string;
  center: BoardPoint;
  id?: BoardObjectId;
  now?: string;
  radius: number;
  roomId: RoomId;
}): BoardObject | null {
  if (radius < 4) {
    return null;
  }

  return {
    id,
    roomId,
    type: 'circle',
    x: center.x,
    y: center.y,
    rotation: 0,
    version: 0,
    createdBy,
    updatedBy: createdBy,
    createdAt: now,
    updatedAt: now,
    props: {
      fill: '#ecfccb',
      radius,
      stroke: '#4d7c0f',
      strokeWidth: 2
    }
  };
}

export function createLocalLineObject({
  createdBy,
  end,
  id = createBoardObjectId(),
  now = new Date().toISOString(),
  roomId,
  start
}: {
  createdBy: string;
  end: BoardPoint;
  id?: BoardObjectId;
  now?: string;
  roomId: RoomId;
  start: BoardPoint;
}): BoardObject | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (Math.sqrt(dx * dx + dy * dy) < 4) {
    return null;
  }

  return {
    id,
    roomId,
    type: 'line',
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    rotation: 0,
    version: 0,
    createdBy,
    updatedBy: createdBy,
    createdAt: now,
    updatedAt: now,
    props: {
      fill: 'transparent',
      points: [start.x - Math.min(start.x, end.x), start.y - Math.min(start.y, end.y), end.x - Math.min(start.x, end.x), end.y - Math.min(start.y, end.y)],
      stroke: '#0f766e',
      strokeWidth: 4
    }
  };
}

export function createLocalTextObject({
  createdBy,
  id = createBoardObjectId(),
  now = new Date().toISOString(),
  position,
  roomId,
  text
}: {
  createdBy: string;
  id?: BoardObjectId;
  now?: string;
  position: BoardPoint;
  roomId: RoomId;
  text: string;
}): BoardObject {
  return {
    id,
    roomId,
    type: 'text',
    x: position.x,
    y: position.y,
    rotation: 0,
    version: 0,
    createdBy,
    updatedBy: createdBy,
    createdAt: now,
    updatedAt: now,
    props: {
      fill: '#dae2fd',
      fontSize: 20,
      text,
      width: 220
    }
  };
}

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

type CreateLocalRectangleInput = {
  createdBy: string;
  end: BoardPoint;
  id?: BoardObjectId;
  now?: string;
  roomId: RoomId;
  start: BoardPoint;
};

type BoardStore = {
  objects: Record<BoardObjectId, BoardObject>;
  roomId: RoomId | null;
  selectedObjectId: BoardObjectId | null;
  tool: CanvasTool;
  viewport: BoardViewport;
  addObject: (object: BoardObject) => void;
  clearSelection: () => void;
  initializeRoom: (roomId: RoomId) => void;
  resetViewport: () => void;
  selectObject: (objectId: BoardObjectId) => void;
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
  clearSelection: () => set({ selectedObjectId: null }),
  initializeRoom: (roomId) => {
    if (get().roomId === roomId) {
      return;
    }

    set({
      objects: createInitialObjects(roomId),
      roomId,
      selectedObjectId: null,
      tool: 'select',
      viewport: initialViewport
    });
  },
  resetViewport: () => set({ viewport: initialViewport }),
  selectObject: (objectId) => set({ selectedObjectId: objectId, tool: 'select' }),
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

function createBoardObjectId(): BoardObjectId {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `local-rectangle-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createInitialObjects(roomId: RoomId): Record<BoardObjectId, BoardObject> {
  const now = new Date().toISOString();
  const userId = 'local-user';
  const objects: BoardObject[] = [
    {
      id: 'local-rectangle-1',
      roomId,
      type: 'rectangle',
      x: 96,
      y: 96,
      rotation: 0,
      version: 0,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
      props: {
        fill: '#dbeafe',
        height: 96,
        stroke: '#1f6feb',
        strokeWidth: 2,
        width: 164
      }
    },
    {
      id: 'local-circle-1',
      roomId,
      type: 'circle',
      x: 360,
      y: 144,
      rotation: 0,
      version: 0,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
      props: {
        fill: '#ecfccb',
        radius: 52,
        stroke: '#4d7c0f',
        strokeWidth: 2
      }
    },
    {
      id: 'local-line-1',
      roomId,
      type: 'line',
      x: 126,
      y: 286,
      rotation: 0,
      version: 0,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
      props: {
        points: [0, 0, 98, 42, 202, 8],
        stroke: '#0f766e',
        strokeWidth: 4
      }
    },
    {
      id: 'local-text-1',
      roomId,
      type: 'text',
      x: 352,
      y: 292,
      rotation: 0,
      version: 0,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
      props: {
        fill: '#172026',
        fontSize: 22,
        text: 'Local canvas shell',
        width: 240
      }
    }
  ];

  return Object.fromEntries(objects.map((object) => [object.id, object]));
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Circle, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type { BoardObject, BoardObjectId, RoomId } from '@whiteboard/shared';
import {
  createLocalRectangleObject,
  getVisibleBoardObjects,
  normalizeRectangle,
  useBoardStore,
  type BoardPoint
} from './boardStore';

type BoardCanvasProps = {
  currentUserId: string;
  roomId: RoomId;
};

type CanvasSize = {
  width: number;
  height: number;
};

type ObjectBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const defaultCanvasSize: CanvasSize = {
  width: 960,
  height: 560
};

type RectangleDraft = {
  current: BoardPoint;
  start: BoardPoint;
};

export function BoardCanvas({ currentUserId, roomId }: BoardCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState(defaultCanvasSize);
  const [rectangleDraft, setRectangleDraft] = useState<RectangleDraft | null>(null);
  const objectsById = useBoardStore((state) => state.objects);
  const selectedObjectId = useBoardStore((state) => state.selectedObjectId);
  const tool = useBoardStore((state) => state.tool);
  const viewport = useBoardStore((state) => state.viewport);
  const addObject = useBoardStore((state) => state.addObject);
  const clearSelection = useBoardStore((state) => state.clearSelection);
  const initializeRoom = useBoardStore((state) => state.initializeRoom);
  const resetViewport = useBoardStore((state) => state.resetViewport);
  const selectObject = useBoardStore((state) => state.selectObject);
  const setTool = useBoardStore((state) => state.setTool);
  const setViewport = useBoardStore((state) => state.setViewport);
  const objects = useMemo(() => getVisibleBoardObjects(objectsById), [objectsById]);
  const draftRectangle = useMemo(
    () =>
      rectangleDraft
        ? normalizeRectangle(rectangleDraft.start, rectangleDraft.current)
        : null,
    [rectangleDraft]
  );
  const selectedObject = useMemo(
    () => objects.find((object) => object.id === selectedObjectId) ?? null,
    [objects, selectedObjectId]
  );

  useEffect(() => {
    initializeRoom(roomId);
  }, [initializeRoom, roomId]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      setCanvasSize({
        width: Math.max(320, Math.floor(entry.contentRect.width)),
        height: defaultCanvasSize.height
      });
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();

    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();

    if (!pointer) {
      return;
    }

    const scaleBy = 1.08;
    const oldScale = viewport.scale;
    const mousePointTo = {
      x: (pointer.x - viewport.x) / oldScale,
      y: (pointer.y - viewport.y) / oldScale
    };
    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const nextScale = clampScale(direction > 0 ? oldScale * scaleBy : oldScale / scaleBy);

    setViewport({
      x: pointer.x - mousePointTo.x * nextScale,
      y: pointer.y - mousePointTo.y * nextScale,
      scale: nextScale
    });
  };

  const handleStageDragEnd = (event: Konva.KonvaEventObject<DragEvent>) => {
    setViewport({
      ...viewport,
      x: event.target.x(),
      y: event.target.y()
    });
  };

  const handleStageMouseDown = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool !== 'rectangle' || event.evt.button !== 0) {
      return;
    }

    const point = getBoardPoint(event.target.getStage(), viewport);

    if (!point) {
      return;
    }

    clearSelection();
    setRectangleDraft({
      start: point,
      current: point
    });
  };

  const handleStageMouseMove = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool !== 'rectangle' || !rectangleDraft) {
      return;
    }

    const point = getBoardPoint(event.target.getStage(), viewport);

    if (!point) {
      return;
    }

    setRectangleDraft({
      ...rectangleDraft,
      current: point
    });
  };

  const handleStageMouseUp = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool !== 'rectangle' || !rectangleDraft) {
      return;
    }

    const point = getBoardPoint(event.target.getStage(), viewport) ?? rectangleDraft.current;
    const rectangle = createLocalRectangleObject({
      createdBy: currentUserId,
      end: point,
      roomId,
      start: rectangleDraft.start
    });

    setRectangleDraft(null);

    if (rectangle) {
      addObject(rectangle);
    }
  };

  return (
    <section className="canvas-workspace" aria-label="Canvas shell">
      <div className="canvas-toolbar" aria-label="Canvas toolbar">
        <div className="toolbar-group" role="group" aria-label="Canvas tools">
          <button
            className={tool === 'select' ? 'tool-button active-tool' : 'tool-button'}
            type="button"
            onClick={() => setTool('select')}
          >
            Select
          </button>
          <button
            className={tool === 'rectangle' ? 'tool-button active-tool' : 'tool-button'}
            type="button"
            onClick={() => setTool('rectangle')}
          >
            Rectangle
          </button>
          <button
            className={tool === 'pan' ? 'tool-button active-tool' : 'tool-button'}
            type="button"
            onClick={() => setTool('pan')}
          >
            Pan
          </button>
        </div>
        <div className="toolbar-group" aria-label="Canvas view">
          <span className="zoom-label">{Math.round(viewport.scale * 100)}%</span>
          <button className="tool-button" type="button" onClick={resetViewport}>
            Reset View
          </button>
        </div>
      </div>

      <div className="canvas-frame" ref={containerRef}>
        <Stage
          width={canvasSize.width}
          height={canvasSize.height}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          draggable={tool === 'pan'}
          onClick={(event) => {
            if (tool === 'select' && event.target === event.target.getStage()) {
              clearSelection();
            }
          }}
          onDragEnd={handleStageDragEnd}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onWheel={handleWheel}
        >
          <Layer listening={false}>
            <CanvasGrid width={canvasSize.width} height={canvasSize.height} viewportScale={viewport.scale} />
          </Layer>
          <Layer listening={tool === 'select'}>
            {objects.map((object) => (
              <BoardObjectShape
                key={object.id}
                object={object}
                selected={object.id === selectedObjectId}
                onSelect={selectObject}
              />
            ))}
          </Layer>
          <Layer listening={false}>
            {selectedObject && <SelectionBox bounds={getObjectBounds(selectedObject)} />}
            {draftRectangle && (
              <Rect
                x={draftRectangle.x}
                y={draftRectangle.y}
                width={draftRectangle.width}
                height={draftRectangle.height}
                fill="#dbeafe"
                opacity={0.45}
                stroke="#1f6feb"
                strokeWidth={2}
                dash={[6, 4]}
              />
            )}
          </Layer>
        </Stage>
      </div>
    </section>
  );
}

function BoardObjectShape({
  object,
  onSelect,
  selected
}: {
  object: BoardObject;
  onSelect: (objectId: BoardObjectId) => void;
  selected: boolean;
}) {
  const commonProps = {
    rotation: object.rotation ?? 0,
    shadowBlur: selected ? 8 : 0,
    shadowColor: '#1f6feb',
    x: object.x,
    y: object.y,
    onClick: () => onSelect(object.id),
    onTap: () => onSelect(object.id)
  };

  if (object.type === 'rectangle') {
    return (
      <Rect
        {...commonProps}
        width={getNumberProp(object, 'width', 140)}
        height={getNumberProp(object, 'height', 90)}
        fill={getStringProp(object, 'fill', '#dbeafe')}
        stroke={getStringProp(object, 'stroke', '#1f6feb')}
        strokeWidth={getNumberProp(object, 'strokeWidth', 2)}
      />
    );
  }

  if (object.type === 'circle') {
    return (
      <Circle
        {...commonProps}
        radius={getNumberProp(object, 'radius', 48)}
        fill={getStringProp(object, 'fill', '#ecfccb')}
        stroke={getStringProp(object, 'stroke', '#4d7c0f')}
        strokeWidth={getNumberProp(object, 'strokeWidth', 2)}
      />
    );
  }

  if (object.type === 'line') {
    return (
      <Line
        {...commonProps}
        points={getNumberArrayProp(object, 'points', [0, 0, 120, 36])}
        stroke={getStringProp(object, 'stroke', '#0f766e')}
        strokeWidth={getNumberProp(object, 'strokeWidth', 4)}
        lineCap="round"
        lineJoin="round"
      />
    );
  }

  return (
    <Text
      {...commonProps}
      text={getStringProp(object, 'text', 'Text')}
      width={getNumberProp(object, 'width', 220)}
      fill={getStringProp(object, 'fill', '#172026')}
      fontSize={getNumberProp(object, 'fontSize', 20)}
      fontStyle="600"
    />
  );
}

function SelectionBox({ bounds }: { bounds: ObjectBounds }) {
  return (
    <Rect
      x={bounds.x - 8}
      y={bounds.y - 8}
      width={bounds.width + 16}
      height={bounds.height + 16}
      stroke="#1f6feb"
      strokeWidth={1.5}
      dash={[6, 4]}
      listening={false}
    />
  );
}

function CanvasGrid({
  height,
  viewportScale,
  width
}: {
  height: number;
  viewportScale: number;
  width: number;
}) {
  const gridSize = 40;
  const lineCountX = Math.ceil(width / Math.max(1, viewportScale) / gridSize) + 16;
  const lineCountY = Math.ceil(height / Math.max(1, viewportScale) / gridSize) + 16;
  const lines = [];

  for (let index = -8; index < lineCountX; index += 1) {
    const x = index * gridSize;
    lines.push(<Line key={`x-${index}`} points={[x, -320, x, height + 320]} stroke="#e7ebef" strokeWidth={1} />);
  }

  for (let index = -8; index < lineCountY; index += 1) {
    const y = index * gridSize;
    lines.push(<Line key={`y-${index}`} points={[-320, y, width + 320, y]} stroke="#e7ebef" strokeWidth={1} />);
  }

  return <>{lines}</>;
}

function getObjectBounds(object: BoardObject): ObjectBounds {
  if (object.type === 'circle') {
    const radius = getNumberProp(object, 'radius', 48);

    return {
      x: object.x - radius,
      y: object.y - radius,
      width: radius * 2,
      height: radius * 2
    };
  }

  if (object.type === 'line') {
    const points = getNumberArrayProp(object, 'points', [0, 0, 120, 36]);
    const xPoints = points.filter((_, index) => index % 2 === 0);
    const yPoints = points.filter((_, index) => index % 2 === 1);
    const minX = Math.min(...xPoints);
    const maxX = Math.max(...xPoints);
    const minY = Math.min(...yPoints);
    const maxY = Math.max(...yPoints);

    return {
      x: object.x + minX,
      y: object.y + minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY)
    };
  }

  return {
    x: object.x,
    y: object.y,
    width: getNumberProp(object, 'width', object.type === 'text' ? 220 : 140),
    height: getNumberProp(object, 'height', object.type === 'text' ? 32 : 90)
  };
}

function getNumberProp(object: BoardObject, key: string, fallback: number): number {
  const value = object.props[key];

  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getStringProp(object: BoardObject, key: string, fallback: string): string {
  const value = object.props[key];

  return typeof value === 'string' ? value : fallback;
}

function getNumberArrayProp(object: BoardObject, key: string, fallback: number[]): number[] {
  const value = object.props[key];

  if (!Array.isArray(value) || !value.every((item) => typeof item === 'number')) {
    return fallback;
  }

  return value;
}

function clampScale(scale: number): number {
  return Math.min(2.5, Math.max(0.35, scale));
}

function getBoardPoint(
  stage: Konva.Stage | null,
  viewport: { scale: number; x: number; y: number }
): BoardPoint | null {
  const pointer = stage?.getPointerPosition();

  if (!pointer) {
    return null;
  }

  return {
    x: (pointer.x - viewport.x) / viewport.scale,
    y: (pointer.y - viewport.y) / viewport.scale
  };
}

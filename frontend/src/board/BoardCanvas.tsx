import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Circle, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva';
import type { BoardObject, BoardObjectId, RoomId } from '@whiteboard/shared';
import {
  createLocalCircleObject,
  createLocalLineObject,
  createLocalRectangleObject,
  createLocalTextObject,
  getVisibleBoardObjects,
  normalizeRectangle,
  useBoardStore,
  type BoardPoint
} from './boardStore';
import { ToolButton } from '../components/ui/tool-button';

type BoardCanvasProps = {
  canDrawRectangle: boolean;
  canRedo: boolean;
  canEditObjects: boolean;
  canUndo: boolean;
  currentUserId: string;
  onCircleCommit: (circle: BoardObject) => void;
  onLineCommit: (line: BoardObject) => void;
  onObjectMoveCommit: (objectId: BoardObjectId, position: { x: number; y: number }) => void;
  onObjectTransformCommit: (
    objectId: BoardObjectId,
    transform: { x: number; y: number; rotation: number; width?: number; height?: number }
  ) => void;
  onObjectsDelete?: (objectIds: BoardObjectId[]) => void;
  onRectangleCommit: (rectangle: BoardObject) => void;
  onTextCommit: (text: BoardObject) => void;
  onRedo: () => void;
  onUndo: () => void;
  roomId: RoomId;
};

type CanvasSize = { width: number; height: number };
type ObjectBounds = { x: number; y: number; width: number; height: number };

const defaultCanvasSize: CanvasSize = { width: 960, height: 560 };

type CircleDraft = { center: BoardPoint; current: BoardPoint };
type LineDraft = { current: BoardPoint; start: BoardPoint };
type RectangleDraft = { current: BoardPoint; start: BoardPoint };
type TextInputState = { position: BoardPoint; visible: boolean };

type SelectionRect = { x: number; y: number; width: number; height: number } | null;

export const BoardCanvas = memo(function BoardCanvas({
  canDrawRectangle,
  canEditObjects,
  canRedo,
  canUndo,
  currentUserId,
  onCircleCommit,
  onLineCommit,
  onObjectMoveCommit,
  onObjectTransformCommit,
  onObjectsDelete,
  onRectangleCommit,
  onTextCommit,
  onRedo,
  onUndo,
  roomId
}: BoardCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const shapeRefs = useRef<Record<BoardObjectId, Konva.Node | null>>({});
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const [canvasSize, setCanvasSize] = useState(defaultCanvasSize);
  const [circleDraft, setCircleDraft] = useState<CircleDraft | null>(null);
  const [lineDraft, setLineDraft] = useState<LineDraft | null>(null);
  const [rectangleDraft, setRectangleDraft] = useState<RectangleDraft | null>(null);
  const [textInput, setTextInput] = useState<TextInputState>({ position: { x: 0, y: 0 }, visible: false });
  const [textValue, setTextValue] = useState('');
  const [selectionRect, setSelectionRect] = useState<SelectionRect>(null);
  const [selStart, setSelStart] = useState<BoardPoint | null>(null);

  const objectsById = useBoardStore((state) => state.objects);
  const selectedObjectIds = useBoardStore((state) => state.selectedObjectIds);
  const tool = useBoardStore((state) => state.tool);
  const viewport = useBoardStore((state) => state.viewport);
  const clearSelection = useBoardStore((state) => state.clearSelection);
  const initializeRoom = useBoardStore((state) => state.initializeRoom);
  const resetViewport = useBoardStore((state) => state.resetViewport);
  const selectObject = useBoardStore((state) => state.selectObject);
  const toggleObjectSelection = useBoardStore((state) => state.toggleObjectSelection);
  const selectObjectsInRect = useBoardStore((state) => state.selectObjectsInRect);
  const setTool = useBoardStore((state) => state.setTool);
  const setViewport = useBoardStore((state) => state.setViewport);

  const objects = useMemo(() => getVisibleBoardObjects(objectsById), [objectsById]);
  const selectedObjects = useMemo(
    () => objects.filter((o) => selectedObjectIds.has(o.id)),
    [objects, selectedObjectIds]
  );
  const isDrawingTool = tool === 'rectangle' || tool === 'circle' || tool === 'line';
  const canTransform = canEditObjects && tool === 'select';

  const draftRectangle = useMemo(
    () => (rectangleDraft ? normalizeRectangle(rectangleDraft.start, rectangleDraft.current) : null),
    [rectangleDraft]
  );
  const draftRadius = useMemo(
    () =>
      circleDraft
        ? Math.sqrt((circleDraft.current.x - circleDraft.center.x) ** 2 + (circleDraft.current.y - circleDraft.center.y) ** 2)
        : null,
    [circleDraft]
  );

  useEffect(() => { initializeRoom(roomId); }, [initializeRoom, roomId]);

  // Attach Transformer to all selected nodes
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer || !canTransform || selectedObjects.length === 0) {
      transformer?.nodes([]);
      return;
    }
    const nodes = selectedObjects
      .map((o) => shapeRefs.current[o.id])
      .filter((n): n is Konva.Node => n !== null && n !== undefined);
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [canTransform, selectedObjects]);

  // Disable drawing tools if not allowed
  useEffect(() => {
    if (!canDrawRectangle && (tool === 'rectangle' || tool === 'circle' || tool === 'line' || tool === 'text')) {
      setRectangleDraft(null);
      setCircleDraft(null);
      setLineDraft(null);
      setTool('select');
    }
  }, [canDrawRectangle, setTool, tool]);

  // Canvas resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      setCanvasSize({ width: Math.max(320, Math.floor(entry.contentRect.width)), height: defaultCanvasSize.height });
    });
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Track selection drag state in ref for window-level handlers
  const selDragRef = useRef<{
    active: boolean;
    start: BoardPoint;
    end: BoardPoint;
  }>({ active: false, start: { x: 0, y: 0 }, end: { x: 0, y: 0 } });

  // ── Window-level mouse handlers for rubber-band selection ──
  useEffect(() => {
    const handleMouseUp = () => {
      const d = selDragRef.current;
      if (!d.active) return;
      d.active = false;

      const rect = normalizeRectangle(d.start, d.end);
      if (rect.width > 2 && rect.height > 2) {
        // Find all objects within selection rectangle
        const store = useBoardStore.getState();
        const ids = new Set<BoardObjectId>();
        for (const obj of Object.values(store.objects)) {
          if (obj.deleted) continue;
          const b = getObjectBoundsForSel(obj);
          if (rectsIntersectLocal(rect, b)) ids.add(obj.id);
        }
        if (ids.size > 0) {
          useBoardStore.setState({ selectedObjectIds: ids });
        }
      }
      setSelectionRect(null);
      setSelStart(null);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const d = selDragRef.current;
      if (!d.active || !containerRef.current) return;
      const cRect = containerRef.current.getBoundingClientRect();
      const s = useBoardStore.getState().viewport;
      const mx = (e.clientX - cRect.left - s.x) / s.scale;
      const my = (e.clientY - cRect.top - s.y) / s.scale;
      d.end = { x: mx, y: my };
      setSelectionRect(normalizeRectangle(d.start, d.end));
    };

    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);


  // Refs for keyboard shortcuts to avoid stale closures
  const canUndoRef = useRef(canUndo);
  canUndoRef.current = canUndo;
  const canRedoRef = useRef(canRedo);
  canRedoRef.current = canRedo;
  const onUndoRef = useRef(onUndo);
  onUndoRef.current = onUndo;
  const onRedoRef = useRef(onRedo);
  onRedoRef.current = onRedo;
  const onObjectsDeleteRef = useRef(onObjectsDelete);
  onObjectsDeleteRef.current = onObjectsDelete;
  const canEditRef = useRef(canEditObjects);
  canEditRef.current = canEditObjects;

  // ── Keyboard Shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+= or Ctrl+Shift+= (zoom in)
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        const s = useBoardStore.getState().viewport;
        setViewport({ ...s, scale: clampScale(s.scale * 1.15) });
        return;
      }
      // Ctrl+- (zoom out)
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        const s = useBoardStore.getState().viewport;
        setViewport({ ...s, scale: clampScale(s.scale / 1.15) });
        return;
      }
      // Ctrl+0 reset zoom
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        resetViewport();
        return;
      }
      // Ctrl+Z: Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndoRef.current) onUndoRef.current();
        return;
      }
      // Ctrl+Shift+Z or Ctrl+Y: Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'Z' && e.shiftKey))) {
        e.preventDefault();
        if (canRedoRef.current) onRedoRef.current();
        return;
      }
      // Delete / Backspace: delete selected objects
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        const ids = useBoardStore.getState().selectedObjectIds;
        if (ids.size > 0 && canEditRef.current && onObjectsDeleteRef.current) {
          onObjectsDeleteRef.current([...ids]);
          clearSelection();
        }
        return;
      }
      // Escape: clear selection
      if (e.key === 'Escape') {
        clearSelection();
        setTool('select');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelection, resetViewport, setTool, setViewport]);

  const handleWheel = useCallback(
    (event: Konva.KonvaEventObject<WheelEvent>) => {
      event.evt.preventDefault();
      const stage = event.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      const scaleBy = 1.08;
      const oldScale = viewport.scale;
      const mousePointTo = { x: (pointer.x - viewport.x) / oldScale, y: (pointer.y - viewport.y) / oldScale };
      const direction = event.evt.deltaY > 0 ? -1 : 1;
      const nextScale = clampScale(direction > 0 ? oldScale * scaleBy : oldScale / scaleBy);
      setViewport({ x: pointer.x - mousePointTo.x * nextScale, y: pointer.y - mousePointTo.y * nextScale, scale: nextScale });
    },
    [viewport, setViewport]
  );

  // Pan
  const handleStageDragEnd = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>) => {
      if (event.target !== event.target.getStage()) return;
      setViewport({ ...viewport, x: event.target.x(), y: event.target.y() });
    },
    [viewport, setViewport]
  );

  // Mouse down: start drawing OR start rubber-band selection
  const handleStageMouseDown = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      if (event.evt.button !== 0) return;

      // Text tool
      if (tool === 'text' && canDrawRectangle) {
        const pt = getBoardPoint(event.target.getStage(), viewport);
        if (!pt) return;
        clearSelection();
        setTextInput({ position: pt, visible: true });
        setTextValue('');
        return;
      }

      // Drawing tools
      if (isDrawingTool && canDrawRectangle) {
        const pt = getBoardPoint(event.target.getStage(), viewport);
        if (!pt) return;
        clearSelection();
        if (tool === 'rectangle') setRectangleDraft({ start: pt, current: pt });
        else if (tool === 'circle') setCircleDraft({ center: pt, current: pt });
        else if (tool === 'line') setLineDraft({ start: pt, current: pt });
        return;
      }

      // Select tool: start rubber-band on empty area
      if (tool === 'select' && event.target === event.target.getStage()) {
        const pt = getBoardPoint(event.target.getStage(), viewport);
        if (!pt) return;
        if (!event.evt.shiftKey) clearSelection();
        selDragRef.current = { start: pt, end: pt, active: true };
        setSelStart(pt);
        setSelectionRect({ x: pt.x, y: pt.y, width: 0, height: 0 });
      }
    },
    [tool, canDrawRectangle, clearSelection, viewport, isDrawingTool]
  );

  // Mouse move: update draft OR update selection rect
  const handleStageMouseMove = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      const pt = getBoardPoint(event.target.getStage(), viewport);
      if (!pt) return;

      // Update drawing draft
      if (tool === 'rectangle' && rectangleDraft) {
        setRectangleDraft({ ...rectangleDraft, current: pt });
        return;
      }
      if (tool === 'circle' && circleDraft) {
        setCircleDraft({ ...circleDraft, current: pt });
        return;
      }
      if (tool === 'line' && lineDraft) {
        setLineDraft({ ...lineDraft, current: pt });
        return;
      }

      // Update selection rectangle
      if (selStart && selectionRect) {
        setSelectionRect(normalizeRectangle(selStart, pt));
      }
    },
    [tool, rectangleDraft, circleDraft, lineDraft, selStart, selectionRect, viewport]
  );

  // Mouse up: finalize drawing OR finalize selection
  const handleStageMouseUp = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      const pt = getBoardPoint(event.target.getStage(), viewport);

      // Finalize drawing
      if (tool === 'rectangle' && rectangleDraft) {
        const fp = pt ?? rectangleDraft.current;
        const rect = createLocalRectangleObject({ createdBy: currentUserId, end: fp, roomId, start: rectangleDraft.start });
        setRectangleDraft(null);
        if (rect) onRectangleCommit(rect);
        return;
      }
      if (tool === 'circle' && circleDraft) {
        const fp = pt ?? circleDraft.current;
        const r = Math.sqrt((fp.x - circleDraft.center.x) ** 2 + (fp.y - circleDraft.center.y) ** 2);
        const circle = createLocalCircleObject({ center: circleDraft.center, createdBy: currentUserId, radius: r, roomId });
        setCircleDraft(null);
        if (circle) onCircleCommit(circle);
        return;
      }
      if (tool === 'line' && lineDraft) {
        const fp = pt ?? lineDraft.current;
        const line = createLocalLineObject({ createdBy: currentUserId, end: fp, roomId, start: lineDraft.start });
        setLineDraft(null);
        if (line) onLineCommit(line);
        return;
      }

      // Finalize rubber-band selection
      if (selectionRect && selStart) {
        selectObjectsInRect(selectionRect);
        setSelectionRect(null);
        setSelStart(null);
      }
    },
    [tool, rectangleDraft, circleDraft, lineDraft, selectionRect, selStart, viewport, currentUserId, roomId, onRectangleCommit, onCircleCommit, onLineCommit, selectObjectsInRect]
  );

  // Object drag end
  const handleObjectDragEnd = useCallback(
    (objectId: BoardObjectId, event: Konva.KonvaEventObject<DragEvent>) => {
      if (!canEditObjects) return;
      onObjectMoveCommit(objectId, { x: event.target.x(), y: event.target.y() });
    },
    [canEditObjects, onObjectMoveCommit]
  );

  // Object transform end (resize/rotate)
  const handleTransformEnd = useCallback(
    (objectId: BoardObjectId, event: Konva.KonvaEventObject<Event>) => {
      if (!canEditObjects) return;
      const node = event.target;
      const sx = node.scaleX(); const sy = node.scaleY();
      node.scaleX(1); node.scaleY(1);
      onObjectTransformCommit(objectId, {
        x: node.x(), y: node.y(), rotation: node.rotation(),
        width: node.width() ? Math.max(4, node.width() * sx) : undefined,
        height: node.height() ? Math.max(4, node.height() * sy) : undefined
      });
    },
    [canEditObjects, onObjectTransformCommit]
  );

  const handleTextSubmit = useCallback(() => {
    const trimmed = textValue.trim();
    setTextInput({ position: { x: 0, y: 0 }, visible: false });
    setTextValue('');
    if (!trimmed) return;
    const textObj = createLocalTextObject({ createdBy: currentUserId, position: textInput.position, roomId, text: trimmed });
    onTextCommit(textObj);
  }, [currentUserId, onTextCommit, roomId, textInput.position, textValue]);

  return (
    <section className="relative flex-1 flex flex-col" aria-label="Canvas shell">
      {/* Floating Left Toolbar */}
      <nav className="absolute left-6 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 py-4 z-40 rounded-full glass-panel shadow-lg">
        <ToolButton icon="near_me" label="Select (V)" active={tool === 'select'} onClick={() => setTool('select')} />
        <ToolButton icon="crop_3_2" label="Rectangle (R)" active={tool === 'rectangle'} disabled={!canDrawRectangle} onClick={() => setTool('rectangle')} />
        <ToolButton icon="circle" label="Circle (C)" active={tool === 'circle'} disabled={!canDrawRectangle} onClick={() => setTool('circle')} />
        <ToolButton icon="show_chart" label="Line (L)" active={tool === 'line'} disabled={!canDrawRectangle} onClick={() => setTool('line')} />
        <ToolButton icon="text_fields" label="Text (T)" active={tool === 'text'} disabled={!canDrawRectangle} onClick={() => setTool('text')} />
        <ToolButton icon="pan_tool" label="Pan (H)" active={tool === 'pan'} onClick={() => setTool('pan')} />
      </nav>

      {/* Keyboard shortcuts hint */}
      <div className="absolute left-6 bottom-6 text-label-code text-on-surface-variant/50 z-30 hidden lg:block">
        <div>Ctrl+/- Zoom · Delete · Shift+Click</div>
      </div>

      {/* Floating Bottom-Right Controls */}
      <div className="absolute bottom-6 right-6 flex gap-1 bg-panel-bg backdrop-blur-md rounded-lg p-1 border border-white/10 shadow-lg z-40">
        <ToolButton icon="undo" label="Undo" disabled={!canUndo} onClick={onUndo} />
        <ToolButton icon="redo" label="Redo" disabled={!canRedo} onClick={onRedo} />
        <div className="w-px bg-white/10 mx-1" />
        <ToolButton icon="zoom_in" label="Zoom In (Ctrl+=)" onClick={() => setViewport({ ...viewport, scale: clampScale(viewport.scale * 1.15) })} />
        <ToolButton icon="zoom_out" label="Zoom Out (Ctrl+-)" onClick={() => setViewport({ ...viewport, scale: clampScale(viewport.scale / 1.15) })} />
        <span className="flex items-center px-2 text-label-code text-on-surface-variant">{Math.round(viewport.scale * 100)}%</span>
        <ToolButton icon="fit_screen" label="Reset View" onClick={resetViewport} />
      </div>

      {/* Text Input Overlay */}
      {textInput.visible && (
        <div
          className="absolute z-50 bg-surface-container border border-primary rounded shadow-lg p-2"
          style={{ left: textInput.position.x * viewport.scale + viewport.x + 8, top: textInput.position.y * viewport.scale + viewport.y + 8 }}
        >
          <input
            autoFocus
            className="bg-surface-container-highest border border-stroke-default rounded px-3 py-1.5 text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all min-w-[200px]"
            placeholder="Enter text..."
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleTextSubmit(); if (e.key === 'Escape') { setTextInput({ position: { x: 0, y: 0 }, visible: false }); setTextValue(''); } }}
            onBlur={handleTextSubmit}
          />
        </div>
      )}

      {/* Canvas Frame */}
      <div className="flex-1 bg-white" ref={containerRef}>
        <Stage
          width={canvasSize.width}
          height={canvasSize.height}
          x={viewport.x} y={viewport.y}
          scaleX={viewport.scale} scaleY={viewport.scale}
          draggable={tool === 'pan'}
          onClick={(event) => {
            if (tool === 'select' && event.target === event.target.getStage()) clearSelection();
          }}
          onTap={(event) => {
            if (tool === 'select' && event.target === event.target.getStage()) clearSelection();
          }}
          onDragEnd={handleStageDragEnd}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onWheel={handleWheel}
        >
          {/* Grid Layer */}
          <Layer listening={false}>
            <CanvasGrid width={canvasSize.width} height={canvasSize.height} viewportScale={viewport.scale} viewportX={viewport.x} viewportY={viewport.y} />
          </Layer>

          {/* Objects Layer */}
          <Layer listening={tool === 'select'}>
            {objects.map((object) => (
              <BoardObjectShape
                key={object.id}
                canEdit={canTransform}
                object={object}
                onDragEnd={handleObjectDragEnd}
                onTransformEnd={handleTransformEnd}
                onRegisterNode={(node) => { shapeRefs.current[object.id] = node; }}
                selected={selectedObjectIds.has(object.id)}
                onSelect={(id) => {
                  if (tool === 'select') toggleObjectSelection(id);
                }}
              />
            ))}
          </Layer>

          {/* Selection Boxes + Drafts */}
          <Layer listening={false}>
            {selectedObjects.map((o) => (
              <SelectionBox key={`sel-${o.id}`} bounds={getObjectBounds(o)} />
            ))}
            {rectangleDraft && draftRectangle && (
              <Rect x={draftRectangle.x} y={draftRectangle.y} width={draftRectangle.width} height={draftRectangle.height}
                fill="#dbeafe" opacity={0.45} stroke="#38bdf8" strokeWidth={2} dash={[6, 4]} />
            )}
            {circleDraft && draftRadius && (
              <Circle x={circleDraft.center.x} y={circleDraft.center.y} radius={draftRadius}
                fill="#ecfccb" opacity={0.45} stroke="#4d7c0f" strokeWidth={2} dash={[6, 4]} />
            )}
            {lineDraft && (
              <Line points={[lineDraft.start.x, lineDraft.start.y, lineDraft.current.x, lineDraft.current.y]}
                stroke="#0f766e" strokeWidth={4} dash={[6, 4]} />
            )}
            {/* Rubber-band selection rect */}
            {selectionRect && selectionRect.width > 2 && selectionRect.height > 2 && (
              <Rect x={selectionRect.x} y={selectionRect.y} width={selectionRect.width} height={selectionRect.height}
                fill="rgba(56,189,248,0.08)" stroke="#38bdf8" strokeWidth={1} dash={[4, 4]} />
            )}
          </Layer>

          {/* Transformer Layer */}
          <Layer listening={canTransform}>
            <Transformer
              ref={transformerRef}
              rotateEnabled={true}
              enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
              boundBoxFunc={(_oldBox, newBox) => {
                if (newBox.width < 4 || newBox.height < 4) return _oldBox;
                return newBox;
              }}
            />
          </Layer>
        </Stage>
      </div>
    </section>
  );
});

// ── BoardObjectShape ──
function BoardObjectShape({
  canEdit, object, onDragEnd, onTransformEnd, onRegisterNode, onSelect, selected
}: {
  canEdit: boolean;
  object: BoardObject;
  onDragEnd: (objectId: BoardObjectId, event: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (objectId: BoardObjectId, event: Konva.KonvaEventObject<Event>) => void;
  onRegisterNode: (node: Konva.Node | null) => void;
  onSelect: (objectId: BoardObjectId) => void;
  selected: boolean;
}) {
  const commonProps = {
    draggable: canEdit,
    rotation: object.rotation ?? 0,
    shadowBlur: selected ? 8 : 0,
    shadowColor: '#38bdf8',
    x: object.x, y: object.y,
    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => onDragEnd(object.id, event),
    onClick: () => onSelect(object.id),
    onTap: () => onSelect(object.id),
  };

  if (object.type === 'rectangle') {
    return (
      <Rect {...commonProps} ref={onRegisterNode}
        width={getNum(object, 'width', 140)} height={getNum(object, 'height', 90)}
        fill={getStr(object, 'fill', '#dbeafe')} stroke={getStr(object, 'stroke', '#38bdf8')}
        strokeWidth={getNum(object, 'strokeWidth', 2)}
        onTransformEnd={(e) => onTransformEnd(object.id, e)} />
    );
  }
  if (object.type === 'circle') {
    return (
      <Circle {...commonProps} ref={onRegisterNode}
        radius={getNum(object, 'radius', 48)}
        fill={getStr(object, 'fill', '#ecfccb')} stroke={getStr(object, 'stroke', '#4d7c0f')}
        strokeWidth={getNum(object, 'strokeWidth', 2)}
        onTransformEnd={(e) => onTransformEnd(object.id, e)} />
    );
  }
  if (object.type === 'line') {
    return (
      <Line {...commonProps} ref={onRegisterNode}
        points={getNumArr(object, 'points', [0, 0, 120, 36])}
        stroke={getStr(object, 'stroke', '#0f766e')} strokeWidth={getNum(object, 'strokeWidth', 4)}
        lineCap="round" lineJoin="round"
        onTransformEnd={(e) => onTransformEnd(object.id, e)} />
    );
  }
  return (
    <Text {...commonProps} ref={onRegisterNode}
      text={getStr(object, 'text', 'Text')} width={getNum(object, 'width', 220)}
      fill={getStr(object, 'fill', '#dae2fd')} fontSize={getNum(object, 'fontSize', 20)} fontStyle="600"
      onTransformEnd={(e) => onTransformEnd(object.id, e)} />
  );
}

// ── SelectionBox ──
function SelectionBox({ bounds }: { bounds: ObjectBounds }) {
  return (
    <Rect x={bounds.x - 8} y={bounds.y - 8} width={bounds.width + 16} height={bounds.height + 16}
      stroke="#38bdf8" strokeWidth={1.5} dash={[6, 4]} listening={false} />
  );
}

// ── CanvasGrid (scales dynamically with viewport) ──
function CanvasGrid({ width, height, viewportScale, viewportX, viewportY }: {
  width: number; height: number; viewportScale: number; viewportX: number; viewportY: number;
}) {
  // Adjust grid size based on zoom level for consistent visual appearance
  const baseSize = 40;
  let gridSize = baseSize;
  if (viewportScale < 0.5) gridSize = baseSize * 4;
  else if (viewportScale < 1) gridSize = baseSize * 2;

  // Cover the visible area (accounting for pan + zoom)
  const visibleLeft = -viewportX / viewportScale;
  const visibleTop = -viewportY / viewportScale;
  const visibleWidth = width / viewportScale;
  const visibleHeight = height / viewportScale;

  const startX = Math.floor(visibleLeft / gridSize) * gridSize;
  const startY = Math.floor(visibleTop / gridSize) * gridSize;
  const endX = visibleLeft + visibleWidth + gridSize;
  const endY = visibleTop + visibleHeight + gridSize;

  const lines: React.ReactNode[] = [];
  for (let x = startX; x <= endX; x += gridSize) {
    lines.push(<Line key={`v-${x}`} points={[x, startY, x, endY]} stroke="#e5e7eb" strokeWidth={1} />);
  }
  for (let y = startY; y <= endY; y += gridSize) {
    lines.push(<Line key={`h-${y}`} points={[startX, y, endX, y]} stroke="#e5e7eb" strokeWidth={1} />);
  }
  return <>{lines}</>;
}

// ── getObjectBounds ──
function getObjectBounds(object: BoardObject): ObjectBounds {
  if (object.type === 'circle') {
    const r = getNum(object, 'radius', 48);
    return { x: object.x - r, y: object.y - r, width: r * 2, height: r * 2 };
  }
  if (object.type === 'line') {
    const pts = getNumArr(object, 'points', [0, 0, 120, 36]);
    const xs = pts.filter((_, i) => i % 2 === 0); const ys = pts.filter((_, i) => i % 2 === 1);
    return { x: object.x + Math.min(...xs), y: object.y + Math.min(...ys), width: Math.max(1, Math.max(...xs) - Math.min(...xs)), height: Math.max(1, Math.max(...ys) - Math.min(...ys)) };
  }
  return { x: object.x, y: object.y, width: getNum(object, 'width', object.type === 'text' ? 220 : 140), height: getNum(object, 'height', object.type === 'text' ? 32 : 90) };
}

// ── Prop helpers ──
function getNum(obj: BoardObject, key: string, fallback: number): number {
  const v = obj.props[key]; return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function getStr(obj: BoardObject, key: string, fallback: string): string {
  const v = obj.props[key]; return typeof v === 'string' ? v : fallback;
}
function getNumArr(obj: BoardObject, key: string, fallback: number[]): number[] {
  const v = obj.props[key]; return Array.isArray(v) && v.every((i) => typeof i === 'number') ? v as number[] : fallback;
}

function clampScale(scale: number): number {
  return Math.min(2.5, Math.max(0.15, scale));
}

function getBoardPoint(stage: Konva.Stage | null, viewport: { scale: number; x: number; y: number }): BoardPoint | null {
  const pointer = stage?.getPointerPosition();
  if (!pointer) return null;
  return { x: (pointer.x - viewport.x) / viewport.scale, y: (pointer.y - viewport.y) / viewport.scale };
}

export function getViewportAfterStageDragEnd(
  viewport: { scale: number; x: number; y: number },
  isStageTarget: boolean,
  position: { x: number; y: number }
) {
  if (!isStageTarget) return viewport;
  return { ...viewport, x: position.x, y: position.y };
}

// Used by window-level rubber-band selection handler
function getObjectBoundsForSel(obj: BoardObject): { x: number; y: number; width: number; height: number } {
  if (obj.type === 'circle') {
    const r = typeof obj.props.radius === 'number' ? obj.props.radius : 48;
    return { x: obj.x - r, y: obj.y - r, width: r * 2, height: r * 2 };
  }
  if (obj.type === 'line') {
    const pts = Array.isArray(obj.props.points) ? obj.props.points as number[] : [0, 0, 120, 36];
    const xs = pts.filter((_, i) => i % 2 === 0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    return {
      x: obj.x + Math.min(...xs), y: obj.y + Math.min(...ys),
      width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
      height: Math.max(1, Math.max(...ys) - Math.min(...ys))
    };
  }
  const w = typeof obj.props.width === 'number' ? obj.props.width : 140;
  const h = typeof obj.props.height === 'number' ? obj.props.height : 90;
  return { x: obj.x, y: obj.y, width: w, height: h };
}

function rectsIntersectLocal(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

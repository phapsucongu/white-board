import { useCallback, useState } from 'react';
import type { BoardObject } from '@whiteboard/shared';
import { useBoardStore } from '../../board/boardStore';
import { useAuth } from '../../auth/AuthContext';
import type { RoomRole } from '../../api/client';

type ObjectDetailPanelProps = {
  onDelete?: (objectId: string) => void;
  onUpdate?: (objectId: string, patch: Record<string, unknown>) => void;
  role?: RoomRole;
};

const presetColors = [
  '#1e293b', '#475569', '#64748b', '#94a3b8',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#dbeafe', '#ecfccb', '#fef3c7', '#fce7f3',
];

export function ObjectDetailPanel({ onDelete, onUpdate, role }: ObjectDetailPanelProps) {
  const objects = useBoardStore((state) => state.objects);
  const selectedObjectIds = useBoardStore((state) => state.selectedObjectIds);
  const clearSelection = useBoardStore((state) => state.clearSelection);
  const { user } = useAuth();
  const [editMode, setEditMode] = useState(false);

  const singleSelectedId = selectedObjectIds.size === 1 ? [...selectedObjectIds][0] : null;
  const selectedObject = singleSelectedId ? objects[singleSelectedId] : null;

  const canEdit = role === 'OWNER' || role === 'EDITOR';
  const canDelete = role === 'OWNER' || role === 'EDITOR';
  const currentFill = String(selectedObject?.props?.fill ?? '#dbeafe');
  const currentStroke = String(selectedObject?.props?.stroke ?? '#1e293b');
  const currentStrokeWidth = Number(selectedObject?.props?.strokeWidth ?? 2);
  const currentOpacity = typeof selectedObject?.props?.opacity === 'number' ? selectedObject.props.opacity : 1;

  const updateProp = useCallback(
    (key: string, value: unknown) => {
      if (!singleSelectedId) return;
      onUpdate?.(singleSelectedId, { props: { [key]: value } });
    },
    [onUpdate, singleSelectedId]
  );

  const updatePropDebounced = useCallback(
    (key: string, value: unknown) => {
      if (!singleSelectedId) return;
      onUpdate?.(singleSelectedId, { props: { [key]: value } });
    },
    [onUpdate, singleSelectedId]
  );

  if (!selectedObject || selectedObject.deleted) return null;

  return (
    <aside className="absolute top-3 right-3 bottom-20 w-[280px] glass-panel rounded-xl flex flex-col shadow-lg z-30 overflow-hidden border border-white/5 bg-surface">
      <div className="p-4 border-b border-white/5 flex items-center justify-between">
        <div>
          <h2 className="text-headline-md font-semibold text-on-surface">Properties</h2>
          <p className="text-label-code text-on-surface-variant mt-0.5">{formatObjectType(selectedObject.type)}</p>
        </div>
        <div className="flex items-center gap-1">
          {canEdit && (
            <button className={`text-on-surface-variant hover:text-on-surface transition-colors p-1 ${editMode ? 'text-primary' : ''}`}
              onClick={() => setEditMode(!editMode)} type="button" title="Toggle edit mode">
              <span className="material-symbols-outlined text-lg">edit</span>
            </button>
          )}
          <button className="text-on-surface-variant hover:text-on-surface transition-colors p-1"
            onClick={clearSelection} type="button" title="Close">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        <div className="space-y-4">
          {/* Identity */}
          <DetailSection title="Identity">
            <DetailRow label="Type" value={formatObjectType(selectedObject.type)} />
            <DetailRow label="ID" value={selectedObject.id.slice(0, 8)} mono />
            <DetailRow label="Version" value={`v${selectedObject.version}`} />
          </DetailSection>

          {/* Transform */}
          <DetailSection title="Transform">
            <DetailRow label="X" value={String(Math.round(selectedObject.x))} />
            <DetailRow label="Y" value={String(Math.round(selectedObject.y))} />
            <DetailRow label="Rotation" value={`${Math.round(selectedObject.rotation ?? 0)}°`} />
            {selectedObject.type === 'rectangle' && (
              <>
                <DetailRow label="Width" value={String(Math.round(getProp(selectedObject, 'width', 140)))} />
                <DetailRow label="Height" value={String(Math.round(getProp(selectedObject, 'height', 90)))} />
              </>
            )}
            {selectedObject.type === 'circle' && (
              <DetailRow label="Radius" value={String(Math.round(getProp(selectedObject, 'radius', 48)))} />
            )}
            {selectedObject.type === 'text' && (
              <DetailRow label="Font Size" value={`${getProp(selectedObject, 'fontSize', 20)}px`} />
            )}
          </DetailSection>

          {/* Style */}
          {canEdit && (
            <DetailSection title="Style">
              {/* Fill Color */}
              <div className="mb-3">
                <label className="text-label-code text-on-surface-variant uppercase tracking-wider block mb-1">Fill</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={currentFill}
                    className="w-8 h-8 rounded border border-outline-variant cursor-pointer"
                    onChange={(e) => updateProp('fill', e.target.value)} />
                  {editMode && (
                    <div className="flex flex-wrap gap-1">
                      {presetColors.map((c) => (
                        <button key={c} className="w-5 h-5 rounded border border-outline-variant hover:scale-110 transition-transform"
                          style={{ backgroundColor: c }} onClick={() => updateProp('fill', c)} type="button" title={c} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Stroke Color */}
              <div className="mb-3">
                <label className="text-label-code text-on-surface-variant uppercase tracking-wider block mb-1">Stroke</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={currentStroke}
                    className="w-8 h-8 rounded border border-outline-variant cursor-pointer"
                    onChange={(e) => updateProp('stroke', e.target.value)} />
                  {editMode && (
                    <div className="flex flex-wrap gap-1">
                      {presetColors.map((c) => (
                        <button key={c} className="w-5 h-5 rounded border border-outline-variant hover:scale-110 transition-transform"
                          style={{ backgroundColor: c }} onClick={() => updateProp('stroke', c)} type="button" title={c} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Stroke Width */}
              <div className="mb-3">
                <label className="text-label-code text-on-surface-variant uppercase tracking-wider block mb-1">
                  Stroke: {currentStrokeWidth}px
                </label>
                <input type="range" min="0" max="10" step="1" defaultValue={currentStrokeWidth}
                  className="w-full accent-primary"
                  onMouseUp={(e) => updateProp('strokeWidth', Number((e.target as HTMLInputElement).value))}
                  onTouchEnd={(e) => updateProp('strokeWidth', Number((e.target as HTMLInputElement).value))} />
              </div>

              {/* Opacity */}
              <div className="mb-3">
                <label className="text-label-code text-on-surface-variant uppercase tracking-wider block mb-1">
                  Opacity: {Math.round(currentOpacity * 100)}%
                </label>
                <input type="range" min="10" max="100" step="5" defaultValue={Math.round(currentOpacity * 100)}
                  className="w-full accent-primary"
                  onMouseUp={(e) => updateProp('opacity', Number((e.target as HTMLInputElement).value) / 100)}
                  onTouchEnd={(e) => updateProp('opacity', Number((e.target as HTMLInputElement).value) / 100)} />
              </div>
            </DetailSection>
          )}

          {/* Metadata */}
          <DetailSection title="Info">
            <DetailRow label="Created by" value={getCreatorLabel(selectedObject, user)} />
            <DetailRow label="Updated" value={formatDate(selectedObject.updatedAt)} />
          </DetailSection>
        </div>
      </div>

      {canDelete && onDelete && (
        <div className="p-3 border-t border-white/5">
          <button className="w-full bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded px-4 py-2 text-label-mono transition-colors flex items-center justify-center gap-2"
            onClick={() => { onDelete(selectedObject.id); clearSelection(); }} type="button">
            <span className="material-symbols-outlined text-base">delete</span>Delete
          </button>
        </div>
      )}
    </aside>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-label-mono text-on-surface-variant uppercase tracking-wider mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, mono, children }: { label: string; value: string; mono?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-body-sm">
      <span className="text-on-surface-variant">{label}</span>
      <span className={`text-on-surface flex items-center ${mono ? 'font-label-mono text-label-code' : ''}`}>
        {value}{children}
      </span>
    </div>
  );
}

function getProp(obj: BoardObject, key: string, fallback: number): number {
  const v = obj.props[key]; return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function formatObjectType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function formatPropName(key: string): string {
  if (key === 'strokeWidth') return 'Stroke width';
  if (key === 'fontSize') return 'Font size';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function getCreatorLabel(object: BoardObject, currentUser: { id: string; email: string; displayName: string | null } | null): string {
  if (currentUser && object.createdBy === currentUser.id) {
    return currentUser.displayName || 'You';
  }
  return object.createdBy.slice(0, 8) + '...';
}

import type { BoardObject } from '@whiteboard/shared';
import { useBoardStore } from '../../board/boardStore';
import { useAuth } from '../../auth/AuthContext';
import type { RoomRole } from '../../api/client';

type ObjectDetailPanelProps = {
  onDelete?: (objectId: string) => void;
  role?: RoomRole;
};

export function ObjectDetailPanel({ onDelete, role }: ObjectDetailPanelProps) {
  const objects = useBoardStore((state) => state.objects);
  const selectedObjectIds = useBoardStore((state) => state.selectedObjectIds);
  const clearSelection = useBoardStore((state) => state.clearSelection);
  const { user } = useAuth();

  // Show detail panel only if exactly one object is selected
  const singleSelectedId = selectedObjectIds.size === 1 ? [...selectedObjectIds][0] : null;
  const selectedObject = singleSelectedId ? objects[singleSelectedId] : null;

  if (!selectedObject || selectedObject.deleted) {
    return null;
  }

  const canDelete = role === 'OWNER' || role === 'EDITOR';

  return (
    <aside className="absolute top-3 right-3 bottom-20 w-[280px] glass-panel rounded-xl flex flex-col shadow-lg z-30 overflow-hidden border border-white/5 bg-surface">
      <div className="p-4 border-b border-white/5 flex items-center justify-between">
        <div>
          <h2 className="text-headline-md font-semibold text-on-surface">Object Details</h2>
          <p className="text-label-code text-on-surface-variant mt-0.5">
            {formatObjectType(selectedObject.type)}
          </p>
        </div>
        <button
          className="text-on-surface-variant hover:text-on-surface transition-colors p-1"
          onClick={clearSelection}
          type="button"
          title="Close"
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        <div className="space-y-4">
          {/* Identity */}
          <DetailSection title="Identity">
            <DetailRow label="ID" value={selectedObject.id} mono />
            <DetailRow label="Type" value={formatObjectType(selectedObject.type)} />
          </DetailSection>

          {/* Position & Size */}
          <DetailSection title="Transform">
            <DetailRow label="X" value={formatNumber(selectedObject.x)} />
            <DetailRow label="Y" value={formatNumber(selectedObject.y)} />
            <DetailRow label="Rotation" value={`${Math.round(selectedObject.rotation ?? 0)}°`} />
            {selectedObject.type === 'circle' && (
              <DetailRow label="Radius" value={formatNumber(getProp(selectedObject, 'radius', 48))} />
            )}
            {selectedObject.type === 'rectangle' && (
              <>
                <DetailRow label="Width" value={formatNumber(getProp(selectedObject, 'width', 140))} />
                <DetailRow label="Height" value={formatNumber(getProp(selectedObject, 'height', 90))} />
              </>
            )}
            {selectedObject.type === 'text' && (
              <DetailRow label="Font Size" value={`${getProp(selectedObject, 'fontSize', 20)}px`} />
            )}
          </DetailSection>

          {/* Style */}
          <DetailSection title="Style">
            <DetailRow label="Fill" value={String(selectedObject.props.fill ?? '—')}>
              <span
                className="w-4 h-4 rounded border border-outline-variant inline-block ml-1"
                style={{ backgroundColor: String(selectedObject.props.fill ?? 'transparent') }}
              />
            </DetailRow>
            <DetailRow label="Stroke" value={String(selectedObject.props.stroke ?? '—')}>
              <span
                className="w-4 h-4 rounded border border-outline-variant inline-block ml-1"
                style={{ backgroundColor: String(selectedObject.props.stroke ?? 'transparent') }}
              />
            </DetailRow>
            <DetailRow
              label="Stroke Width"
              value={String(selectedObject.props.strokeWidth ?? '—')}
            />
          </DetailSection>

          {/* Metadata */}
          <DetailSection title="Metadata">
            <DetailRow label="Version" value={`v${selectedObject.version}`} />
            <DetailRow label="Created by" value={getCreatorLabel(selectedObject, user)} />
            <DetailRow label="Updated" value={formatDate(selectedObject.updatedAt)} />
          </DetailSection>
        </div>
      </div>

      {/* Delete Action */}
      {canDelete && onDelete && (
        <div className="p-3 border-t border-white/5">
          <button
            className="w-full bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded px-4 py-2 text-label-mono transition-colors flex items-center justify-center gap-2"
            onClick={() => {
              onDelete(selectedObject.id);
              clearSelection();
            }}
            type="button"
          >
            <span className="material-symbols-outlined text-base">delete</span>
            Delete Object
          </button>
        </div>
      )}
    </aside>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-label-mono text-on-surface-variant uppercase tracking-wider mb-2">
        {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  children
}: {
  label: string;
  value: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-body-sm">
      <span className="text-on-surface-variant">{label}</span>
      <span className={`text-on-surface flex items-center ${mono ? 'font-label-mono text-label-code' : ''}`}>
        {value}
        {children}
      </span>
    </div>
  );
}

function getProp(object: BoardObject, key: string, fallback: number): number {
  const value = object.props[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function formatObjectType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString();
}

function getCreatorLabel(
  object: BoardObject,
  currentUser: { id: string; email: string; displayName: string | null } | null
): string {
  if (currentUser && object.createdBy === currentUser.id) {
    return currentUser.displayName || currentUser.email || 'You';
  }
  return object.createdBy.slice(0, 8) + '...';
}

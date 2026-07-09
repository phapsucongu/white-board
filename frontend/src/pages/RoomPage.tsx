import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BoardCanvas } from '../board/BoardCanvas';
import { useBoardStore } from '../board/boardStore';
import {
  canMutateRoom,
  getPresenceDisplayName,
  toMoveBoardObjectPayload,
  useRoomRealtime
} from '../realtime/useRoomRealtime';
import {
  canCreateVersionTag,
  formatVersionEventType,
  getTagsForVersion,
  getVersionActorLabel
} from '../versions/versionHistory';
import { ObjectDetailPanel } from '../components/board/ObjectDetailPanel';
import { MemberManagement } from '../components/board/MemberManagement';
import { RoleBadge } from '../components/ui/role-badge';
import { SectionHeading } from '../components/ui/section-heading';
import { toastService } from '../components/ui/toaster';
import {
  useBoardSnapshot,
  useComments,
  useCreateComment,
  useCreateVersionTag,
  useRestoreVersion,
  useRoom,
  useUpdateComment,
  useVersionHistory
} from '../hooks/useRoomQueries';

export function RoomPage() {
  const { roomId } = useParams();
  const { accessToken, runWithAuth, user } = useAuth();
  const [showPresence, setShowPresence] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [tagLabel, setTagLabel] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const setBoardSnapshot = useBoardStore((state) => state.setBoardSnapshot);
  const boardVersion = useBoardStore((state) => state.boardVersion);
  const selectedObjectIds = useBoardStore((state) => state.selectedObjectIds);

  // ── TanStack Query hooks ──
  const roomQuery = useRoom(roomId, accessToken);
  const boardQuery = useBoardSnapshot(roomId, accessToken);
  const versionHistoryQuery = useVersionHistory(roomId, accessToken);
  const commentsQuery = useComments(roomId, accessToken);
  const createCommentMutation = useCreateComment(roomId);
  const updateCommentMutation = useUpdateComment(roomId);
  const createTagMutation = useCreateVersionTag(roomId);
  const restoreMutation = useRestoreVersion(roomId);

  const activeRoom = roomQuery.data ?? null;
  const comments = commentsQuery.data ?? [];
  const versionHistory = versionHistoryQuery.data ?? null;
  const canDrawRectangle = canMutateRoom(activeRoom?.role);
  const canTagVersion = canCreateVersionTag(activeRoom?.role);

  // Sync board snapshot to Zustand when loaded
  useEffect(() => {
    if (boardQuery.data) {
      setBoardSnapshot(boardQuery.data.roomId, { objects: boardQuery.data.objects }, boardQuery.data.version);
    }
  }, [boardQuery.data, setBoardSnapshot]);

  const realtime = useRoomRealtime({
    accessToken,
    currentUserId: user?.id ?? null,
    enabled: Boolean(activeRoom),
    roomId: activeRoom?.id ?? null,
    onCommentReceived: useCallback(() => {
      commentsQuery.refetch();
    }, [commentsQuery.refetch])
  });

  // Auto-refresh version history when board changes
  useEffect(() => {
    if (boardVersion > 0 && showVersions) {
      versionHistoryQuery.refetch();
    }
  }, [boardVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload versions/comments when snapshot is restored
  useEffect(() => {
    if (realtime.lastSnapshotRestore) {
      versionHistoryQuery.refetch();
      commentsQuery.refetch();
    }
  }, [realtime.lastSnapshotRestore, versionHistoryQuery.refetch, commentsQuery.refetch]);

  // ── Handlers ──
  const handleCreateComment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = commentBody.trim();
    if (!body || !accessToken) return;
    createCommentMutation.mutate({ body, accessToken }, {
      onSuccess: () => { setCommentBody(''); toastService.success('Comment added'); },
      onError: (error) => { toastService.error(error instanceof Error ? error.message : 'Failed'); }
    });
  };

  const handleResolveComment = (comment: { id: string; resolved: boolean }) => {
    if (!accessToken) return;
    updateCommentMutation.mutate({ commentId: comment.id, resolved: !comment.resolved, accessToken });
  };

  const handleCreateVersionTag = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeRoom || !canTagVersion || !accessToken) return;
    const label = tagLabel.trim();
    if (!label) return;
    createTagMutation.mutate({
      version: useBoardStore.getState().boardVersion, label, accessToken
    }, {
      onSuccess: () => { setTagLabel(''); toastService.success(`Version tagged as "${label}"`); },
      onError: (error) => {
        toastService.error(error instanceof Error ? error.message : 'Failed to create tag');
      }
    });
  };

  const handleObjectMoveCommit = useCallback(
    (objectId: string, position: { x: number; y: number }) => {
      realtime.sendObjectUpdate(toMoveBoardObjectPayload(objectId, position));
    },
    [realtime.sendObjectUpdate]
  );

  const handleObjectTransformCommit = useCallback(
    (objectId: string, transform: { x: number; y: number; rotation: number; width?: number; height?: number }) => {
      const existing = useBoardStore.getState().objects[objectId];
      if (!existing || existing.deleted) return;
      const patch: Record<string, unknown> = { x: transform.x, y: transform.y, rotation: transform.rotation };
      if (transform.width !== undefined && transform.height !== undefined) {
        patch.props = { width: transform.width, height: transform.height };
      }
      realtime.sendObjectUpdate({ objectId, expectedVersion: existing.version, patch });
    },
    [realtime.sendObjectUpdate]
  );

  const handleObjectsDelete = useCallback(
    (objectIds: string[]) => { for (const id of objectIds) realtime.sendObjectDelete(id); },
    [realtime.sendObjectDelete]
  );

  const handleUndo = useCallback(() => { realtime.undo(); }, [realtime.undo]);
  const handleRedo = useCallback(() => { realtime.redo(); }, [realtime.redo]);

  // ── Error states ──
  if (!roomId) return <div className="p-8 text-center text-error">Room ID is missing</div>;
  if (roomQuery.isError) return <div className="p-8 text-center text-error">Failed to load room</div>;

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col bg-canvas-bg">
      {/* Top Toolbar */}
      <header className="bg-surface-container border-b border-stroke-default flex justify-between items-center w-full px-6 h-12 z-50 shrink-0">
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1">
            <span className="material-symbols-outlined text-lg">arrow_back</span>
          </Link>
          <div>
            <h1 className="text-headline-md font-semibold text-on-surface leading-tight">
              {activeRoom?.name ?? roomId ?? 'Loading...'}
            </h1>
            {activeRoom?.role && <RoleBadge role={activeRoom.role} />}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-label-code text-on-surface-variant">
            {realtime.status === 'joined' ? <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-tertiary inline-block" />Connected</span>
             : realtime.status === 'connecting' ? <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-secondary inline-block animate-pulse" />Connecting...</span>
             : realtime.status === 'error' ? <span className="flex items-center gap-1 text-error"><span className="w-2 h-2 rounded-full bg-error inline-block" />Error</span>
             : null}
          </span>
          <button className="text-on-surface-variant hover:text-on-surface transition-colors p-1" onClick={() => setShowPresence(!showPresence)} type="button" title="Toggle presence">
            <span className="material-symbols-outlined text-lg">group</span>
          </button>
          <button className="text-on-surface-variant hover:text-on-surface transition-colors p-1" onClick={() => setShowVersions(!showVersions)} type="button" title="Toggle version history">
            <span className="material-symbols-outlined text-lg">history</span>
          </button>
          <button className="text-on-surface-variant hover:text-on-surface transition-colors p-1" onClick={() => setShowComments(!showComments)} type="button" title="Toggle comments">
            <span className="material-symbols-outlined text-lg">comment</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex relative overflow-hidden">
        {/* Presence + Members Panel */}
        {showPresence && activeRoom && (
          <aside className="absolute top-3 left-[72px] bottom-20 w-[260px] glass-panel rounded-xl flex flex-col shadow-lg z-30 overflow-hidden border border-white/5 bg-surface">
            <div className="p-4 border-b border-white/5">
              <SectionHeading title="Room" subtitle={`${realtime.presenceUsers.length} online`} />
            </div>
            <div className="max-h-[40%] overflow-y-auto custom-scrollbar">
              <div className="px-3 pt-2 pb-1"><h4 className="text-label-code text-on-surface-variant uppercase tracking-wider">Online now</h4></div>
              {realtime.presenceUsers.length === 0 ? (
                <p className="text-body-sm text-on-surface-variant px-3 pb-2">No one online</p>
              ) : (
                <ul className="px-2 pb-2 space-y-0.5">
                  {realtime.presenceUsers.map((p) => (
                    <li key={p.userId} className="flex items-center gap-2 p-1.5 rounded hover:bg-surface-container-high/50">
                      <span className="w-6 h-6 rounded-full bg-primary/10 border border-outline-variant flex items-center justify-center text-primary text-[10px] font-medium shrink-0">
                        {getPresenceDisplayName(p).charAt(0).toUpperCase()}
                      </span>
                      <span className="text-body-sm text-on-surface truncate flex-1">{getPresenceDisplayName(p)}</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-tertiary shrink-0" title="Online" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <MemberManagement roomId={activeRoom.id} currentUserId={user?.id ?? ''} isOwner={activeRoom.role === 'OWNER'} runWithAuth={runWithAuth} />
          </aside>
        )}

        {/* Main Canvas */}
        {activeRoom ? (
          <BoardCanvas
            canDrawRectangle={canDrawRectangle}
            canEditObjects={canDrawRectangle}
            canRedo={canDrawRectangle && realtime.canRedo}
            canUndo={canDrawRectangle && realtime.canUndo}
            currentUserId={user?.id ?? 'local-user'}
            onCircleCommit={realtime.sendCircleCreate}
            onLineCommit={realtime.sendLineCreate}
            onObjectMoveCommit={handleObjectMoveCommit}
            onObjectsDelete={handleObjectsDelete}
            onObjectTransformCommit={handleObjectTransformCommit}
            onRectangleCommit={realtime.sendRectangleCreate}
            onTextCommit={realtime.sendTextCreate}
            onRedo={handleRedo}
            onUndo={handleUndo}
            roomId={activeRoom.id}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-canvas-bg">
            <p className="text-on-surface-variant">{roomQuery.isLoading ? 'Loading room...' : 'Room not found'}</p>
          </div>
        )}

        {/* Comments Panel */}
        {showComments && activeRoom && (
          <aside className="absolute left-[72px] bottom-20 w-[320px] glass-panel rounded-xl flex flex-col shadow-lg z-30 overflow-hidden border border-white/5 bg-surface">
            <div className="p-4 border-b border-white/5">
              <SectionHeading title="Room Comments" subtitle={`${comments.filter((c) => !c.resolved).length} open`} />
            </div>
            <form onSubmit={handleCreateComment} className="p-3 border-b border-white/5 flex gap-2">
              <input
                className="flex-1 bg-surface-container-highest border border-stroke-default rounded px-3 py-2 text-body-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
                placeholder="Type a comment..." value={commentBody} onChange={(e) => setCommentBody(e.target.value)}
              />
              <button className="px-3 py-2 bg-primary text-on-primary rounded text-label-code disabled:opacity-50 shrink-0" disabled={!commentBody.trim()} type="submit">Send</button>
            </form>
            <ul className="max-h-[260px] overflow-y-auto custom-scrollbar p-2 space-y-2">
              {commentsQuery.isLoading && <li className="text-body-sm text-on-surface-variant p-2">Loading...</li>}
              {comments.length === 0 && !commentsQuery.isLoading && <li className="text-body-sm text-on-surface-variant p-2">No comments yet.</li>}
              {comments.map((comment) => (
                <li key={comment.id} className={`p-2 rounded border text-body-sm ${comment.resolved ? 'bg-surface-container-low/40 border-stroke-default/40 opacity-60' : 'bg-surface-container-low border-stroke-default'}`}>
                  <p className="text-on-surface mb-2">{comment.body}</p>
                  <div className="flex items-center justify-between text-label-code text-on-surface-variant">
                    <span>{comment.authorDisplayName || comment.authorEmail || comment.authorId.slice(0, 8)}</span>
                    <button className="text-primary hover:text-primary-fixed" type="button" onClick={() => handleResolveComment(comment)}>
                      {comment.resolved ? 'Reopen' : 'Resolve'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        )}

        {/* Version History Panel */}
        {showVersions && activeRoom && (
          <aside className="absolute top-3 right-3 bottom-20 w-[280px] glass-panel rounded-xl flex flex-col shadow-lg z-30 overflow-hidden border border-white/5 bg-surface">
            <div className="p-4 border-b border-white/5">
              <SectionHeading
                title="Version history"
                subtitle={versionHistory ? `v${versionHistory.currentVersion}` : 'Loading...'}
                action={<button className="text-on-surface-variant hover:text-on-surface transition-colors p-1" onClick={() => versionHistoryQuery.refetch()} type="button" title="Refresh"><span className="material-symbols-outlined text-lg">refresh</span></button>}
              />
            </div>
            {canTagVersion && (
              <form onSubmit={handleCreateVersionTag} className="p-3 border-b border-white/5">
                <label className="block text-label-code text-on-surface-variant mb-1.5 uppercase tracking-wider">Tag current version</label>
                <div className="flex gap-2">
                  <input type="text" value={tagLabel} maxLength={120} onChange={(e) => setTagLabel(e.target.value)}
                    placeholder="Checkpoint label" className="flex-1 bg-surface-container-highest border border-stroke-default rounded px-3 py-1.5 text-body-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
                  />
                  <button type="submit" disabled={!tagLabel.trim()} className="bg-primary text-on-primary px-3 py-1.5 rounded text-label-code disabled:opacity-50 shrink-0">Tag</button>
                </div>
              </form>
            )}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
              {versionHistoryQuery.isLoading && <p className="text-body-sm text-on-surface-variant p-2">Loading...</p>}
              {versionHistoryQuery.isError && <p className="text-error text-body-sm p-2">Failed to load</p>}
              {versionHistory && versionHistory.events.length === 0 && <p className="text-body-sm text-on-surface-variant p-2">No events yet.</p>}
              {versionHistory && versionHistory.events.map((evt) => {
                const tags = getTagsForVersion(versionHistory.tags, evt.version);
                const isRestore = evt.eventType === 'history.restore';
                const restorePayload = isRestore ? (evt.payload as Record<string, unknown>) : null;
                const restoreTarget = restorePayload?.targetVersion as number | undefined;

                if (isRestore) {
                  return (
                    <li key={evt.id} className="px-2 py-1.5 rounded bg-tertiary/5 border border-tertiary/10 text-body-sm text-on-surface-variant">
                      <span className="text-label-mono text-tertiary">v{evt.version}</span>
                      {' · Restored to '}<span className="text-label-mono text-tertiary">v{restoreTarget ?? '?'}</span>
                      <span className="text-label-code text-on-surface-variant ml-2">{new Date(evt.createdAt).toLocaleTimeString()}</span>
                    </li>
                  );
                }

                return (
                  <li key={evt.id} className="p-2 rounded bg-surface-container-low/50 border border-stroke-default/50">
                    <div className="flex items-center gap-2 mb-1">
                      <strong className="text-label-mono text-primary">v{evt.version}</strong>
                      <span className="text-body-sm text-on-surface">{formatVersionEventType(evt.eventType)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-label-code text-on-surface-variant">
                      <span>by {getVersionActorLabel(evt, user)}</span>
                      <time dateTime={evt.createdAt}>{new Date(evt.createdAt).toLocaleTimeString()}</time>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      {tags.map((tag) => (
                        <span key={tag.id} className="px-1.5 py-0.5 rounded text-label-code bg-primary/10 text-primary border border-primary/20">{tag.label}</span>
                      ))}
                      {(activeRoom.role === 'OWNER' || activeRoom.role === 'EDITOR') && (
                        <button type="button" className="px-1.5 py-0.5 rounded text-label-code bg-secondary/10 text-secondary border border-secondary/20 hover:bg-secondary/20 transition-colors ml-auto"
                          onClick={() => {
                            if (!accessToken) return;
                            restoreMutation.mutate({ version: evt.version, accessToken }, {
                              onSuccess: (result) => {
                                toastService.success(`Restored to v${result.restoredFromVersion}. Undo/redo history cleared.`);
                                realtime.clearHistory();
                                versionHistoryQuery.refetch();
                                boardQuery.refetch();
                              },
                              onError: (error) => toastService.error(error instanceof Error ? error.message : 'Restore failed')
                            });
                          }}
                        >Restore</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </div>
          </aside>
        )}

        {/* Object Detail Panel */}
        {activeRoom && (
          <ObjectDetailPanel
            onDelete={realtime.sendObjectDelete}
            onUpdate={(objectId, patch) => {
              const obj = useBoardStore.getState().objects[objectId];
              if (!obj || obj.deleted) return;
              realtime.sendObjectUpdate({ objectId, expectedVersion: obj.version, patch });
            }}
            role={activeRoom.role}
          />
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiClient, type CommentSummary, type RoomSummary, type VersionHistory } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BoardCanvas } from '../board/BoardCanvas';
import { useBoardStore } from '../board/boardStore';
import {
  canMutateRoom,
  getPresenceDisplayName,
  toMoveBoardObjectPayload,
  useRoomRealtime
} from '../realtime/useRoomRealtime';
import type { QueuedOperation } from '../realtime/offlineOutbox';
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

type RoomState =
  | { status: 'loading' }
  | { status: 'ready'; room: RoomSummary }
  | { status: 'error'; message: string };

type VersionHistoryState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; history: VersionHistory }
  | { status: 'error'; message: string };

export function RoomPage() {
  const { roomId } = useParams();
  const { accessToken, runWithAuth, user } = useAuth();
  const [roomState, setRoomState] = useState<RoomState>({ status: 'loading' });
  const [tagError, setTagError] = useState<string | null>(null);
  const [tagLabel, setTagLabel] = useState('');
  const [versionHistoryState, setVersionHistoryState] = useState<VersionHistoryState>({
    status: 'idle'
  });
  const [showPresence, setShowPresence] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<CommentSummary[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentTarget, setCommentTarget] = useState<{ objectId?: string; x?: number; y?: number } | null>(null);
  const setBoardSnapshot = useBoardStore((state) => state.setBoardSnapshot);
  const boardObjects = useBoardStore((state) => state.objects);
  const selectedObjectIds = useBoardStore((state) => state.selectedObjectIds);
  const activeRoom = roomState.status === 'ready' ? roomState.room : null;
  const canDrawRectangle = canMutateRoom(activeRoom?.role);
  const canTagVersion = canCreateVersionTag(activeRoom?.role);
  const realtime = useRoomRealtime({
    accessToken,
    currentUserId: user?.id ?? null,
    enabled: Boolean(activeRoom),
    roomId: activeRoom?.id ?? null
  });

  useEffect(() => {
    if (!activeRoom) return;
    realtime.sendSelectionUpdate([...selectedObjectIds], 'selected');
  }, [activeRoom, realtime.sendSelectionUpdate, selectedObjectIds]);

  const loadVersionHistory = useCallback(() => {
    if (!activeRoom) {
      setVersionHistoryState({ status: 'idle' });
      return Promise.resolve();
    }

    setVersionHistoryState({ status: 'loading' });

    return runWithAuth((accessToken) => apiClient.getVersionHistory(activeRoom.id, accessToken))
      .then((history) => {
        setVersionHistoryState({ status: 'ready', history });
      })
      .catch((error: unknown) => {
        setVersionHistoryState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unable to load version history'
        });
      });
  }, [activeRoom, runWithAuth]);

  useEffect(() => {
    let isActive = true;

    if (!roomId) {
      setRoomState({ status: 'error', message: 'Room id is missing' });
      return () => { isActive = false; };
    }

    setRoomState({ status: 'loading' });

    runWithAuth(async (accessToken) => {
      const room = await apiClient.getRoom(roomId, accessToken);
      const boardSnapshot = await apiClient.getBoardSnapshot(roomId, accessToken);

      return { boardSnapshot, room };
    })
      .then(({ boardSnapshot, room }) => {
        if (isActive) {
          setBoardSnapshot(boardSnapshot.roomId, { objects: boardSnapshot.objects }, boardSnapshot.version);
          setRoomState({ status: 'ready', room });
        }
      })
      .catch((error: unknown) => {
        if (isActive) {
          setRoomState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Unable to load room'
          });
        }
      });

    return () => { isActive = false; };
  }, [roomId, runWithAuth, setBoardSnapshot]);

  useEffect(() => {
    void loadVersionHistory();
  }, [loadVersionHistory]);

  useEffect(() => {
    if (!realtime.lastSnapshotRestore || !showVersions) return;
    void loadVersionHistory();
  }, [loadVersionHistory, realtime.lastSnapshotRestore, showVersions]);

  const loadComments = useCallback(() => {
    if (!activeRoom) return Promise.resolve();
    return runWithAuth((accessToken) => apiClient.listComments(activeRoom.id, accessToken))
      .then(setComments)
      .catch((error: unknown) => {
        toastService.error(error instanceof Error ? error.message : 'Unable to load comments');
      });
  }, [activeRoom, runWithAuth]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  const handleCreateVersionTag = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!activeRoom || !canTagVersion) return;

    const label = tagLabel.trim();
    if (!label) {
      setTagError('Tag label is required');
      return;
    }

    const version = useBoardStore.getState().boardVersion;
    setTagError(null);

    runWithAuth((accessToken) =>
      apiClient.createVersionTag(activeRoom.id, { version, label }, accessToken)
    )
      .then(() => {
        setTagLabel('');
        toastService.success(`Version v${version} tagged as "${label}"`);
        return loadVersionHistory();
      })
      .catch((error: unknown) => {
        setTagError(error instanceof Error ? error.message : 'Unable to create version tag');
      });
  };

  const handleObjectMoveCommit = useCallback(
    (objectId: string, position: { x: number; y: number }) => {
      realtime.sendObjectUpdate(toMoveBoardObjectPayload(objectId, position));
    },
    [realtime.sendObjectUpdate]
  );

  const handleObjectTransformCommit = useCallback(
    (
      objectId: string,
      transform: { x: number; y: number; rotation: number; width?: number; height?: number }
    ) => {
      const existing = useBoardStore.getState().objects[objectId];
      if (!existing || existing.deleted) return;

      const patch: Record<string, unknown> = {
        x: transform.x,
        y: transform.y,
        rotation: transform.rotation
      };
      if (transform.width !== undefined && transform.height !== undefined) {
        patch.props = {
          width: transform.width,
          height: transform.height
        };
      }

      realtime.sendObjectUpdate({
        objectId,
        expectedVersion: existing.version,
        patch
      });
    },
    [realtime.sendObjectUpdate]
  );

  const handleUndo = useCallback(() => { realtime.undo(); }, [realtime.undo]);
  const handleRedo = useCallback(() => { realtime.redo(); }, [realtime.redo]);

  const handleObjectsDelete = useCallback(
    (objectIds: string[]) => {
      for (const id of objectIds) {
        realtime.sendObjectDelete(id);
      }
    },
    [realtime.sendObjectDelete]
  );

  const handleCreateComment = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!activeRoom || !commentTarget) return;
      const body = commentBody.trim();
      if (!body) return;

      runWithAuth((accessToken) =>
        apiClient.createComment(activeRoom.id, { ...commentTarget, body }, accessToken)
      )
        .then((comment) => {
          setComments((current) => [...current, comment]);
          setCommentBody('');
          setCommentTarget(null);
          toastService.success('Comment added');
        })
        .catch((error: unknown) => {
          toastService.error(error instanceof Error ? error.message : 'Unable to create comment');
        });
    },
    [activeRoom, commentBody, commentTarget, runWithAuth]
  );

  const handleResolveComment = useCallback(
    (comment: CommentSummary) => {
      if (!activeRoom) return;
      runWithAuth((accessToken) =>
        apiClient.updateComment(activeRoom.id, comment.id, { resolved: !comment.resolved }, accessToken)
      )
        .then((updated) => {
          setComments((current) => current.map((item) => item.id === updated.id ? updated : item));
        })
        .catch((error: unknown) => {
          toastService.error(error instanceof Error ? error.message : 'Unable to update comment');
        });
    },
    [activeRoom, runWithAuth]
  );

  const commentPins = comments.flatMap((comment) => {
    if (typeof comment.x === 'number' && typeof comment.y === 'number') {
      return [{ id: comment.id, x: comment.x, y: comment.y, resolved: comment.resolved }];
    }

    const object = comment.objectId ? boardObjects[comment.objectId] : null;
    return object ? [{ id: comment.id, x: object.x, y: object.y, resolved: comment.resolved }] : [];
  });

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col bg-canvas-bg">
      {/* Top Toolbar */}
      <header className="bg-surface-container border-b border-stroke-default flex justify-between items-center w-full px-6 h-12 z-50 shrink-0">
        <div className="flex items-center gap-4">
          <Link
            to="/dashboard"
            className="text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-lg">arrow_back</span>
          </Link>
          <div>
            <h1 className="text-headline-md font-semibold text-on-surface leading-tight">
              {roomState.status === 'ready' ? roomState.room.name : roomId ?? 'Loading...'}
            </h1>
            {roomState.status === 'ready' && roomState.room.role && (
              <p className="text-label-code text-on-surface-variant">
                <RoleBadge role={roomState.room.role} />
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-label-code text-on-surface-variant">
            {realtime.status === 'joined' ? (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-tertiary inline-block" />
                Connected
              </span>
            ) : realtime.status === 'connecting' ? (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-secondary inline-block animate-pulse" />
                Connecting...
              </span>
            ) : realtime.status === 'error' ? (
              <span className="flex items-center gap-1 text-error">
                <span className="w-2 h-2 rounded-full bg-error inline-block" />
                Error{realtime.error ? `: ${realtime.error}` : ''}
              </span>
            ) : null}
          </span>
          <button
            className="text-on-surface-variant hover:text-on-surface transition-colors p-1"
            onClick={() => setShowPresence(!showPresence)}
            type="button"
            title="Toggle presence panel"
          >
            <span className="material-symbols-outlined text-lg">group</span>
          </button>
          <button
            className="text-on-surface-variant hover:text-on-surface transition-colors p-1"
            onClick={() => setShowVersions(!showVersions)}
            type="button"
            title="Toggle version history"
          >
            <span className="material-symbols-outlined text-lg">history</span>
          </button>
          <button
            className="text-on-surface-variant hover:text-on-surface transition-colors p-1"
            onClick={() => setShowComments(!showComments)}
            type="button"
            title="Toggle comments"
          >
            <span className="material-symbols-outlined text-lg">comment</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Presence + Member Management Panel (Left Sidebar) */}
        {showPresence && roomState.status === 'ready' && (
          <aside className="absolute top-3 left-[72px] bottom-20 w-[260px] glass-panel rounded-xl flex flex-col shadow-lg z-30 overflow-hidden border border-white/5 bg-surface">
            <div className="p-4 border-b border-white/5">
              <SectionHeading
                title="Room"
                subtitle={`${realtime.presenceUsers.length} online`}
              />
            </div>
            {/* Active users section */}
            <div className="max-h-[40%] overflow-y-auto custom-scrollbar">
              <div className="px-3 pt-2 pb-1">
                <h4 className="text-label-code text-on-surface-variant uppercase tracking-wider">Online now</h4>
              </div>
              {realtime.presenceUsers.length === 0 ? (
                <p className="text-body-sm text-on-surface-variant px-3 pb-2">No one online</p>
              ) : (
                <ul className="px-2 pb-2 space-y-0.5">
                  {realtime.presenceUsers.map((presenceUser) => (
                    <li
                      key={presenceUser.userId}
                      className="flex items-center gap-2 p-1.5 rounded hover:bg-surface-container-high/50 transition-colors"
                    >
                      <span className="w-6 h-6 rounded-full bg-primary/10 border border-outline-variant flex items-center justify-center text-primary text-[10px] font-medium shrink-0">
                        {getPresenceDisplayName(presenceUser).charAt(0).toUpperCase()}
                      </span>
                      <span className="text-body-sm text-on-surface truncate flex-1">
                        {getPresenceDisplayName(presenceUser)}
                      </span>
                      <span className="w-1.5 h-1.5 rounded-full bg-tertiary shrink-0" title="Online" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* Member management section */}
            <MemberManagement
              roomId={roomState.room.id}
              currentUserId={user?.id ?? ''}
              isOwner={activeRoom?.role === 'OWNER'}
              runWithAuth={runWithAuth}
            />
          </aside>
        )}

        {/* Main Canvas */}
        {roomState.status === 'ready' ? (
          <BoardCanvas
            canDrawRectangle={canDrawRectangle}
            canEditObjects={canDrawRectangle}
            canRedo={canDrawRectangle && realtime.canRedo}
            canUndo={canDrawRectangle && realtime.canUndo}
            commentPins={commentPins}
            currentUserId={user?.id ?? 'local-user'}
            liveCursors={realtime.liveCursors}
            onCircleCommit={realtime.sendCircleCreate}
            onCanvasCommentPoint={(point) => {
              setCommentTarget({ x: point.x, y: point.y });
              setShowComments(true);
            }}
            onCursorMove={realtime.sendCursorUpdate}
            onLineCommit={realtime.sendLineCreate}
            onObjectEditStart={(objectId) => realtime.sendSelectionUpdate([objectId], 'editing')}
            onObjectEditStop={() => realtime.sendSelectionUpdate([...selectedObjectIds], 'selected')}
            onObjectMoveCommit={handleObjectMoveCommit}
            onObjectsDelete={handleObjectsDelete}
            onObjectTransformCommit={handleObjectTransformCommit}
            onRectangleCommit={realtime.sendRectangleCreate}
            onTextCommit={realtime.sendTextCreate}
            onTextEditBlocked={(lease) => {
              toastService.error(`${lease.displayName || lease.userId} is editing this text`);
            }}
            onTextEditCommit={realtime.sendTextEdit}
            onTextEditStart={realtime.claimTextLease}
            onTextEditStop={realtime.releaseTextLease}
            onRedo={handleRedo}
            onUndo={handleUndo}
            roomId={roomState.room.id}
            remoteSelections={realtime.remoteSelections}
            textLeases={realtime.textLeases}
          />
        ) : roomState.status === 'loading' ? (
          <div className="flex-1 flex items-center justify-center bg-canvas-bg">
            <p className="text-on-surface-variant">Loading room...</p>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-canvas-bg">
            <div className="text-center">
              <p className="text-error text-body-md mb-2">{roomState.message}</p>
              <Link to="/dashboard" className="text-primary hover:text-primary-fixed transition-colors text-body-sm">
                Back to Dashboard
              </Link>
            </div>
          </div>
        )}

        {showComments && roomState.status === 'ready' && (
          <aside className="absolute left-[72px] bottom-20 w-[320px] glass-panel rounded-xl flex flex-col shadow-lg z-30 overflow-hidden border border-white/5 bg-surface">
            <div className="p-4 border-b border-white/5">
              <SectionHeading
                title="Comments"
                subtitle={`${comments.filter((comment) => !comment.resolved).length} open`}
                action={
                  selectedObjectIds.size > 0 ? (
                    <button
                      className="text-label-code text-primary hover:text-primary-fixed"
                      type="button"
                      onClick={() => {
                        const [objectId] = [...selectedObjectIds];
                        setCommentTarget({ objectId });
                      }}
                    >
                      Comment selected
                    </button>
                  ) : undefined
                }
              />
            </div>
            {commentTarget && (
              <form onSubmit={handleCreateComment} className="p-3 border-b border-white/5">
                <textarea
                  className="w-full min-h-20 bg-surface-container-highest border border-stroke-default rounded px-3 py-2 text-body-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
                  placeholder="Add annotation..."
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    className="px-3 py-1.5 text-body-sm text-on-surface-variant"
                    type="button"
                    onClick={() => { setCommentTarget(null); setCommentBody(''); }}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-1.5 bg-primary text-on-primary rounded text-label-code disabled:opacity-50"
                    disabled={!commentBody.trim()}
                    type="submit"
                  >
                    Add
                  </button>
                </div>
              </form>
            )}
            <ul className="max-h-[260px] overflow-y-auto custom-scrollbar p-2 space-y-2">
              {comments.length === 0 && (
                <li className="text-body-sm text-on-surface-variant p-2">No comments yet.</li>
              )}
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  className={`p-2 rounded border text-body-sm ${comment.resolved ? 'bg-surface-container-low/40 border-stroke-default/40 opacity-60' : 'bg-surface-container-low border-stroke-default'}`}
                >
                  <p className="text-on-surface mb-2">{comment.body}</p>
                  <div className="flex items-center justify-between text-label-code text-on-surface-variant">
                    <span>{comment.objectId ? 'Object annotation' : 'Canvas annotation'}</span>
                    <button
                      className="text-primary hover:text-primary-fixed"
                      type="button"
                      onClick={() => handleResolveComment(comment)}
                    >
                      {comment.resolved ? 'Reopen' : 'Resolve'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        )}

        {roomState.status === 'ready' && realtime.offlineConflicts.length > 0 && (
          <aside className="absolute right-[88px] bottom-20 w-[360px] glass-panel rounded-xl flex flex-col shadow-lg z-40 overflow-hidden border border-error/30 bg-surface">
            <div className="p-4 border-b border-white/5 flex items-center justify-between gap-3">
              <SectionHeading
                title="Sync conflicts"
                subtitle={`${realtime.offlineConflicts.length} local change${realtime.offlineConflicts.length === 1 ? '' : 's'} need review`}
              />
              <span className="material-symbols-outlined text-error text-base">sync_problem</span>
            </div>
            <ul className="max-h-[320px] overflow-y-auto custom-scrollbar divide-y divide-white/5">
              {realtime.offlineConflicts.map((operation) => {
                const summary = describeOfflineConflict(operation);

                return (
                  <li key={operation.id} className="p-4 space-y-3">
                    <div>
                      <p className="text-body-sm text-on-surface">{summary.title}</p>
                      <p className="text-label-code text-on-surface-variant">{summary.subtitle}</p>
                    </div>
                    {summary.fields.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {summary.fields.map((field) => (
                          <span key={field} className="px-1.5 py-0.5 rounded bg-error/10 text-error text-label-code">
                            {field}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="px-2.5 py-1.5 rounded border border-stroke-default text-label-code text-on-surface-variant hover:text-on-surface hover:border-primary transition-colors"
                        onClick={() => void realtime.discardOfflineConflict(operation.id)}
                      >
                        Discard
                      </button>
                      <button
                        type="button"
                        className="px-2.5 py-1.5 rounded bg-primary text-on-primary text-label-code hover:bg-primary-fixed transition-colors"
                        onClick={() => void realtime.retryOfflineConflict(operation.id)}
                      >
                        Retry latest
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}

        {/* Version History Panel (Right Sidebar) */}
        {showVersions && roomState.status === 'ready' && (
          <aside className="absolute top-3 right-3 bottom-20 w-[280px] glass-panel rounded-xl flex flex-col shadow-lg z-30 overflow-hidden border border-white/5 bg-surface">
            <div className="p-4 border-b border-white/5">
              <SectionHeading
                title="Version history"
                subtitle={
                  versionHistoryState.status === 'ready'
                    ? `Current version ${versionHistoryState.history.currentVersion}`
                    : 'Recent board events'
                }
                action={
                  <button
                    className="text-on-surface-variant hover:text-on-surface transition-colors p-1"
                    onClick={() => void loadVersionHistory()}
                    disabled={versionHistoryState.status === 'loading'}
                    type="button"
                    title="Refresh"
                  >
                    <span className="material-symbols-outlined text-lg">refresh</span>
                  </button>
                }
              />
            </div>

            {/* Tag Form */}
            {canTagVersion && (
              <form onSubmit={handleCreateVersionTag} className="p-3 border-b border-white/5">
                <label className="block text-label-code text-on-surface-variant mb-1.5 uppercase tracking-wider">
                  Tag current version
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tagLabel}
                    maxLength={120}
                    onChange={(e) => setTagLabel(e.target.value)}
                    placeholder="Checkpoint label"
                    disabled={versionHistoryState.status !== 'ready'}
                    className="flex-1 bg-surface-container-highest border border-stroke-default rounded px-3 py-1.5 text-body-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                  />
                  <button
                    type="submit"
                    disabled={versionHistoryState.status !== 'ready' || !tagLabel.trim()}
                    className="bg-primary text-on-primary px-3 py-1.5 rounded text-label-code hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 shrink-0"
                  >
                    Tag
                  </button>
                </div>
                {tagError && (
                  <p className="text-error text-label-code mt-1.5">{tagError}</p>
                )}
              </form>
            )}

            {/* Version List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
              {versionHistoryState.status === 'loading' && (
                <p className="text-body-sm text-on-surface-variant p-2">Loading...</p>
              )}
              {versionHistoryState.status === 'error' && (
                <p className="text-error text-body-sm p-2">{versionHistoryState.message}</p>
              )}
              {versionHistoryState.status === 'ready' &&
                versionHistoryState.history.events.length === 0 && (
                  <p className="text-body-sm text-on-surface-variant p-2">No events recorded yet.</p>
                )}
              {versionHistoryState.status === 'ready' &&
                versionHistoryState.history.events.length > 0 && (
                  <ul className="space-y-1">
                    {versionHistoryState.history.events.map((versionEvent) => {
                      const tags = getTagsForVersion(
                        versionHistoryState.history.tags,
                        versionEvent.version
                      );
                      const isRestore = versionEvent.eventType === 'history.restore';
                      const restorePayload = isRestore ? (versionEvent.payload as Record<string, unknown>) : null;
                      const restoreTarget = restorePayload?.targetVersion as number | undefined;

                      // Restore events: compact inline display
                      if (isRestore) {
                        return (
                          <li
                            key={versionEvent.id}
                            className="px-2 py-1.5 rounded bg-tertiary/5 border border-tertiary/10 text-body-sm text-on-surface-variant"
                          >
                            <span className="text-label-mono text-tertiary">v{versionEvent.version}</span>
                            {' · Restored to '}
                            <span className="text-label-mono text-tertiary">v{restoreTarget ?? '?'}</span>
                            <span className="text-label-code text-on-surface-variant ml-2">
                              {new Date(versionEvent.createdAt).toLocaleTimeString()}
                            </span>
                          </li>
                        );
                      }

                      return (
                        <li
                          key={versionEvent.id}
                          className="p-2 rounded bg-surface-container-low/50 border border-stroke-default/50"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <strong className="text-label-mono text-primary">v{versionEvent.version}</strong>
                            <span className="text-body-sm text-on-surface">
                              {formatVersionEventType(versionEvent.eventType)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-label-code text-on-surface-variant">
                            <span>by {getVersionActorLabel(versionEvent)}</span>
                            <time dateTime={versionEvent.createdAt}>
                              {new Date(versionEvent.createdAt).toLocaleTimeString()}
                            </time>
                          </div>
                          <div className="flex items-center gap-2 mt-1.5">
                            {tags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {tags.map((tag) => (
                                  <span
                                    key={tag.id}
                                    className="px-1.5 py-0.5 rounded text-label-code bg-primary/10 text-primary border border-primary/20"
                                  >
                                    {tag.label}
                                  </span>
                                ))}
                              </div>
                            )}
                            {activeRoom?.role === 'OWNER' && (
                              <button
                                type="button"
                                className="px-1.5 py-0.5 rounded text-label-code bg-secondary/10 text-secondary border border-secondary/20 hover:bg-secondary/20 transition-colors ml-auto"
                                onClick={() => {
                                  runWithAuth((accessToken) =>
                                    apiClient.restoreVersion(activeRoom.id, versionEvent.version, accessToken)
                                  )
                                    .then((result) => {
                                      toastService.success(`Restored to v${result.restoredFromVersion}. Local undo/redo history was cleared.`);
                                      realtime.clearHistory();
                                      setBoardSnapshot(result.roomId, result.snapshot, result.version);
                                      return loadVersionHistory();
                                    })
                                    .catch((error: unknown) => {
                                      toastService.error(error instanceof Error ? error.message : 'Restore failed');
                                    });
                                }}
                              >
                                Restore
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
            </div>
          </aside>
        )}

        {/* Object Detail Panel (Right Sidebar — replaces version history when object selected) */}
        {roomState.status === 'ready' && (
          <ObjectDetailPanel
            onDelete={realtime.sendObjectDelete}
            role={roomState.room.role}
          />
        )}
      </div>
    </div>
  );
}

function describeOfflineConflict(operation: QueuedOperation): {
  fields: string[];
  subtitle: string;
  title: string;
} {
  const conflict = isConflictPayload(operation.conflict) ? operation.conflict : null;
  const request = isBoardEventRequest(operation.payload) ? operation.payload : null;
  const fields = conflict?.details?.conflictingFields ?? [];
  const objectId = conflict?.details?.objectId ?? request?.payload.objectId;
  const eventType = request?.eventType ?? 'board:event';
  const timestamp = operation.updatedAt ?? operation.createdAt;

  return {
    fields,
    title: `${formatEventType(eventType)}${objectId ? ` on ${objectId}` : ''}`,
    subtitle: `${conflict?.message ?? 'Local change could not sync'} · ${formatRelativeTime(timestamp)}`
  };
}

function isConflictPayload(value: unknown): value is {
  message?: string;
  details?: {
    objectId?: string;
    conflictingFields?: string[];
  };
} {
  return typeof value === 'object' && value !== null;
}

function isBoardEventRequest(value: unknown): value is {
  eventType: string;
  payload: {
    objectId?: string;
  };
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'eventType' in value &&
    typeof value.eventType === 'string' &&
    'payload' in value &&
    typeof value.payload === 'object' &&
    value.payload !== null
  );
}

function formatEventType(eventType: string): string {
  if (eventType === 'object:create') return 'Create object';
  if (eventType === 'object:update') return 'Update object';
  if (eventType === 'object:delete') return 'Delete object';
  return 'Board change';
}

function formatRelativeTime(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60_000));

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes === 1) return '1 minute ago';
  return `${diffMinutes} minutes ago`;
}

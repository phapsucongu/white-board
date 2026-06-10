import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiClient, type RoomSummary } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BoardCanvas } from '../board/BoardCanvas';
import {
  canMutateRoom,
  toMoveBoardObjectPayload,
  toResizeRectanglePayload,
  useRoomRealtime
} from '../realtime/useRoomRealtime';

type RoomState =
  | { status: 'loading' }
  | { status: 'ready'; room: RoomSummary }
  | { status: 'error'; message: string };

export function RoomPage() {
  const { roomId } = useParams();
  const { accessToken, runWithAuth, user } = useAuth();
  const [roomState, setRoomState] = useState<RoomState>({ status: 'loading' });
  const activeRoom = roomState.status === 'ready' ? roomState.room : null;
  const canDrawRectangle = canMutateRoom(activeRoom?.role);
  const realtime = useRoomRealtime({
    accessToken,
    enabled: Boolean(activeRoom),
    roomId: activeRoom?.id ?? null
  });

  useEffect(() => {
    let isActive = true;

    if (!roomId) {
      setRoomState({ status: 'error', message: 'Room id is missing' });
      return () => {
        isActive = false;
      };
    }

    runWithAuth((accessToken) => apiClient.getRoom(roomId, accessToken))
      .then((room) => {
        if (isActive) {
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

    return () => {
      isActive = false;
    };
  }, [roomId, runWithAuth]);

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">Room</p>
        <h1>{roomState.status === 'ready' ? roomState.room.name : roomId ?? 'Unknown room'}</h1>
        {roomState.status === 'ready' && roomState.room.role && (
          <p className="muted">Your role: {formatRoomRole(roomState.room.role)}</p>
        )}
      </div>
      <section className="panel room-toolbar-panel">
        {roomState.status === 'loading' && <p className="muted">Loading room...</p>}
        {roomState.status === 'error' && (
          <p className="status status-error">{roomState.message}</p>
        )}
        {roomState.status === 'ready' && (
          <p className={realtime.error ? 'status status-error' : 'muted'}>
            Realtime: {realtime.status}
            {realtime.error ? ` (${realtime.error})` : ''}
          </p>
        )}
        <Link className="button-link" to="/dashboard">
          Back to Dashboard
        </Link>
      </section>
      {roomState.status === 'ready' && (
        <BoardCanvas
          canDrawRectangle={canDrawRectangle}
          canEditObjects={canDrawRectangle}
          currentUserId={user?.id ?? 'local-user'}
          onObjectMoveCommit={(objectId, position) => {
            realtime.sendObjectUpdate(toMoveBoardObjectPayload(objectId, position));
          }}
          onRectangleCommit={realtime.sendRectangleCreate}
          onRectangleResizeCommit={(objectId, rectangle) => {
            realtime.sendObjectUpdate(toResizeRectanglePayload(objectId, rectangle));
          }}
          roomId={roomState.room.id}
        />
      )}
    </section>
  );
}

function formatRoomRole(role: RoomSummary['role']): string {
  if (!role) {
    return 'Member';
  }

  return role.charAt(0) + role.slice(1).toLowerCase();
}

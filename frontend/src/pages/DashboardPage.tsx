import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ServiceHealth } from '@whiteboard/shared';
import { apiClient, type RoomSummary } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { env } from '../config/env';

type HealthState =
  | { status: 'loading' }
  | { status: 'ready'; health: ServiceHealth }
  | { status: 'error'; message: string };

type RoomsState =
  | { status: 'loading' }
  | { status: 'ready'; rooms: RoomSummary[] }
  | { status: 'error'; message: string };

export function DashboardPage() {
  const { runWithAuth, user } = useAuth();
  const [healthState, setHealthState] = useState<HealthState>({ status: 'loading' });
  const [roomsState, setRoomsState] = useState<RoomsState>({ status: 'loading' });
  const [roomName, setRoomName] = useState('');
  const [roomError, setRoomError] = useState<string | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  const loadRooms = useCallback(async () => {
    setRoomsState({ status: 'loading' });

    try {
      const rooms = await runWithAuth((accessToken) => apiClient.listRooms(accessToken));
      setRoomsState({ status: 'ready', rooms });
    } catch (error: unknown) {
      setRoomsState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to load rooms'
      });
    }
  }, [runWithAuth]);

  useEffect(() => {
    let isActive = true;

    apiClient
      .getHealth()
      .then((health) => {
        if (isActive) {
          setHealthState({ status: 'ready', health });
        }
      })
      .catch((error: unknown) => {
        if (isActive) {
          setHealthState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Unable to reach backend'
          });
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  const handleCreateRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = roomName.trim();

    if (!trimmedName) {
      setRoomError('Room name is required');
      return;
    }

    setRoomError(null);
    setIsCreatingRoom(true);

    try {
      const room = await runWithAuth((accessToken) =>
        apiClient.createRoom({ name: trimmedName }, accessToken)
      );

      setRoomsState((currentState) => {
        if (currentState.status !== 'ready') {
          return { status: 'ready', rooms: [room] };
        }

        return { status: 'ready', rooms: [room, ...currentState.rooms] };
      });
      setRoomName('');
    } catch (error: unknown) {
      setRoomError(error instanceof Error ? error.message : 'Unable to create room');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">Workspace</p>
        <h1>Dashboard</h1>
        <p className="muted">
          Signed in as {user?.displayName || user?.email || 'authenticated user'}.
        </p>
      </div>
      <div className="panel-grid">
        <section className="panel" aria-label="Backend status">
          <h2>Backend</h2>
          <p className="muted">API base URL: {env.apiBaseUrl}</p>
          <p className={healthState.status === 'error' ? 'status status-error' : 'status'}>
            {healthState.status === 'loading' && 'Checking health...'}
            {healthState.status === 'ready' && `Health: ${healthState.health.status}`}
            {healthState.status === 'error' && healthState.message}
          </p>
        </section>
        <section className="panel" aria-label="Create room">
          <h2>Create Room</h2>
          <form className="form-stack" onSubmit={handleCreateRoom}>
            <label>
              Room name
              <input
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder="Operations board"
                maxLength={120}
                disabled={isCreatingRoom}
              />
            </label>
            {roomError && <p className="status status-error">{roomError}</p>}
            <button type="submit" disabled={isCreatingRoom}>
              {isCreatingRoom ? 'Creating...' : 'Create Room'}
            </button>
          </form>
        </section>
      </div>
      <section className="panel" aria-label="Rooms">
        <div className="section-heading-row">
          <div>
            <h2>Your Rooms</h2>
            <p className="muted">Rooms where your account is a member.</p>
          </div>
          <button type="button" onClick={() => void loadRooms()} disabled={roomsState.status === 'loading'}>
            Refresh
          </button>
        </div>

        {roomsState.status === 'loading' && <p className="muted">Loading rooms...</p>}
        {roomsState.status === 'error' && (
          <p className="status status-error">{roomsState.message}</p>
        )}
        {roomsState.status === 'ready' && roomsState.rooms.length === 0 && (
          <p className="muted">No rooms yet. Create one to start a board workspace.</p>
        )}
        {roomsState.status === 'ready' && roomsState.rooms.length > 0 && (
          <ul className="room-list">
            {roomsState.rooms.map((room) => (
              <li className="room-list-item" key={room.id}>
                <div className="room-list-copy">
                  <h3>{room.name}</h3>
                  <p className="muted">Updated {new Date(room.updatedAt).toLocaleString()}</p>
                </div>
                <div className="room-list-actions">
                  {room.role && <span className="role-badge">{formatRoomRole(room.role)}</span>}
                  <Link className="button-link" to={`/rooms/${room.id}`}>
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function formatRoomRole(role: RoomSummary['role']): string {
  if (!role) {
    return 'Member';
  }

  return role.charAt(0) + role.slice(1).toLowerCase();
}

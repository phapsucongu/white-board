import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { RoleBadge } from '../components/ui/role-badge';
import { StatusChip } from '../components/ui/status-chip';
import { toastService } from '../components/ui/toaster';
import { useCreateRoom, useDeleteRoom, useJoinRoom, useRooms } from '../hooks/useRoomQueries';
import { env } from '../config/env';

const roomIcons = ['architecture', 'design_services', 'hub', 'polyline', 'grid_on', 'layers'];

function getRoomIcon(roomId: string): string {
  let hash = 0;
  for (let i = 0; i < roomId.length; i++) hash = (hash * 31 + roomId.charCodeAt(i)) | 0;
  return roomIcons[Math.abs(hash) % roomIcons.length];
}

function getRoomStatus(updatedAt: string): 'active' | 'idle' {
  return (Date.now() - new Date(updatedAt).getTime()) / 3600000 < 24 ? 'active' : 'idle';
}

export function DashboardPage() {
  const { accessToken, runWithAuth, user } = useAuth();
  const [roomName, setRoomName] = useState('');
  const [roomError, setRoomError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const roomsQuery = useRooms(accessToken);
  const createRoomMutation = useCreateRoom();
  const deleteRoomMutation = useDeleteRoom();
  const joinRoomMutation = useJoinRoom();

  const rooms = roomsQuery.data ?? [];

  const handleCreateRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = roomName.trim();
    if (!name) { setRoomError('Room name is required'); return; }
    if (!accessToken) return;
    createRoomMutation.mutate({ name, accessToken }, {
      onSuccess: () => { setRoomName(''); setShowCreateDialog(false); toastService.success(`Room "${name}" created`); },
      onError: (e) => setRoomError(e instanceof Error ? e.message : 'Failed')
    });
  };

  const handleJoinRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = inviteCode.trim().toUpperCase();
    if (!code) { setJoinError('Invite code is required'); return; }
    if (!accessToken) return;
    joinRoomMutation.mutate({ inviteCode: code, accessToken }, {
      onSuccess: () => { setInviteCode(''); setShowJoinDialog(false); toastService.success('Joined room'); },
      onError: (e) => setJoinError(e instanceof Error ? e.message : 'Failed')
    });
  };

  const handleDeleteRoom = () => {
    if (!deleteTarget || !accessToken) return;
    deleteRoomMutation.mutate({ roomId: deleteTarget.id, accessToken }, {
      onSuccess: () => { toastService.success(`Room "${deleteTarget.name}" deleted`); setDeleteTarget(null); },
      onError: (e) => toastService.error(e instanceof Error ? e.message : 'Failed')
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="p-6 md:p-8 max-w-7xl mx-auto w-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-headline-lg font-semibold mb-1 text-on-surface">Active Rooms</h1>
            <p className="text-on-surface-variant text-body-sm">
              Signed in as {user?.displayName || user?.email || 'user'}.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-high border border-outline-variant rounded text-body-sm hover:border-primary transition-colors text-on-surface-variant hover:text-on-surface"
              onClick={() => roomsQuery.refetch()} disabled={roomsQuery.isFetching} type="button">
              <span className="material-symbols-outlined text-[18px]">refresh</span>Refresh
            </button>
            <button className="bg-primary text-on-primary px-4 py-1.5 rounded text-label-mono hover:bg-primary-fixed-dim transition-colors flex items-center gap-1.5"
              onClick={() => setShowCreateDialog(true)} type="button">
              <span className="material-symbols-outlined text-[18px]">add</span>Create Room
            </button>
            <button className="bg-surface-container-high border border-outline-variant rounded px-4 py-1.5 text-label-mono text-on-surface-variant hover:text-on-surface hover:border-primary transition-colors flex items-center gap-1.5"
              onClick={() => setShowJoinDialog(true)} type="button">
              <span className="material-symbols-outlined text-[18px]">group_add</span>Join Room
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {roomsQuery.isLoading && <p className="col-span-full text-center text-on-surface-variant py-16">Loading rooms...</p>}
          {roomsQuery.isError && <p className="col-span-full text-center text-error py-16">Failed to load rooms</p>}

          {rooms.map((room) => (
            <div key={room.id} className="bg-surface-container-low border border-stroke-default rounded-lg p-5 hover:border-primary/50 transition-colors group flex flex-col h-full">
              <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                  <span className="material-symbols-outlined">{getRoomIcon(room.id)}</span>
                </div>
                <StatusChip variant={getRoomStatus(room.updatedAt)} label={getRoomStatus(room.updatedAt) === 'active' ? 'Active' : 'Idle'} />
              </div>
              <h3 className="text-headline-md font-semibold mb-1 text-on-surface group-hover:text-primary transition-colors">{room.name}</h3>
              <p className="text-body-sm text-on-surface-variant mb-3 line-clamp-2">Updated {new Date(room.updatedAt).toLocaleString()}</p>
              {room.inviteCode && (
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-label-code text-on-surface-variant uppercase tracking-wider">Code:</span>
                  <code className="text-label-mono text-primary bg-surface-container-high px-2 py-0.5 rounded border border-outline-variant select-all">{room.inviteCode}</code>
                  <button type="button" className="text-on-surface-variant hover:text-primary transition-colors"
                    onClick={async (e) => { e.stopPropagation(); await navigator.clipboard.writeText(room.inviteCode ?? ''); toastService.success('Copied!'); }} title="Copy">
                    <span className="material-symbols-outlined text-base">content_copy</span>
                  </button>
                </div>
              )}
              <div className="mt-auto flex justify-between items-end">
                <div className="flex items-center gap-2">
                  {room.role && <RoleBadge role={room.role} />}
                  {room.role === 'OWNER' && (
                    <button type="button" className="text-on-surface-variant hover:text-error transition-colors p-0.5 opacity-0 group-hover:opacity-100"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: room.id, name: room.name }); }} title="Delete">
                      <span className="material-symbols-outlined text-base">delete</span>
                    </button>
                  )}
                </div>
                <Link to={`/rooms/${room.id}`} className="bg-surface-bright hover:bg-primary hover:text-on-primary text-on-surface px-3 py-1.5 rounded text-label-mono transition-colors border border-outline-variant hover:border-primary flex items-center justify-center">Open</Link>
              </div>
            </div>
          ))}

          <button className="bg-surface-container-low border border-outline-variant border-dashed border-2 rounded-lg p-5 hover:border-primary/50 transition-colors group flex flex-col h-full justify-center items-center text-center cursor-pointer opacity-80 hover:opacity-100 min-h-[200px]"
            onClick={() => setShowCreateDialog(true)} type="button">
            <div className="w-12 h-12 rounded-full bg-surface-bright flex items-center justify-center text-primary mb-3 group-hover:bg-primary group-hover:text-on-primary transition-colors">
              <span className="material-symbols-outlined text-[24px]">add</span>
            </div>
            <span className="text-headline-md font-semibold text-on-surface mb-1">New Room</span>
            <span className="text-body-sm text-on-surface-variant">Start a blank canvas</span>
          </button>
        </div>
      </div>

      {/* Create Room Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md glass-panel rounded-xl shadow-lg overflow-hidden">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-headline-md font-semibold text-on-surface">Create Room</h2>
                <button className="text-on-surface-variant hover:text-on-surface transition-colors" onClick={() => { setShowCreateDialog(false); setRoomError(null); }} type="button"><span className="material-symbols-outlined">close</span></button>
              </div>
              <form onSubmit={handleCreateRoom} className="space-y-4">
                <div>
                  <label className="block text-label-mono text-on-surface-variant mb-2 uppercase tracking-wider" htmlFor="roomName">Room Name</label>
                  <input id="roomName" className="w-full bg-surface-container-highest border border-stroke-default rounded pl-4 pr-4 py-2.5 text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                    value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Operations board" maxLength={120} disabled={createRoomMutation.isPending} />
                </div>
                {roomError && <p className="text-error text-body-sm bg-error/10 border border-error/20 rounded p-3">{roomError}</p>}
                <div className="flex gap-3 justify-end pt-2">
                  <button type="button" className="px-4 py-2 bg-surface-container-high border border-outline-variant rounded text-body-sm text-on-surface-variant hover:text-on-surface transition-colors"
                    onClick={() => { setShowCreateDialog(false); setRoomError(null); }}>Cancel</button>
                  <button type="submit" disabled={createRoomMutation.isPending}
                    className="px-4 py-2 bg-primary text-on-primary rounded text-label-mono hover:bg-primary-fixed-dim transition-colors disabled:opacity-50">
                    {createRoomMutation.isPending ? 'Creating...' : 'Create Room'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Join Room Dialog */}
      {showJoinDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md glass-panel rounded-xl shadow-lg overflow-hidden">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-headline-md font-semibold text-on-surface">Join Room</h2>
                <button className="text-on-surface-variant hover:text-on-surface transition-colors" onClick={() => { setShowJoinDialog(false); setJoinError(null); }} type="button"><span className="material-symbols-outlined">close</span></button>
              </div>
              <form onSubmit={handleJoinRoom} className="space-y-4">
                <div>
                  <label className="block text-label-mono text-on-surface-variant mb-2 uppercase tracking-wider" htmlFor="inviteCode">Invite Code</label>
                  <input id="inviteCode" className="w-full bg-surface-container-highest border border-stroke-default rounded pl-4 pr-4 py-2.5 text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                    value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="ABCD1234" maxLength={20} disabled={joinRoomMutation.isPending} />
                </div>
                {joinError && <p className="text-error text-body-sm bg-error/10 border border-error/20 rounded p-3">{joinError}</p>}
                <div className="flex gap-3 justify-end pt-2">
                  <button type="button" className="px-4 py-2 bg-surface-container-high border border-outline-variant rounded text-body-sm text-on-surface-variant hover:text-on-surface transition-colors"
                    onClick={() => { setShowJoinDialog(false); setJoinError(null); }}>Cancel</button>
                  <button type="submit" disabled={joinRoomMutation.isPending}
                    className="px-4 py-2 bg-primary text-on-primary rounded text-label-mono hover:bg-primary-fixed-dim transition-colors disabled:opacity-50">
                    {joinRoomMutation.isPending ? 'Joining...' : 'Join Room'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Room Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm glass-panel rounded-xl shadow-lg overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center text-error"><span className="material-symbols-outlined">warning</span></div>
                <div>
                  <h2 className="text-headline-md font-semibold text-on-surface">Delete Room</h2>
                  <p className="text-body-sm text-on-surface-variant">This cannot be undone.</p>
                </div>
              </div>
              <p className="text-body-sm text-on-surface mb-4">Delete <strong>"{deleteTarget.name}"</strong>?</p>
              <div className="flex gap-3 justify-end">
                <button type="button" className="px-4 py-2 bg-surface-container-high border border-outline-variant rounded text-body-sm text-on-surface-variant hover:text-on-surface transition-colors"
                  onClick={() => setDeleteTarget(null)} disabled={deleteRoomMutation.isPending}>Cancel</button>
                <button type="button" className="px-4 py-2 bg-error text-on-error rounded text-label-mono hover:bg-error-container transition-colors disabled:opacity-50"
                  onClick={() => handleDeleteRoom()} disabled={deleteRoomMutation.isPending}>
                  {deleteRoomMutation.isPending ? 'Deleting...' : 'Delete Room'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

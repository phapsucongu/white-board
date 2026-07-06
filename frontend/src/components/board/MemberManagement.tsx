import { useCallback, useEffect, useState } from 'react';
import { apiClient, type RoomMember, type RoomRole } from '../../api/client';
import { toastService } from '../ui/toaster';

type MemberManagementProps = {
  accessToken: string | null;
  roomId: string;
  currentUserId: string;
  isOwner: boolean;
  runWithAuth: <T>(fn: (token: string) => Promise<T>) => Promise<T>;
};

export function MemberManagement({ accessToken, roomId, currentUserId, isOwner, runWithAuth }: MemberManagementProps) {
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMembers = useCallback(() => {
    setLoading(true);
    runWithAuth((token) => apiClient.listMembers(roomId, token))
      .then((m) => { setMembers(m); setLoading(false); })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : 'Failed to load members'); setLoading(false); });
  }, [roomId, runWithAuth]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const handleRoleChange = async (userId: string, newRole: RoomRole) => {
    try {
      const updated = await runWithAuth((token) => apiClient.updateMemberRole(roomId, userId, newRole, token));
      setMembers((prev) => prev.map((m) => (m.userId === userId ? updated : m)));
      toastService.success(`Role updated to ${formatRole(newRole)}`);
    } catch (e: unknown) {
      toastService.error(e instanceof Error ? e.message : 'Failed to update role');
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await runWithAuth((token) => apiClient.removeMember(roomId, userId, token));
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
      toastService.success('Member removed');
    } catch (e: unknown) {
      toastService.error(e instanceof Error ? e.message : 'Failed to remove member');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-3 border-b border-white/5 flex items-center justify-between">
        <h3 className="text-label-mono text-on-surface-variant uppercase tracking-wider">Members</h3>
        <button
          type="button"
          className="text-on-surface-variant hover:text-on-surface transition-colors"
          onClick={loadMembers}
          disabled={loading}
          title="Refresh"
        >
          <span className="material-symbols-outlined text-sm">refresh</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading && <p className="text-body-sm text-on-surface-variant p-3">Loading...</p>}
        {error && <p className="text-error text-body-sm p-3">{error}</p>}
        {!loading && !error && (
          <ul className="p-2 space-y-1">
            {members.map((member) => (
              <li key={member.userId} className="flex items-center gap-2 p-2 rounded hover:bg-surface-container-high/50 transition-colors group">
                <span className="w-7 h-7 rounded-full bg-primary/10 border border-outline-variant flex items-center justify-center text-primary text-[10px] font-medium shrink-0">
                  {(member.displayName || member.email).charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm text-on-surface truncate">{member.displayName || member.email}</p>
                  <p className="text-label-code text-on-surface-variant truncate">{member.email}</p>
                </div>
                {isOwner && member.userId !== currentUserId ? (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <select
                      className="bg-surface-container-highest border border-stroke-default rounded px-1.5 py-0.5 text-label-code text-on-surface focus:outline-none focus:border-primary"
                      value={member.role}
                      onChange={(e) => handleRoleChange(member.userId, e.target.value as RoomRole)}
                    >
                      <option value="OWNER">Owner</option>
                      <option value="EDITOR">Editor</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                    <button
                      type="button"
                      className="text-on-surface-variant hover:text-error transition-colors p-0.5"
                      onClick={() => handleRemove(member.userId)}
                      title="Remove member"
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  </div>
                ) : (
                  <span className="text-label-code text-on-surface-variant">{formatRole(member.role)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {!isOwner && (
        <p className="text-label-code text-on-surface-variant/50 p-3 border-t border-white/5">
          Only the room owner can manage members
        </p>
      )}
    </div>
  );
}

function formatRole(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}
